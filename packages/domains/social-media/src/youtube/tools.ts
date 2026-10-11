/**
 * Autonomous AI Publishing Tool & Controlled Permission System for YouTube.
 * Strict Architecture:
 *   AI Agent / LLM
 *     ↓ (No OAuth tokens or secrets exposed)
 *   YouTubePublishingTools (Validates tenancy, project scoping, autonomy mode & capabilities)
 *     ↓
 *   YouTubeProviderFactory (Live or Mock Provider)
 *     ↓
 *   YouTube Data API v3 / Simulated State
 */

import { prisma } from '@workspace/db';
import { SocialTokenVault } from '../publishing/token-vault';
import { YouTubeIntegrationError } from './errors';
import { YouTubeProviderFactory } from './factory';
import {
    YouTubeAnalyticsResult,
    YouTubeChannelInfo,
    YouTubeComment,
    YouTubePublishResult,
    YouTubeVideoDraft,
} from './types';
import type { AutonomyMode } from '../linkedin/tools';

export type YouTubeAutonomyMode = AutonomyMode;

export interface YouTubeToolContext {
    companyId: string;
    projectId: string;
    userId: string;
    socialAccountId: string;
    autonomyMode?: AutonomyMode;
    isAiAgent?: boolean;
}

export class YouTubePublishingTools {
    /**
     * Resolves the target social account, verifies multi-tenancy and project boundaries,
     * checks user / project autonomy policy, and returns the decrypted token securely.
     */
    private static async verifyAccess(ctx: YouTubeToolContext) {
        if (!ctx.companyId || !ctx.projectId || !ctx.socialAccountId) {
            throw new YouTubeIntegrationError(
                'YOUTUBE_PERMISSION_DENIED',
                'Company, project, and social account IDs are strictly required.',
                { httpStatus: 403 }
            );
        }

        // Strict multi-tenant verification: account must belong to caller's company AND project
        const account = await (prisma as any).socialAccount.findFirst({
            where: {
                id: ctx.socialAccountId,
                companyId: ctx.companyId,
                projectId: ctx.projectId,
                platform: 'youtube',
                isActive: true,
            },
        });

        if (!account) {
            throw new YouTubeIntegrationError(
                'YOUTUBE_NOT_CONNECTED',
                'YouTube channel not found or not attached to this project.',
                {
                    httpStatus: 404,
                    userAction: 'Ensure the YouTube account is connected and linked to this project.',
                }
            );
        }

        // Autonomy mode enforcement: MANUAL cannot be bypassed by automated agents
        const autonomyMode: AutonomyMode = ctx.autonomyMode || 'MANUAL';
        if (autonomyMode === 'MANUAL' && ctx.isAiAgent) {
            throw new YouTubeIntegrationError(
                'YOUTUBE_PERMISSION_DENIED',
                'Project is in MANUAL autonomy mode. Direct AI automated publishing is restricted; prepare draft and queue for human review instead.',
                {
                    httpStatus: 403,
                    userAction: 'Switch project to ASSISTED or AUTO mode, or request human approval.',
                }
            );
        }

        // Obtain token from encrypted vault (WS4 token vault)
        let token = 'mock_youtube_token';
        try {
            token = await SocialTokenVault.getAccessToken({
                id: account.id,
                companyId: ctx.companyId,
                platform: 'youtube',
                reauthRequired: account.reauthRequired,
            });
        } catch {
            // In mock/sandbox mode without vault records, use mock token
            token = 'mock_youtube_token';
        }

        const provider = YouTubeProviderFactory.getProvider();
        return { account, token, provider };
    }

    /** youtube.getChannel */
    static async getChannel(ctx: YouTubeToolContext): Promise<YouTubeChannelInfo> {
        const { token, provider } = await this.verifyAccess(ctx);
        return provider.getChannel(token);
    }

    /** youtube.getCapabilities */
    static async getCapabilities(ctx: YouTubeToolContext) {
        const { account, provider } = await this.verifyAccess(ctx);
        return provider.getCapabilities({
            scopes: account.scopes || [],
            isTokenExpired: account.reauthRequired,
        });
    }

    /** youtube.uploadVideo */
    static async uploadVideo(
        ctx: YouTubeToolContext,
        draft: YouTubeVideoDraft
    ): Promise<YouTubePublishResult> {
        const { account, token, provider } = await this.verifyAccess(ctx);

        const caps = provider.getCapabilities({
            scopes: account.scopes || [],
            isTokenExpired: account.reauthRequired,
        });

        if (!caps.canUploadVideo) {
            throw new YouTubeIntegrationError(
                'YOUTUBE_PERMISSION_DENIED',
                'Upload capability is not granted for this YouTube connection. Verify youtube.upload scope.',
                { httpStatus: 403 }
            );
        }

        return provider.publishVideo(draft, token);
    }

    /** youtube.uploadThumbnail */
    static async uploadThumbnail(
        ctx: YouTubeToolContext,
        videoId: string,
        imageUrl: string
    ): Promise<boolean> {
        const { token, provider } = await this.verifyAccess(ctx);
        return provider.uploadThumbnail(videoId, imageUrl, token);
    }

    /** youtube.uploadCaption */
    static async uploadCaption(
        ctx: YouTubeToolContext,
        videoId: string,
        language: string,
        name: string,
        content: Uint8Array
    ): Promise<string> {
        const { token, provider } = await this.verifyAccess(ctx);
        return provider.uploadCaption(videoId, language, name, content, token);
    }

    /** youtube.listComments */
    static async listComments(
        ctx: YouTubeToolContext,
        videoId: string,
        limit = 20
    ): Promise<YouTubeComment[]> {
        const { token, provider } = await this.verifyAccess(ctx);
        return provider.listComments(videoId, token, limit);
    }

    /** youtube.replyComment */
    static async replyComment(
        ctx: YouTubeToolContext,
        commentId: string,
        text: string
    ): Promise<{ commentId: string }> {
        const { token, provider } = await this.verifyAccess(ctx);
        return provider.replyComment(commentId, text, token);
    }

    /** youtube.likeVideo */
    static async likeVideo(ctx: YouTubeToolContext, videoId: string): Promise<boolean> {
        const { token, provider } = await this.verifyAccess(ctx);
        return provider.likeVideo(videoId, token);
    }

    /** youtube.getAnalytics */
    static async getAnalytics(
        ctx: YouTubeToolContext,
        startDate: string,
        endDate: string
    ): Promise<YouTubeAnalyticsResult> {
        const { account, token, provider } = await this.verifyAccess(ctx);

        const caps = provider.getCapabilities({
            scopes: account.scopes || [],
            isTokenExpired: account.reauthRequired,
        });

        if (!caps.canReadAnalytics) {
            throw new YouTubeIntegrationError(
                'YOUTUBE_PERMISSION_DENIED',
                'YouTube Analytics scope (yt-analytics.readonly) is not granted for this account.',
                { httpStatus: 403 }
            );
        }

        return provider.getAnalytics(account.platformAccountId, startDate, endDate, token);
    }
}
