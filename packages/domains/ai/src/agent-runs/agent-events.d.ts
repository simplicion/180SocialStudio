export declare const AGENT_EVENT_TYPES: readonly ["AgentStarted", "ContextLoaded", "MediaAnalyzed", "PlanCreated", "PlanValidated", "ToolCalled", "ToolCompleted", "TimelineChanged", "CriticStarted", "CriticCompleted", "RepairCreated", "RepairApplied", "PublishStarted", "PublishCompleted", "AgentFailed"];
export type AgentEventType = (typeof AGENT_EVENT_TYPES)[number];
export type AgentName = "director" | "autopilot" | "creative" | "publisher";
export interface AgentRunEvent {
    id: string;
    runId: string;
    type: AgentEventType;
    ts: string;
    payload: Record<string, unknown>;
}
/** Stored row (tenant columns included). */
export interface AgentRunEventRecord extends AgentRunEvent {
    companyId: string;
    projectId: string;
    agent: AgentName;
    seq: number;
}
export interface AgentRunSummary {
    runId: string;
    agent: AgentName;
    status: "running" | "completed" | "failed";
    startedAt: string;
    lastEventAt: string;
    eventCount: number;
    lastEventType: AgentEventType;
}
export interface AgentRunScope {
    companyId: string;
    projectId: string;
}
export interface AgentEventStore {
    append(event: AgentRunEventRecord): Promise<void>;
    /** Events of one run, oldest first. Must filter by companyId AND projectId. */
    listEvents(scope: AgentRunScope, runId: string): Promise<AgentRunEventRecord[]>;
    /** Most recent runs of a project (newest first). */
    listRuns(scope: AgentRunScope, limit: number): Promise<AgentRunSummary[]>;
}
/** Redacts secret-looking keys, truncates long strings/arrays and drops functions. Pure. */
export declare function sanitizeEventPayload(value: unknown, depth?: number): any;
export interface AgentRunEmitter {
    readonly runId: string;
    /** Records an event. Never throws; storage errors are logged. */
    emit(type: AgentEventType, payload?: Record<string, unknown>): void;
    /** Waits for buffered writes (call before responding when the events should be readable immediately). */
    flush(): Promise<void>;
    /** Events emitted through this emitter (in memory, for responses and tests). */
    readonly events: AgentRunEvent[];
}
/** An emitter that only keeps events in memory (no tenant scope, e.g. a Director call without a project). */
export declare function createLocalEmitter(runId?: string): AgentRunEmitter;
export declare function createAgentRunEmitter(params: {
    store: AgentEventStore | null;
    agent: AgentName;
    /** Null = not persisted (the caller could not verify a project of the company). */
    scope: AgentRunScope | null;
    runId?: string;
    now?: () => Date;
    log?: (msg: string, err?: unknown) => void;
}): AgentRunEmitter;
export declare class InMemoryAgentEventStore implements AgentEventStore {
    readonly rows: AgentRunEventRecord[];
    append(event: AgentRunEventRecord): Promise<void>;
    listEvents(scope: AgentRunScope, runId: string): Promise<AgentRunEventRecord[]>;
    listRuns(scope: AgentRunScope, limit: number): Promise<AgentRunSummary[]>;
}
/** Prisma-backed store (`AgentRunEvent` model). Every query filters by companyId AND projectId. */
export declare class PrismaAgentEventStore implements AgentEventStore {
    private readonly db;
    constructor(db: {
        agentRunEvent: {
            create(a: any): Promise<any>;
            findMany(a: any): Promise<any[]>;
        };
    });
    private static toRecord;
    append(e: AgentRunEventRecord): Promise<void>;
    listEvents(scope: AgentRunScope, runId: string): Promise<AgentRunEventRecord[]>;
    listRuns(scope: AgentRunScope, limit: number): Promise<AgentRunSummary[]>;
}
/** Public view of an event (no tenant columns). */
export declare const toPublicEvent: (e: AgentRunEventRecord) => AgentRunEvent;
/** Prisma store when the `agentRunEvent` model exists in the generated client; otherwise null (not persisted). */
export declare function getDefaultAgentEventStore(): AgentEventStore | null;
