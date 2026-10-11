/**
 * Run: npx tsx --test --test-force-exit apps/backend/src/api/v1/social-media/autopilot/autopilot.test.ts
 *
 * Autopilot multi-agent calendar (WS2). A fake LLM plays each agent from the prompt it receives, and an
 * in-memory database implements just the Prisma calls the service makes. No network, no real keys.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'net';
import http from 'node:http';
import { AutopilotCalendarService, AutopilotServiceDeps } from '../../../../../../../packages/domains/social-media/src/autopilot-calendar.service';
import {
    AutopilotError, AutopilotLLM, LlmRequest, HOOK_TYPES, runJsonAgent, StrategySchema, enforceBrandRules, buildBrandContext,
    readAutopilotPayload, expandAutopilotFields, zonedTimeToUtc, WebSearchProvider,
} from '../../../../../../../packages/domains/ai/src/content/autopilot';
import { aiProviderService } from '../../../../../../../packages/domains/ai/src/kernel/ai-provider.service';
import { createAutopilotRouter } from './autopilot.routes';

// ------------------------------------------------------------------ in-memory db

function getPath(obj: any, path: string[]) {
    return path.reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function matches(row: any, where: any): boolean {
    return Object.entries(where || {}).every(([k, cond]: [string, any]) => {
        if (cond && typeof cond === 'object' && Array.isArray(cond.path)) return getPath(row[k], cond.path) === cond.equals;
        return (row[k] ?? null) === cond;
    });
}
let seq = 0;
function fakeDb(seed: { projects: any[]; accounts?: any[] }) {
    const tables: Record<string, any[]> = {
        project: seed.projects, socialAccount: seed.accounts || [], contentCalendar: [], calendarContentPiece: [], socialPost: [], socialPostVariant: [],
    };
    const clone = (v: any) => JSON.parse(JSON.stringify(v));
    const model = (name: string) => ({
        findFirst: async (a: any) => { const r = tables[name].find((x) => matches(x, a.where)); return r ? clone(r) : null; },
        findMany: async (a: any) => tables[name].filter((x) => matches(x, a.where)).map(clone),
        create: async (a: any) => { const row = { id: `${name}-${++seq}`, ...clone(a.data) }; tables[name].push(row); return clone(row); },
        createMany: async (a: any) => { for (const d of a.data) tables[name].push({ id: `${name}-${++seq}`, ...clone(d) }); return { count: a.data.length }; },
        updateMany: async (a: any) => {
            let count = 0;
            for (const r of tables[name]) if (matches(r, a.where)) { Object.assign(r, clone(a.data)); count++; }
            return { count };
        },
    });
    return { tables, db: Object.fromEntries(Object.keys(tables).map((k) => [k, model(k)])) };
}

// ------------------------------------------------------------------ fake LLM

const FORMAT_PLATFORMS: Record<string, string[]> = { reel: ['instagram', 'tiktok'], carousel: ['instagram', 'linkedin'], text: ['linkedin', 'x'], static: ['instagram'] };
const FORMATS = ['reel', 'carousel', 'text', 'reel', 'static'];

function jsonAfter(prompt: string, marker: string) {
    const lines = prompt.split('\n');
    const i = lines.findIndex((l) => l.trim() === marker);
    return JSON.parse(lines[i + 1]);
}

function strategyFor(days: number) {
    const pillars = [{ name: 'Brewing craft', percent: 40, purpose: 'teach' }, { name: 'Origin stories', percent: 35, purpose: 'trust' }, { name: 'Community', percent: 25, purpose: 'belonging' }];
    const slots = Array.from({ length: days }, (_, i) => {
        const format = FORMATS[i % FORMATS.length];
        return { day: i + 1, platforms: FORMAT_PLATFORMS[format], format, pillar: pillars[i % 3].name, topic: `Topic ${i + 1}`, angle: `Angle ${i + 1}`, hookType: HOOK_TYPES[i % 5] };
    });
    return {
        audiencePsychology: { coreDesires: ['cafe-quality coffee at home'], corePains: ['bitter brews'], objections: ['too fiddly'], triggers: ['morning ritual'] },
        positioningAngle: 'Specialty coffee without the snobbery',
        pillars,
        cadence: [{ platform: 'instagram', postsPerWeek: 5, bestFormats: ['reel', 'carousel'] }],
        contentMix: { reel: 40, carousel: 20, static: 20, text: 20 },
        slots,
    };
}

interface FakeOptions {
    days?: number;
    failRole?: string;           // throw on this role
    invalidRole?: string;        // return garbage for this role (every time)
    invalidOnceRole?: string;    // garbage once, then valid
    criticFix?: boolean;
}

function fakeLlm(opts: FakeOptions = {}) {
    const calls: LlmRequest[] = [];
    const onceUsed = new Set<string>();
    const llm: AutopilotLLM = {
        provider: 'fake',
        async complete(req) {
            calls.push(req);
            const reply = (text: string) => ({ text, model: 'fake-1', usage: { inputTokens: Math.ceil(req.prompt.length / 4), outputTokens: Math.ceil(text.length / 4), estimated: false } });
            const role = req.role === 'regenerate' ? (req.prompt.includes('Slots:') ? 'hook_script' : 'copy') : req.role;
            if (opts.failRole === role) throw new AutopilotError('AI_PROVIDER_ERROR', 'provider down');
            if (opts.invalidRole === role) return reply('sorry, I cannot do JSON today');
            if (opts.invalidOnceRole === role && !onceUsed.has(role)) { onceUsed.add(role); return reply('{"not":"valid"}'); }

            if (role === 'strategist') return reply('```json\n' + JSON.stringify(strategyFor(opts.days || 30)) + '\n```');
            if (role === 'hook_script') {
                const slots = jsonAfter(req.prompt, 'Slots:');
                return reply(JSON.stringify({ items: slots.map((s: any) => ({
                    slotId: s.slotId,
                    headline: `${s.topic} headline${req.role === 'regenerate' ? ' v2' : ''}`,
                    hookType: s.hookType,
                    spokenHook: 'Stop buying cheap beans today',
                    onScreenHook: 'Your beans are lying',
                    ...(s.format === 'reel' ? {
                        script: { hook: 'Stop buying cheap beans today', body: [{ beat: 'Here is why freshness matters', retentionDevice: 'open loop' }, { beat: 'Grind right before brewing' }, { beat: 'Weigh your water' }], retentionLoop: 'But the third tip matters most', cta: 'Follow for tip three', estimatedDurationSec: 35 },
                        shotNotes: ['Close-up of beans', 'Pour-over in slow motion', 'Cut to the scale'],
                    } : {}),
                    ...(s.format === 'carousel' ? { carouselBrief: { title: 'Five brew fixes', slides: [
                        { index: 1, role: 'hook', headline: 'Bitter coffee?' }, { index: 2, role: 'value', headline: 'Grind finer' }, { index: 3, role: 'value', headline: 'Cooler water' }, { index: 4, role: 'cta', headline: 'Save this' },
                    ] } } : {}),
                    ...(s.format === 'static' ? { visualBrief: 'Flat lay of a V60' } : {}),
                })) }));
            }
            if (role === 'copy') {
                const pieces = jsonAfter(req.prompt, 'Pieces:');
                return reply(JSON.stringify({ items: pieces.map((p: any) => ({
                    slotId: p.slotId,
                    copies: p.platforms.map((pl: string) => ({
                        platform: pl,
                        caption: `${p.headline}. No cheap shortcuts, just better coffee for ${pl}.`,
                        cta: 'Save this for tomorrow',
                        hashtags: ['#coffee', 'cheap', '#pourover', '#homebarista', '#coffee', '#specialtycoffee', '#brewguide', '#v60', '#morning'],
                        postingTime: '18:30',
                    })),
                })) }));
            }
            if (role === 'critic') {
                const pieces = jsonAfter(req.prompt, 'Pieces:');
                return reply(JSON.stringify({ items: pieces.map((p: any) => opts.criticFix
                    ? { slotId: p.slotId, verdict: 'fixed', issues: ['tone too salesy'], fixes: [{ platform: Object.keys(p.captions)[0], caption: 'Rewritten calm caption about better coffee.' }] }
                    : { slotId: p.slotId, verdict: 'ok', issues: [] }) }));
            }
            if (role === 'research') return reply(JSON.stringify({ trends: [{ topic: 'Cold brew season', whyNow: 'searches up', sourceUrls: ['https://news.example.com/cold-brew'] }] }));
            throw new Error(`unexpected role ${req.role}`);
        },
    };
    return { llm, calls };
}

// ------------------------------------------------------------------ fixtures

const PROJECT = { id: 'p1', companyId: 'co-1', projectType: 'social_media', deletedAt: null, name: 'Acme Coffee', description: 'Specialty coffee roaster', socialSettings: { defaultTimezone: 'Asia/Kolkata' } };
const OTHER = { id: 'p2', companyId: 'co-2', projectType: 'social_media', deletedAt: null, name: 'Other Co', socialSettings: {} };
const BRAND = {
    brandType: 'company', brandPositioning: 'Specialty coffee without the snobbery', tone: 'Warm, witty', targetAudience: 'Home baristas',
    forbiddenWords: ['cheap', 'guarantee'], defaultHashtags: ['#acmecoffee'], standardCtas: ['Shop the roast'], targetPlatforms: ['instagram', 'tiktok', 'linkedin', 'twitter'],
};

function setup(opts: FakeOptions & { search?: WebSearchProvider | null; noKey?: boolean; now?: Date; hold?: boolean } = {}) {
    const { db, tables } = fakeDb({ projects: [{ ...PROJECT }, { ...OTHER }], accounts: [{ id: 'a1', companyId: 'co-1', projectId: 'p1', platform: 'instagram', isActive: true }] });
    const { llm, calls } = fakeLlm(opts);
    const jobs: Promise<void>[] = [];
    const events: any[] = [];
    let now = opts.now || new Date('2026-09-25T06:00:00Z');
    const deps: AutopilotServiceDeps = {
        db,
        createLLM: async () => {
            if (opts.noKey) throw new AutopilotError('AI_NOT_CONFIGURED', 'No usable AI provider key');
            return llm;
        },
        loadBrand: async (projectId, companyId) => {
            if (!tables.project.find((p) => p.id === projectId && p.companyId === companyId)) throw new Error('not found');
            return { profile: BRAND };
        },
        search: opts.search ?? null,
        schedule: (job) => { if (!opts.hold) jobs.push(job()); },
        now: () => now,
        log: (event, data) => events.push({ event, ...data }),
    };
    return { service: new AutopilotCalendarService(deps), tables, calls, jobs, events, setNow: (d: Date) => { now = d; } };
}

const start = (s: AutopilotCalendarService, body: any = {}, companyId = 'co-1', projectId = 'p1') =>
    s.start({ companyId, userId: 'u1', projectId, body: { days: 30, startDate: '2026-10-01', ...body } });

/** Minimal HTTP client (node:http, no keep-alive) - avoids a Windows libuv crash with fetch + --test-force-exit. */
function httpJson(method: string, url: string, body?: unknown): Promise<{ status: number; json: () => Promise<any> }> {
    return new Promise((resolve, reject) => {
        const data = body === undefined ? undefined : JSON.stringify(body);
        const req = http.request(url, { method, agent: false, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} }, (res) => {
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

// ------------------------------------------------------------------ tests

test('full 30-day pipeline: valid pieces, all 5 hook types, scripts for reels, carousel briefs, copy per platform', async () => {
    const env = setup();
    const { jobId, calendarId, status } = await start(env.service, { createDrafts: true });
    assert.equal(status, 'queued');
    assert.match(jobId, /^apj_/);
    await Promise.all(env.jobs);

    const job = await env.service.getJob({ companyId: 'co-1', projectId: 'p1', jobId });
    assert.equal(job.status, 'completed', JSON.stringify(job.error));
    assert.equal(job.progress, 100);
    assert.equal(job.stage, 'done');
    assert.equal(job.totalPieces, 30);
    assert.equal(job.researchUsed, false);

    const cal = env.tables.contentCalendar.find((c) => c.id === calendarId);
    assert.equal(cal.status, 'active');
    assert.equal(cal.projectId, 'p1');
    assert.deepEqual(cal.contentPillars, ['Brewing craft', 'Origin stories', 'Community']);
    assert.equal(cal.metadata.autopilot.research.researchUsed, false);
    assert.ok(cal.metadata.autopilot.usage.calls >= 16, 'strategist + 5 hook + 5 copy + 5 critic calls');

    const rows = env.tables.calendarContentPiece.filter((p) => p.calendarId === calendarId);
    assert.equal(rows.length, 30);
    const hookTypes = new Set<string>();
    for (const row of rows) {
        assert.equal(row.companyId, 'co-1');
        const a = readAutopilotPayload(row)!;
        assert.ok(a, 'autopilot payload stored');
        hookTypes.add(a.hookType);
        assert.ok(a.spokenHook && a.onScreenHook);
        for (const pl of a.platforms) {
            const c = a.captions[pl];
            assert.ok(c, `copy for ${pl}`);
            assert.match(c.postingTime, /^\d\d:\d\d$/);
        }
        if (a.format === 'reel') {
            assert.ok(a.script.hook && a.script.retentionLoop && a.script.cta && a.script.estimatedDurationSec > 0);
            assert.ok(a.shotNotes.length > 0);
            assert.ok(a.teleprompterScript, 'legacy drawer keys present');
        }
        if (a.format === 'carousel') assert.ok(a.carouselBrief.slides.length >= 3);
        assert.match(row.postingTimeTz, /^18:30 Asia\/Kolkata$/);
        const expanded: any = expandAutopilotFields(row);
        assert.equal(expanded.hookType, a.hookType);
        assert.equal(expanded.hasScript, a.format === 'reel');
    }
    assert.deepEqual([...hookTypes].sort(), [...HOOK_TYPES].sort());

    // Posting time is 18:30 in Asia/Kolkata (UTC+5:30) on the slot's date.
    const day1 = rows.find((r) => readAutopilotPayload(r)!.day === 1);
    assert.equal(new Date(day1.dateScheduled).toISOString(), '2026-10-01T13:00:00.000Z');

    // Drafts linked by calendarPieceId, one variant per platform, X mapped to "twitter".
    assert.equal(env.tables.socialPost.length, 30);
    for (const post of env.tables.socialPost) {
        assert.equal(post.status, 'draft');
        assert.equal(post.companyId, 'co-1');
        assert.ok(rows.some((r) => r.id === post.calendarPieceId));
    }
    assert.ok(env.tables.socialPostVariant.some((v) => v.platform === 'twitter'));
    assert.ok(!env.tables.socialPostVariant.some((v) => v.platform === 'x'));
});

test('critic removes forbidden words and hashtags, caps hashtags per platform, fits X to 280 chars', async () => {
    const env = setup({ days: 7 });
    const { jobId, calendarId } = await start(env.service, { days: 7 });
    await Promise.all(env.jobs);
    assert.equal((await env.service.getJob({ companyId: 'co-1', projectId: 'p1', jobId })).status, 'completed');
    const rows = env.tables.calendarContentPiece.filter((p) => p.calendarId === calendarId);
    assert.equal(rows.length, 7);
    for (const row of rows) {
        const a = readAutopilotPayload(row)!;
        const blob = JSON.stringify({ c: a.captions, h: a.spokenHook, s: a.script, head: row.headline, copy: row.adCopyFull });
        assert.doesNotMatch(blob, /\bcheap\b/i, 'forbidden word removed everywhere');
        for (const pl of a.platforms) {
            const c = a.captions[pl];
            const max = { instagram: 5, tiktok: 5, linkedin: 5, x: 2, facebook: 3, youtube: 3 }[pl as string]!;
            assert.ok(c.hashtags.length <= max, `${pl} hashtags capped`);
            assert.equal(c.hashtags[0], '#acmecoffee', 'brand hashtag first');
            assert.equal(new Set(c.hashtags.map((h: string) => h.toLowerCase())).size, c.hashtags.length, 'deduped');
            if (pl === 'x') assert.ok(`${c.caption}\n\n${c.hashtags.join(' ')}`.length <= 280);
        }
        assert.ok(a.critic.issues.some((i: string) => i.includes('forbidden')), 'critic records what it changed');
        assert.equal(a.critic.verdict, 'fixed');
    }
});

test('deterministic critic: forbidden words removed case-insensitively, whole words only; emptied fields are flagged', () => {
    const brand = buildBrandContext(BRAND, { brandName: 'Acme' });
    const piece: any = {
        slotId: 'd1-1', day: 1, date: '2026-10-01', weekNumber: 1, platforms: ['instagram'], primaryPlatform: 'instagram', format: 'static',
        pillar: 'x', topic: 't', angle: 'a', headline: 'We GUARANTEE great coffee', hookType: 'story', spokenHook: 'A guarantee story', onScreenHook: 'Guaranteed taste',
        captions: { instagram: { caption: 'Cheap? Never.', cta: 'Shop', hashtags: ['#Guarantee', 'coffee!'], postingTime: '09:00' } },
        timezone: 'UTC', sources: [], critic: { verdict: 'ok', issues: [] }, status: 'ready',
    };
    enforceBrandRules([piece], brand);
    assert.doesNotMatch(JSON.stringify(piece.captions) + piece.headline + piece.spokenHook, /cheap|guarantee/i);
    assert.deepEqual(piece.captions.instagram.hashtags, ['#acmecoffee', '#coffee']);
    assert.equal(piece.onScreenHook, 'Guaranteed taste', 'only whole words are removed');
    assert.equal(piece.status, 'ready');

    const emptied: any = { ...piece, slotId: 'd2-1', headline: 'Other', onScreenHook: 'Cheap', critic: { verdict: 'ok', issues: [] }, captions: { instagram: { caption: 'Fine caption', cta: 'Shop', hashtags: [], postingTime: '09:00' } } };
    enforceBrandRules([emptied], brand);
    assert.equal(emptied.status, 'needs_review');
});

test('duplicate pieces are flagged for review', () => {
    const brand = buildBrandContext({ ...BRAND, forbiddenWords: [] });
    const mk = (id: string): any => ({
        slotId: id, day: 1, date: '2026-10-01', weekNumber: 1, platforms: ['linkedin'], primaryPlatform: 'linkedin', format: 'text', pillar: 'p', topic: 't', angle: 'a',
        headline: 'Same headline', hookType: 'story', spokenHook: 'h', onScreenHook: 'h',
        captions: { linkedin: { caption: 'Same caption', cta: 'c', hashtags: [], postingTime: '09:00' } }, timezone: 'UTC', sources: [], critic: { verdict: 'ok', issues: [] }, status: 'ready',
    });
    const [a, b] = enforceBrandRules([mk('d1-1'), mk('d1-2')], brand);
    assert.equal(a.status, 'ready');
    assert.equal(b.status, 'needs_review');
    assert.ok(b.critic.issues.some((i: string) => i.startsWith('duplicate of d1-1')));
});

test('critic agent rewrite is applied to the stored caption', async () => {
    const env = setup({ days: 7, criticFix: true });
    const { calendarId } = await start(env.service, { days: 7 });
    await Promise.all(env.jobs);
    const row = env.tables.calendarContentPiece.find((p) => p.calendarId === calendarId);
    const a = readAutopilotPayload(row)!;
    assert.equal(a.captions[a.platforms[0]].caption, 'Rewritten calm caption about better coffee.');
    assert.ok(a.critic.issues.includes('tone too salesy'));
});

test('repair retry: invalid JSON once is repaired; the retry prompt includes the errors', async () => {
    const env = setup({ days: 7, invalidOnceRole: 'strategist' });
    const { jobId } = await start(env.service, { days: 7 });
    await Promise.all(env.jobs);
    assert.equal((await env.service.getJob({ companyId: 'co-1', projectId: 'p1', jobId })).status, 'completed');
    const strat = env.calls.filter((c) => c.role === 'strategist');
    assert.equal(strat.length, 2);
    assert.match(strat[1].prompt, /YOUR PREVIOUS REPLY WAS REJECTED/);
    assert.ok(env.events.some((e) => e.event === 'agent_repair' && e.role === 'strategist'));
});

test('runJsonAgent: second invalid reply raises AI_INVALID_OUTPUT (no canned fallback)', async () => {
    const { llm } = fakeLlm({ invalidRole: 'strategist' });
    await assert.rejects(
        runJsonAgent({ llm, role: 'strategist', system: 's', prompt: 'p', schema: StrategySchema, maxTokens: 100 }),
        (e: any) => e.code === 'AI_INVALID_OUTPUT' && e.statusCode === 502,
    );
});

test('job failure path: agent keeps returning garbage -> job failed, calendar failed, no pieces saved', async () => {
    const env = setup({ days: 7, invalidRole: 'hook_script' });
    const { jobId, calendarId } = await start(env.service, { days: 7 });
    await Promise.all(env.jobs);
    const job = await env.service.getJob({ companyId: 'co-1', projectId: 'p1', jobId });
    assert.equal(job.status, 'failed');
    assert.equal(job.error!.code, 'AI_INVALID_OUTPUT');
    assert.equal(env.tables.contentCalendar.find((c) => c.id === calendarId).status, 'failed');
    assert.equal(env.tables.calendarContentPiece.length, 0);
});

test('job failure path: provider error mid-run is recorded', async () => {
    const env = setup({ days: 7, failRole: 'copy' });
    const { jobId } = await start(env.service, { days: 7 });
    await Promise.all(env.jobs);
    const job = await env.service.getJob({ companyId: 'co-1', projectId: 'p1', jobId });
    assert.equal(job.status, 'failed');
    assert.equal(job.error!.code, 'AI_PROVIDER_ERROR');
});

test('stalled job (no heartbeat for 15 min) is reported as failed and a new run is allowed', async () => {
    const env = setup({ days: 7, hold: true });
    const { jobId } = await start(env.service, { days: 7 });
    // The job never runs: simulates a server restart after the job was queued.
    await assert.rejects(start(env.service, { days: 7 }), (e: any) => e.code === 'CONFLICT' && e.statusCode === 409);
    env.setNow(new Date('2026-09-25T06:20:00Z'));
    const job = await env.service.getJob({ companyId: 'co-1', projectId: 'p1', jobId });
    assert.equal(job.status, 'failed');
    assert.equal(job.error!.code, 'JOB_STALLED');
    await start(env.service, { days: 7 });
});

test('tenant isolation: another company cannot start, read or regenerate', async () => {
    const env = setup({ days: 7 });
    const { jobId, calendarId } = await start(env.service, { days: 7 });
    await Promise.all(env.jobs);
    const piece = env.tables.calendarContentPiece.find((p) => p.calendarId === calendarId);

    await assert.rejects(start(env.service, { days: 7 }, 'co-2', 'p1'), (e: any) => e.code === 'NOT_FOUND');
    await assert.rejects(env.service.getJob({ companyId: 'co-2', projectId: 'p1', jobId }), (e: any) => e.code === 'NOT_FOUND');
    await assert.rejects(env.service.getJob({ companyId: 'co-2', projectId: 'p2', jobId }), (e: any) => e.code === 'NOT_FOUND');
    await assert.rejects(env.service.getJob({ companyId: 'co-1', projectId: 'p-wrong', jobId }), (e: any) => e.code === 'NOT_FOUND');
    await assert.rejects(env.service.regeneratePiece({ companyId: 'co-2', projectId: 'p2', pieceId: piece.id, instruction: 'x' }), (e: any) => e.code === 'NOT_FOUND');
    assert.equal(env.tables.contentCalendar.filter((c) => c.companyId === 'co-2').length, 0);
});

test('missing AI key: 503 AI_NOT_CONFIGURED before anything is created', async () => {
    const env = setup({ noKey: true });
    await assert.rejects(start(env.service), (e: any) => e.code === 'AI_NOT_CONFIGURED' && e.statusCode === 503);
    assert.equal(env.tables.contentCalendar.length, 0);
    assert.equal(env.jobs.length, 0);
    // The platform provider returns no client for a provider without a key.
    assert.equal(await aiProviderService.getClient({ aiProvider: 'claude', claudeKey: '' }), null);
});

test('invalid input is rejected with 400', async () => {
    const env = setup();
    await assert.rejects(start(env.service, { days: 10 }), (e: any) => e.code === 'INVALID_INPUT' && e.statusCode === 400);
    await assert.rejects(start(env.service, { startDate: '01/10/2026' }), (e: any) => e.code === 'INVALID_INPUT');
    await assert.rejects(start(env.service, { platforms: ['myspace'] }), (e: any) => e.code === 'INVALID_INPUT');
    await assert.rejects(start(env.service, { goals: 'grow' as any, platforms: 'instagram' }), (e: any) => e.code === 'INVALID_INPUT');
});

test('regenerate one piece with an instruction updates the row and its draft post', async () => {
    const env = setup({ days: 7 });
    const { calendarId } = await start(env.service, { days: 7, createDrafts: true });
    await Promise.all(env.jobs);
    const row = env.tables.calendarContentPiece.find((p) => p.calendarId === calendarId);
    const res = await env.service.regeneratePiece({ companyId: 'co-1', projectId: 'p1', pieceId: row.id, instruction: 'Make it about cold brew' });
    assert.match(res.piece.headline as string, / v2$/);
    const regenCalls = env.calls.filter((c) => c.role === 'regenerate');
    assert.equal(regenCalls.length, 2, 'hook/script + copy');
    assert.ok(regenCalls.every((c) => c.prompt.includes('Make it about cold brew')));
    const post = env.tables.socialPost.find((p) => p.calendarPieceId === row.id);
    assert.match(post.title, / v2$/);
    await assert.rejects(env.service.regeneratePiece({ companyId: 'co-1', projectId: 'p1', pieceId: row.id, instruction: '  ' }), (e: any) => e.code === 'INVALID_INPUT');
});

test('research: uses search results and cites only returned URLs; no key -> researchUsed false', async () => {
    const search: WebSearchProvider = { name: 'fake', search: async () => [{ title: 'Cold brew', url: 'https://news.example.com/cold-brew', snippet: 'up' }] };
    const env = setup({ days: 7, search });
    const { jobId, calendarId } = await start(env.service, { days: 7 });
    await Promise.all(env.jobs);
    const job = await env.service.getJob({ companyId: 'co-1', projectId: 'p1', jobId });
    assert.equal(job.researchUsed, true);
    const cal = env.tables.contentCalendar.find((c) => c.id === calendarId);
    assert.deepEqual(cal.metadata.autopilot.research.trends[0].sourceUrls, ['https://news.example.com/cold-brew']);

    const failing: WebSearchProvider = { name: 'down', search: async () => { throw new Error('HTTP 500'); } };
    const env2 = setup({ days: 7, search: failing });
    const r2 = await start(env2.service, { days: 7 });
    await Promise.all(env2.jobs);
    const j2 = await env2.service.getJob({ companyId: 'co-1', projectId: 'p1', jobId: r2.jobId });
    assert.equal(j2.status, 'completed');
    assert.equal(j2.researchUsed, false);
    assert.match(env2.tables.contentCalendar[0].metadata.autopilot.research.error, /HTTP 500/);
});

test('zonedTimeToUtc handles DST (America/New_York)', () => {
    assert.equal(zonedTimeToUtc('2026-07-01', '09:00', 'America/New_York').toISOString(), '2026-07-01T13:00:00.000Z');
    assert.equal(zonedTimeToUtc('2026-12-01', '09:00', 'America/New_York').toISOString(), '2026-12-01T14:00:00.000Z');
});

test('HTTP routes: 202 start, 200 job, 503 when AI is not configured, 404 across tenants', async () => {
    const env = setup({ days: 7 });
    const noKey = setup({ noKey: true });
    const mk = (service: AutopilotCalendarService, companyId: string) => {
        const app = express();
        app.use(express.json());
        app.use((req: any, _res, next) => { req.user = { id: 'u1', companyId }; next(); });
        app.use('/projects/:id/autopilot', createAutopilotRouter(() => service));
        return new Promise<{ url: string; close: () => Promise<void> }>((resolve) => {
            const srv = app.listen(0, () => resolve({
                url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`,
                close: () => new Promise<void>((done) => { srv.closeAllConnections(); srv.close(() => done()); }),
            }));
        });
    };
    const a = await mk(env.service, 'co-1');
    const b = await mk(noKey.service, 'co-1');
    const c = await mk(env.service, 'co-2');
    try {
        const post = (base: string, body: any) => httpJson('POST', `${base}/projects/p1/autopilot/calendar`, body);
        const r1 = await post(a.url, { days: 7, startDate: '2026-10-01' });
        assert.equal(r1.status, 202);
        const j1: any = await r1.json();
        assert.ok(j1.jobId && j1.calendarId);
        await Promise.all(env.jobs);
        const r2 = await httpJson('GET', `${a.url}/projects/p1/autopilot/jobs/${j1.jobId}`);
        assert.equal(r2.status, 200);
        assert.equal(((await r2.json()) as any).status, 'completed');

        const r3 = await post(b.url, { days: 7 });
        assert.equal(r3.status, 503);
        assert.equal(((await r3.json()) as any).code, 'AI_NOT_CONFIGURED');

        const r4 = await httpJson('GET', `${c.url}/projects/p1/autopilot/jobs/${j1.jobId}`);
        assert.equal(r4.status, 404);
        const r5 = await post(a.url, { days: 3 });
        assert.equal(r5.status, 400);
    } finally {
        await Promise.all([a.close(), b.close(), c.close()]);
    }
});

test('budget: the estimate bounds what a 30-day run really calls, per agent; cost only when prices are configured', async () => {
    const env = setup();
    const est = await env.service.estimate({ companyId: 'co-1', projectId: 'p1', body: { days: 30 } as any });
    assert.equal(est.budget.pieces, 30);
    assert.equal(est.pricesConfigured, false);
    assert.equal(est.outputCeilingUsd, null);
    await assert.rejects(env.service.estimate({ companyId: 'co-2', projectId: 'p1', body: { days: 30 } as any }), (e: any) => e.code === 'NOT_FOUND');
    await assert.rejects(env.service.estimate({ companyId: 'co-1', projectId: 'p1', body: { days: 9 } as any }), (e: any) => e.code === 'INVALID_INPUT');

    const { calendarId } = await start(env.service, {});
    await Promise.all(env.jobs);
    const usage = env.tables.contentCalendar.find((c) => c.id === calendarId).metadata.autopilot.usage;
    assert.equal(usage.cost, null, 'no price configured -> no money figure');
    const by = (agent: string) => est.budget.agents.find((a: any) => a.agent === agent)!;
    // Mandatory agents: the run makes exactly the estimated calls when every reply is valid first time.
    for (const [agent, role] of [['strategist', 'strategist'], ['hook_script', 'hook_script'], ['copy', 'copy'], ['critic', 'critic']] as const) {
        assert.equal(usage.byRole[role].calls, by(agent).calls, `${agent} calls`);
        assert.ok(usage.byRole[role].outputTokens <= by(agent).maxOutputTokens, `${agent} output within its ceiling`);
    }
    // Conditional agents never exceed their bound.
    assert.ok((usage.byRole.hook_lab?.calls || 0) <= by('hook_lab').calls * 2);
    assert.ok((usage.byRole.craft?.calls || 0) <= by('craft').calls * 2);
    assert.ok(usage.calls <= est.budget.worstCaseCalls);

    const { priceUsage, estimateAutopilotBudget } = await import('@workspace/ai/content/autopilot');
    assert.deepEqual(priceUsage({ inputTokens: 2_000_000, outputTokens: 1_000_000 }, { AUTOPILOT_PRICE_INPUT_PER_MTOK_USD: '3', AUTOPILOT_PRICE_OUTPUT_PER_MTOK_USD: '15' } as any)!.totalUsd, 21);
    assert.equal(priceUsage({ inputTokens: 1, outputTokens: 1 }, {} as any), null);
    const off = estimateAutopilotBudget({ days: 7, platforms: ['instagram', 'x'] }, { rewritesEnabled: false, craftMaxFixCalls: 3 });
    assert.equal(off.agents.find((a) => a.agent === 'hook_lab')!.calls + off.agents.find((a) => a.agent === 'craft')!.calls, 0);
});
