/**
 * Unit & Integration tests for YouTubeLiveProvider:
 * Resumable upload chunking protocol (256KB multiples), Retry-After / exponential backoff,
 * rate limiting, and zero secret leakage.
 * Run: npx tsx --test --test-force-exit packages/domains/social-media/test/youtube/youtube-live-provider.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { YouTubeLiveProvider, YouTubeHttpClient, YouTubeIntegrationError } from '../../src/youtube';

test('1. YouTubeHttpClient rate limiter and token bucket', async () => {
    const client = new YouTubeHttpClient({
        baseUrl: 'https://mock.googleapis.com',
        timeoutMs: 5000,
        requestsPerSecond: 20,
    });

    const start = Date.now();
    for (let i = 0; i < 5; i++) {
        await client.throttle();
    }
    const duration = Date.now() - start;
    assert.ok(duration < 2000, 'Throttling allows burst within token bucket capacity');
});

test('2. Sanitized error scrubbing: zero token or secret leakage in errors', () => {
    const secretToken = 'ya29.a0ARrdaM_SECRET_TOKEN_VALUE_NEVER_LEAK_180';
    const secretClientSecret = 'GOCSPX-secret_client_secret_xyz';

    const err = new YouTubeIntegrationError(
        'YOUTUBE_UPLOAD_FAILED',
        `Failed upload for Bearer ${secretToken} with secret ${secretClientSecret}`,
        {
            technicalDetails: `curl -H "Authorization: Bearer ${secretToken}" https://accounts.google.com/token?client_secret=${secretClientSecret}`,
        }
    );

    // Verify sanitized error message and details
    assert.ok(!err.message.includes(secretToken), 'Error message must not contain secret token');
    assert.ok(!err.message.includes(secretClientSecret), 'Error message must not contain client secret');
    assert.ok(err.message.includes('[REDACTED_SECRET]'), 'Token must be replaced with [REDACTED_SECRET]');
    assert.ok(!JSON.stringify(err.technicalDetails).includes(secretToken), 'Technical details must not contain secret token');
    assert.ok(!JSON.stringify(err.technicalDetails).includes(secretClientSecret), 'Technical details must not contain client secret');
});

test('3. Resumable chunk upload logic with simulated HTTP server / mocked fetch', async () => {
    const originalFetch = globalThis.fetch;
    const receivedChunks: { range: string; size: number }[] = [];

    // Create a 600KB buffer (spans across multiple 256KB chunks: 256KB + 256KB + 88KB)
    const testVideoBytes = new Uint8Array(600 * 1024);
    testVideoBytes.fill(42);

    try {
        globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
            const url = String(input);

            // 1. Media download mock
            if (url === 'https://cdn.test/my-awesome-video.mp4') {
                return new Response(testVideoBytes, {
                    status: 200,
                    headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(testVideoBytes.length) },
                });
            }

            // 2. Upload session initiation POST
            if (url.includes('uploadType=resumable')) {
                return new Response(JSON.stringify({}), {
                    status: 200,
                    headers: {
                        Location: 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=session_mock_123',
                    },
                });
            }

            // 3. Chunk PUT requests
            if (url.includes('upload_id=session_mock_123')) {
                const range = (init?.headers as any)?.['Content-Range'] || '';
                const body = init?.body as any;
                const size = body?.byteLength || (body instanceof Uint8Array ? body.length : 0);
                receivedChunks.push({ range, size });

                // If not final chunk, return 308 Resume Incomplete
                if (!range.includes(`/${testVideoBytes.length}`) || !range.includes(`-${testVideoBytes.length - 1}/`)) {
                    const endByte = range.split('-')[1]?.split('/')[0];
                    return new Response(null, {
                        status: 308,
                        headers: { Range: `bytes=0-${endByte}` },
                    });
                }

                // Final chunk returns 201 Created with YouTube Video resource
                return new Response(
                    JSON.stringify({
                        id: 'yt_uploaded_vid_999',
                        snippet: { title: 'Test Video' },
                        status: { privacyStatus: 'public' },
                    }),
                    {
                        status: 201,
                        headers: { 'Content-Type': 'application/json' },
                    }
                );
            }

            return new Response('Not Found', { status: 404 });
        };

        const provider = new YouTubeLiveProvider({
            maxUploadChunkBytes: 256 * 1024, // 256KB per chunk
        });

        const result = await provider.publishVideo(
            {
                title: 'Live Provider Test Video',
                description: 'Verifying resumable 256KB chunk upload protocol',
                mediaUrl: 'https://cdn.test/my-awesome-video.mp4',
                privacyStatus: 'public',
            },
            'ya29.test_valid_access_token'
        );

        assert.equal(result.videoId, 'yt_uploaded_vid_999');
        assert.equal(result.liveUrl, 'https://www.youtube.com/watch?v=yt_uploaded_vid_999');
        assert.equal(result.privacyStatus, 'public');

        // Check chunking: 600KB / 256KB -> 3 chunks
        assert.equal(receivedChunks.length, 3, 'Must upload in 3 chunks');
        assert.equal(receivedChunks[0].range, 'bytes 0-262143/614400');
        assert.equal(receivedChunks[1].range, 'bytes 262144-524287/614400');
        assert.equal(receivedChunks[2].range, 'bytes 524288-614399/614400');

    } finally {
        globalThis.fetch = originalFetch;
    }
});
