/**
 * Unit & Integration tests for YouTube Capability Matrix and Dynamic Resolver.
 * Run: npx tsx --test --test-force-exit packages/domains/social-media/test/youtube/youtube-capabilities.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    resolveYouTubeCapabilities,
    YOUTUBE_UPLOAD_SCOPE,
    YOUTUBE_READONLY_SCOPE,
    YOUTUBE_FORCE_SSL_SCOPE,
    YOUTUBE_ANALYTICS_SCOPE,
    DEFAULT_YOUTUBE_SCOPES,
} from '../../src/youtube';

test('1. Full scopes account resolves all capabilities as active', () => {
    const caps = resolveYouTubeCapabilities({
        scopes: DEFAULT_YOUTUBE_SCOPES,
        mode: 'live',
    });

    assert.equal(caps.canConnectAccount, true);
    assert.equal(caps.canUploadVideo, true);
    assert.equal(caps.canUpdateVideo, true);
    assert.equal(caps.canUploadShorts, true);
    assert.equal(caps.canUploadThumbnail, true);
    assert.equal(caps.canUploadCaptions, true);
    assert.equal(caps.canReadChannel, true);
    assert.equal(caps.canReadVideo, true);
    assert.equal(caps.canReadComments, true);
    assert.equal(caps.canReplyComments, true);
    assert.equal(caps.canLikeVideo, true);
    assert.equal(caps.canReadAnalytics, true);
});

test('2. Upload-only scope account allows video and shorts upload but denies analytics and comments', () => {
    const caps = resolveYouTubeCapabilities({
        scopes: [YOUTUBE_UPLOAD_SCOPE],
        mode: 'live',
    });

    assert.equal(caps.canConnectAccount, true);
    assert.equal(caps.canUploadVideo, true);
    assert.equal(caps.canUploadShorts, true);
    assert.equal(caps.canUploadThumbnail, true);
    assert.equal(caps.canUploadCaptions, true);

    // Read-only, comment moderation and analytics are denied
    assert.equal(caps.canReadComments, false);
    assert.equal(caps.canReplyComments, false);
    assert.equal(caps.canLikeVideo, false);
    assert.equal(caps.canReadAnalytics, false);
});

test('3. Readonly-only scope account allows reading channel/videos but denies uploads and comment replies', () => {
    const caps = resolveYouTubeCapabilities({
        scopes: [YOUTUBE_READONLY_SCOPE],
        mode: 'live',
    });

    assert.equal(caps.canConnectAccount, true);
    assert.equal(caps.canReadChannel, true);
    assert.equal(caps.canReadVideo, true);
    assert.equal(caps.canReadComments, true);

    assert.equal(caps.canUploadVideo, false);
    assert.equal(caps.canUploadShorts, false);
    assert.equal(caps.canUploadThumbnail, false);
    assert.equal(caps.canReplyComments, false);
    assert.equal(caps.canLikeVideo, false);
    assert.equal(caps.canReadAnalytics, false);
});

test('4. Force-SSL scope enables comment replies and video rating/liking', () => {
    const caps = resolveYouTubeCapabilities({
        scopes: [YOUTUBE_READONLY_SCOPE, YOUTUBE_FORCE_SSL_SCOPE],
        mode: 'live',
    });

    assert.equal(caps.canReadComments, true);
    assert.equal(caps.canReplyComments, true);
    assert.equal(caps.canLikeVideo, true);
    assert.equal(caps.canUploadVideo, false);
});

test('5. Expired token revokes all action capabilities and requires reauth', () => {
    const caps = resolveYouTubeCapabilities({
        scopes: DEFAULT_YOUTUBE_SCOPES,
        isTokenExpired: true,
        mode: 'live',
    });

    assert.equal(caps.canConnectAccount, false);
    assert.equal(caps.canUploadVideo, false);
    assert.equal(caps.canUploadShorts, false);
    assert.equal(caps.canReadComments, false);
    assert.equal(caps.canReplyComments, false);
    assert.equal(caps.canReadAnalytics, false);
});

test('6. Mock mode enables all simulated capabilities across sandbox testing', () => {
    const caps = resolveYouTubeCapabilities({
        scopes: [],
        mode: 'mock',
    });

    assert.equal(caps.canConnectAccount, true);
    assert.equal(caps.canUploadVideo, true);
    assert.equal(caps.canUploadShorts, true);
    assert.equal(caps.canReadComments, true);
    assert.equal(caps.canReplyComments, true);
    assert.equal(caps.canReadAnalytics, true);
});
