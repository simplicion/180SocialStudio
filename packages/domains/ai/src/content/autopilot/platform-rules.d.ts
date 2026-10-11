import { AutopilotPlatform, ContentFormat } from './schemas';
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
export declare const PLATFORM_RULES: Record<AutopilotPlatform, PlatformRules>;
/** Maps free-form platform names ("YouTube Shorts", "Twitter") to autopilot platform ids. Unknown names are dropped. */
export declare function normalizePlatforms(input: unknown): AutopilotPlatform[];
/** Joins caption and hashtags the way it will be published. */
export declare function composeCaption(caption: string, hashtags: string[]): string;
