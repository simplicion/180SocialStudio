/**
 * Unit & Integration tests for MockLinkedInProvider:
 * Full lifecycle verification, post variants, media uploads, comments, reactions,
 * analytics, and error simulation without any live network access.
 * Run: npx tsx --test --test-force-exit packages/domains/social-media/test/linkedin/linkedin-mock-provider.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { MockLinkedInProvider, LinkedInIntegrationError } from '../../src/linkedin';

test('1. Mock OAuth URL generation and code exchange', async () => {
    const mock = new MockLinkedInProvider();
    const authUrl = await mock.getAuthorizationUrl({
        state: 'signed_test_state',
        redirectUri: 'https://api.180workspace.com/api/v1/social-media/accounts/oauth/linkedin/callback',
        scopes: ['openid', 'profile', 'w_member_social'],
    });

    assert.ok(authUrl.includes('client_id=mock_linkedin_client_id'));
    assert.ok(authUrl.includes('state=signed_test_state'));

    const tokens = await mock.exchangeCode({
        code: 'valid_auth_code',
        redirectUri: 'https://api.180workspace.com/api/v1/social-media/accounts/oauth/linkedin/callback',
    });

    assert.ok(tokens.accessToken.startsWith('mock_access_token_'));
    assert.ok(tokens.refreshToken.startsWith('mock_refresh_token_'));
    assert.ok(tokens.expiresAt instanceof Date);

    // Refresh flow
    const refreshed = await mock.refreshToken(tokens.refreshToken);
    assert.ok(refreshed.accessToken.startsWith('mock_refreshed_access_token_'));
});

test('2. Member Profile & Organization discovery in mock mode', async () => {
    const mock = new MockLinkedInProvider();
    const member = await mock.getAuthenticatedMember('mock_token');
    assert.equal(member.memberId, 'mock_member_180');
    assert.equal(member.urn, 'urn:li:person:mock_member_180');
    assert.equal(member.name, 'Alex Rivera (Demo)');

    const orgs = await mock.getOrganizations('mock_token');
    assert.equal(orgs.length, 2);
    assert.equal(orgs[0].name, '180 Workspace Global');
    assert.equal(orgs[0].role, 'ADMINISTRATOR');
    assert.equal(orgs[0].capabilities.canCreateOrganizationPost, true);

    const singleOrg = await mock.getOrganization('18099001', 'mock_token');
    assert.ok(singleOrg);
    assert.equal(singleOrg.name, '180 Workspace Global');
});

test('3. Text, Image, Video, and Carousel Post publication in mock mode', async () => {
    const mock = new MockLinkedInProvider();
    const token = 'mock_token';

    // 3a. Text Post
    const textPost = await mock.createPost({
        authorUrn: 'urn:li:person:mock_member_180',
        text: 'Exciting product update from 180 Workspace!',
        format: 'text',
        firstComment: 'Check our docs here: https://180workspace.com',
    }, token);

    assert.equal(textPost.state, 'published');
    assert.equal(textPost.isSimulated, true);
    assert.ok(textPost.activityUrn.startsWith('urn:li:activity:sim_'));
    assert.ok(textPost.url.includes('linkedin.com/feed/update/'));

    // Verify first comment was automatically recorded
    const comments = await mock.listComments(textPost.postUrn, token);
    assert.equal(comments.length, 1);
    assert.equal(comments[0].message, 'Check our docs here: https://180workspace.com');

    // 3b. Image Post with Media Upload
    const imgUrn = await mock.uploadMedia({
        url: 'https://cdn.test/banner.png',
        kind: 'image',
    }, 'urn:li:organization:18099001', token);
    assert.ok(imgUrn.startsWith('urn:li:image:sim_'));

    const imgPost = await mock.createPost({
        authorUrn: 'urn:li:organization:18099001',
        text: 'Visual showcase',
        format: 'image',
        media: [{ url: 'https://cdn.test/banner.png', kind: 'image' }],
    }, token);
    assert.equal(imgPost.state, 'published');

    // 3c. Video Post
    const videoUrn = await mock.uploadMedia({
        url: 'https://cdn.test/video.mp4',
        kind: 'video',
    }, 'urn:li:organization:18099001', token);
    assert.ok(videoUrn.startsWith('urn:li:video:sim_'));

    // 3d. Document Carousel Post
    const docUrn = await mock.uploadMedia({
        url: 'https://cdn.test/whitepaper.pdf',
        kind: 'document',
    }, 'urn:li:organization:18099001', token);
    assert.ok(docUrn.startsWith('urn:li:document:sim_'));
});

test('4. Comment and Reaction lifecycle in mock mode', async () => {
    const mock = new MockLinkedInProvider();
    const token = 'mock_token';
    const postUrn = 'urn:li:share:sim_lifecycle_test';

    // Comments
    const comment1 = await mock.createComment(postUrn, 'Great product!', 'urn:li:person:user1', token);
    assert.ok(comment1.id.startsWith('urn:li:comment:sim_'));
    assert.equal(comment1.message, 'Great product!');

    const commentList = await mock.listComments(postUrn, token);
    assert.ok(commentList.some((c) => c.message === 'Great product!'));

    const deleted = await mock.deleteComment(comment1.id, token);
    assert.equal(deleted, true);

    // Reactions
    await mock.createReaction(postUrn, 'LIKE', 'urn:li:person:user1', token);
    await mock.createReaction(postUrn, 'CELEBRATE', 'urn:li:person:user2', token);

    const reactions = await mock.listReactions(postUrn, token);
    assert.ok(reactions.length >= 2);
    assert.ok(reactions.some((r) => r.reactionType === 'CELEBRATE'));

    await mock.deleteReaction(postUrn, 'urn:li:person:user1', token);
    const afterDelete = await mock.listReactions(postUrn, token);
    assert.ok(!afterDelete.some((r) => r.actorUrn === 'urn:li:person:user1'));
});

test('5. Analytics in mock mode returns normalized metrics', async () => {
    const mock = new MockLinkedInProvider();
    const analytics = await mock.getAnalytics('urn:li:organization:18099001', '30d', 'mock_token');

    assert.equal(analytics.platform, 'linkedin');
    assert.equal(analytics.period, '30d');
    assert.equal(analytics.isSimulated, true);
    assert.ok(analytics.metrics.some((m) => m.name === 'impressions' && m.value > 0));
    assert.ok(analytics.metrics.some((m) => m.name === 'engagement_rate' && m.value > 0));
});

test('6. Injected error simulations (rate-limit, token expiration, upload failure)', async () => {
    const mock = new MockLinkedInProvider();

    // 429 Rate Limit simulation
    mock.setSimulatedRateLimit(true);
    await assert.rejects(
        () => mock.createPost({ authorUrn: 'urn:li:person:p1', text: 'hi', format: 'text' }, 'mock_token'),
        (err: any) => err instanceof LinkedInIntegrationError && err.code === 'RATE_LIMITED' && err.httpStatus === 429
    );
    mock.setSimulatedRateLimit(false);

    // Token expired simulation
    await assert.rejects(
        () => mock.getAuthenticatedMember('expired_token'),
        (err: any) => err instanceof LinkedInIntegrationError && err.code === 'TOKEN_EXPIRED' && err.httpStatus === 401
    );

    // Upload failure simulation
    await assert.rejects(
        () => mock.uploadMedia({ url: 'https://cdn.test/fail-upload.png', kind: 'image' }, 'urn:li:person:p1', 'mock_token'),
        (err: any) => err instanceof LinkedInIntegrationError && err.code === 'MEDIA_UPLOAD_FAILED'
    );
});
