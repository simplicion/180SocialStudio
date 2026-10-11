/**
 * Core Type Definitions & Provider Contract for YouTube Integration.
 */

import { YouTubeCapabilities } from './capabilities';

export interface YouTubeChannelInfo {
    channelId: string;
    title: string;
    customUrl?: string;
    description?: string;
    thumbnailUrl?: string | null;
    subscriberCount?: number;
    videoCount?: number;
    viewCount?: number;
}

export interface YouTubeVideoDraft {
    title: string;
    description: string;
    tags?: string[];
    categoryId?: string;
    privacyStatus?: 'public' | 'unlisted' | 'private';
    madeForKids?: boolean;
    isShort?: boolean;
    mediaUrl: string;
    thumbnailUrl?: string;
    caption?: {
        language: string;
        name: string;
        contentBytes: Uint8Array;
    };
    publishAt?: Date | string;
}

export interface YouTubePublishResult {
    videoId: string;
    liveUrl: string;
    privacyStatus: string;
    isShort: boolean;
    publishedAt: string;
}

export interface YouTubeComment {
    id: string;
    authorDisplayName: string;
    authorProfileImageUrl?: string;
    textDisplay: string;
    likeCount: number;
    publishedAt: string;
    updatedAt: string;
    replyCount?: number;
}

export interface YouTubeAnalyticsMetrics {
    views: number;
    likes: number;
    comments: number;
    shares?: number;
    estimatedMinutesWatched: number;
    averageViewDurationSeconds?: number;
    subscribersGained?: number;
    subscribersLost?: number;
    impressions?: number;
    impressionClickThroughRate?: number;
}

export interface YouTubeAnalyticsResult {
    platform: 'youtube';
    channelId: string;
    startDate: string;
    endDate: string;
    metrics: YouTubeAnalyticsMetrics;
}

export interface IYouTubeProvider {
    readonly mode: 'mock' | 'live';

    getAuthorizationUrl(params: {
        state: string;
        redirectUri: string;
        codeChallenge?: string;
        scopes?: string[];
    }): string;

    exchangeCode(params: {
        code: string;
        redirectUri: string;
        codeVerifier?: string;
    }): Promise<{
        accessToken: string;
        refreshToken?: string | null;
        expiresAt: Date | null;
        scopes: string[];
    }>;

    refreshToken(refreshToken: string): Promise<{
        accessToken: string;
        refreshToken?: string | null;
        expiresAt: Date | null;
        scopes: string[];
    }>;

    getChannel(accessToken: string): Promise<YouTubeChannelInfo>;

    getCapabilities(context: { scopes: string[]; isTokenExpired?: boolean }): YouTubeCapabilities;

    publishVideo(draft: YouTubeVideoDraft, accessToken: string): Promise<YouTubePublishResult>;

    uploadThumbnail(videoId: string, imageUrl: string, accessToken: string): Promise<boolean>;

    uploadCaption(videoId: string, language: string, name: string, content: Uint8Array, accessToken: string): Promise<string>;

    listComments(videoId: string, accessToken: string, limit?: number): Promise<YouTubeComment[]>;

    replyComment(commentId: string, text: string, accessToken: string): Promise<{ commentId: string }>;

    likeVideo(videoId: string, accessToken: string): Promise<boolean>;

    getAnalytics(channelId: string, startDate: string, endDate: string, accessToken: string): Promise<YouTubeAnalyticsResult>;
}
