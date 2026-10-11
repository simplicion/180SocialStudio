import type { PublishPlatform } from '../publishing/config';

export type PublishFormat = 'video' | 'image' | 'carousel' | 'document' | 'text';

export interface MediaItem {
    url: string;
    kind: 'video' | 'image' | 'document';
    mimeType?: string;
    width?: number;
    height?: number;
    durationSec?: number;
    sizeBytes?: number;
    altText?: string;
}

/** Everything a platform publisher needs for one variant. Built by the dispatcher; contains no token. */
export interface PublishInput {
    platform: PublishPlatform;
    postId: string;
    variantId: string;
    format: PublishFormat;
    caption: string;
    title?: string;
    firstComment?: string;
    media: MediaItem[];
    thumbnailUrl?: string;
    platformMeta: Record<string, any>;
    account: {
        id: string;
        platformAccountId: string;
        username?: string | null;
        accountName?: string | null;
        metadata: Record<string, any>;
    };
}

export interface PublishOutcome {
    externalId: string;
    url: string | null;
    /** `processing`: the provider accepted the post but has not made it public yet (TikTok). */
    state: 'published' | 'processing';
    meta?: Record<string, any>;
    /** Non-fatal problem after the post went live (e.g. first comment failed). */
    warning?: string;
}

export interface PlatformPublisher {
    readonly platform: PublishPlatform;
    /** Returns human-readable problems; empty = valid. Checks only what is known (metadata may be partial). */
    validate(input: PublishInput): string[];
    publish(input: PublishInput, accessToken: string): Promise<PublishOutcome>;
    /** For providers that finish asynchronously: re-check a `processing` post. */
    checkStatus?(input: PublishInput, externalId: string, accessToken: string): Promise<PublishOutcome | null>;
}

// ── shared validation helpers ─────────────────────────────────────────────────

export const charLength = (s: string) => Array.from(s || '').length;

export function checkUrls(input: PublishInput, issues: string[]) {
    for (const m of input.media) {
        if (!/^https:\/\//i.test(m.url) && !/^http:\/\//i.test(m.url)) {
            issues.push(`Media "${m.url}" must be a public http(s) URL the platform can fetch.`);
        }
    }
}

export function checkVideo(m: MediaItem | undefined, limits: { minSec?: number; maxSec?: number; maxBytes?: number; minAspect?: number; maxAspect?: number }, label: string, issues: string[]) {
    if (!m) return;
    if (m.durationSec != null) {
        if (limits.minSec != null && m.durationSec < limits.minSec) issues.push(`${label} must be at least ${limits.minSec}s (is ${m.durationSec}s).`);
        if (limits.maxSec != null && m.durationSec > limits.maxSec) issues.push(`${label} must be at most ${limits.maxSec}s (is ${m.durationSec}s).`);
    }
    if (m.sizeBytes != null && limits.maxBytes != null && m.sizeBytes > limits.maxBytes) {
        issues.push(`${label} must be at most ${Math.round(limits.maxBytes / 1024 / 1024)} MB.`);
    }
    checkAspect(m, limits, label, issues);
}

export function checkAspect(m: MediaItem, limits: { minAspect?: number; maxAspect?: number }, label: string, issues: string[]) {
    if (m.width && m.height) {
        const a = m.width / m.height;
        if (limits.minAspect != null && a < limits.minAspect - 0.01) issues.push(`${label} aspect ratio ${m.width}x${m.height} is too tall for this platform.`);
        if (limits.maxAspect != null && a > limits.maxAspect + 0.01) issues.push(`${label} aspect ratio ${m.width}x${m.height} is too wide for this platform.`);
    }
}

export const isVertical = (m?: MediaItem) => !m || !m.width || !m.height || m.height >= m.width;
