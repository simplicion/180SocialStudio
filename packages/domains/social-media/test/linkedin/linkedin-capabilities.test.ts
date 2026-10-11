/**
 * Unit & Integration tests for LinkedIn Capability Matrix and Dynamic Resolver.
 * Run: npx tsx --test --test-force-exit packages/domains/social-media/test/linkedin/linkedin-capabilities.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLinkedInCapabilities, LINKEDIN_SCOPES, DEFAULT_MEMBER_SCOPES, COMMUNITY_MANAGEMENT_ORG_SCOPES } from '../../src/linkedin';

test('1. Member Account with Share on LinkedIn scopes has member posting capabilities only', () => {
    const caps = resolveLinkedInCapabilities({
        accountKind: 'member',
        scopes: DEFAULT_MEMBER_SCOPES,
        mode: 'live',
    });

    assert.equal(caps.canConnectAccount, true);
    assert.equal(caps.canReadProfile, true);
    assert.equal(caps.canCreateMemberPost, true);
    assert.equal(caps.canUploadImage, true);
    assert.equal(caps.canUploadVideo, true);
    assert.equal(caps.canUploadDocument, true);

    // Organization & Community Management features MUST be false
    assert.equal(caps.canCreateOrganizationPost, false);
    assert.equal(caps.canReadPosts, false);
    assert.equal(caps.canReadComments, false);
    assert.equal(caps.canCreateComment, false);
    assert.equal(caps.canReadAnalytics, false);
    assert.equal(caps.canReadFollowerStats, false);
});

test('2. Organization Account with Community Management scopes and ADMINISTRATOR role', () => {
    const caps = resolveLinkedInCapabilities({
        accountKind: 'organization',
        scopes: [...DEFAULT_MEMBER_SCOPES, ...COMMUNITY_MANAGEMENT_ORG_SCOPES],
        orgRole: 'ADMINISTRATOR',
        mode: 'live',
    });

    assert.equal(caps.canConnectAccount, true);
    assert.equal(caps.canReadProfile, true);
    assert.equal(caps.canReadOrganizations, true);
    assert.equal(caps.canReadOrganizationDetails, true);
    assert.equal(caps.canCreateOrganizationPost, true);
    assert.equal(caps.canUploadImage, true);
    assert.equal(caps.canUploadVideo, true);
    assert.equal(caps.canUploadDocument, true);
    assert.equal(caps.canReadPosts, true);
    assert.equal(caps.canReadComments, true);
    assert.equal(caps.canCreateComment, true);
    assert.equal(caps.canDeleteComment, true);
    assert.equal(caps.canReadReactions, true);
    assert.equal(caps.canCreateReaction, true);
    assert.equal(caps.canDeleteReaction, true);
    assert.equal(caps.canReadAnalytics, true);
    assert.equal(caps.canReadPageStats, true);
    assert.equal(caps.canCreateMemberPost, false); // Not a member account
});

test('3. Organization Account with insufficient or read-only role denies publishing', () => {
    const caps = resolveLinkedInCapabilities({
        accountKind: 'organization',
        scopes: [...DEFAULT_MEMBER_SCOPES, ...COMMUNITY_MANAGEMENT_ORG_SCOPES],
        orgRole: 'ANALYST', // Read-only analyst role
        mode: 'live',
    });

    assert.equal(caps.canCreateOrganizationPost, false);
    assert.equal(caps.canCreateComment, false);
    assert.equal(caps.canCreateReaction, false);
    assert.equal(caps.canReadAnalytics, true); // Still can read analytics
});

test('4. Missing write scope denies posting even for Administrator', () => {
    const caps = resolveLinkedInCapabilities({
        accountKind: 'organization',
        scopes: ['openid', 'profile', 'r_organization_social'], // missing w_organization_social
        orgRole: 'ADMINISTRATOR',
        mode: 'live',
    });

    assert.equal(caps.canCreateOrganizationPost, false);
    assert.equal(caps.canReadPosts, true);
    assert.equal(caps.canReadAnalytics, true);
});

test('5. Mock mode enables all simulated capabilities across sandbox testing', () => {
    const memberCaps = resolveLinkedInCapabilities({
        accountKind: 'member',
        scopes: [],
        mode: 'mock',
    });
    assert.equal(memberCaps.canCreateMemberPost, true);
    assert.equal(memberCaps.canReadComments, true);

    const orgCaps = resolveLinkedInCapabilities({
        accountKind: 'organization',
        scopes: [],
        mode: 'mock',
    });
    assert.equal(orgCaps.canCreateOrganizationPost, true);
    assert.equal(orgCaps.canReadAnalytics, true);
    assert.equal(orgCaps.canCreateReaction, true);
});
