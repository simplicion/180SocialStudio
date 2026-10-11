/**
 * Meta publishers: Instagram (Graph API content publishing via media containers) and Facebook Pages.
 * Tokens: the stored token is the Page access token (derived from a long-lived user token, so it does not expire);
 * Instagram professional accounts publish with the token of the Page they are linked to.
 * Verified 2026-09-27 against:
 *   developers.facebook.com/docs/instagram-platform/content-publishing (containers, 100 posts / 24h, JPEG only,
 *     carousel ≤ 10, status EXPIRED|ERROR|FINISHED|IN_PROGRESS|PUBLISHED, containers expire after 24h)
 *   developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media (Reels 3s–15min,
 *     ≤ 300 MB; Stories video 3–60s ≤ 100 MB; image ≤ 8 MB, aspect 4:5–1.91:1, alt_text ≤ 1000)
 *   developers.facebook.com/docs/pages-api/posts, /docs/video-api/guides/reels-publishing (Reels 3–90s, 9:16)
 */
import { META_GRAPH_VERSION, intEnv, metaGraphUrl, isInstagramUserToken } from '../publishing/config';
import { PublishError } from '../publishing/errors';
import { isSandboxToken, requireToken } from "./engagement-token";
import { pollUntil, providerFailure, providerFetch, readBody, timing } from '../publishing/http';
import { PlatformPublisher, PublishInput, PublishOutcome, charLength, checkAspect, checkUrls, checkVideo } from './types';

const graph = (path: string, token?: string, platform?: string) => metaGraphUrl(path, token, platform);

/**
 * Meta error codes that mean "slow down / try later" rather than "this request is wrong":
 * 4/17/32/613 = app/user/page rate limits, 80001/80002 = Page/Instagram business-use-case throttling,
 * 9007 / subcode 2207027 = media not ready yet, subcode 2207042 = the 100-posts-per-24h publishing limit.
 */
const META_RETRYABLE_CODES = new Set([4, 17, 32, 613, 80001, 80002, 9007]);
const META_RETRYABLE_SUBCODES = new Set([2207027, 2207042, 2207001, 2207003]);

export function metaFailure(platform: string, res: { status: number }, body: any, what: string): PublishError {
    const base = providerFailure(platform, res, body, what);
    const code = Number(body?.error?.code);
    const sub = Number(body?.error?.error_subcode);
    if (base.code === 'PROVIDER_ERROR' && (META_RETRYABLE_CODES.has(code) || META_RETRYABLE_SUBCODES.has(sub))) {
        return new PublishError('PROVIDER_ERROR', base.message, { retryable: true, platform, details: { ...(base.details || {}), metaCode: code, metaSubcode: sub || undefined } });
    }
    if (base.code === 'PROVIDER_ERROR' && (code || sub)) {
        return new PublishError('PROVIDER_ERROR', base.message, { retryable: base.retryable, platform, details: { ...(base.details || {}), metaCode: code || undefined, metaSubcode: sub || undefined } });
    }
    return base;
}

async function metaOk(platform: string, res: Response, what: string) {
    const body = await readBody(res);
    if (!res.ok || (body?.error && typeof body.error === 'object')) throw metaFailure(platform, res, body, what);
    return body;
}

async function graphPost(platform: string, path: string, token: string, body: Record<string, any>, what: string) {
    const res = await providerFetch(platform, graph(path, token, platform), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    return metaOk(platform, res, what);
}

async function graphGet(platform: string, path: string, token: string, what: string) {
    const res = await providerFetch(platform, graph(path, token, platform), { method: 'GET', headers: { Authorization: `Bearer ${token}` } });
    return metaOk(platform, res, what);
}

// ── Instagram ────────────────────────────────────────────────────────────────

const IG_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const IG_REEL_MAX_BYTES = 300 * 1024 * 1024;
const IG_STORY_VIDEO_MAX_BYTES = 100 * 1024 * 1024;
/** Container ids of posts still processing are stored as `container:<id>` until checkStatus publishes them. */
const CONTAINER_PREFIX = 'container:';

export const isInstagramStory = (input: PublishInput) => {
    const f = String(input.platformMeta.instagramFormat || input.platformMeta.format || '').toLowerCase();
    return f === 'story' || f === 'stories';
};

type ContainerState = 'ready' | 'processing';

export class InstagramPublisher implements PlatformPublisher {
    readonly platform = 'instagram' as const;

    validate(input: PublishInput): string[] {
        const issues: string[] = [];
        const story = isInstagramStory(input);
        if (charLength(input.caption) > 2200) issues.push('Instagram captions are limited to 2,200 characters.');
        if ((input.caption.match(/#[\p{L}\p{N}_]+/gu) || []).length > 30) issues.push('Instagram allows at most 30 hashtags.');
        if ((input.caption.match(/@[\w.]+/g) || []).length > 20) issues.push('Instagram allows at most 20 @mentions.');
        if (input.firstComment && charLength(input.firstComment) > 2200) issues.push('Instagram first comment is limited to 2,200 characters.');
        if (story && input.firstComment?.trim()) issues.push('Instagram Stories cannot have a first comment.');
        checkUrls(input, issues);
        const jpegOnly = (m: { url: string; mimeType?: string }, label: string) => {
            if (/\.(png|gif|webp|heic)(\?|$)/i.test(m.url) || (m.mimeType && m.mimeType !== 'image/jpeg')) issues.push(`${label}: Instagram only accepts JPEG images.`);
        };
        switch (input.format) {
            case 'video': {
                const v = input.media.find((m) => m.kind === 'video');
                if (!v) issues.push(story ? 'Instagram video Stories need a video.' : 'Instagram Reels need a video.');
                if (story) checkVideo(v, { minSec: 3, maxSec: 60, maxBytes: IG_STORY_VIDEO_MAX_BYTES, minAspect: 0.1, maxAspect: 10 }, 'Instagram Story video', issues);
                else checkVideo(v, { minSec: 3, maxSec: 900, maxBytes: IG_REEL_MAX_BYTES, minAspect: 0.01, maxAspect: 10 }, 'Instagram Reel', issues);
                break;
            }
            case 'image': {
                const img = input.media.find((m) => m.kind === 'image');
                if (!img) issues.push('Instagram image posts need an image.');
                else {
                    if (!story) checkAspect(img, { minAspect: 0.8, maxAspect: 1.91 }, 'Instagram image', issues);
                    if (img.sizeBytes && img.sizeBytes > IG_IMAGE_MAX_BYTES) issues.push('Instagram images must be at most 8 MB.');
                    jpegOnly(img, 'Instagram image');
                    if (img.altText && charLength(img.altText) > 1000) issues.push('Instagram alt text is limited to 1,000 characters.');
                }
                break;
            }
            case 'carousel': {
                if (story) issues.push('Instagram Stories are a single image or video, not a carousel.');
                const items = input.media.filter((m) => m.kind !== 'document');
                if (items.length < 2 || items.length > 10) issues.push('Instagram carousels need 2 to 10 images or videos.');
                items.filter((m) => m.kind === 'video').forEach((m, i) => checkVideo(m, { minSec: 3, maxSec: 60 }, `Carousel video ${i + 1}`, issues));
                items.filter((m) => m.kind === 'image').forEach((m, i) => {
                    checkAspect(m, { minAspect: 0.8, maxAspect: 1.91 }, `Carousel image ${i + 1}`, issues);
                    if (m.sizeBytes && m.sizeBytes > IG_IMAGE_MAX_BYTES) issues.push(`Carousel image ${i + 1} must be at most 8 MB.`);
                    jpegOnly(m, `Carousel image ${i + 1}`);
                });
                break;
            }
            default:
                issues.push(`Instagram cannot publish ${input.format} posts (use a Reel, Story, image or carousel).`);
        }
        return issues;
    }

    /** One status read of a container: ready / processing, or throws on ERROR / EXPIRED. */
    private async containerState(id: string, token: string): Promise<ContainerState> {
        const s = await graphGet('instagram', `${id}?fields=status_code,status`, token, 'Instagram container status');
        if (s.status_code === 'FINISHED' || s.status_code === 'PUBLISHED') return 'ready';
        if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') {
            throw new PublishError('PROVIDER_ERROR', `Instagram could not process the media (${s.status_code}): ${s.status || 'no details'}`, { platform: 'instagram', details: { containerId: id, statusCode: s.status_code } });
        }
        return 'processing';
    }

    /** Polls a container; resolves 'processing' (instead of failing) when it is still IN_PROGRESS after the budget. */
    private async waitForContainer(id: string, token: string): Promise<ContainerState> {
        try {
            return await pollUntil(
                async () => ((await this.containerState(id, token)) === 'ready' ? ('ready' as const) : undefined),
                {
                    attempts: intEnv('IG_CONTAINER_POLL_ATTEMPTS', 60),
                    intervalMs: intEnv('IG_CONTAINER_POLL_MS', 5000),
                    onTimeout: () => new PublishError('PROVIDER_TIMEOUT', 'still processing', { retryable: true, platform: 'instagram' }),
                },
            );
        } catch (e: any) {
            if (e instanceof PublishError && e.code === 'PROVIDER_TIMEOUT' && e.message === 'still processing') return 'processing';
            throw e;
        }
    }

    /** Builds the container(s) and returns the id to publish. */
    private async createContainer(input: PublishInput, token: string): Promise<string> {
        const ig = input.account.platformAccountId;
        if (isInstagramStory(input)) {
            const m = input.media.find((x) => x.kind === (input.format === 'video' ? 'video' : 'image'))!;
            const body = m.kind === 'video' ? { media_type: 'STORIES', video_url: m.url } : { media_type: 'STORIES', image_url: m.url };
            return (await graphPost('instagram', `${ig}/media`, token, body, 'Instagram Story container')).id;
        }
        if (input.format === 'carousel') {
            const children: string[] = [];
            for (const m of input.media.filter((x) => x.kind !== 'document')) {
                const body: Record<string, any> =
                    m.kind === 'video' ? { media_type: 'VIDEO', video_url: m.url, is_carousel_item: true } : { image_url: m.url, is_carousel_item: true, ...(m.altText ? { alt_text: m.altText } : {}) };
                const c = await graphPost('instagram', `${ig}/media`, token, body, 'Instagram carousel item');
                children.push(c.id);
            }
            for (const c of children) {
                if ((await this.waitForContainer(c, token)) !== 'ready') {
                    throw new PublishError('PROVIDER_TIMEOUT', 'Instagram is still processing a carousel item; the post will be retried.', { retryable: true, platform: 'instagram' });
                }
            }
            const parent = await graphPost('instagram', `${ig}/media`, token, { media_type: 'CAROUSEL', children: children.join(','), caption: input.caption }, 'Instagram carousel container');
            return parent.id;
        }
        if (input.format === 'video') {
            const v = input.media.find((m) => m.kind === 'video')!;
            const body: Record<string, any> = {
                media_type: 'REELS',
                video_url: v.url,
                caption: input.caption,
                share_to_feed: input.platformMeta.shareToFeed !== false,
            };
            if (input.platformMeta.coverUrl || input.thumbnailUrl) body.cover_url = input.platformMeta.coverUrl || input.thumbnailUrl;
            if (input.platformMeta.thumbOffsetMs != null) body.thumb_offset = Number(input.platformMeta.thumbOffsetMs);
            if (input.platformMeta.audioName) body.audio_name = String(input.platformMeta.audioName);
            if (Array.isArray(input.platformMeta.collaborators) && input.platformMeta.collaborators.length) body.collaborators = input.platformMeta.collaborators.slice(0, 3);
            return (await graphPost('instagram', `${ig}/media`, token, body, 'Instagram Reel container')).id;
        }
        const img = input.media.find((m) => m.kind === 'image')!;
        const body: Record<string, any> = { image_url: img.url, caption: input.caption };
        if (img.altText) body.alt_text = img.altText;
        return (await graphPost('instagram', `${ig}/media`, token, body, 'Instagram image container')).id;
    }

    /** media_publish + permalink + optional first comment. */
    private async finish(input: PublishInput, creationId: string, token: string): Promise<PublishOutcome> {
        const ig = input.account.platformAccountId;
        const published = await graphPost('instagram', `${ig}/media_publish`, token, { creation_id: creationId }, 'Instagram publish');
        const mediaId = String(published.id);

        let url: string | null = null;
        try {
            const info = await graphGet('instagram', `${mediaId}?fields=permalink`, token, 'Instagram permalink');
            url = info.permalink || null;
        } catch {
            url = null;
        }

        let warning: string | undefined;
        if (input.firstComment?.trim() && !isInstagramStory(input)) {
            try {
                await graphPost('instagram', `${mediaId}/comments`, token, { message: input.firstComment }, 'Instagram first comment');
            } catch (e: any) {
                warning = `Posted, but the first comment failed: ${e.message}`;
            }
        }
        return { externalId: mediaId, url, state: 'published', meta: { creationId, story: isInstagramStory(input) || undefined }, warning };
    }

    async publish(input: PublishInput, token: string): Promise<PublishOutcome> {
        const creationId = await this.createContainer(input, token);
        const state = await this.waitForContainer(creationId, token);
        if (state === 'processing') {
            // Accepted but Instagram is still transcoding: report honestly; checkStatus publishes it once FINISHED
            // (containers expire after 24h, which is also the dispatcher's give-up window).
            return { externalId: `${CONTAINER_PREFIX}${creationId}`, url: null, state: 'processing', meta: { creationId } };
        }
        return this.finish(input, creationId, token);
    }

    async checkStatus(input: PublishInput, externalId: string, token: string): Promise<PublishOutcome | null> {
        if (!externalId.startsWith(CONTAINER_PREFIX)) return null;
        const creationId = externalId.slice(CONTAINER_PREFIX.length);
        if ((await this.containerState(creationId, token)) !== 'ready') return null;
        return this.finish(input, creationId, token);
    }

    /** Replies publicly to an Instagram comment */
    static async replyToComment(commentId: string, message: string, token: string): Promise<{ id: string }> {
        requireToken(token, "instagram");
        return graphPost('instagram', `${commentId}/replies`, token, { message }, 'Instagram reply to comment');
    }

    /** Comments publicly on an Instagram media (post / tagged media) */
    static async commentOnMedia(mediaId: string, message: string, token: string): Promise<{ id: string }> {
        requireToken(token, "instagram");
        return graphPost('instagram', `${mediaId}/comments`, token, { message }, 'Instagram comment on media');
    }

    /** Likes an Instagram comment */
    static async likeComment(commentId: string, token: string): Promise<{ success: boolean }> {
        requireToken(token, "instagram");
        return graphPost('instagram', `${commentId}/likes`, token, {}, 'Instagram like comment');
    }

    /**
     * Sends a private reply (Comment-to-DM) via Messenger API for Instagram.
     * Note: Must be executed within 7 days of the comment.
     */
    static async sendPrivateReply(pageOrAccountId: string, commentId: string, messageText: string, token: string): Promise<{ recipient_id: string; message_id: string }> {
        requireToken(token, "instagram");
        return graphPost(
            'instagram',
            `${pageOrAccountId}/messages`,
            token,
            {
                recipient: { comment_id: commentId },
                message: { text: messageText },
            },
            'Instagram private reply to comment'
        );
    }

    /**
     * Sends a direct message to an Instagram user (within active 24-hr messaging window).
     */
    static async sendDirectMessage(pageOrAccountId: string, recipientId: string, messageText: string, token: string): Promise<{ recipient_id: string; message_id: string }> {
        requireToken(token, "instagram");
        return graphPost(
            'instagram',
            `${pageOrAccountId}/messages`,
            token,
            {
                recipient: { id: recipientId },
                message: { text: messageText },
            },
            'Instagram direct message'
        );
    }
}

// ── Facebook Pages ───────────────────────────────────────────────────────────

/** Facebook video ids of Reels / videos still processing are stored as `fbvideo:<id>` until checkStatus confirms them. */
const FB_VIDEO_PREFIX = 'fbvideo:';

export class FacebookPublisher implements PlatformPublisher {
    readonly platform = 'facebook' as const;

    private isReel(input: PublishInput) {
        const f = String(input.platformMeta.facebookFormat || input.platformMeta.format || '').toLowerCase();
        return input.format === 'video' && (f === 'reel' || f === 'reels');
    }

    validate(input: PublishInput): string[] {
        const issues: string[] = [];
        if (charLength(input.caption) > 63206) issues.push('Facebook posts are limited to 63,206 characters.');
        checkUrls(input, issues);
        const link = input.platformMeta.link;
        if (link != null && !/^https?:\/\/\S+$/i.test(String(link))) issues.push('Facebook link must be a full http(s) URL.');
        if (link && input.format !== 'text') issues.push('Facebook link previews are only available on text posts (remove the media or the link).');
        switch (input.format) {
            case 'text':
                if (!input.caption.trim() && !link) issues.push('Facebook text posts need a message or a link.');
                break;
            case 'video': {
                const v = input.media.find((m) => m.kind === 'video');
                if (!v) issues.push('Facebook video posts need a video.');
                if (this.isReel(input)) checkVideo(v, { minSec: 3, maxSec: 90, minAspect: 0.5, maxAspect: 0.57 }, 'Facebook Reel', issues);
                else checkVideo(v, { maxSec: 4 * 3600, maxBytes: 1024 * 1024 * 1024 }, 'Facebook video', issues);
                break;
            }
            case 'image':
                if (!input.media.some((m) => m.kind === 'image')) issues.push('Facebook photo posts need an image.');
                input.media.forEach((m) => m.sizeBytes && m.sizeBytes > 10 * 1024 * 1024 && issues.push('Facebook photos must be at most 10 MB.'));
                break;
            case 'carousel': {
                const imgs = input.media.filter((m) => m.kind === 'image');
                if (imgs.length < 2 || imgs.length > 30) issues.push('Facebook multi-photo posts need 2 to 30 images.');
                if (input.media.some((m) => m.kind !== 'image')) issues.push('Facebook multi-photo posts can only contain images.');
                break;
            }
            default:
                issues.push(`Facebook cannot publish ${input.format} posts.`);
        }
        return issues;
    }

    /** Reads `status.video_status` of an uploaded Reel / video: ready | processing | error. */
    private async videoState(videoId: string, token: string): Promise<'ready' | 'processing'> {
        const s = await graphGet('facebook', `${videoId}?fields=status`, token, 'Facebook video status');
        const vs = String(s?.status?.video_status || '').toLowerCase();
        const processing = String(s?.status?.processing_phase?.status || '').toLowerCase();
        if (vs === 'error' || vs === 'expired' || processing === 'error') {
            const why = s?.status?.processing_phase?.errors?.[0]?.message || vs;
            throw new PublishError('PROVIDER_ERROR', `Facebook could not process the video: ${why}`, { platform: 'facebook', details: { videoId } });
        }
        return vs === 'ready' || vs === 'published' ? 'ready' : 'processing';
    }

    async publish(input: PublishInput, token: string): Promise<PublishOutcome> {
        const page = input.account.platformAccountId;
        let objectId: string;
        let url: string;
        let state: PublishOutcome['state'] = 'published';
        const meta: Record<string, any> = {};

        if (input.format === 'text') {
            const body: Record<string, any> = { message: input.caption };
            if (input.platformMeta.link) body.link = String(input.platformMeta.link);
            const r = await graphPost('facebook', `${page}/feed`, token, body, 'Facebook post');
            objectId = r.id;
            url = `https://www.facebook.com/${r.id}`;
        } else if (input.format === 'image') {
            const img = input.media.find((m) => m.kind === 'image')!;
            const r = await graphPost('facebook', `${page}/photos`, token, { url: img.url, message: input.caption, ...(img.altText ? { alt_text_custom: img.altText } : {}) }, 'Facebook photo');
            objectId = r.post_id || r.id;
            url = `https://www.facebook.com/${objectId}`;
        } else if (input.format === 'carousel') {
            const ids: string[] = [];
            for (const m of input.media.filter((x) => x.kind === 'image')) {
                const r = await graphPost('facebook', `${page}/photos`, token, { url: m.url, published: false }, 'Facebook photo upload');
                ids.push(r.id);
            }
            const r = await graphPost('facebook', `${page}/feed`, token, { message: input.caption, attached_media: ids.map((id) => ({ media_fbid: id })) }, 'Facebook multi-photo post');
            objectId = r.id;
            url = `https://www.facebook.com/${r.id}`;
            meta.photoIds = ids;
        } else if (this.isReel(input)) {
            const v = input.media.find((m) => m.kind === 'video')!;
            const start = await graphPost('facebook', `${page}/video_reels`, token, { upload_phase: 'start' }, 'Facebook Reel start');
            const videoId = String(start.video_id);
            const up = await providerFetch('facebook', `https://rupload.facebook.com/video-upload/${META_GRAPH_VERSION()}/${videoId}`, {
                method: 'POST',
                headers: { Authorization: `OAuth ${token}`, file_url: v.url },
            });
            await metaOk('facebook', up, 'Facebook Reel upload');
            const fin = await graphPost('facebook', `${page}/video_reels`, token, { upload_phase: 'finish', video_id: videoId, video_state: 'PUBLISHED', description: input.caption }, 'Facebook Reel publish');
            if (fin.success === false) throw new PublishError('PROVIDER_ERROR', 'Facebook did not accept the Reel.', { platform: 'facebook' });
            url = `https://www.facebook.com/reel/${videoId}`;
            // `finish` only queues the Reel; it goes live after processing. Poll briefly, then hand over to checkStatus.
            state = await this.pollVideo(videoId, token);
            objectId = state === 'processing' ? `${FB_VIDEO_PREFIX}${videoId}` : videoId;
            meta.videoId = videoId;
        } else {
            const v = input.media.find((m) => m.kind === 'video')!;
            const body: Record<string, any> = { file_url: v.url, description: input.caption };
            if (input.title) body.title = input.title.slice(0, 255);
            const r = await graphPost('facebook', `${page}/videos`, token, body, 'Facebook video');
            objectId = String(r.id);
            url = `https://www.facebook.com/${page}/videos/${objectId}`;
        }

        let warning: string | undefined;
        if (input.firstComment?.trim() && state === 'published') {
            try {
                await graphPost('facebook', `${objectId}/comments`, token, { message: input.firstComment }, 'Facebook first comment');
            } catch (e: any) {
                warning = `Posted, but the first comment failed: ${e.message}`;
            }
        }
        return { externalId: objectId, url: state === 'published' ? url : null, state, meta, warning };
    }

    private async pollVideo(videoId: string, token: string): Promise<'published' | 'processing'> {
        const attempts = intEnv('FB_VIDEO_POLL_ATTEMPTS', 12);
        for (let i = 0; i < attempts; i++) {
            if ((await this.videoState(videoId, token)) === 'ready') return 'published';
            await timing.sleep(intEnv('FB_VIDEO_POLL_MS', 5000));
        }
        return 'processing';
    }

    async checkStatus(_input: PublishInput, externalId: string, token: string): Promise<PublishOutcome | null> {
        if (!externalId.startsWith(FB_VIDEO_PREFIX)) return null;
        const videoId = externalId.slice(FB_VIDEO_PREFIX.length);
        if ((await this.videoState(videoId, token)) !== 'ready') return null;
        return { externalId: videoId, url: `https://www.facebook.com/reel/${videoId}`, state: 'published', meta: { videoId } };
    }
}

export interface InstagramPublishParams {
    accessToken: string;
    igUserId: string;
    caption: string;
    videoUrl?: string;
    imageUrl?: string;
    mediaType?: 'REELS' | 'IMAGE' | 'CAROUSEL';
    shareToFeed?: boolean;
}

export interface FacebookPublishParams {
    accessToken: string;
    pageId: string;
    message: string;
    videoUrl?: string;
    photoUrl?: string;
}

export class MetaAdapter {
    static async publishInstagramMedia(params: InstagramPublishParams): Promise<{ mediaId: string; liveUrl: string }> {
        const { accessToken, igUserId, caption, videoUrl, imageUrl, mediaType = 'REELS' } = params;
        requireToken(accessToken, 'meta');
        if (!igUserId) throw new PublishError('ACCOUNT_NOT_CONNECTED', 'The meta account id is missing; reconnect the account.', { platform: 'meta' as any });
        if (isSandboxToken(accessToken)) {
            const shortcode = Math.random().toString(36).substring(2, 9);
            return {
                mediaId: `mock_ig_${Date.now()}`,
                liveUrl: `https://www.instagram.com/reel/C_${shortcode}/`,
            };
        }
        const pub = new InstagramPublisher();
        const outcome = await pub.publish({
            platform: 'instagram',
            postId: 'legacy',
            variantId: 'legacy',
            account: { id: 'legacy', platformAccountId: igUserId, accountName: 'Legacy', metadata: {} },
            format: videoUrl || mediaType === 'REELS' ? 'video' : 'image',
            caption,
            media: videoUrl ? [{ kind: 'video', url: videoUrl }] : imageUrl ? [{ kind: 'image', url: imageUrl }] : [],
            platformMeta: { shareToFeed: params.shareToFeed ?? true },
        }, accessToken);
        return { mediaId: outcome.externalId, liveUrl: outcome.url };
    }

    static async publishFacebookPost(params: FacebookPublishParams): Promise<{ postId: string; liveUrl: string }> {
        const { accessToken, pageId, message, videoUrl, photoUrl } = params;
        requireToken(accessToken, 'meta');
        if (!pageId) throw new PublishError('ACCOUNT_NOT_CONNECTED', 'The meta account id is missing; reconnect the account.', { platform: 'meta' as any });
        if (isSandboxToken(accessToken)) {
            const mockPostId = `${pageId}_${Date.now()}`;
            return {
                postId: mockPostId,
                liveUrl: `https://www.facebook.com/${pageId}/posts/${mockPostId}`,
            };
        }
        const pub = new FacebookPublisher();
        const outcome = await pub.publish({
            platform: 'facebook',
            postId: 'legacy',
            variantId: 'legacy',
            account: { id: 'legacy', platformAccountId: pageId, accountName: 'Legacy', metadata: {} },
            format: videoUrl ? 'video' : photoUrl ? 'image' : 'text',
            caption: message,
            media: videoUrl ? [{ kind: 'video', url: videoUrl }] : photoUrl ? [{ kind: 'image', url: photoUrl }] : [],
            platformMeta: {},
        }, accessToken);
        return { postId: outcome.externalId, liveUrl: outcome.url };
    }
}

