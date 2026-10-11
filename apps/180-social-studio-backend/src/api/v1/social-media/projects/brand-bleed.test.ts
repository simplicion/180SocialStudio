/**
 * Brand bleed: Project A's brand, assets (media index), calendar piece, connected account, memory, agent runs and
 * Director context never reach Project B (same company) or Project C (other company). Also exercises the Social OS
 * routes (run inspector, media index/search, memory) over real HTTP. In-memory stand-ins only (no DATABASE_URL).
 *
 * Run: npx tsx --test --test-force-exit apps/backend/src/api/v1/social-media/projects/brand-bleed.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';
import { getProjectBrandConsciousness, applyProjectBrandPatch, parseBrandPatch } from '../../../../../../../packages/domains/social-media/src/brand-consciousness';
import { AgentMemoryService, requireSocialProject } from '../../../../../../../packages/domains/social-media/src/agent-os/agent-memory';
import { MediaIndexService } from '../../../../../../../packages/domains/social-media/src/agent-os/media-index';
import { PublishDispatcher } from '../../../../../../../packages/domains/social-media/src/publishing/publish-dispatcher';
import { setPublishingDb } from '../../../../../../../packages/domains/social-media/src/publishing/http';
import { InMemoryAgentEventStore, createAgentRunEmitter } from '../../../../../../../packages/domains/ai/src/agent-runs/agent-events';
import { VideoAIDirectorService } from '../../../../../../../packages/domains/ai/src/builders/video-ai-director.service';
import { MobileAIDirectRequestSchema } from '@workspace/video-contracts';
import { loadDirectorContext, toBrandContext, DirectorContextDeps } from '../../media-editor/director-context';
import { createAgentOsRouter } from './agent-os.routes';

const SECRET = 'ACMESECRET';

function matches(row: any, where: any): boolean {
    return Object.entries(where || {}).every(([k, v]) => {
        if (v && typeof v === 'object' && !Array.isArray(v) && 'in' in (v as any)) return (v as any).in.includes(row[k]);
        return (row[k] ?? null) === v;
    });
}
function model(rows: any[] = []) {
    let n = 0;
    return {
        rows,
        findFirst: async (a: any) => rows.find((r) => matches(r, a?.where)) ?? null,
        findMany: async (a: any) => rows.filter((r) => matches(r, a?.where)).slice(0, a?.take ?? 10000),
        create: async (a: any) => { const row = { id: `id${++n}`, createdAt: new Date(), updatedAt: new Date(), ...a.data }; rows.push(row); return row; },
        update: async (a: any) => { const row = rows.find((r) => r.id === a.where.id); Object.assign(row, a.data); return row; },
        updateMany: async (a: any) => { const hit = rows.filter((r) => matches(r, a.where)); hit.forEach((r) => Object.assign(r, a.data)); return { count: hit.length }; },
        deleteMany: async (a: any) => { const before = rows.length; for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], a.where)) rows.splice(i, 1); return { count: before - rows.length }; },
    };
}

async function world() {
    const db: any = {
        project: model([
            { id: 'pA', companyId: 'co1', name: `${SECRET} Coffee`, projectType: 'social_media', deletedAt: null },
            { id: 'pB', companyId: 'co1', name: 'Bolt Gym', projectType: 'social_media', deletedAt: null },
            { id: 'pC', companyId: 'co2', name: 'Other Co', projectType: 'social_media', deletedAt: null },
        ]),
        brandVoiceProfile: model(),
        agentMemory: model(),
        mediaIndexEntry: model(),
        socialAccount: model([{ id: 'accA', companyId: 'co1', projectId: 'pA', platform: 'instagram', isActive: true, username: `${SECRET}_ig` }]),
        calendarContentPiece: model([{ id: 'pieceA', companyId: 'co1', headline: `${SECRET} launch`, platform: 'instagram', videoScriptOrHooks: JSON.stringify({ hook: `${SECRET} hook` }), calendar: { id: 'calA', projectId: 'pA', companyId: 'co1' } }]),
        socialPost: model([{ id: 'postA', companyId: 'co1', projectId: 'pA', title: `${SECRET} post`, calendarPieceId: 'pieceA' }]),
    };
    await applyProjectBrandPatch('pA', 'co1', parseBrandPatch({ brandName: `${SECRET} Brand`, positioning: `${SECRET} positioning`, colors: { primary: '#123456' }, tone: 'warm', restrictions: { forbiddenTopics: [`${SECRET} topic`] }, autonomy: { editing: 'AUTO' } }), db);
    await applyProjectBrandPatch('pB', 'co1', parseBrandPatch({ brandName: 'Bolt', positioning: 'Gym for busy people', colors: { primary: '#FF0000' } }), db);
    const memory = new AgentMemoryService(db);
    await memory.rememberPreferencesFrom('pA', 'co1', 'less zoom');
    await memory.recordFeedback('pA', 'co1', { accepted: false, summary: `${SECRET} rejected idea` });
    const media = new MediaIndexService(db);
    await media.upsert('pA', 'co1', [{ assetId: 'assetA', kind: 'transcript', text: `${SECRET} espresso roasting secrets`, startMs: 0 }]);
    const events = new InMemoryAgentEventStore();
    const run = createAgentRunEmitter({ store: events, agent: 'director', scope: { companyId: 'co1', projectId: 'pA' } });
    run.emit('AgentStarted', { note: SECRET });
    run.emit('TimelineChanged', { final: true });
    await run.flush();
    const directorDeps: DirectorContextDeps = {
        findPost: (id, companyId) => db.socialPost.findFirst({ where: { id, companyId } }),
        findPiece: async (id, companyId) => db.calendarContentPiece.rows.find((p: any) => p.id === id && p.companyId === companyId) ?? null,
        getBrand: (projectId, companyId) => getProjectBrandConsciousness(projectId, companyId, db),
    };
    return { db, memory, media, events, runId: run.runId, directorDeps };
}

const noSecret = (label: string, value: unknown) => assert.ok(!JSON.stringify(value ?? null).includes(SECRET), `${label} leaked project A data`);

test('brand bleed: nothing of project A reaches project B (same company) or company 2', async () => {
    const w = await world();

    // Brand
    noSecret('brand B', await getProjectBrandConsciousness('pB', 'co1', w.db));
    await assert.rejects(getProjectBrandConsciousness('pA', 'co2', w.db), (e: any) => e.status === 404);

    // Memory
    noSecret('memory B', await w.memory.buildMemoryContext('pB', 'co1', 'director'));
    noSecret('memory B strategist', await w.memory.buildMemoryContext('pB', 'co1', 'strategist'));
    assert.ok((await w.memory.buildMemoryContext('pA', 'co1', 'director')).join(' ').includes('fewer, subtler zooms'), 'A still has its own memory');
    await assert.rejects(w.memory.list('pA', 'co2'), (e: any) => e.statusCode === 404);

    // Assets (media index)
    assert.deepEqual((await w.media.search('pB', 'co1', { query: `${SECRET} espresso` })).results, []);
    assert.equal((await w.media.search('pA', 'co1', { query: 'espresso' })).results.length, 1);

    // Calendar piece / post of A requested for B: skipped, and B's brand is used.
    const ctxB = await loadDirectorContext({ companyId: 'co1', projectId: 'pB', calendarPieceId: 'pieceA' }, w.directorDeps);
    noSecret('director context (piece)', ctxB);
    assert.equal(ctxB.brand?.name, 'Bolt');
    assert.ok(ctxB.warnings.some((x) => /another project/.test(x)));
    const ctxPost = await loadDirectorContext({ companyId: 'co1', projectId: 'pB', postId: 'postA' }, w.directorDeps);
    noSecret('director context (post)', ctxPost);
    const ctxC = await loadDirectorContext({ companyId: 'co2', projectId: 'pC', calendarPieceId: 'pieceA' }, w.directorDeps);
    noSecret('director context (company 2)', ctxC);

    // Director turn for B: neither the prompt nor the response carries A's data; B's autonomy (default) applies.
    const prompts: string[] = [];
    const client: any = {
        provider: 'claude',
        generateWithTools: async (p: string) => { prompts.push(p); return { text: '', toolCalls: [{ id: 't1', name: 'removeSilences', args: {} }, { id: 't2', name: 'finish_edit', args: { summary: 'ok' } }] }; },
    };
    const words = 'so here is the thing about the gym'.split(' ').map((t, i) => ({ text: t, startMs: 1000 + i * 400, endMs: 1300 + i * 400 }));
    const res = await VideoAIDirectorService.getInstance().directMobile(
        MobileAIDirectRequestSchema.parse({ prompt: 'remove the pauses', projectId: 'pB', media: { durationMs: 6000, width: 1080, height: 1920, transcript: { words } } }),
        { llmClient: client, context: ctxB, memoryContext: await w.memory.buildMemoryContext('pB', 'co1', 'director') },
    );
    noSecret('director prompt', prompts);
    noSecret('director response', res);
    assert.equal(res.autoApplied, false, "A's AUTO autonomy does not apply to B");
    assert.equal(toBrandContext(await getProjectBrandConsciousness('pA', 'co1', w.db), 'pA').autonomy?.editing, 'AUTO');

    // Accounts: B's post cannot publish through A's account, even when the variant names it explicitly.
    setPublishingDb(w.db);
    try {
        await assert.rejects(
            PublishDispatcher.resolveAccount({ id: 'postB', companyId: 'co1', projectId: 'pB' }, { socialAccountId: 'accA', platform: 'instagram' }, 'instagram' as any),
            (e: any) => e.code === 'ACCOUNT_NOT_CONNECTED',
        );
        await assert.rejects(PublishDispatcher.resolveAccount({ id: 'postB', companyId: 'co1', projectId: 'pB' }, { platform: 'instagram' }, 'instagram' as any), (e: any) => e.code === 'ACCOUNT_NOT_CONNECTED');
        const ok = await PublishDispatcher.resolveAccount({ id: 'postA2', companyId: 'co1', projectId: 'pA' }, { socialAccountId: 'accA', platform: 'instagram' }, 'instagram' as any);
        assert.equal(ok.id, 'accA');
    } finally {
        setPublishingDb(null);
    }

    // Agent runs
    assert.deepEqual(await w.events.listRuns({ companyId: 'co1', projectId: 'pB' }, 10), []);
    assert.deepEqual(await w.events.listEvents({ companyId: 'co1', projectId: 'pB' }, w.runId), []);
});

// ─── Routes over HTTP ────────────────────────────────────────────────────────────────────────────

async function server(w: Awaited<ReturnType<typeof world>>, user: { companyId?: string } | null) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { if (user) (req as any).user = user; next(); });
    app.use('/projects/:id', createAgentOsRouter(() => ({ db: w.db, eventStore: w.events, memory: w.memory, mediaIndex: w.media, requireProject: requireSocialProject })));
    const s = http.createServer(app);
    await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
    const port = (s.address() as AddressInfo).port;
    const call = (method: string, path: string, body?: unknown) =>
        new Promise<{ status: number; json: any }>((resolve, reject) => {
            const data = body === undefined ? undefined : JSON.stringify(body);
            const r = http.request({ host: '127.0.0.1', port, path, method, headers: { 'content-type': 'application/json', ...(data ? { 'content-length': Buffer.byteLength(data) } : {}) } }, (res) => {
                let buf = '';
                res.on('data', (c) => (buf += c));
                res.on('end', () => resolve({ status: res.statusCode || 0, json: buf ? JSON.parse(buf) : null }));
            });
            r.on('error', reject);
            if (data) r.write(data);
            r.end();
        });
    return { call, close: () => new Promise<void>((r) => s.close(() => r())) };
}

test('routes: run inspector, media index/search and memory are project-scoped over HTTP', async () => {
    const w = await world();
    const a = await server(w, { companyId: 'co1' });
    try {
        const runs = await a.call('GET', '/projects/pA/agent-runs?limit=5');
        assert.equal(runs.status, 200);
        assert.equal(runs.json.runs[0].runId, w.runId);
        assert.equal(runs.json.runs[0].status, 'completed');
        const detail = await a.call('GET', `/projects/pA/agent-runs/${w.runId}`);
        assert.equal(detail.status, 200);
        assert.deepEqual(Object.keys(detail.json.events[0]).sort(), ['id', 'payload', 'runId', 'ts', 'type']);
        assert.equal((await a.call('GET', `/projects/pB/agent-runs/${w.runId}`)).status, 404, "A's run is not visible from B");
        assert.deepEqual((await a.call('GET', '/projects/pB/agent-runs')).json.runs, []);

        const up = await a.call('POST', '/projects/pB/media-index', [{ assetId: 'b1', kind: 'scene', text: 'kettlebell swing in a garage gym', startMs: 0, endMs: 3000 }]);
        assert.deepEqual(up.json, { success: true, created: 1, updated: 0 });
        const bad = await a.call('POST', '/projects/pB/media-index', [{ assetId: 'b1', kind: 'video', text: 'x' }]);
        assert.equal(bad.status, 400);
        const found = await a.call('POST', '/projects/pB/media-search', { query: 'kettlebell gym', limit: 3 });
        assert.equal(found.json.results[0].assetId, 'b1');
        assert.deepEqual((await a.call('POST', '/projects/pB/media-search', { query: 'espresso' })).json.results, []);

        const fb = await a.call('POST', '/projects/pB/agent-memory/feedback', { accepted: false, summary: 'too many zooms', note: 'smaller captions' });
        assert.equal(fb.status, 201);
        const prefs = await a.call('POST', '/projects/pB/agent-memory/preferences', { text: 'less b-roll' });
        assert.deepEqual(prefs.json.remembered.map((p: any) => p.key), ['broll']);
        const list = await a.call('GET', '/projects/pB/agent-memory?kind=preference');
        assert.deepEqual(list.json.items.map((i: any) => i.key).sort(), ['broll', 'captions.size']);
        noSecret('memory list B', list.json);
        assert.equal((await a.call('DELETE', `/projects/pA/agent-memory/${list.json.items[0].id}`)).status, 404, 'cannot delete B memory through A');
        assert.equal((await a.call('DELETE', `/projects/pB/agent-memory/${list.json.items[0].id}`)).status, 200);
    } finally {
        await a.close();
    }

    const other = await server(w, { companyId: 'co2' });
    try {
        for (const [m, p, b] of [['GET', '/projects/pA/agent-runs'], ['POST', '/projects/pA/media-search', { query: 'espresso' }], ['GET', '/projects/pA/agent-memory']] as const) {
            const r = await other.call(m, p, b);
            assert.equal(r.status, 404, `${m} ${p}`);
            assert.equal(r.json.code, 'PROJECT_NOT_FOUND');
        }
    } finally {
        await other.close();
    }
    const anon = await server(w, null);
    try {
        assert.equal((await anon.call('GET', '/projects/pA/agent-runs')).status, 401);
    } finally {
        await anon.close();
    }
});
