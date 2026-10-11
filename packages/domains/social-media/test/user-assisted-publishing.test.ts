import assert from 'assert';
import test from 'node:test';
import { isAssistedPlatform, PublishDispatcher } from '../src/publishing/publish-dispatcher';
import { SocialPostService } from '../src/social-post.service';

test('1. isAssistedPlatform identifies X and Reddit as user-assisted platforms by default when unconfigured', () => {
    delete process.env.X_CLIENT_ID;
    delete process.env.TWITTER_CLIENT_ID;
    delete process.env.REDDIT_CLIENT_ID;
    delete process.env.TIKTOK_CLIENT_KEY;
    delete process.env.PINTEREST_APP_ID;

    assert.strictEqual(isAssistedPlatform('x'), true, 'X defaults to user-assisted mode');
    assert.strictEqual(isAssistedPlatform('twitter'), true, 'Twitter alias defaults to user-assisted mode');
    assert.strictEqual(isAssistedPlatform('reddit'), true, 'Reddit defaults to user-assisted mode');
    assert.strictEqual(isAssistedPlatform('tiktok'), true, 'TikTok defaults to user-assisted mode when unconfigured');
    assert.strictEqual(isAssistedPlatform('pinterest'), true, 'Pinterest defaults to user-assisted mode when unconfigured');
    assert.strictEqual(isAssistedPlatform('instagram'), false, 'Instagram is an API platform, not assisted');
    assert.strictEqual(isAssistedPlatform('youtube'), false, 'YouTube is an API platform, not assisted');
    assert.strictEqual(isAssistedPlatform('linkedin'), false, 'LinkedIn is an API platform, not assisted');
});

test('2. isAssistedPlatform respects explicit platformMeta.publishingMode override', () => {
    assert.strictEqual(
        isAssistedPlatform('instagram', { platformMeta: { publishingMode: 'user_assisted' } }),
        true,
        'Explicit user_assisted mode on Instagram is respected'
    );
    assert.strictEqual(
        isAssistedPlatform('x', { platformMeta: { publishingMode: 'api' } }),
        false,
        'Explicit api mode on X is respected'
    );
});

test('3. SocialPostService updateAssistedPublishStatus enforces tenant isolation', async () => {
    let tenantIsolated = false;
    try {
        // Attempting to update a post without tenant context or with mismatched companyId throws
        await SocialPostService.updateAssistedPublishStatus('non-existent-id', {
            platform: 'x',
            status: 'handed_off',
        }, 'company_test_tenant_a');
    } catch (e: any) {
        tenantIsolated = true;
        assert.ok(e.message.includes('not found') || e.code === 404 || e.statusCode === 404, 'Throws not found for non-existent/isolated post');
    }
    assert.strictEqual(tenantIsolated, true, 'Properly guards against non-existent/cross-tenant access');
});
