"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toPublicEvent = exports.PrismaAgentEventStore = exports.InMemoryAgentEventStore = exports.AGENT_EVENT_TYPES = void 0;
exports.sanitizeEventPayload = sanitizeEventPayload;
exports.createLocalEmitter = createLocalEmitter;
exports.createAgentRunEmitter = createAgentRunEmitter;
exports.getDefaultAgentEventStore = getDefaultAgentEventStore;
/**
 * Agent run event log (observability for every agent: Director, Autopilot, Creative engine, Publisher).
 *
 * One run = one runId. Events are append-only `{ id, runId, type, ts, payload }` rows scoped by companyId +
 * projectId (Prisma model `AgentRunEvent`). Emitting never throws into the business logic: the recorder buffers
 * writes on a promise chain, logs storage failures and keeps going. A run is terminal when an event carries
 * `payload.final === true` or an `AgentFailed` event is written.
 *
 * Deliberately dependency-free (no Prisma import) so it can be deep-imported (`@workspace/ai/dist/agent-runs`)
 * without booting the rest of the AI domain. The Prisma store takes the client as an argument.
 */
const crypto_1 = require("crypto");
exports.AGENT_EVENT_TYPES = [
    "AgentStarted",
    "ContextLoaded",
    "MediaAnalyzed",
    "PlanCreated",
    "PlanValidated",
    "ToolCalled",
    "ToolCompleted",
    "TimelineChanged",
    "CriticStarted",
    "CriticCompleted",
    "RepairCreated",
    "RepairApplied",
    "PublishStarted",
    "PublishCompleted",
    "AgentFailed",
];
// ─── Payload hygiene ─────────────────────────────────────────────────────────────────────────────
const SECRET_KEY = /(?:token|secret|password|passwd|api[_-]?key|authorization|cookie|credential|private[_-]?key)/i;
const MAX_STRING = 500;
const MAX_ARRAY = 50;
const MAX_DEPTH = 5;
/** Redacts secret-looking keys, truncates long strings/arrays and drops functions. Pure. */
function sanitizeEventPayload(value, depth = 0) {
    if (value == null || typeof value === "number" || typeof value === "boolean")
        return value;
    if (typeof value === "string")
        return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING - 1)}…` : value;
    if (typeof value === "bigint")
        return value.toString();
    if (value instanceof Date)
        return value.toISOString();
    if (typeof value === "function" || typeof value === "symbol")
        return undefined;
    if (depth >= MAX_DEPTH)
        return "[truncated]";
    if (Array.isArray(value)) {
        const out = value.slice(0, MAX_ARRAY).map((v) => sanitizeEventPayload(v, depth + 1));
        if (value.length > MAX_ARRAY)
            out.push(`[+${value.length - MAX_ARRAY} more]`);
        return out;
    }
    if (typeof value === "object") {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            if (SECRET_KEY.test(k)) {
                out[k] = "[redacted]";
                continue;
            }
            const s = sanitizeEventPayload(v, depth + 1);
            if (s !== undefined)
                out[k] = s;
        }
        return out;
    }
    return String(value);
}
/** An emitter that only keeps events in memory (no tenant scope, e.g. a Director call without a project). */
function createLocalEmitter(runId = (0, crypto_1.randomUUID)()) {
    return createAgentRunEmitter({ store: null, runId, agent: "director", scope: null });
}
function createAgentRunEmitter(params) {
    const runId = params.runId || (0, crypto_1.randomUUID)();
    const now = params.now || (() => new Date());
    const log = params.log || ((m, e) => console.warn(`[agent-events] ${m}`, e?.message || e || ""));
    const events = [];
    let chain = Promise.resolve();
    let seq = 0;
    const persist = !!(params.store && params.scope?.companyId && params.scope?.projectId);
    return {
        runId,
        events,
        emit(type, payload = {}) {
            try {
                if (!exports.AGENT_EVENT_TYPES.includes(type))
                    throw new Error(`unknown agent event type ${type}`);
                const event = { id: (0, crypto_1.randomUUID)(), runId, type, ts: now().toISOString(), payload: sanitizeEventPayload(payload) || {} };
                events.push(event);
                if (persist) {
                    const record = { ...event, companyId: params.scope.companyId, projectId: params.scope.projectId, agent: params.agent, seq: seq++ };
                    chain = chain.then(() => params.store.append(record)).catch((err) => log(`could not store ${type} for run ${runId}`, err));
                }
            }
            catch (err) {
                log(`emit ${type} failed`, err);
            }
        },
        flush() {
            return chain.catch(() => undefined);
        },
    };
}
// ─── Stores ──────────────────────────────────────────────────────────────────────────────────────
function summarize(rows) {
    const sorted = [...rows].sort((a, b) => a.ts.localeCompare(b.ts) || a.seq - b.seq);
    const last = sorted[sorted.length - 1];
    const failed = sorted.some((e) => e.type === "AgentFailed");
    const final = sorted.some((e) => e.payload?.final === true);
    return {
        runId: last.runId,
        agent: sorted[0].agent,
        status: failed ? "failed" : final ? "completed" : "running",
        startedAt: sorted[0].ts,
        lastEventAt: last.ts,
        eventCount: sorted.length,
        lastEventType: last.type,
    };
}
class InMemoryAgentEventStore {
    rows = [];
    async append(event) {
        this.rows.push(event);
    }
    async listEvents(scope, runId) {
        return this.rows
            .filter((r) => r.companyId === scope.companyId && r.projectId === scope.projectId && r.runId === runId)
            .sort((a, b) => a.ts.localeCompare(b.ts) || a.seq - b.seq);
    }
    async listRuns(scope, limit) {
        const byRun = new Map();
        for (const r of this.rows) {
            if (r.companyId !== scope.companyId || r.projectId !== scope.projectId)
                continue;
            if (!byRun.has(r.runId))
                byRun.set(r.runId, []);
            byRun.get(r.runId).push(r);
        }
        return Array.from(byRun.values()).map(summarize).sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, limit);
    }
}
exports.InMemoryAgentEventStore = InMemoryAgentEventStore;
/** Prisma-backed store (`AgentRunEvent` model). Every query filters by companyId AND projectId. */
class PrismaAgentEventStore {
    db;
    constructor(db) {
        this.db = db;
    }
    static toRecord(row) {
        return {
            id: row.id,
            runId: row.runId,
            type: row.type,
            ts: new Date(row.ts).toISOString(),
            payload: row.payload && typeof row.payload === "object" ? row.payload : {},
            companyId: row.companyId,
            projectId: row.projectId,
            agent: row.agent,
            seq: row.seq ?? 0,
        };
    }
    async append(e) {
        await this.db.agentRunEvent.create({
            data: { id: e.id, runId: e.runId, type: e.type, ts: new Date(e.ts), payload: e.payload, companyId: e.companyId, projectId: e.projectId, agent: e.agent, seq: e.seq },
        });
    }
    async listEvents(scope, runId) {
        const rows = await this.db.agentRunEvent.findMany({
            where: { companyId: scope.companyId, projectId: scope.projectId, runId },
            orderBy: [{ ts: "asc" }, { seq: "asc" }],
            take: 2000,
        });
        return rows.map(PrismaAgentEventStore.toRecord);
    }
    async listRuns(scope, limit) {
        const starts = await this.db.agentRunEvent.findMany({
            where: { companyId: scope.companyId, projectId: scope.projectId, type: "AgentStarted" },
            orderBy: { ts: "desc" },
            take: limit,
            select: { runId: true },
        });
        const runIds = Array.from(new Set(starts.map((r) => r.runId)));
        if (!runIds.length)
            return [];
        const rows = await this.db.agentRunEvent.findMany({
            where: { companyId: scope.companyId, projectId: scope.projectId, runId: { in: runIds } },
            orderBy: [{ ts: "asc" }, { seq: "asc" }],
            take: 5000,
        });
        const byRun = new Map();
        for (const r of rows.map(PrismaAgentEventStore.toRecord)) {
            if (!byRun.has(r.runId))
                byRun.set(r.runId, []);
            byRun.get(r.runId).push(r);
        }
        return Array.from(byRun.values()).map(summarize).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    }
}
exports.PrismaAgentEventStore = PrismaAgentEventStore;
/** Public view of an event (no tenant columns). */
const toPublicEvent = (e) => ({ id: e.id, runId: e.runId, type: e.type, ts: e.ts, payload: e.payload });
exports.toPublicEvent = toPublicEvent;
let defaultStore;
/** Prisma store when the `agentRunEvent` model exists in the generated client; otherwise null (not persisted). */
function getDefaultAgentEventStore() {
    if (defaultStore !== undefined)
        return defaultStore;
    try {
        const { prisma } = require("@workspace/db");
        defaultStore = prisma?.agentRunEvent ? new PrismaAgentEventStore(prisma) : null;
    }
    catch {
        defaultStore = null;
    }
    return defaultStore;
}
