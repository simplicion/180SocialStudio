/**
 * Per-platform craft rules: the Instagram skill set (hook window, feed fold, hashtag cap, one ask, no dead links)
 * re-derived for every network we publish to. Hard limits are the platforms' documented caps; "fold" values are
 * conservative mobile estimates (the point where the feed hides text behind "more"), so treat them as targets.
 *
 * These rules are shared by the deterministic linters, the autopilot prompts (so the writer agents follow them)
 * and the Platform Command Center API.
 */
export declare const CRAFT_PLATFORMS: readonly ["instagram", "linkedin", "youtube", "x", "facebook", "tiktok"];
export type CraftPlatform = (typeof CRAFT_PLATFORMS)[number];
export interface PlatformCraftSpec {
    platform: CraftPlatform;
    label: string;
    /** Hard cap on post text (caption/description/post body). */
    captionMaxChars: number;
    /** Characters visible in the mobile feed before the "more" fold (estimate). */
    foldChars: number;
    foldLabel: string;
    /** Hashtags beyond this either do nothing or hurt distribution. */
    hashtagMax: number;
    /** How a raw URL in the post body behaves. */
    links: 'dead' | 'penalized' | 'ok';
    linkAdvice: string;
    /** URLs count as this many characters (X's t.co wrapping); 0 = counted literally. */
    urlWeight: number;
    /** Max words in the opening line of a text post before it reads as preamble. */
    openingLineMaxWords: number;
    /** Short-form video: words-per-minute pace used for timing and the seconds the spoken hook gets. */
    video: {
        wpm: number;
        hookWindowSec: number;
        idealSec: [number, number];
        maxSec: number;
        aspect: string;
    };
    /** Carousel / document posts. */
    carousel?: {
        maxSlides: number;
        idealSlides: [number, number];
        size: string;
        note: string;
    };
    /** YouTube-style titles (only where the platform has one). */
    title?: {
        maxChars: number;
        visibleChars: number;
    };
    /** Rules handed to the writer agents verbatim. Keep them checkable, not vibes. */
    playbook: string[];
    /** Signals the platform rewards, used by the monitoring screen and the performance auditor. */
    rewardedSignals: string[];
}
export declare const PLATFORM_CRAFT: Record<CraftPlatform, PlatformCraftSpec>;
/** "Twitter" / "YouTube Shorts" / "fb" -> craft platform id, or null for unknown names. */
export declare function toCraftPlatform(input: unknown): CraftPlatform | null;
export declare function craftSpec(platform: CraftPlatform): PlatformCraftSpec;
/** Prompt block with the playbook for each platform, for the writer and critic agents. */
export declare function platformPlaybookPrompt(platforms: readonly string[]): string;
