/**
 * Centralized YouTube & Google Cloud API Configuration.
 * Reuses existing Google OAuth Client ID / Secret when YOUTUBE_* is empty.
 * Never leaks secrets in logs or diagnostics.
 */

export interface YouTubeApiConfig {
    baseUrl: string;
    uploadUrl: string;
    analyticsUrl: string;
    authUrl: string;
    tokenUrl: string;
    timeoutMs: number;
    maxUploadChunkBytes: number;
    quotaDailyUnits: number;
}

export const YOUTUBE_UPLOAD_SCOPE = 'https://www.googleapis.com/auth/youtube.upload';
export const YOUTUBE_READONLY_SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';
export const YOUTUBE_FORCE_SSL_SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl';
export const YOUTUBE_ANALYTICS_SCOPE = 'https://www.googleapis.com/auth/yt-analytics.readonly';

export const DEFAULT_YOUTUBE_SCOPES = [
    YOUTUBE_UPLOAD_SCOPE,
    YOUTUBE_READONLY_SCOPE,
    YOUTUBE_FORCE_SSL_SCOPE,
    YOUTUBE_ANALYTICS_SCOPE,
];

export const DEFAULT_YOUTUBE_CONFIG: YouTubeApiConfig = {
    baseUrl: 'https://www.googleapis.com/youtube/v3',
    uploadUrl: 'https://www.googleapis.com/upload/youtube/v3/videos',
    analyticsUrl: 'https://youtubeanalytics.googleapis.com/v1',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    timeoutMs: 30000,
    maxUploadChunkBytes: 8 * 1024 * 1024, // 8MB chunk for resumable upload (multiple of 256KB)
    quotaDailyUnits: 10000, // Standard Google Cloud Data API v3 daily quota
};

/**
 * Resolves Google OAuth client ID, falling back to existing GOOGLE_CLIENT_ID if YOUTUBE_CLIENT_ID is empty.
 */
export function getYouTubeClientId(): string | undefined {
    return process.env.YOUTUBE_CLIENT_ID?.trim() || process.env.GOOGLE_CLIENT_ID?.trim() || undefined;
}

/**
 * Resolves Google OAuth client secret, falling back to existing GOOGLE_CLIENT_SECRET if YOUTUBE_CLIENT_SECRET is empty.
 */
export function getYouTubeClientSecret(): string | undefined {
    return process.env.YOUTUBE_CLIENT_SECRET?.trim() || process.env.GOOGLE_CLIENT_SECRET?.trim() || undefined;
}

/**
 * Resolves provider mode: 'mock' or 'live'.
 * Defaults to 'mock' if credentials are not configured or if explicitly set to 'mock'.
 */
export function getYouTubeProviderMode(): 'mock' | 'live' {
    // Production never serves the demo channel: missing credentials surface as PUBLISH_NOT_CONFIGURED instead.
    if (process.env.NODE_ENV === 'production') return 'live';
    const explicit = process.env.YOUTUBE_PROVIDER_MODE?.toLowerCase().trim();
    if (explicit === 'live') return 'live';
    if (explicit === 'mock') return 'mock';

    const sim = process.env.SIMULATE_SOCIAL_PUBLISHING?.toLowerCase().trim() === 'true';
    if (sim) return 'mock';

    const hasCreds = Boolean(getYouTubeClientId() && getYouTubeClientSecret());
    return hasCreds ? 'live' : 'mock';
}

/**
 * Non-secret diagnostic summary of YouTube integration configuration.
 */
export function getYouTubeSafeDiagnostics() {
    const clientId = getYouTubeClientId();
    const clientSecret = getYouTubeClientSecret();
    const mode = getYouTubeProviderMode();

    return {
        provider: 'youtube',
        mode,
        clientIdConfigured: Boolean(clientId),
        clientSecretConfigured: Boolean(clientSecret),
        credentialSource: process.env.YOUTUBE_CLIENT_ID ? 'YOUTUBE_CLIENT_*' : 'GOOGLE_CLIENT_*',
        scopes: DEFAULT_YOUTUBE_SCOPES,
        dailyQuotaUnits: DEFAULT_YOUTUBE_CONFIG.quotaDailyUnits,
        uploadChunkSize: `${DEFAULT_YOUTUBE_CONFIG.maxUploadChunkBytes / 1024 / 1024} MB`,
        isReadyForOAuth: Boolean(clientId && clientSecret),
    };
}
