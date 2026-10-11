/**
 * Platform Team service: deterministic tools validate input, the overview reads only tenant-scoped rows and
 * reports what exists (no invented numbers), AI tools surface AI_NOT_CONFIGURED. Fake DB; never a real database.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { PlatformTeamService, parsePlatform } from '../src/platform-team/platform-team.service';
import { triageComments } from '../src/platform-team/comment-triage';

type Call = { model: string; op: string; where: any };

function setup(over: { accounts?: any[]; posts?: any[]; conversations?: any[]; project?: any; metrics?: any[] } = {}) {
    const calls: Call[] = [];
    const model = (name: string, rows: any[]) => ({
        findFirst: async (a: any) => { calls.push({ model: name, op: 'findFirst', where: a.where }); return rows[0] ?? null; },
        findMany: async (a: any) => { calls.push({ model: name, op: 'findMany', where: a.where }); return rows; },
        count: async (a: any) => { calls.push({ model: name, op: 'count', where: a.where }); return rows.length; },
    });
    const db = {
        project: model('project', over.project === null ? [] : [over.project ?? { id: 'p1', name: 'Northwind' }]),
        socialAccount: model('socialAccount', over.accounts ?? []),
        socialPost: model('socialPost', over.posts ?? []),
        socialConversation: model('socialConversation', over.conversations ?? []),
    };
    const svc = new PlatformTeamService({
        db,
        createLLM: async () => { throw Object.assign(new Error('no key'), { code: 'AI_NOT_CONFIGURED', statusCode: 503 }); },
        loadBrand: async () => ({ profile: null, promptContext: 'Brand: Northwind' }),
        liveMetrics: async () => over.metrics ?? [],
        now: () => new Date('2026-10-07T00:00:00Z'),
    });
    return { svc, calls };
}

test('parsePlatform accepts aliases and rejects unknown names with 400', () => {
    assert.equal(parsePlatform('twitter'), 'x');
    assert.equal(parsePlatform('LinkedIn'), 'linkedin');
    assert.throws(() => parsePlatform('myspace'), (e: any) => e.statusCode === 400);
});

test('deterministic tools validate input and use the rules of the platform', () => {
    const { svc } = setup();
    assert.throws(() => svc.scoreHooks('instagram', {}), (e: any) => e.code === 'INVALID_INPUT');
    assert.equal(svc.scoreHooks('linkedin', { hooks: ['A', 'Stop sending proposals before the scope call'], spoken: false }).ranked.length, 2);
    assert.equal(svc.lintCopy('linkedin', { caption: 'A post with enough words to be judged properly by the linter today.' }).foldChars, 140);
    assert.ok(svc.lintCopy('youtube', { caption: 'A description with enough words to be judged properly.', title: 'Short title' }).titleLint);
    assert.ok(svc.thread({ text: 'word '.repeat(200) }).count > 1);
    assert.throws(() => svc.outliers({ records: [{ account: 'a', views: 5000, hook: 'x' }] }), /baseline/, 'a baseline is never assumed');
    const ranked = svc.outliers({ records: [{ account: 'a', views: 50000, medianViews: 5000, hook: 'Nobody tells you your first 30 posts flop' }] });
    assert.equal(ranked.ranked[0].outlierMultiple, 10);
    assert.equal(svc.auditProfile('x', { handle: 'h' }).totalScore, 0);
});

test('post audit judges only the metrics supplied', () => {
    const { svc } = setup();
    const a = svc.auditPost('instagram', { views: 30000, medianViews: 5000, holdAt3sPercent: 40 });
    assert.equal(a.outlierMultiple, 6);
    assert.equal(a.sharesPer1k, null);
    assert.equal(a.findings.length, 2);
    assert.deepEqual(svc.auditPost('x', { views: 100 }).findings, []);
    assert.throws(() => svc.auditPost('x', {}), (e: any) => e.code === 'INVALID_INPUT');
});

test('comment triage buckets real text and never drafts a reply', () => {
    const out = triageComments([
        { id: '1', author: 'a', text: 'How much does this cost?' },
        { id: '2', author: 'b', text: 'GUIDE' },
        { id: '3', author: 'c', text: 'Why does it bleed more at night?' },
        { id: '4', author: 'd', text: 'Earn $500 daily, check my bio' },
        { id: '5', author: 'e', text: 'love this' },
    ], ['guide']);
    assert.deepEqual(out.bucketCounts, { KEYWORD: 1, LEAD: 1, QUESTION: 1, SUBSTANCE: 0, SUPPORT: 1, NOISE: 1 });
    assert.ok(out.triaged.every((t) => !('draftReply' in t)));
    assert.equal(out.contentIdeas.length, 1);
});

test('overview: every query is scoped to company and project; an empty project reports zeros, not samples', async () => {
    const { svc, calls } = setup();
    const o = await svc.overview('x', { companyId: 'c1', projectId: 'p1' });
    assert.ok(calls.length >= 7);
    for (const c of calls) {
        assert.equal(c.where.companyId, 'c1', `${c.model}.${c.op} scoped by company`);
        if (c.model !== 'project') assert.equal(c.where.projectId, 'p1', `${c.model}.${c.op} scoped by project`);
    }
    assert.deepEqual(calls.find((c) => c.model === 'socialAccount')!.where.platform, { in: ['twitter', 'x'] });
    assert.equal(o.connected, false);
    assert.deepEqual(o.pipeline, { published30d: 0, scheduledUpcoming: 0, failed30d: 0 });
    assert.deepEqual(o.queue, []);
    assert.equal(o.queueCraftScoreAvg, null);
    assert.equal(o.inbox.sampled, 0);
    assert.deepEqual(o.metrics, []);
});

test('overview: lints the real queue and triages the real inbox', async () => {
    const { svc } = setup({
        accounts: [{ id: 'a1', platform: 'instagram', accountName: 'Northwind', username: 'northwind', reauthRequired: true, isActive: true }],
        posts: [
            { id: 'post1', title: 'Gums', status: 'scheduled', scheduledFor: new Date('2026-10-09'), mediaType: 'video', content: 'ignored', variants: [{ platform: 'instagram', customContent: 'Read more at https://example.com/gums #viral' }] },
            { id: 'post2', title: 'Empty', status: 'draft', scheduledFor: null, mediaType: 'image', content: '', variants: [] },
        ],
        conversations: [
            { id: 'cv1', participantName: 'Ana', participantHandle: 'ana', lastMessageSnippet: 'What is the price for a cleaning?', lastMessageAt: new Date(), isRead: false, leadStage: null },
            { id: 'cv2', participantName: 'Bo', participantHandle: 'bo', lastMessageSnippet: 'nice', lastMessageAt: new Date(), isRead: true, leadStage: null },
        ],
        metrics: [{ socialAccountId: 'a1', source: 'unavailable', followersCount: null }, { socialAccountId: 'other', source: 'live', followersCount: 9 }],
    });
    const o = await svc.overview('instagram', { companyId: 'c1', projectId: 'p1' });
    assert.equal(o.needsReconnect, 1);
    assert.ok(o.queue[0].problems.some((p: string) => /clickable/.test(p)));
    assert.ok(o.queue[0].problems.some((p: string) => /Generic hashtags/.test(p)));
    assert.equal(o.queue[1].craftScore, null);
    assert.deepEqual(o.queue[1].problems, ['No caption yet.']);
    assert.equal(o.inbox.bucketCounts.LEAD, 1);
    assert.equal(o.inbox.priority[0].conversationId, 'cv1');
    assert.equal(o.metrics.length, 1, 'only accounts of this platform');
    assert.equal(o.metrics[0].followersCount, null);
});

test('overview: foreign or missing project is 404; AI tools pass AI_NOT_CONFIGURED through', async () => {
    const { svc } = setup({ project: null });
    await assert.rejects(svc.overview('instagram', { companyId: 'c2', projectId: 'p1' }), (e: any) => e.statusCode === 404);
    await assert.rejects(svc.overview('instagram', { companyId: '', projectId: 'p1' }), (e: any) => e.statusCode === 401);
    const ok = setup();
    await assert.rejects(ok.svc.draft('instagram', { companyId: 'c1', body: { idea: 'why gums bleed when you floss' } }), (e: any) => e.code === 'AI_NOT_CONFIGURED');
    await assert.rejects(ok.svc.repurpose('linkedin', { companyId: 'c1', body: { text: 'long text '.repeat(40) } }), (e: any) => e.code === 'AI_NOT_CONFIGURED');
});
