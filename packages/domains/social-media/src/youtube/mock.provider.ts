/**
 * Mock YouTube Provider for local development, CI pipelines, and sandbox testing.
 * Strictly in-memory emulation with zero external Google Cloud API requests.
 */

import {
    IYouTubeProvider,
    YouTubeChannelInfo,
    YouTubeVideoDraft,
    YouTubePublishResult,
    YouTubeComment,
    YouTubeAnalyticsResult,
} from './types';
import { YouTubeCapabilities, resolveYouTubeCapabilities } from './capabilities';
import { YouTubeIntegrationError } from './errors';
import { DEFAULT_YOUTUBE_CONFIG, DEFAULT_YOUTUBE_SCOPES } from './config';

export class MockYouTubeProvider implements IYouTubeProvider {
    readonly mode = 'mock' as const;

    // Simulated in-memory storage
    private mockVideos = new Map<string, YouTubeVideoDraft & { videoId: string; liveUrl: string; publishedAt: string }>();
    private mockComments = new Map<string, YouTubeComment[]>();
    private mockLikes = new Set<string>();

    // Simulated failure injection for resilience testing
    public injectedFailure?: 'quota_exceeded' | 'rate_limited' | 'token_expired' | 'upload_failed';

    constructor() {
        // Seed default mock video with comments
        const seedId = 'mock_yt_seed_01';
        this.mockVideos.set(seedId, {
            title: '180 Workspace Autonomous Content Engine #shorts',
            description: 'Demo of production-grade social workflows #shorts',
            mediaUrl: 'https://storage.180workspace.com/mock-video.mp4',
            videoId: seedId,
            liveUrl: `https://youtube.com/shorts/${seedId}`,
            publishedAt: new Date().toISOString(),
            isShort: true,
        });

        this.mockComments.set(seedId, [
            {
                id: 'comm_seed_1',
                authorDisplayName: 'Tech Lead',
                textDisplay: 'Impressive multi-platform publishing speed!',
                likeCount: 5,
                publishedAt: new Date(Date.now() - 3600000).toISOString(),
                updatedAt: new Date(Date.now() - 3600000).toISOString(),
            },
        ]);
    }

    setSimulatedFailure(failure: 'quota_exceeded' | 'rate_limited' | 'rate_limit' | 'token_expired' | 'upload_failed' | 'upload_failure' | null) {
        if (!failure) {
            this.injectedFailure = undefined;
            return;
        }
        if (failure === 'rate_limit') this.injectedFailure = 'rate_limited';
        else if (failure === 'upload_failure') this.injectedFailure = 'upload_failed';
        else this.injectedFailure = failure;
    }

    private checkInjectedFailure() {
        if (!this.injectedFailure) return;
        const failure = this.injectedFailure;
        this.injectedFailure = undefined;

        if (failure === 'quota_exceeded') {
            throw new YouTubeIntegrationError({
                code: 'YOUTUBE_QUOTA_EXCEEDED',
                message: 'The request cannot be completed because you have exceeded your YouTube Data API quota.',
                httpStatus: 403,
                retryable: false,
                userAction: 'Quota resets at midnight Pacific Time. Request a quota increase in Google Cloud Console.',
            });
        }
        if (failure === 'rate_limited') {
            throw new YouTubeIntegrationError({
                code: 'YOUTUBE_RATE_LIMITED',
                message: 'User rate limit exceeded on YouTube API.',
                httpStatus: 429,
                retryable: true,
                userAction: 'Wait for the backoff period before dispatching requests.',
            });
        }
        if (failure === 'token_expired') {
            throw new YouTubeIntegrationError({
                code: 'YOUTUBE_TOKEN_EXPIRED',
                message: 'Invalid Credentials: OAuth access token has expired.',
                httpStatus: 401,
                retryable: true,
                userAction: 'Refresh access token or re-authorize Google account.',
            });
        }
        if (failure === 'upload_failed') {
            throw new YouTubeIntegrationError({
                code: 'YOUTUBE_UPLOAD_FAILED',
                message: 'Backend server error during resumable video chunk transmission.',
                httpStatus: 503,
                retryable: true,
            });
        }
    }

    getAuthorizationUrl(params: {
        state: string;
        redirectUri: string;
        codeChallenge?: string;
        scopes?: string[];
    }): string {
        const scopes = (params.scopes || DEFAULT_YOUTUBE_SCOPES).join(' ');
        const challenge = params.codeChallenge ? `&code_challenge=${params.codeChallenge}&code_challenge_method=S256` : '';
        return `https://accounts.google.com/o/oauth2/v2/auth?client_id=mock_youtube_client_id&redirect_uri=${encodeURIComponent(params.redirectUri)}&response_type=code&scope=${encodeURIComponent(scopes)}&access_type=offline&prompt=consent&state=${params.state}${challenge}`;
    }

    async exchangeCode(params: {
        code: string;
        redirectUri: string;
        codeVerifier?: string;
    }): Promise<{
        accessToken: string;
        refreshToken: string;
        expiresAt: Date;
        scopes: string[];
    }> {
        this.checkInjectedFailure();
        if (params.code === 'invalid_code') {
            throw new YouTubeIntegrationError({
                code: 'YOUTUBE_OAUTH_FAILED',
                message: 'Failed to exchange authorization code: invalid_grant.',
                httpStatus: 400,
            });
        }

        const now = Date.now();
        return {
            accessToken: `mock_yt_access_token_${now}`,
            refreshToken: `mock_yt_refresh_token_${now}`,
            expiresAt: new Date(now + 3600 * 1000),
            scopes: DEFAULT_YOUTUBE_SCOPES,
        };
    }

    async refreshToken(refreshToken: string): Promise<{
        accessToken: string;
        refreshToken: string;
        expiresAt: Date;
        scopes: string[];
    }> {
        this.checkInjectedFailure();
        if (refreshToken.includes('revoked')) {
            throw new YouTubeIntegrationError({
                code: 'YOUTUBE_TOKEN_REFRESH_FAILED',
                message: 'Token refresh failed: token has been revoked by user.',
                httpStatus: 401,
            });
        }

        const now = Date.now();
        return {
            accessToken: `mock_yt_refreshed_token_${now}`,
            refreshToken: refreshToken || `mock_yt_refresh_token_${now}`,
            expiresAt: new Date(now + 3600 * 1000),
            scopes: DEFAULT_YOUTUBE_SCOPES,
        };
    }

    async getChannel(accessToken: string): Promise<YouTubeChannelInfo> {
        this.checkInjectedFailure();
        return {
            channelId: 'UC_mock_workspace_channel_180',
            title: '180 Workspace Official Channel (Demo)',
            customUrl: '@180workspace',
            description: 'Official test YouTube channel for 180 Workspace automation & AI media studio.',
            thumbnailUrl: 'https://api.dicebear.com/7.x/identicon/png?seed=youtube-studio-demo',
            subscriberCount: 12480,
            videoCount: 142,
            viewCount: 489200,
        };
    }

    getCapabilities(context: { scopes: string[]; isTokenExpired?: boolean }): YouTubeCapabilities {
        return resolveYouTubeCapabilities({ ...context, isMock: true });
    }

    async publishVideo(draft: YouTubeVideoDraft, accessToken: string): Promise<YouTubePublishResult> {
        this.checkInjectedFailure();

        if (!draft.mediaUrl) {
            throw new YouTubeIntegrationError({
                code: 'YOUTUBE_INVALID_METADATA',
                message: 'Cannot publish video: mediaUrl is required.',
                httpStatus: 400,
            });
        }

        const isShort = draft.isShort ?? /#shorts\b/i.test(`${draft.title} ${draft.description}`);
        const videoId = `mock_yt_${Math.random().toString(36).substring(2, 11)}`;
        const liveUrl = isShort ? `https://youtube.com/shorts/${videoId}` : `https://www.youtube.com/watch?v=${videoId}`;
        const publishedAt = new Date().toISOString();

        this.mockVideos.set(videoId, {
            ...draft,
            videoId,
            liveUrl,
            publishedAt,
            isShort,
        });

        // Initialize default comments thread for this video
        this.mockComments.set(videoId, [
            {
                id: `mock_yt_comm_${videoId}`,
                authorDisplayName: 'Community Member',
                textDisplay: 'Great video update! Looking forward to more content.',
                likeCount: 3,
                publishedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            },
        ]);

        return {
            videoId,
            liveUrl,
            privacyStatus: draft.privacyStatus || 'public',
            isShort,
            publishedAt,
        };
    }

    async uploadThumbnail(videoId: string, imageUrl: string, accessToken: string): Promise<boolean> {
        this.checkInjectedFailure();
        const video = this.mockVideos.get(videoId);
        if (video) {
            video.thumbnailUrl = imageUrl;
        }
        return true;
    }

    async uploadCaption(videoId: string, language: string, name: string, content: Uint8Array, accessToken: string): Promise<string> {
        this.checkInjectedFailure();
        return `mock_caption_${videoId}_${language}`;
    }

    async listComments(videoId: string, accessToken: string, limit = 50): Promise<YouTubeComment[]> {
        this.checkInjectedFailure();
        const comments = this.mockComments.get(videoId) || [
            {
                id: `mock_yt_comm_${videoId}`,
                authorDisplayName: 'Community Member',
                textDisplay: 'Great video update!',
                likeCount: 1,
                publishedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            },
        ];
        return comments.slice(0, limit);
    }

    async replyComment(commentId: string, text: string, accessToken: string): Promise<{ commentId: string }> {
        this.checkInjectedFailure();
        const replyId = `mock_yt_reply_${Date.now()}`;
        return { commentId: replyId };
    }

    async likeVideo(videoId: string, accessToken: string): Promise<boolean> {
        this.checkInjectedFailure();
        this.mockLikes.add(videoId);
        return true;
    }

    async getAnalytics(channelId: string, startDate: string, endDate: string, accessToken: string): Promise<YouTubeAnalyticsResult> {
        this.checkInjectedFailure();
        return {
            platform: 'youtube',
            channelId,
            startDate,
            endDate,
            metrics: {
                views: 24500,
                likes: 1840,
                comments: 312,
                shares: 145,
                estimatedMinutesWatched: 84200,
                averageViewDurationSeconds: 206,
                subscribersGained: 188,
                subscribersLost: 12,
                impressions: 142000,
                impressionClickThroughRate: 8.4,
            },
        };
    }
}

export const YouTubeMockProvider = MockYouTubeProvider;
