/**
 * Core type definitions for the 180 Workspace LinkedIn integration.
 */

import { LinkedInCapabilities } from './capabilities';
import { LinkedInErrorCode } from './errors';

export type LinkedInPostFormat = 'text' | 'image' | 'video' | 'document' | 'carousel';

export interface LinkedInMediaInput {
    url: string;
    kind: 'image' | 'video' | 'document';
    mimeType?: string;
    sizeBytes?: number;
    title?: string;
    altText?: string;
    durationSec?: number;
}

export interface LinkedInPostDraft {
    authorUrn: string; // e.g. "urn:li:person:123" or "urn:li:organization:456"
    text: string;
    format: LinkedInPostFormat;
    media?: LinkedInMediaInput[];
    title?: string;
    visibility?: 'PUBLIC' | 'CONNECTIONS';
    firstComment?: string;
    idempotencyKey?: string;
}

export interface LinkedInPostResult {
    activityUrn: string;
    postUrn: string;
    url: string;
    state: 'published' | 'processing';
    warning?: string;
    isSimulated?: boolean;
}

export interface LinkedInOrganization {
    id: string;
    urn: string;
    name: string;
    vanityName?: string;
    logo?: string | null;
    role: string;
    capabilities: LinkedInCapabilities;
}

export interface LinkedInComment {
    id: string;
    postUrn: string;
    actorUrn: string;
    actorName?: string;
    message: string;
    createdAt: string;
}

export interface LinkedInReaction {
    actorUrn: string;
    reactionType: 'LIKE' | 'CELEBRATE' | 'SUPPORT' | 'LOVE' | 'INSIGHTFUL' | 'CURIOUS';
    createdAt: string;
}

export interface LinkedInMetric {
    name: string;
    value: number;
    unit?: string;
    changePct?: number;
}

export interface LinkedInAnalyticsData {
    platform: 'linkedin';
    accountUrn: string;
    period: string; // e.g. "7d" | "30d" | "90d"
    metrics: LinkedInMetric[];
    isSimulated?: boolean;
}

export interface ILinkedInProvider {
    readonly mode: 'live' | 'mock';

    getAuthorizationUrl(params: { state: string; redirectUri: string; scopes?: string[] }): Promise<string>;
    exchangeCode(params: { code: string; redirectUri: string }): Promise<{
        accessToken: string;
        refreshToken?: string | null;
        expiresAt: Date | null;
        refreshExpiresAt?: Date | null;
        scopes: string[];
    }>;
    refreshToken(refreshToken: string): Promise<{
        accessToken: string;
        refreshToken?: string | null;
        expiresAt: Date | null;
    }>;

    getAuthenticatedMember(accessToken: string): Promise<{
        memberId: string;
        urn: string;
        name: string;
        email?: string;
        pictureUrl?: string | null;
    }>;

    getOrganizations(accessToken: string): Promise<LinkedInOrganization[]>;
    getOrganization(orgId: string, accessToken: string): Promise<LinkedInOrganization | null>;

    getCapabilities(params: {
        accountKind: 'member' | 'organization' | 'user';
        scopes: string[];
        orgRole?: string | null;
    }): LinkedInCapabilities;

    createPost(draft: LinkedInPostDraft, accessToken: string): Promise<LinkedInPostResult>;
    getPost(postUrn: string, accessToken: string): Promise<{ urn: string; commentary: string; author: string; createdAt: string }>;
    deletePost(postUrn: string, accessToken: string): Promise<boolean>;

    uploadMedia(media: LinkedInMediaInput, authorUrn: string, accessToken: string): Promise<string>;

    listComments(postUrn: string, accessToken: string, limit?: number): Promise<LinkedInComment[]>;
    createComment(postUrn: string, text: string, actorUrn: string, accessToken: string): Promise<LinkedInComment>;
    deleteComment(commentUrn: string, accessToken: string): Promise<boolean>;

    listReactions(postUrn: string, accessToken: string): Promise<LinkedInReaction[]>;
    createReaction(postUrn: string, reactionType: LinkedInReaction['reactionType'], actorUrn: string, accessToken: string): Promise<boolean>;
    deleteReaction(postUrn: string, actorUrn: string, accessToken: string): Promise<boolean>;

    getAnalytics(accountUrn: string, period: string, accessToken: string): Promise<LinkedInAnalyticsData>;
}
