import { AUTOPILOT_PLATFORMS, AutopilotPlatform, ContentFormat } from './schemas';

export interface PlatformRules {
    /** Max characters for the caption including appended hashtags. */
    maxCaptionChars: number;
    maxHashtags: number;
    formats: ContentFormat[];
}

/**
 * Conservative limits. Instagram and TikTok allow more text than we use, but hashtags beyond ~5 hurt reach
 * and Instagram caps posts at 5 hashtags. X counts hashtags inside the 280 characters.
 */
export const PLATFORM_RULES: Record<AutopilotPlatform, PlatformRules> = {
    instagram: { maxCaptionChars: 2200, maxHashtags: 5, formats: ['reel', 'carousel', 'static'] },
    facebook: { maxCaptionChars: 5000, maxHashtags: 3, formats: ['reel', 'carousel', 'static', 'text'] },
    tiktok: { maxCaptionChars: 2200, maxHashtags: 5, formats: ['reel', 'carousel'] },
    youtube: { maxCaptionChars: 5000, maxHashtags: 3, formats: ['reel'] },
    linkedin: { maxCaptionChars: 3000, maxHashtags: 5, formats: ['reel', 'carousel', 'static', 'text'] },
    x: { maxCaptionChars: 280, maxHashtags: 2, formats: ['reel', 'static', 'text'] },
};

const ALIASES: Record<string, AutopilotPlatform> = {
    instagram: 'instagram', ig: 'instagram', instagram_reels: 'instagram',
    facebook: 'facebook', fb: 'facebook', meta: 'facebook',
    tiktok: 'tiktok',
    youtube: 'youtube', youtube_shorts: 'youtube', shorts: 'youtube', yt: 'youtube',
    linkedin: 'linkedin',
    x: 'x', twitter: 'x',
    threads: 'facebook',
};

/** Maps free-form platform names ("YouTube Shorts", "Twitter") to autopilot platform ids. Unknown names are dropped. */
export function normalizePlatforms(input: unknown): AutopilotPlatform[] {
    const list = Array.isArray(input) ? input : [];
    const out: AutopilotPlatform[] = [];
    for (const raw of list) {
        const key = String(raw || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
        const p = ALIASES[key] || (AUTOPILOT_PLATFORMS as readonly string[]).find((x) => x === key) as AutopilotPlatform | undefined;
        if (p && !out.includes(p)) out.push(p);
    }
    return out;
}

/** Joins caption and hashtags the way it will be published. */
export function composeCaption(caption: string, hashtags: string[]): string {
    return hashtags.length ? `${caption.trim()}\n\n${hashtags.join(' ')}` : caption.trim();
}
