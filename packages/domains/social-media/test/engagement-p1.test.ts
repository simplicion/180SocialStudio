/**
 * PRODUCTION_READINESS_PLAN P1: comment → DM on existing posts (platform media id), funnel rule validation,
 * AI inbox mode per account (off | reply | qualify), lead qualification + owner notification, opportunity ranking.
 * In-memory Prisma + recorded fetch; no network, no database.
 */
import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { FakeModel, FetchMock, createFakeDb, json, setTestEnv } from './publishing/fakes';
import { setPublishingDb } from '../src/publishing/http';
import { SocialTokenVault } from '../src/publishing/token-vault';
import { EngagementMatcher } from '../src/engagement/engagement-matcher';
import { EngagementRuleService } from '../src/engagement/engagement-rule.service';
import { EngagementRateLimiter, MemoryLimiterStore } from '../src/engagement/rate-limiter';
import { setEngagementLlmResolver } from '../src/engagement/engagement-ai';
import { AiEngagementAgent, parseLeadQualification } from '../src/engagement/ai-engagement-agent';
import { AiInboxService } from '../src/engagement/ai-inbox.service';
import { AccountMediaService } from '../src/engagement/account-media.service';
import { InboxSubagent } from '../src/manager/inbox-subagent';

let db: any;
let fetchMock: FetchMock;
let calls: string[] = [];
let llmAnswer: any;
let prompts: string[] = [];

async function seedAccount(id: string, companyId: string, platform: string, extra: any = {}) {
    await db.socialAccount.create({ data: { id, companyId, platform, platformAccountId: `${id}-pid`, accountName: id, username: id, projectId: null, isActive: true, aiInboxMode: 'off', ...extra } });
    await SocialTokenVault.saveTokens(id, companyId, { accessToken: `tok-${id}` } as any);
}

const baseRule = (over: any = {}) => ({
    name: 'Funnel', triggerType: 'comment_any', triggerKeywords: [], actionDmTemplate: 'Hi {name}, here it is: https://x.test/guide', ...over,
});

const comment = (over: any = {}) => ({
    companyId: 'co-1', socialAccountId: 'acc-ig', platform: 'instagram', eventType: 'comment' as const, commentId: 'c-1', mediaId: 'media-1',
    senderId: 'user-9', senderHandle: 'jane', senderName: 'Jane', text: 'nice reel', ...over,
});

async function seedConversation(over: any = {}) {
    const conv = await db.socialConversation.create({
        data: {
            id: 'conv-1', companyId: 'co-1', projectId: 'p-1', socialAccountId: 'acc-ig', platform: 'instagram', platformThreadId: 'user-9',
            participantName: 'Jane', participantHandle: 'jane', aiAgentActive: false, isHumanTakeover: false, isRead: false, lastMessageAt: new Date(), ...over,
        },
    });
    await db.socialMessage.create({ data: { conversationId: conv.id, senderType: 'participant', content: 'How much for a website? Budget is 2000 USD, need it in May' } });
    return conv;
}

beforeEach(async () => {
    setTestEnv();
    db = createFakeDb();
    for (const n of ['socialEngagementRule', 'socialInteractionLog', 'lead', 'brandVoiceProfile', 'notification']) db[n] = new FakeModel(n);
    setPublishingDb(db);
    EngagementRateLimiter.useStore(new MemoryLimiterStore());
    EngagementMatcher.resetDedupCache();
    calls = [];
    prompts = [];
    llmAnswer = { reply: 'Happy to help! What kind of website do you need?', intent: 'lead', escalate: false };
    fetchMock = new FetchMock((c) => {
        calls.push(`${c.method} ${new URL(c.url).pathname}`);
        if (/\/media\b/.test(c.url)) {
            return json(200, {
                data: [{ id: '1789', caption: 'My reel', media_type: 'VIDEO', media_product_type: 'REELS', thumbnail_url: 'https://cdn.test/t.jpg', permalink: 'https://instagram.com/reel/abc', timestamp: '2026-09-01T10:00:00Z', comments_count: 12 }],
                paging: { cursors: { after: 'CUR1' }, next: 'https://graph.test/next' },
            });
        }
        return json(200, { id: 'ok', message_id: 'm-1', recipient_id: 'user-9' });
    }).install();
    setEngagementLlmResolver(async () => ({ generate: async (p: string) => { prompts.push(p); return JSON.stringify(llmAnswer); } }));
    await db.project.create({ data: { id: 'p-1', companyId: 'co-1', name: 'Alpha', ownerId: 'owner-1' } });
    await seedAccount('acc-ig', 'co-1', 'instagram');
    await seedAccount('acc-ig2', 'co-1', 'instagram');
    await seedAccount('acc-li', 'co-1', 'linkedin');
    await seedAccount('acc-x', 'co-2', 'instagram');
});

afterEach(() => {
    fetchMock.restore();
    setEngagementLlmResolver(null);
});

// ── P1.1 existing posts ─────────────────────────────────────────────────────────────────────────────

test('rule on an existing post: needs its account, cannot mix with an app post, foreign account is 404', async () => {
    await assert.rejects(EngagementRuleService.createRule('co-1', baseRule({ platformMediaId: '1789' }) as any), (e: any) => e.statusCode === 400);
    await assert.rejects(EngagementRuleService.createRule('co-1', baseRule({ platformMediaId: '1789', socialAccountId: 'acc-ig', postId: 'p' }) as any), (e: any) => e.statusCode === 400);
    await assert.rejects(EngagementRuleService.createRule('co-1', baseRule({ platformMediaId: '1789', socialAccountId: 'acc-x' }) as any), (e: any) => e.statusCode === 404);
    await assert.rejects(EngagementRuleService.createRule('co-1', baseRule({ platformMediaId: 'bad id with spaces', socialAccountId: 'acc-ig' }) as any), (e: any) => e.statusCode === 400);
    const r = await EngagementRuleService.createRule('co-1', baseRule({ platformMediaId: '1789', socialAccountId: 'acc-ig', platformMediaPermalink: 'https://instagram.com/reel/abc' }) as any);
    assert.equal(r.platformMediaId, '1789');
});

test('keyword trigger without keywords is rejected (use comment_any for every comment)', async () => {
    await assert.rejects(EngagementRuleService.createRule('co-1', baseRule({ triggerType: 'comment_keyword', triggerKeywords: ['  '] }) as any), (e: any) => /comment_any/.test(e.message));
});

test('a rule on an existing post fires only for comments under that post, and beats an account-wide rule', async () => {
    const wide = await EngagementRuleService.createRule('co-1', baseRule({ name: 'Wide' }) as any);
    const onPost = await EngagementRuleService.createRule('co-1', baseRule({ name: 'Reel', socialAccountId: 'acc-ig', platformMediaId: 'media-1' }) as any);
    assert.equal((await EngagementMatcher.findMatchingRule(comment()))?.id, onPost.id);
    assert.equal((await EngagementMatcher.findMatchingRule(comment({ mediaId: 'media-2', commentId: 'c-2' })))?.id, wide.id);
    await EngagementRuleService.updateRule('co-1', wide.id, { status: 'paused' });
    assert.equal(await EngagementMatcher.findMatchingRule(comment({ mediaId: 'media-2', commentId: 'c-3' })), null);
});

test('account media: live Instagram listing, tenant-scoped, unsupported platforms say so', async () => {
    const page = await AccountMediaService.listRecentMedia('co-1', 'acc-ig');
    assert.equal(page.items[0].id, '1789');
    assert.equal(page.items[0].mediaType, 'REEL');
    assert.equal(page.nextCursor, 'CUR1');
    await assert.rejects(AccountMediaService.listRecentMedia('co-1', 'acc-x'), (e: any) => e.statusCode === 404);
    await assert.rejects(AccountMediaService.listRecentMedia('co-1', 'acc-li'), (e: any) => e.code === 'MEDIA_LISTING_UNSUPPORTED');
    await assert.rejects(AccountMediaService.listRecentMedia('co-1', 'acc-ig', { cursor: 'x&access_token=steal' }), (e: any) => e.statusCode === 400);
});

// ── P1.3 AI inbox mode ──────────────────────────────────────────────────────────────────────────────

test('AI inbox off: no reply; reply mode: the agent answers a thread that never had AI switched on', async () => {
    await seedConversation();
    let out = await AiEngagementAgent.handleIncomingDm('conv-1', 'How much?', 'co-1');
    assert.equal(out.replied, false);
    assert.equal(prompts.length, 0);
    await AiInboxService.setAccountMode('co-1', 'acc-ig', { mode: 'reply' });
    out = await AiEngagementAgent.handleIncomingDm('conv-1', 'How much?', 'co-1');
    assert.equal(out.replied, true, out.error);
    assert.match(prompts[0], /<<<UNTRUSTED_DATA/);
});

test('a thread a human took over is never answered, whatever the account mode', async () => {
    await seedConversation({ isHumanTakeover: true });
    await AiInboxService.setAccountMode('co-1', 'acc-ig', { mode: 'qualify' });
    const out = await AiEngagementAgent.handleIncomingDm('conv-1', 'hello', 'co-1');
    assert.equal(out.replied, false);
    assert.equal(prompts.length, 0);
});

test('bulk switch turns on every Instagram account of the company only; LinkedIn cannot be switched on', async () => {
    const r = await AiInboxService.setModeBulk('co-1', { mode: 'reply', platform: 'instagram' });
    assert.equal(r.updated, 2);
    assert.equal(db.socialAccount.rows.find((a: any) => a.id === 'acc-x').aiInboxMode, 'off');
    await assert.rejects(AiInboxService.setAccountMode('co-1', 'acc-li', { mode: 'reply' }), (e: any) => e.code === 'AI_INBOX_UNSUPPORTED');
    await assert.rejects(AiInboxService.setAccountMode('co-1', 'acc-x', { mode: 'reply' }), (e: any) => e.statusCode === 404);
    await assert.rejects(AiInboxService.setAccountMode('co-1', 'acc-ig', { mode: 'always' }), (e: any) => e.statusCode === 400);
});

// ── P1.6 lead qualification ─────────────────────────────────────────────────────────────────────────

test('qualify mode stores the qualification and notifies the project owner once', async () => {
    await seedConversation();
    await AiInboxService.setAccountMode('co-1', 'acc-ig', { mode: 'qualify' });
    llmAnswer = {
        reply: 'Great, our team will reach out about the May launch.', intent: 'lead', escalate: false,
        qualification: { need: 'website', budget: '2000 USD', timeline: 'May', authority: null, fit: 'good', score: 82, stage: 'qualified', reason: 'clear need, budget and date' },
    };
    const out = await AiEngagementAgent.handleIncomingDm('conv-1', 'Budget 2000 USD, May', 'co-1');
    assert.equal(out.qualification?.stage, 'qualified');
    const conv = db.socialConversation.rows.find((c: any) => c.id === 'conv-1');
    assert.equal(conv.leadScore, 82);
    assert.ok(conv.leadQualifiedAt);
    assert.equal(db.notification.rows.length, 1);
    assert.equal(db.notification.rows[0].userId, 'owner-1');
    assert.match(prompts[0], /budget/i);
    await AiEngagementAgent.handleIncomingDm('conv-1', 'thanks', 'co-1');
    assert.equal(db.notification.rows.length, 1, 'no second notification for the same lead');
});

test('handoff stage hands the thread to a human; malformed qualification is ignored, not guessed', async () => {
    assert.equal(parseLeadQualification({ score: 140, stage: 'qualified' }), null);
    assert.equal(parseLeadQualification({ score: 40, stage: 'hot' }), null);
    assert.equal(parseLeadQualification({ score: 40, stage: 'engaged' })?.fit, 'unclear');
    await seedConversation();
    await AiInboxService.setAccountMode('co-1', 'acc-ig', { mode: 'qualify' });
    llmAnswer = { reply: 'I will ask the founder to call you.', intent: 'lead', escalate: false, qualification: { score: 90, stage: 'handoff', fit: 'good', need: 'call' } };
    await AiEngagementAgent.handleIncomingDm('conv-1', 'Can we hop on a call?', 'co-1');
    assert.equal(db.socialConversation.rows[0].isHumanTakeover, true);
});

// ── P1.5 opportunities ──────────────────────────────────────────────────────────────────────────────

test('opportunities: AI-qualified threads first, unread chit-chat is not an opportunity, disqualified excluded', async () => {
    const mk = async (id: string, text: string, over: any = {}) => {
        await db.socialConversation.create({ data: { id, companyId: 'co-1', projectId: 'p-1', socialAccountId: 'acc-ig', platform: 'instagram', platformThreadId: id, participantName: id, participantHandle: id, isRead: false, lastMessageAt: new Date(), ...over } });
        await db.socialMessage.create({ data: { conversationId: id, senderType: 'participant', content: text } });
    };
    // The fake DB does not run `include`, so attach the latest message the way Prisma returns it.
    const findMany = db.socialConversation.findMany.bind(db.socialConversation);
    db.socialConversation.findMany = async (args: any) => {
        const rows = await findMany(args);
        return rows.map((r: any) => ({ ...r, messages: db.socialMessage.rows.filter((m: any) => m.conversationId === r.id).slice(-1) }));
    };
    await mk('hi', 'hey love your content');
    await mk('kw', 'what is your pricing?');
    await mk('ai', 'need a site', { leadStage: 'qualified', leadScore: 85, leadQualification: { need: 'site', budget: '3k' } });
    await mk('no', 'pricing? lol spam', { leadStage: 'disqualified', leadScore: 5 });
    const opps = await InboxSubagent.findOpportunities('co-1', { projectId: 'p-1' });
    assert.deepEqual(opps.map((o) => o.conversationId), ['ai', 'kw']);
    assert.equal(opps[0].confidence, 0.85);
    assert.equal(opps[0].inAppInboxDeepLink, '/inbox?conversationId=ai');
    assert.match(opps[0].summary, /needs site, budget 3k/);
});
