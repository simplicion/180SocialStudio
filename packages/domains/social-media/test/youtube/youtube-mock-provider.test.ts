/**
 * Unit & Integration tests for MockYouTubeProvider:
 * Full lifecycle verification, video publishing, shorts detection, thumbnail upload,
 * captions, comments, ratings, analytics, and failure injection without real Google network calls.
 * Run: npx tsx --test --test-force-exit packages/domains/social-media/test/youtube/youtube-mock-provider.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { MockYouTubeProvider, YouTubeIntegrationError } from '../../src/youtube';

test('1. Mock OAuth URL generation and code exchange', async () => {
    const mock = new MockYouTubeProvider();
    const authUrl = mock.getAuthorizationUrl({
        state: 'signed_test_state_180',
        redirectUri: 'https://api.180workspace.com/api/v1/social-media/accounts/oauth/youtube/callback',
        codeChallenge: 'pkce_challenge_180',
    });

    assert.ok(authUrl.includes('client_id=mock_youtube_client_id'));
    assert.ok(authUrl.includes('state=signed_test_state_180'));
    assert.ok(authUrl.includes('code_challenge=pkce_challenge_180'));

    const tokens = await mock.exchangeCode({
        code: 'valid_google_auth_code',
        redirectUri: 'https://api.180workspace.com/api/v1/social-media/accounts/oauth/youtube/callback',
    });

    assert.ok(tokens.accessToken.startsWith('mock_yt_access_token_'));
    assert.ok(tokens.refreshToken?.startsWith('mock_yt_refresh_token_'));
    assert.ok(tokens.expiresAt instanceof Date);

    // Refresh flow
    const refreshed = await mock.refreshToken(tokens.refreshToken!);
    assert.ok(refreshed.accessToken.startsWith('mock_yt_refreshed_token_'));
});

test('2. Channel info retrieval in mock mode', async () => {
    const mock = new MockYouTubeProvider();
    const channel = await mock.getChannel('mock_token');

    assert.equal(channel.channelId, 'UC_mock_workspace_channel_180');
    assert.equal(channel.title, '180 Workspace Official Channel (Demo)');
    assert.equal(channel.customUrl, '@180workspace');
    assert.ok((channel.subscriberCount ?? 0) > 0);
});

test('3. Video publishing: standard landscape video vs. vertical Shorts', async () => {
    const mock = new MockYouTubeProvider();
    const token = 'mock_token';

    // 3a. Standard landscape video
    const standard = await mock.publishVideo({
        title: 'Complete 180 Workspace Platform Tour',
        description: 'Comprehensive overview of 180 Workspace features.',
        mediaUrl: 'https://cdn.180workspace.com/media/tour.mp4',
        privacyStatus: 'public',
        isShort: false,
    }, token);

    assert.ok(standard.videoId.startsWith('mock_yt_'));
    assert.ok(standard.liveUrl.includes('youtube.com/watch?v='));
    assert.equal(standard.isShort, false);
    assert.equal(standard.privacyStatus, 'public');

    // 3b. Vertical Short
    const short = await mock.publishVideo({
        title: 'Quick Productivity Hack',
        description: '30 seconds hack.',
        mediaUrl: 'https://cdn.180workspace.com/media/hack.mp4',
        isShort: true,
    }, token);

    assert.ok(short.liveUrl.includes('youtube.com/shorts/'));
    assert.equal(short.isShort, true);
});

test('4. Custom thumbnail upload in mock mode', async () => {
    const mock = new MockYouTubeProvider();
    const result = await mock.uploadThumbnail('mock_vid_123', 'https://cdn.180workspace.com/thumbs/hero.jpg', 'mock_token');
    assert.equal(result, true);
});

test('5. Caption upload in mock mode', async () => {
    const mock = new MockYouTubeProvider();
    const captionBytes = new TextEncoder().encode('1\n00:00:01,000 --> 00:00:04,000\nHello 180 Workspace!');
    const captionId = await mock.uploadCaption('mock_vid_123', 'en', 'English Closed Captions', captionBytes, 'mock_token');

    assert.ok(captionId.startsWith('mock_caption_'));
});

test('6. Comments listing and replies in mock mode', async () => {
    const mock = new MockYouTubeProvider();
    const token = 'mock_token';
    const videoId = 'mock_vid_comments_test';

    const comments = await mock.listComments(videoId, token, 10);
    assert.ok(Array.isArray(comments));
    assert.ok(comments.length >= 1);
    assert.ok(comments[0].textDisplay.length > 0);

    const reply = await mock.replyComment(comments[0].id, 'Thank you for your feedback!', token);
    assert.ok(reply.commentId.startsWith('mock_yt_reply_'));
});

test('7. Video rating (like) in mock mode', async () => {
    const mock = new MockYouTubeProvider();
    const liked = await mock.likeVideo('mock_vid_like_test', 'mock_token');
    assert.equal(liked, true);
});

test('8. YouTube Analytics retrieval returns normalized internal metrics', async () => {
    const mock = new MockYouTubeProvider();
    const analytics = await mock.getAnalytics('UC_mock_workspace_channel_180', '2026-01-01', '2026-01-31', 'mock_token');

    assert.equal(analytics.platform, 'youtube');
    assert.equal(analytics.channelId, 'UC_mock_workspace_channel_180');
    assert.ok(analytics.metrics.views > 0);
    assert.ok(analytics.metrics.estimatedMinutesWatched > 0);
    assert.ok(analytics.metrics.likes > 0);
    assert.ok(analytics.metrics.comments > 0);
});

test('9. Injected failure simulations: rate-limit, upload failure, quota exceeded', async () => {
    const mock = new MockYouTubeProvider();

    // 9a. Rate limit 429
    mock.setSimulatedFailure('rate_limit');
    await assert.rejects(
        () => mock.publishVideo({ title: 'Test', description: 'Test', mediaUrl: 'https://cdn.test/vid.mp4' }, 'mock_token'),
        (err: any) => err instanceof YouTubeIntegrationError && err.code === 'YOUTUBE_RATE_LIMITED' && err.httpStatus === 429
    );
    mock.setSimulatedFailure(null);

    // 9b. Upload failure
    mock.setSimulatedFailure('upload_failure');
    await assert.rejects(
        () => mock.publishVideo({ title: 'Test', description: 'Test', mediaUrl: 'https://cdn.test/vid.mp4' }, 'mock_token'),
        (err: any) => err instanceof YouTubeIntegrationError && err.code === 'YOUTUBE_UPLOAD_FAILED'
    );
    mock.setSimulatedFailure(null);

    // 9c. Quota exceeded
    mock.setSimulatedFailure('quota_exceeded');
    await assert.rejects(
        () => mock.publishVideo({ title: 'Test', description: 'Test', mediaUrl: 'https://cdn.test/vid.mp4' }, 'mock_token'),
        (err: any) => err instanceof YouTubeIntegrationError && err.code === 'YOUTUBE_QUOTA_EXCEEDED' && err.httpStatus === 403
    );
    mock.setSimulatedFailure(null);
});
