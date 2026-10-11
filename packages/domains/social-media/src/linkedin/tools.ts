/**
 * Autonomous AI Publishing Tool & Controlled Permission System for LinkedIn.
 * Strict Architecture:
 *   AI Agent / LLM
 *     ↓ (No OAuth tokens or secrets exposed)
 *   SocialPublishingTool (Validates tenancy, project scoping, autonomy mode & capabilities)
 *     ↓
 *   LinkedInProviderFactory (Live or Mock Provider)
 *     ↓
 *   LinkedIn REST API / Simulated State
 */

import { prisma } from '@workspace/db';
import { SocialTokenVault } from '../publishing/token-vault';
import { LinkedInIntegrationError } from './errors';
import { LinkedInProviderFactory } from './factory';
import { getLinkedInProviderMode } from './config';
import {
    LinkedInAnalyticsData,
    LinkedInComment,
    LinkedInMediaInput,
    LinkedInOrganization,
    LinkedInPostDraft,
    LinkedInPostResult,
    LinkedInReaction,
} from './types';

export type AutonomyMode = 'MANUAL' | 'ASSISTED' | 'AUTO';

export interface LinkedInToolContext {
    companyId: string;
    projectId: string;
    userId: string;
    socialAccountId: string;
    autonomyMode?: AutonomyMode;
}

export class LinkedInPublishingTools {
    /**
     * Resolves the target social account, verifies multi-tenancy and project boundaries,
     * checks user / project autonomy policy, and returns the decrypted token securely.
     */
    private static async verifyAccess(ctx: LinkedInToolContext) {
        if (!ctx.companyId || !ctx.projectId || !ctx.socialAccountId) {
            throw new LinkedInIntegrationError('CROSS_PROJECT_FORBIDDEN', 'Company, project, and social account IDs are strictly required.', {
                httpStatus: 403,
            });
        }

        // Strict multi-tenant verification: account must belong to caller's company AND project
        const account = await (prisma as any).socialAccount.findFirst({
            where: {
                id: ctx.socialAccountId,
                companyId: ctx.companyId,
                projectId: ctx.projectId,
                platform: 'linkedin',
                isActive: true,
            },
        });

        if (!account) {
            throw new LinkedInIntegrationError('SOCIAL_ACCOUNT_NOT_CONNECTED', 'LinkedIn account not found or not attached to this project.', {
                httpStatus: 404,
                userAction: 'Ensure the LinkedIn account is connected and linked to this project.',
            });
        }

        // Autonomy mode enforcement: MANUAL cannot be bypassed by automated agents
        const project = await (prisma as any).project.findFirst({
            where: { id: ctx.projectId, companyId: ctx.companyId },
            select: { id: true, socialSettings: true },
        });

        const autonomyMode: AutonomyMode = ctx.autonomyMode || 'MANUAL';
        if (autonomyMode === 'MANUAL' && (ctx as any).isAiAgent) {
            throw new LinkedInIntegrationError('CAPABILITY_NOT_GRANTED', 'Project is in MANUAL autonomy mode. Direct AI automated publication is restricted; queue for human review instead.', {
                httpStatus: 403,
                userAction: 'Switch project to ASSISTED or AUTO mode, or request human approval.',
            });
        }

        // Obtain token from encrypted vault (WS4 token vault)
        let token = 'mock_token';
        try {
            token = await SocialTokenVault.getAccessToken({
                id: account.id,
                companyId: ctx.companyId,
                platform: 'linkedin',
                reauthRequired: account.reauthRequired,
            });
        } catch (err) {
            // Only the mock provider may run without a vault record; in live mode a missing/expired token (including
            // REAUTH_REQUIRED) must reach the caller instead of being replaced by a placeholder.
            if (getLinkedInProviderMode() !== 'mock') throw err;
            token = 'mock_token';
        }

        const provider = LinkedInProviderFactory.getProvider();
        return { account, token, provider };
    }

    /** social.linkedin.getAccount */
    static async getAccount(ctx: LinkedInToolContext) {
        const { account, token, provider } = await this.verifyAccess(ctx);
        const capabilities = provider.getCapabilities({
            accountKind: account.metadata?.kind || (account.platformAccountId.startsWith('urn:li:organization:') ? 'organization' : 'member'),
            scopes: account.scopes || [],
            orgRole: account.metadata?.role,
        });

        return {
            id: account.id,
            platform: 'linkedin',
            accountName: account.accountName,
            username: account.username,
            platformAccountId: account.platformAccountId,
            profileImageUrl: account.profileImageUrl,
            reauthRequired: account.reauthRequired,
            capabilities,
        };
    }

    /** social.linkedin.getOrganizations */
    static async getOrganizations(ctx: LinkedInToolContext): Promise<LinkedInOrganization[]> {
        const { token, provider } = await this.verifyAccess(ctx);
        return provider.getOrganizations(token);
    }

    /** social.linkedin.createPost */
    static async createPost(ctx: LinkedInToolContext, draft: Omit<LinkedInPostDraft, 'authorUrn'>): Promise<LinkedInPostResult> {
        const { account, token, provider } = await this.verifyAccess(ctx);
        const fullDraft: LinkedInPostDraft = {
            ...draft,
            authorUrn: account.platformAccountId,
        };

        const caps = provider.getCapabilities({
            accountKind: account.platformAccountId.startsWith('urn:li:organization:') ? 'organization' : 'member',
            scopes: account.scopes || [],
            orgRole: account.metadata?.role,
        });

        if (fullDraft.authorUrn.startsWith('urn:li:organization:') && !caps.canCreateOrganizationPost) {
            throw new LinkedInIntegrationError('CAPABILITY_NOT_GRANTED', 'Organization post capability is not granted for this LinkedIn connection.', {
                httpStatus: 403,
            });
        }
        if (fullDraft.authorUrn.startsWith('urn:li:person:') && !caps.canCreateMemberPost) {
            throw new LinkedInIntegrationError('CAPABILITY_NOT_GRANTED', 'Member post capability is not granted for this LinkedIn connection.', {
                httpStatus: 403,
            });
        }

        return provider.createPost(fullDraft, token);
    }

    /** social.linkedin.publishMedia */
    static async publishMedia(ctx: LinkedInToolContext, media: LinkedInMediaInput): Promise<string> {
        const { account, token, provider } = await this.verifyAccess(ctx);
        return provider.uploadMedia(media, account.platformAccountId, token);
    }

    /** social.linkedin.getPost */
    static async getPost(ctx: LinkedInToolContext, postUrn: string) {
        const { token, provider } = await this.verifyAccess(ctx);
        return provider.getPost(postUrn, token);
    }

    /** social.linkedin.getComments */
    static async getComments(ctx: LinkedInToolContext, postUrn: string, limit = 20): Promise<LinkedInComment[]> {
        const { token, provider } = await this.verifyAccess(ctx);
        return provider.listComments(postUrn, token, limit);
    }

    /** social.linkedin.createComment */
    static async createComment(ctx: LinkedInToolContext, postUrn: string, text: string): Promise<LinkedInComment> {
        const { account, token, provider } = await this.verifyAccess(ctx);
        return provider.createComment(postUrn, text, account.platformAccountId, token);
    }

    /** social.linkedin.deleteComment */
    static async deleteComment(ctx: LinkedInToolContext, commentUrn: string): Promise<boolean> {
        const { token, provider } = await this.verifyAccess(ctx);
        return provider.deleteComment(commentUrn, token);
    }

    /** social.linkedin.getReactions */
    static async getReactions(ctx: LinkedInToolContext, postUrn: string): Promise<LinkedInReaction[]> {
        const { token, provider } = await this.verifyAccess(ctx);
        return provider.listReactions(postUrn, token);
    }

    /** social.linkedin.createReaction */
    static async createReaction(ctx: LinkedInToolContext, postUrn: string, reactionType: LinkedInReaction['reactionType']): Promise<boolean> {
        const { account, token, provider } = await this.verifyAccess(ctx);
        return provider.createReaction(postUrn, reactionType, account.platformAccountId, token);
    }

    /** social.linkedin.deleteReaction */
    static async deleteReaction(ctx: LinkedInToolContext, postUrn: string): Promise<boolean> {
        const { account, token, provider } = await this.verifyAccess(ctx);
        return provider.deleteReaction(postUrn, account.platformAccountId, token);
    }

    /** social.linkedin.getAnalytics */
    static async getAnalytics(ctx: LinkedInToolContext, period: string): Promise<LinkedInAnalyticsData> {
        const { account, token, provider } = await this.verifyAccess(ctx);
        return provider.getAnalytics(account.platformAccountId, period, token);
    }
}
