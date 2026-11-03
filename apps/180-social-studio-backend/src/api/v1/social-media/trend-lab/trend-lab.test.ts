/**
 * Trend Lab service + routes. Run: npx tsx --test --test-force-exit apps/180-social-studio-backend/src/api/v1/social-media/trend-lab/trend-lab.test.ts
 * In-memory DB, fake research runner and a role-by-role fake LLM: these test tenancy, limits, job lifecycles and
 * that the script runs through the calendar agents with the research attached.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import type { AutopilotLLM } from '@workspace/ai/content/autopilot';
import type { TrendResearchReport, ReportCluster } from '@workspace/ai/research';
import { TrendLabService, TrendLabDeps } from '../../../../../../../packages/domains/social-media/src/trend-lab/trend-lab.service';
import { createTrendLabRouter } from './trend-lab.routes';

type Row = Record<string, any>;

function matches(row: Row, where: Row = {}): boolean {
    return Object.entries(where).every(([k, v]) => {
        if (v && typeof v === 'object' && !(v instanceof Date) && 'gte' in v) return new Date(row[k]) >= new Date(v.gte);
        return row[k] === v;
    });
}

function fakeDb(seed: { projects: Row[] }) {
    const tables: Record<string, Row[]> = { project: seed.projects, trendReport: [], contentCalendar: [], calendarContentPiece: [] };
    const model = (name: string) => ({
        findFirst: async ({ where, include }: any) => {
            const r = tables[name].find((x) => matches(x, where));
            if (!r) return null;
            if (include?.calendar) return { ...r, calendar: tables.contentCalendar.find((c) => c.id === r.calendarId) || null };
            return { ...r };
        },
        findMany: async ({ where }: any = {}) => tables[name].filter((x) => matches(x, where)).map((x) => ({ ...x })),
        count: async ({ where }: any) => tables[name].filter((x) => matches(x, where)).length,
        create: async ({ data }: any) => { const r = { createdAt: new Date(), ...data }; tables[name].push(r); return { ...r }; },
        updateMany: async ({ where, data }: any) => { let n = 0; for (const r of tables[name]) if (matches(r, where)) { Object.assign(r, data); n++; } return { count: n }; },
    });
    return { tables, project: model('project'), trendReport: model('trendReport'), contentCalendar: model('contentCalendar'), calendarContentPiece: model('calendarContentPiece') };
}

const PROJECT = { id: 'p1', companyId: 'co-1', projectType: 'social_media', deletedAt: null, name: 'Strong After 40', description: 'fitness coaching', socialSettings: { defaultTimezone: 'Asia/Kolkata' } };
const OTHER = { id: 'p2', companyId: 'co-2', projectType: 'social_media', deletedAt: null, name: 'Other', socialSettings: {} };

function cluster(): ReportCluster {
    return {
        id: 'c1', title: 'Creatine for women over 40', summary: 's', whyNow: 'A wave of posts this week', audienceQuestions: ['Does it cause bloating?'], brandFit: 'strong', brandFitReason: 'fits',
        metrics: { volume: { reddit: 3 }, totalItems: 3, engagementIndex: 70, momentum: 2, momentumLabel: 'rising', saturation: { youtubeUploads30d: 100, youtubeMedianViews: 1000, youtubeSampled: 3, label: 'low' }, sentiment: { positive: 50, negative: 25, mixed: 25, neutral: 0, n: 4 }, brandFit: 85, opportunityScore: 77, confidence: 70, verdict: 'create_now', verdictReasons: [] },
        items: [{ id: 'p1', source: 'reddit', url: 'https://www.reddit.com/r/x/1', title: 't', publishedAt: '2026-11-01', engagement: { primary: 800, views: null, upvotes: 800, likes: null, comments: 90 } }],
        reactionQuotes: [{ quote: 'the bloating went away after a week', source: 'reddit', url: 'https://www.reddit.com/r/x/1' }],
        angles: [{ id: 'c1-a1', title: 'The bloating myth', tension: 'Women fear the scale going up', draftHook: 'Creatine bloat is a week-one problem', format: 'reel', hookScore: 70, hookGrade: 'STRONG' }],
    };
}

const REPORT: TrendResearchReport = {
    topic: 'creatine', windowDays: 30, generatedAt: '2026-11-03T00:00:00Z', plan: { intent: 'concept', searchQueries: ['creatine women'], rankingQuestion: 'q', hashtags: [], anchors: [] },
    clusters: [cluster()], statuses: [{ agent: 'social_pulse', source: 'reddit', status: 'ok', items: 3 }], outlook: { available: false, basedOnPosts: 0, byFormat: [], note: '' }, sources: [], methodology: [],
};

function fakeLlm(provider = 'fake'): AutopilotLLM {
    const after = (p: string, m: string) => { const l = p.split('\n'); return JSON.parse(l[l.findIndex((x) => x.trim() === m) + 1]); };
    return {
        provider,
        async complete(req) {
            const reply = (v: unknown) => ({ text: JSON.stringify(v), model: 'fake', usage: { inputTokens: 1, outputTokens: 1, estimated: false } });
            const role = req.role === 'regenerate' ? (req.prompt.includes('Slots:') ? 'hook_script' : 'copy') : req.role;
            if (role === 'hook_script') return reply({ items: after(req.prompt, 'Slots:').map((s: any) => ({
                slotId: s.slotId, headline: 'Bloating myth', hookType: s.hookType, spokenHook: 'Your creatine bloat ends in week two', onScreenHook: 'CREATINE BLOAT?',
                script: { hook: 'Your creatine bloat ends in week two', body: [{ beat: 'Water moves into muscle first' }, { beat: 'Most women feel it for 7 days' }, { beat: 'Then the strength shows up' }], retentionLoop: 'Week two is where creatine pays off', cta: 'DM START', estimatedDurationSec: 30 },
                shotNotes: ['Talking head', 'Gym b-roll', 'Scoop close-up'],
            })) });
            if (role === 'copy') return reply({ items: after(req.prompt, 'Pieces:').map((p: any) => ({ slotId: p.slotId, copies: p.platforms.map((pl: string) => ({ platform: pl, caption: 'Creatine bloat is real for a week. Here is what happens next.', cta: 'DM START', hashtags: ['#creatine'], postingTime: '18:30' })) })) });
            if (role === 'critic') return reply({ items: after(req.prompt, 'Pieces:').map((p: any) => ({ slotId: p.slotId, verdict: 'ok', issues: [] })) });
            throw new Error(`unexpected role ${req.role}`);
        },
    };
}

function setup(over: Partial<TrendLabDeps> = {}) {
    const db = fakeDb({ projects: [PROJECT, OTHER] });
    const jobs: (() => Promise<void>)[] = [];
    const stages: string[] = [];
    let researchCalls = 0;
    const svc = new TrendLabService({
        db,
        createLLM: async () => fakeLlm(),
        loadBrand: async () => ({ profile: { brandPositioning: 'strength for 40+', targetAudience: 'women 40+', tone: 'direct' } }),
        research: async (call) => { researchCalls++; await call.onStage?.('analyst', 75, 'reading'); await call.onStage?.('done', 100); return REPORT; },
        schedule: (job) => { jobs.push(job); },
        now: () => new Date(),
        log: (e) => { stages.push(e); },
        dailyReportLimit: 3,
        ...over,
    });
    const drain = async () => { while (jobs.length) await jobs.shift()!(); };
    return { svc, db, drain, stages, researchCalls: () => researchCalls };
}

const ctx = { companyId: 'co-1', projectId: 'p1', userId: 'u1' };

test('start validates input, scopes by tenant, and enforces the daily limit', async () => {
    const env = setup();
    await assert.rejects(env.svc.start({ ...ctx, body: {} }), (e: any) => e.code === 'INVALID_INPUT');
    await assert.rejects(env.svc.start({ companyId: 'co-1', projectId: 'p2', userId: 'u', body: { topic: 'creatine' } }), (e: any) => e.statusCode === 404);
    for (let i = 0; i < 3; i++) await env.svc.start({ ...ctx, body: { topic: `topic ${i}` } });
    await assert.rejects(env.svc.start({ ...ctx, body: { topic: 'one more' } }), (e: any) => e.statusCode === 429);
    const off = setup({ research: null });
    await assert.rejects(off.svc.start({ ...ctx, body: { topic: 'creatine' } }), (e: any) => e.code === 'RESEARCH_NOT_CONFIGURED' && e.statusCode === 503);
});

test('report job: queued -> running -> done with the report; other companies cannot read it', async () => {
    const env = setup();
    const { reportId } = await env.svc.start({ ...ctx, body: { topic: '  creatine   for women ' } });
    assert.equal((await env.svc.get({ ...ctx, reportId })).status, 'queued');
    await env.drain();
    const v = await env.svc.get({ ...ctx, reportId });
    assert.equal(v.status, 'done');
    assert.equal(v.topic, 'creatine for women');
    assert.equal(v.report!.clusters[0].metrics.opportunityScore, 77);
    assert.equal((await env.svc.list(ctx)).reports[0].topTrend!.verdict, 'create_now');
    await assert.rejects(env.svc.get({ companyId: 'co-2', projectId: 'p1', reportId }), (e: any) => e.statusCode === 404);
});

test('report job never uses the canned engine and records failures on the row', async () => {
    const env = setup({ createLLM: async () => fakeLlm('builtin') });
    const { reportId } = await env.svc.start({ ...ctx, body: { topic: 'creatine' } });
    await env.drain();
    const v = await env.svc.get({ ...ctx, reportId });
    assert.equal(v.status, 'failed');
    assert.equal(v.error!.code, 'AI_NOT_CONFIGURED');
    assert.equal(env.researchCalls(), 0);
});

test('a job with no heartbeat for 10 minutes is reported as stalled', async () => {
    const env = setup();
    const { reportId } = await env.svc.start({ ...ctx, body: { topic: 'creatine' } });
    env.db.tables.trendReport[0].heartbeatAt = new Date(Date.now() - 11 * 60 * 1000);
    const v = await env.svc.get({ ...ctx, reportId });
    assert.equal(v.status, 'failed');
    assert.equal(v.error!.code, 'JOB_STALLED');
});

test('create script: validates, runs the calendar agents, saves in the Trend Lab calendar with the research attached', async () => {
    const env = setup();
    const { reportId } = await env.svc.start({ ...ctx, body: { topic: 'creatine' } });
    await assert.rejects(env.svc.createScript({ ...ctx, reportId, body: { clusterId: 'c1', format: 'video', platforms: ['instagram'] } }), (e: any) => e.statusCode === 409);
    await env.drain();
    await assert.rejects(env.svc.createScript({ ...ctx, reportId, body: { clusterId: 'nope', format: 'video', platforms: ['instagram'] } }), (e: any) => e.code === 'INVALID_INPUT');
    await assert.rejects(env.svc.createScript({ ...ctx, reportId, body: { clusterId: 'c1', format: 'gif', platforms: ['instagram'] } }), (e: any) => e.code === 'INVALID_INPUT');
    await assert.rejects(env.svc.createScript({ ...ctx, reportId, body: { clusterId: 'c1', format: 'video', platforms: ['instagram'], durationSec: 600 } }), (e: any) => e.code === 'INVALID_INPUT');
    await assert.rejects(env.svc.createScript({ ...ctx, reportId, body: { clusterId: 'c1', format: 'video', platforms: ['instagram'], mood: 'angry' } }), (e: any) => e.code === 'INVALID_INPUT');

    const job = await env.svc.createScript({ ...ctx, reportId, body: { clusterId: 'c1', angleId: 'c1-a1', format: 'video', platforms: ['instagram'], durationSec: 45, mood: 'storytelling', notes: 'mention my 12-week plan' } });
    assert.equal((await env.svc.getScript({ ...ctx, pieceId: job.pieceId })).status, 'generating');
    await env.drain();
    const s = await env.svc.getScript({ ...ctx, pieceId: job.pieceId });
    assert.equal(s.status, 'done');
    const piece: any = s.piece;
    assert.equal(piece.trend.title, 'Creatine for women over 40');
    assert.equal(piece.trend.signal, 'rising · opportunity 77/100 · 3 posts');
    assert.equal(piece.mood, 'storytelling');
    assert.deepEqual(piece.sources, ['https://www.reddit.com/r/x/1']);
    assert.ok(piece.spokenHook && piece.script);
    // One Trend Lab calendar per project, reused across scripts.
    await env.svc.createScript({ ...ctx, reportId, body: { clusterId: 'c1', format: 'text', platforms: ['linkedin'] } });
    await env.drain();
    assert.equal(env.db.tables.contentCalendar.filter((c) => c.name === 'Trend Lab').length, 1);
    await assert.rejects(env.svc.getScript({ companyId: 'co-2', projectId: 'p1', pieceId: job.pieceId }), (e: any) => e.statusCode === 404);
});

test('a script for a format no selected platform supports fails cleanly on the row', async () => {
    const env = setup();
    const { reportId } = await env.svc.start({ ...ctx, body: { topic: 'creatine' } });
    await env.drain();
    const job = await env.svc.createScript({ ...ctx, reportId, body: { clusterId: 'c1', format: 'text', platforms: ['youtube'] } });
    await env.drain();
    const s = await env.svc.getScript({ ...ctx, pieceId: job.pieceId });
    assert.equal(s.status, 'failed');
    assert.equal(s.error!.code, 'INVALID_INPUT');
});

/** node:http with agent:false (no pooled sockets), as in autopilot.test.ts: global fetch keeps sockets alive past the test. */
function httpJson(method: string, url: string, headers: Record<string, string> = {}, body?: unknown): Promise<{ status: number; json: () => Promise<any> }> {
    return new Promise((resolve, reject) => {
        const data = body === undefined ? undefined : JSON.stringify(body);
        const req = http.request(url, { method, agent: false, headers: { ...headers, ...(data ? { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(data)) } : {}) } }, (res) => {
            let text = '';
            res.setEncoding('utf8');
            res.on('data', (c) => { text += c; });
            res.on('end', () => resolve({ status: res.statusCode || 0, json: async () => JSON.parse(text) }));
        });
        req.on('error', reject);
        if (data) req.write(data);
        req.end();
    });
}

test('routes: company context required, 202 on start, errors mapped', async () => {
    const env = setup();
    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => { if (req.headers['x-company']) req.user = { companyId: req.headers['x-company'], id: 'u1' }; next(); });
    app.use('/projects/:id/trend-lab', createTrendLabRouter(() => env.svc));
    const server = app.listen(0);
    const base = `http://127.0.0.1:${(server.address() as any).port}/projects/p1/trend-lab`;
    try {
        assert.equal((await httpJson('POST', `${base}/reports`)).status, 401);
        const ok = await httpJson('POST', `${base}/reports`, { 'x-company': 'co-1' }, { topic: 'creatine' });
        assert.equal(ok.status, 202);
        assert.ok((await ok.json()).reportId);
        const bad = await httpJson('POST', `${base}/reports`, { 'x-company': 'co-1' }, {});
        assert.equal(bad.status, 400);
        assert.equal((await bad.json()).code, 'INVALID_INPUT');
        const lanes = await (await httpJson('GET', `${base}/lanes`, { 'x-company': 'co-1' })).json();
        assert.equal(lanes.configured, true);
    } finally {
        // Keep-alive sockets from fetch would otherwise outlive the test.
        server.closeAllConnections();
        await new Promise((r) => server.close(r));
    }
});
