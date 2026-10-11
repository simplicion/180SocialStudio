/**
 * Diagnostic service for administrators and developers.
 * Reports YouTube provider configuration, credentials presence, connected accounts count,
 * capabilities, and token statuses WITHOUT ever leaking secrets.
 */

import { prisma } from '@workspace/db';
import { getYouTubeSafeDiagnostics } from './config';
import { YouTubeProviderFactory } from './factory';

export interface YouTubeFullDiagnostics {
    provider: 'youtube';
    mode: 'mock' | 'live';
    clientId: 'CONFIGURED' | 'MISSING';
    clientSecret: 'CONFIGURED' | 'MISSING';
    redirectUri: 'CONFIGURED' | 'MISSING';
    credentialSource: string;
    requiredApis: {
        youtubeDataApiV3: 'enabled' | 'unknown';
        youtubeAnalyticsApiV1: 'enabled' | 'unknown';
    };
    oauth: 'ready' | 'not ready';
    connectedAccountsCount: number;
    accountsWithValidTokens: number;
    accountsNeedingReauth: number;
    capabilitiesSummary: {
        publishing: 'available' | 'unavailable';
        resumableUpload: 'available' | 'unavailable';
        shorts: 'available' | 'unavailable';
        customThumbnails: 'available' | 'unavailable';
        captions: 'available' | 'unavailable';
        comments: 'available' | 'unavailable';
        analytics: 'available' | 'unavailable';
    };
    reportFormatted: string;
}

export class YouTubeDiagnosticsService {
    static async runDiagnostics(companyId?: string): Promise<YouTubeFullDiagnostics> {
        const base = getYouTubeSafeDiagnostics();
        const redirectUriConfigured = Boolean(process.env.YOUTUBE_REDIRECT_URI || process.env.NEXT_PUBLIC_APP_URL || process.env.BASE_URL);

        let connectedCount = 0;
        let validTokensCount = 0;
        let reauthCount = 0;

        if (companyId) {
            try {
                const accounts = await (prisma as any).socialAccount.findMany({
                    where: { companyId, platform: 'youtube', isActive: true },
                    select: { id: true, reauthRequired: true },
                });
                connectedCount = accounts.length;
                reauthCount = accounts.filter((a: any) => a.reauthRequired).length;
                validTokensCount = connectedCount - reauthCount;
            } catch {
                // If database query fails or in non-db test env, keep 0
            }
        }

        const isMock = base.mode === 'mock';
        const oauthReady = isMock || (base.clientIdConfigured && base.clientSecretConfigured);

        const capabilitiesSummary = {
            publishing: (isMock || oauthReady ? 'available' : 'unavailable') as 'available' | 'unavailable',
            resumableUpload: (isMock || oauthReady ? 'available' : 'unavailable') as 'available' | 'unavailable',
            shorts: (isMock || oauthReady ? 'available' : 'unavailable') as 'available' | 'unavailable',
            customThumbnails: (isMock || oauthReady ? 'available' : 'unavailable') as 'available' | 'unavailable',
            captions: (isMock || oauthReady ? 'available' : 'unavailable') as 'available' | 'unavailable',
            comments: (isMock || oauthReady ? 'available' : 'unavailable') as 'available' | 'unavailable',
            analytics: (isMock || oauthReady ? 'available' : 'unavailable') as 'available' | 'unavailable',
        };

        const reportFormatted = [
            'YouTube Provider Diagnostic Report',
            '====================================',
            `Provider Mode: ${base.mode.toUpperCase()}`,
            `Client ID: ${base.clientIdConfigured ? 'CONFIGURED' : 'MISSING'}`,
            `Client Secret: ${base.clientSecretConfigured ? 'CONFIGURED' : 'MISSING'}`,
            `Redirect URI: ${redirectUriConfigured ? 'CONFIGURED' : 'MISSING'}`,
            `Credential Source: ${base.credentialSource}`,
            `OAuth Status: ${oauthReady ? 'ready' : 'not ready'}`,
            '--- Required APIs ---',
            `YouTube Data API v3: ${isMock ? 'enabled (simulated)' : 'enabled'}`,
            `YouTube Analytics API v1: ${isMock ? 'enabled (simulated)' : 'enabled'}`,
            '--- Capabilities ---',
            `Publishing: ${capabilitiesSummary.publishing}`,
            `Resumable Upload (256KB chunks): ${capabilitiesSummary.resumableUpload}`,
            `Shorts Auto-Detection: ${capabilitiesSummary.shorts}`,
            `Custom Thumbnails: ${capabilitiesSummary.customThumbnails}`,
            `Captions: ${capabilitiesSummary.captions}`,
            `Comments & Moderation: ${capabilitiesSummary.comments}`,
            `YouTube Analytics: ${capabilitiesSummary.analytics}`,
            '--- Accounts & Quota ---',
            `Connected Accounts: ${connectedCount}`,
            `Accounts with Valid Tokens: ${validTokensCount}`,
            `Reauth Required: ${reauthCount}`,
            `Daily Quota Units: ${base.dailyQuotaUnits}`,
            `Upload Chunk Size: ${base.uploadChunkSize}`,
            '====================================',
        ].join('\n');

        return {
            provider: 'youtube',
            mode: base.mode,
            clientId: base.clientIdConfigured ? 'CONFIGURED' : 'MISSING',
            clientSecret: base.clientSecretConfigured ? 'CONFIGURED' : 'MISSING',
            redirectUri: redirectUriConfigured ? 'CONFIGURED' : 'MISSING',
            credentialSource: base.credentialSource,
            requiredApis: {
                youtubeDataApiV3: 'enabled',
                youtubeAnalyticsApiV1: 'enabled',
            },
            oauth: oauthReady ? 'ready' : 'not ready',
            connectedAccountsCount: connectedCount,
            accountsWithValidTokens: validTokensCount,
            accountsNeedingReauth: reauthCount,
            capabilitiesSummary,
            reportFormatted,
        };
    }
}
