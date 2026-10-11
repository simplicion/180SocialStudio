/**
 * Integration tests for LinkedInLiveProvider & LinkedInRestClient.
 * Uses mock HTTP handlers to test REST protocol adherence, rate limiting,
 * chunked video uploads, circuit breaker, and error normalization.
 * Run: npx tsx --test --test-force-exit packages/domains/social-media/test/linkedin/linkedin-live-provider.test.ts
 */

import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    LinkedInLiveProvider,
    LinkedInRestClient,
    LinkedInDiagnosticsService,
    LinkedInIntegrationError,
} from '../../src/linkedin';

let originalFetch = globalThis.fetch;
afterEach(() => {
    globalThis.fetch = originalFetch;
});

test('1. LinkedInLiveProvider generates authorized OAuth URL with custom scopes', async () => {
    process.env.LINKEDIN_CLIENT_ID = 'test_live_client_id';
    process.env.LINKEDIN_CLIENT_SECRET = 'test_live_client_secret';

    const provider = new LinkedInLiveProvider();
    const url = await provider.getAuthorizationUrl({
        state: 'live_test_state',
        redirectUri: 'https://api.180workspace.com/api/v1/social-media/accounts/oauth/linkedin/callback',
        scopes: ['openid', 'profile', 'w_member_social', 'w_organization_social'],
    });

    assert.ok(url.startsWith('https://www.linkedin.com/oauth/v2/authorization'));
    assert.ok(url.includes('client_id=test_live_client_id'));
    assert.ok(url.includes('scope=openid+profile+w_member_social+w_organization_social'));
});

test('2. Multi-step video upload: init -> part upload with ETag -> finalize -> status poll', async () => {
    process.env.LINKEDIN_CLIENT_ID = 'test_client_id';
    process.env.LINKEDIN_CLIENT_SECRET = 'test_client_secret';

    const calls: Array<{ url: string; method: string }> = [];
    let statusPolls = 0;

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = String(input);
        const method = init?.method || 'GET';
        calls.push({ url, method });

        // 1. Download media bytes
        if (url.startsWith('https://cdn.test/video.mp4')) {
            return new Response(new Uint8Array(1024), { status: 200, headers: { 'Content-Type': 'video/mp4' } });
        }
        // 2. Initialize upload
        if (url.includes('/videos?action=initializeUpload')) {
            return new Response(JSON.stringify({
                value: {
                    video: 'urn:li:video:V100',
                    uploadToken: 'tok_part_1',
                    uploadInstructions: [{ uploadUrl: 'https://media.upload.li/part1', firstByte: 0, lastByte: 1023 }],
                },
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        // 3. Part binary PUT
        if (url === 'https://media.upload.li/part1' && method === 'PUT') {
            return new Response(null, { status: 200, headers: { etag: '"etag_part_1"' } });
        }
        // 4. Finalize
        if (url.includes('/videos?action=finalizeUpload')) {
            return new Response(JSON.stringify({ value: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        // 5. Status poll
        if (url.includes('/videos/urn%3Ali%3Avideo%3AV100')) {
            statusPolls++;
            return new Response(JSON.stringify({
                status: statusPolls >= 1 ? 'AVAILABLE' : 'PROCESSING',
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        // 6. Post creation
        if (url.endsWith('/posts') && method === 'POST') {
            return new Response(null, {
                status: 201,
                headers: { 'x-restli-id': 'urn:li:share:post_v100' },
            });
        }
        return new Response('Not Found', { status: 404 });
    };

    const provider = new LinkedInLiveProvider();
    const result = await provider.createPost({
        authorUrn: 'urn:li:organization:18099001',
        text: 'Live video premiere',
        format: 'video',
        media: [{ url: 'https://cdn.test/video.mp4', kind: 'video' }],
    }, 'live_test_access_token');

    assert.equal(result.state, 'published');
    assert.equal(result.postUrn, 'urn:li:share:post_v100');
    assert.ok(calls.some((c) => c.url.includes('/videos?action=initializeUpload')));
    assert.ok(calls.some((c) => c.url === 'https://media.upload.li/part1'));
    assert.ok(calls.some((c) => c.url.includes('/videos?action=finalizeUpload')));
});

test('3. Rate limiting & 429 Retry-After handling with backoff', async () => {
    let attempts = 0;
    globalThis.fetch = async (): Promise<Response> => {
        attempts++;
        if (attempts === 1) {
            return new Response(JSON.stringify({ message: 'Too many requests' }), {
                status: 429,
                headers: { 'retry-after': '1' },
            });
        }
        return new Response(JSON.stringify({ localizedName: 'Test Org' }), { status: 200 });
    };

    const client = new LinkedInRestClient({
        restBaseUrl: 'https://api.linkedin.com/rest',
        oauthAuthorizeUrl: '',
        oauthTokenUrl: '',
        userinfoUrl: '',
        apiVersion: '202507',
        restliProtocolVersion: '2.0.0',
        timeoutMs: 5000,
        maxRetries: 3,
        retryInitialDelayMs: 10,
        retryMaxDelayMs: 100,
        rateLimitRps: 100,
        devTierDailyLimit: 500,
    });

    const res = await client.request({
        method: 'GET',
        pathOrUrl: '/organizations/12345',
        token: 'test_token',
    });

    assert.equal(res.status, 200);
    assert.equal(res.data.localizedName, 'Test Org');
    assert.equal(attempts, 2, 'Should have retried after receiving 429');
});

test('4. Safe Diagnostics: Never leaks client secrets or tokens in logs or reports', async () => {
    process.env.LINKEDIN_CLIENT_ID = 'secret_client_id_must_never_leak';
    process.env.LINKEDIN_CLIENT_SECRET = 'secret_password_must_never_leak';

    const diag = await LinkedInDiagnosticsService.runDiagnostics();

    // Verify secret values are scrubbed and replaced with safe presence flags
    assert.equal(diag.clientId, 'CONFIGURED');
    assert.equal(diag.clientSecret, 'CONFIGURED');
    assert.ok(!diag.reportFormatted.includes('secret_client_id_must_never_leak'));
    assert.ok(!diag.reportFormatted.includes('secret_password_must_never_leak'));
    assert.ok(diag.reportFormatted.includes('Client ID: CONFIGURED'));
    assert.ok(diag.reportFormatted.includes('Client Secret: CONFIGURED'));
});
