/**
 * Run: npx tsx --test --test-force-exit packages/domains/social-media/test/publishing/publishers.test.ts
 * Each platform publisher's HTTP request sequence (video + carousel/multi-media), against a mocked fetch.
 */
import test, { afterEach, before } from 'node:test';
import assert from 'node:assert/strict';
import { FetchMock, bytes, json, setTestEnv } from './fakes';

setTestEnv();

import { publishingTiming } from '../../src/publishing';
import { FacebookPublisher, InstagramPublisher, LinkedInPublisher, PinterestPublisher, RedditPublisher, SimulatedPlatformPublisher, ThreadsPublisher, TikTokPublisher, XPublisher, YouTubePublisher } from '../../src/adapters';
import type { PublishInput } from '../../src/adapters/types';

before(() => {
    publishingTiming.sleep = async () => undefined;
});

let mock: FetchMock | null = null;
afterEach(() => mock?.restore());

const VIDEO = 'https://cdn.test/v/reel.mp4';
const IMG1 = 'https://cdn.test/i/1.jpg';
const IMG2 = 'https://cdn.test/i/2.jpg';

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

const path = (u: string) => new URL(u).pathname;

test('Instagram Reel: container → status poll → media_publish → permalink → first comment', async () => {
    let polls = 0;
    mock = new FetchMock((c) => {
        const p = path(c.url);
        if (c.method === 'POST' && p.endsWith('/ACC/media')) return json(200, { id: 'C1' });
        if (c.method === 'GET' && p.endsWith('/C1')) return json(200, { status_code: ++polls < 2 ? 'IN_PROGRESS' : 'FINISHED' });
        if (c.method === 'POST' && p.endsWith('/ACC/media_publish')) return json(200, { id: 'M1' });
        if (c.method === 'GET' && p.endsWith('/M1')) return json(200, { permalink: 'https://www.instagram.com/reel/abc/' });
        if (c.method === 'POST' && p.endsWith('/M1/comments')) return json(200, { id: 'CM1' });
    }).install();

    const pub = new InstagramPublisher();
    const i = input({ firstComment: 'First!' });
    assert.deepEqual(pub.validate(i), []);
    const out = await pub.publish(i, 'tok-ig');
    assert.equal(out.externalId, 'M1');
    assert.equal(out.url, 'https://www.instagram.com/reel/abc/');
    assert.equal(mock.calls[0].body.media_type, 'REELS');
    assert.equal(mock.calls[0].body.video_url, VIDEO);
    assert.equal(mock.calls[0].headers.authorization, 'Bearer tok-ig');
    assert.ok(!mock.calls.some((c) => c.url.includes('access_token=')), 'token never in URLs');
    assert.deepEqual(mock.sequence().map((s) => s.replace(/graph\.facebook\.com\/v[\d.]+/, 'graph')), [
        'POST graph/ACC/media',
        'GET graph/C1',
        'GET graph/C1',
        'POST graph/ACC/media_publish',
        'GET graph/M1',
        'POST graph/M1/comments',
    ]);
});

test('Instagram carousel: child containers → CAROUSEL container → publish', async () => {
    let n = 0;
    mock = new FetchMock((c) => {
        const p = path(c.url);
        if (c.method === 'POST' && p.endsWith('/ACC/media')) return json(200, { id: c.body.media_type === 'CAROUSEL' ? 'PARENT' : `CH${++n}` });
        if (c.method === 'GET') return json(200, p.endsWith('/M2') ? { permalink: 'https://www.instagram.com/p/xyz/' } : { status_code: 'FINISHED' });
        if (c.method === 'POST' && p.endsWith('/media_publish')) return json(200, { id: 'M2' });
    }).install();
    const out = await new InstagramPublisher().publish(input({ format: 'carousel', media: [{ url: IMG1, kind: 'image' }, { url: IMG2, kind: 'image' }] }), 't');
    assert.equal(out.externalId, 'M2');
    const creates = mock.calls.filter((c) => c.method === 'POST' && path(c.url).endsWith('/ACC/media'));
    assert.equal(creates.length, 3);
    assert.equal(creates[0].body.is_carousel_item, true);
    assert.equal(creates[2].body.media_type, 'CAROUSEL');
    assert.equal(creates[2].body.children, 'CH1,CH2');
    assert.equal(mock.calls.find((c) => path(c.url).endsWith('/media_publish'))!.body.creation_id, 'PARENT');
});

test('Instagram validation: caption, carousel size, unsupported format', () => {
    const pub = new InstagramPublisher();
    assert.match(pub.validate(input({ caption: 'x'.repeat(2201) })).join(), /2,200/);
    assert.match(pub.validate(input({ format: 'carousel', media: [{ url: IMG1, kind: 'image' }] })).join(), /2 to 10/);
    assert.match(pub.validate(input({ format: 'text', media: [] })).join(), /cannot publish text/);
    assert.match(pub.validate(input({ media: [{ url: VIDEO, kind: 'video', durationSec: 1000 }] })).join(), /at most 900s/);
});

test('Facebook video, Reel (3-phase) and multi-photo sequences', async () => {
    mock = new FetchMock((c) => {
        const p = path(c.url);
        if (p.endsWith('/PAGE/videos')) return json(200, { id: 'VID1' });
        if (p.endsWith('/PAGE/video_reels')) return json(200, c.body.upload_phase === 'start' ? { video_id: 'R1', upload_url: 'x' } : { success: true });
        if (c.url.startsWith('https://rupload.facebook.com/')) return json(200, { success: true });
        if (p.endsWith('/R1') && c.method === 'GET') return json(200, { status: { video_status: 'ready' } });
        if (p.endsWith('/PAGE/photos')) return json(200, { id: `PH${mock!.calls.length}` });
        if (p.endsWith('/PAGE/feed')) return json(200, { id: 'PAGE_POST1' });
    }).install();
    const fb = new FacebookPublisher();
    const acct = { id: 'a', platformAccountId: 'PAGE', metadata: {} };

    const v = await fb.publish(input({ platform: 'facebook', account: acct }), 'ptok');
    assert.equal(v.url, 'https://www.facebook.com/PAGE/videos/VID1');
    assert.equal(mock.calls[0].body.file_url, VIDEO);

    mock.calls = [];
    const r = await fb.publish(input({ platform: 'facebook', account: acct, platformMeta: { facebookFormat: 'reel' } }), 'ptok');
    assert.equal(r.externalId, 'R1');
    assert.equal(mock.calls[1].headers.file_url, VIDEO);
    assert.equal(mock.calls[1].headers.authorization, 'OAuth ptok');
    assert.equal(mock.calls[2].body.video_state, 'PUBLISHED');

    mock.calls = [];
    const m = await fb.publish(input({ platform: 'facebook', account: acct, format: 'carousel', media: [{ url: IMG1, kind: 'image' }, { url: IMG2, kind: 'image' }] }), 'ptok');
    assert.equal(m.externalId, 'PAGE_POST1');
    assert.equal(mock.calls.filter((c) => path(c.url).endsWith('/photos') && c.body.published === false).length, 2);
    assert.equal(mock.calls.at(-1)!.body.attached_media.length, 2);
});

test('YouTube Short: resumable session → chunked PUTs (308 then 200) with #shorts', async () => {
    process.env.YOUTUBE_UPLOAD_CHUNK_BYTES = String(256 * 1024);
    const size = 256 * 1024 + 1000;
    mock = new FetchMock((c) => {
        if (c.url === VIDEO) return bytes(size);
        if (c.method === 'POST' && c.url.includes('/upload/youtube/v3/videos')) return new Response('', { status: 200, headers: { location: 'https://upload.test/session/1' } });
        if (c.method === 'PUT' && c.url === 'https://upload.test/session/1') {
            const range = c.headers['content-range'];
            if (range.startsWith('bytes 0-')) return new Response('', { status: 308, headers: { range: `bytes=0-${256 * 1024 - 1}` } });
            return json(200, { id: 'YT123', status: { privacyStatus: 'public' } });
        }
    }).install();
    const yt = new YouTubePublisher();
    const i = input({ platform: 'youtube', title: 'My clip' });
    assert.deepEqual(yt.validate(i), []);
    const out = await yt.publish(i, 'gtok');
    delete process.env.YOUTUBE_UPLOAD_CHUNK_BYTES;
    assert.equal(out.url, 'https://www.youtube.com/shorts/YT123');
    const init = mock.calls.find((c) => c.method === 'POST')!;
    assert.equal(init.body.snippet.title, 'My clip #shorts');
    assert.equal(init.headers['x-upload-content-length'], String(size));
    const puts = mock.calls.filter((c) => c.method === 'PUT');
    assert.deepEqual(puts.map((p) => p.headers['content-range']), [`bytes 0-${256 * 1024 - 1}/${size}`, `bytes ${256 * 1024}-${size - 1}/${size}`]);
});

test('YouTube rejects non-video posts', () => {
    assert.match(new YouTubePublisher().validate(input({ platform: 'youtube', format: 'image', media: [{ url: IMG1, kind: 'image' }] })).join(), /needs a video/);
});

test('LinkedIn video: initializeUpload → part PUTs (ETags) → finalize → AVAILABLE → post', async () => {
    const size = 3000;
    mock = new FetchMock((c) => {
        if (c.url === VIDEO) return bytes(size);
        if (c.url.includes('/rest/videos?action=initializeUpload'))
            return json(200, { value: { video: 'urn:li:video:V1', uploadToken: 'UT', uploadInstructions: [{ uploadUrl: 'https://up.li/1', firstByte: 0, lastByte: 1999 }, { uploadUrl: 'https://up.li/2', firstByte: 2000, lastByte: 2999 }] } });
        if (c.url.startsWith('https://up.li/')) return new Response('', { status: 200, headers: { etag: `etag-${c.url.slice(-1)}` } });
        if (c.url.includes('/rest/videos?action=finalizeUpload')) return json(200, {});
        if (c.method === 'GET' && c.url.includes('/rest/videos/')) return json(200, { status: 'AVAILABLE' });
        if (c.url.endsWith('/rest/posts')) return new Response('', { status: 201, headers: { 'x-restli-id': 'urn:li:share:99' } });
    }).install();
    const li = new LinkedInPublisher();
    const i = input({ platform: 'linkedin', account: { id: 'a', platformAccountId: 'urn:li:organization:5', metadata: {} } });
    assert.deepEqual(li.validate(i), []);
    const out = await li.publish(i, 'ltok');
    assert.equal(out.url, 'https://www.linkedin.com/feed/update/urn:li:share:99');
    const fin = mock.calls.find((c) => c.url.includes('finalizeUpload'))!;
    assert.deepEqual(fin.body.finalizeUploadRequest.uploadedPartIds, ['etag-1', 'etag-2']);
    const post = mock.calls.find((c) => c.url.endsWith('/rest/posts'))!;
    assert.equal(post.body.author, 'urn:li:organization:5');
    assert.equal(post.body.content.media.id, 'urn:li:video:V1');
    assert.ok(post.headers['linkedin-version']);
});

test('LinkedIn multi-image carousel and PDF document carousel', async () => {
    let img = 0;
    mock = new FetchMock((c) => {
        if (c.url.startsWith('https://cdn.test/')) return bytes(100, c.url.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');
        if (c.url.includes('/rest/images?action=initializeUpload')) return json(200, { value: { uploadUrl: `https://up.li/img${++img}`, image: `urn:li:image:I${img}` } });
        if (c.url.includes('/rest/documents?action=initializeUpload')) return json(200, { value: { uploadUrl: 'https://up.li/doc', document: 'urn:li:document:D1' } });
        if (c.url.startsWith('https://up.li/')) return new Response('', { status: 201 });
        if (c.url.includes('/rest/documents/') && c.method === 'GET') return json(200, { status: 'AVAILABLE' });
        if (c.url.endsWith('/rest/posts')) return new Response('', { status: 201, headers: { 'x-restli-id': 'urn:li:share:1' } });
    }).install();
    const li = new LinkedInPublisher();
    const acct = { id: 'a', platformAccountId: 'urn:li:person:abc', metadata: {} };
    await li.publish(input({ platform: 'linkedin', account: acct, format: 'carousel', media: [{ url: IMG1, kind: 'image' }, { url: IMG2, kind: 'image' }] }), 't');
    const post1 = mock.calls.find((c) => c.url.endsWith('/rest/posts'))!;
    assert.deepEqual(post1.body.content.multiImage.images.map((x: any) => x.id), ['urn:li:image:I1', 'urn:li:image:I2']);

    mock.calls = [];
    await li.publish(input({ platform: 'linkedin', account: acct, format: 'carousel', title: 'Deck', media: [{ url: 'https://cdn.test/deck.pdf', kind: 'document' }] }), 't');
    const post2 = mock.calls.find((c) => c.url.endsWith('/rest/posts'))!;
    assert.equal(post2.body.content.media.id, 'urn:li:document:D1');
    assert.equal(post2.body.content.media.title, 'Deck');
});

test('X video: media upload v2 initialize → append chunks → finalize → STATUS poll → tweet → reply', async () => {
    process.env.X_UPLOAD_CHUNK_BYTES = '1000';
    let statusCalls = 0;
    mock = new FetchMock((c) => {
        if (c.url === VIDEO) return bytes(2500);
        const u = new URL(c.url);
        if (u.pathname === '/2/media/upload/initialize') return json(200, { data: { id: 'MID' } });
        if (u.pathname === '/2/media/upload/MID/append') return new Response(null, { status: 204 });
        if (u.pathname === '/2/media/upload/MID/finalize') return json(200, { data: { id: 'MID', processing_info: { state: 'pending', check_after_secs: 1 } } });
        if (u.pathname === '/2/media/upload' && c.method === 'GET') return json(200, { data: { processing_info: { state: ++statusCalls > 1 ? 'succeeded' : 'in_progress' } } });
        if (u.pathname === '/2/tweets') return json(201, { data: { id: c.body.reply ? 'T2' : 'T1' } });
    }).install();
    const x = new XPublisher();
    const i = input({ platform: 'x', firstComment: 'thread' });
    assert.deepEqual(x.validate(i), []);
    const out = await x.publish(i, 'xtok');
    delete process.env.X_UPLOAD_CHUNK_BYTES;
    assert.equal(out.url, 'https://x.com/brand/status/T1');
    const appends = mock.calls.filter((c) => c.url.endsWith('/append'));
    assert.equal(appends.length, 3);
    assert.equal(mock.calls[1].body.media_category, 'tweet_video');
    assert.equal(mock.calls[1].body.total_bytes, 2500);
    const tweets = mock.calls.filter((c) => c.url.endsWith('/2/tweets'));
    assert.deepEqual(tweets[0].body.media, { media_ids: ['MID'] });
    assert.equal(tweets[1].body.reply.in_reply_to_tweet_id, 'T1');
});

test('X validation: 280 weighted chars, max 4 images, one video', () => {
    const x = new XPublisher();
    assert.match(x.validate(input({ platform: 'x', format: 'text', media: [], caption: 'a'.repeat(281) })).join(), /280/);
    assert.deepEqual(x.validate(input({ platform: 'x', format: 'text', media: [], caption: `${'a'.repeat(250)} https://example.com/${'b'.repeat(60)}` })), []);
    const five = Array.from({ length: 5 }, (_, k) => ({ url: `https://cdn.test/${k}.jpg`, kind: 'image' as const }));
    assert.match(x.validate(input({ platform: 'x', format: 'carousel', media: five })).join(), /at most 4 images/);
});

test('TikTok direct post: creator_info → video/init (FILE_UPLOAD) → PUT → status PUBLISH_COMPLETE', async () => {
    let polls = 0;
    mock = new FetchMock((c) => {
        if (c.url === VIDEO) return bytes(4000);
        const p = path(c.url);
        if (p === '/v2/post/publish/creator_info/query/') return json(200, { data: { creator_username: 'brandtt', privacy_level_options: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'], max_video_post_duration_sec: 600 }, error: { code: 'ok' } });
        if (p === '/v2/post/publish/video/init/') return json(200, { data: { publish_id: 'PUB1', upload_url: 'https://upload.tiktok.test/1' }, error: { code: 'ok' } });
        if (c.url === 'https://upload.tiktok.test/1') return new Response('', { status: 201 });
        if (p === '/v2/post/publish/status/fetch/') return json(200, { data: ++polls < 2 ? { status: 'PROCESSING_UPLOAD' } : { status: 'PUBLISH_COMPLETE', publicaly_available_post_id: [7123] }, error: { code: 'ok' } });
    }).install();
    const tt = new TikTokPublisher();
    const i = input({ platform: 'tiktok', platformMeta: { privacyLevel: 'PUBLIC_TO_EVERYONE' } });
    assert.deepEqual(tt.validate(i), []);
    const out = await tt.publish(i, 'ttok');
    assert.equal(out.state, 'published');
    assert.equal(out.url, 'https://www.tiktok.com/@brandtt/video/7123');
    const init = mock.calls.find((c) => c.url.includes('/video/init/'))!;
    assert.deepEqual(init.body.source_info, { source: 'FILE_UPLOAD', video_size: 4000, chunk_size: 4000, total_chunk_count: 1 });
    assert.equal(init.body.post_info.privacy_level, 'PUBLIC_TO_EVERYONE');
    assert.equal(mock.calls.find((c) => c.method === 'PUT')!.headers['content-range'], 'bytes 0-3999/4000');
});

test('TikTok inbox upload, photo carousel, still-processing and privacy rules', async () => {
    mock = new FetchMock((c) => {
        if (c.url === VIDEO) return bytes(100);
        const p = path(c.url);
        if (p === '/v2/post/publish/inbox/video/init/') return json(200, { data: { publish_id: 'IN1', upload_url: 'https://upload.tiktok.test/2' }, error: { code: 'ok' } });
        if (p === '/v2/post/publish/content/init/') return json(200, { data: { publish_id: 'PH1' }, error: { code: 'ok' } });
        if (c.method === 'PUT') return new Response('', { status: 201 });
        if (p === '/v2/post/publish/status/fetch/') return json(200, { data: { status: c.body.publish_id === 'IN1' ? 'SEND_TO_USER_INBOX' : 'PROCESSING_DOWNLOAD' }, error: { code: 'ok' } });
    }).install();
    const tt = new TikTokPublisher();
    const inbox = await tt.publish(input({ platform: 'tiktok', platformMeta: { tiktokMode: 'inbox' } }), 't');
    assert.equal(inbox.meta?.deliveredTo, 'inbox');
    assert.ok(!mock.calls.some((c) => c.url.includes('creator_info')), 'inbox upload skips creator_info');

    process.env.TIKTOK_STATUS_POLL_ATTEMPTS = '2';
    const photo = await tt.publish(input({ platform: 'tiktok', format: 'carousel', media: [{ url: IMG1, kind: 'image' }, { url: IMG2, kind: 'image' }], platformMeta: { privacyLevel: 'SELF_ONLY' } }), 't');
    delete process.env.TIKTOK_STATUS_POLL_ATTEMPTS;
    assert.equal(photo.state, 'processing', 'not yet public is reported honestly as processing');
    const init = mock.calls.find((c) => c.url.includes('/content/init/'))!;
    assert.equal(init.body.media_type, 'PHOTO');
    assert.deepEqual(init.body.source_info.photo_images, [IMG1, IMG2]);

    assert.match(tt.validate(input({ platform: 'tiktok' })).join(), /privacy level/);
    assert.match(tt.validate(input({ platform: 'tiktok', platformMeta: { privacyLevel: 'SELF_ONLY' }, firstComment: 'hi' })).join(), /first comment/);
});

test('Threads publisher: validate limits, video/text containers, poll and publish', async () => {
    mock = new FetchMock((c) => {
        const u = new URL(c.url);
        if (u.pathname === '/v1.0/user123/threads' && c.method === 'POST') return json(200, { id: 'TC1' });
        if (u.pathname === '/v1.0/TC1' && c.method === 'GET') return json(200, { status: 'FINISHED' });
        if (u.pathname === '/v1.0/user123/threads_publish' && c.method === 'POST') return json(200, { id: 'TP1' });
    }).install();

    const tp = new ThreadsPublisher();
    const longText = 'a'.repeat(501);
    assert.match(tp.validate(input({ platform: 'threads', caption: longText })).join(), /500 characters/);

    const vidInput = input({ platform: 'threads', format: 'video', account: { id: 'a1', platformAccountId: 'user123', username: 'th_user', accountName: 'Threads User', metadata: {} } });
    assert.deepEqual(tp.validate(vidInput), []);
    const out = await tp.publish(vidInput, 'th_token');
    assert.equal(out.state, 'published');
    assert.equal(out.externalId, 'TP1');
    assert.equal(out.url, 'https://www.threads.net/@th_user/post/TP1');
});

test('Pinterest publisher: validate title/caption/board, create Pin', async () => {
    mock = new FetchMock((c) => {
        const u = new URL(c.url);
        if (u.pathname === '/v5/pins' && c.method === 'POST') return json(201, { id: 'PIN_123' });
    }).install();

    const pin = new PinterestPublisher();
    assert.match(pin.validate(input({ platform: 'pinterest', title: 't'.repeat(101) })).join(), /100 characters/);
    assert.match(pin.validate(input({ platform: 'pinterest', format: 'text', media: [] })).join(), /image or video/);

    const pinInput = input({ platform: 'pinterest', format: 'image', media: [{ url: IMG1, kind: 'image' }], platformMeta: { boardId: 'board_456' } });
    assert.deepEqual(pin.validate(pinInput), []);
    const out = await pin.publish(pinInput, 'pin_token');
    assert.equal(out.state, 'published');
    assert.equal(out.externalId, 'PIN_123');
    assert.equal(out.url, 'https://www.pinterest.com/pin/PIN_123/');
});

test('Reddit publisher: validate title, submit link/self post', async () => {
    mock = new FetchMock((c) => {
        const u = new URL(c.url);
        if (u.pathname === '/api/submit' && c.method === 'POST') return json(200, { json: { data: { id: 't3_abc123', url: 'https://www.reddit.com/r/technology/comments/abc123' } } });
    }).install();

    const reddit = new RedditPublisher();
    assert.match(reddit.validate(input({ platform: 'reddit', title: '', caption: '' })).join(), /require a title/);
    assert.match(reddit.validate(input({ platform: 'reddit', title: 'r'.repeat(301) })).join(), /300 characters/);

    const redInput = input({ platform: 'reddit', format: 'video', title: 'Check this new tech', platformMeta: { subreddit: 'technology' } });
    assert.deepEqual(reddit.validate(redInput), []);
    const out = await reddit.publish(redInput, 'red_token');
    assert.equal(out.state, 'published');
    assert.equal(out.externalId, 't3_abc123');
    assert.equal(out.url, 'https://www.reddit.com/r/technology/comments/abc123');
});

test('Simulated platform publisher: realistic latency, genuine validation, instant permalinks', async () => {
    process.env.SIMULATE_SOCIAL_PUBLISHING = 'true';
    const sim = new SimulatedPlatformPublisher('threads', new ThreadsPublisher());
    const valid = input({ platform: 'threads', format: 'video', caption: 'Valid simulated video post' });
    assert.deepEqual(sim.validate(valid), []);

    const out = await sim.publish(valid, 'sim_token');
    assert.equal(out.state, 'published');
    assert.ok(out.url?.includes('threads.net'));
    assert.equal(out.meta?.simulated, true);
    delete process.env.SIMULATE_SOCIAL_PUBLISHING;
});
