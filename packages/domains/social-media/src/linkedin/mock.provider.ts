/**
 * Mock LinkedIn Provider for sandbox development, local UI verification,
 * and comprehensive test suites without live LinkedIn API access.
 * Implements the exact same ILinkedInProvider interface as the live provider.
 */

import { resolveLinkedInCapabilities } from './capabilities';
import { LinkedInIntegrationError } from './errors';
import {
    ILinkedInProvider,
    LinkedInAnalyticsData,
    LinkedInComment,
    LinkedInMediaInput,
    LinkedInOrganization,
    LinkedInPostDraft,
    LinkedInPostResult,
    LinkedInReaction,
} from './types';

export class MockLinkedInProvider implements ILinkedInProvider {
    readonly mode = 'mock' as const;

    // Simulation hooks for testing edge cases
    private simulatedError: { code: string; message: string; status?: number } | null = null;
    private simulatedRateLimit = false;

    // In-memory mock store
    private posts = new Map<string, { urn: string; commentary: string; author: string; createdAt: string }>();
    private comments = new Map<string, LinkedInComment[]>();
    private reactions = new Map<string, LinkedInReaction[]>();

    setSimulatedError(code: string, message: string, status = 400) {
        this.simulatedError = { code, message, status };
    }

    setSimulatedRateLimit(enabled: boolean) {
        this.simulatedRateLimit = enabled;
    }

    clearSimulations() {
        this.simulatedError = null;
        this.simulatedRateLimit = false;
        this.posts.clear();
        this.comments.clear();
        this.reactions.clear();
    }

    private checkSimulations() {
        if (this.simulatedRateLimit) {
            throw new LinkedInIntegrationError('RATE_LIMITED', 'LinkedIn API rate limit exceeded (Simulated 429)', {
                httpStatus: 429,
                retryable: true,
                userAction: 'Rate limit hit. Retrying after backoff.',
            });
        }
        if (this.simulatedError) {
            throw new LinkedInIntegrationError(this.simulatedError.code as any, this.simulatedError.message, {
                httpStatus: this.simulatedError.status,
                retryable: false,
            });
        }
    }

    async getAuthorizationUrl(params: { state: string; redirectUri: string; scopes?: string[] }): Promise<string> {
        this.checkSimulations();
        const q = new URLSearchParams({
            response_type: 'code',
            client_id: 'mock_linkedin_client_id',
            redirect_uri: params.redirectUri,
            state: params.state,
            scope: (params.scopes || ['openid', 'profile', 'w_member_social']).join(' '),
        });
        return `https://www.linkedin.com/oauth/v2/authorization?${q}`;
    }

    async exchangeCode(params: { code: string; redirectUri: string }): Promise<{
        accessToken: string;
        refreshToken: string;
        expiresAt: Date;
        refreshExpiresAt: Date;
        scopes: string[];
    }> {
        this.checkSimulations();
        if (params.code === 'invalid_code') {
            throw new LinkedInIntegrationError('OAUTH_CODE_INVALID', 'Invalid authorization code (Simulated)', {
                httpStatus: 400,
            });
        }
        const now = Date.now();
        return {
            accessToken: `mock_access_token_${now}`,
            refreshToken: `mock_refresh_token_${now}`,
            expiresAt: new Date(now + 60 * 86400 * 1000), // 60 days
            refreshExpiresAt: new Date(now + 365 * 86400 * 1000), // 1 year
            scopes: ['openid', 'profile', 'w_member_social', 'r_organization_social', 'w_organization_social', 'rw_organization_admin'],
        };
    }

    async refreshToken(refreshToken: string): Promise<{
        accessToken: string;
        refreshToken: string;
        expiresAt: Date;
    }> {
        this.checkSimulations();
        if (refreshToken.includes('expired_refresh_token')) {
            throw new LinkedInIntegrationError('TOKEN_REFRESH_FAILED', 'Refresh token expired or revoked (Simulated)', {
                httpStatus: 401,
                userAction: 'Please reconnect your LinkedIn account.',
            });
        }
        const now = Date.now();
        return {
            accessToken: `mock_refreshed_access_token_${now}`,
            refreshToken: `mock_refreshed_token_${now}`,
            expiresAt: new Date(now + 60 * 86400 * 1000),
        };
    }

    async getAuthenticatedMember(accessToken: string): Promise<{
        memberId: string;
        urn: string;
        name: string;
        email: string;
        pictureUrl: string;
    }> {
        this.checkSimulations();
        if (accessToken.includes('expired_token')) {
            throw new LinkedInIntegrationError('TOKEN_EXPIRED', 'LinkedIn access token has expired (Simulated 401)', {
                httpStatus: 401,
            });
        }
        return {
            memberId: 'mock_member_180',
            urn: 'urn:li:person:mock_member_180',
            name: 'Alex Rivera (Demo)',
            email: 'alex.rivera@180workspace.test',
            pictureUrl: 'https://api.dicebear.com/7.x/identicon/png?seed=linkedin-demo',
        };
    }

    async getOrganizations(accessToken: string): Promise<LinkedInOrganization[]> {
        this.checkSimulations();
        const baseCaps = resolveLinkedInCapabilities({ accountKind: 'organization', scopes: ['r_organization_social', 'w_organization_social', 'rw_organization_admin'], mode: 'mock' });
        return [
            {
                id: '18099001',
                urn: 'urn:li:organization:18099001',
                name: '180 Workspace Global',
                vanityName: '180workspace',
                logo: 'https://api.dicebear.com/7.x/identicon/png?seed=180workspace',
                role: 'ADMINISTRATOR',
                capabilities: baseCaps,
            },
            {
                id: '18099002',
                urn: 'urn:li:organization:18099002',
                name: 'Simplicion Ventures',
                vanityName: 'simplicion-ventures',
                logo: 'https://api.dicebear.com/7.x/identicon/png?seed=simplicion',
                role: 'DIRECT_SPONSORED_CONTENT_POSTER',
                capabilities: baseCaps,
            },
        ];
    }

    async getOrganization(orgId: string, accessToken: string): Promise<LinkedInOrganization | null> {
        this.checkSimulations();
        const orgs = await this.getOrganizations(accessToken);
        return orgs.find((o) => o.id === orgId || o.urn.endsWith(`:${orgId}`)) || null;
    }

    getCapabilities(params: {
        accountKind: 'member' | 'organization' | 'user';
        scopes: string[];
        orgRole?: string | null;
    }) {
        return resolveLinkedInCapabilities({
            accountKind: params.accountKind,
            scopes: params.scopes,
            orgRole: params.orgRole,
            mode: 'mock',
        });
    }

    async uploadMedia(media: LinkedInMediaInput, authorUrn: string, accessToken: string): Promise<string> {
        this.checkSimulations();
        if (media.url.includes('fail-upload')) {
            throw new LinkedInIntegrationError('MEDIA_UPLOAD_FAILED', 'Simulated binary upload connection failure', {
                retryable: true,
                httpStatus: 502,
            });
        }
        const id = Math.random().toString(36).substring(2, 10);
        switch (media.kind) {
            case 'video':
                return `urn:li:video:sim_${id}`;
            case 'document':
                return `urn:li:document:sim_${id}`;
            case 'image':
            default:
                return `urn:li:image:sim_${id}`;
        }
    }

    async createPost(draft: LinkedInPostDraft, accessToken: string): Promise<LinkedInPostResult> {
        this.checkSimulations();
        if (!draft.text?.trim() && draft.format === 'text') {
            throw new LinkedInIntegrationError('PLATFORM_API_ERROR', 'Commentary is required for text posts', {
                httpStatus: 400,
            });
        }

        const simId = `sim_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        const urn = `urn:li:share:${simId}`;
        const activityUrn = `urn:li:activity:${simId}`;

        this.posts.set(urn, {
            urn,
            commentary: draft.text,
            author: draft.authorUrn,
            createdAt: new Date().toISOString(),
        });

        let warning: string | undefined;
        if (draft.firstComment) {
            await this.createComment(urn, draft.firstComment, draft.authorUrn, accessToken);
        }

        return {
            activityUrn,
            postUrn: urn,
            url: `https://www.linkedin.com/feed/update/${activityUrn}`,
            state: 'published',
            warning,
            isSimulated: true,
        };
    }

    async getPost(postUrn: string, accessToken: string) {
        this.checkSimulations();
        const p = this.posts.get(postUrn);
        if (!p) {
            return {
                urn: postUrn,
                commentary: 'Simulated post content',
                author: 'urn:li:organization:18099001',
                createdAt: new Date().toISOString(),
            };
        }
        return p;
    }

    async deletePost(postUrn: string, accessToken: string): Promise<boolean> {
        this.checkSimulations();
        this.posts.delete(postUrn);
        return true;
    }

    async listComments(postUrn: string, accessToken: string, limit = 20): Promise<LinkedInComment[]> {
        this.checkSimulations();
        const existing = this.comments.get(postUrn) || [];
        if (!existing.length) {
            return [
                {
                    id: `urn:li:comment:sim_c1`,
                    postUrn,
                    actorUrn: 'urn:li:person:sim_lead_1',
                    actorName: 'Jordan Vance',
                    message: 'Impressive release! How does this compare with the enterprise tier?',
                    createdAt: new Date(Date.now() - 3600000).toISOString(),
                },
            ];
        }
        return existing.slice(0, limit);
    }

    async createComment(postUrn: string, text: string, actorUrn: string, accessToken: string): Promise<LinkedInComment> {
        this.checkSimulations();
        const comment: LinkedInComment = {
            id: `urn:li:comment:sim_${Date.now()}`,
            postUrn,
            actorUrn,
            actorName: '180 Workspace Admin',
            message: text,
            createdAt: new Date().toISOString(),
        };
        const list = this.comments.get(postUrn) || [];
        list.push(comment);
        this.comments.set(postUrn, list);
        return comment;
    }

    async deleteComment(commentUrn: string, accessToken: string): Promise<boolean> {
        this.checkSimulations();
        for (const [postUrn, list] of this.comments.entries()) {
            const next = list.filter((c) => c.id !== commentUrn);
            if (next.length !== list.length) {
                this.comments.set(postUrn, next);
                return true;
            }
        }
        return true;
    }

    async listReactions(postUrn: string, accessToken: string): Promise<LinkedInReaction[]> {
        this.checkSimulations();
        const list = this.reactions.get(postUrn);
        if (list && list.length) return list;
        return [
            { actorUrn: 'urn:li:person:sim_user_1', reactionType: 'LIKE', createdAt: new Date().toISOString() },
            { actorUrn: 'urn:li:person:sim_user_2', reactionType: 'CELEBRATE', createdAt: new Date().toISOString() },
            { actorUrn: 'urn:li:person:sim_user_3', reactionType: 'INSIGHTFUL', createdAt: new Date().toISOString() },
        ];
    }

    async createReaction(postUrn: string, reactionType: LinkedInReaction['reactionType'], actorUrn: string, accessToken: string): Promise<boolean> {
        this.checkSimulations();
        const list = this.reactions.get(postUrn) || [];
        list.push({ actorUrn, reactionType, createdAt: new Date().toISOString() });
        this.reactions.set(postUrn, list);
        return true;
    }

    async deleteReaction(postUrn: string, actorUrn: string, accessToken: string): Promise<boolean> {
        this.checkSimulations();
        const list = this.reactions.get(postUrn) || [];
        this.reactions.set(postUrn, list.filter((r) => r.actorUrn !== actorUrn));
        return true;
    }

    async getAnalytics(accountUrn: string, period: string, accessToken: string): Promise<LinkedInAnalyticsData> {
        this.checkSimulations();
        return {
            platform: 'linkedin',
            accountUrn,
            period,
            metrics: [
                { name: 'impressions', value: 14820, unit: 'count', changePct: 18.4 },
                { name: 'unique_views', value: 9240, unit: 'count', changePct: 12.1 },
                { name: 'clicks', value: 680, unit: 'count', changePct: 5.6 },
                { name: 'likes', value: 412, unit: 'count', changePct: 22.0 },
                { name: 'comments', value: 89, unit: 'count', changePct: 35.8 },
                { name: 'shares', value: 47, unit: 'count', changePct: 9.3 },
                { name: 'engagement_rate', value: 8.3, unit: 'percent', changePct: 1.2 },
            ],
            isSimulated: true,
        };
    }
}
