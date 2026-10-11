/**
 * Social OS endpoints, mounted at /api/v1/social-media/projects/:id
 *
 *   GET    /agent-runs?limit=            recent agent runs of the project (Director, Autopilot, Creative, Publisher)
 *   GET    /agent-runs/:runId            events of one run {id, runId, type, ts, payload}
 *   POST   /media-index                  upsert [{assetId, kind, text, startMs?, endMs?, url?}] (text only; media stays on device)
 *   POST   /media-search                 {query, limit?} -> {results:[{assetId, kind, text, startMs, endMs, url, score}]}
 *   GET    /agent-memory?kind=&limit=    remembered preferences / feedback / performance
 *   POST   /agent-memory/feedback        {accepted, agent?, runId?, summary?, operations?, note?}
 *   POST   /agent-memory/preferences     {text} -> preferences parsed from the text and remembered
 *   POST   /agent-memory/performance     {platform, postId?, format?, pillar?, hookType?, metrics}
 *   DELETE /agent-memory/:memoryId
 *
 * Tenant = the authenticated user's company (JWT only). Every call first checks that the project belongs to it
 * (404 PROJECT_NOT_FOUND otherwise) and every query is filtered by companyId AND projectId.
 */
import { Router, Request, Response } from 'express';
import { companyOfUser, sendRouteError } from '../route-errors';

export interface AgentOsDeps {
    db: any;
    eventStore: {
        listRuns(scope: { companyId: string; projectId: string }, limit: number): Promise<any[]>;
        listEvents(scope: { companyId: string; projectId: string }, runId: string): Promise<any[]>;
    } | null;
    memory: any;
    mediaIndex: any;
    requireProject: (db: any, projectId: string, companyId: string) => Promise<unknown>;
}

export function defaultAgentOsDeps(): AgentOsDeps {
    const sm = require('@workspace/social-media');
    const runs = require('@workspace/ai/agent-runs');
    const { prisma } = require('@workspace/db');
    return {
        db: prisma,
        eventStore: runs.getDefaultAgentEventStore(),
        memory: new sm.AgentMemoryService(),
        mediaIndex: new sm.MediaIndexService(),
        requireProject: sm.requireSocialProject,
    };
}

const publicEvent = (e: any) => ({ id: e.id, runId: e.runId, type: e.type, ts: e.ts, payload: e.payload ?? {} });
const publicMemory = (m: any) => ({ id: m.id, kind: m.kind, scope: m.scope, key: m.key ?? null, text: m.text, payload: m.payload ?? null, createdAt: m.createdAt, updatedAt: m.updatedAt });

export function createAgentOsRouter(getDeps: () => AgentOsDeps = defaultAgentOsDeps) {
    const router = Router({ mergeParams: true });
    let cached: AgentOsDeps | null = null;
    const deps = () => (cached ||= getDeps());

    /** Resolves {companyId, projectId} after the ownership check, or answers the error itself. */
    async function scope(req: Request, res: Response): Promise<{ companyId: string; projectId: string } | null> {
        const companyId = companyOfUser(req);
        if (!companyId) {
            res.status(401).json({ success: false, code: 'UNAUTHORIZED', error: 'Company context required' });
            return null;
        }
        const projectId = String((req.params as any).id || '');
        try {
            await deps().requireProject(deps().db, projectId, companyId);
            return { companyId, projectId };
        } catch (err) {
            sendRouteError(res, err, 'agent-os');
            return null;
        }
    }

    router.get('/agent-runs', async (req, res) => {
        const s = await scope(req, res);
        if (!s) return;
        try {
            const store = deps().eventStore;
            if (!store) return res.status(503).json({ success: false, code: 'AGENT_EVENTS_NOT_CONFIGURED', error: 'The agent event log is not available on this server (AgentRunEvent table missing).' });
            const n = Number(req.query.limit);
            const limit = Number.isInteger(n) && n > 0 ? Math.min(n, 100) : 20;
            res.json({ success: true, runs: await store.listRuns(s, limit) });
        } catch (err) {
            sendRouteError(res, err, 'agent-runs');
        }
    });

    router.get('/agent-runs/:runId', async (req, res) => {
        const s = await scope(req, res);
        if (!s) return;
        try {
            const store = deps().eventStore;
            if (!store) return res.status(503).json({ success: false, code: 'AGENT_EVENTS_NOT_CONFIGURED', error: 'The agent event log is not available on this server (AgentRunEvent table missing).' });
            const runId = String(req.params.runId || '');
            if (!runId || runId.length > 64) return res.status(400).json({ success: false, code: 'VALIDATION_FAILED', error: 'runId is required' });
            const events = await store.listEvents(s, runId);
            if (!events.length) return res.status(404).json({ success: false, code: 'RUN_NOT_FOUND', error: 'Run not found' });
            res.json({ success: true, runId, events: events.map(publicEvent) });
        } catch (err) {
            sendRouteError(res, err, 'agent-run');
        }
    });

    router.post('/media-index', async (req, res) => {
        const s = await scope(req, res);
        if (!s) return;
        try {
            const r = await deps().mediaIndex.upsert(s.projectId, s.companyId, req.body);
            res.json({ success: true, ...r });
        } catch (err) {
            sendRouteError(res, err, 'media-index');
        }
    });

    router.post('/media-search', async (req, res) => {
        const s = await scope(req, res);
        if (!s) return;
        try {
            const r = await deps().mediaIndex.search(s.projectId, s.companyId, req.body);
            res.json({ success: true, results: r.results });
        } catch (err) {
            sendRouteError(res, err, 'media-search');
        }
    });

    router.get('/agent-memory', async (req, res) => {
        const s = await scope(req, res);
        if (!s) return;
        try {
            const n = Number(req.query.limit);
            const items = await deps().memory.list(s.projectId, s.companyId, { kind: typeof req.query.kind === 'string' ? req.query.kind : undefined, limit: Number.isInteger(n) ? n : undefined });
            res.json({ success: true, items: items.map(publicMemory) });
        } catch (err) {
            sendRouteError(res, err, 'agent-memory');
        }
    });

    router.post('/agent-memory/feedback', async (req, res) => {
        const s = await scope(req, res);
        if (!s) return;
        try {
            const item = await deps().memory.recordFeedback(s.projectId, s.companyId, req.body || {});
            res.status(201).json({ success: true, item: publicMemory(item) });
        } catch (err) {
            sendRouteError(res, err, 'agent-memory-feedback');
        }
    });

    router.post('/agent-memory/preferences', async (req, res) => {
        const s = await scope(req, res);
        if (!s) return;
        try {
            const text = typeof req.body?.text === 'string' ? req.body.text.slice(0, 1000) : '';
            if (!text.trim()) return res.status(400).json({ success: false, code: 'VALIDATION_FAILED', error: 'text is required' });
            const remembered = await deps().memory.rememberPreferencesFrom(s.projectId, s.companyId, text);
            res.json({ success: true, remembered });
        } catch (err) {
            sendRouteError(res, err, 'agent-memory-preferences');
        }
    });

    router.post('/agent-memory/performance', async (req, res) => {
        const s = await scope(req, res);
        if (!s) return;
        try {
            const item = await deps().memory.recordPerformance(s.projectId, s.companyId, req.body || {});
            res.status(201).json({ success: true, item: publicMemory(item) });
        } catch (err) {
            sendRouteError(res, err, 'agent-memory-performance');
        }
    });

    router.delete('/agent-memory/:memoryId', async (req, res) => {
        const s = await scope(req, res);
        if (!s) return;
        try {
            await deps().memory.forget(s.projectId, s.companyId, String(req.params.memoryId));
            res.json({ success: true });
        } catch (err) {
            sendRouteError(res, err, 'agent-memory-delete');
        }
    });

    return router;
}

export default createAgentOsRouter();
