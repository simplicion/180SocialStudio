/**
 * Live LinkedIn Provider: real HTTP interaction with LinkedIn REST APIs.
 * Enforces strict capability validation, rate limits, and secure error normalization.
 */

import { escapeLinkedInCommentary } from '../adapters/linkedin.adapter';
import { resolveLinkedInCapabilities } from './capabilities';
import { LinkedInRestClient } from './client';
import { getLinkedInApiConfig } from './config';
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

export class LinkedInLiveProvider implements ILinkedInProvider {
    readonly mode = 'live' as const;
    private client: LinkedInRestClient;

    constructor(client = new LinkedInRestClient()) {
        this.client = client;
    }

    private getCredentials() {
        const clientId = process.env.LINKEDIN_CLIENT_ID?.trim();
        const clientSecret = process.env.LINKEDIN_CLIENT_SECRET?.trim();
        if (!clientId || !clientSecret) {
            throw new LinkedInIntegrationError('SOCIAL_PROVIDER_NOT_CONFIGURED', 'LinkedIn API credentials are missing on this server.', {
                httpStatus: 503,
                userAction: 'Configure LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET in the environment.',
            });
        }
        return { clientId, clientSecret };
    }

    async getAuthorizationUrl(params: { state: string; redirectUri: string; scopes?: string[] }): Promise<string> {
        const { clientId } = this.getCredentials();
        const config = getLinkedInApiConfig();
        const defaultScopes = ['openid', 'profile', 'w_member_social'];
        const scopes = params.scopes && params.scopes.length > 0 ? params.scopes : defaultScopes;

        const q = new URLSearchParams({
            response_type: 'code',
            client_id: clientId,
            redirect_uri: params.redirectUri,
            state: params.state,
            scope: scopes.join(' '),
        });
        return `${config.oauthAuthorizeUrl}?${q}`;
    }

    async exchangeCode(params: { code: string; redirectUri: string }): Promise<{
        accessToken: string;
        refreshToken?: string | null;
        expiresAt: Date | null;
        refreshExpiresAt?: Date | null;
        scopes: string[];
    }> {
        const { clientId, clientSecret } = this.getCredentials();
        const config = getLinkedInApiConfig();

        const form = new URLSearchParams({
            grant_type: 'authorization_code',
            code: params.code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: params.redirectUri,
        });

        const res = await this.client.request({
            method: 'POST',
            pathOrUrl: config.oauthTokenUrl,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: form.toString(),
            skipVersionHeaders: true,
        });

        const b = res.data;
        const now = Date.now();
        return {
            accessToken: b.access_token,
            refreshToken: b.refresh_token ?? null,
            expiresAt: b.expires_in ? new Date(now + Number(b.expires_in) * 1000) : null,
            refreshExpiresAt: b.refresh_token_expires_in ? new Date(now + Number(b.refresh_token_expires_in) * 1000) : null,
            scopes: typeof b.scope === 'string' ? b.scope.split(/[ ,]+/).filter(Boolean) : [],
        };
    }

    async refreshToken(refreshToken: string): Promise<{
        accessToken: string;
        refreshToken?: string | null;
        expiresAt: Date | null;
    }> {
        const { clientId, clientSecret } = this.getCredentials();
        const config = getLinkedInApiConfig();

        const form = new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: clientId,
            client_secret: clientSecret,
        });

        const res = await this.client.request({
            method: 'POST',
            pathOrUrl: config.oauthTokenUrl,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: form.toString(),
            skipVersionHeaders: true,
        });

        const b = res.data;
        const now = Date.now();
        return {
            accessToken: b.access_token,
            refreshToken: b.refresh_token ?? refreshToken,
            expiresAt: b.expires_in ? new Date(now + Number(b.expires_in) * 1000) : null,
        };
    }

    async getAuthenticatedMember(accessToken: string): Promise<{
        memberId: string;
        urn: string;
        name: string;
        email?: string;
        pictureUrl?: string | null;
    }> {
        const config = getLinkedInApiConfig();
        const res = await this.client.request({
            method: 'GET',
            pathOrUrl: config.userinfoUrl,
            token: accessToken,
            skipVersionHeaders: true,
        });

        const me = res.data;
        return {
            memberId: me.sub,
            urn: `urn:li:person:${me.sub}`,
            name: me.name || 'LinkedIn Member',
            email: me.email,
            pictureUrl: me.picture ?? null,
        };
    }

    async getOrganizations(accessToken: string): Promise<LinkedInOrganization[]> {
        const aclRes = await this.client.request({
            method: 'GET',
            pathOrUrl: '/organizationAcls?q=roleAssignee&state=APPROVED',
            token: accessToken,
        });

        const acl = aclRes.data;
        const orgs: LinkedInOrganization[] = [];

        for (const el of acl.elements || []) {
            const urn: string = el.organization || el.organizationTarget;
            if (!urn) continue;
            const orgId = urn.split(':').pop()!;
            const role = el.role || 'ADMINISTRATOR';

            let orgData: any = {};
            try {
                const orgRes = await this.client.request({
                    method: 'GET',
                    pathOrUrl: `/organizations/${orgId}`,
                    token: accessToken,
                });
                orgData = orgRes.data || {};
            } catch {
                // If detail endpoint restricted, fallback to basic URN
            }

            const caps = resolveLinkedInCapabilities({
                accountKind: 'organization',
                scopes: ['r_organization_social', 'w_organization_social'],
                orgRole: role,
                mode: 'live',
            });

            orgs.push({
                id: orgId,
                urn,
                name: orgData.localizedName || `Organization ${orgId}`,
                vanityName: orgData.vanityName,
                logo: null,
                role,
                capabilities: caps,
            });
        }

        return orgs;
    }

    async getOrganization(orgId: string, accessToken: string): Promise<LinkedInOrganization | null> {
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
            mode: 'live',
        });
    }

    async uploadMedia(media: LinkedInMediaInput, authorUrn: string, accessToken: string): Promise<string> {
        const isVideo = media.kind === 'video';
        const isDoc = media.kind === 'document';
        const kind = isVideo ? 'videos' : isDoc ? 'documents' : 'images';

        // Fetch binary data from source URL
        const downloadRes = await fetch(media.url);
        if (!downloadRes.ok) {
            throw new LinkedInIntegrationError('MEDIA_UPLOAD_FAILED', `Could not download media from ${media.url}`, {
                httpStatus: 400,
            });
        }
        const buffer = new Uint8Array(await downloadRes.arrayBuffer());

        if (isVideo) {
            return this.uploadVideo(buffer, authorUrn, accessToken);
        }

        // Image or document simple upload
        const initRes = await this.client.request({
            method: 'POST',
            pathOrUrl: `/${kind}?action=initializeUpload`,
            token: accessToken,
            body: { initializeUploadRequest: { owner: authorUrn } },
        });

        const uploadUrl = initRes.data?.value?.uploadUrl;
        const urn = initRes.data?.value?.image || initRes.data?.value?.document;
        if (!uploadUrl || !urn) {
            throw new LinkedInIntegrationError('MEDIA_UPLOAD_FAILED', `LinkedIn ${kind} initializeUpload returned no upload URL.`, {
                retryable: true,
            });
        }

        await this.client.request({
            method: 'PUT',
            pathOrUrl: uploadUrl,
            token: accessToken,
            binaryBody: buffer,
            contentType: media.mimeType || (isDoc ? 'application/pdf' : 'image/jpeg'),
            skipVersionHeaders: true,
        });

        return urn;
    }

    private async uploadVideo(bytes: Uint8Array, authorUrn: string, token: string): Promise<string> {
        const initRes = await this.client.request({
            method: 'POST',
            pathOrUrl: '/videos?action=initializeUpload',
            token,
            body: {
                initializeUploadRequest: {
                    owner: authorUrn,
                    fileSizeBytes: bytes.byteLength,
                    uploadCaptions: false,
                    uploadThumbnail: false,
                },
            },
        });

        const videoUrn: string = initRes.data?.value?.video;
        const uploadToken: string = initRes.data?.value?.uploadToken || '';
        const instructions: Array<{ uploadUrl: string; firstByte: number; lastByte: number }> =
            initRes.data?.value?.uploadInstructions || [];

        if (!videoUrn || !instructions.length) {
            throw new LinkedInIntegrationError('MEDIA_UPLOAD_FAILED', 'LinkedIn video init returned no upload instructions.', {
                retryable: true,
            });
        }

        const etags: string[] = [];
        for (const part of instructions) {
            const partBuffer = bytes.subarray(part.firstByte, part.lastByte + 1);
            const partRes = await this.client.request({
                method: 'PUT',
                pathOrUrl: part.uploadUrl,
                binaryBody: partBuffer,
                contentType: 'application/octet-stream',
                skipVersionHeaders: true,
            });
            const etag = partRes.headers.get('etag');
            if (!etag) {
                throw new LinkedInIntegrationError('MEDIA_UPLOAD_FAILED', 'LinkedIn video part upload returned no ETag.', {
                    retryable: true,
                });
            }
            etags.push(etag);
        }

        await this.client.request({
            method: 'POST',
            pathOrUrl: '/videos?action=finalizeUpload',
            token,
            body: {
                finalizeUploadRequest: {
                    video: videoUrn,
                    uploadToken,
                    uploadedPartIds: etags,
                },
            },
        });

        // Poll until AVAILABLE
        let available = false;
        for (let i = 0; i < 30; i++) {
            await new Promise((r) => setTimeout(r, 2000));
            const statusRes = await this.client.request({
                method: 'GET',
                pathOrUrl: `/videos/${encodeURIComponent(videoUrn)}`,
                token,
            });
            const s = statusRes.data;
            if (s.status === 'AVAILABLE') {
                available = true;
                break;
            }
            if (s.status === 'PROCESSING_FAILED') {
                throw new LinkedInIntegrationError('MEDIA_UPLOAD_FAILED', `LinkedIn video processing failed: ${s.processingFailureReason || 'unknown'}`, {
                    httpStatus: 400,
                });
            }
        }

        if (!available) {
            throw new LinkedInIntegrationError('PROVIDER_UNAVAILABLE', 'LinkedIn video processing timed out', {
                retryable: true,
            });
        }

        return videoUrn;
    }

    async createPost(draft: LinkedInPostDraft, accessToken: string): Promise<LinkedInPostResult> {
        const isOrg = draft.authorUrn.startsWith('urn:li:organization:');
        const isMember = draft.authorUrn.startsWith('urn:li:person:');

        if (!isOrg && !isMember) {
            throw new LinkedInIntegrationError('PLATFORM_API_ERROR', `Invalid author URN "${draft.authorUrn}". Expected urn:li:person or urn:li:organization.`);
        }

        const postBody: Record<string, any> = {
            author: draft.authorUrn,
            commentary: escapeLinkedInCommentary(draft.text),
            visibility: draft.visibility || 'PUBLIC',
            distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
            lifecycleState: 'PUBLISHED',
            isReshareDisabledByAuthor: false,
        };

        if (draft.format === 'video') {
            const v = draft.media?.find((m) => m.kind === 'video');
            if (!v) throw new LinkedInIntegrationError('PLATFORM_API_ERROR', 'Video format requires video media');
            const mediaId = await this.uploadMedia(v, draft.authorUrn, accessToken);
            postBody.content = { media: { id: mediaId, title: (draft.title || '').slice(0, 200) || undefined } };
        } else if (draft.format === 'image') {
            const img = draft.media?.find((m) => m.kind === 'image');
            if (!img) throw new LinkedInIntegrationError('PLATFORM_API_ERROR', 'Image format requires image media');
            const mediaId = await this.uploadMedia(img, draft.authorUrn, accessToken);
            postBody.content = { media: { id: mediaId, altText: img.altText } };
        } else if (draft.format === 'document') {
            const doc = draft.media?.find((m) => m.kind === 'document');
            if (!doc) throw new LinkedInIntegrationError('PLATFORM_API_ERROR', 'Document format requires PDF media');
            const mediaId = await this.uploadMedia(doc, draft.authorUrn, accessToken);
            postBody.content = { media: { id: mediaId, title: (draft.title || 'Document').slice(0, 200) } };
        } else if (draft.format === 'carousel') {
            const images = draft.media?.filter((m) => m.kind === 'image') || [];
            const doc = draft.media?.find((m) => m.kind === 'document');
            if (doc) {
                const mediaId = await this.uploadMedia(doc, draft.authorUrn, accessToken);
                postBody.content = { media: { id: mediaId, title: (draft.title || 'Carousel').slice(0, 200) } };
            } else {
                const uploaded = [];
                for (const img of images) {
                    const id = await this.uploadMedia(img, draft.authorUrn, accessToken);
                    uploaded.push({ id, ...(img.altText ? { altText: img.altText } : {}) });
                }
                postBody.content = { multiImage: { images: uploaded } };
            }
        }

        const res = await this.client.request({
            method: 'POST',
            pathOrUrl: '/posts',
            token: accessToken,
            body: postBody,
        });

        const postUrn = res.headers.get('x-restli-id') || res.headers.get('x-linkedin-id');
        if (!postUrn) {
            throw new LinkedInIntegrationError('PUBLISH_FAILED', 'LinkedIn created the post but returned no post URN.');
        }

        let warning: string | undefined;
        if (draft.firstComment?.trim()) {
            try {
                await this.createComment(postUrn, draft.firstComment, draft.authorUrn, accessToken);
            } catch (err: any) {
                warning = `Post published, but first comment failed: ${err.message}`;
            }
        }

        return {
            activityUrn: postUrn,
            postUrn,
            url: `https://www.linkedin.com/feed/update/${postUrn}`,
            state: 'published',
            warning,
        };
    }

    async getPost(postUrn: string, accessToken: string) {
        const res = await this.client.request({
            method: 'GET',
            pathOrUrl: `/posts/${encodeURIComponent(postUrn)}`,
            token: accessToken,
        });
        return {
            urn: postUrn,
            commentary: res.data?.commentary || '',
            author: res.data?.author || '',
            createdAt: res.data?.createdAt ? new Date(res.data.createdAt).toISOString() : new Date().toISOString(),
        };
    }

    async deletePost(postUrn: string, accessToken: string): Promise<boolean> {
        await this.client.request({
            method: 'DELETE',
            pathOrUrl: `/posts/${encodeURIComponent(postUrn)}`,
            token: accessToken,
        });
        return true;
    }

    async listComments(postUrn: string, accessToken: string, limit = 20): Promise<LinkedInComment[]> {
        const res = await this.client.request({
            method: 'GET',
            pathOrUrl: `/socialActions/${encodeURIComponent(postUrn)}/comments?count=${limit}`,
            token: accessToken,
        });

        const elements = res.data?.elements || [];
        return elements.map((e: any) => ({
            id: e.id || e.$URN,
            postUrn,
            actorUrn: e.actor || '',
            actorName: e.actorName,
            message: e.message?.text || '',
            createdAt: e.created?.time ? new Date(e.created.time).toISOString() : new Date().toISOString(),
        }));
    }

    async createComment(postUrn: string, text: string, actorUrn: string, accessToken: string): Promise<LinkedInComment> {
        const res = await this.client.request({
            method: 'POST',
            pathOrUrl: `/socialActions/${encodeURIComponent(postUrn)}/comments`,
            token: accessToken,
            body: {
                actor: actorUrn,
                object: postUrn,
                message: { text },
            },
        });

        const id = res.headers.get('x-restli-id') || res.data?.id || `comment_${Date.now()}`;
        return {
            id,
            postUrn,
            actorUrn,
            message: text,
            createdAt: new Date().toISOString(),
        };
    }

    async deleteComment(commentUrn: string, accessToken: string): Promise<boolean> {
        await this.client.request({
            method: 'DELETE',
            pathOrUrl: `/socialActions/${encodeURIComponent(commentUrn)}`,
            token: accessToken,
        });
        return true;
    }

    async listReactions(postUrn: string, accessToken: string): Promise<LinkedInReaction[]> {
        const res = await this.client.request({
            method: 'GET',
            pathOrUrl: `/socialActions/${encodeURIComponent(postUrn)}/reactions`,
            token: accessToken,
        });

        const elements = res.data?.elements || [];
        return elements.map((e: any) => ({
            actorUrn: e.actor || '',
            reactionType: e.reactionType || 'LIKE',
            createdAt: e.created?.time ? new Date(e.created.time).toISOString() : new Date().toISOString(),
        }));
    }

    async createReaction(postUrn: string, reactionType: LinkedInReaction['reactionType'], actorUrn: string, accessToken: string): Promise<boolean> {
        await this.client.request({
            method: 'POST',
            pathOrUrl: `/socialActions/${encodeURIComponent(postUrn)}/reactions`,
            token: accessToken,
            body: {
                actor: actorUrn,
                root: postUrn,
                reactionType,
            },
        });
        return true;
    }

    async deleteReaction(postUrn: string, actorUrn: string, accessToken: string): Promise<boolean> {
        await this.client.request({
            method: 'DELETE',
            pathOrUrl: `/socialActions/${encodeURIComponent(postUrn)}/reactions/${encodeURIComponent(actorUrn)}`,
            token: accessToken,
        });
        return true;
    }

    async getAnalytics(accountUrn: string, period: string, accessToken: string): Promise<LinkedInAnalyticsData> {
        // Fetch organizational share statistics if available for company pages
        const res = await this.client.request({
            method: 'GET',
            pathOrUrl: `/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=${encodeURIComponent(accountUrn)}`,
            token: accessToken,
        });

        const stats = res.data?.elements?.[0]?.totalShareStatistics || {};
        return {
            platform: 'linkedin',
            accountUrn,
            period,
            metrics: [
                { name: 'impressions', value: stats.impressionCount || 0, unit: 'count' },
                { name: 'unique_impressions', value: stats.uniqueImpressionsCount || 0, unit: 'count' },
                { name: 'clicks', value: stats.clickCount || 0, unit: 'count' },
                { name: 'likes', value: stats.likeCount || 0, unit: 'count' },
                { name: 'comments', value: stats.commentCount || 0, unit: 'count' },
                { name: 'shares', value: stats.shareCount || 0, unit: 'count' },
                { name: 'engagement_rate', value: Math.round((stats.engagement || 0) * 1000) / 10, unit: 'percent' },
            ],
        };
    }
}
