/**
 * 180 Engagement production behaviour: matcher modes, per-post dedup, capability skips, rate limit + deferred retry,
 * webhook signature / idempotency / self-echo, AI agent (brand voice, forbidden words, takeover, lead once,
 * AI_NOT_CONFIGURED), AI Reply All (suggest / dispatch / tenant isolation / rate limit), honest platform metrics.
 * In-memory Prisma + recorded fetch; no network, no database.
 */
import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { FakeModel, FetchMock, createFakeDb, json, setTestEnv } from './publishing/fakes';
import { setPublishingDb, timing } from '../src/publishing/http';
import { SocialTokenVault } from '../src/publishing/token-vault';
import { MetaWebhooksService } from '../src/publishing/webhooks.service';
import { EngagementMatcher } from '../src/engagement/engagement-matcher';
import { EngagementDispatcher } from '../src/engagement/engagement-dispatcher';
import { EngagementRateLimiter, MemoryLimiterStore } from '../src/engagement/rate-limiter';
import { planEngagementActions } from '../src/engagement/capabilities';
import { setEngagementLlmResolver } from '../src/engagement/engagement-ai';
import { AiEngagementAgent } from '../src/engagement/ai-engagement-agent';
import { AiReplyAllService } from '../src/engagement/ai-reply-all.service';
import { SocialInboxService } from '../src/social-inbox.service';
import { fetchLivePlatformMetrics } from '../src/social-insights.service';

let db: any;
let fetchMock: FetchMock;
let calls: string[] = [];
let failPaths: RegExp[] = [];

async function seedAccount(id: string, companyId: string, platform: string, platformAccountId = `${id}-pid`, projectId: string | null = null) {
    await db.socialAccount.create({ data: { id, companyId, platform, platformAccountId, accountName: id, username: id, projectId } });
    await SocialTokenVault.saveTokens(id, companyId, { accessToken: `tok-${id}` } as any);
}

const rule = (over: any = {}) => ({
    id: 'rule-1', companyId: 'co-1', name: 'Blueprint', status: 'active', triggerType: 'comment_keyword', triggerKeywords: ['BLUEPRINT'], matchMode: 'contains',
    actionAutoLike: true, actionPublicReplies: ['Sent to your DMs {handle}'], actionSendDm: true, actionDmTemplate: 'Hi {name}, here it is: {deliverable_link}',
    actionDmDeliverableUrl: 'https://example.com/bp', actionEnableAiAgent: true, projectId: null, socialAccountId: null, postId: null, ...over,
});

const comment = (over: any = {}) => ({
    companyId: 'co-1', socialAccountId: 'acc-ig', platform: 'instagram', eventType: 'comment' as const, commentId: 'c-1', mediaId: 'media-1',
    senderId: 'user-9', senderHandle: 'jane', senderName: 'Jane', text: 'send the blueprint please', ...over,
});

beforeEach(async () => {
    setTestEnv();
    db = createFakeDb();
    for (const n of ['socialEngagementRule', 'socialInteractionLog', 'lead', 'brandVoiceProfile']) db[n] = new FakeModel(n);
    setPublishingDb(db);
    EngagementRateLimiter.useStore(new MemoryLimiterStore());
    EngagementMatcher.resetDedupCache();
    delete process.env.SOCIAL_ENGAGEMENT_RATE_LIMIT_PER_MIN;
    calls = [];
    failPaths = [];
    fetchMock = new FetchMock((c) => {
        calls.push(`${c.method} ${new URL(c.url).pathname}`);
        if (failPaths.some((re) => re.test(c.url))) return json(400, { error: { message: 'Unsupported request' } });
        return json(200, { id: 'ok', data: [], items: [] });
    }).install();
    await seedAccount('acc-ig', 'co-1', 'instagram', 'ig-1');
    await seedAccount('acc-yt', 'co-1', 'youtube');
    await seedAccount('acc-tt', 'co-1', 'tiktok');
    await seedAccount('acc-li', 'co-1', 'linkedin');
    await seedAccount('acc-2', 'co-2', 'instagram', 'ig-2');
    db.socialEngagementRule.rows.push(rule());
});

afterEach(() => {
    fetchMock.restore();
    setEngagementLlmResolver(null);
    EngagementRateLimiter.useStore(null);
});

// ── matcher ──────────────────────────────────────────────────────────────────────────────────────────────────
test('matcher: contains is word-bounded, exact is whole text, regex works and bad regex never throws', () => {
    assert.equal(EngagementMatcher.matchesKeywords('Send the BLUEPRINT!', ['blueprint'], 'contains'), true);
    assert.equal(EngagementMatcher.matchesKeywords('blueprints galore', ['blueprint'], 'contains'), false);
    assert.equal(EngagementMatcher.matchesKeywords('link', ['LINK'], 'exact'), true);
    assert.equal(EngagementMatcher.matchesKeywords('the link', ['LINK'], 'exact'), false);
    assert.equal(EngagementMatcher.matchesKeywords('guide-2024', ['^guide-\\d+$'], 'regex'), true);
    assert.doesNotThrow(() => EngagementMatcher.matchesKeywords('x', ['('], 'regex'));
});

// ── dispatcher: happy path + dedup ───────────────────────────────────────────────────────────────────────────
test('instagram comment: like + public reply + private reply are real provider calls; DM is recorded and counted', async () => {
    const out = await EngagementDispatcher.executeEngagement(rule(), comment());
    assert.equal(out.commentLiked, true);
    assert.match(out.publicReplySent!, /@jane/);
    assert.match(out.dmSent!, /https:\/\/example\.com\/bp/);
    assert.ok(calls.some((c) => c.endsWith('/c-1/likes')));
    assert.ok(calls.some((c) => c.endsWith('/c-1/replies')));
    assert.ok(calls.some((c) => c.endsWith('/ig-1/messages')));
    const log = db.socialInteractionLog.rows[0];
    assert.equal(log.status, 'success');
    assert.equal(log.platformMediaId, 'media-1');
    assert.equal(db.socialEngagementRule.rows[0].statsDmsSentCount, 1);
    const thread = db.socialConversation.rows.find((c: any) => c.platformThreadId === 'user-9');
    assert.equal(thread.aiAgentActive, true);
});

test('dedup: one DM per user per post even from a different comment; another post is allowed', async () => {
    await EngagementDispatcher.executeEngagement(rule(), comment());
    const n = calls.length;
    const again = await EngagementDispatcher.executeEngagement(rule(), comment({ commentId: 'c-2' }));
    assert.equal(again.skippedReason, 'duplicate');
    assert.equal(calls.length, n, 'no provider call for the duplicate');
    const other = await EngagementDispatcher.executeEngagement(rule(), comment({ commentId: 'c-3', mediaId: 'media-2' }));
    // A second DM to the same user before they answered is still blocked by the IG messaging rule.
    assert.equal(other.dmSent, undefined);
    assert.ok(other.actions!.some((a) => a.action === 'dm' && a.status === 'skipped' && /awaiting_user_reply/.test(a.reason!)));
});

// ── capability matrix ────────────────────────────────────────────────────────────────────────────────────────
test('capabilities: YouTube replies only, TikTok reply only, LinkedIn no DM — skipped with a logged reason, no fake success', async () => {
    const yt = await EngagementDispatcher.executeEngagement(rule(), comment({ socialAccountId: 'acc-yt', platform: 'youtube' }));
    assert.ok(yt.publicReplySent);
    assert.equal(yt.commentLiked, false);
    assert.equal(yt.dmSent, undefined);
    assert.ok(yt.actions!.some((a) => a.action === 'dm' && a.status === 'skipped' && /unsupported_on_platform/.test(a.reason!)));
    assert.ok(calls.some((c) => c === 'POST /youtube/v3/comments'));

    const tt = await EngagementDispatcher.executeEngagement(rule({ id: 'rule-tt' }), comment({ socialAccountId: 'acc-tt', platform: 'tiktok', senderId: 'u-tt' }));
    assert.deepEqual(tt.actions!.filter((a) => a.status === 'skipped').map((a) => a.action).sort(), ['dm', 'like']);

    const li = await EngagementDispatcher.executeEngagement(rule({ id: 'rule-li' }), comment({ socialAccountId: 'acc-li', platform: 'linkedin', senderId: 'u-li' }));
    assert.equal(li.dmSent, undefined);
    const log = db.socialInteractionLog.rows.find((l: any) => l.ruleId === 'rule-li');
    assert.match(log.errorMessage, /dm: unsupported_on_platform/);
});

test('capabilities: IG private reply older than 7 days is skipped; provider failure is reported as failed, not sent', async () => {
    const plan = planEngagementActions('instagram', rule(), { eventType: 'comment', commentId: 'c' }, { nowMs: Date.now(), commentAtMs: Date.now() - 8 * 86_400_000 });
    assert.equal(plan.find((p) => p.action === 'dm')!.skipReason, 'private_reply_window_expired');

    failPaths = [/\/likes$/];
    const out = await EngagementDispatcher.executeEngagement(rule(), comment());
    assert.equal(out.commentLiked, false);
    assert.ok(out.actions!.some((a) => a.action === 'like' && a.status === 'failed'));
    assert.equal(db.socialInteractionLog.rows[0].status, 'partial');
});

// ── rate limit + deferred retry ──────────────────────────────────────────────────────────────────────────────
test('rate limiter: 30/min per account by default, refuses the 31st with retryAfter; env-configurable', async () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 30; i++) assert.equal((await EngagementRateLimiter.take('a', 1, t0)).allowed, true);
    const refused = await EngagementRateLimiter.take('a', 1, t0);
    assert.equal(refused.allowed, false);
    assert.ok(refused.retryAfterMs > 0 && refused.retryAfterMs <= 2000);
    assert.equal((await EngagementRateLimiter.take('b', 1, t0)).allowed, true, 'other accounts have their own bucket');
    process.env.SOCIAL_ENGAGEMENT_RATE_LIMIT_PER_MIN = '2';
    EngagementRateLimiter.useStore(new MemoryLimiterStore());
    assert.equal((await EngagementRateLimiter.take('c', 2, t0)).allowed, true);
    assert.equal((await EngagementRateLimiter.take('c', 1, t0)).allowed, false);
});

test('rate limiter: production without REDIS_URL fails loudly (no silent in-memory limiter)', async () => {
    EngagementRateLimiter.useStore(null);
    const env = { NODE_ENV: process.env.NODE_ENV, REDIS_URL: process.env.REDIS_URL };
    process.env.NODE_ENV = 'production';
    delete process.env.REDIS_URL;
    const origErr = console.error;
    console.error = () => undefined;
    try {
        await assert.rejects(EngagementRateLimiter.take('x'), (e: any) => e.code === 'RATE_LIMITER_UNAVAILABLE' && e.statusCode === 503);
    } finally {
        console.error = origErr;
        process.env.NODE_ENV = env.NODE_ENV;
        if (env.REDIS_URL) process.env.REDIS_URL = env.REDIS_URL;
    }
});

test('rate-limited event is stored (not dropped) and replayed by retryDeferred once the bucket refills', async () => {
    process.env.SOCIAL_ENGAGEMENT_RATE_LIMIT_PER_MIN = '3';
    await EngagementRateLimiter.take('acc-ig', 3); // bucket full
    const out = await EngagementDispatcher.executeEngagement(rule(), comment());
    assert.equal(out.skippedReason, 'rate_limited');
    assert.equal(calls.filter((c) => c.includes('ig-1') || c.includes('c-1')).length, 0);
    const row = db.socialInteractionLog.rows[0];
    assert.equal(row.status, 'rate_limited');
    assert.equal(row.payload.event.commentId, 'c-1');

    const realNow = timing.now;
    timing.now = () => Date.now() + 120_000;
    try {
        const r = await EngagementDispatcher.retryDeferred();
        assert.equal(r.retried, 1);
    } finally {
        timing.now = realNow;
    }
    assert.equal(db.socialInteractionLog.rows.length, 1, 'the same log row is completed');
    assert.equal(db.socialInteractionLog.rows[0].status, 'success');
    assert.ok(db.socialInteractionLog.rows[0].dmSent);
});

// ── webhook ──────────────────────────────────────────────────────────────────────────────────────────────────
test('webhook signature: valid passes, tampered fails, missing secret fails closed', () => {
    delete process.env.META_WEBHOOK_APP_SECRET;
    const saved = process.env.META_APP_SECRET;
    process.env.META_WEBHOOK_APP_SECRET = 'whsec-test';
    const body = Buffer.from(JSON.stringify({ object: 'instagram', entry: [] }));
    const sig = `sha256=${crypto.createHmac('sha256', 'whsec-test').update(body).digest('hex')}`;
    assert.equal(MetaWebhooksService.verifySignature(body, sig), true);
    assert.equal(MetaWebhooksService.verifySignature(Buffer.from('{"x":1}'), sig), false);
    delete process.env.META_WEBHOOK_APP_SECRET;
    delete process.env.META_APP_SECRET;
    assert.equal(MetaWebhooksService.isSignatureConfigured(), false);
    assert.equal(MetaWebhooksService.verifySignature(body, sig), false);
    process.env.META_APP_SECRET = saved;
});

test('webhook: comment triggers the rule once; re-delivery and our own comments trigger nothing', async () => {
    const payload = {
        object: 'instagram',
        entry: [{ id: 'ig-1', time: Math.floor(Date.now() / 1000), changes: [{ field: 'comments', value: { id: 'c-77', text: 'BLUEPRINT pls', from: { id: 'user-5', username: 'max' }, media: { id: 'media-5' } } }] }],
    };
    const r1 = await MetaWebhooksService.handleWebhookEvent(payload);
    assert.equal(r1.messagesIngested, 1);
    assert.equal(db.socialInteractionLog.rows.length, 1);
    const n = calls.length;
    const r2 = await MetaWebhooksService.handleWebhookEvent(payload);
    assert.equal(r2.duplicates, 1);
    assert.equal(calls.length, n, 'no second reply / DM');
    assert.ok(db.socialConversation.rows.some((c: any) => c.platformThreadId === 'comment:c-77'));

    const own = { object: 'instagram', entry: [{ id: 'ig-1', changes: [{ field: 'comments', value: { id: 'c-78', text: 'Sent BLUEPRINT to your DMs', from: { id: 'ig-1' }, media: { id: 'media-5' } } }] }] };
    await MetaWebhooksService.handleWebhookEvent(own);
    assert.equal(db.socialInteractionLog.rows.length, 1);
    const echo = { object: 'instagram', entry: [{ id: 'ig-1', messaging: [{ sender: { id: 'ig-1' }, message: { mid: 'm-1', text: 'hi', is_echo: true } }] }] };
    assert.equal((await MetaWebhooksService.handleWebhookEvent(echo)).messagesIngested, 0);
});

// ── AI agent ─────────────────────────────────────────────────────────────────────────────────────────────────
async function dmThread(over: any = {}) {
    const conv = await db.socialConversation.create({ data: { companyId: 'co-1', socialAccountId: 'acc-ig', platform: 'instagram', platformThreadId: 'user-1', participantName: 'Rob', participantHandle: 'rob', aiAgentActive: true, isHumanTakeover: false, projectId: 'proj-1', ...over } });
    await db.socialMessage.create({ data: { conversationId: conv.id, senderType: 'participant', content: 'hello' } });
    return conv;
}

test('AI agent: no AI provider → AI_NOT_CONFIGURED and nothing is sent (no canned reply)', async () => {
    setEngagementLlmResolver(async () => null);
    const conv = await dmThread();
    const out = await AiEngagementAgent.handleIncomingDm(conv.id, 'what does it cost?', 'co-1');
    assert.equal(out.replied, false);
    assert.equal(out.errorCode, 'AI_NOT_CONFIGURED');
    assert.ok(!calls.some((c) => c.includes('/messages')));
});

test('AI agent: brand voice in the prompt, forbidden words rejected, lead created once, takeover stops replies', async () => {
    db.project.rows.push({ id: 'proj-1', companyId: 'co-1', name: 'Acme', projectType: 'social_media', deletedAt: null });
    db.brandVoiceProfile.rows.push({ id: 'bv', companyId: 'co-1', projectId: 'proj-1', tone: 'Warm and direct', forbiddenWords: ['cheap'], metadata: {} });
    const prompts: string[] = [];
    let answer = { reply: 'Thanks Rob, the team will email you shortly.', intent: 'lead', escalate: false };
    setEngagementLlmResolver(async () => ({ generate: async (p: string) => { prompts.push(p); return JSON.stringify(answer); } }));
    const conv = await dmThread();

    const out = await AiEngagementAgent.handleIncomingDm(conv.id, 'my email is rob@acme.io', 'co-1');
    assert.equal(out.replied, true, out.error);
    assert.equal(out.leadConverted, true);
    assert.match(prompts[0], /Warm and direct/);
    assert.match(prompts[0], /NEVER use these words: cheap/);
    assert.ok(calls.some((c) => c.endsWith('/ig-1/messages')));
    const again = await AiEngagementAgent.handleIncomingDm(conv.id, 'again rob@acme.io', 'co-1');
    assert.equal(again.leadConverted, false);
    assert.equal(db.lead.rows.length, 1, 'lead created exactly once');
    assert.equal(db.lead.rows[0].email, 'rob@acme.io');

    answer = { reply: 'It is cheap!', intent: 'question', escalate: false };
    const bad = await AiEngagementAgent.handleIncomingDm(conv.id, 'price?', 'co-1');
    assert.equal(bad.errorCode, 'FORBIDDEN_WORDS');

    const esc = await AiEngagementAgent.handleIncomingDm(conv.id, 'let me talk to a human', 'co-1');
    assert.equal(esc.humanEscalated, true);
    const after = await AiEngagementAgent.handleIncomingDm(conv.id, 'hello?', 'co-1');
    assert.equal(after.replied, false);
    // wrong tenant sees nothing
    const foreign = await AiEngagementAgent.handleIncomingDm(conv.id, 'hi', 'co-2');
    assert.equal(foreign.errorCode, 'NOT_FOUND');
});

// ── AI Reply All ─────────────────────────────────────────────────────────────────────────────────────────────
test('reply-all: suggestions classified by intent, only unanswered threads, blocked items flagged; tenant-isolated', async () => {
    setEngagementLlmResolver(async () => ({ generate: async () => JSON.stringify([{ index: 0, intent: 'question', reply: 'Yes, it ships Monday.', confidence: 0.9 }, { index: 1, intent: 'praise', reply: 'Thank you!', confidence: 0.8 }]) }));
    const a = await dmThread({ platformThreadId: 'u-a' });
    const yt = await db.socialConversation.create({ data: { companyId: 'co-1', socialAccountId: 'acc-yt', platform: 'youtube', platformThreadId: 'u-yt', participantHandle: 'v', participantName: 'v' } });
    await db.socialMessage.create({ data: { conversationId: yt.id, senderType: 'participant', content: 'love it' } });
    await db.socialConversation.create({ data: { companyId: 'co-2', socialAccountId: 'acc-2', platform: 'instagram', platformThreadId: 'u-x', participantHandle: 'x', participantName: 'x' } });

    const items = await AiReplyAllService.generateBatchSuggestions('co-1', {});
    assert.equal(items.length, 2);
    const ig = items.find((i) => i.conversationId === a.id)!;
    assert.equal(ig.intent, 'question');
    assert.equal(ig.canSend, true);
    const ytItem = items.find((i) => i.conversationId === yt.id)!;
    assert.equal(ytItem.canSend, false, 'YouTube has no DMs');

    setEngagementLlmResolver(async () => null);
    await assert.rejects(AiReplyAllService.generateBatchSuggestions('co-1', {}), (e: any) => e.code === 'AI_NOT_CONFIGURED' && e.statusCode === 503);
});

test('reply-all dispatch: sends edited text, other company\'s conversation fails, rate-limited items come back (not dropped)', async () => {
    const a = await dmThread({ platformThreadId: 'u-a' });
    const b = await dmThread({ platformThreadId: 'u-b' });
    const foreign = await db.socialConversation.create({ data: { companyId: 'co-2', socialAccountId: 'acc-2', platform: 'instagram', platformThreadId: 'u-x' } });
    process.env.SOCIAL_ENGAGEMENT_RATE_LIMIT_PER_MIN = '1';
    const r = await AiReplyAllService.executeBatchReplies('co-1', [
        { conversationId: a.id, replyText: 'Edited reply' },
        { conversationId: foreign.id, replyText: 'x' },
        { conversationId: b.id, replyText: 'Second' },
    ]);
    assert.equal(r.dispatched, 1);
    assert.deepEqual(r.results.map((x) => x.status), ['sent', 'failed', 'rate_limited']);
    assert.equal(r.results[1].code, 'NOT_FOUND');
    assert.ok(r.results[2].retryAfterMs! > 0);
    assert.ok(db.socialMessage.rows.some((m: any) => m.content === 'Edited reply' && m.senderType === 'agent'));
    assert.ok(!db.socialMessage.rows.some((m: any) => m.content === 'Second'), 'unsent reply is not recorded as sent');
});

test('inbox convert-to-lead is idempotent and tenant-scoped', async () => {
    const conv = await dmThread();
    const first = await SocialInboxService.convertToCrmLead(conv.id, 'co-1');
    const second = await SocialInboxService.convertToCrmLead(conv.id, 'co-1');
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.lead.id, first.lead.id);
    await assert.rejects(SocialInboxService.convertToCrmLead(conv.id, 'co-2'), (e: any) => e.statusCode === 404);
});

// ── metrics honesty ──────────────────────────────────────────────────────────────────────────────────────────
test('platform metrics: live values come from the provider, failures are PLATFORM_METRICS_UNAVAILABLE, nothing invented', async () => {
    db.project.rows.push({ id: 'proj-m', companyId: 'co-1' });
    await seedAccount('m-ig', 'co-1', 'instagram', 'ig-m', 'proj-m');
    await seedAccount('m-fb', 'co-1', 'facebook', 'fb-m', 'proj-m');
    await db.socialAccount.create({ data: { id: 'm-th', companyId: 'co-1', platform: 'threads', platformAccountId: 'mock_th', accountName: 't', projectId: 'proj-m', followersCount: 42, metadata: { followersCount: 42 } } });
    fetchMock.restore();
    fetchMock = new FetchMock((c) => {
        if (c.url.includes('/ig-m?')) return json(200, { followers_count: 1200 });
        if (c.url.includes('/ig-m/insights')) return json(200, { data: [{ name: 'reach', total_value: { value: 900 } }] });
        if (c.url.includes('fb-m')) return json(403, { error: { message: 'Requires pages_read_engagement permission' } });
        return json(404, {});
    }).install();
    const out = await fetchLivePlatformMetrics({ projectId: 'proj-m', companyId: 'co-1' });
    const ig = out.find((m) => m.platform === 'instagram')!;
    assert.equal(ig.source, 'live');
    assert.equal(ig.followersCount, 1200);
    assert.equal(ig.reach, 900);
    assert.equal(ig.views, null, 'unreported metric stays null');
    const fb = out.find((m) => m.platform === 'facebook')!;
    assert.equal(fb.unavailable?.code, 'PLATFORM_METRICS_UNAVAILABLE');
    assert.equal(fb.unavailable?.reason, 'missing_scope');
    assert.equal(fb.reach, null);
    const th = out.find((m) => m.platform === 'threads')!;
    assert.equal(th.source, 'stored');
    assert.equal(th.followersCount, 42);
    assert.equal(th.reach, null, 'no invented numbers for mock_ accounts');
    await assert.rejects(fetchLivePlatformMetrics({ projectId: 'proj-m', companyId: 'co-2' }), (e: any) => e.status === 404);
});
