/**
 * Social manager edge cases (2026-09-27): scheduling in the past, mass assignment on PUT, re-approval after edits,
 * variant edits, duplicate captions, review-link expiry/revocation/scope/audit, disconnect with scheduled posts,
 * token health and publish-failure notifications. In-memory DB only.
 *
 * Run: npx tsx --test --test-force-exit packages/domains/social-media/test/post-edge-cases.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { requestContext } from '@workspace/db';
import { FakeModel, createFakeDb } from './publishing/fakes';
import { setPublishingDb } from '../src/publishing/http';
import {
    parseScheduledFor,
    sanitizePostUpdate,
    hasSubstantiveChange,
    findDuplicateCaptions,
    reviewLinkState,
    SCHEDULE_PAST_GRACE_MS,
} from '../src/post-guards';
import { ClientReviewService } from '../src/client-review.service';
import { SocialPostService } from '../src/social-post.service';
import { SocialAccountService, accountTokenHealth } from '../src/social-account.service';
import { PublishDispatcher } from '../src/publishing/publish-dispatcher';

const DAY = 86_400_000;

function makeDb() {
    const db: any = createFakeDb();
    for (const n of ['client', 'clientReviewSession', 'postReviewComment', 'notification']) db[n] = new FakeModel(n);
    setPublishingDb(db);
    return db;
}
const asCompany = <T>(companyId: string, fn: () => Promise<T>) => requestContext.run({ companyId, userId: 'u-1' }, fn);
const code = (re: string) => (e: any) => e?.code === re;

// ── pure guards ──────────────────────────────────────────────────────────────

test('parseScheduledFor: rejects past and invalid times, allows the grace window, passes clears through', () => {
    const now = Date.parse('2026-09-27T12:00:00Z');
    assert.equal(parseScheduledFor(undefined, now), undefined);
    assert.equal(parseScheduledFor(null, now), null);
    assert.throws(() => parseScheduledFor('not a date', now), code('INVALID_SCHEDULE'));
    assert.throws(() => parseScheduledFor(new Date(now - 60 * 60 * 1000).toISOString(), now), code('SCHEDULE_IN_PAST'));
    const withinGrace = new Date(now - SCHEDULE_PAST_GRACE_MS + 1000);
    assert.equal(parseScheduledFor(withinGrace.toISOString(), now)!.getTime(), withinGrace.getTime());
    // Offsets are honoured: stored as the same UTC instant.
    assert.equal(parseScheduledFor('2026-09-28T09:00:00+05:30', now)!.toISOString(), '2026-09-28T03:30:00.000Z');
});

test('sanitizePostUpdate: strips server-owned fields and refuses approval/publish statuses', () => {
    const out = sanitizePostUpdate({ content: 'x', companyId: 'evil', approvedVersion: 9, versionNumber: 9, publishedLinks: {}, status: 'scheduled' });
    assert.deepEqual(out, { content: 'x', status: 'scheduled' });
    for (const s of ['approved', 'published', 'publishing', 'partially_published']) {
        assert.throws(() => sanitizePostUpdate({ status: s }), code('STATUS_NOT_SETTABLE'), s);
    }
});

test('hasSubstantiveChange: copy, media, first comment and variant edits count; schedule-only edits do not', () => {
    const post = { content: 'hello', mediaUrls: ['a'], metadata: { firstComment: 'c' } };
    const vars = [{ platform: 'instagram', customContent: 'hello', customMediaUrls: ['a'] }];
    assert.equal(hasSubstantiveChange(post, { scheduledFor: new Date() }, vars), false);
    assert.equal(hasSubstantiveChange(post, { content: 'hello' }, vars), false);
    assert.equal(hasSubstantiveChange(post, { content: 'hello!' }, vars), true);
    assert.equal(hasSubstantiveChange(post, { mediaUrls: ['b'] }, vars), true);
    assert.equal(hasSubstantiveChange(post, { metadata: { firstComment: 'd' } }, vars), true);
    assert.equal(hasSubstantiveChange(post, {}, vars, [{ platform: 'instagram', customContent: 'other' }]), true);
    assert.equal(hasSubstantiveChange(post, {}, vars, [...vars, { platform: 'x', customContent: 'hello' }]), true);
    assert.equal(hasSubstantiveChange(post, {}, vars, [{ platform: 'INSTAGRAM', customContent: 'hello' }]), false);
});

test('findDuplicateCaptions: same caption (ignoring case/space/links) on same account or platform within 7 days', () => {
    const when = new Date('2026-10-01T10:00:00Z');
    const caption = 'Our autumn collection is live now https://shop.example/a';
    const others = [
        { id: 'same-acc', content: 'our  AUTUMN collection is live now https://shop.example/b', scheduledFor: new Date(when.getTime() + 2 * DAY), socialAccountId: 'acc-1' },
        { id: 'same-platform', content: caption, publishedAt: new Date(when.getTime() - 3 * DAY), platforms: ['instagram'] },
        { id: 'too-old', content: caption, publishedAt: new Date(when.getTime() - 10 * DAY), socialAccountId: 'acc-1' },
        { id: 'other-channel', content: caption, scheduledFor: when, platforms: ['linkedin'] },
        { id: 'different', content: 'Something else entirely, long enough', scheduledFor: when, socialAccountId: 'acc-1' },
    ];
    const hits = findDuplicateCaptions({ id: 'p', content: caption, when, socialAccountId: 'acc-1', platforms: ['instagram'] }, others);
    assert.deepEqual(hits.map((h) => h.id).sort(), ['same-acc', 'same-platform']);
    assert.equal(findDuplicateCaptions({ id: 'p', content: 'New video!', when, platforms: ['instagram'] }, [{ id: 'q', content: 'New video!', scheduledFor: when, platforms: ['instagram'] }]).length, 0);
});

test('reviewLinkState and accountTokenHealth', () => {
    const now = Date.now();
    assert.equal(reviewLinkState({ status: 'pending', expiresAt: new Date(now + DAY) }, now), 'active');
    assert.equal(reviewLinkState({ status: 'pending', expiresAt: new Date(now - 1) }, now), 'expired');
    assert.equal(reviewLinkState({ status: 'revoked', expiresAt: new Date(now + DAY) }, now), 'revoked');

    assert.equal(accountTokenHealth({ reauthRequired: true }, now).state, 'reauth_required');
    assert.equal(accountTokenHealth({ credential: { accessTokenExpiresAt: new Date(now + 3 * DAY) } }, now).state, 'expiring_soon');
    assert.equal(accountTokenHealth({ credential: { accessTokenExpiresAt: new Date(now - DAY) } }, now).state, 'expired');
    // With a refresh token the access-token expiry is irrelevant (the proactive job refreshes it).
    assert.equal(accountTokenHealth({ credential: { refreshTokenEnc: 'enc', accessTokenExpiresAt: new Date(now + 60_000) } }, now).state, 'ok');
    assert.equal(accountTokenHealth({ credential: { refreshTokenEnc: 'enc', refreshTokenExpiresAt: new Date(now + 2 * DAY) } }, now).state, 'expiring_soon');
});

// ── posts: update / re-approval / variants ───────────────────────────────────

test('updatePost: editing an approved-then-scheduled post re-enters approval when the project requires it', async () => {
    const db = makeDb();
    await db.project.create({ data: { id: 'proj-1', companyId: 'co-1', socialSettings: { approvalRequired: true } } });
    await db.socialPost.create({
        data: { id: 'p1', companyId: 'co-1', projectId: 'proj-1', content: 'v1 copy', status: 'scheduled', versionNumber: 1, approvedVersion: 1, scheduledFor: new Date(Date.now() + DAY) },
    });
    await db.socialPostVariant.create({ data: { id: 'v-ig', postId: 'p1', platform: 'instagram', customContent: 'v1 copy' } });

    // Schedule-only change keeps the approval.
    await asCompany('co-1', () => SocialPostService.updatePost('p1', { scheduledFor: new Date(Date.now() + 2 * DAY) }, 'u-1'));
    let row = await db.socialPost.findFirst({ where: { id: 'p1' } });
    assert.equal(row.status, 'scheduled');
    assert.equal(row.versionNumber, 1);

    const updated: any = await asCompany('co-1', () => SocialPostService.updatePost('p1', { content: 'v2 copy' }, 'u-1'));
    row = await db.socialPost.findFirst({ where: { id: 'p1' } });
    assert.equal(row.versionNumber, 2);
    assert.equal(row.status, 'in_review');
    assert.equal(updated.reapprovalRequired, true);
    assert.equal(row.history.at(-1).action, 'version_bumped');
    // The dispatcher now refuses to publish the unapproved version.
    await assert.rejects(PublishDispatcher.publishPost('p1', { companyId: 'co-1', trigger: 'manual' } as any), code('APPROVAL_REQUIRED'));
});

test('updatePost: mass assignment, past schedule, published posts and cross-tenant ids are refused', async () => {
    const db = makeDb();
    await db.socialPost.create({ data: { id: 'p2', companyId: 'co-1', content: 'x', status: 'draft' } });
    await db.socialPost.create({ data: { id: 'p3', companyId: 'co-1', content: 'x', status: 'published' } });
    await db.socialPost.create({ data: { id: 'p-other', companyId: 'co-2', content: 'x', status: 'draft' } });

    await assert.rejects(asCompany('co-1', () => SocialPostService.updatePost('p2', { status: 'approved' } as any)), code('STATUS_NOT_SETTABLE'));
    await assert.rejects(asCompany('co-1', () => SocialPostService.updatePost('p2', { scheduledFor: new Date(Date.now() - DAY) })), code('SCHEDULE_IN_PAST'));
    await assert.rejects(asCompany('co-1', () => SocialPostService.updatePost('p3', { content: 'y' })), code('POST_ALREADY_PUBLISHED'));
    await assert.rejects(asCompany('co-1', () => SocialPostService.updatePost('p-other', { content: 'y' })), code('NOT_FOUND'));

    await asCompany('co-1', () => SocialPostService.updatePost('p2', { content: 'y', companyId: 'co-2', approvedVersion: 1 } as any));
    const row = await db.socialPost.findFirst({ where: { id: 'p2' } });
    assert.equal(row.companyId, 'co-1');
    assert.equal(row.approvedVersion, null);
    assert.equal(row.content, 'y');
});

test('updatePost: variants sent on update are applied, published variants are left alone', async () => {
    const db = makeDb();
    await db.socialPost.create({ data: { id: 'p4', companyId: 'co-1', content: 'base', status: 'draft' } });
    await db.socialPostVariant.create({ data: { id: 'v-li', postId: 'p4', platform: 'linkedin', customContent: 'old li' } });
    await db.socialPostVariant.create({ data: { id: 'v-x', postId: 'p4', platform: 'x', customContent: 'old x' } });
    await db.socialPostVariant.create({ data: { id: 'v-yt', postId: 'p4', platform: 'youtube', customContent: 'live', publishStatus: 'published' } });

    await asCompany('co-1', () =>
        SocialPostService.updatePost('p4', { variants: [{ platform: 'linkedin', customContent: 'new li' }, { platform: 'threads', customContent: 'th' }, { platform: 'youtube', customContent: 'edited' }] }),
    );
    const vs = await db.socialPostVariant.findMany({ where: { postId: 'p4' } });
    const by = Object.fromEntries(vs.map((v: any) => [v.platform, v]));
    assert.equal(by.linkedin.customContent, 'new li');
    assert.equal(by.threads.customContent, 'th');
    assert.equal(by.x, undefined, 'pending variant dropped from the list is removed');
    assert.equal(by.youtube.customContent, 'live', 'published variant is never rewritten');
});

// ── client review links ──────────────────────────────────────────────────────

async function seedReview(db: any, overrides: Record<string, any> = {}) {
    await db.client.create({ data: { id: 'cl-1', companyId: 'co-1', name: 'Client' } });
    await db.clientReviewSession.create({
        data: {
            id: 's-1', companyId: 'co-1', clientId: 'cl-1', token: 'tok-1', name: 'Oct',
            startDate: new Date(Date.now() - DAY), endDate: new Date(Date.now() + 30 * DAY), expiresAt: new Date(Date.now() + 7 * DAY), status: 'pending',
            ...overrides,
        },
    });
    const at = new Date(Date.now() + 2 * DAY);
    await db.socialPost.create({ data: { id: 'rp-1', companyId: 'co-1', clientId: 'cl-1', content: 'a', status: 'in_review', versionNumber: 3, scheduledFor: at } });
    await db.socialPost.create({ data: { id: 'rp-pub', companyId: 'co-1', clientId: 'cl-1', content: 'b', status: 'published', scheduledFor: at } });
    await db.socialPost.create({ data: { id: 'rp-fail', companyId: 'co-1', clientId: 'cl-1', content: 'c', status: 'failed', scheduledFor: at } });
    await db.socialPost.create({ data: { id: 'other-co', companyId: 'co-2', clientId: 'cl-9', content: 'd', status: 'in_review', scheduledFor: at } });
}

test('review links: expired and revoked links cannot view, comment or approve (410)', async () => {
    const db = makeDb();
    await seedReview(db, { expiresAt: new Date(Date.now() - 1000) });
    await assert.rejects(ClientReviewService.getReviewSessionByToken('tok-1'), (e: any) => e.code === 'REVIEW_LINK_EXPIRED' && e.statusCode === 410);
    await assert.rejects(ClientReviewService.batchApproveSession('tok-1'), code('REVIEW_LINK_EXPIRED'));
    await assert.rejects(ClientReviewService.addPostComment('tok-1', 'rp-1', 'hi'), code('REVIEW_LINK_EXPIRED'));
    assert.equal((await db.socialPost.findFirst({ where: { id: 'rp-1' } })).status, 'in_review');

    await db.clientReviewSession.updateMany({ where: { id: 's-1' }, data: { expiresAt: new Date(Date.now() + DAY) } });
    await assert.rejects(asCompany('co-2', () => ClientReviewService.revokeSession('s-1')), code('NOT_FOUND'));
    await asCompany('co-1', () => ClientReviewService.revokeSession('s-1', 'u-1'));
    await assert.rejects(ClientReviewService.getReviewSessionByToken('tok-1'), code('REVIEW_LINK_REVOKED'));
    await assert.rejects(ClientReviewService.getReviewSessionByToken('nope'), code('REVIEW_LINK_INVALID'));
    const listed = await asCompany('co-1', () => ClientReviewService.listSessions({}));
    assert.equal(listed[0].linkState, 'revoked');
});

test('review comments: only posts inside the session, always authored as the client, logged in history', async () => {
    const db = makeDb();
    await seedReview(db);
    await assert.rejects(ClientReviewService.addPostComment('tok-1', 'other-co', 'sneaky'), code('NOT_FOUND'));
    await assert.rejects(ClientReviewService.addPostComment('tok-1', 'rp-1', '   '), code('VALIDATION_FAILED'));
    const c = await ClientReviewService.addPostComment('tok-1', 'rp-1', 'Change the hook', 'Dana');
    assert.equal(c.authorType, 'client');
    assert.equal((await db.clientReviewSession.findFirst({ where: { id: 's-1' } })).status, 'revisions_requested');
    assert.equal((await db.socialPost.findFirst({ where: { id: 'rp-1' } })).history.at(-1).action, 'client_comment');
});

test('batch approve: skips published/failed posts, pins the approved version, refuses stale views', async () => {
    const db = makeDb();
    await seedReview(db);
    await assert.rejects(ClientReviewService.batchApproveSession('tok-1', undefined, { 'rp-1': 2 }), code('REVIEW_STALE'));

    const r = await ClientReviewService.batchApproveSession('tok-1', 'ok', { 'rp-1': 3 });
    assert.equal(r.approvedCount, 1);
    const p = await db.socialPost.findFirst({ where: { id: 'rp-1' } });
    assert.equal(p.status, 'approved');
    assert.equal(p.approvedVersion, 3);
    assert.equal(p.history.at(-1).action, 'approved');
    assert.equal((await db.socialPost.findFirst({ where: { id: 'rp-pub' } })).status, 'published');
    assert.equal((await db.socialPost.findFirst({ where: { id: 'rp-fail' } })).status, 'failed');
    assert.equal((await db.socialPost.findFirst({ where: { id: 'other-co' } })).status, 'in_review');
});

test('createReviewSession: client must belong to the caller, lifetime is capped, postIds are tenant-scoped', async () => {
    const db = makeDb();
    await db.client.create({ data: { id: 'cl-1', companyId: 'co-1', name: 'Mine' } });
    await db.client.create({ data: { id: 'cl-x', companyId: 'co-2', name: 'Theirs' } });
    await db.socialPost.create({ data: { id: 'foreign', companyId: 'co-2', content: 'x', status: 'draft' } });
    const base = { name: 'n', startDate: new Date().toISOString(), endDate: new Date(Date.now() + DAY).toISOString() };
    await assert.rejects(asCompany('co-1', () => ClientReviewService.createReviewSession({ ...base, clientId: 'cl-x' })), code('NOT_FOUND'));
    const s: any = await asCompany('co-1', () => ClientReviewService.createReviewSession({ ...base, clientId: 'cl-1', expiresInDays: 10_000, postIds: ['foreign'] }));
    assert.ok(new Date(s.expiresAt).getTime() <= Date.now() + 90 * DAY + 1000);
    assert.equal((await db.socialPost.findFirst({ where: { id: 'foreign' } })).status, 'draft');
});

// ── accounts & failure visibility ────────────────────────────────────────────

test('disconnecting an account pauses its scheduled posts with a reason; published ones are untouched', async () => {
    const db = makeDb();
    await db.socialAccount.create({ data: { id: 'acc-1', companyId: 'co-1', platform: 'instagram', accountName: 'Brand IG' } });
    await db.socialPost.create({ data: { id: 'sp-1', companyId: 'co-1', status: 'scheduled', socialAccountId: 'acc-1', content: 'a' } });
    await db.socialPost.create({ data: { id: 'sp-2', companyId: 'co-1', status: 'approved', content: 'b' } });
    await db.socialPostVariant.create({ data: { postId: 'sp-2', platform: 'instagram', socialAccountId: 'acc-1' } });
    await db.socialPost.create({ data: { id: 'sp-3', companyId: 'co-1', status: 'published', socialAccountId: 'acc-1', content: 'c' } });

    const r: any = await asCompany('co-1', () => SocialAccountService.disconnectAccount('acc-1'));
    assert.equal(r.pausedPosts, 2);
    const p1 = await db.socialPost.findFirst({ where: { id: 'sp-1' } });
    assert.equal(p1.status, 'draft');
    assert.match(p1.errorMessage, /Brand IG.*disconnected/);
    assert.equal(p1.history.at(-1).previousStatus, 'scheduled');
    assert.equal((await db.socialPost.findFirst({ where: { id: 'sp-3' } })).status, 'published');
    assert.equal((await db.socialAccount.findFirst({ where: { id: 'acc-1' } })).isActive, false);
});

test('scheduler final failure notifies the author with the provider error; manual publish and pending retries do not', async () => {
    const db = makeDb();
    await db.socialPost.create({ data: { id: 'fp', companyId: 'co-1', projectId: 'proj-1', createdById: 'u-9', title: 'Launch', content: 'x', status: 'publishing', publishAttemptCount: 9 } });
    await db.socialPostVariant.create({ data: { postId: 'fp', platform: 'instagram', publishStatus: 'failed', lastError: 'Media aspect ratio not supported', lastErrorRetryable: false } });

    await PublishDispatcher.summarize('fp', { companyId: 'co-1', trigger: 'manual' } as any);
    assert.equal(db.notification.rows.length, 0);

    await PublishDispatcher.summarize('fp', { companyId: 'co-1', trigger: 'scheduler' } as any);
    assert.equal(db.notification.rows.length, 1);
    const n = db.notification.rows[0];
    assert.equal(n.userId, 'u-9');
    assert.equal(n.type, 'social_publish_failed');
    assert.match(n.message, /instagram: Media aspect ratio not supported/);
    assert.equal(n.link, '/social-projects/proj-1?post=fp');
});

// ── platform rules & no fake success ─────────────────────────────────────────

test('platform rules: Pinterest needs a board, YouTube needs a title; legacy helpers never fake a publish without a token', async () => {
    const { getPublisher } = await import('../src/adapters/registry');
    const { MetaAdapter } = await import('../src/adapters/meta.adapter');
    const { LinkedInAdapter } = await import('../src/adapters/linkedin.adapter');
    const base = { postId: 'p', variantId: 'v', account: { id: 'a', platformAccountId: 'pa', metadata: {} }, thumbnailUrl: undefined } as any;
    const pin = getPublisher('pinterest').validate({ ...base, platform: 'pinterest', format: 'image', caption: 'c', media: [{ kind: 'image', url: 'https://x/y.jpg' }], platformMeta: {} });
    assert.ok(pin.some((i) => /board/i.test(i)));
    const yt = getPublisher('youtube').validate({ ...base, platform: 'youtube', format: 'video', caption: '', media: [{ kind: 'video', url: 'https://x/y.mp4' }], platformMeta: {} });
    assert.ok(yt.some((i) => /need a title/i.test(i)));
    await assert.rejects(MetaAdapter.publishInstagramMedia({ accessToken: '', igUserId: 'ig', caption: 'c', videoUrl: 'https://x/y.mp4' } as any), code('REAUTH_REQUIRED'));
    await assert.rejects(LinkedInAdapter.publishPost({ accessToken: 'real-token', authorUrn: '', commentary: 'c' } as any), code('ACCOUNT_NOT_CONNECTED'));
});
