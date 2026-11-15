/**
 * Caption polish rules: key word emphasis, font resolution, word timestamp smoothing,
 * and intelligent grouping with bottom-heavy pyramid line balance.
 * Deterministic and shared between the AI Director compiler and mobile client.
 */
import { scriptOf, GROUPING_DEFAULTS_BY_SCRIPT } from "./caption-style-v2";

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
  maxCharsPerSecond?: number;
  maxPauseSec?: number;
  shotBoundariesSec?: number[];
}

/**
 * Groups timed words into cinematic caption pages respecting:
 * - Sentence terminals [.!?。！？।؟]
 * - Speech pauses (> maxPauseSec, default 0.5s)
 * - Camera cuts / shot boundaries (never straddles a cut)
 * - Reading speed & character limits per script (Netflix style guide)
 * - Maximum words per caption
 */
export function groupWordsForCaptions<T extends CaptionTimedWord>(words: T[], options: GroupingOptions = {}): T[][] {
  if (words.length === 0) return [];
  const maxWords = options.wordsPerCaption ?? 3;
  const maxLines = options.maxLines ?? 2;
  const maxPause = options.maxPauseSec ?? 0.5;
  const cuts = options.shotBoundariesSec ?? [];

  const groups: T[][] = [];
  let chunk: T[] = [];

  const script = scriptOf(words[0]?.word ?? "");
  const defaults = GROUPING_DEFAULTS_BY_SCRIPT[script] ?? GROUPING_DEFAULTS_BY_SCRIPT.fallback;
  const maxCharsPerLine = options.maxCharsPerLine ?? defaults.maxCharsPerLine;
  const maxCharsPerSecond = options.maxCharsPerSecond ?? defaults.maxCharsPerSecond;
  const maxCharsGroup = maxCharsPerLine * maxLines;

  const flush = () => {
    if (chunk.length > 0) {
      groups.push(chunk);
      chunk = [];
    }
  };

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const prev = chunk[chunk.length - 1];

    if (prev) {
      // 1. Pause check
      if (w.startSeconds - prev.endSeconds > maxPause) {
        flush();
      }
      // 2. Terminal punctuation
      else if (/[.!?。！？।؟]$/u.test(prev.word)) {
        flush();
      }
      // 3. Shot boundary cut check: cut falls between previous word and current word
      else if (cuts.some((c) => prev.endSeconds <= c && c <= w.startSeconds)) {
        flush();
      }
      // 4. Word count check
      else if (chunk.length >= maxWords) {
        flush();
      }
      // 5. Total character length check
      else {
        const currentChars = chunk.reduce((sum, item) => sum + item.word.length, 0) + chunk.length - 1;
        if (currentChars + w.word.length + 1 > maxCharsGroup) {
          flush();
        } else {
          // 6. Reading speed check
          const chunkDuration = Math.max(0.3, w.endSeconds - chunk[0].startSeconds);
          const charsPerSec = (currentChars + w.word.length) / chunkDuration;
          if (charsPerSec > maxCharsPerSecond * 1.8) {
            flush();
          }
        }
      }
    }

    chunk.push(w);
  }

  flush();
  return groups;
}

/**
 * Rebalances a list of words for 2-line rendering into a bottom-heavy pyramid.
 * Avoids single-word top lines and ensures the second line has equal or more weight.
 */
export function balanceLinesBottomHeavy(words: string[]): { line1: string[]; line2: string[] } {
  if (words.length <= 2) {
    return { line1: words, line2: [] };
  }
  if (words.length === 3) {
    // 1 word top, 2 words bottom is acceptable pyramid
    return { line1: [words[0]], line2: [words[1], words[2]] };
  }
  // For 4+ words, divide roughly in half, biased toward more words on line 2
  const mid = Math.floor(words.length / 2);
  let line1 = words.slice(0, mid);
  let line2 = words.slice(mid);

  // If line 1 has fewer chars than line 2, pyramid is already bottom-heavy
  const len1 = line1.join(" ").length;
  const len2 = line2.join(" ").length;
  if (len1 > len2 && line1.length > 2) {
    // Shift a word from line 1 to line 2 to keep bottom-heavy
    line2 = [line1[line1.length - 1], ...line2];
    line1 = line1.slice(0, line1.length - 1);
  }

  return { line1, line2 };
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
