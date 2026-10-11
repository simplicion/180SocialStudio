/**
 * Run: npx tsx --test --test-force-exit packages/domains/social-media/test/publishing/sandbox-e2e.test.ts
 * Keyless end-to-end flow in sandbox mode (SIMULATE_SOCIAL_PUBLISHING=true) for all 8 API platforms:
 * connect → compose → validate → schedule → publish (scheduler tick) → status. In-memory DB only; DATABASE_URL is
 * pointed at an unroutable address so nothing can reach a real database. Also proves the sandbox is impossible in
 * production and that real platform limits are still enforced while simulating.
 */
process.env.DATABASE_URL = 'postgresql://sandbox-test:none@127.0.0.1:1/none';
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeDb, setTestEnv } from './fakes';

setTestEnv();
// Keyless: remove every platform credential the shared test env sets.
for (const k of ['META_APP_ID', 'META_APP_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET', 'X_CLIENT_ID', 'X_CLIENT_SECRET', 'TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET', 'INSTAGRAM_APP_ID', 'INSTAGRAM_APP_SECRET', 'THREADS_APP_ID', 'THREADS_APP_SECRET', 'PINTEREST_APP_ID', 'PINTEREST_APP_SECRET', 'REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET', 'LINKEDIN_PROVIDER_MODE', 'YOUTUBE_PROVIDER_MODE']) {
    delete process.env[k];
}

import { PublishDispatcher, SocialOAuthService, SocialPublishScheduler, isPlatformConfigured, isSimulationMode, publishingTiming, setPublishingDb, type PublishPlatform } from '../../src/publishing';
import { SimulatedPlatformPublisher, ThreadsPublisher, getPublisher } from '../../src/adapters';

const COMPANY = 'comp_sandbox_e2e';
const USER = 'user_sandbox_e2e';
const PROJECT = 'proj_sandbox_e2e';
const REDIRECT = 'https://app.test.example/social/connected';

let db: ReturnType<typeof createFakeDb>;
const realSleep = publishingTiming.sleep;

beforeEach(() => {
    process.env.SIMULATE_SOCIAL_PUBLISHING = 'true';
    process.env.NODE_ENV = 'test';
    publishingTiming.sleep = async () => undefined;
    db = createFakeDb();
    setPublishingDb(db);
    db.project.rows.push({ id: PROJECT, companyId: COMPANY, name: 'Sandbox', socialSettings: {} });
});

afterEach(() => {
    setPublishingDb(null);
    publishingTiming.sleep = realSleep;
    delete process.env.SIMULATE_SOCIAL_PUBLISHING;
    process.env.NODE_ENV = 'test';
});

const MP4 = 'https://cdn.test/media/clip.mp4';
const JPG = 'https://cdn.test/media/photo.jpg';

/** A realistic, valid draft per platform (format, media and required platform fields). */
const drafts: Record<Exclude<PublishPlatform, 'tiktok'>, { mediaType: string; mediaUrls: string[]; content: string; title?: string; meta: Record<string, any>; info?: Record<string, any> }> = {
    instagram: { mediaType: 'video', mediaUrls: [MP4], content: 'New drop #reels', meta: {}, info: { [MP4]: { width: 1080, height: 1920, durationSec: 20, mimeType: 'video/mp4' } } },
    facebook: { mediaType: 'text', mediaUrls: [], content: 'Big news for our community', meta: { link: 'https://180.example/news' } },
    threads: { mediaType: 'text', mediaUrls: [], content: 'Short thread update', meta: {} },
    youtube: { mediaType: 'video', mediaUrls: [MP4], content: 'Full walkthrough of the release', title: 'Release walkthrough', meta: { privacyStatus: 'unlisted' }, info: { [MP4]: { width: 1920, height: 1080, durationSec: 240, mimeType: 'video/mp4' } } },
    linkedin: { mediaType: 'text', mediaUrls: [], content: 'We are hiring #engineering', meta: {} },
    x: { mediaType: 'text', mediaUrls: [], content: 'Shipping today', meta: {} },
    pinterest: { mediaType: 'image', mediaUrls: [JPG], content: 'Moodboard idea', title: 'Moodboard', meta: { boardId: 'sandbox_board' } },
    reddit: { mediaType: 'text', mediaUrls: [], content: 'What do you think about our new feature?', title: 'Feedback wanted', meta: { subreddit: 'test' } },
};

async function connect(platform: PublishPlatform): Promise<string> {
    const r = await SocialOAuthService.start({ platform, companyId: COMPANY, userId: USER, projectId: PROJECT, redirectUri: REDIRECT, client: 'web' });
    const u = new URL(r.url);
    assert.equal(u.searchParams.get('status'), 'connected', `${platform}: sandbox connect should complete immediately`);
    const accountId = u.searchParams.get('accountId')!;
    const account = db.socialAccount.rows.find((a) => a.id === accountId)!;
    assert.equal(account.companyId, COMPANY);
    assert.equal(account.metadata.simulated, true, `${platform}: sandbox account must be marked simulated`);
    return accountId;
}

async function compose(platform: PublishPlatform, accountId: string, over: Partial<(typeof drafts)['x']> = {}) {
    const d = { ...drafts[platform as keyof typeof drafts], ...over };
    const post = await db.socialPost.create({
        data: { companyId: COMPANY, projectId: PROJECT, content: d.content, title: d.title, mediaType: d.mediaType, mediaUrls: d.mediaUrls, metadata: { mediaInfo: d.info || {} }, status: 'draft' },
    });
    // No publishingMode: in the sandbox, keyless platforms take the simulated API path by default (not the assisted handoff).
    await db.socialPostVariant.create({ data: { postId: post.id, platform, socialAccountId: accountId, platformMeta: { ...d.meta, ...(d.title ? { title: d.title } : {}) } } });
    return post;
}

for (const platform of Object.keys(drafts) as Array<keyof typeof drafts>) {
    test(`sandbox e2e ${platform}: connect → compose → validate → schedule → publish → status`, async () => {
        assert.equal(isPlatformConfigured(platform), false, 'test must run keyless');
        assert.equal(isSimulationMode(), true);

        const accountId = await connect(platform);
        const post = await compose(platform, accountId);

        const preview = await PublishDispatcher.preview(post.id, COMPANY);
        assert.deepEqual(preview.map((p) => p.issues).flat(), [], `${platform} draft should validate`);

        await db.socialPost.update({ where: { id: post.id }, data: { status: 'scheduled', scheduledFor: new Date(Date.now() - 1000) } });
        const tick = await SocialPublishScheduler.tick();
        assert.ok(tick.claimed.includes(post.id), `${platform}: scheduler should claim the due post (${JSON.stringify(tick.errors)})`);

        const variant = db.socialPostVariant.rows.find((v) => v.postId === post.id)!;
        assert.equal(variant.publishStatus, 'published', `${platform}: ${variant.lastError}`);
        assert.match(variant.externalId, new RegExp(`^sim_${platform}_`));
        assert.match(variant.lastError || '', /Simulated publish/);
        const stored = db.socialPost.rows.find((p) => p.id === post.id)!;
        assert.equal(stored.status, 'published');
        assert.ok(stored.publishedLinks[platform]);
        const attempt = db.socialPublishAttempt.rows.find((a) => a.postId === post.id)!;
        assert.equal(attempt.status, 'succeeded');
    });
}

test('sandbox still enforces real platform limits (each platform rejects an over-limit draft)', async () => {
    const bad: Record<keyof typeof drafts, Partial<(typeof drafts)['x']>> = {
        instagram: { info: { [MP4]: { width: 1080, height: 1920, durationSec: 1200 } } },
        facebook: { content: 'x'.repeat(63207), meta: {} },
        threads: { content: 'x'.repeat(501) },
        youtube: { title: 't'.repeat(101) },
        linkedin: { content: 'x'.repeat(3001) },
        x: { content: 'x'.repeat(281) },
        pinterest: { meta: {} },
        reddit: { title: 'r'.repeat(301) },
    };
    for (const platform of Object.keys(bad) as Array<keyof typeof drafts>) {
        const accountId = await connect(platform);
        const post = await compose(platform, accountId, bad[platform]);
        const issues = (await PublishDispatcher.preview(post.id, COMPANY)).map((p) => p.issues).flat();
        assert.ok(issues.length > 0, `${platform}: over-limit draft must be rejected even in sandbox`);

        await PublishDispatcher.publishPost(post.id, { companyId: COMPANY, userId: USER, trigger: 'manual' } as any);
        const v = db.socialPostVariant.rows.find((r) => r.postId === post.id)!;
        assert.equal(v.publishStatus, 'failed', `${platform} must not "publish" an invalid draft`);
        assert.equal(v.lastErrorCode, 'VALIDATION_FAILED');
    }
});

test('sandbox is impossible in production', async () => {
    process.env.NODE_ENV = 'production';
    assert.equal(isSimulationMode(), false);
    assert.equal(getPublisher('threads') instanceof SimulatedPlatformPublisher, false);
    const stale = new SimulatedPlatformPublisher('threads', new ThreadsPublisher());
    await assert.rejects(
        stale.publish({ platform: 'threads', postId: 'p', variantId: 'v', format: 'text', caption: 'hi', media: [], platformMeta: {}, account: { id: 'a', platformAccountId: 'u', metadata: {} } }, 't'),
        (e: any) => e.code === 'PUBLISH_NOT_CONFIGURED',
    );
    await assert.rejects(
        SocialOAuthService.start({ platform: 'threads', companyId: COMPANY, userId: USER, projectId: PROJECT, redirectUri: REDIRECT, client: 'web' }),
        (e: any) => e.code === 'PUBLISH_NOT_CONFIGURED',
    );
});

test('publishing autonomy MANUAL holds unapproved AI-authored posts; ASSISTED and human posts publish on schedule', async () => {
    const accountId = await connect('threads');
    const make = async (source: string | null, autonomy: 'MANUAL' | 'ASSISTED' | null) => {
        db.brandVoiceProfile = db.brandVoiceProfile || new (db.socialPost.constructor as any)('brandVoiceProfile');
        db.brandVoiceProfile.rows = autonomy ? [{ id: 'bv', projectId: PROJECT, companyId: COMPANY, metadata: { brand: { autonomy: { publishing: autonomy } } } }] : [];
        const post = await compose('threads', accountId);
        await db.socialPost.update({ where: { id: post.id }, data: { status: 'scheduled', scheduledFor: new Date(Date.now() - 1000), metadata: source ? { source } : {} } });
        return post.id;
    };
    const aiManual = await make('autopilot', null); // default policy = MANUAL
    let tick = await SocialPublishScheduler.tick();
    assert.ok(tick.skippedAutonomy.includes(aiManual));
    assert.equal(db.socialPost.rows.find((p) => p.id === aiManual)!.status, 'scheduled');
    assert.match(db.socialPost.rows.find((p) => p.id === aiManual)!.errorMessage, /autonomy is MANUAL/);

    const human = await make(null, 'MANUAL');
    tick = await SocialPublishScheduler.tick();
    assert.ok(tick.claimed.includes(human), 'a person-scheduled post is not gated');

    const aiAssisted = await make('autopilot', 'ASSISTED');
    tick = await SocialPublishScheduler.tick();
    assert.ok(tick.claimed.includes(aiAssisted), 'ASSISTED lets agent posts publish');

    const aiApproved = await make('autopilot', 'MANUAL');
    await db.socialPost.update({ where: { id: aiApproved }, data: { approvedVersion: 1, nextPublishAttemptAt: null } });
    tick = await SocialPublishScheduler.tick();
    assert.ok(tick.claimed.includes(aiApproved), 'an approved agent post publishes under MANUAL');
});
