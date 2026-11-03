/**
 * Trend research engine. Run: npx tsx --test --test-force-exit packages/domains/ai/tests/trend-research.test.ts
 * Fakes stand in for the LLM, the trend-worker and the YouTube API; these test our logic and guards, not a model.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { AutopilotLLM } from '../src/content/autopilot/llm';
import {
    MemoryTrendCache, TrendWorkerClient, computeClusterMetrics, decideVerdict, fallbackPlan, groundAnalystOutput, mapPulseItem, momentum,
    onTopic, opportunityScore, performanceOutlook, runPlatformSignalAgent, runSocialPulseAgent, runTrendResearch, runWebNewsAgent,
    sourcePercentiles, toWorkerPlan, trendCacheKey,
} from '../src/research';
import type { QueryPlan, ResearchItem } from '../src/research';

const NOW = new Date('2026-11-03T12:00:00Z');
const plan: QueryPlan = { intent: 'concept', searchQueries: ['creatine women', 'creatine menopause'], rankingQuestion: 'What do women over 40 say about creatine?', hashtags: ['creatine'], anchors: [] };
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString().slice(0, 10);

function item(id: string, over: Partial<ResearchItem> = {}): ResearchItem {
    return {
        id, agent: 'social_pulse', source: 'reddit', url: `https://ex.example/${id}`, title: `title ${id}`, text: '', publishedAt: daysAgo(2),
        engagement: { primary: 10, views: null, upvotes: 10, likes: null, comments: 2 }, comments: [], ...over,
    };
}

function fakeLLM(byRole: Record<string, unknown | ((prompt: string) => unknown)>, calls: string[] = []): AutopilotLLM {
    return {
        provider: 'fake',
        async complete(req) {
            calls.push(req.role);
            const r = byRole[req.role];
            if (r === undefined) throw new Error(`no fake reply for ${req.role}`);
            const v = typeof r === 'function' ? (r as (p: string) => unknown)(req.prompt) : r;
            return { text: JSON.stringify(v), model: 'fake', usage: { inputTokens: 1, outputTokens: 1, estimated: true } };
        },
    };
}

// ------------------------------------------------------------------ planner

test('fallback plan turns a typed topic into keyword queries and hashtags', () => {
    const p = fallbackPlan({ topic: 'How to use Creatine for women over 40?', industry: 'online fitness coaching', audience: 'women 40+' });
    assert.equal(p.searchQueries[0], 'use creatine women over 40');
    assert.ok(p.hashtags.every((h) => /^[a-z0-9_]+$/.test(h)));
    const wp = toWorkerPlan(plan, ['hackernews', 'reddit']);
    assert.equal(wp.subqueries[0].label, 'primary');
    assert.equal(wp.subqueries[0].weight, 1);
    assert.deepEqual(wp.subqueries[1].sources, ['hackernews', 'reddit']);
    assert.equal(wp.freshness_mode, 'evergreen_ok');
});

// ------------------------------------------------------------------ agents

test('social pulse maps worker items, filters off-topic by anchors and reports per-source status', async () => {
    const worker = {
        pulse: async () => ({
            topic: 't', windowDays: 30, engine: 'last30days', warnings: [], clusters: [],
            sourceStatus: { hackernews: 'ok', polymarket: 'timeout', reddit: 'disabled' },
            items: [
                { source: 'hackernews', url: 'https://a.example/1', title: 'Loom raises prices for teams', text: '', publishedAt: '2026-10-30', engagement: { primary: 50, upvotes: 50, comments: 9, views: null, likes: null, volume: null }, relevance: 0.5, cluster: null, topComments: ['Switching away from Loom now'] },
                { source: 'hackernews', url: 'https://a.example/2', title: 'Ancient weaving looms in museum', text: '', publishedAt: null, engagement: { primary: 5, upvotes: 5, comments: 0, views: null, likes: null, volume: null }, relevance: 0.2, cluster: null, topComments: [] },
                { source: 'tiktok', url: 'https://a.example/3', title: 'unknown source', text: '', publishedAt: null, engagement: { primary: 1, upvotes: null, comments: null, views: null, likes: null, volume: null }, relevance: null, cluster: null, topComments: [] },
            ],
        }),
    } as unknown as TrendWorkerClient;
    const out = await runSocialPulseAgent({ worker, topic: 'loom', plan: { ...plan, anchors: ['loom raises', 'screen recording', 'switching away from loom'] }, days: 30 });
    assert.deepEqual(out.items.map((i) => i.url), ['https://a.example/1']);
    assert.deepEqual(out.items[0].comments, ['Switching away from Loom now']);
    const st = Object.fromEntries(out.statuses.map((s) => [s.source, s.status]));
    assert.deepEqual(st, { hackernews: 'ok', polymarket: 'error', reddit: 'skipped' });
    assert.equal(mapPulseItem({ ...({} as any), source: 'myspace', url: 'x', title: 'x', engagement: {} }, 1), null);
    assert.ok(onTopic('anything', []));

    const none = await runSocialPulseAgent({ worker: null, topic: 't', plan, days: 30 });
    assert.equal(none.statuses[0].status, 'skipped');
});

test('platform signal: YouTube via official API, saturation signal, comments, and no key leakage on errors', async () => {
    const urls: string[] = [];
    const fetchJson = async (url: string) => {
        urls.push(url);
        if (url.includes('/search?')) return { pageInfo: { totalResults: 4200 }, items: [{ id: { videoId: 'v1' } }, { id: { videoId: 'v2' } }] };
        if (url.includes('/videos?')) return { items: [
            { id: 'v1', snippet: { title: 'Creatine for women', publishedAt: `${daysAgo(3)}T10:00:00Z` }, statistics: { viewCount: '90000', likeCount: '3000', commentCount: '400' } },
            { id: 'v2', snippet: { title: 'Creatine myths', publishedAt: `${daysAgo(20)}T10:00:00Z` }, statistics: { viewCount: '10000' } },
        ] };
        if (url.includes('videoId=v1')) return { items: [{ snippet: { topLevelComment: { snippet: { textDisplay: 'I started at 45 and my energy is way better.' } } } }] };
        throw new Error('HTTP 403 (commentsDisabled)');
    };
    const out = await runPlatformSignalAgent({ plan, days: 30, deps: { youtubeApiKey: 'SECRET_KEY', fetchJson } });
    assert.equal(out.items.length, 2);
    assert.equal(out.items[0].engagement.views, 90000);
    assert.deepEqual(out.items[0].comments, ['I started at 45 and my energy is way better.']);
    assert.equal(out.signals?.youtubeUploads30d, 4200);
    assert.equal(out.signals?.youtubeMedianViews, 50000);
    assert.ok(urls[0].includes('order=viewCount') && urls[0].includes('publishedAfter='));
    assert.equal(out.statuses.find((s) => s.source === 'instagram')?.status, 'skipped');

    const broken = await runPlatformSignalAgent({ plan, days: 30, deps: { youtubeApiKey: 'SECRET_KEY', fetchJson: async () => { throw new Error('HTTP 403 (quotaExceeded)'); } } });
    const yt = broken.statuses.find((s) => s.source === 'youtube')!;
    assert.equal(yt.status, 'error');
    assert.ok(!JSON.stringify(broken).includes('SECRET_KEY'));

    const noKey = await runPlatformSignalAgent({ plan, days: 30, deps: {} });
    assert.equal(noKey.statuses.find((s) => s.source === 'youtube')?.status, 'skipped');
});

test('platform signal: Instagram hashtag media from the injected official-API reader, windowed', async () => {
    const out = await runPlatformSignalAgent({ plan, days: 30, deps: {
        instagramHashtagTopMedia: async () => [
            { permalink: 'https://instagram.com/p/1', caption: 'Creatine changed my 40s\nmore text', timestamp: `${daysAgo(4)}T00:00:00+0000`, likes: 1200, comments: 80 },
            { permalink: 'https://instagram.com/p/old', caption: 'old', timestamp: `${daysAgo(90)}T00:00:00+0000`, likes: 1, comments: 0 },
        ],
    } });
    const ig = out.items.filter((i) => i.source === 'instagram');
    assert.equal(ig.length, 1);
    assert.equal(ig[0].title, 'Creatine changed my 40s');
    assert.equal(ig[0].engagement.primary, 1280);
});

test('web & news attaches fetched full text and survives a worker failure', async () => {
    const search = { name: 'fake', search: async (q: string) => [
        { title: `Article ${q}`, url: `https://news.example/${encodeURIComponent(q)}`, snippet: 'snip', publishedAt: '2026-10-29' },
        { title: 'Same', url: 'https://news.example/creatine%20women', snippet: 'dup', publishedAt: 'x' },
    ] };
    const worker = { fetchPages: async (urls: string[]) => ({ pages: urls.map((u) => ({ url: u, ok: true, markdown: `FULL ${u}`, title: '', error: null, finalUrl: u, status: 200, truncated: false })) }) } as unknown as TrendWorkerClient;
    const out = await runWebNewsAgent({ search, worker, plan, days: 30 });
    assert.equal(out.items.length, 2);
    assert.ok(out.items[0].fullText?.startsWith('FULL '));
    assert.equal(out.items[0].publishedAt, '2026-10-29');

    const badWorker = { fetchPages: async () => { throw new Error('down'); } } as unknown as TrendWorkerClient;
    const out2 = await runWebNewsAgent({ search, worker: badWorker, plan, days: 30 });
    assert.equal(out2.items.length, 2);
    assert.ok(out2.statuses.some((s) => s.status === 'error'));
    assert.equal((await runWebNewsAgent({ search: null, worker, plan, days: 30 })).statuses[0].status, 'skipped');
});

// ------------------------------------------------------------------ metrics

test('engagement percentiles never compare across platforms', () => {
    const items = [
        item('r1', { source: 'reddit', engagement: { primary: 10, views: null, upvotes: 10, likes: null, comments: 0 } }),
        item('r2', { source: 'reddit', engagement: { primary: 900, views: null, upvotes: 900, likes: null, comments: 0 } }),
        item('y1', { source: 'youtube', engagement: { primary: 50_000, views: 50_000, upvotes: null, likes: null, comments: 0 } }),
        item('y2', { source: 'youtube', engagement: { primary: 2_000_000, views: 2_000_000, upvotes: null, likes: null, comments: 0 } }),
        item('w1', { source: 'web', engagement: { primary: null, views: null, upvotes: null, likes: null, comments: null } }),
    ];
    const p = sourcePercentiles(items);
    assert.equal(p.get('r2'), 100);
    assert.equal(p.get('y1'), 0);
    assert.equal(p.has('w1'), false);
});

test('momentum is count-based, needs evidence on both sides, and labels rising/cooling', () => {
    const rising = [0, 1, 2, 3, 4, 10, 20].map((d, i) => item(`m${i}`, { publishedAt: daysAgo(d) }));
    const m = momentum(rising, NOW, 30);
    assert.equal(m.label, 'rising');
    assert.ok((m.ratio as number) > 1.5);
    assert.equal(momentum([item('a', { publishedAt: daysAgo(1) })], NOW, 30).label, 'unknown');
    assert.equal(momentum(rising, NOW, 7).label, 'unknown');
    // 2 posts in the last 7 days (0.29/day) vs 16 in the 23 days before (0.70/day): ratio 0.41.
    const cooling = [1, 2, ...Array.from({ length: 16 }, (_, k) => 8 + k)].map((d, i) => item(`c${i}`, { publishedAt: daysAgo(d) }));
    assert.equal(momentum(cooling, NOW, 30).label, 'cooling');
});

test('opportunity formula and verdict rules', () => {
    assert.equal(opportunityScore({ engagementIndex: 100, momentumLabel: 'rising', saturationLabel: 'low', brandFit: 85 }), 35 + 23 + 12 + 21);
    const cluster = Array.from({ length: 12 }, (_, i) => item(`v${i}`, { source: (['reddit', 'youtube', 'hackernews'] as const)[i % 3], publishedAt: daysAgo(i < 6 ? 1 : 20) }));
    const pct = sourcePercentiles(cluster);
    const strong = computeClusterMetrics({ cluster, percentiles: pct, saturation: { youtubeUploads30d: 120 }, sentimentLabels: ['positive', 'negative'], brandFit: 'strong', now: NOW, windowDays: 30 });
    assert.equal(strong.confidence, 100);
    assert.equal(strong.saturation.label, 'low');
    assert.equal(strong.sentiment.n, 2);
    const weak = computeClusterMetrics({ cluster, percentiles: pct, saturation: undefined, sentimentLabels: [], brandFit: 'weak', now: NOW, windowDays: 30 });
    assert.equal(weak.verdict, 'skip');
    const thin = decideVerdict({ ...strong, confidence: 10 }, 'strong');
    assert.equal(thin.verdict, 'wait');
    assert.equal(decideVerdict({ ...strong, opportunityScore: 80, saturation: { ...strong.saturation, label: 'low' } }, 'strong').verdict, 'create_now');
    assert.equal(decideVerdict({ ...strong, opportunityScore: 80, saturation: { ...strong.saturation, label: 'high' } }, 'strong').verdict, 'sharpen_angle');
});

test('performance outlook needs 10 posts and 5 per format', () => {
    assert.equal(performanceOutlook(Array.from({ length: 9 }, () => ({ format: 'reel', multiple: 2 }))).available, false);
    const o = performanceOutlook([...Array.from({ length: 6 }, () => ({ format: 'reel', multiple: 1.6 })), ...Array.from({ length: 4 }, () => ({ format: 'carousel', multiple: 0.5 }))]);
    assert.equal(o.available, true);
    assert.deepEqual(o.byFormat.map((f) => [f.format, f.label]), [['reel', 'above']]);
});

// ------------------------------------------------------------------ analyst grounding

test('analyst grounding drops invented quotes and unknown ids, accepts NFKC-equivalent quotes', () => {
    const items = [item('p1', { title: 'Creatine ﬁxed my afternoon slump', comments: ['Honestly the bloating was real for week one'] })];
    const out = groundAnalystOutput({
        clusters: [{
            id: 'c1', title: 'Creatine energy', summary: 'People report energy gains.', whyNow: 'New posts this week.', itemIds: ['p1', 'ghost'], audienceQuestions: [],
            reactionQuotes: [
                { itemId: 'p1', quote: 'creatine fixed my afternoon slump' },
                { itemId: 'p1', quote: 'the bloating was real' },
                { itemId: 'p1', quote: '9 out of 10 women love it' },
                { itemId: 'ghost', quote: 'anything' },
            ],
            angles: [{ title: 'a', tension: 'tension here', draftHook: 'Your slump is not about coffee', format: 'reel' }], brandFit: 'strong', brandFitReason: 'fits',
        }],
        sentiment: [{ id: 'p1#1', label: 'mixed' }, { id: 'p9#1', label: 'positive' }],
        offTopicItemIds: [],
    }, items);
    assert.deepEqual(out.value.clusters[0].itemIds, ['p1']);
    assert.deepEqual(out.value.clusters[0].reactionQuotes.map((q) => q.quote), ['creatine fixed my afternoon slump', 'the bloating was real']);
    assert.deepEqual(out.value.sentiment.map((s) => s.id), ['p1#1']);
    assert.ok(out.problems.some((p) => p.includes('not verbatim')));
});

// ------------------------------------------------------------------ orchestrator

function analystReply(prompt: string) {
    // The fake analyst cites the evidence ids it was shown and quotes the HN comment verbatim, attributed to that item.
    const ids = Array.from(prompt.matchAll(/^\[([a-z]\d+)\]/gm)).map((m) => m[1]);
    const hnId = /^\[([a-z]\d+)\] hackernews/m.exec(prompt)?.[1] ?? ids[0];
    return {
        clusters: [{
            id: 'c1', title: 'Creatine for midlife energy', summary: 'Women over 40 discuss creatine for energy and strength.', whyNow: 'A wave of posts this week.',
            itemIds: ids.slice(0, 3), audienceQuestions: ['Does creatine cause bloating?'],
            reactionQuotes: [{ itemId: hnId, quote: 'my energy is way better' }],
            angles: [{ title: 'The bloating myth', tension: 'Fear of water weight', draftHook: 'Creatine bloating is a week-one problem', format: 'reel' }],
            brandFit: 'strong', brandFitReason: 'Directly serves women 40+ who lift.',
        }],
        sentiment: ids.slice(0, 2).map((id) => ({ id, label: 'positive' })),
        offTopicItemIds: [],
    };
}

function fixtureDeps(calls: { pulse: number }) {
    const worker = {
        pulse: async () => {
            calls.pulse++;
            return { topic: 't', windowDays: 30, engine: 'last30days', warnings: [], clusters: [], sourceStatus: { hackernews: 'ok' }, items: [
                { source: 'hackernews', url: 'https://hn.example/1', title: 'Creatine and women over 40', text: '', publishedAt: daysAgo(1), engagement: { primary: 120, upvotes: 120, comments: 30, views: null, likes: null, volume: null }, relevance: 0.6, cluster: null, topComments: ['I started at 45 and my energy is way better.'] },
            ] };
        },
        fetchPages: async () => ({ pages: [] }),
    } as unknown as TrendWorkerClient;
    const fetchJson = async (url: string) => {
        if (url.includes('/search?')) return { pageInfo: { totalResults: 150 }, items: [{ id: { videoId: 'v1' } }] };
        if (url.includes('/videos?')) return { items: [{ id: 'v1', snippet: { title: 'Creatine at 40', publishedAt: `${daysAgo(2)}T00:00:00Z` }, statistics: { viewCount: '50000' } }] };
        return { items: [] };
    };
    return { worker, fetchJson };
}

test('orchestrator: plan -> 3 agents -> grounded analyst -> code-computed metrics; cached rerun skips gathering', async () => {
    const calls = { pulse: 0 };
    const roles: string[] = [];
    const { worker, fetchJson } = fixtureDeps(calls);
    const llm = fakeLLM({ query_planner: plan, trend_analyst: analystReply }, roles);
    const cache = new MemoryTrendCache();
    const stages: string[] = [];
    const deps = { llm, worker, search: null, platform: { youtubeApiKey: 'k', fetchJson }, cache, now: () => NOW, onStage: (s: string) => { stages.push(s); } };
    const input = { topic: 'creatine for women over 40', brand: { industry: 'fitness coaching', audience: 'women 40+', promptContext: 'Brand: Strong After 40' } };

    const report = await runTrendResearch(input, deps as any);
    assert.equal(report.clusters.length, 1);
    const c = report.clusters[0];
    assert.equal(c.reactionQuotes[0].source, 'hackernews');
    assert.equal(c.metrics.saturation.label, 'low');
    assert.equal(c.metrics.brandFit, 85);
    assert.ok(c.metrics.opportunityScore > 0 && c.metrics.opportunityScore <= 100);
    assert.ok(c.angles[0].hookScore > 0 && c.angles[0].id === 'c1-a1');
    assert.equal(report.outlook.available, false);
    assert.ok(report.methodology.length >= 5);
    assert.ok(report.sources.length >= 1);
    assert.deepEqual(roles, ['query_planner', 'trend_analyst']);
    assert.ok(stages.includes('analyst') && stages.at(-1) === 'done');

    await runTrendResearch(input, deps as any);
    assert.equal(calls.pulse, 1, 'second run must be served from the 24h cache');
});

test('orchestrator: a failing agent is reported, the rest still produce a report; no evidence = empty report', async () => {
    const llm = fakeLLM({ query_planner: plan, trend_analyst: analystReply });
    const worker = { pulse: async () => { throw new Error('worker down'); }, fetchPages: async () => ({ pages: [] }) } as unknown as TrendWorkerClient;
    const { fetchJson } = fixtureDeps({ pulse: 0 });
    const input = { topic: 'creatine', brand: { industry: 'fitness', audience: 'women', promptContext: 'Brand' } };
    const report = await runTrendResearch(input, { llm, worker, search: null, platform: { youtubeApiKey: 'k', fetchJson }, now: () => NOW });
    assert.ok(report.statuses.some((s) => s.agent === 'social_pulse' && s.status === 'error'));
    assert.equal(report.clusters.length, 1);

    const empty = await runTrendResearch(input, { llm, worker: null, search: null, platform: {}, now: () => NOW });
    assert.equal(empty.clusters.length, 0);
    await assert.rejects(runTrendResearch(input, { llm: null, worker: null, search: null, platform: {} }), /AI provider/);
});

test('cache key ignores order/case but separates lanes and windows', () => {
    const a = trendCacheKey({ searchQueries: ['Creatine Women'], hashtags: ['b', 'A'], days: 30, lanes: ['worker', 'youtube'] });
    assert.equal(a, trendCacheKey({ searchQueries: ['creatine women'], hashtags: ['a', 'b'], days: 30, lanes: ['youtube', 'worker'] }));
    assert.notEqual(a, trendCacheKey({ searchQueries: ['creatine women'], hashtags: ['a', 'b'], days: 7, lanes: ['youtube', 'worker'] }));
    assert.notEqual(a, trendCacheKey({ searchQueries: ['creatine women'], hashtags: ['a', 'b'], days: 30, lanes: ['worker'] }));
});

// ------------------------------------------------------------------ worker client

test('worker client retries transient failures once and never retries validation errors', async () => {
    let n = 0;
    const flaky = new TrendWorkerClient('http://w', 's', async () => { n++; return n === 1 ? { ok: false, status: 503, json: async () => ({}) } : { ok: true, status: 200, json: async () => ({ pages: [] }) }; });
    assert.deepEqual(await flaky.fetchPages(['https://a.example']), { pages: [] });
    assert.equal(n, 2);
    let m = 0;
    const strict = new TrendWorkerClient('http://w', 's', async () => { m++; return { ok: false, status: 422, json: async () => ({}) }; });
    await assert.rejects(strict.fetchPages(['x']), /HTTP 422/);
    assert.equal(m, 1);
});

test('platform signal: without an API key the connected channel token is used as a Bearer header', async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const fetchJson = async (url: string, headers: Record<string, string> = {}) => {
        seen.push({ url, headers });
        if (url.includes('/search?')) return { pageInfo: { totalResults: 50 }, items: [{ id: { videoId: 'v1' } }] };
        if (url.includes('/videos?')) return { items: [{ id: 'v1', snippet: { title: 'Creatine at 40', publishedAt: `${daysAgo(2)}T00:00:00Z` }, statistics: { viewCount: '1200' } }] };
        return { items: [] };
    };
    const out = await runPlatformSignalAgent({ plan, days: 30, deps: { youtubeAccessToken: async () => 'channel-token', fetchJson } });
    assert.equal(out.items.length, 1);
    assert.ok(seen.every((c) => c.headers.Authorization === 'Bearer channel-token' && !c.url.includes('key=')));
    assert.equal(out.statuses.find((s) => s.source === 'youtube')?.detail, 'via connected channel');

    const keyed: string[] = [];
    await runPlatformSignalAgent({ plan, days: 30, deps: { youtubeApiKey: 'K', youtubeAccessToken: async () => 'unused', fetchJson: async (url: string) => { keyed.push(url); return { items: [] }; } } });
    assert.ok(keyed[0].endsWith('&key=K'), 'an API key wins over the channel token');

    const none = await runPlatformSignalAgent({ plan, days: 30, deps: { youtubeAccessToken: async () => null } });
    assert.equal(none.statuses.find((s) => s.source === 'youtube')?.status, 'skipped');
});

test('free search: the worker provider maps results, and env picks paid key > worker > none', async () => {
    const { WorkerSearchProvider, createWebSearchProviderFromEnv } = await import('../src/content/autopilot/research');
    const calls: any[] = [];
    const worker = { search: async (p: any) => { calls.push(p); return { engines: ['ddgs'], warnings: [], results: [
        { title: 'Creatine for women', url: 'https://news.example/a', snippet: 's'.repeat(900), publishedAt: '2026-10-30', source: 'X', engine: 'ddgs' as const, kind: 'news' as const },
        { title: 'bad', url: 'javascript:alert(1)', snippet: '', publishedAt: null, source: '', engine: 'ddgs' as const, kind: 'web' as const },
        { title: 'Undated forum', url: 'https://forum.example/t', snippet: 'q', publishedAt: null, source: '', engine: 'ddgs' as const, kind: 'web' as const },
    ] }; } };
    const p = new WorkerSearchProvider(worker);
    const rows = await p.search('creatine women', { maxResults: 5, recencyDays: 7 });
    assert.deepEqual(calls[0], { queries: ['creatine women'], days: 7, maxResults: 5 });
    assert.deepEqual(rows.map((r) => r.url), ['https://news.example/a', 'https://forum.example/t']);
    assert.equal(rows[0].snippet.length, 500);
    assert.equal(rows[1].publishedAt, undefined);

    const w = { TREND_WORKER_URL: 'http://127.0.0.1:4010', TREND_WORKER_SECRET: 's' };
    assert.equal(createWebSearchProviderFromEnv({ ...w, TAVILY_API_KEY: 't' } as any)?.name, 'tavily');
    assert.equal(createWebSearchProviderFromEnv(w as any)?.name, 'open-web');
    assert.equal(createWebSearchProviderFromEnv({ ...w, TREND_WORKER_SEARCH: '0' } as any), null);
    assert.equal(createWebSearchProviderFromEnv({} as any), null);
});

test('worker client: search posts at most 3 queries to /search with the secret', async () => {
    const seen: any[] = [];
    const c = new TrendWorkerClient('http://w/', 'sek', async (url: string, init: any) => { seen.push({ url, init }); return { ok: true, status: 200, json: async () => ({ results: [], engines: [], warnings: [] }) }; });
    await c.search({ queries: ['a1', 'b2', 'c3', 'd4'] });
    assert.equal(seen[0].url, 'http://w/search');
    assert.equal(seen[0].init.headers['X-Worker-Secret'], 'sek');
    assert.deepEqual(JSON.parse(seen[0].init.body), { queries: ['a1', 'b2', 'c3'], days: 30, maxResults: 6 });
});
