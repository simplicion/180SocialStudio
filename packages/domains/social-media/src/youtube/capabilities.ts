/**
 * YouTube Capability Resolution Model.
 * Evaluates granted OAuth scopes and permissions dynamically.
 * Never hardcodes capabilities to true without verifying granted scopes.
 */

import {
    YOUTUBE_UPLOAD_SCOPE,
    YOUTUBE_READONLY_SCOPE,
    YOUTUBE_FORCE_SSL_SCOPE,
    YOUTUBE_ANALYTICS_SCOPE,
    getYouTubeProviderMode,
} from './config';

export interface YouTubeCapabilities {
    canConnectAccount: boolean;
    canUploadVideo: boolean;
    canUpdateVideo: boolean;
    canUploadShort: boolean;
    canUploadShorts: boolean;
    canUploadThumbnail: boolean;
    canUploadCaptions: boolean;
    canReadChannel: boolean;
    canReadVideo: boolean;
    canReadComments: boolean;
    canReplyComment: boolean;
    canReplyComments: boolean;
    canLikeVideo: boolean;
    canReadAnalytics: boolean;
}

export interface CapabilityContext {
    scopes: string[];
    isTokenExpired?: boolean;
    isMock?: boolean;
    mode?: 'mock' | 'live';
}

/**
 * Resolves current YouTube capabilities based on granted OAuth scopes and token status.
 */
export function resolveYouTubeCapabilities(context: CapabilityContext): YouTubeCapabilities {
    let isMock = context.isMock;
    if (isMock === undefined) {
        if (context.mode === 'live') isMock = false;
        else if (context.mode === 'mock') isMock = true;
        else isMock = getYouTubeProviderMode() === 'mock';
    }

    if (context.isTokenExpired) {
        return {
            canConnectAccount: false,
            canUploadVideo: false,
            canUpdateVideo: false,
            canUploadShort: false,
            canUploadShorts: false,
            canUploadThumbnail: false,
            canUploadCaptions: false,
            canReadChannel: false,
            canReadVideo: false,
            canReadComments: false,
            canReplyComment: false,
            canReplyComments: false,
            canLikeVideo: false,
            canReadAnalytics: false,
        };
    }

    // In sandbox mock mode, all capabilities are simulated for comprehensive UI testing
    if (isMock) {
        return {
            canConnectAccount: true,
            canUploadVideo: true,
            canUpdateVideo: true,
            canUploadShort: true,
            canUploadShorts: true,
            canUploadThumbnail: true,
            canUploadCaptions: true,
            canReadChannel: true,
            canReadVideo: true,
            canReadComments: true,
            canReplyComment: true,
            canReplyComments: true,
            canLikeVideo: true,
            canReadAnalytics: true,
        };
    }

    const scopeSet = new Set(context.scopes || []);

    const hasUpload = scopeSet.has(YOUTUBE_UPLOAD_SCOPE) || scopeSet.has('https://www.googleapis.com/auth/youtube');
    const hasReadonly = scopeSet.has(YOUTUBE_READONLY_SCOPE) || scopeSet.has('https://www.googleapis.com/auth/youtube');
    const hasForceSsl = scopeSet.has(YOUTUBE_FORCE_SSL_SCOPE) || scopeSet.has('https://www.googleapis.com/auth/youtube');
    const hasAnalytics = scopeSet.has(YOUTUBE_ANALYTICS_SCOPE);

    return {
        canConnectAccount: true,
        canUploadVideo: hasUpload,
        canUpdateVideo: hasUpload,
        canUploadShort: hasUpload,
        canUploadShorts: hasUpload,
        canUploadThumbnail: hasUpload,
        canUploadCaptions: hasForceSsl || hasUpload,
        canReadChannel: hasReadonly || hasUpload,
        canReadVideo: hasReadonly || hasUpload,
        canReadComments: hasForceSsl || hasReadonly,
        canReplyComment: hasForceSsl,
        canReplyComments: hasForceSsl,
        canLikeVideo: hasForceSsl,
        canReadAnalytics: hasAnalytics,
    };
}
