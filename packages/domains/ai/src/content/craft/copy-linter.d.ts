/**
 * Platform-aware caption / post linter. Generalises the Instagram caption.py port to every platform in
 * PLATFORM_CRAFT: feed-fold preview, hard length cap, hashtag cap, filler tags, link behaviour, single ask,
 * search keywords inside the fold, and a greeting/hashtag opener check. Pure and deterministic.
 */
import { CraftPlatform } from './platform-specs';
export type CheckStatus = 'PASS' | 'WARN' | 'FAIL';
export interface CopyCheckItem {
    check: string;
    status: CheckStatus;
    detail: string;
}
export interface CopyLintResult {
    platform: CraftPlatform;
    rawCaption: string;
    charCount: number;
    /** Length as the platform counts it (X weights URLs as 23). */
    weightedLength: number;
    maxChars: number;
    wordCount: number;
    /** What the feed shows before the fold. */
    feedCutout: string;
    foldChars: number;
    foldLabel: string;
    isTruncated: boolean;
    hashtags: string[];
    hashtagMax: number;
    mentions: string[];
    links: string[];
    asks: string[];
    fillerHashtags: string[];
    stockPhrases: string[];
    checks: CopyCheckItem[];
    score: number;
    passed: boolean;
    recommendations: string[];
    /** X only: the caption split into a thread when it is over 280. */
    thread?: string[];
}
/** X counts every URL as 23 characters regardless of length. */
export declare function weightedLength(text: string, platform: CraftPlatform): number;
/**
 * Splits text into X posts of at most `limit` weighted characters, breaking on paragraphs, then sentences, then
 * words, and numbering them "1/n". Hashtags are kept on the last post.
 */
export declare function splitIntoThread(text: string, limit?: number): string[];
export declare class PlatformCopyLinter {
    static analyze(platform: CraftPlatform, text: string, options?: {
        targetKeywords?: string[];
    }): CopyLintResult;
    /** YouTube titles: hard cap 100, about 60 visible on mobile, keyword in the first half. */
    static lintYoutubeTitle(title: string, keyword?: string): {
        title: string;
        checks: CopyCheckItem[];
        visible: string;
        passed: boolean;
    };
}
