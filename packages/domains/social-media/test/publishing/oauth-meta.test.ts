/**
 * Comprehensive Test Suite for Instagram Business Login and Threads OAuth Flows:
 * Tests OAuth start, state validation, replay protection, token exchange, account discovery,
 * encrypted token storage (AES-256-GCM vault), and token refresh.
 *
 * Run: npx tsx --test --test-force-exit packages/domains/social-media/test/publishing/oauth-meta.test.ts
 */
import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { FetchMock, createFakeDb, json, setTestEnv } from './fakes';

setTestEnv();

import { setPublishingDb, timing } from '../../src/publishing/http';
import { SocialOAuthService, verifyState, signState } from '../../src/publishing/oauth.service';
import { SocialTokenVault } from '../../src/publishing/token-vault';
import { getOAuthProvider } from '../../src/publishing/oauth-providers';

let mock: FetchMock | null = null;
let fakeDb: ReturnType<typeof createFakeDb>;

const COMPANY_ID = 'comp_meta_test';
const USER_ID = 'user_meta_test';
const PROJECT_ID = 'proj_meta_test';
const REDIRECT_URI = 'https://app.test.example/dashboard/social/connected';

beforeEach(() => {
    fakeDb = createFakeDb();
    setPublishingDb(fakeDb);

    // Seed test company project
    fakeDb.project.rows.push({
        id: PROJECT_ID,
        companyId: COMPANY_ID,
        name: 'Test Meta Growth Project',
    });
});

afterEach(() => {
    mock?.restore();
    setPublishingDb(null);
});

test('OAuth Start: Instagram Business Login constructs correct authorize URL', async () => {
    process.env.INSTAGRAM_APP_ID = '1123089790067219';
    process.env.INSTAGRAM_APP_SECRET = 'ig_secret_test_123';

    const result = await SocialOAuthService.start({
        platform: 'instagram',
        companyId: COMPANY_ID,
        userId: USER_ID,
        projectId: PROJECT_ID,
        redirectUri: REDIRECT_URI,
        client: 'web',
    });

    assert.ok(result.url, 'must return authorize url');
    assert.ok(result.url.startsWith('https://www.instagram.com/oauth/authorize'), 'must use direct instagram authorize URL');

    const parsed = new URL(result.url);
    assert.equal(parsed.searchParams.get('client_id'), '1123089790067219');
    assert.equal(parsed.searchParams.get('enable_fb_login'), '0');
    assert.equal(parsed.searchParams.get('force_authentication'), '1');
    assert.equal(parsed.searchParams.get('response_type'), 'code');
    assert.equal(parsed.searchParams.get('redirect_uri'), 'https://api.test.example/api/v1/social-media/accounts/oauth/instagram/callback');

    const scopes = parsed.searchParams.get('scope')?.split(',') || [];
    assert.ok(scopes.includes('instagram_business_basic'));
    assert.ok(scopes.includes('instagram_business_content_publish'));
    assert.ok(scopes.includes('instagram_business_manage_messages'));
    assert.ok(scopes.includes('instagram_business_manage_comments'));

    // Verify session row created in database
    const session = fakeDb.socialOAuthSession.rows[0];
    assert.ok(session, 'OAuth session must be persisted');
    assert.equal(session.companyId, COMPANY_ID);
    assert.equal(session.userId, USER_ID);
    assert.equal(session.platform, 'instagram');
    assert.equal(session.status, 'pending');
});

test('OAuth Start: Threads constructs correct authorize URL with all 10 scopes', async () => {
    process.env.THREADS_APP_ID = '1132232105894760';
    process.env.THREADS_APP_SECRET = 'th_secret_test_456';

    const result = await SocialOAuthService.start({
        platform: 'threads',
        companyId: COMPANY_ID,
        userId: USER_ID,
        projectId: PROJECT_ID,
        redirectUri: REDIRECT_URI,
        client: 'web',
    });

    assert.ok(result.url, 'must return authorize url');
    assert.ok(result.url.startsWith('https://threads.net/oauth/authorize'), 'must use threads.net authorize URL');

    const parsed = new URL(result.url);
    assert.equal(parsed.searchParams.get('client_id'), '1132232105894760');
    assert.equal(parsed.searchParams.get('response_type'), 'code');
    assert.equal(parsed.searchParams.get('redirect_uri'), 'https://api.test.example/api/v1/social-media/accounts/oauth/threads/callback');

    const scopes = parsed.searchParams.get('scope')?.split(',') || [];
    assert.ok(scopes.includes('threads_basic'), 'scope threads_basic');
    assert.ok(scopes.includes('threads_content_publish'), 'scope threads_content_publish');
    assert.ok(scopes.includes('threads_delete'), 'scope threads_delete');
    assert.ok(scopes.includes('threads_keyword_search'), 'scope threads_keyword_search');
    assert.ok(scopes.includes('threads_manage_insights'), 'scope threads_manage_insights');
    assert.ok(scopes.includes('threads_manage_mentions'), 'scope threads_manage_mentions');
    assert.ok(scopes.includes('threads_manage_replies'), 'scope threads_manage_replies');
    assert.ok(scopes.includes('threads_read_replies'), 'scope threads_read_replies');
    assert.ok(scopes.includes('threads_profile_discovery'), 'scope threads_profile_discovery');
    assert.ok(scopes.includes('threads_share_to_instagram'), 'scope threads_share_to_instagram');
});

test('State Validation & Tamper Protection: Rejects invalid or expired state signatures', async () => {
    const start = await SocialOAuthService.start({
        platform: 'instagram',
        companyId: COMPANY_ID,
        userId: USER_ID,
        redirectUri: REDIRECT_URI,
    });

    // Valid state can be verified
    const payload = verifyState(start.state);
    assert.equal(payload.pf, 'instagram');
    assert.equal(payload.c, COMPANY_ID);

    // Tampered signature must throw
    const [body, sig] = start.state.split('.');
    const tampered = `${body}.invalidsignature123`;
    assert.throws(() => verifyState(tampered), /signature is invalid/);

    // Expired state must throw
    const expiredPayload = { ...payload, exp: timing.now() - 1000 };
    const expiredState = signState(expiredPayload);
    assert.throws(() => verifyState(expiredState), /expired/);
});

test('Replay Attack Protection: Session can only be consumed once', async () => {
    process.env.INSTAGRAM_APP_ID = '1123089790067219';
    process.env.INSTAGRAM_APP_SECRET = 'ig_secret_test_123';

    const start = await SocialOAuthService.start({
        platform: 'instagram',
        companyId: COMPANY_ID,
        userId: USER_ID,
        redirectUri: REDIRECT_URI,
    });

    mock = new FetchMock((c) => {
        const u = new URL(c.url);
        if (u.pathname === '/oauth/access_token' && c.method === 'POST') {
            return json(200, { access_token: 'short_ig_tok_1', user_id: '17841480572901770' });
        }
        if (u.pathname === '/access_token' && c.method === 'GET') {
            return json(200, { access_token: 'long_ig_tok_1', token_type: 'bearer', expires_in: 5184000 });
        }
        if (u.pathname.includes('/me') && c.method === 'GET') {
            return json(200, {
                user_id: '17841480572901770',
                username: 'prince_gupta_here',
                name: 'Prince Gupta',
                profile_picture_url: 'https://cdn.example/pic.jpg',
            });
        }
    }).install();

    // First consumption succeeds
    const firstCallback = await SocialOAuthService.callback('instagram', {
        code: 'auth_code_123',
        state: start.state,
    });
    assert.equal(firstCallback.status, 'connected');

    // Second consumption with the identical state MUST fail
    await assert.rejects(
        SocialOAuthService.callback('instagram', {
            code: 'auth_code_123',
            state: start.state,
        }),
        /already used/
    );
});

test('Instagram Business Login: Complete code exchange, account discovery, and vault encryption', async () => {
    process.env.INSTAGRAM_APP_ID = '1123089790067219';
    process.env.INSTAGRAM_APP_SECRET = 'ig_secret_test_123';

    const start = await SocialOAuthService.start({
        platform: 'instagram',
        companyId: COMPANY_ID,
        userId: USER_ID,
        projectId: PROJECT_ID,
        redirectUri: REDIRECT_URI,
    });

    mock = new FetchMock((c) => {
        const u = new URL(c.url);
        if (c.method === 'POST' && u.host === 'api.instagram.com' && u.pathname === '/oauth/access_token') {
            assert.equal(c.body.client_id, '1123089790067219');
            assert.equal(c.body.client_secret, 'ig_secret_test_123');
            assert.equal(c.body.grant_type, 'authorization_code');
            assert.equal(c.body.code, 'valid_ig_code');
            return json(200, { access_token: 'ig_short_token_xyz', user_id: '17841480572901770' });
        }
        if ((c.method === 'POST' || c.method === 'GET') && u.host === 'graph.instagram.com' && u.pathname === '/access_token') {
            return json(200, { access_token: 'ig_long_token_abc', token_type: 'bearer', expires_in: 5184000 });
        }
        if (c.method === 'GET' && u.host === 'graph.instagram.com' && u.pathname.includes('/me')) {
            assert.equal(c.headers.authorization, 'Bearer ig_long_token_abc');
            return json(200, {
                user_id: '17841480572901770',
                username: 'prince_gupta_here',
                name: 'Prince Gupta',
                profile_picture_url: 'https://cdn.example/ig_avatar.jpg',
            });
        }
    }).install();

    const cbResult = await SocialOAuthService.callback('instagram', {
        code: 'valid_ig_code',
        state: start.state,
    });

    assert.equal(cbResult.status, 'connected');
    assert.ok(cbResult.redirectTo.includes('status=connected'));

    // Check database account row
    const account = fakeDb.socialAccount.rows.find((a) => a.platform === 'instagram');
    assert.ok(account, 'SocialAccount row must be created');
    assert.equal(account.platformAccountId, '17841480572901770');
    assert.equal(account.username, 'prince_gupta_here');
    assert.equal(account.accountName, 'Prince Gupta');
    assert.equal(account.companyId, COMPANY_ID);
    assert.equal(account.projectId, PROJECT_ID);
    assert.equal(account.accessToken, null, 'Plaintext access token must not be in socialAccount');
    assert.equal(account.refreshToken, null, 'Plaintext refresh token must not be in socialAccount');

    // Check encrypted vault
    const cred = fakeDb.socialAccountCredential.rows.find((cr) => cr.socialAccountId === account.id);
    assert.ok(cred, 'Vault credential row must be created');
    assert.ok(cred.accessTokenEnc.startsWith('v1.'), 'Token must be encrypted with v1 envelope');

    // Decrypt and verify token via SocialTokenVault
    const decrypted = await SocialTokenVault.getAccessToken({
        id: account.id,
        companyId: COMPANY_ID,
        platform: 'instagram',
    });
    assert.equal(decrypted, 'ig_long_token_abc', 'Token vault must successfully decrypt stored token');
});

test('Threads OAuth: Complete code exchange, profile discovery, and long-lived token storage', async () => {
    process.env.THREADS_APP_ID = '1132232105894760';
    process.env.THREADS_APP_SECRET = 'th_secret_test_456';

    const start = await SocialOAuthService.start({
        platform: 'threads',
        companyId: COMPANY_ID,
        userId: USER_ID,
        projectId: PROJECT_ID,
        redirectUri: REDIRECT_URI,
    });

    mock = new FetchMock((c) => {
        const u = new URL(c.url);
        if (c.method === 'POST' && u.host === 'graph.threads.net' && u.pathname === '/oauth/access_token') {
            assert.equal(c.body.client_id, '1132232105894760');
            assert.equal(c.body.client_secret, 'th_secret_test_456');
            assert.equal(c.body.grant_type, 'authorization_code');
            assert.equal(c.body.code, 'valid_threads_code');
            return json(200, { access_token: 'th_short_token_111', user_id: '9988776655' });
        }
        if (c.method === 'GET' && u.host === 'graph.threads.net' && u.pathname === '/access_token') {
            assert.equal(u.searchParams.get('grant_type'), 'th_exchange_token');
            assert.equal(u.searchParams.get('access_token'), 'th_short_token_111');
            return json(200, { access_token: 'th_long_token_222', token_type: 'bearer', expires_in: 5184000 });
        }
        if (c.method === 'GET' && u.host === 'graph.threads.net' && u.pathname === '/v1.0/me') {
            assert.equal(c.headers.authorization, 'Bearer th_long_token_222');
            return json(200, {
                id: '9988776655',
                username: '180workspace_official',
                name: '180 Workspace',
                threads_profile_picture_url: 'https://cdn.example/threads_pic.png',
                threads_biography: 'Automated Social Media Suite & Studio',
            });
        }
    }).install();

    const cbResult = await SocialOAuthService.callback('threads', {
        code: 'valid_threads_code',
        state: start.state,
    });

    assert.equal(cbResult.status, 'connected');
    assert.ok(cbResult.redirectTo.includes('status=connected'));

    // Check database account row
    const account = fakeDb.socialAccount.rows.find((a) => a.platform === 'threads');
    assert.ok(account, 'Threads SocialAccount row must be created');
    assert.equal(account.platformAccountId, '9988776655');
    assert.equal(account.username, '180workspace_official');
    assert.equal(account.accountName, '180 Workspace');
    assert.equal(account.metadata?.biography, 'Automated Social Media Suite & Studio');

    // Check encrypted token in vault
    const decrypted = await SocialTokenVault.getAccessToken({
        id: account.id,
        companyId: COMPANY_ID,
        platform: 'threads',
    });
    assert.equal(decrypted, 'th_long_token_222', 'Threads token must decrypt accurately from vault');
});

test('Token Refresh: Instagram Business and Threads refresh handlers renew tokens', async () => {
    mock = new FetchMock((c) => {
        const u = new URL(c.url);
        if (u.host === 'graph.instagram.com' && u.pathname === '/refresh_access_token') {
            return json(200, { access_token: 'refreshed_ig_token', token_type: 'bearer', expires_in: 5184000 });
        }
        if (u.host === 'graph.threads.net' && u.pathname === '/refresh_access_token') {
            return json(200, { access_token: 'refreshed_th_token', token_type: 'bearer', expires_in: 5184000 });
        }
    }).install();

    process.env.INSTAGRAM_APP_ID = '1123089790067219';
    const igProvider = getOAuthProvider('instagram');
    assert.ok(igProvider.refresh, 'Instagram provider must support refresh');
    const refreshedIg = await igProvider.refresh!('old_ig_token');
    assert.equal(refreshedIg.accessToken, 'refreshed_ig_token');

    const thProvider = getOAuthProvider('threads');
    assert.ok(thProvider.refresh, 'Threads provider must support refresh');
    const refreshedTh = await thProvider.refresh!('old_th_token');
    assert.equal(refreshedTh.accessToken, 'refreshed_th_token');
});
