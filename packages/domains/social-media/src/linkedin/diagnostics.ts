/**
 * Diagnostic service for administrators and developers.
 * Reports provider configuration, API version, product review status,
 * connected accounts count, and capabilities WITHOUT ever leaking secrets.
 */

import { prisma } from '@workspace/db';
import { getLinkedInDiagnostics, LinkedInConfigDiagnostics } from './config';
import { LinkedInProviderFactory } from './factory';

export interface LinkedInFullDiagnostics extends LinkedInConfigDiagnostics {
    connectedAccountsCount: number;
    accountsWithValidTokens: number;
    accountsNeedingReauth: number;
    capabilitiesSummary: {
        organizationPosting: 'available' | 'unavailable' | 'pending';
        memberPosting: 'available' | 'unavailable' | 'pending';
        comments: 'available' | 'unavailable' | 'pending';
        reactions: 'available' | 'unavailable' | 'pending';
        analytics: 'available' | 'unavailable' | 'pending';
    };
    reportFormatted: string;
}

export class LinkedInDiagnosticsService {
    static async runDiagnostics(companyId?: string): Promise<LinkedInFullDiagnostics> {
        const base = getLinkedInDiagnostics();
        const provider = LinkedInProviderFactory.getProvider();

        let connectedCount = 0;
        let validTokensCount = 0;
        let reauthCount = 0;

        if (companyId) {
            const accounts = await (prisma as any).socialAccount.findMany({
                where: { companyId, platform: 'linkedin', isActive: true },
                select: { id: true, reauthRequired: true },
            });
            connectedCount = accounts.length;
            reauthCount = accounts.filter((a: any) => a.reauthRequired).length;
            validTokensCount = connectedCount - reauthCount;
        }

        const isMock = base.mode === 'mock';
        const isApproved = base.communityManagementStatus === 'approved';

        type CapStatus = 'available' | 'unavailable' | 'pending';
        const capabilitiesSummary: Record<'organizationPosting' | 'memberPosting' | 'comments' | 'reactions' | 'analytics', CapStatus> = {
            organizationPosting: isMock || isApproved ? 'available' : 'pending',
            memberPosting: isMock || base.clientId === 'CONFIGURED' ? 'available' : 'unavailable',
            comments: isMock || isApproved ? 'available' : 'pending',
            reactions: isMock || isApproved ? 'available' : 'pending',
            analytics: isMock || isApproved ? 'available' : 'pending',
        };

        const reportFormatted = [
            'LinkedIn Provider Diagnostic Report',
            '====================================',
            `Mode: ${base.mode.toUpperCase()}`,
            `Client ID: ${base.clientId}`,
            `Client Secret: ${base.clientSecret}`,
            `API Version: ${base.apiVersion}`,
            `REST Base URL: ${base.restBaseUrl}`,
            `Community Management Status: ${base.communityManagementStatus}`,
            `Configured Scopes: ${base.configuredScopes.join(', ')}`,
            '--- Capabilities ---',
            `Organization Posting: ${capabilitiesSummary.organizationPosting}`,
            `Member Posting: ${capabilitiesSummary.memberPosting}`,
            `Comments & Moderation: ${capabilitiesSummary.comments}`,
            `Reactions: ${capabilitiesSummary.reactions}`,
            `Analytics & Stats: ${capabilitiesSummary.analytics}`,
            '--- Account Summary ---',
            `Connected Accounts: ${connectedCount}`,
            `Valid Token Accounts: ${validTokensCount}`,
            `Reauth Required: ${reauthCount}`,
            '====================================',
        ].join('\n');

        return {
            ...base,
            connectedAccountsCount: connectedCount,
            accountsWithValidTokens: validTokensCount,
            accountsNeedingReauth: reauthCount,
            capabilitiesSummary,
            reportFormatted,
        };
    }
}
