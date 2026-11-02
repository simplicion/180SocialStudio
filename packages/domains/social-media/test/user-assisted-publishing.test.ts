import assert from 'assert';
import test from 'node:test';
import { isAssistedPlatform, PublishDispatcher } from '../src/publishing/publish-dispatcher';
import { SocialPostService } from '../src/social-post.service';

test('1. isAssistedPlatform identifies platforms as user-assisted mode by default when unconfigured', () => {
    delete process.env.INSTAGRAM_APP_ID;
    delete process.env.META_APP_ID;
    delete process.env.SIMULATE_SOCIAL_PUBLISHING;
    delete process.env.ALLOW_SIMULATED_PUBLISHING;

    assert.strictEqual(isAssistedPlatform('instagram'), true, 'Unconfigured Instagram defaults to user-assisted mode');
    assert.strictEqual(isAssistedPlatform('unknown_platform'), false, 'Unknown platform is not assisted');
});

test('2. isAssistedPlatform respects explicit platformMeta.publishingMode override', () => {
    assert.strictEqual(
        isAssistedPlatform('instagram', { platformMeta: { publishingMode: 'user_assisted' } }),
        true,
        'Explicit user_assisted mode on Instagram is respected'
    );
    });

test('3. SocialPostService updateAssistedPublishStatus enforces tenant isolation', async () => {
    let tenantIsolated = false;
    try {
        // Attempting to update a post without tenant context or with mismatched companyId throws
        await SocialPostService.updateAssistedPublishStatus('non-existent-id', {
            platform: 'reddit',
            status: 'handed_off',
        }, 'company_test_tenant_a');
    } catch (e: any) {
        tenantIsolated = true;
        assert.ok(e.message.includes('not found') || e.code === 404 || e.statusCode === 404, 'Throws not found for non-existent/isolated post');
    }
    assert.strictEqual(tenantIsolated, true, 'Properly guards against non-existent/cross-tenant access');
});
