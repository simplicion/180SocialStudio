import assert from 'assert';
import test from 'node:test';
import { YouTubeAdapter, YouTubePublisher } from '../src/adapters/youtube.adapter';
import { oauthCallbackUrl, requireAppCredentials } from '../src/publishing/config';
import { getOAuthProvider } from '../src/publishing/oauth-providers';

test('1. Exact YouTube OAuth scopes requested at runtime include force-ssl', () => {
    delete process.env.YOUTUBE_SCOPES;
    process.env.GOOGLE_CLIENT_ID = 'mock-google-client-id.apps.googleusercontent.com';
    process.env.GOOGLE_CLIENT_SECRET = 'mock-test-secret';

    const provider = getOAuthProvider('youtube');
    const url = provider.authorizeUrl({
        state: 'test_state',
        redirectUri: 'https://api.180workspace.com/api/v1/social-media/accounts/oauth/youtube/callback',
        codeChallenge: 'test_challenge',
    });

    const parsed = new URL(url);
    const scope = parsed.searchParams.get('scope') || '';
    assert.ok(scope.includes('https://www.googleapis.com/auth/youtube.upload'), 'Includes youtube.upload scope');
    assert.ok(scope.includes('https://www.googleapis.com/auth/youtube.readonly'), 'Includes youtube.readonly scope');
    assert.ok(scope.includes('https://www.googleapis.com/auth/youtube.force-ssl'), 'Includes youtube.force-ssl scope for comments and liking');
    assert.equal(parsed.searchParams.get('access_type'), 'offline', 'Requests offline access for refresh tokens');
    assert.equal(parsed.searchParams.get('prompt'), 'consent', 'Forces consent prompt for refresh token issuance');
});

test('2. Exact YouTube OAuth callback route matches production', () => {
    process.env.SOCIAL_OAUTH_CALLBACK_BASE_URL = 'https://api.180workspace.com';
    const callback = oauthCallbackUrl('youtube');
    assert.equal(callback, 'https://api.180workspace.com/api/v1/social-media/accounts/oauth/youtube/callback');
});

test('3. Google credentials fall back to GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET', () => {
    delete process.env.YOUTUBE_CLIENT_ID;
    delete process.env.YOUTUBE_CLIENT_SECRET;
    process.env.GOOGLE_CLIENT_ID = 'mock-google-client-id-123.apps.googleusercontent.com';
    process.env.GOOGLE_CLIENT_SECRET = 'mock-google-client-secret-xyz';

    const creds = requireAppCredentials('youtube');
    assert.equal(creds.clientId, 'mock-google-client-id-123.apps.googleusercontent.com');
    assert.equal(creds.clientSecret, 'mock-google-client-secret-xyz');
});

test('4. YouTubeAdapter supports mock fallback and live methods', async () => {
    const mockPublish = await YouTubeAdapter.publishVideo({
        accessToken: 'mock_token',
        title: 'Test Video',
        description: 'Testing video publish',
        isShort: true,
    });
    assert.ok(mockPublish.videoId, 'Generates mock videoId');
    assert.ok(mockPublish.liveUrl.includes('youtube.com/shorts/'), 'Generates YouTube Shorts liveUrl');

    const mockReply = await YouTubeAdapter.replyToComment('c123', 'Great video!', 'mock_token');
    assert.ok(mockReply.commentId.startsWith('yt_reply_'), 'Replies to comment in mock mode');

    const mockLike = await YouTubeAdapter.likeVideo('v123', 'mock_token');
    assert.strictEqual(mockLike, true, 'Likes video in mock mode');

    const mockComments = await YouTubeAdapter.fetchComments('v123', 'mock_token');
    assert.ok(Array.isArray(mockComments) && mockComments.length > 0, 'Fetches comments in mock mode');

    const mockAnalytics = await YouTubeAdapter.getAnalytics('chan123', '2026-01-01', '2026-01-31', 'mock_token');
    assert.strictEqual(mockAnalytics.views, 1250, 'Fetches analytics report in mock mode');

    const mockCaption = await YouTubeAdapter.uploadCaption('v123', 'en', 'English', new Uint8Array([1, 2, 3]), 'mock_token');
    assert.equal(mockCaption.id, 'mock_caption_id', 'Uploads caption in mock mode');
});

test('5. YouTubePublisher validates titles and descriptions according to platform bounds', () => {
    const pub = new YouTubePublisher();

    // Invalid: missing video
    const noVideo = pub.validate({
        platform: 'youtube',
        postId: '1',
        variantId: '1',
        account: { id: '1', platformAccountId: '1', accountName: 'Test', metadata: {} },
        format: 'image',
        caption: 'No video post',
        media: [{ kind: 'image', url: 'https://example.com/img.jpg' }],
        platformMeta: {},
    });
    assert.ok(noVideo.some((e) => e.includes('needs a video')), 'Rejects post without video');

    // Invalid: illegal characters < or > in title
    const illegalTitle = pub.validate({
        platform: 'youtube',
        postId: '1',
        variantId: '1',
        account: { id: '1', platformAccountId: '1', accountName: 'Test', metadata: {} },
        format: 'video',
        title: 'Title <script>alert(1)</script>',
        caption: 'Caption',
        media: [{ kind: 'video', url: 'https://example.com/vid.mp4' }],
        platformMeta: {},
    });
    assert.ok(illegalTitle.some((e) => e.includes('cannot contain < or >')), 'Rejects title containing < or >');
});
