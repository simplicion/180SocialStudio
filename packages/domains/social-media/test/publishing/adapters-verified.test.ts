/**
 * Run: npx tsx --test --test-force-exit packages/domains/social-media/test/publishing/adapters-verified.test.ts
 * Behaviour verified against the official platform docs on 2026-09-27 (see PUBLISHING.md §6): request builders,
 * provider error mapping and async-processing polling for every API publisher. Mocked fetch only; no DB, no network.
 */
import test, { afterEach, before } from 'node:test';
import assert from 'node:assert/strict';
import { FetchMock, bytes, json, setTestEnv } from './fakes';

setTestEnv();

import { publishingTiming } from '../../src/publishing';
import { PublishError } from '../../src/publishing/errors';
import { isLinkedInVersionSunset, linkedInApiVersion, LINKEDIN_DEFAULT_API_VERSION } from '../../src/publishing/linkedin-version';
import {
    FacebookPublisher,
    InstagramPublisher,
    LinkedInPublisher,
    PUBLISH_CAPABILITIES,
    PinterestPublisher,
    RedditPublisher,
    ThreadsPublisher,
    XPublisher,
    YouTubePublisher,
    escapeLinkedInCommentary,
    redditUserAgent,
} from '../../src/adapters';
import type { PlatformPublisher, PublishInput } from '../../src/adapters/types';

before(() => {
    publishingTiming.sleep = async () => undefined;
    process.env.IG_CONTAINER_POLL_ATTEMPTS = '2';
    process.env.THREADS_CONTAINER_POLL_ATTEMPTS = '2';
    process.env.FB_VIDEO_POLL_ATTEMPTS = '2';
});

let mock: FetchMock | null = null;
afterEach(() => {
    mock?.restore();
    mock = null;
});

const VIDEO = 'https://cdn.test/v/clip.mp4';
const IMG = (n: number) => `https://cdn.test/i/${n}.jpg`;
const path = (u: string) => new URL(u).pathname;

const input = (over: Partial<PublishInput>): PublishInput => ({
    platform: 'instagram',
    postId: 'p1',
    variantId: 'v1',
    format: 'video',
    caption: 'Hello world',
    media: [{ url: VIDEO, kind: 'video', width: 1080, height: 1920, durationSec: 30 }],
    platformMeta: {},
    account: { id: 'a1', platformAccountId: 'ACC', username: 'brand', accountName: 'Brand', metadata: {} },
    ...over,
});

const rejects = async (p: Promise<unknown>, check: (e: PublishError) => void) => {
    try {
        await p;
    } catch (e: any) {
        assert.ok(e instanceof PublishError, `expected PublishError, got ${e?.stack || e}`);
        check(e);
        return;
    }
    assert.fail('expected rejection');
};

// ── Instagram ────────────────────────────────────────────────────────────────

test('Instagram Story: STORIES container, no caption, no first comment', async () => {
    mock = new FetchMock((c) => {
        const p = path(c.url);
        if (p.endsWith('/ACC/media')) return json(200, { id: 'ST1' });
        if (p.endsWith('/ST1')) return json(200, { status_code: 'FINISHED' });
        if (p.endsWith('/ACC/media_publish')) return json(200, { id: 'M1' });
        if (p.endsWith('/M1')) return json(200, { permalink: 'https://www.instagram.com/stories/brand/M1/' });
    }).install();
    const ig = new InstagramPublisher();
    const story = input({ platformMeta: { instagramFormat: 'story' }, media: [{ url: VIDEO, kind: 'video', durationSec: 20, width: 1080, height: 1920 }] });
    assert.deepEqual(ig.validate(story), []);
    assert.match(ig.validate({ ...story, firstComment: 'hi' }).join(), /Stories cannot have a first comment/);
    assert.match(ig.validate({ ...story, media: [{ url: VIDEO, kind: 'video', durationSec: 75 }] }).join(), /at most 60s/);
    const out = await ig.publish(story, 'tok');
    assert.equal(out.state, 'published');
    assert.deepEqual(mock.calls[0].body, { media_type: 'STORIES', video_url: VIDEO });
});

test('Instagram limits: Reel ≤ 300 MB, JPEG only, alt text on images', async () => {
    const ig = new InstagramPublisher();
    assert.match(ig.validate(input({ media: [{ url: VIDEO, kind: 'video', durationSec: 30, sizeBytes: 400 * 1024 * 1024 }] })).join(), /300 MB/);
    assert.match(ig.validate(input({ format: 'image', media: [{ url: 'https://cdn.test/a.png', kind: 'image' }] })).join(), /JPEG/);
    assert.match(ig.validate(input({ format: 'carousel', media: Array.from({ length: 11 }, (_, i) => ({ url: IMG(i), kind: 'image' as const })) })).join(), /2 to 10/);

    mock = new FetchMock((c) => {
        const p = path(c.url);
        if (p.endsWith('/ACC/media')) return json(200, { id: 'C1' });
        if (p.endsWith('/C1')) return json(200, { status_code: 'FINISHED' });
        if (p.endsWith('/ACC/media_publish')) return json(200, { id: 'M2' });
        if (p.endsWith('/M2')) return json(200, { permalink: 'https://www.instagram.com/p/M2/' });
    }).install();
    await ig.publish(input({ format: 'image', media: [{ url: IMG(1), kind: 'image', altText: 'A red bike' }] }), 'tok');
    assert.equal(mock.calls[0].body.alt_text, 'A red bike');
});

test('Instagram async processing: IN_PROGRESS → processing outcome → checkStatus publishes when FINISHED', async () => {
    let status = 'IN_PROGRESS';
    mock = new FetchMock((c) => {
        const p = path(c.url);
        if (p.endsWith('/ACC/media')) return json(200, { id: 'R1' });
        if (p.endsWith('/R1')) return json(200, { status_code: status });
        if (p.endsWith('/ACC/media_publish')) return json(200, { id: 'M3' });
        if (p.endsWith('/M3')) return json(200, { permalink: 'https://www.instagram.com/reel/M3/' });
    }).install();
    const ig = new InstagramPublisher();
    const reel = input({});
    const first = await ig.publish(reel, 'tok');
    assert.equal(first.state, 'processing');
    assert.equal(first.externalId, 'container:R1');
    assert.equal(mock.calls.filter((c) => path(c.url).endsWith('/media_publish')).length, 0);

    assert.equal(await ig.checkStatus(reel, first.externalId, 'tok'), null);
    status = 'FINISHED';
    const done = await ig.checkStatus(reel, first.externalId, 'tok');
    assert.equal(done?.state, 'published');
    assert.equal(done?.externalId, 'M3');
    assert.equal(done?.url, 'https://www.instagram.com/reel/M3/');
});

test('Instagram errors: ERROR container carries Meta status; publishing limit is retryable; expired token → reauth', async () => {
    const ig = new InstagramPublisher();
    mock = new FetchMock((c) => {
        const p = path(c.url);
        if (p.endsWith('/ACC/media')) return json(200, { id: 'E1' });
        if (p.endsWith('/E1')) return json(200, { status_code: 'ERROR', status: 'Error: 2207026 unsupported video format' });
    }).install();
    await rejects(ig.publish(input({}), 'tok'), (e) => {
        assert.equal(e.code, 'PROVIDER_ERROR');
        assert.match(e.message, /2207026/);
    });
    mock.restore();

    mock = new FetchMock(() => json(400, { error: { message: 'Application request limit reached', code: 4, error_subcode: 2207042 } })).install();
    await rejects(ig.publish(input({}), 'tok'), (e) => {
        assert.equal(e.code, 'PROVIDER_ERROR');
        assert.equal(e.retryable, true);
        assert.equal(e.details?.metaSubcode, 2207042);
    });
    mock.restore();

    mock = new FetchMock(() => json(400, { error: { message: 'Session has expired', code: 190 } })).install();
    await rejects(ig.publish(input({}), 'tok'), (e) => assert.equal(e.code, 'REAUTH_REQUIRED'));
});

// ── Facebook ─────────────────────────────────────────────────────────────────

test('Facebook: link post, Reel processing → checkStatus, processing error surfaces', async () => {
    let vs = 'processing';
    mock = new FetchMock((c) => {
        const p = path(c.url);
        if (p.endsWith('/PAGE/feed')) return json(200, { id: 'PAGE_1' });
        if (p.endsWith('/PAGE/video_reels')) return json(200, c.body.upload_phase === 'start' ? { video_id: 'RV' } : { success: true });
        if (c.url.startsWith('https://rupload.facebook.com/')) return json(200, { success: true });
        if (p.endsWith('/RV')) return json(200, { status: { video_status: vs, processing_phase: { status: vs === 'error' ? 'error' : 'in_progress', errors: [{ message: 'Bad codec' }] } } });
    }).install();
    const fb = new FacebookPublisher();
    const acct = { id: 'a', platformAccountId: 'PAGE', metadata: {} };

    const link = input({ platform: 'facebook', account: acct, format: 'text', media: [], caption: 'Read this', platformMeta: { link: 'https://180.example/blog' } });
    assert.deepEqual(fb.validate(link), []);
    await fb.publish(link, 'tok');
    assert.deepEqual(mock.calls[0].body, { message: 'Read this', link: 'https://180.example/blog' });
    assert.match(fb.validate({ ...link, format: 'image', media: [{ url: IMG(1), kind: 'image' }] }).join(), /only available on text posts/);

    const reel = input({ platform: 'facebook', account: acct, platformMeta: { facebookFormat: 'reel' }, media: [{ url: VIDEO, kind: 'video', durationSec: 30, width: 1080, height: 1920 }] });
    const out = await fb.publish(reel, 'tok');
    assert.equal(out.state, 'processing');
    assert.equal(out.url, null);
    assert.equal(await fb.checkStatus(reel, out.externalId, 'tok'), null);
    vs = 'ready';
    const done = await fb.checkStatus(reel, out.externalId, 'tok');
    assert.equal(done?.state, 'published');
    assert.equal(done?.url, 'https://www.facebook.com/reel/RV');
    vs = 'error';
    await rejects(fb.checkStatus(reel, out.externalId, 'tok'), (e) => assert.match(e.message, /Bad codec/));
    assert.match(fb.validate({ ...reel, media: [{ url: VIDEO, kind: 'video', durationSec: 120, width: 1080, height: 1920 }] }).join(), /at most 90s/);
});

// ── Threads ──────────────────────────────────────────────────────────────────

test('Threads: carousel up to 20, ERROR container never published, permalink + reply', async () => {
    const th = new ThreadsPublisher();
    const acct = { id: 'a', platformAccountId: 'U1', username: 'brand', metadata: {} };
    const items = (n: number) => Array.from({ length: n }, (_, i) => ({ url: IMG(i), kind: 'image' as const }));
    assert.deepEqual(th.validate(input({ platform: 'threads', account: acct, format: 'carousel', media: items(20) })), []);
    assert.match(th.validate(input({ platform: 'threads', account: acct, format: 'carousel', media: items(21) })).join(), /2 and 20/);
    assert.match(th.validate(input({ platform: 'threads', account: acct, format: 'image', media: [{ url: 'https://cdn.test/x.gif', kind: 'image' }] })).join(), /JPEG or PNG/);

    mock = new FetchMock((c) => {
        const p = path(c.url);
        if (p === '/v1.0/U1/threads') return json(200, { id: 'BAD' });
        if (p === '/v1.0/BAD') return json(200, { status: 'ERROR', error_message: 'FAILED_DOWNLOADING_VIDEO' });
    }).install();
    await rejects(th.publish(input({ platform: 'threads', account: acct }), 'tok'), (e) => assert.match(e.message, /FAILED_DOWNLOADING_VIDEO/));
    assert.equal(mock.calls.filter((c) => path(c.url).endsWith('threads_publish')).length, 0);
    mock.restore();

    mock = new FetchMock((c) => {
        const p = path(c.url);
        if (p === '/v1.0/U1/threads') return json(200, { id: c.body.reply_to_id ? 'REPLYC' : 'OK1' });
        if (p === '/v1.0/OK1') return json(200, { status: 'FINISHED' });
        if (p === '/v1.0/U1/threads_publish') return json(200, { id: c.body.creation_id === 'REPLYC' ? 'REPLY1' : 'POST1' });
        if (p === '/v1.0/POST1') return json(200, { permalink: 'https://www.threads.com/@brand/post/Abc' });
    }).install();
    const out = await th.publish(input({ platform: 'threads', account: acct, firstComment: 'More below' }), 'tok');
    assert.equal(out.url, 'https://www.threads.com/@brand/post/Abc');
    assert.equal(out.warning, undefined);
    assert.equal(mock.calls.find((c) => c.body?.reply_to_id)?.body.reply_to_id, 'POST1');
});

test('Threads async processing: IN_PROGRESS video → processing → checkStatus publishes', async () => {
    let status = 'IN_PROGRESS';
    mock = new FetchMock((c) => {
        const p = path(c.url);
        if (p === '/v1.0/U1/threads') return json(200, { id: 'V1' });
        if (p === '/v1.0/V1') return json(200, { status });
        if (p === '/v1.0/U1/threads_publish') return json(200, { id: 'P9' });
        if (p === '/v1.0/P9') return json(200, { permalink: 'https://www.threads.com/@b/post/P9' });
    }).install();
    const th = new ThreadsPublisher();
    const inp = input({ platform: 'threads', account: { id: 'a', platformAccountId: 'U1', metadata: {} } });
    const out = await th.publish(inp, 'tok');
    assert.equal(out.state, 'processing');
    status = 'FINISHED';
    const done = await th.checkStatus(inp, out.externalId, 'tok');
    assert.equal(done?.externalId, 'P9');
});

// ── YouTube ──────────────────────────────────────────────────────────────────

test('YouTube: quotaExceeded is a clear non-retryable error; rateLimit is retryable', async () => {
    const yt = new YouTubePublisher();
    const reason = { r: 'quotaExceeded' };
    mock = new FetchMock((c) => {
        if (c.url.startsWith('https://cdn.test/')) return bytes(1000);
        if (c.url.includes('uploadType=resumable')) return json(403, { error: { code: 403, message: 'quota', errors: [{ reason: reason.r }] } });
    }).install();
    const vid = input({ platform: 'youtube', title: 'Launch' });
    await rejects(yt.publish(vid, 'tok'), (e) => {
        assert.equal(e.retryable, false);
        assert.match(e.message, /daily quota/);
    });
    reason.r = 'rateLimitExceeded';
    await rejects(yt.publish(vid, 'tok'), (e) => assert.equal(e.retryable, true));
});

test('YouTube: unverified project forces private → warning; publishAt forces private + future check', async () => {
    const yt = new YouTubePublisher();
    mock = new FetchMock((c) => {
        if (c.url.startsWith('https://cdn.test/')) return bytes(1000);
        if (c.url.includes('uploadType=resumable')) return new Response('', { status: 200, headers: { location: 'https://upload.test/s1' } });
        if (c.url === 'https://upload.test/s1') return json(200, { id: 'YT1', status: { privacyStatus: 'private' } });
    }).install();
    const out = await yt.publish(input({ platform: 'youtube', title: 'Launch', media: [{ url: VIDEO, kind: 'video', width: 1920, height: 1080, durationSec: 600 }] }), 'tok');
    assert.match(out.warning || '', /not verified/);
    assert.equal(out.url, 'https://www.youtube.com/watch?v=YT1');

    const sched = input({ platform: 'youtube', title: 'Later', platformMeta: { publishAt: new Date(Date.now() + 86400000).toISOString(), privacyStatus: 'public' } });
    const meta = yt.buildMetadata(sched);
    assert.equal(meta.status.privacyStatus, 'private');
    assert.ok((meta.status as any).publishAt);
    assert.match(yt.validate({ ...sched, platformMeta: { publishAt: '2001-01-01T00:00:00Z' } }).join(), /future/);
    assert.match(yt.validate(input({ platform: 'youtube', title: 'x', platformMeta: { isShort: true }, media: [{ url: VIDEO, kind: 'video', durationSec: 200, width: 1080, height: 1920 }] })).join(), /at most 180s/);
});

// ── LinkedIn ─────────────────────────────────────────────────────────────────

test('LinkedIn: current LinkedIn-Version header, hashtags kept, reserved chars escaped, sunset detection', async () => {
    delete process.env.LINKEDIN_API_VERSION;
    assert.equal(linkedInApiVersion(), LINKEDIN_DEFAULT_API_VERSION);
    assert.equal(isLinkedInVersionSunset('202507', new Date('2026-09-27')), true);
    assert.equal(isLinkedInVersionSunset(LINKEDIN_DEFAULT_API_VERSION, new Date('2026-09-27')), false);
    assert.equal(escapeLinkedInCommentary('Ship it #launch (v2) @team # alone'), 'Ship it #launch \\(v2\\) \\@team \\# alone');

    mock = new FetchMock((c) => {
        if (c.url.endsWith('/rest/posts')) return new Response('', { status: 201, headers: { 'x-restli-id': 'urn:li:share:9' } });
    }).install();
    const li = new LinkedInPublisher();
    const out = await li.publish(input({ platform: 'linkedin', format: 'text', media: [], caption: 'Hi #news', account: { id: 'a', platformAccountId: 'urn:li:organization:5', metadata: {} } }), 't');
    assert.equal(out.url, 'https://www.linkedin.com/feed/update/urn:li:share:9');
    assert.equal(mock.calls[0].headers['linkedin-version'], LINKEDIN_DEFAULT_API_VERSION);
    assert.equal(mock.calls[0].headers['x-restli-protocol-version'], '2.0.0');
    assert.equal(mock.calls[0].body.author, 'urn:li:organization:5');
    assert.equal(mock.calls[0].body.commentary, 'Hi #news');
});

test('LinkedIn limits and document processing failure', async () => {
    const li = new LinkedInPublisher();
    const acct = { id: 'a', platformAccountId: 'urn:li:person:p', metadata: {} };
    assert.match(li.validate(input({ platform: 'linkedin', account: acct, media: [{ url: VIDEO, kind: 'video', durationSec: 60, sizeBytes: 600 * 1024 * 1024 }] })).join(), /500 MB/);
    assert.match(li.validate(input({ platform: 'linkedin', account: { ...acct, platformAccountId: 'person-without-urn' }, format: 'text', media: [] })).join(), /author URN/);
    assert.match(li.validate(input({ platform: 'linkedin', account: acct, format: 'carousel', media: Array.from({ length: 21 }, (_, i) => ({ url: IMG(i), kind: 'image' as const })) })).join(), /2 to 20/);

    mock = new FetchMock((c) => {
        if (c.url.startsWith('https://cdn.test/')) return bytes(100, 'application/pdf');
        if (c.url.includes('/rest/documents?action=initializeUpload')) return json(200, { value: { uploadUrl: 'https://up.li/doc', document: 'urn:li:document:D9' } });
        if (c.url.startsWith('https://up.li/')) return new Response('', { status: 201 });
        if (c.url.includes('/rest/documents/') && c.method === 'GET') return json(200, { status: 'PROCESSING_FAILED', processingFailureReason: 'Too many pages' });
    }).install();
    await rejects(li.publish(input({ platform: 'linkedin', account: acct, format: 'document', media: [{ url: 'https://cdn.test/deck.pdf', kind: 'document' }] }), 't'), (e) => assert.match(e.message, /Too many pages/));
    assert.equal(mock.calls.some((c) => c.url.endsWith('/rest/posts')), false);
});

// ── Pinterest ────────────────────────────────────────────────────────────────

test('Pinterest video Pin: register media → multipart upload → status poll → video_id Pin', async () => {
    let polls = 0;
    mock = new FetchMock((c) => {
        const u = new URL(c.url);
        if (c.url.startsWith('https://cdn.test/')) return bytes(2048);
        if (u.pathname === '/v5/media' && c.method === 'POST') return json(201, { media_id: '12345', media_type: 'video', upload_url: 'https://pinterest-media-upload.s3.test/', upload_parameters: { key: 'k1', policy: 'p1' } });
        if (u.host === 'pinterest-media-upload.s3.test') return new Response(null, { status: 204 });
        if (u.pathname === '/v5/media/12345') return json(200, { media_id: '12345', status: ++polls < 2 ? 'processing' : 'succeeded' });
        if (u.pathname === '/v5/pins') return json(201, { id: 'PIN9' });
    }).install();
    const pin = new PinterestPublisher();
    const vid = input({ platform: 'pinterest', title: 'How-to', platformMeta: { boardId: 'B1', link: 'https://180.example' }, thumbnailUrl: 'https://cdn.test/cover.jpg' });
    assert.deepEqual(pin.validate(vid), []);
    const out = await pin.publish(vid, 'tok');
    assert.equal(out.externalId, 'PIN9');
    const upload = mock.calls.find((c) => c.url.startsWith('https://pinterest-media-upload'))!;
    assert.ok(upload.body instanceof FormData);
    assert.equal((upload.body as FormData).get('key'), 'k1');
    const create = mock.calls.find((c) => c.url.endsWith('/v5/pins'))!;
    assert.deepEqual(create.body.media_source, { source_type: 'video_id', media_id: '12345', cover_image_url: 'https://cdn.test/cover.jpg' });
    assert.equal(create.body.board_id, 'B1');
    assert.equal(create.body.link, 'https://180.example');
});

test('Pinterest carousel (2–5 images) and 800-char description; failed video processing', async () => {
    const pin = new PinterestPublisher();
    const imgs = (n: number) => Array.from({ length: n }, (_, i) => ({ url: IMG(i), kind: 'image' as const }));
    const base = input({ platform: 'pinterest', format: 'carousel', media: imgs(3), platformMeta: { boardId: 'B1' } });
    assert.deepEqual(pin.validate(base), []);
    assert.match(pin.validate({ ...base, media: imgs(6) }).join(), /2 to 5/);
    assert.deepEqual(pin.validate({ ...base, caption: 'd'.repeat(800) }), []);
    assert.match(pin.validate({ ...base, caption: 'd'.repeat(801) }).join(), /800/);

    mock = new FetchMock((c) => {
        const u = new URL(c.url);
        if (u.pathname === '/v5/pins') return json(201, { id: 'PINC' });
    }).install();
    await pin.publish(base, 'tok');
    assert.equal(mock.calls[0].body.media_source.source_type, 'multiple_image_urls');
    assert.equal(mock.calls[0].body.media_source.items.length, 3);
    mock.restore();

    mock = new FetchMock((c) => {
        const u = new URL(c.url);
        if (c.url.startsWith('https://cdn.test/')) return bytes(10);
        if (u.pathname === '/v5/media' && c.method === 'POST') return json(201, { media_id: '7', upload_url: 'https://s3.test/', upload_parameters: {} });
        if (u.host === 's3.test') return new Response(null, { status: 204 });
        if (u.pathname === '/v5/media/7') return json(200, { status: 'failed' });
    }).install();
    await rejects(pin.publish(input({ platform: 'pinterest', platformMeta: { boardId: 'B1' } }), 'tok'), (e) => assert.match(e.message, /could not process the video/));
});

// ── Reddit ───────────────────────────────────────────────────────────────────

test('Reddit: self/link params, nsfw/flair, error mapping (validation vs RATELIMIT), descriptive UA', async () => {
    const answers: any[] = [
        json(200, { json: { errors: [], data: { name: 't3_x1', url: 'https://www.reddit.com/r/test/comments/x1/t/' } } }),
        json(200, { json: { errors: [['SUBREDDIT_NOEXIST', "that subreddit doesn't exist", 'sr']] } }),
        json(200, { json: { errors: [['RATELIMIT', 'you are doing that too much. try again in 5 minutes.', 'ratelimit']] } }),
    ];
    mock = new FetchMock(() => answers.shift()).install();
    const rd = new RedditPublisher();
    const self = input({ platform: 'reddit', format: 'text', media: [], title: 'Question', caption: 'Body text', platformMeta: { subreddit: 'r/test', nsfw: true, flairId: 'f-1' } });
    assert.deepEqual(rd.validate(self), []);
    const out = await rd.publish(self, 'tok');
    assert.equal(out.externalId, 't3_x1');
    assert.equal(out.meta?.postedAs, 'self');
    const sent = mock.calls[0].body as string;
    const params = new URLSearchParams(sent);
    assert.equal(params.get('kind'), 'self');
    assert.equal(params.get('sr'), 'test');
    assert.equal(params.get('nsfw'), 'true');
    assert.equal(params.get('flair_id'), 'f-1');
    assert.match(mock.calls[0].headers['user-agent'], /^server:com\.workspace180\.social:/);
    assert.equal(redditUserAgent(), mock.calls[0].headers['user-agent']);

    await rejects(rd.publish(self, 'tok'), (e) => {
        assert.equal(e.code, 'VALIDATION_FAILED');
        assert.equal(e.retryable, false);
    });
    await rejects(rd.publish(self, 'tok'), (e) => assert.equal(e.retryable, true));
    assert.match(rd.validate({ ...self, platformMeta: { subreddit: 'bad name!' } }).join(), /not a valid subreddit/);
    assert.match(rd.validate({ ...self, format: 'carousel', media: [{ url: IMG(1), kind: 'image' }, { url: IMG(2), kind: 'image' }] }).join(), /one image or video/);
});

// ── X ────────────────────────────────────────────────────────────────────────

test('X: no paid credits → PUBLISH_NOT_CONFIGURED, duplicate → validation, GIF uses tweet_gif', async () => {
    const answers: any[] = [
        json(402, { title: 'Payment Required', detail: 'Your enrolled account does not have any credits', type: 'https://api.x.com/2/problems/credits' }),
        json(403, { detail: 'You are not allowed to create a Tweet with duplicate content.' }),
    ];
    mock = new FetchMock(() => answers.shift()).install();
    const x = new XPublisher();
    const text = input({ platform: 'x', format: 'text', media: [], caption: 'hello' });
    await rejects(x.publish(text, 'tok'), (e) => {
        assert.equal(e.code, 'PUBLISH_NOT_CONFIGURED');
        assert.match(e.message, /credits/);
    });
    await rejects(x.publish(text, 'tok'), (e) => assert.equal(e.code, 'VALIDATION_FAILED'));
    mock.restore();

    mock = new FetchMock((c) => {
        if (c.url.startsWith('https://cdn.test/')) return bytes(1000, 'image/gif');
        if (c.url.endsWith('/2/media/upload/initialize')) return json(200, { data: { id: 'G1' } });
        if (c.url.endsWith('/append')) return json(200, {});
        if (c.url.endsWith('/finalize')) return json(200, { data: { id: 'G1' } });
        if (c.url.endsWith('/2/tweets')) return json(201, { data: { id: 'T1' } });
    }).install();
    const gif = input({ platform: 'x', format: 'image', media: [{ url: 'https://cdn.test/a.gif', kind: 'image' }] });
    assert.deepEqual(x.validate(gif), []);
    await x.publish(gif, 'tok');
    assert.equal(mock.calls.find((c) => c.url.endsWith('/initialize'))!.body.media_category, 'tweet_gif');
    assert.match(x.validate({ ...gif, media: [{ url: 'https://cdn.test/a.gif', kind: 'image' }, { url: IMG(1), kind: 'image' }] }).join(), /one animated GIF/);
});

// ── Capability matrix ⇄ validators ───────────────────────────────────────────

test('capability matrix is truthful: unsupported formats are rejected, supported ones pass validation', () => {
    const publishers: Record<string, PlatformPublisher> = {
        instagram: new InstagramPublisher(),
        facebook: new FacebookPublisher(),
        threads: new ThreadsPublisher(),
        youtube: new YouTubePublisher(),
        linkedin: new LinkedInPublisher(),
        x: new XPublisher(),
        pinterest: new PinterestPublisher(),
        reddit: new RedditPublisher(),
    };
    const accounts: Record<string, PublishInput['account']> = {
        linkedin: { id: 'a', platformAccountId: 'urn:li:person:1', metadata: {} },
    };
    const meta: Record<string, Record<string, any>> = { pinterest: { boardId: 'B' }, reddit: { subreddit: 'test' } };
    const samples: Record<string, Partial<PublishInput>> = {
        text: { format: 'text', media: [], caption: 'Hello' },
        image: { format: 'image', media: [{ url: IMG(1), kind: 'image', width: 1080, height: 1080 }] },
        video: { format: 'video', media: [{ url: VIDEO, kind: 'video', width: 1080, height: 1920, durationSec: 30 }] },
        carousel: { format: 'carousel', media: [{ url: IMG(1), kind: 'image', width: 1080, height: 1080 }, { url: IMG(2), kind: 'image', width: 1080, height: 1080 }] },
        document: { format: 'document', media: [{ url: 'https://cdn.test/d.pdf', kind: 'document' }] },
    };
    const flag = { text: 'canPublishText', image: 'canPublishImage', video: 'canPublishVideo', carousel: 'canPublishCarousel', document: 'canPublishDocument' } as const;
    for (const [platform, caps] of Object.entries(PUBLISH_CAPABILITIES)) {
        for (const [fmt, sample] of Object.entries(samples)) {
            const i = input({ platform: platform as any, title: 'A title', ...sample, platformMeta: { ...(meta[platform] || {}) }, ...(accounts[platform] ? { account: accounts[platform] } : {}) });
            const issues = publishers[platform].validate(i);
            const supported = (caps as any)[flag[fmt as keyof typeof flag]];
            if (supported) assert.deepEqual(issues, [], `${platform} ${fmt} should be valid: ${issues.join(' | ')}`);
            else assert.ok(issues.length > 0, `${platform} ${fmt} should be rejected (capability says unsupported)`);
        }
        assert.equal(caps.canSchedule, true);
    }
});

test('X thread: opt-in split, each post replies to the previous one, media only on post 1, partial failure is reported', async () => {
    const x = new XPublisher();
    const long = Array.from({ length: 9 }, (_, i) => `Point ${i + 1}: flossing every single day changes how your gums respond within a week.`).join('\n\n');
    const single = input({ platform: 'x', format: 'text', media: [], caption: long });
    assert.match(x.validate(single).join(), /Post as thread/, 'over 280 without the opt-in is still rejected');

    const thread = input({ platform: 'x', format: 'text', media: [], caption: long, platformMeta: { thread: true } });
    assert.deepEqual(x.validate(thread), []);
    let n = 0;
    mock = new FetchMock((c) => (c.url.endsWith('/2/tweets') ? json(201, { data: { id: `T${++n}` } }) : undefined)).install();
    const out = await x.publish(thread, 'tok');
    const posts = mock.calls.filter((c) => c.url.endsWith('/2/tweets')).map((c) => c.body);
    assert.ok(posts.length > 1);
    assert.equal(out.externalId, 'T1');
    assert.equal(out.meta!.threadIds.length, posts.length);
    assert.equal(posts[0].reply, undefined);
    posts.slice(1).forEach((p, i) => assert.equal(p.reply.in_reply_to_tweet_id, `T${i + 1}`));
    assert.match(posts[0].text, new RegExp(` 1/${posts.length}$`));
    assert.equal(out.warning, undefined);
    mock.restore();

    n = 0;
    mock = new FetchMock((c) => (c.url.endsWith('/2/tweets') ? (++n === 2 ? json(500, { detail: 'boom' }) : json(201, { data: { id: `T${n}` } })) : undefined)).install();
    const partial = await x.publish(thread, 'tok');
    assert.equal(partial.state, 'published');
    assert.match(partial.warning!, /Published 1 of \d+ thread posts; post 2 failed/);
    mock.restore();

    const explicit = input({ platform: 'x', format: 'text', media: [], caption: 'ignored', platformMeta: { thread: ['first', 'x'.repeat(300)] } });
    assert.match(x.validate(explicit).join(), /thread post 2 is over 280/);
    assert.match(x.validate(input({ platform: 'x', format: 'text', media: [], caption: 'word '.repeat(2000), platformMeta: { thread: true } })).join(), /limited to 25 posts/);
});
