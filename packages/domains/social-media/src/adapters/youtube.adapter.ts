/**
 * YouTube publisher (Data API v3, resumable upload protocol).
 * 1. POST upload/youtube/v3/videos?uploadType=resumable (metadata) → Location session URL
 * 2. PUT the bytes in chunks with Content-Range; 308 = keep going, 200/201 = done (body is the video resource)
 * Shorts: vertical/square video up to 3 minutes; `#shorts` is added to the title/description when isShort.
 * Docs: developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
 * Verified 2026-09-27 against developers.google.com/youtube/v3/docs/videos/insert: 1 unit in the "Video Uploads"
 * quota bucket (≈100 uploads/day by default), ≤ 256 GB, video/* or application/octet-stream; videos uploaded by an
 * UNVERIFIED API project created after 2020-07-28 are forced to private (surfaced as a warning below).
 * Shorts (support.google.com/youtube/answer/15424877): square or vertical, ≤ 3 minutes.
 */
import { intEnv } from '../publishing/config';
import { PublishError } from '../publishing/errors';
import { isSandboxToken, requireToken } from "./engagement-token";
import { asBody, downloadMedia, expectOk, providerFailure, providerFetch, readBody } from '../publishing/http';
import { PlatformPublisher, PublishInput, PublishOutcome, charLength, checkUrls, checkVideo, isVertical } from './types';

const UPLOAD_BASE = 'https://www.googleapis.com/upload/youtube/v3/videos';

/** Google error reasons → typed errors with an actionable message (quota vs. rate limit vs. account problems). */
export function youtubeFailure(res: { status: number }, body: any, what: string): PublishError {
    const reasons: string[] = (body?.error?.errors || []).map((e: any) => String(e?.reason || ''));
    const has = (r: string) => reasons.includes(r);
    if (has('quotaExceeded') || has('dailyLimitExceeded')) {
        return new PublishError('PROVIDER_ERROR', `${what}: the YouTube Data API daily quota is used up (resets at midnight Pacific). Request a quota increase in Google Cloud Console.`, { platform: 'youtube', retryable: false, details: { httpStatus: res.status, reasons } });
    }
    if (has('uploadLimitExceeded')) {
        return new PublishError('PROVIDER_ERROR', `${what}: this channel reached YouTube's upload limit for now; try again later.`, { platform: 'youtube', retryable: false, details: { httpStatus: res.status, reasons } });
    }
    if (has('rateLimitExceeded') || has('userRateLimitExceeded')) {
        return new PublishError('PROVIDER_ERROR', `${what}: YouTube rate limit; retrying.`, { platform: 'youtube', retryable: true, details: { httpStatus: res.status, reasons } });
    }
    if (has('youtubeSignupRequired')) {
        return new PublishError('REAUTH_REQUIRED', `${what}: the Google account has no YouTube channel yet; create one and reconnect.`, { platform: 'youtube' });
    }
    return providerFailure('youtube', res, body, what);
}

export class YouTubePublisher implements PlatformPublisher {
    readonly platform = 'youtube' as const;

    isShort(input: PublishInput): boolean {
        if (input.platformMeta.isShort != null) return Boolean(input.platformMeta.isShort);
        const v = input.media.find((m) => m.kind === 'video');
        return isVertical(v) && (v?.durationSec == null || v.durationSec <= 180);
    }

    buildMetadata(input: PublishInput) {
        const short = this.isShort(input);
        let title = (input.title || input.platformMeta.title || input.caption.split('\n')[0] || 'Untitled').trim();
        let description = input.caption || '';
        if (short && !/#shorts\b/i.test(title) && !/#shorts\b/i.test(description)) {
            if (charLength(title) + 8 <= 100) title = `${title} #shorts`;
            else description = `${description}\n\n#shorts`.trim();
        }
        return {
            snippet: {
                title: Array.from(title).slice(0, 100).join(''),
                description,
                tags: Array.isArray(input.platformMeta.tags) ? input.platformMeta.tags : undefined,
                categoryId: String(input.platformMeta.categoryId || '22'),
            },
            status: {
                // A scheduled publish (publishAt) requires privacyStatus=private; YouTube flips it public at that time.
                privacyStatus: input.platformMeta.publishAt ? 'private' : input.platformMeta.privacyStatus || 'public',
                selfDeclaredMadeForKids: Boolean(input.platformMeta.madeForKids),
                embeddable: true,
                ...(input.platformMeta.publishAt ? { publishAt: new Date(input.platformMeta.publishAt).toISOString() } : {}),
                ...(input.platformMeta.containsSyntheticMedia != null ? { containsSyntheticMedia: Boolean(input.platformMeta.containsSyntheticMedia) } : {}),
            },
        };
    }

    validate(input: PublishInput): string[] {
        const issues: string[] = [];
        checkUrls(input, issues);
        const v = input.media.find((m) => m.kind === 'video');
        if (input.format !== 'video' || !v) issues.push('YouTube needs a video.');
        const rawTitle = String(input.title || input.platformMeta.title || input.caption.split('\n')[0] || '').trim();
        if (!rawTitle) issues.push('YouTube videos need a title (add a title or a first caption line).');
        else if (charLength(rawTitle) > 100) issues.push('YouTube titles are limited to 100 characters.');
        const meta = this.buildMetadata(input);
        if (/[<>]/.test(meta.snippet.title)) issues.push('YouTube titles cannot contain < or >.');
        if (Buffer.byteLength(meta.snippet.description, 'utf8') > 5000) issues.push('YouTube descriptions are limited to 5,000 bytes.');
        if (/[<>]/.test(meta.snippet.description)) issues.push('YouTube descriptions cannot contain < or >.');
        const tagChars = (meta.snippet.tags || []).join(',').length;
        if (tagChars > 500) issues.push('YouTube tags are limited to 500 characters in total.');
        if (!['public', 'unlisted', 'private'].includes(meta.status.privacyStatus)) issues.push('YouTube privacyStatus must be public, unlisted or private.');
        if (input.platformMeta.isShort === true) checkVideo(v, { maxSec: 180, maxAspect: 1 }, 'YouTube Short', issues);
        if (input.platformMeta.publishAt != null) {
            const t = new Date(input.platformMeta.publishAt).getTime();
            if (!Number.isFinite(t)) issues.push('YouTube publishAt must be an ISO date-time.');
            else if (t <= Date.now()) issues.push('YouTube publishAt must be in the future.');
        }
        if (input.media.length > 1) issues.push('YouTube uploads one video per post.');
        return issues;
    }

    async publish(input: PublishInput, token: string): Promise<PublishOutcome> {
        const v = input.media.find((m) => m.kind === 'video')!;
        const media = await downloadMedia('youtube', v.url);
        const metadata = this.buildMetadata(input);

        const init = await providerFetch('youtube', `${UPLOAD_BASE}?uploadType=resumable&part=snippet,status`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json; charset=UTF-8',
                'X-Upload-Content-Type': media.contentType.startsWith('video/') ? media.contentType : 'video/mp4',
                'X-Upload-Content-Length': String(media.size),
            },
            body: JSON.stringify(metadata),
        });
        if (!init.ok) throw youtubeFailure(init, await readBody(init), 'YouTube upload session');
        const sessionUrl = init.headers.get('location');
        if (!sessionUrl) throw new PublishError('PROVIDER_ERROR', 'YouTube did not return an upload session URL.', { retryable: true, platform: 'youtube' });

        // Chunk size must be a multiple of 256 KiB (except the last chunk).
        const unit = 256 * 1024;
        const chunk = Math.max(unit, Math.floor(intEnv('YOUTUBE_UPLOAD_CHUNK_BYTES', 8 * 1024 * 1024) / unit) * unit);
        let offset = 0;
        let video: any = null;
        while (offset < media.size) {
            const end = Math.min(offset + chunk, media.size);
            const res = await providerFetch('youtube', sessionUrl, {
                method: 'PUT',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Length': String(end - offset),
                    'Content-Range': `bytes ${offset}-${end - 1}/${media.size}`,
                },
                body: asBody(media.bytes.subarray(offset, end)),
            });
            if (res.status === 308) {
                const range = res.headers.get('range');
                offset = range ? Number(range.split('-')[1]) + 1 : end;
                continue;
            }
            if (res.status === 200 || res.status === 201) {
                video = await readBody(res);
                break;
            }
            throw youtubeFailure(res, await readBody(res), 'YouTube upload');
        }
        if (!video?.id) throw new PublishError('PROVIDER_ERROR', 'YouTube upload finished without a video id.', { platform: 'youtube' });

        const short = this.isShort(input);
        let warning: string | undefined;
        const requested = metadata.status.privacyStatus;
        const actual = video.status?.privacyStatus;
        if (actual && actual !== requested && !metadata.status.publishAt) {
            // Unverified Google Cloud projects (created after 2020-07-28) have every API upload locked to private.
            warning = `YouTube saved the video as "${actual}" instead of "${requested}". The Google Cloud project is probably not verified for the YouTube Data API (complete the API audit to publish publicly).`;
        }
        if (input.thumbnailUrl && input.platformMeta.uploadThumbnail !== false) {
            try {
                const thumb = await downloadMedia('youtube', input.thumbnailUrl, 2 * 1024 * 1024);
                const tr = await providerFetch('youtube', `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(video.id)}`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${token}`, 'Content-Type': thumb.contentType },
                    body: asBody(thumb.bytes),
                });
                await expectOk('youtube', tr, 'YouTube thumbnail');
            } catch (e: any) {
                const t = `Uploaded, but the custom thumbnail failed: ${e.message}`;
                warning = warning ? `${warning} ${t}` : t;
            }
        }
        return {
            externalId: String(video.id),
            url: short ? `https://www.youtube.com/shorts/${video.id}` : `https://www.youtube.com/watch?v=${video.id}`,
            state: 'published',
            meta: { isShort: short, privacyStatus: actual, requestedPrivacyStatus: requested, publishAt: metadata.status.publishAt },
            warning,
        };
    }
}

export interface YouTubePublishParams {
    accessToken: string;
    videoUrl?: string;
    title: string;
    description: string;
    tags?: string[];
    privacyStatus?: 'public' | 'unlisted' | 'private';
    isShort?: boolean;
}

export class YouTubeAdapter {
    static async publishVideo(params: YouTubePublishParams): Promise<{ videoId: string; liveUrl: string }> {
        const { accessToken, title, description, tags = [], privacyStatus = 'public', isShort = false, videoUrl } = params;
        requireToken(accessToken, 'youtube');
        if (isSandboxToken(accessToken)) {
            const mockId = Math.random().toString(36).substring(2, 13);
            return {
                videoId: mockId,
                liveUrl: isShort ? `https://youtube.com/shorts/${mockId}` : `https://youtu.be/${mockId}`,
            };
        }
        const pub = new YouTubePublisher();
        const outcome = await pub.publish({
            platform: 'youtube',
            postId: 'legacy',
            variantId: 'legacy',
            account: { id: 'legacy', platformAccountId: 'legacy', accountName: 'Legacy', metadata: {} },
            format: 'video',
            caption: description,
            title,
            media: videoUrl ? [{ kind: 'video', url: videoUrl }] : [],
            platformMeta: { isShort, privacyStatus, tags },
        }, accessToken);
        return { videoId: outcome.externalId, liveUrl: outcome.url };
    }

    static async replyToComment(commentId: string, text: string, accessToken: string): Promise<{ commentId: string }> {
        requireToken(accessToken, 'youtube');
        if (isSandboxToken(accessToken)) {
            return { commentId: `yt_reply_${Date.now()}` };
        }
        requireToken(accessToken, "youtube");
        const res = await providerFetch('youtube', 'https://www.googleapis.com/youtube/v3/comments?part=snippet', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json; charset=UTF-8',
            },
            body: JSON.stringify({
                snippet: {
                    parentId: commentId,
                    textOriginal: text,
                },
            }),
        });
        const data = await expectOk('youtube', res, 'YouTube comment reply');
        return { commentId: data.id || `yt_reply_${Date.now()}` };
    }

    static async likeVideo(videoId: string, accessToken: string): Promise<boolean> {
        requireToken(accessToken, 'youtube');
        if (isSandboxToken(accessToken)) {
            return true;
        }
        requireToken(accessToken, "youtube");
        const res = await providerFetch('youtube', `https://www.googleapis.com/youtube/v3/videos/rate?id=${encodeURIComponent(videoId)}&rating=like`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        await expectOk('youtube', res, 'youtube like');
        return true;
    }

    static async fetchComments(videoId: string, accessToken: string, maxResults = 50): Promise<any[]> {
        requireToken(accessToken, 'youtube');
        if (isSandboxToken(accessToken)) {
            return [{ id: 'yt_comm_mock', snippet: { topLevelComment: { snippet: { textDisplay: 'Mock comment' } } } }];
        }
        requireToken(accessToken, "youtube");
        const res = await providerFetch('youtube', `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet,replies&videoId=${encodeURIComponent(videoId)}&maxResults=${maxResults}`, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        const data = await expectOk('youtube', res, 'YouTube comment fetch');
        return data.items || [];
    }

    static async fetchChannelVideos(channelId: string, accessToken: string, maxResults = 15): Promise<any[]> {
        requireToken(accessToken, 'youtube');
        if (isSandboxToken(accessToken)) {
            return [{ id: { videoId: 'mock_vid_1' }, snippet: { title: 'Mock Video' } }];
        }
        try {
            const res = await providerFetch('youtube', `https://www.googleapis.com/youtube/v3/search?part=id,snippet&channelId=${encodeURIComponent(channelId)}&order=date&type=video&maxResults=${maxResults}`, {
                headers: { Authorization: `Bearer ${accessToken}` },
            });
            const data = await expectOk('youtube', res, 'YouTube search channel videos');
            return data.items || [];
        } catch {
            return [];
        }
    }

    static async getAnalytics(channelId: string, startDate: string, endDate: string, accessToken: string): Promise<any> {
        requireToken(accessToken, 'youtube');
        if (isSandboxToken(accessToken)) {
            return { views: 1250, likes: 340, comments: 42, estimatedMinutesWatched: 4500 };
        }
        requireToken(accessToken, "youtube");
        const url = `https://youtubeanalytics.googleapis.com/v1/reports?ids=channel==${encodeURIComponent(channelId)}&startDate=${startDate}&endDate=${endDate}&metrics=views,likes,comments,estimatedMinutesWatched`;
        const res = await providerFetch('youtube', url, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        return await expectOk('youtube', res, 'YouTube analytics report');
    }

    static async uploadCaption(videoId: string, language: string, name: string, captionBytes: Uint8Array, accessToken: string): Promise<any> {
        requireToken(accessToken, 'youtube');
        if (isSandboxToken(accessToken)) {
            return { id: 'mock_caption_id' };
        }
        const meta = { snippet: { videoId, language, name } };
        const res = await providerFetch('youtube', `https://www.googleapis.com/upload/youtube/v3/captions?part=snippet`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(meta),
        });
        return await expectOk('youtube', res, 'YouTube caption upload');
    }
}


