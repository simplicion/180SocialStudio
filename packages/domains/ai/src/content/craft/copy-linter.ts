/**
 * Platform-aware caption / post linter. Generalises the Instagram caption.py port to every platform in
 * PLATFORM_CRAFT: feed-fold preview, hard length cap, hashtag cap, filler tags, link behaviour, single ask,
 * search keywords inside the fold, and a greeting/hashtag opener check. Pure and deterministic.
 */
import { CraftPlatform, PLATFORM_CRAFT } from './platform-specs';
import { TextHumanizer } from './text-humanizer';

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

const HASHTAG_RE = /(?:^|\s)(#[\p{L}\p{N}_]+)/gu;
const MENTION_RE = /(?:^|\s)(@[A-Za-z0-9_.]+)/g;
const LINK_RE = /(?:https?:\/\/\S+|\bwww\.\S+|\b[a-z0-9-]+\.(?:com|co|io|net|org|ai|app|in|ly)\/\S*)/gi;

const ASKS = [
    { pattern: /\bcomment (?:the word |")?[A-Z0-9]{2,}\b/, name: 'comment a keyword' },
    { pattern: /\b(?:dm|message) me\b/i, name: 'DM me' },
    { pattern: /\bsave (?:this|it)\b/i, name: 'save this' },
    { pattern: /\b(?:share|send) (?:this|it) (?:with|to)\b/i, name: 'share this' },
    { pattern: /\b(?:repost|retweet|rt)\b(?: this)?/i, name: 'repost' },
    { pattern: /\bfollow (?:me|for)\b/i, name: 'follow' },
    { pattern: /\bsubscribe\b/i, name: 'subscribe' },
    { pattern: /\blink in (?:my )?bio\b|\blink in (?:the )?(?:first )?comment\b/i, name: 'go to link' },
    { pattern: /\b(?:swipe|tap) (?:through|left|right|for|to)\b/i, name: 'swipe or tap' },
    { pattern: /\btell me\b|\bwhat would you\b|\bwhich one\b|\bwhat's your\b|\bhow do you\b[^.?!]*\?\s*$/i, name: 'answer a question' },
];

const FILLER_TAGS = new Set([
    '#viral', '#fyp', '#explore', '#explorepage', '#foryou', '#foryoupage', '#trending', '#instagood', '#love',
    '#follow', '#like4like', '#followforfollow', '#reels', '#reelsinstagram', '#viralreels', '#instadaily',
    '#linkedin', '#twitter', '#facebook', '#youtube', '#shorts', '#motivation', '#success',
]);

const GREETING_RE = /^(hey|hi|hello|guys|welcome|so,?\s|happy \w+|good (morning|evening)|i'?m (excited|thrilled|happy) to)/i;

/** X counts every URL as 23 characters regardless of length. */
export function weightedLength(text: string, platform: CraftPlatform): number {
    const weight = PLATFORM_CRAFT[platform].urlWeight;
    if (!weight) return [...text].length;
    let len = [...text].length;
    for (const url of text.match(LINK_RE) || []) len += weight - [...url].length;
    return len;
}

/**
 * Splits text into X posts of at most `limit` weighted characters, breaking on paragraphs, then sentences, then
 * words, and numbering them "1/n". Hashtags are kept on the last post.
 */
export function splitIntoThread(text: string, limit = 280): string[] {
    const clean = text.trim();
    if (weightedLength(clean, 'x') <= limit) return [clean];
    const reserve = 6; // room for " 10/12"
    const max = limit - reserve;
    const units: string[] = [];
    for (const para of clean.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)) {
        if (weightedLength(para, 'x') <= max) { units.push(para); continue; }
        for (const sentence of para.match(/[^.!?]+[.!?]*\s*/g) || [para]) {
            const s = sentence.trim();
            if (weightedLength(s, 'x') <= max) { units.push(s); continue; }
            let buf = '';
            for (const word of s.split(/\s+/)) {
                const next = buf ? `${buf} ${word}` : word;
                if (weightedLength(next, 'x') > max && buf) { units.push(buf); buf = word; } else buf = next;
            }
            if (buf) units.push(buf);
        }
    }
    const posts: string[] = [];
    let cur = '';
    for (const u of units) {
        const next = cur ? `${cur}\n\n${u}` : u;
        if (weightedLength(next, 'x') > max && cur) { posts.push(cur); cur = u; } else cur = next;
    }
    if (cur) posts.push(cur);
    return posts.map((p, i) => `${p} ${i + 1}/${posts.length}`);
}

export class PlatformCopyLinter {
    public static analyze(platform: CraftPlatform, text: string, options: { targetKeywords?: string[] } = {}): CopyLintResult {
        const spec = PLATFORM_CRAFT[platform];
        const stripped = (text || '').trim();
        const chars = [...stripped].length;
        const weighted = weightedLength(stripped, platform);
        const lines = stripped.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        const firstLine = lines[0] || '';
        const hashtags = Array.from(stripped.matchAll(HASHTAG_RE), (m) => m[1].toLowerCase());
        const mentions = Array.from(stripped.matchAll(MENTION_RE), (m) => m[1]);
        const links = stripped.match(LINK_RE) || [];
        const words = stripped.match(/[\p{L}\p{N}$%'’-]+/gu) || [];
        const isTruncated = chars > spec.foldChars;
        const feedCutout = isTruncated ? [...stripped].slice(0, spec.foldChars).join('') : stripped;
        const asks = ASKS.filter((a) => a.pattern.test(stripped)).map((a) => a.name);
        const fillerHashtags = hashtags.filter((t) => FILLER_TAGS.has(t));
        const stockPhrases = TextHumanizer.findSlop(stripped);
        const checks: CopyCheckItem[] = [];

        // 1. Hard length
        if (weighted > spec.captionMaxChars) {
            checks.push({
                check: 'LENGTH', status: 'FAIL',
                detail: platform === 'x'
                    ? `${weighted}/280 characters. Split it into a thread (post 1 must stand alone).`
                    : `${weighted} characters is over the ${spec.label} limit of ${spec.captionMaxChars}.`,
            });
        } else if (chars < 40 && platform !== 'x') {
            checks.push({ check: 'LENGTH', status: 'WARN', detail: `Only ${chars} characters; there is no room for a hook, value and one ask.` });
        } else {
            checks.push({ check: 'LENGTH', status: 'PASS', detail: `${weighted}/${spec.captionMaxChars} characters.` });
        }

        // 2. What the feed shows before the fold
        const firstWords = firstLine.split(/\s+/).filter(Boolean).length;
        if (firstLine.startsWith('#')) {
            checks.push({ check: 'FOLD_HOOK', status: 'FAIL', detail: `Opens with a hashtag, wasting the ${spec.foldChars}-character preview.` });
        } else if (GREETING_RE.test(firstLine)) {
            checks.push({ check: 'FOLD_HOOK', status: 'WARN', detail: 'Opens on a greeting or announcement. Start on the claim, number or tension.' });
        } else if (firstWords > spec.openingLineMaxWords && platform !== 'x') {
            checks.push({ check: 'FOLD_HOOK', status: 'WARN', detail: `Opening line is ${firstWords} words; keep it under ${spec.openingLineMaxWords} so the hook lands before "${spec.foldLabel}".` });
        } else if ([...feedCutout].length < 30) {
            checks.push({ check: 'FOLD_HOOK', status: 'WARN', detail: 'The preview before the fold is under 30 characters.' });
        } else {
            checks.push({ check: 'FOLD_HOOK', status: 'PASS', detail: `Hook sits inside the first ${spec.foldChars} characters.` });
        }

        // 3. Hashtag cap
        if (hashtags.length > spec.hashtagMax) {
            checks.push({ check: 'HASHTAG_COUNT', status: 'FAIL', detail: `${hashtags.length} hashtags; ${spec.label} works best with at most ${spec.hashtagMax}.` });
        } else {
            checks.push({ check: 'HASHTAG_COUNT', status: 'PASS', detail: `${hashtags.length}/${spec.hashtagMax} hashtags.` });
        }

        // 4. Filler tags
        checks.push(fillerHashtags.length
            ? { check: 'FILLER_HASHTAGS', status: 'FAIL', detail: `Generic hashtags (${fillerHashtags.join(', ')}) carry no topic signal. Use niche tags.` }
            : { check: 'FILLER_HASHTAGS', status: 'PASS', detail: 'No generic hashtags.' });

        // 5. Links
        if (links.length && spec.links === 'dead') {
            checks.push({ check: 'LINKS', status: 'FAIL', detail: `"${links[0]}" will not be clickable. ${spec.linkAdvice}` });
        } else if (links.length && spec.links === 'penalized') {
            checks.push({ check: 'LINKS', status: 'WARN', detail: spec.linkAdvice });
        } else {
            checks.push({ check: 'LINKS', status: 'PASS', detail: links.length ? 'Links are fine here.' : 'No links in the body.' });
        }

        // 6. One ask
        if (asks.length > 1) checks.push({ check: 'CALL_TO_ACTION', status: 'WARN', detail: `${asks.length} asks (${asks.join(' + ')}). Pick one.` });
        else if (asks.length === 1) checks.push({ check: 'CALL_TO_ACTION', status: 'PASS', detail: `One clear ask: ${asks[0]}.` });
        else checks.push({ check: 'CALL_TO_ACTION', status: 'WARN', detail: 'No clear next step for the reader.' });

        // 7. Search keywords inside the fold
        const keywords = (options.targetKeywords || []).map((k) => k.trim()).filter(Boolean);
        if (keywords.length) {
            const lower = stripped.toLowerCase();
            const fold = feedCutout.toLowerCase();
            const missing = keywords.filter((k) => !lower.includes(k.toLowerCase()));
            const late = keywords.filter((k) => lower.includes(k.toLowerCase()) && !fold.includes(k.toLowerCase()));
            if (missing.length) checks.push({ check: 'SEARCH_KEYWORDS', status: 'WARN', detail: `Missing search keywords: ${missing.join(', ')}.` });
            else if (late.length) checks.push({ check: 'SEARCH_KEYWORDS', status: 'WARN', detail: `Move ${late.join(', ')} into the first ${spec.foldChars} characters.` });
            else checks.push({ check: 'SEARCH_KEYWORDS', status: 'PASS', detail: 'Search keywords are inside the fold.' });
        }

        // 8. Stock AI phrasing
        checks.push(stockPhrases.length
            ? { check: 'STOCK_PHRASES', status: 'WARN', detail: `Reads machine-written: ${stockPhrases.slice(0, 5).map((p) => `"${p}"`).join(', ')}.` }
            : { check: 'STOCK_PHRASES', status: 'PASS', detail: 'No stock AI phrasing.' });

        let score = 100;
        for (const c of checks) score -= c.status === 'FAIL' ? 25 : c.status === 'WARN' ? 8 : 0;
        score = Math.max(0, Math.min(100, score));

        return {
            platform,
            rawCaption: text,
            charCount: chars,
            weightedLength: weighted,
            maxChars: spec.captionMaxChars,
            wordCount: words.length,
            feedCutout,
            foldChars: spec.foldChars,
            foldLabel: spec.foldLabel,
            isTruncated,
            hashtags,
            hashtagMax: spec.hashtagMax,
            mentions,
            links,
            asks,
            fillerHashtags,
            stockPhrases,
            checks,
            score,
            passed: !checks.some((c) => c.status === 'FAIL'),
            recommendations: checks.filter((c) => c.status !== 'PASS').map((c) => c.detail),
            ...(platform === 'x' && weighted > 280 ? { thread: splitIntoThread(stripped) } : {}),
        };
    }

    /** YouTube titles: hard cap 100, about 60 visible on mobile, keyword in the first half. */
    public static lintYoutubeTitle(title: string, keyword?: string): { title: string; checks: CopyCheckItem[]; visible: string; passed: boolean } {
        const t = (title || '').trim();
        const spec = PLATFORM_CRAFT.youtube.title!;
        const len = [...t].length;
        const checks: CopyCheckItem[] = [];
        if (!len) checks.push({ check: 'TITLE_LENGTH', status: 'FAIL', detail: 'Title is empty.' });
        else if (len > spec.maxChars) checks.push({ check: 'TITLE_LENGTH', status: 'FAIL', detail: `${len}/${spec.maxChars} characters; YouTube rejects it.` });
        else if (len > spec.visibleChars) checks.push({ check: 'TITLE_LENGTH', status: 'WARN', detail: `${len} characters; mobile cuts after about ${spec.visibleChars}.` });
        else checks.push({ check: 'TITLE_LENGTH', status: 'PASS', detail: `${len} characters, fully visible on mobile.` });
        if (keyword?.trim()) {
            const idx = t.toLowerCase().indexOf(keyword.trim().toLowerCase());
            if (idx < 0) checks.push({ check: 'TITLE_KEYWORD', status: 'WARN', detail: `Title does not contain "${keyword.trim()}".` });
            else if (idx > len / 2) checks.push({ check: 'TITLE_KEYWORD', status: 'WARN', detail: 'Move the keyword into the first half of the title.' });
            else checks.push({ check: 'TITLE_KEYWORD', status: 'PASS', detail: 'Keyword is front-loaded.' });
        }
        if (/^(how i|my|vlog|episode|ep\.?\s*\d)/i.test(t) && !/\d/.test(t)) {
            checks.push({ check: 'TITLE_PROMISE', status: 'WARN', detail: 'Title describes the video instead of promising an outcome; add the specific result or number.' });
        }
        return { title: t, checks, visible: [...t].slice(0, spec.visibleChars).join(''), passed: !checks.some((c) => c.status === 'FAIL') };
    }
}
