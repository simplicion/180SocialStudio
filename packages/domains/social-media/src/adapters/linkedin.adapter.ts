/**
 * LinkedIn publisher (versioned REST Posts API). Author = the account's URN: `urn:li:person:{id}` (member,
 * scope w_member_social) or `urn:li:organization:{id}` (company page, scope w_organization_social).
 * Images: /rest/images?action=initializeUpload → PUT bytes → post content.media / content.multiImage
 * Documents (PDF carousel): /rest/documents?action=initializeUpload → PUT → content.media
 * Video: /rest/videos?action=initializeUpload → PUT each part (collect ETags) → finalizeUpload → wait AVAILABLE → post
 * Docs: learn.microsoft.com/linkedin/marketing/community-management/shares/posts-api
 * Verified 2026-09-27 (docs version li-lms-2026-09): commentary ≤ 3,000 chars; multiImage 2–20 images (organic only,
 * < 36,152,320 px, JPG/GIF/PNG); video 3s–30min, 75 KB–500 MB, MP4, 4 MB parts with ETags; documents PDF/PPT(X)/
 * DOC(X) ≤ 100 MB and ≤ 300 pages; organic "carousel" (sponsored-only) is NOT available, so image carousels are
 * published as multiImage and PDF carousels as documents. Post id comes back in the `x-restli-id` header (201).
 */
import { intEnv } from '../publishing/config';
import { linkedInApiVersion } from '../publishing/linkedin-version';
import { PublishError } from '../publishing/errors';
import { isSandboxToken, requireToken } from "./engagement-token";
import { asBody, downloadMedia, expectOk, pollUntil, providerFailure, providerFetch, readBody } from '../publishing/http';
import { PlatformPublisher, PublishInput, PublishOutcome, charLength, checkUrls, checkVideo } from './types';

const REST = 'https://api.linkedin.com/rest';

const headers = (token: string, json = true) => ({
    Authorization: `Bearer ${token}`,
    'LinkedIn-Version': linkedInApiVersion(),
    'X-Restli-Protocol-Version': '2.0.0',
    ...(json ? { 'Content-Type': 'application/json' } : {}),
});

/**
 * LinkedIn "little text" format reserves these characters; escape them so captions post verbatim. A `#` that starts
 * a hashtag (#word) is left alone so LinkedIn still links it (the Posts API turns plain `#coding` into a hashtag).
 */
export const escapeLinkedInCommentary = (s: string) =>
    s.replace(/[\\|{}@\[\]()<>#*_~]/g, (c: string, i: number, all: string) => (c === '#' && /[\p{L}\p{N}_]/u.test(all[i + 1] || '') ? c : `\\${c}`));

const LI_VIDEO_MAX_BYTES = 500 * 1024 * 1024;
const LI_DOC_MAX_BYTES = 100 * 1024 * 1024;
const LI_IMAGE_MAX_PIXELS = 36_152_320;

export class LinkedInPublisher implements PlatformPublisher {
    readonly platform = 'linkedin' as const;

    validate(input: PublishInput): string[] {
        const issues: string[] = [];
        if (charLength(input.caption) > 3000) issues.push('LinkedIn posts are limited to 3,000 characters.');
        if (!/^urn:li:(person|organization):/.test(input.account.platformAccountId)) issues.push('LinkedIn account has no valid author URN; reconnect it.');
        checkUrls(input, issues);
        if (input.media.some((m) => m.kind === 'image' && m.width && m.height && m.width * m.height >= LI_IMAGE_MAX_PIXELS)) issues.push('LinkedIn images must be under 36 megapixels.');
        switch (input.format) {
            case 'text':
                if (!input.caption.trim()) issues.push('LinkedIn text posts need commentary.');
                break;
            case 'video': {
                const v = input.media.find((m) => m.kind === 'video');
                if (!v) issues.push('LinkedIn video posts need a video.');
                checkVideo(v, { minSec: 3, maxSec: 30 * 60, maxBytes: LI_VIDEO_MAX_BYTES }, 'LinkedIn video', issues);
                if (v?.sizeBytes != null && v.sizeBytes < 75 * 1024) issues.push('LinkedIn videos must be at least 75 KB.');
                break;
            }
            case 'image':
                if (!input.media.some((m) => m.kind === 'image')) issues.push('LinkedIn image posts need an image.');
                break;
            default:
                issues.push(`LinkedIn cannot publish ${input.format} posts.`);
            case 'carousel': {
                const imgs = input.media.filter((m) => m.kind === 'image');
                const doc = input.media.find((m) => m.kind === 'document');
                if (!doc && (imgs.length < 2 || imgs.length > 20)) issues.push('LinkedIn multi-image posts need 2 to 20 images (or attach a PDF for a document carousel).');
                if (input.media.some((m) => m.kind === 'video')) issues.push('LinkedIn carousels cannot contain video.');
                break;
            }
            case 'document': {
                const doc = input.media.find((m) => m.kind === 'document');
                if (!doc) issues.push('LinkedIn document posts need a PDF.');
                if (doc?.sizeBytes && doc.sizeBytes > LI_DOC_MAX_BYTES) issues.push('LinkedIn documents must be at most 100 MB.');
                if (doc?.mimeType && !/pdf|powerpoint|presentation|msword|wordprocessing/.test(doc.mimeType)) issues.push('LinkedIn documents must be PDF, PPT(X) or DOC(X).');
                break;
            }
        }
        return issues;
    }

    private async uploadSimple(kind: 'images' | 'documents', owner: string, url: string, token: string): Promise<string> {
        const init = await providerFetch('linkedin', `${REST}/${kind}?action=initializeUpload`, {
            method: 'POST',
            headers: headers(token),
            body: JSON.stringify({ initializeUploadRequest: { owner } }),
        });
        const data = await expectOk('linkedin', init, `LinkedIn ${kind} init`);
        const uploadUrl = data.value?.uploadUrl;
        const urn = data.value?.image || data.value?.document;
        if (!uploadUrl || !urn) throw new PublishError('PROVIDER_ERROR', `LinkedIn ${kind} init returned no upload URL.`, { platform: 'linkedin', retryable: true });
        const media = await downloadMedia('linkedin', url);
        const put = await providerFetch('linkedin', uploadUrl, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': media.contentType }, body: asBody(media.bytes) });
        if (!put.ok) throw providerFailure('linkedin', put, await readBody(put), `LinkedIn ${kind} upload`);
        if (kind === 'documents') await this.waitAvailable('documents', urn, token);
        return urn;
    }

    /** Documents and videos must be AVAILABLE before a post can reference them. */
    private async waitAvailable(kind: 'documents' | 'videos', urn: string, token: string) {
        const noun = kind === 'videos' ? 'video' : 'document';
        await pollUntil(
            async () => {
                const r = await providerFetch('linkedin', `${REST}/${kind}/${encodeURIComponent(urn)}`, { method: 'GET', headers: headers(token, false) });
                const s = await expectOk('linkedin', r, `LinkedIn ${noun} status`);
                if (s.status === 'AVAILABLE') return true;
                if (s.status === 'PROCESSING_FAILED') throw new PublishError('PROVIDER_ERROR', `LinkedIn could not process the ${noun} (${s.processingFailureReason || 'unknown reason'}).`, { platform: 'linkedin' });
                return undefined;
            },
            {
                attempts: intEnv('LINKEDIN_VIDEO_POLL_ATTEMPTS', 60),
                intervalMs: intEnv('LINKEDIN_VIDEO_POLL_MS', 5000),
                onTimeout: () => new PublishError('PROVIDER_TIMEOUT', `LinkedIn is still processing the ${noun}; try again shortly.`, { retryable: true, platform: 'linkedin' }),
            },
        );
    }

    private async uploadVideo(owner: string, url: string, token: string): Promise<string> {
        const media = await downloadMedia('linkedin', url);
        const init = await providerFetch('linkedin', `${REST}/videos?action=initializeUpload`, {
            method: 'POST',
            headers: headers(token),
            body: JSON.stringify({ initializeUploadRequest: { owner, fileSizeBytes: media.size, uploadCaptions: false, uploadThumbnail: false } }),
        });
        const data = await expectOk('linkedin', init, 'LinkedIn video init');
        const videoUrn: string = data.value?.video;
        const instructions: Array<{ uploadUrl: string; firstByte: number; lastByte: number }> = data.value?.uploadInstructions || [];
        if (!videoUrn || !instructions.length) throw new PublishError('PROVIDER_ERROR', 'LinkedIn video init returned no upload instructions.', { platform: 'linkedin', retryable: true });

        const etags: string[] = [];
        for (const part of instructions) {
            const put = await providerFetch('linkedin', part.uploadUrl, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/octet-stream' },
                body: asBody(media.bytes.subarray(part.firstByte, part.lastByte + 1)),
            });
            if (!put.ok) throw providerFailure('linkedin', put, await readBody(put), 'LinkedIn video part upload');
            const etag = put.headers.get('etag');
            if (!etag) throw new PublishError('PROVIDER_ERROR', 'LinkedIn video part upload returned no ETag.', { platform: 'linkedin', retryable: true });
            etags.push(etag);
        }

        const fin = await providerFetch('linkedin', `${REST}/videos?action=finalizeUpload`, {
            method: 'POST',
            headers: headers(token),
            body: JSON.stringify({ finalizeUploadRequest: { video: videoUrn, uploadToken: data.value?.uploadToken || '', uploadedPartIds: etags } }),
        });
        await expectOk('linkedin', fin, 'LinkedIn video finalize');

        await this.waitAvailable('videos', videoUrn, token);
        return videoUrn;
    }

    async publish(input: PublishInput, token: string): Promise<PublishOutcome> {
        const author = input.account.platformAccountId;
        const post: Record<string, any> = {
            author,
            commentary: escapeLinkedInCommentary(input.caption),
            visibility: input.platformMeta.visibility || 'PUBLIC',
            distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
            lifecycleState: 'PUBLISHED',
            isReshareDisabledByAuthor: false,
        };

        if (input.format === 'video') {
            const v = input.media.find((m) => m.kind === 'video')!;
            post.content = { media: { id: await this.uploadVideo(author, v.url, token), title: (input.title || '').slice(0, 200) || undefined } };
        } else if (input.format === 'image') {
            const img = input.media.find((m) => m.kind === 'image')!;
            post.content = { media: { id: await this.uploadSimple('images', author, img.url, token), altText: img.altText } };
        } else if (input.format === 'document' || (input.format === 'carousel' && input.media.some((m) => m.kind === 'document'))) {
            const doc = input.media.find((m) => m.kind === 'document')!;
            post.content = { media: { id: await this.uploadSimple('documents', author, doc.url, token), title: (input.title || input.platformMeta.documentTitle || 'Document').slice(0, 200) } };
        } else if (input.format === 'carousel') {
            const images = [];
            for (const m of input.media.filter((x) => x.kind === 'image')) {
                images.push({ id: await this.uploadSimple('images', author, m.url, token), ...(m.altText ? { altText: m.altText } : {}) });
            }
            post.content = { multiImage: { images } };
        }

        const res = await providerFetch('linkedin', `${REST}/posts`, { method: 'POST', headers: headers(token), body: JSON.stringify(post) });
        if (!res.ok) throw providerFailure('linkedin', res, await readBody(res), 'LinkedIn post');
        const urn = res.headers.get('x-restli-id') || res.headers.get('x-linkedin-id');
        if (!urn) throw new PublishError('PROVIDER_ERROR', 'LinkedIn accepted the post but returned no id.', { platform: 'linkedin' });

        let warning: string | undefined;
        if (input.firstComment?.trim()) {
            try {
                const c = await providerFetch('linkedin', `${REST}/socialActions/${encodeURIComponent(urn)}/comments`, {
                    method: 'POST',
                    headers: headers(token),
                    body: JSON.stringify({ actor: author, object: urn, message: { text: input.firstComment } }),
                });
                await expectOk('linkedin', c, 'LinkedIn first comment');
            } catch (e: any) {
                warning = `Posted, but the first comment failed: ${e.message}`;
            }
        }
        return { externalId: urn, url: `https://www.linkedin.com/feed/update/${urn}`, state: 'published', warning };
    }
}

export interface LinkedInPublishParams {
    accessToken: string;
    authorUrn: string;
    commentary: string;
    videoUrl?: string;
    imageUrl?: string;
    title?: string;
}

export class LinkedInAdapter {
    static async publishPost(params: LinkedInPublishParams): Promise<{ activityUrn: string; liveUrl: string }> {
        const { accessToken, authorUrn, commentary, videoUrl, imageUrl, title } = params;
        requireToken(accessToken, 'linkedin');
        if (!authorUrn) throw new PublishError('ACCOUNT_NOT_CONNECTED', 'The linkedin account id is missing; reconnect the account.', { platform: 'linkedin' as any });
        if (isSandboxToken(accessToken)) {
            const mockId = Math.floor(Math.random() * 10000000000);
            return {
                activityUrn: `urn:li:activity:${mockId}`,
                liveUrl: `https://www.linkedin.com/feed/update/urn:li:activity:${mockId}`,
            };
        }
        const pub = new LinkedInPublisher();
        const outcome = await pub.publish({
            platform: 'linkedin',
            postId: 'legacy',
            variantId: 'legacy',
            account: { id: 'legacy', platformAccountId: authorUrn, accountName: 'Legacy', metadata: {} },
            format: videoUrl ? 'video' : imageUrl ? 'image' : 'text',
            caption: commentary,
            title,
            media: videoUrl ? [{ kind: 'video', url: videoUrl }] : imageUrl ? [{ kind: 'image', url: imageUrl }] : [],
            platformMeta: {},
        }, accessToken);
        return { activityUrn: outcome.externalId, liveUrl: outcome.url };
    }

    static async replyToComment(targetUrn: string, actorUrn: string, text: string, accessToken: string): Promise<{ commentUrn: string }> {
        requireToken(accessToken, 'linkedin');
        if (isSandboxToken(accessToken)) {
            return { commentUrn: `urn:li:comment:sim_${Date.now()}` };
        }
        const author = actorUrn.startsWith('urn:li:') ? actorUrn : `urn:li:organization:${actorUrn}`;
        const res = await providerFetch('linkedin', `${REST}/socialActions/${encodeURIComponent(targetUrn)}/comments`, {
            method: 'POST',
            headers: headers(accessToken),
            body: JSON.stringify({
                actor: author,
                object: targetUrn,
                message: { text },
            }),
        });
        const data = await expectOk('linkedin', res, 'LinkedIn comment reply');
        const urn = res.headers.get('x-restli-id') || data?.id || targetUrn;
        return { commentUrn: urn };
    }

    static async likeComment(targetUrn: string, actorUrn: string, accessToken: string): Promise<boolean> {
        requireToken(accessToken, 'linkedin');
        if (isSandboxToken(accessToken)) {
            return true;
        }
        const author = actorUrn.startsWith('urn:li:') ? actorUrn : `urn:li:organization:${actorUrn}`;
        const res = await providerFetch('linkedin', `${REST}/socialActions/${encodeURIComponent(targetUrn)}/reactions`, {
            method: 'POST',
            headers: headers(accessToken),
            body: JSON.stringify({
                actor: author,
                root: targetUrn,
                reactionType: 'LIKE',
            }),
        });
        await expectOk('linkedin', res, 'linkedin like');
        return true;
    }

    static async fetchComments(targetUrn: string, accessToken: string, limit = 20): Promise<any[]> {
        requireToken(accessToken, 'linkedin');
        if (isSandboxToken(accessToken)) {
            return [{ id: 'sim_comm_1', message: { text: 'Great update!' }, actor: 'urn:li:person:sim1' }];
        }
        const res = await providerFetch('linkedin', `${REST}/socialActions/${encodeURIComponent(targetUrn)}/comments?count=${limit}`, {
            headers: headers(accessToken),
        });
        if (res.status === 404) {
            return [];
        }
        const data = await expectOk('linkedin', res, 'LinkedIn fetch comments');
        return data.elements || [];
    }

    static async fetchPosts(authorUrn: string, accessToken: string, limit = 15): Promise<any[]> {
        requireToken(accessToken, 'linkedin');
        if (isSandboxToken(accessToken)) {
            return [{ id: 'urn:li:share:sim1', urn: 'urn:li:share:sim1', commentary: 'Welcome to our brand update' }];
        }
        try {
            const author = authorUrn.startsWith('urn:li:') ? authorUrn : `urn:li:organization:${authorUrn}`;
            const res = await providerFetch('linkedin', `${REST}/posts?author=${encodeURIComponent(author)}&count=${limit}`, {
                headers: headers(accessToken),
            });
            if (res.status === 404) return [];
            const data = await expectOk('linkedin', res, 'LinkedIn fetch posts');
            return data.elements || [];
        } catch {
            return [];
        }
    }

    static async getAnalytics(accountUrn: string, accessToken: string): Promise<any> {
        requireToken(accessToken, 'linkedin');
        if (isSandboxToken(accessToken)) {
            return { impressions: 14820, clicks: 680, likes: 412, comments: 89, shares: 47 };
        }
        const res = await providerFetch('linkedin', `${REST}/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=${encodeURIComponent(accountUrn)}`, {
            headers: headers(accessToken),
        });
        return await expectOk('linkedin', res, 'LinkedIn analytics');
    }
}

