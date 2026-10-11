import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { FetchMock, createFakeDb, json, setTestEnv } from './fakes';
import { setPublishingDb } from '../../src/publishing/http';
import { MetaWebhooksService } from '../../src/publishing/webhooks.service';
import { SocialTokenVault } from '../../src/publishing/token-vault';
import { SocialPublishScheduler } from '../../src/publishing/scheduler';

const COMPANY_ID = 'comp_webhook_test';
const META_SECRET = 'test_meta_app_secret_999999999999';
const VERIFY_TOKEN = 'test_hub_verify_token_180workspace';

function createSignedRequest(payload: Record<string, any>, secret: string): string {
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
    return `${sig}.${payloadB64}`;
}

function createSignatureHeader(body: string | Buffer, secret: string): string {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
    const sig = crypto.createHmac('sha256', secret).update(buf).digest('hex');
    return `sha256=${sig}`;
}

test('Meta Webhook Challenge: Handshake correctly verifies hub.verify_token and returns challenge', () => {
    process.env.META_WEBHOOK_VERIFY_TOKEN = VERIFY_TOKEN;

    // 1. Success case: matches mode and token
    const res1 = MetaWebhooksService.verifyChallenge({
        'hub.mode': 'subscribe',
        'hub.verify_token': VERIFY_TOKEN,
        'hub.challenge': '1158201244',
    });
    assert.equal(res1.success, true);
    assert.equal(res1.statusCode, 200);
    assert.equal(res1.challenge, '1158201244');

    // 2. Failure: wrong verify token
    const res2 = MetaWebhooksService.verifyChallenge({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'wrong_token',
        'hub.challenge': '1158201244',
    });
    assert.equal(res2.success, false);
    assert.equal(res2.statusCode, 403);

    // 3. Failure: wrong mode
    const res3 = MetaWebhooksService.verifyChallenge({
        'hub.mode': 'unsubscribe',
        'hub.verify_token': VERIFY_TOKEN,
        'hub.challenge': '1158201244',
    });
    assert.equal(res3.success, false);
    assert.equal(res3.statusCode, 403);
});

test('Meta Webhook Signature: Verifies x-hub-signature-256 with timing-safe HMAC', () => {
    process.env.META_APP_SECRET = META_SECRET;
    delete process.env.META_WEBHOOK_APP_SECRET;

    const payload = JSON.stringify({ object: 'page', entry: [{ id: '123', time: 1000 }] });
    const validHeader = createSignatureHeader(payload, META_SECRET);

    // 1. Valid signature matches
    assert.equal(MetaWebhooksService.verifySignature(payload, validHeader), true);

    // 2. Tampered body fails verification
    const tamperedPayload = JSON.stringify({ object: 'page', entry: [{ id: '123', time: 9999 }] });
    assert.equal(MetaWebhooksService.verifySignature(tamperedPayload, validHeader), false);

    // 3. Missing or corrupt header fails
    assert.equal(MetaWebhooksService.verifySignature(payload, undefined), false);
    assert.equal(MetaWebhooksService.verifySignature(payload, 'sha256=invalidhex123'), false);
    assert.equal(MetaWebhooksService.verifySignature(payload, 'invalid_header_format'), false);
});

test('Meta Deauthorization Callback: Marks connected accounts as reauthRequired', async () => {
    process.env.META_APP_SECRET = META_SECRET;
    const fakeDb = createFakeDb();
    setPublishingDb(fakeDb);

    const metaUserId = 'meta_user_998877';

    // Seed account
    const acc = await fakeDb.socialAccount.create({
        data: {
            companyId: COMPANY_ID,
            platform: 'instagram',
            platformAccountId: metaUserId,
            accountName: 'Test IG Brand',
            username: 'test_brand_ig',
            reauthRequired: false,
        },
    });

    const signedRequest = createSignedRequest({
        user_id: metaUserId,
        algorithm: 'HMAC-SHA256',
        issued_at: Math.floor(Date.now() / 1000),
    }, META_SECRET);

    const result = await MetaWebhooksService.handleDeauthorization(signedRequest);
    assert.equal(result.success, true);
    assert.equal(result.accountsAffected, 1);

    const updated = await fakeDb.socialAccount.findUnique({ where: { id: acc.id } });
    assert.equal(updated.reauthRequired, true);
    assert.match(updated.reauthReason, /revoked app authorization/i);
});

test('Meta Data Deletion Callback: Shreds credentials and returns GDPR compliance URL', async () => {
    process.env.META_APP_SECRET = META_SECRET;
    process.env.CLIENT_URL = 'https://180workspace.com';
    const fakeDb = createFakeDb();
    setPublishingDb(fakeDb);

    const metaUserId = 'meta_user_443322';

    // Seed account and credential
    const acc = await fakeDb.socialAccount.create({
        data: {
            companyId: COMPANY_ID,
            platform: 'facebook',
            platformAccountId: metaUserId,
            accountName: 'Facebook Page Deletion Test',
            username: 'fb_del_test',
            isActive: true,
        },
    });

    await fakeDb.socialAccountCredential.create({
        data: {
            companyId: COMPANY_ID,
            socialAccountId: acc.id,
            accessTokenEnc: 'v1.enc.token',
        },
    });

    const signedRequest = createSignedRequest({
        user_id: metaUserId,
        algorithm: 'HMAC-SHA256',
        issued_at: Math.floor(Date.now() / 1000),
    }, META_SECRET);

    const deletionResponse = await MetaWebhooksService.handleDataDeletion(signedRequest);

    // Verify response conforms to Meta protocol
    assert.ok(deletionResponse.confirmation_code.startsWith('del_'));
    assert.equal(deletionResponse.url, `https://180workspace.com/data-deletion?id=${deletionResponse.confirmation_code}`);

    // Verify credential was completely deleted
    const credCount = await fakeDb.socialAccountCredential.count({ where: { socialAccountId: acc.id } });
    assert.equal(credCount, 0);

    // Verify account was marked inactive with confirmation code in metadata
    const updated = await fakeDb.socialAccount.findUnique({ where: { id: acc.id } });
    assert.equal(updated.isActive, false);
    assert.equal(updated.reauthRequired, true);
    assert.equal(updated.metadata?.dataDeletion?.confirmationCode, deletionResponse.confirmation_code);
});

test('Meta Webhook Events: Ingests incoming messaging & comments into Social Inbox', async () => {
    const fakeDb = createFakeDb();
    setPublishingDb(fakeDb);

    const pageId = 'fb_page_55555';
    const igAccountId = 'ig_business_77777';

    // Seed Instagram and Facebook accounts
    const igAcc = await fakeDb.socialAccount.create({
        data: {
            companyId: COMPANY_ID,
            platform: 'instagram',
            platformAccountId: igAccountId,
            accountName: 'IG Storefront',
            username: 'ig_storefront',
            isActive: true,
        },
    });

    // 1. Ingest Instagram DM
    const igPayload = {
        object: 'instagram',
        entry: [
            {
                id: igAccountId,
                time: 1712345678,
                messaging: [
                    {
                        sender: { id: 'customer_ig_user_123' },
                        recipient: { id: igAccountId },
                        message: {
                            mid: 'm_mid_ig_101',
                            text: 'Hi! Is this item still in stock?',
                        },
                    },
                ],
            },
        ],
    };

    const igResult = await MetaWebhooksService.handleWebhookEvent(igPayload);
    assert.equal(igResult.success, true);
    assert.equal(igResult.messagesIngested, 1);

    // Verify conversation was created
    const conversations = await fakeDb.socialConversation.findMany({ where: { companyId: COMPANY_ID } });
    assert.equal(conversations.length, 1);
    assert.equal(conversations[0].platform, 'instagram');
    assert.equal(conversations[0].platformThreadId, 'customer_ig_user_123');
    assert.equal(conversations[0].lastMessageSnippet, 'Hi! Is this item still in stock?');

    // Verify message was created
    const messages = await fakeDb.socialMessage.findMany({ where: { conversationId: conversations[0].id } });
    assert.equal(messages.length, 1);
    assert.equal(messages[0].senderType, 'participant');
    assert.equal(messages[0].content, 'Hi! Is this item still in stock?');
    assert.equal(messages[0].platformMessageId, 'm_mid_ig_101');
});

test('Proactive Token Refresh: really refreshes a token expiring within the window (not only inside the 5-minute skew)', async () => {
    const fakeDb = createFakeDb();
    setPublishingDb(fakeDb);
    setTestEnv();
    process.env.THREADS_APP_ID = 'threads_app_test';
    process.env.THREADS_APP_SECRET = 'threads_secret_test';

    const acc = await fakeDb.socialAccount.create({
        data: { companyId: COMPANY_ID, platform: 'threads', platformAccountId: 'threads_user_1', accountName: 'Threads Creator', username: 'th_creator', isActive: true, reauthRequired: false },
    });
    // Expires in 2 days: far outside the 300 s on-demand skew, inside the 7-day proactive window.
    await SocialTokenVault.saveTokens(acc.id, COMPANY_ID, {
        accessToken: 'th_old_token', refreshToken: 'th_old_token', expiresAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), scopes: [],
    });

    const calls: string[] = [];
    const mock = new FetchMock((c) => {
        const u = new URL(c.url);
        calls.push(u.pathname);
        if (u.host === 'graph.threads.net' && u.pathname === '/refresh_access_token') {
            return json(200, { access_token: 'th_new_token', token_type: 'bearer', expires_in: 5184000 });
        }
    }).install();
    try {
        const r = await SocialTokenVault.proactiveRefreshExpiringTokens();
        assert.deepEqual(r, { refreshed: 1, failed: 0 });
        assert.ok(calls.includes('/refresh_access_token'), 'the provider refresh endpoint must be called');
        assert.equal(await SocialTokenVault.getAccessToken({ id: acc.id, companyId: COMPANY_ID, platform: 'threads' }), 'th_new_token');
    } finally {
        mock.restore();
    }
});
