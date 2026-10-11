/**
 * Explicit capability model for LinkedIn integration.
 * Resolves permissions dynamically based on account type, granted scopes,
 * product approval status, and organization administrative roles.
 */

import { LINKEDIN_SCOPES, LinkedInProviderMode } from './config';

export interface LinkedInCapabilities {
    canConnectAccount: boolean;
    canReadProfile: boolean;
    canReadOrganizations: boolean;
    canReadOrganizationDetails: boolean;
    canCreateOrganizationPost: boolean;
    canCreateMemberPost: boolean;
    canUploadImage: boolean;
    canUploadVideo: boolean;
    canUploadDocument: boolean;
    canReadPosts: boolean;
    canReadComments: boolean;
    canCreateComment: boolean;
    canDeleteComment: boolean;
    canReadReactions: boolean;
    canCreateReaction: boolean;
    canDeleteReaction: boolean;
    canReadAnalytics: boolean;
    canReadFollowerStats: boolean;
    canReadPageStats: boolean;
}

export interface CapabilityResolutionContext {
    accountKind: 'member' | 'organization' | 'user';
    scopes: string[];
    mode?: LinkedInProviderMode;
    communityManagementApproved?: boolean;
    orgRole?: string | null; // e.g. "ADMINISTRATOR", "DIRECT_SPONSORED_CONTENT_POSTER", "COMMUNITY_MANAGER"
}

export function resolveLinkedInCapabilities(ctx: CapabilityResolutionContext): LinkedInCapabilities {
    const isMock = ctx.mode === 'mock';
    const scopes = new Set(ctx.scopes || []);
    const isOrg = ctx.accountKind === 'organization';
    const isMember = ctx.accountKind === 'member' || ctx.accountKind === 'user';

    // Mock mode provides full simulated capability support for sandbox testing
    if (isMock) {
        return {
            canConnectAccount: true,
            canReadProfile: true,
            canReadOrganizations: true,
            canReadOrganizationDetails: true,
            canCreateOrganizationPost: isOrg,
            canCreateMemberPost: isMember,
            canUploadImage: true,
            canUploadVideo: true,
            canUploadDocument: true,
            canReadPosts: true,
            canReadComments: true,
            canCreateComment: true,
            canDeleteComment: true,
            canReadReactions: true,
            canCreateReaction: true,
            canDeleteReaction: true,
            canReadAnalytics: isOrg,
            canReadFollowerStats: isOrg,
            canReadPageStats: isOrg,
        };
    }

    // Live mode: Evaluate real granted scopes and roles
    const hasOpenId = scopes.has(LINKEDIN_SCOPES.OPENID);
    const hasProfile = scopes.has(LINKEDIN_SCOPES.PROFILE);
    const hasMemberShare = scopes.has(LINKEDIN_SCOPES.MEMBER_SHARE);

    const hasOrgSocialRead = scopes.has(LINKEDIN_SCOPES.ORG_READ_SOCIAL) || scopes.has(LINKEDIN_SCOPES.ORG_READ_FEED);
    const hasOrgSocialWrite = scopes.has(LINKEDIN_SCOPES.ORG_WRITE_SOCIAL) || scopes.has(LINKEDIN_SCOPES.ORG_WRITE_FEED);
    const hasOrgAdmin = scopes.has(LINKEDIN_SCOPES.ORG_ADMIN) || scopes.has(LINKEDIN_SCOPES.ORG_READ_ADMIN);

    const isAuthorizedOrgRole = !ctx.orgRole || ['ADMINISTRATOR', 'DIRECT_SPONSORED_CONTENT_POSTER', 'CONTENT_ADMINISTRATOR', 'COMMUNITY_MANAGER'].includes(ctx.orgRole.toUpperCase());

    const canPostToOrg = isOrg && hasOrgSocialWrite && isAuthorizedOrgRole;
    const canPostToMember = isMember && hasMemberShare;
    const canPostMedia = canPostToOrg || canPostToMember;

    // Note: r_member_social_feed is restricted by LinkedIn to select enterprise partners.
    // Member read posts/comments/reactions remain false unless explicitly provisioned.
    const canReadOrgSocial = isOrg && hasOrgSocialRead;

    return {
        canConnectAccount: hasOpenId,
        canReadProfile: hasProfile || hasOpenId,
        canReadOrganizations: hasOrgAdmin || hasOrgSocialRead,
        canReadOrganizationDetails: hasOrgAdmin || hasOrgSocialRead,

        canCreateOrganizationPost: canPostToOrg,
        canCreateMemberPost: canPostToMember,

        canUploadImage: canPostMedia,
        canUploadVideo: canPostMedia,
        canUploadDocument: canPostMedia,

        canReadPosts: canReadOrgSocial,
        canReadComments: canReadOrgSocial,
        canCreateComment: canPostToOrg,
        canDeleteComment: canPostToOrg,

        canReadReactions: canReadOrgSocial,
        canCreateReaction: canPostToOrg,
        canDeleteReaction: canPostToOrg,

        canReadAnalytics: isOrg && hasOrgSocialRead,
        canReadFollowerStats: isOrg && hasOrgSocialRead,
        canReadPageStats: isOrg && hasOrgSocialRead,
    };
}
