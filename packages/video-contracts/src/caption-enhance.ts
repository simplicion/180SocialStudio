/**
 * Caption polish rules: key word emphasis, font resolution, word timestamp smoothing,
 * and intelligent grouping with bottom-heavy pyramid line balance.
 * Deterministic and shared between the AI Director compiler and mobile client.
 */
import { scriptOf, GROUPING_DEFAULTS_BY_SCRIPT, NO_SPACE_SCRIPTS } from "./caption-style-v2";

const STOP = new Set([
  "because", "should", "would", "could", "really", "actually", "basically", "literally", "something", "anything",
  "everything", "nothing", "people", "things", "through", "before", "between", "without", "around", "another",
  "always", "little", "having", "going", "doing", "being", "there", "their", "these", "those", "which", "where",
  "about", "after", "again", "other", "every",
]);

const bare = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{M}\p{N}%$₹€£]/gu, "");

export const MONEY_KEYWORDS = new Set([
  "dollar", "dollars", "million", "millions", "billion", "billions", "crore", "crores", "lakh", "lakhs",
  "money", "profit", "profits", "revenue", "wealth", "salary", "investment", "invest", "billionaire", "millionaire",
]);

export const WARNING_KEYWORDS = new Set([
  "danger", "dangerous", "warning", "mistake", "mistakes", "failure", "ruined", "illegal", "banned",
]);

export interface CaptionEmphasisResult {
  index: number;
  color: string;
  category: "money" | "warning" | "highlight";
}

/**
 * Detects the most impactful word to highlight and its category color.
 * Priority:
 * 1. Money / financial term -> Green (#22C55E)
 * 2. Warning / mistake term -> Red (#EF4444)
 * 3. Currency symbol or number -> Green or Gold
 * 4. Longest content word -> Default highlight color (#FACC15 / #FFE600)
 */
export function detectCaptionEmphasis(words: string[], defaultHighlight: string = "#FFE600"): CaptionEmphasisResult | null {
  // Check for explicit money keywords or currency symbols
  for (let i = 0; i < words.length; i++) {
    const raw = words[i];
    const b = bare(raw);
    if (/[$₹€£]/.test(raw) || MONEY_KEYWORDS.has(b)) {
      return { index: i, color: "#22C55E", category: "money" };
    }
  }

  // Check for explicit warning keywords
  for (let i = 0; i < words.length; i++) {
    const b = bare(words[i]);
    if (WARNING_KEYWORDS.has(b)) {
      return { index: i, color: "#EF4444", category: "warning" };
    }
  }

  // Fallback to standard caption keyword index
  const idx = captionKeywordIndex(words);
  if (idx !== null) {
    return { index: idx, color: defaultHighlight, category: "highlight" };
  }

  return null;
}

/**
 * Index of the word worth emphasising in one caption, or null (backward compatible).
 */
export function captionKeywordIndex(words: string[]): number | null {
  const amount = words.findIndex((w) => /[0-9%$₹€£]/.test(w));
  if (amount >= 0) return amount;
  let best: number | null = null;
  let bestLen = 5;
  words.forEach((raw, i) => {
    const w = bare(raw);
    const len = Array.from(w).length;
    if (len > bestLen && !STOP.has(w)) {
      best = i;
      bestLen = len;
    }
  });
  return best;
}

export interface CaptionTimedWord {
  word: string;
  startSeconds: number;
  endSeconds: number;
  isEmphasis?: boolean;
}

/**
 * Word timestamp smoothing:
 * - Enforces minimum word duration (>= 80ms)
 * - Eliminates negative or overlapping durations
 */
export function smoothWordTimestamps<T extends CaptionTimedWord>(words: T[], minDurationSec: number = 0.08): T[] {
  if (words.length === 0) return [];
  const out: T[] = [];
  for (let i = 0; i < words.length; i++) {
    const cur = { ...words[i] };
    if (cur.endSeconds < cur.startSeconds + minDurationSec) {
      cur.endSeconds = cur.startSeconds + minDurationSec;
    }
    if (out.length > 0) {
      const prev = out[out.length - 1];
      if (cur.startSeconds < prev.endSeconds) {
        if (cur.startSeconds >= prev.startSeconds + minDurationSec) {
          prev.endSeconds = cur.startSeconds;
        } else {
          cur.startSeconds = prev.endSeconds;
          cur.endSeconds = Math.max(cur.endSeconds, cur.startSeconds + minDurationSec);
        }
      }
    }
    out.push(cur);
  }
  return out;
}

export interface GroupingOptions {
  wordsPerCaption?: number;
  maxCharsPerLine?: number;
  maxLines?: number;
  /** Reading-speed cap (chars/s); default: the group's script default (GROUPING_DEFAULTS_BY_SCRIPT). */
  maxCharsPerSecond?: number;
  /** A pause longer than this starts a new group (default 0.5 s; captionOps passes the style's pauseBreakMs). */
  maxPauseSec?: number;
  /** A group never lasts longer than this (default: GroupingSchema's maxDurationMs, 3 s). */
  maxDurationSec?: number;
  shotBoundariesSec?: number[];
  /** false: shot changes do not split groups (default true). */
  breakOnShotChange?: boolean;
  breakOnPunctuation?: boolean;
}

const SEGMENTER: { segment(s: string): Iterable<unknown> } | null = (() => {
  try {
    const S = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(s: string): Iterable<unknown> } }).Segmenter;
    return S ? new S(undefined, { granularity: "grapheme" }) : null;
  } catch {
    return null;
  }
})();

/** User-perceived characters (grapheme clusters): "नमस्ते" is 3, an emoji with a skin tone is 1. */
export function graphemeLength(text: string): number {
  if (!SEGMENTER) return Array.from(text).length;
  let n = 0;
  for (const _ of SEGMENTER.segment(text)) n++;
  return n;
}

/** Characters a group shows on screen: graphemes, plus one space between words in spaced scripts. */
export function captionCharCount(words: string[]): number {
  if (words.length === 0) return 0;
  const letters = words.reduce((s, w) => s + graphemeLength(w), 0);
  return NO_SPACE_SCRIPTS.has(scriptOf(words.join(""))) ? letters : letters + words.length - 1;
}

/** True when a shot change lies between two consecutive words (a cut inside a word goes to the side holding most of it). */
function cutBetween(cuts: number[], prev: CaptionTimedWord, next: CaptionTimedWord): boolean {
  const a = (prev.startSeconds + prev.endSeconds) / 2;
  const b = (next.startSeconds + next.endSeconds) / 2;
  return cuts.some((c) => c > a && c <= b);
}

/**
 * Groups timed words into caption pages. A new group starts at:
 * - sentence terminals [.!?。！？।؟]
 * - speech pauses (> maxPauseSec)
 * - shot changes (a group never straddles a cut; a cut inside a word goes with the larger half of the word)
 * - maxWords, the 2-line character budget, maxDurationSec
 * - the reading-speed cap of the group's own script (detected per group, so a Hindi phrase after English words gets
 *   the Hindi limits). Reading speed is measured over the time the group can stay on screen (until the next word
 *   starts, at most maxDurationSec), not over the bare speech span: that is what the old 1.8× multiplier on the
 *   speech span approximated, and it is removed.
 * A single word is never split.
 */
export function groupWordsForCaptions<T extends CaptionTimedWord>(words: T[], options: GroupingOptions = {}): T[][] {
  if (words.length === 0) return [];
  const maxWords = options.wordsPerCaption ?? 3;
  const maxLines = options.maxLines ?? 2;
  const maxPause = options.maxPauseSec ?? 0.5;
  const maxDur = options.maxDurationSec ?? 3;
  const cuts = options.breakOnShotChange === false ? [] : options.shotBoundariesSec ?? [];
  const onPunct = options.breakOnPunctuation !== false;

  const groups: T[][] = [];
  let chunk: T[] = [];
  const flush = () => {
    if (chunk.length > 0) groups.push(chunk);
    chunk = [];
  };

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const prev = chunk[chunk.length - 1];
    if (prev) {
      const candidate = [...chunk.map((c) => c.word), w.word];
      const defaults = GROUPING_DEFAULTS_BY_SCRIPT[scriptOf(candidate.join(""))] ?? GROUPING_DEFAULTS_BY_SCRIPT.fallback;
      const maxCharsGroup = (options.maxCharsPerLine ?? defaults.maxCharsPerLine) * maxLines;
      const maxCps = options.maxCharsPerSecond ?? defaults.maxCharsPerSecond;
      const chars = captionCharCount(candidate);
      const start = chunk[0].startSeconds;
      const next = words[i + 1];
      const onScreenEnd = next ? Math.max(w.endSeconds, Math.min(next.startSeconds, start + maxDur)) : Math.max(w.endSeconds, start + maxDur);
      const onScreen = Math.max(0.3, onScreenEnd - start);
      if (
        w.startSeconds - prev.endSeconds > maxPause ||
        (onPunct && /[.!?。！？।؟]["'”’)]*$/u.test(prev.word)) ||
        cutBetween(cuts, prev, w) ||
        chunk.length >= maxWords ||
        chars > maxCharsGroup ||
        w.endSeconds - start > maxDur ||
        chars / onScreen > maxCps
      ) {
        flush();
      }
    }
    chunk.push(w);
  }
  flush();
  return groups;
}

export interface CaptionTimingOptions {
  /** Frame rate of the output (default 30): a caption appears at most one frame before its first word. */
  fps?: number;
  /** Each caption stays at least this long when the following gap allows (GroupingSchema default 700 ms). */
  minDurationSec?: number;
  /** Shot changes / cuts (timeline seconds): a caption is never extended past one, and never appears before one. */
  cutsSec?: number[];
  /** The video's end: nothing is shown after it. */
  videoEndSec?: number;
}

/**
 * On-screen times of each caption group:
 * - start: one frame before the first word at most (never earlier than the previous caption's last word, a cut
 *   before the word, or 0);
 * - end: the last word's end, extended to minDurationSec into the following gap, but never into the next caption,
 *   past a cut / shot change, or past the video end. A gap of up to 2 frames to the next caption is closed (no
 *   one-frame flicker) unless a cut lies in it.
 */
export function timeCaptionGroups<T extends CaptionTimedWord>(groups: T[][], opts: CaptionTimingOptions = {}): Array<{ startSec: number; endSec: number }> {
  const frame = 1 / (opts.fps && opts.fps > 0 ? opts.fps : 30);
  const minDur = opts.minDurationSec ?? 0.7;
  const cuts = [...(opts.cutsSec ?? [])].sort((a, b) => a - b);
  const videoEnd = opts.videoEndSec ?? Infinity;
  const eps = 1e-6;
  const firstStart = (g: T[]) => g[0].startSeconds;
  const lastEnd = (g: T[]) => Math.max(...g.map((w) => w.endSeconds));

  const starts = groups.map((g, i) => {
    const word = firstStart(g);
    let s = word - frame;
    if (i > 0) s = Math.max(s, Math.min(word, lastEnd(groups[i - 1])));
    // A cut just before the first word: start on the cut, not in the last frame of the previous shot.
    for (const c of cuts) if (c > s + eps && c <= word + eps) s = c;
    return Math.max(0, Math.min(s, word));
  });

  return groups.map((g, i) => {
    const start = starts[i];
    const speechEnd = Math.min(lastEnd(g), videoEnd);
    let limit = Math.min(videoEnd, i + 1 < groups.length ? starts[i + 1] : Infinity);
    const cutAfter = cuts.find((c) => c > speechEnd + eps);
    if (cutAfter !== undefined) limit = Math.min(limit, cutAfter);
    let end = Math.max(speechEnd, Math.min(start + minDur, limit));
    const next = i + 1 < groups.length ? starts[i + 1] : undefined;
    if (next !== undefined && next > end && next - end <= 2 * frame + eps && !cuts.some((c) => c >= end - eps && c < next - eps) && next <= videoEnd) {
      end = next;
    }
    return { startSec: start, endSec: Math.max(end, start) };
  });
}

/**
 * Splits a group's words into two lines, bottom-heavy (the top line is not longer than the bottom one) and never
 * leaving a one-word top line when there are 3+ words. A group that fits on one line (maxCharsPerLine) stays on one.
 * Lengths are script-aware (graphemes; no spaces counted in CJK / Thai).
 */
export function balanceLinesBottomHeavy(words: string[], opts: { maxCharsPerLine?: number } = {}): { line1: string[]; line2: string[] } {
  const total = captionCharCount(words);
  const maxLine = opts.maxCharsPerLine ?? (GROUPING_DEFAULTS_BY_SCRIPT[scriptOf(words.join(""))] ?? GROUPING_DEFAULTS_BY_SCRIPT.fallback).maxCharsPerLine;
  if (words.length <= 2 || (opts.maxCharsPerLine !== undefined && total <= maxLine)) return { line1: words, line2: [] };
  const split = (k: number) => ({ k, l1: captionCharCount(words.slice(0, k)), l2: captionCharCount(words.slice(k)) });
  const options = Array.from({ length: words.length - 2 }, (_, i) => split(i + 2)); // top line of 2+ words
  const good = options.filter((o) => o.l1 <= o.l2 && o.l2 <= maxLine).sort((a, b) => a.l2 - a.l1 - (b.l2 - b.l1));
  // Every split is top-heavy (or too long): one line reads better than a one-word top line, when it fits.
  if (!good.length && total <= maxLine) return { line1: words, line2: [] };
  const fallback = [...options].sort((a, b) => Math.max(a.l1, a.l2) - Math.max(b.l1, b.l2))[0] ?? split(1);
  const k = (good[0] ?? fallback).k;
  return { line1: words.slice(0, k), line2: words.slice(k) };
}

const SCRIPTS: Array<[number, number, string, string[]]> = [
  [0x0900, 0x097f, "Noto Sans Devanagari", ["Poppins", "Baloo 2"]],
  [0x0980, 0x09ff, "Noto Sans Bengali", []],
  [0x0a00, 0x0a7f, "Noto Sans Gurmukhi", []],
  [0x0a80, 0x0aff, "Noto Sans Gujarati", []],
  [0x0b00, 0x0b7f, "Noto Sans Oriya", []],
  [0x0b80, 0x0bff, "Noto Sans Tamil", []],
  [0x0c00, 0x0c7f, "Noto Sans Telugu", []],
  [0x0c80, 0x0cff, "Noto Sans Kannada", []],
  [0x0d00, 0x0d7f, "Noto Sans Malayalam", []],
  [0x0600, 0x06ff, "Noto Sans Arabic", ["Cairo", "Tajawal"]],
  [0x0750, 0x077f, "Noto Sans Arabic", ["Cairo", "Tajawal"]],
  [0x08a0, 0x08ff, "Noto Sans Arabic", ["Cairo", "Tajawal"]],
  [0xfb50, 0xfeff, "Noto Sans Arabic", ["Cairo", "Tajawal"]],
  [0x0e00, 0x0e7f, "Noto Sans Thai", ["Kanit", "Prompt"]],
  [0x3040, 0x30ff, "Noto Sans JP", []],
  [0x31f0, 0x31ff, "Noto Sans JP", []],
  [0xac00, 0xd7af, "Noto Sans KR", []],
  [0x1100, 0x11ff, "Noto Sans KR", []],
  [0x3130, 0x318f, "Noto Sans KR", []],
  [0x4e00, 0x9fff, "Noto Sans SC", ["Noto Sans JP"]],
  [0x3400, 0x4dbf, "Noto Sans SC", ["Noto Sans JP"]],
];

/**
 * The font family to draw `text` with: `family` when it covers the text's script, else the Noto Sans family
 * for that script (so Hindi, Tamil, … keep the caption's weight instead of a thin system font).
 */
export function captionFontFor(text: string, family: string): string {
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    for (const [lo, hi, noto, covered] of SCRIPTS) {
      if (cp >= lo && cp <= hi) return covered.includes(family) ? family : noto;
    }
  }
  return family;
}
