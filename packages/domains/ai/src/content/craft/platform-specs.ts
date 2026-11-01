/**
 * Per-platform craft rules: the Instagram skill set (hook window, feed fold, hashtag cap, one ask, no dead links)
 * re-derived for every network we publish to. Hard limits are the platforms' documented caps; "fold" values are
 * conservative mobile estimates (the point where the feed hides text behind "more"), so treat them as targets.
 *
 * These rules are shared by the deterministic linters, the autopilot prompts (so the writer agents follow them)
 * and the Platform Command Center API.
 */

export const CRAFT_PLATFORMS = ['instagram', 'linkedin', 'youtube', 'x', 'facebook', 'tiktok'] as const;
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
    video: { wpm: number; hookWindowSec: number; idealSec: [number, number]; maxSec: number; aspect: string };
    /** Carousel / document posts. */
    carousel?: { maxSlides: number; idealSlides: [number, number]; size: string; note: string };
    /** YouTube-style titles (only where the platform has one). */
    title?: { maxChars: number; visibleChars: number };
    /** Rules handed to the writer agents verbatim. Keep them checkable, not vibes. */
    playbook: string[];
    /** Signals the platform rewards, used by the monitoring screen and the performance auditor. */
    rewardedSignals: string[];
}

export const PLATFORM_CRAFT: Record<CraftPlatform, PlatformCraftSpec> = {
    instagram: {
        platform: 'instagram',
        label: 'Instagram',
        captionMaxChars: 2200,
        foldChars: 125,
        foldLabel: '... more',
        hashtagMax: 5,
        links: 'dead',
        linkAdvice: 'Caption links are not clickable. Use a keyword ("comment GUIDE") or the link in bio.',
        urlWeight: 0,
        openingLineMaxWords: 14,
        video: { wpm: 165, hookWindowSec: 3, idealSec: [15, 45], maxSec: 180, aspect: '9:16 (1080x1920)' },
        carousel: { maxSlides: 20, idealSlides: [6, 10], size: '1080x1350 (4:5)', note: 'Slide 2 is a second cover: Instagram re-serves the post from slide 2.' },
        playbook: [
            'The first 125 characters of the caption must carry the hook and the search keyword; everything after is behind "... more".',
            'Max 5 hashtags, niche-specific. Never #viral #fyp #explore #instagood.',
            'Exactly one ask per post (save, share, comment a keyword, or follow).',
            'No URLs in the caption. Use "comment KEYWORD" or "link in bio".',
            'Reels: spoken hook under 3 seconds, a visual change at least every 4 seconds, and the last line echoes the hook so the loop replays.',
            'On-screen hook is a different, shorter sentence than the spoken hook: 6 words or fewer.',
        ],
        rewardedSignals: ['sends per reach (DM shares)', 'saves', '3-second hold', 'watch time / replays', 'non-follower reach'],
    },
    linkedin: {
        platform: 'linkedin',
        label: 'LinkedIn',
        captionMaxChars: 3000,
        foldChars: 140,
        foldLabel: '...see more',
        hashtagMax: 3,
        links: 'penalized',
        linkAdvice: 'External links in the post body reduce reach. Put the link in the first comment and say so.',
        urlWeight: 0,
        openingLineMaxWords: 18,
        video: { wpm: 160, hookWindowSec: 3, idealSec: [30, 90], maxSec: 600, aspect: '4:5 or 1:1 in feed, 9:16 for vertical' },
        carousel: { maxSlides: 300, idealSlides: [8, 12], size: 'PDF document, 1080x1350 pages', note: 'Upload as a PDF document post; the first page is the cover and must read at thumbnail size.' },
        playbook: [
            'The first two lines (about 140 characters on mobile) must make the reader tap "see more": a specific claim, number or tension, no greeting.',
            'One idea per short paragraph, a blank line between paragraphs, no walls of text.',
            'Write in first person from real experience; name the role, industry or situation of the reader.',
            'Max 3 hashtags at the end. No hashtags inside sentences.',
            'No external links in the body; if a link is needed say "link in the first comment".',
            'End with one question that a professional can answer from their own experience (drives comments).',
            'Carousels are PDF documents: 8-12 pages, one point per page, page 1 is a cover with a promise.',
        ],
        rewardedSignals: ['comments (especially long ones) in the first hour', 'dwell time', 'reposts with commentary', 'saves', 'document page clicks'],
    },
    youtube: {
        platform: 'youtube',
        label: 'YouTube',
        captionMaxChars: 5000,
        foldChars: 100,
        foldLabel: '...more (description)',
        hashtagMax: 3,
        links: 'ok',
        linkAdvice: 'Links work in descriptions; put the most important one in the first line of the description.',
        urlWeight: 0,
        openingLineMaxWords: 16,
        video: { wpm: 160, hookWindowSec: 2, idealSec: [20, 50], maxSec: 180, aspect: '9:16 (Shorts) or 16:9' },
        title: { maxChars: 100, visibleChars: 60 },
        playbook: [
            'Title under 60 characters with the searchable keyword in the first half; it must create a question the video answers.',
            'Shorts: the claim is said in the first 2 seconds, no intro, no "hey guys". Long videos: deliver the title\'s promise inside the first 30 seconds.',
            'The first line of the description restates the value with the main keyword; it is the only line shown before "more".',
            'Max 3 hashtags; the first three appear above the title.',
            'End Shorts on a line that loops into the first frame; end long videos by pointing to one specific next video.',
        ],
        rewardedSignals: ['viewed vs swiped away (Shorts)', 'average view duration', 'click-through rate', 'returning viewers', 'subscribers gained per view'],
    },
    x: {
        platform: 'x',
        label: 'X (Twitter)',
        captionMaxChars: 280,
        foldChars: 280,
        foldLabel: 'Show more (long posts)',
        hashtagMax: 2,
        links: 'penalized',
        linkAdvice: 'Posts with external links get less reach. Put the link in a reply to your own post.',
        urlWeight: 23,
        openingLineMaxWords: 14,
        video: { wpm: 165, hookWindowSec: 2, idealSec: [15, 45], maxSec: 140, aspect: '16:9 or 1:1' },
        playbook: [
            'Each post is 280 characters max (URLs count as 23). Longer ideas become a thread: post 1 is the whole hook and stands alone.',
            'No preamble: the first words are the claim, number or opinion.',
            'Threads: number posts "1/", each post is one complete point, the last post restates the takeaway and asks for a repost or reply.',
            'Max 1-2 hashtags, or none. Never stack hashtags.',
            'No external link in post 1; put it in a reply.',
            'Write like a person talking: short sentences, plain words, no corporate tone.',
        ],
        rewardedSignals: ['replies and reply depth', 'reposts and quotes', 'bookmarks', 'profile clicks', 'dwell time on thread'],
    },
    facebook: {
        platform: 'facebook',
        label: 'Facebook',
        captionMaxChars: 63206,
        foldChars: 140,
        foldLabel: '...See more',
        hashtagMax: 3,
        links: 'penalized',
        linkAdvice: 'Link posts reach fewer people than native posts. Prefer native video/images and put the link in a comment.',
        urlWeight: 0,
        openingLineMaxWords: 18,
        video: { wpm: 160, hookWindowSec: 3, idealSec: [15, 60], maxSec: 90, aspect: '9:16 (Reels) or 4:5' },
        carousel: { maxSlides: 10, idealSlides: [4, 8], size: '1080x1350 (4:5)', note: 'Multi-photo posts; the first image carries the promise.' },
        playbook: [
            'The first line (about 140 characters before "See more") is a relatable situation or a specific claim; no greeting.',
            'Write for sharing: a story with a lesson, a checklist people send to a friend, or a question people answer with their own story.',
            'Max 3 hashtags, or none.',
            'Native video and images over links; if a link is needed, put it in the first comment.',
            'One clear ask: share with someone, comment an answer, or save.',
        ],
        rewardedSignals: ['shares', 'meaningful comments', 'watch time (Reels)', 'reactions beyond like', 'messages started'],
    },
    tiktok: {
        platform: 'tiktok',
        label: 'TikTok',
        captionMaxChars: 4000,
        foldChars: 100,
        foldLabel: 'more',
        hashtagMax: 5,
        links: 'dead',
        linkAdvice: 'Caption links are not clickable. Use the bio link.',
        urlWeight: 0,
        openingLineMaxWords: 14,
        video: { wpm: 170, hookWindowSec: 2, idealSec: [15, 45], maxSec: 600, aspect: '9:16 (1080x1920)' },
        carousel: { maxSlides: 35, idealSlides: [5, 10], size: '1080x1920 (9:16)', note: 'Photo mode; text on slide 1 is the hook.' },
        playbook: [
            'Spoken hook in under 2 seconds and on-screen text in the first frame.',
            'Caption starts with the search keyword phrase people type; 3-5 specific hashtags.',
            'Cut or change the frame every 2-4 seconds; end on a loop back to the first line.',
        ],
        rewardedSignals: ['completion rate', 'rewatches', 'shares', 'comments', 'search clicks'],
    },
};

const ALIASES: Record<string, CraftPlatform> = {
    instagram: 'instagram', ig: 'instagram', instagram_reels: 'instagram',
    linkedin: 'linkedin', li: 'linkedin',
    youtube: 'youtube', yt: 'youtube', youtube_shorts: 'youtube', shorts: 'youtube',
    x: 'x', twitter: 'x',
    facebook: 'facebook', fb: 'facebook', meta: 'facebook',
    tiktok: 'tiktok',
};

/** "Twitter" / "YouTube Shorts" / "fb" -> craft platform id, or null for unknown names. */
export function toCraftPlatform(input: unknown): CraftPlatform | null {
    const key = String(input ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    return ALIASES[key] ?? null;
}

export function craftSpec(platform: CraftPlatform): PlatformCraftSpec {
    return PLATFORM_CRAFT[platform];
}

/** Prompt block with the playbook for each platform, for the writer and critic agents. */
export function platformPlaybookPrompt(platforms: readonly string[]): string {
    const lines: string[] = [];
    for (const raw of platforms) {
        const p = toCraftPlatform(raw);
        if (!p) continue;
        const s = PLATFORM_CRAFT[p];
        lines.push(`${s.label} playbook (fold at ~${s.foldChars} chars, max ${s.hashtagMax} hashtags, links: ${s.links}):`);
        for (const rule of s.playbook) lines.push(`  - ${rule}`);
    }
    return lines.join('\n');
}
