/**
 * Caption polish rules: the key word of a caption and the font for non-Latin scripts. Captions never get emoji.
 * Deterministic and shared by intent with the Flutter app (`caption_tools.dart` holds the same lists), so
 * captions made by hand and by the AI Director look the same.
 */

const STOP = new Set([
  "because", "should", "would", "could", "really", "actually", "basically", "literally", "something", "anything",
  "everything", "nothing", "people", "things", "through", "before", "between", "without", "around", "another",
  "always", "little", "having", "going", "doing", "being", "there", "their", "these", "those", "which", "where",
  "about", "after", "again", "other", "every",
]);

const bare = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{M}\p{N}%$₹€£]/gu, "");

/**
 * Index of the word worth emphasising in one caption, or null: a number / amount first, else the longest
 * content word (6+ letters). At most one per caption.
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
  [0x0600, 0x06ff, "Noto Sans Arabic", []],
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
