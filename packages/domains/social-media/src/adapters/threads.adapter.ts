/**
 * Threads API publisher (Meta). Two-step container flow: POST /{user}/threads → (wait until FINISHED) →
 * POST /{user}/threads_publish.
 * Verified 2026-09-27 against developers.facebook.com/docs/threads/posts:
 *   media_type TEXT | IMAGE | VIDEO | CAROUSEL; text ≤ 500 chars; carousel 2–20 items (counts as one post);
 *   images JPEG/PNG ≤ 8 MB, aspect ≤ 10:1; video ≤ 5 min, ≤ 1 GB, aspect 0.01:1–10:1;
 *   Meta recommends waiting ~30s before publishing a media container; 250 published posts / 24h.
 *   Container status values: IN_PROGRESS | FINISHED | ERROR | EXPIRED | PUBLISHED (+ error_message).
 */
import { PublishError } from '../publishing/errors';
import { intEnv } from '../publishing/config';
import { requireToken } from "./engagement-token";
import { pollUntil, providerFetch, readBody } from '../publishing/http';
import { metaFailure } from './meta.adapter';
import { PlatformPublisher, PublishInput, PublishOutcome, charLength, checkAspect, checkUrls, checkVideo } from './types';

const threadsBase = 'https://graph.threads.net/v1.0';
const CONTAINER_PREFIX = 'container:';

async function threadsOk(res: Response, what: string) {
    const body = await readBody(res);
    if (!res.ok || (body?.error && typeof body.error === 'object')) throw metaFailure('threads', res, body, what);
    return body;
}

async function threadsPost(path: string, token: string, body: Record<string, any>, what: string) {
    const res = await providerFetch('threads', `${threadsBase}/${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    return threadsOk(res, what);
}

async function threadsGet(path: string, token: string, what: string) {
    const res = await providerFetch('threads', `${threadsBase}/${path}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
    });
    return threadsOk(res, what);
}

export class ThreadsPublisher implements PlatformPublisher {
    readonly platform = 'threads' as const;

    validate(input: PublishInput): string[] {
        const issues: string[] = [];
        if (charLength(input.caption) > 500) {
            issues.push('Threads posts are limited to 500 characters.');
        }
        if (input.firstComment && charLength(input.firstComment) > 500) issues.push('Threads reply (first comment) is limited to 500 characters.');
        checkUrls(input, issues);
        const checkImage = (m: { url: string; sizeBytes?: number; width?: number; height?: number }, label: string) => {
            if (m.sizeBytes && m.sizeBytes > 8 * 1024 * 1024) issues.push(`${label} must be at most 8 MB.`);
            if (/\.(gif|webp|heic)(\?|$)/i.test(m.url)) issues.push(`${label}: Threads accepts JPEG or PNG images only.`);
            checkAspect(m as any, { maxAspect: 10, minAspect: 0.1 }, label, issues);
        };

        switch (input.format) {
            case 'video': {
                const v = input.media.find((m) => m.kind === 'video');
                if (!v) issues.push('Threads video posts require a video URL.');
                checkVideo(v, { maxSec: 300, maxBytes: 1024 * 1024 * 1024, minAspect: 0.01, maxAspect: 10 }, 'Threads video', issues);
                break;
            }
            case 'image': {
                const img = input.media.find((m) => m.kind === 'image');
                if (!img) issues.push('Threads image posts require an image URL.');
                else checkImage(img, 'Threads image');
                break;
            }
            case 'carousel': {
                const items = input.media.filter((m) => m.kind !== 'document');
                if (items.length < 2 || items.length > 20) {
                    issues.push('Threads carousels need between 2 and 20 images or videos.');
                }
                items.forEach((m, i) => (m.kind === 'video' ? checkVideo(m, { maxSec: 300, maxBytes: 1024 * 1024 * 1024 }, `Carousel video ${i + 1}`, issues) : checkImage(m, `Carousel image ${i + 1}`)));
                break;
            }
            case 'text':
                if (!input.caption || !input.caption.trim()) {
                    issues.push('Threads text post cannot be empty.');
                }
                break;
            default:
                issues.push(`Threads cannot publish ${input.format} posts.`);
        }
        return issues;
    }

    /** ready | processing, or throws on ERROR / EXPIRED with Meta's error_message. */
    private async containerState(id: string, token: string): Promise<'ready' | 'processing'> {
        const s = await threadsGet(`${id}?fields=status,error_message`, token, 'check Threads container status');
        if (s.status === 'FINISHED' || s.status === 'PUBLISHED') return 'ready';
        if (s.status === 'ERROR' || s.status === 'EXPIRED') {
            throw new PublishError('PROVIDER_ERROR', `Threads could not process the media (${s.status}): ${s.error_message || 'no details'}`, { platform: 'threads', details: { containerId: id } });
        }
        return 'processing';
    }

    async publish(input: PublishInput, accessToken: string): Promise<PublishOutcome> {
        const userId = input.account.platformAccountId;
        if (!userId) {
            throw new PublishError('ACCOUNT_NOT_CONNECTED', 'Threads publishing requires a platform account ID (Threads user ID).', { platform: this.platform });
        }

        let containerId: string;

        if (input.format === 'video') {
            const v = input.media.find((m) => m.kind === 'video')!;
            const r = await threadsPost(`${userId}/threads`, accessToken, {
                media_type: 'VIDEO',
                video_url: v.url,
                text: input.caption,
            }, 'create Threads video container');
            containerId = r.id;
        } else if (input.format === 'image') {
            const img = input.media.find((m) => m.kind === 'image')!;
            const r = await threadsPost(`${userId}/threads`, accessToken, {
                media_type: 'IMAGE',
                image_url: img.url,
                text: input.caption,
                ...(img.altText ? { alt_text: img.altText } : {}),
            }, 'create Threads image container');
            containerId = r.id;
        } else if (input.format === 'carousel') {
            const children: string[] = [];
            for (const m of input.media.filter((i) => i.kind !== 'document')) {
                const body: Record<string, any> = { is_carousel_item: true };
                if (m.kind === 'video') {
                    body.media_type = 'VIDEO';
                    body.video_url = m.url;
                } else {
                    body.media_type = 'IMAGE';
                    body.image_url = m.url;
                    if (m.altText) body.alt_text = m.altText;
                }
                const cr = await threadsPost(`${userId}/threads`, accessToken, body, 'create Threads carousel item');
                children.push(cr.id);
            }
            for (const c of children) {
                const ready = await this.waitReady(c, accessToken);
                if (ready !== 'ready') throw new PublishError('PROVIDER_TIMEOUT', 'Threads is still processing a carousel item; the post will be retried.', { retryable: true, platform: 'threads' });
            }
            const r = await threadsPost(`${userId}/threads`, accessToken, {
                media_type: 'CAROUSEL',
                children: children.join(','),
                text: input.caption,
            }, 'create Threads carousel container');
            containerId = r.id;
        } else {
            const r = await threadsPost(`${userId}/threads`, accessToken, {
                media_type: 'TEXT',
                text: input.caption,
            }, 'create Threads text container');
            containerId = r.id;
        }

        // Media containers must be FINISHED before threads_publish (publishing an ERROR container used to be
        // attempted here; now it fails with Meta's error_message). Text containers are ready immediately.
        if (input.format !== 'text') {
            const state = await this.waitReady(containerId, accessToken);
            if (state === 'processing') {
                return { externalId: `${CONTAINER_PREFIX}${containerId}`, url: null, state: 'processing', meta: { containerId, threadsUserId: userId } };
            }
        }
        return this.finish(input, containerId, accessToken);
    }

    private async waitReady(id: string, token: string): Promise<'ready' | 'processing'> {
        try {
            return await pollUntil(async () => ((await this.containerState(id, token)) === 'ready' ? ('ready' as const) : undefined), {
                attempts: intEnv('THREADS_CONTAINER_POLL_ATTEMPTS', 30),
                intervalMs: intEnv('THREADS_CONTAINER_POLL_MS', 3_000),
                onTimeout: () => new PublishError('PROVIDER_TIMEOUT', 'still processing', { retryable: true, platform: 'threads' }),
            });
        } catch (e: any) {
            if (e instanceof PublishError && e.code === 'PROVIDER_TIMEOUT' && e.message === 'still processing') return 'processing';
            throw e;
        }
    }

    private async finish(input: PublishInput, containerId: string, accessToken: string): Promise<PublishOutcome> {
        const userId = input.account.platformAccountId;
        const pub = await threadsPost(`${userId}/threads_publish`, accessToken, { creation_id: containerId }, 'publish Threads container');
        const publishedId = String(pub.id || containerId);

        let url: string | null = null;
        try {
            const info = await threadsGet(`${publishedId}?fields=permalink`, accessToken, 'Threads permalink');
            url = info.permalink || null;
        } catch {
            url = null;
        }
        if (!url) url = `https://www.threads.net/@${input.account.username || 'user'}/post/${publishedId}`;

        let warning: string | undefined;
        if (input.firstComment?.trim()) {
            try {
                await ThreadsAdapter.replyToThread(userId, publishedId, input.firstComment, accessToken);
            } catch (e: any) {
                warning = `Posted, but the reply (first comment) failed: ${e.message}`;
            }
        }
        return { externalId: publishedId, url, state: 'published', meta: { containerId, threadsUserId: userId }, warning };
    }

    async checkStatus(input: PublishInput, externalId: string, token: string): Promise<PublishOutcome | null> {
        if (!externalId.startsWith(CONTAINER_PREFIX)) return null;
        const containerId = externalId.slice(CONTAINER_PREFIX.length);
        if ((await this.containerState(containerId, token)) !== 'ready') return null;
        return this.finish(input, containerId, token);
    }
}

export class ThreadsAdapter {
    static async replyToThread(userId: string, threadId: string, text: string, accessToken: string): Promise<{ replyId: string }> {
        requireToken(accessToken, "threads");
        const container = await threadsPost(`${userId}/threads`, accessToken, {
            media_type: 'TEXT',
            text,
            reply_to_id: threadId,
        }, 'create Threads reply container');

        const pub = await threadsPost(`${userId}/threads_publish`, accessToken, {
            creation_id: container.id,
        }, 'publish Threads reply');

        return { replyId: pub.id || container.id };
    }

    static async fetchThreads(userId: string, accessToken: string, limit = 20): Promise<any[]> {
        requireToken(accessToken, "threads");
        try {
            const res = await threadsGet(`${userId}/threads?fields=id,text,timestamp,permalink&limit=${limit}`, accessToken, 'fetch Threads');
            return Array.isArray(res?.data) ? res.data : [];
        } catch {
            return [];
        }
    }

    static async fetchReplies(threadId: string, accessToken: string, limit = 30): Promise<any[]> {
        requireToken(accessToken, "threads");
        try {
            const res = await threadsGet(`${threadId}/replies?fields=id,text,timestamp,username&limit=${limit}`, accessToken, 'fetch Threads replies');
            return Array.isArray(res?.data) ? res.data : [];
        } catch {
            return [];
        }
    }
}

