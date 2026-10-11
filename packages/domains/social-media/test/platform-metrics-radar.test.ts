/**
 * Own-post metrics, outlier ranking, competitor radar and reply drafts. Provider calls and the DB are fakes; the
 * tests check what we send to each platform API, that only reported numbers are stored, and tenant scoping.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { MIN_POSTS_FOR_BASELINE, fetchPostMetrics, rankOwnPosts, refreshProjectPostMetrics, rememberPostPerformance } from '../src/platform-team/post-metrics';
import { cleanHandle, getRadar, rankAccount, scanRadar, setRadarHandles } from '../src/platform-team/competitor-radar';
import { PlatformTeamService } from '../src/platform-team/platform-team.service';
import { formatMemoryContext } from '../src/agent-os/agent-memory';

const NOW = new Date('2026-10-07T12:00:00Z');

function fetcher(routes: [RegExp, any | ((url: string) => any)][], calls: string[] = []) {
    return async (_platform: string, url: string) => {
        calls.push(url);
        const hit = routes.find(([re]) => re.test(url));
        if (!hit) throw Object.assign(new Error(`unexpected call ${url}`), { code: 'PROVIDER_ERROR' });
        const v = typeof hit[1] === 'function' ? hit[1](url) : hit[1];
        if (v instanceof Error) throw v;
        return v;
    };
}

// ------------------------------------------------------------------ fetchPostMetrics

test('Instagram: reads insights; falls back to the smaller metric set; missing metrics stay null', async () => {
    const calls: string[] = [];
    const m = await fetchPostMetrics(
        { platform: 'instagram', externalId: '179', token: 't', account: { platformAccountId: 'ig1' }, now: NOW },
        fetcher([[/metric=views/, new Error('(#100) metric views not supported')], [/metric=reach,saved,likes,comments/, { data: [{ name: 'reach', values: [{ value: 900 }] }, { name: 'likes', total_value: { value: 40 } }] }]], calls),
    );
    assert.equal(calls.length, 2);
    assert.deepEqual({ views: m.views, reach: m.reach, likes: m.likes, saves: m.saves, shares: m.shares }, { views: null, reach: 900, likes: 40, saves: null, shares: null });
    assert.equal(m.fetchedAt, NOW.toISOString());
});

test('YouTube, X and LinkedIn map their own fields; unsupported platforms are a typed error', async () => {
    const yt = await fetchPostMetrics({ platform: 'youtube', externalId: 'v1', token: 't', account: { platformAccountId: 'c' } }, fetcher([[/videos\?part=statistics&id=v1/, { items: [{ statistics: { viewCount: '1200', likeCount: '30', commentCount: '4' } }] }]]));
    assert.deepEqual([yt.views, yt.likes, yt.comments, yt.shares], [1200, 30, 4, null]);

    const x = await fetchPostMetrics({ platform: 'twitter', externalId: '55', token: 't', account: { platformAccountId: 'u' } }, fetcher([[/\/2\/tweets\/55\?tweet.fields=public_metrics/, { data: { public_metrics: { impression_count: 5000, like_count: 10, reply_count: 2, retweet_count: 3, quote_count: 1, bookmark_count: 7 } } }]]));
    assert.deepEqual([x.views, x.shares, x.saves], [5000, 4, 7]);

    const calls: string[] = [];
    const li = await fetchPostMetrics(
        { platform: 'linkedin', externalId: 'urn:li:share:9', token: 't', account: { platformAccountId: 'urn:li:organization:77' } },
        fetcher([[/socialActions\/urn%3Ali%3Ashare%3A9/, { likesSummary: { totalLikes: 12 }, commentsSummary: { aggregatedTotalComments: 3 } }], [/organizationalEntityShareStatistics/, { elements: [{ totalShareStatistics: { impressionCount: 800, uniqueImpressionsCount: 600, shareCount: 2, likeCount: 12, commentCount: 3 } }] }]], calls),
    );
    assert.deepEqual([li.views, li.reach, li.shares, li.likes], [800, 600, 2, 12]);
    assert.match(calls[1], /shares=List\(urn%3Ali%3Ashare%3A9\)/);
    const member = await fetchPostMetrics({ platform: 'linkedin', externalId: 'urn:li:share:9', token: 't', account: { platformAccountId: 'urn:li:person:1' } }, fetcher([[/socialActions/, { likesSummary: { totalLikes: 5 } }]]));
    assert.deepEqual([member.views, member.likes], [null, 5], 'member posts have no impression API; views stay null');

    await assert.rejects(fetchPostMetrics({ platform: 'pinterest', externalId: 'p', token: 't', account: { platformAccountId: 'a' } }, fetcher([])), (e: any) => e.code === 'PLATFORM_METRICS_UNAVAILABLE');
});

// ------------------------------------------------------------------ refresh + rank

function metricsDb(posts: any[], extra: Record<string, any> = {}) {
    const calls: { model: string; op: string; where: any; data?: any }[] = [];
    const memory: any[] = [];
    const db = {
        calls,
        memory,
        project: { findFirst: async (a: any) => { calls.push({ model: 'project', op: 'findFirst', where: a.where }); return a.where.companyId === 'c1' ? { id: 'p1', socialSettings: extra.socialSettings ?? {} } : null; }, updateMany: async (a: any) => { calls.push({ model: 'project', op: 'updateMany', where: a.where, data: a.data }); extra.socialSettings = a.data.socialSettings; return { count: 1 }; } },
        socialPost: { findMany: async (a: any) => { calls.push({ model: 'socialPost', op: 'findMany', where: a.where }); return posts; }, findFirst: async (a: any) => posts.find((p) => p.id === a.where.id) ?? null },
        socialAccount: { findFirst: async (a: any) => { calls.push({ model: 'socialAccount', op: 'findFirst', where: a.where }); return extra.account === null ? null : { id: 'a1', companyId: 'c1', platform: 'instagram', platformAccountId: 'ig1' }; } },
        socialPostVariant: { updateMany: async (a: any) => { calls.push({ model: 'socialPostVariant', op: 'updateMany', where: a.where, data: a.data }); for (const p of posts) for (const v of p.variants) if (v.id === a.where.id) v.platformMeta = a.data.platformMeta; return { count: 1 }; } },
        calendarContentPiece: { findFirst: async () => ({ pillar: 'Education', videoScriptOrHooks: JSON.stringify({ hookType: 'contrarian' }) }) },
        agentMemory: {
            findFirst: async (a: any) => memory.find((m) => m.key === a.where.key) ?? null,
            create: async (a: any) => { memory.push({ id: `m${memory.length}`, ...a.data }); return a.data; },
            updateMany: async (a: any) => { Object.assign(memory.find((m) => m.id === a.where.id), a.data); return { count: 1 }; },
        },
        socialConversation: { findFirst: async (a: any) => { calls.push({ model: 'socialConversation', op: 'findFirst', where: a.where }); return extra.conversation ?? null; }, findMany: async () => [], count: async () => 0 },
        socialMessage: { findMany: async () => extra.messages ?? [] },
    };
    return db;
}

const post = (id: string, views: number | null, over: any = {}) => ({
    id, title: `Post ${id}`, content: over.content ?? `Hook line for ${id}\nbody`, publishedAt: new Date('2026-10-01'), socialAccountId: 'a1', mediaType: 'video', calendarPieceId: 'piece1',
    variants: [{ id: `v${id}`, platform: 'instagram', externalId: over.externalId ?? `ext${id}`, publishStatus: 'published', externalUrl: `https://ig/${id}`, publishedAt: new Date('2026-10-01'), customContent: over.content,
        platformMeta: views === null ? (over.meta ?? {}) : { keep: 'me', metrics: { views, reach: null, likes: 10, comments: 2, shares: 1, saves: 3, fetchedAt: over.fetchedAt ?? '2026-10-07T11:00:00.000Z', source: 'live' } } }],
});

test('refresh: skips fresh and simulated posts, stores metrics next to existing meta, reports failures', async () => {
    const posts = [post('1', 100), post('2', null, { meta: { thread: true } }), post('3', null, { externalId: 'sim_abc' }), post('4', null)];
    const db = metricsDb(posts);
    const out = await refreshProjectPostMetrics(
        { companyId: 'c1', projectId: 'p1', platform: 'instagram', now: NOW },
        { db, getToken: async () => 'tok', fetchJson: fetcher([[/ext2\/insights\?metric=views/, { data: [{ name: 'views', total_value: { value: 700 } }] }], [/ext4/, new Error('(#10) permission denied')]]) },
    );
    assert.deepEqual({ checked: out.checked, updated: out.updated, skippedFresh: out.skippedFresh }, { checked: 2, updated: 1, skippedFresh: 1 });
    assert.match(out.failed[0].reason, /permission denied/);
    assert.deepEqual(posts[1].variants[0].platformMeta.thread, true, 'existing platformMeta is kept');
    assert.equal(posts[1].variants[0].platformMeta.metrics.views, 700);
    assert.deepEqual(posts[3].variants[0].platformMeta, {}, 'a failed read stores nothing');
    const scoped = db.calls.filter((c) => c.model === 'socialPost' || c.model === 'socialAccount' || c.model === 'project');
    assert.ok(scoped.every((c) => c.where.companyId === 'c1'));
    await assert.rejects(refreshProjectPostMetrics({ companyId: 'other', projectId: 'p1' }, { db }), (e: any) => e.statusCode === 404);
});

test('rank: needs a baseline of measured posts; then ranks by multiple of the median and names the basis', async () => {
    const few = await rankOwnPosts({ companyId: 'c1', projectId: 'p1', platform: 'instagram', now: NOW }, { db: metricsDb([post('1', 100), post('2', 200), post('3', null)]) });
    assert.equal(few.baseline, null);
    assert.equal(few.needsMore, MIN_POSTS_FOR_BASELINE - 2);
    assert.deepEqual(few.ranked, []);
    assert.equal(few.published, 3);

    const posts = [post('1', 100), post('2', 120), post('3', 90), post('4', 110), post('5', 800, { content: 'Nobody tells you your first 30 posts flop\nmore' })];
    const r = await rankOwnPosts({ companyId: 'c1', projectId: 'p1', platform: 'instagram', now: NOW }, { db: metricsDb(posts) });
    assert.equal(r.basis, 'views');
    assert.equal(r.baseline, 110);
    assert.equal(r.ranked[0].postId, '5');
    assert.equal(r.ranked[0].outlierMultiple, 7.3);
    assert.equal(r.outliers, 1);
    assert.equal(r.ranked[0].hook, 'Nobody tells you your first 30 posts flop');

    // No views or reach reported (e.g. LinkedIn member posts): falls back to engagements and says so.
    const noViews = posts.map((p) => ({ ...p, variants: p.variants.map((v: any) => ({ ...v, platformMeta: { metrics: { ...v.platformMeta.metrics, views: null } } })) }));
    assert.equal((await rankOwnPosts({ companyId: 'c1', projectId: 'p1', platform: 'instagram', now: NOW }, { db: metricsDb(noViews) })).basis, 'engagements');
});

test('performance memory: one row per post (upsert), and the strategist is told about outliers', async () => {
    const posts = [post('1', 100), post('2', 120), post('3', 90), post('4', 110), post('5', 800, { content: 'Nobody tells you your first 30 posts flop' })];
    const db = metricsDb(posts);
    const r = await rankOwnPosts({ companyId: 'c1', projectId: 'p1', platform: 'instagram', now: NOW }, { db });
    assert.equal(await rememberPostPerformance({ companyId: 'c1', projectId: 'p1', platform: 'instagram', ranked: r.ranked }, { db }), 5);
    await rememberPostPerformance({ companyId: 'c1', projectId: 'p1', platform: 'instagram', ranked: r.ranked }, { db });
    assert.equal(db.memory.length, 5, 'second run updates instead of duplicating');
    const lines = formatMemoryContext(db.memory.map((m) => ({ ...m, companyId: 'c1', projectId: 'p1' })) as any, 'strategist', 4000).join('\n');
    assert.match(lines, /7\.3x on instagram/);
    assert.match(lines, /Nobody tells you your first 30 posts flop/);
    assert.match(lines, /Performance history/);
});

// ------------------------------------------------------------------ competitor radar

test('radar: handles are validated, stored per project; unsupported platforms say why', async () => {
    assert.equal(cleanHandle('https://www.instagram.com/Some.Handle/?hl=en'), 'Some.Handle');
    assert.equal(cleanHandle('@name_1'), 'name_1');
    assert.throws(() => cleanHandle('bad handle){media}'), (e: any) => e.code === 'INVALID_INPUT');
    const store: any = {};
    const db = metricsDb([], store);
    const saved = await setRadarHandles({ companyId: 'c1', projectId: 'p1', platform: 'instagram', handles: ['@Rival', 'rival', 'other'] }, { db });
    assert.deepEqual(saved.handles, ['rival', 'other']);
    await assert.rejects(setRadarHandles({ companyId: 'c1', projectId: 'p1', platform: 'linkedin', handles: ['x'] }, { db }), (e: any) => e.code === 'COMPETITOR_API_UNAVAILABLE');
    await assert.rejects(setRadarHandles({ companyId: 'c2', projectId: 'p1', platform: 'instagram', handles: ['x'] }, { db }), (e: any) => e.statusCode === 404);
    assert.equal((await getRadar({ companyId: 'c1', projectId: 'p1', platform: 'facebook' }, { db })).supported, false);
});

test('radar scan: Instagram business discovery through the connected account; ranked per account; errors per handle', async () => {
    const store: any = {};
    const db = metricsDb([], store);
    await setRadarHandles({ companyId: 'c1', projectId: 'p1', platform: 'instagram', handles: ['rival', 'private_one'] }, { db });
    const calls: string[] = [];
    const media = [50, 60, 55, 65, 600].map((likes, i) => ({ caption: i === 4 ? 'Stop flossing less when your gums bleed\nrest' : `Post ${i}`, like_count: likes, comments_count: 5, permalink: `https://ig/p${i}`, timestamp: '2026-10-01T00:00:00Z' }));
    const scan = await scanRadar(
        { companyId: 'c1', projectId: 'p1', platform: 'instagram' },
        { db, now: () => NOW, getToken: async () => 'tok', fetchJson: fetcher([[/private_one/, new Error('(#110) user is not a business account')], [/view_count/, new Error('(#100) nonexisting field view_count')], [/business_discovery\.username\(rival\)/, { business_discovery: { followers_count: 12000, media: { data: media } } }]], calls) },
    );
    assert.ok(calls.every((u) => u.includes('/ig1?fields=')), 'only the connected account endpoint is called');
    const rival = scan.scan.accounts.find((a: any) => a.handle === 'rival');
    assert.deepEqual([rival.basis, rival.baseline, rival.posts], ['engagements', 65, 5]);
    assert.match(scan.scan.accounts.find((a: any) => a.handle === 'private_one').error, /not a business account/);
    assert.equal(scan.scan.top[0].hook, 'Stop flossing less when your gums bleed');
    assert.equal(scan.scan.top[0].outlierMultiple, 9.3);
    assert.equal(scan.scan.outliers, 1);
    assert.equal((await getRadar({ companyId: 'c1', projectId: 'p1', platform: 'instagram' }, { db })).scan.fetchedAt, NOW.toISOString(), 'scan is stored');

    await assert.rejects(scanRadar({ companyId: 'c1', projectId: 'p1', platform: 'instagram' }, { db: metricsDb([], { ...store, account: null }), getToken: async () => 't' }), (e: any) => e.code === 'ACCOUNT_REQUIRED');
    assert.equal(rankAccount('a', null, [{ url: null, text: 'x', publishedAt: null, views: 1, likes: null, comments: null }]).baseline, null, 'fewer than 3 posts: no baseline');
});

test('radar scan: YouTube resolves the handle to its uploads and reads public view counts', async () => {
    const store: any = {};
    const db = metricsDb([], store);
    await setRadarHandles({ companyId: 'c1', projectId: 'p1', platform: 'youtube', handles: ['@rivalchannel'] }, { db });
    const calls: string[] = [];
    const scan = await scanRadar({ companyId: 'c1', projectId: 'p1', platform: 'youtube' }, {
        db, now: () => NOW, getToken: async () => 'tok',
        fetchJson: fetcher([
            [/channels\?part=contentDetails,statistics&forHandle=%40rivalchannel/, { items: [{ contentDetails: { relatedPlaylists: { uploads: 'UU1' } }, statistics: { subscriberCount: '5000' } }] }],
            [/playlistItems.*playlistId=UU1/, { items: ['a', 'b', 'c'].map((id) => ({ contentDetails: { videoId: id } })) }],
            [/videos\?part=snippet,statistics&id=a,b,c/, { items: [['a', 100], ['b', 120], ['c', 900]].map(([id, v]) => ({ id, snippet: { title: `Title ${id}` }, statistics: { viewCount: String(v) } })) }],
        ], calls),
    });
    assert.equal(calls.length, 3);
    assert.deepEqual([scan.scan.accounts[0].basis, scan.scan.accounts[0].baseline, scan.scan.accounts[0].followers], ['views', 120, 5000]);
    assert.equal(scan.scan.top[0].url, 'https://www.youtube.com/watch?v=c');
});

// ------------------------------------------------------------------ reply drafts

function replyService(extra: any, generate: (prompt: string) => string) {
    const db = metricsDb([], extra);
    const prompts: string[] = [];
    const svc = new PlatformTeamService({
        db, now: () => NOW, createLLM: async () => { throw new Error('unused'); }, loadBrand: async () => ({ profile: null }), liveMetrics: async () => [],
        replyAi: {
            requireLlm: async () => ({ generate: async () => '' }),
            loadBrand: async () => ({ context: 'Brand: Northwind Dental. Cleanings from our hygienist team.', forbiddenWords: ['cheap'] }),
            generate: async (_llm, prompt) => { prompts.push(prompt); return generate(prompt); },
            parseJson: (raw) => JSON.parse(raw),
            findForbidden: (text, forbidden) => forbidden.filter((w) => text.toLowerCase().includes(w)),
        },
    });
    return { svc, db, prompts };
}

test('reply drafts: bucket-specific guidance, brand-grounded, forbidden words filtered, noise gets none', async () => {
    const conversation = { id: 'cv1', projectId: 'p1', platform: 'instagram', participantHandle: 'ana', lastMessageSnippet: 'What is the price for a cleaning?' };
    const { svc, db, prompts } = replyService({ conversation, messages: [{ senderType: 'participant', content: 'What is the price for a cleaning?' }] },
        () => JSON.stringify([{ tone: 'warm', text: 'Happy to help. I will send the details in a DM.' }, { tone: 'pushy', text: 'It is cheap, book now.' }]));
    const out = await svc.draftReplies('instagram', { companyId: 'c1', projectId: 'p1', conversationId: 'cv1' });
    assert.equal(out.bucket, 'LEAD');
    assert.equal(out.suggestions.length, 1, 'the reply with a forbidden word is dropped');
    assert.match(prompts[0], /never state a number that is not given/);
    assert.match(prompts[0], /untrusted user content/);
    assert.deepEqual(db.calls.find((c) => c.model === 'socialConversation')!.where, { id: 'cv1', companyId: 'c1', projectId: 'p1' });

    const noise = replyService({ conversation: { ...conversation, lastMessageSnippet: 'Earn $500 daily, check my bio' } }, () => '[]');
    assert.deepEqual((await noise.svc.draftReplies('instagram', { companyId: 'c1', projectId: 'p1', conversationId: 'cv1' })).suggestions, []);
    assert.equal(noise.prompts.length, 0, 'no AI call for noise');

    await assert.rejects(replyService({ conversation: null }, () => '[]').svc.draftReplies('instagram', { companyId: 'c1', projectId: 'p1', conversationId: 'nope' }), (e: any) => e.statusCode === 404);
    await assert.rejects(replyService({ conversation }, () => '[]').svc.draftReplies('instagram', { companyId: 'c1', projectId: 'p1', conversationId: 'cv1' }), (e: any) => e.code === 'AI_BAD_RESPONSE');
});
