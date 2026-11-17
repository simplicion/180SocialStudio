/**
 * Timing & Word-Sync Engine Tests (captions v2, Phase 5).
 * Run: npx tsx --test packages/video-contracts/tests/caption-grouping-sync.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  smoothWordTimestamps,
  groupWordsForCaptions,
  balanceLinesBottomHeavy,
  detectCaptionEmphasis,
  timeCaptionGroups,
  captionCharCount,
  type CaptionTimedWord,
} from "../src/caption-enhance";

test("smoothWordTimestamps: enforces minimum duration (>=80ms) and resolves overlaps", () => {
  const rawWords: CaptionTimedWord[] = [
    { word: "quick", startSeconds: 0.1, endSeconds: 0.12 }, // 20ms -> too short
    { word: "overlap", startSeconds: 0.15, endSeconds: 0.3 }, // overlaps with lengthened word 1
    { word: "normal", startSeconds: 0.4, endSeconds: 0.8 },
  ];

  const smoothed = smoothWordTimestamps(rawWords, 0.08);
  assert.equal(smoothed.length, 3);

  // Word 1 must have at least 80ms duration
  assert.ok(smoothed[0].endSeconds - smoothed[0].startSeconds >= 0.0799);

  // Word 2 start must not precede word 1 end
  assert.ok(smoothed[1].startSeconds >= smoothed[0].endSeconds);
  assert.ok(smoothed[1].endSeconds - smoothed[1].startSeconds >= 0.0799);

  // Word 3 normal duration preserved
  assert.equal(smoothed[2].startSeconds, 0.4);
  assert.equal(smoothed[2].endSeconds, 0.8);
});

test("groupWordsForCaptions: splits on sentence terminals and speech pauses", () => {
  const words: CaptionTimedWord[] = [
    { word: "Hello", startSeconds: 0.0, endSeconds: 0.3 },
    { word: "world.", startSeconds: 0.35, endSeconds: 0.7 }, // sentence end
    { word: "This", startSeconds: 0.75, endSeconds: 1.0 },
    { word: "is", startSeconds: 1.05, endSeconds: 1.2 },
    { word: "next", startSeconds: 1.9, endSeconds: 2.2 }, // pause > 0.5s before "next"
  ];

  const groups = groupWordsForCaptions(words, { wordsPerCaption: 5, maxPauseSec: 0.5 });
  // Group 1: "Hello", "world." (ends on sentence terminal)
  // Group 2: "This", "is" (ends due to pause before "next")
  // Group 3: "next"
  assert.equal(groups.length, 3);
  assert.deepEqual(groups[0].map((w) => w.word), ["Hello", "world."]);
  assert.deepEqual(groups[1].map((w) => w.word), ["This", "is"]);
  assert.deepEqual(groups[2].map((w) => w.word), ["next"]);
});

test("groupWordsForCaptions: respects shot cut boundaries and never crosses a cut", () => {
  const words: CaptionTimedWord[] = [
    { word: "Shot", startSeconds: 0.5, endSeconds: 0.9 },
    { word: "one", startSeconds: 0.95, endSeconds: 1.3 },
    { word: "shot", startSeconds: 1.6, endSeconds: 1.9 }, // Cut at 1.5s
    { word: "two", startSeconds: 1.95, endSeconds: 2.3 },
  ];

  // Camera cut occurs at 1.45s (between "one" and "shot")
  const shotBoundaries = [1.45];
  const groups = groupWordsForCaptions(words, { wordsPerCaption: 4, shotBoundariesSec: shotBoundaries });

  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].map((w) => w.word), ["Shot", "one"]);
  assert.deepEqual(groups[1].map((w) => w.word), ["shot", "two"]);
});

test("groupWordsForCaptions: respects CJK line character limits (16 chars/line)", () => {
  // Long Chinese sentence without spaces
  const zhTokens: CaptionTimedWord[] = [
    { word: "这是一个非常长非常精彩的故事", startSeconds: 0.0, endSeconds: 1.2 }, // 14 chars
    { word: "我们今天开始讲", startSeconds: 1.25, endSeconds: 2.0 }, // 7 chars -> total 21 chars
    { word: "一定要听完哦", startSeconds: 2.05, endSeconds: 3.0 }, // 6 chars -> total 27 chars
    { word: "不要错过任何细节。", startSeconds: 3.05, endSeconds: 4.5 }, // 9 chars -> would exceed 32 chars (16 * 2)
  ];

  const groups = groupWordsForCaptions(zhTokens, { wordsPerCaption: 10, maxCharsPerLine: 16, maxLines: 2 });
  assert.ok(groups.length >= 2, `Expected at least 2 groups for CJK line limits, got ${groups.length}`);
  for (const g of groups) {
    const chars = g.reduce((sum, w) => sum + w.word.length, 0);
    assert.ok(chars <= 32, `Group character count ${chars} exceeded 2-line max of 32`);
  }
});

test("balanceLinesBottomHeavy: produces pyramid shape with equal or heavier second line", () => {
  // 4 words: "THIS IS VERY EXCITING"
  const four = ["THIS", "IS", "VERY", "EXCITING"];
  const bFour = balanceLinesBottomHeavy(four);
  assert.equal(bFour.line1.length, 2);
  assert.equal(bFour.line2.length, 2);
  assert.ok(bFour.line2.join(" ").length >= bFour.line1.join(" ").length);

  // 3 words: "WATCH THIS NOW": a 1-word top line is never made; it fits on one line
  const three = ["WATCH", "THIS", "NOW"];
  const bThree = balanceLinesBottomHeavy(three);
  assert.equal(bThree.line1.length, 3);
  assert.equal(bThree.line2.length, 0);

  // 2 words: single line
  const two = ["HELLO", "WORLD"];
  const bTwo = balanceLinesBottomHeavy(two);
  assert.equal(bTwo.line1.length, 2);
  assert.equal(bTwo.line2.length, 0);
});

test("detectCaptionEmphasis: classifies money terms, warning terms and content fallbacks", () => {
  // Money keyword gets green
  const money = detectCaptionEmphasis(["this", "costs", "$500", "today"]);
  assert.equal(money?.category, "money");
  assert.equal(money?.color, "#22C55E");
  assert.equal(money?.index, 2);

  const millions = detectCaptionEmphasis(["we", "made", "millions", "online"]);
  assert.equal(millions?.category, "money");
  assert.equal(millions?.color, "#22C55E");
  assert.equal(millions?.index, 2);

  // Warning keyword gets red
  const warning = detectCaptionEmphasis(["this", "is", "dangerous", "here"]);
  assert.equal(warning?.category, "warning");
  assert.equal(warning?.color, "#EF4444");
  assert.equal(warning?.index, 2);

  // General content fallback gets default highlight
  const general = detectCaptionEmphasis(["incredible", "journey", "ahead"], "#FACC15");
  assert.equal(general?.category, "highlight");
  assert.equal(general?.color, "#FACC15");
  assert.equal(general?.index, 0); // "incredible" (10 letters)
});

/* ── group timing (captions v2, Phase 5.3) ── */

const tw = (word: string, startSeconds: number, endSeconds: number): CaptionTimedWord => ({ word, startSeconds, endSeconds });
const FRAME = 1 / 30;

test("timeCaptionGroups: a caption appears at most one frame before its first word", () => {
  const groups = [[tw("hello", 1.0, 1.4)], [tw("there", 1.5, 1.8)]];
  const t = timeCaptionGroups(groups, { fps: 30 });
  for (let i = 0; i < groups.length; i++) {
    assert.ok(t[i].startSec >= groups[i][0].startSeconds - FRAME - 1e-9, `caption ${i} starts too early`);
    assert.ok(t[i].startSec <= groups[i][0].startSeconds + 1e-9, `caption ${i} starts after its first word`);
  }
  // 25 fps: one frame is 40 ms
  assert.ok(Math.abs(timeCaptionGroups([[tw("a", 1, 1.2)]], { fps: 25 })[0].startSec - 0.96) < 1e-9);
  // never before 0
  assert.equal(timeCaptionGroups([[tw("a", 0.01, 0.2)]])[0].startSec, 0);
});

test("timeCaptionGroups: short captions stay minDuration in the gap, but never overlap the next one", () => {
  const groups = [[tw("hi", 0.5, 0.6)], [tw("you", 0.9, 1.0)], [tw("ok", 5.0, 5.1)]];
  const t = timeCaptionGroups(groups, { fps: 30, minDurationSec: 0.7 });
  assert.ok(Math.abs(t[0].endSec - t[1].startSec) < 1e-9, "first caption runs up to the next, not past it");
  assert.ok(Math.abs(t[1].endSec - (t[1].startSec + 0.7)) < 1e-9, "second caption is extended to 700 ms");
  for (let i = 0; i + 1 < t.length; i++) assert.ok(t[i].endSec <= t[i + 1].startSec + 1e-9, "no overlap");
});

test("timeCaptionGroups: never extended past a cut or the video end; never starts in the previous shot", () => {
  const t = timeCaptionGroups([[tw("cut", 1.0, 1.1)], [tw("after", 1.25, 1.5)]], { fps: 30, minDurationSec: 0.7, cutsSec: [1.2] });
  assert.ok(t[0].endSec <= 1.2 + 1e-9, "stops at the cut");
  assert.ok(t[1].startSec >= 1.2 - 1e-9, "the next caption does not show in the last frame before the cut");
  const t2 = timeCaptionGroups([[tw("cut", 1.21, 1.4)]], { fps: 30, cutsSec: [1.2] });
  assert.ok(Math.abs(t2[0].startSec - 1.2) < 1e-9, "a cut 10 ms before the word: start on the cut");
  const end = timeCaptionGroups([[tw("bye", 9.8, 9.9)]], { fps: 30, minDurationSec: 0.7, videoEndSec: 10 });
  assert.ok(end[0].endSec <= 10 + 1e-9);
  // the last word itself is never shortened by the extension rules
  const long = timeCaptionGroups([[tw("x", 1.0, 1.6)]], { cutsSec: [1.3], minDurationSec: 0.2 });
  assert.equal(long[0].endSec, 1.6);
});

test("timeCaptionGroups: a gap of up to 2 frames between captions is closed", () => {
  const t = timeCaptionGroups([[tw("one", 0, 0.8)], [tw("two", 0.88, 1.5)]], { fps: 30, minDurationSec: 0.2 });
  assert.ok(Math.abs(t[0].endSec - t[1].startSec) < 1e-9);
});

test("groupWordsForCaptions: reading speed uses the group's own script (not the first word's)", () => {
  // English, then Chinese: CJK reading speed is 9 chars/s, Latin 17.
  const words = [tw("Hello", 0, 0.3), tw("friends", 0.35, 0.7), tw("这是", 1.3, 1.5), tw("一个", 1.5, 1.7), tw("非常好的", 1.7, 2.0), tw("故事", 2.0, 2.3)];
  const groups = groupWordsForCaptions(words, { wordsPerCaption: 8, maxPauseSec: 1 });
  for (const g of groups) {
    const zh = g.some((w) => /[一-鿿]/.test(w.word));
    if (!zh || g.length === 1) continue;
    const chars = captionCharCount(g.map((w) => w.word));
    const next = words[words.indexOf(g[g.length - 1]) + 1];
    const onScreen = (next ? next.startSeconds : g[0].startSeconds + 3) - g[0].startSeconds;
    assert.ok(chars / onScreen <= 9 + 1e-9, `CJK group ${g.map((w) => w.word).join("")} reads at ${chars / onScreen} cps`);
  }
  // the old code took the script from the first word (Latin, 17 cps) and allowed 1.8x: one 6-word group
  assert.ok(groups.length >= 3);
  assert.equal(captionCharCount(["这是", "一个"]), 4, "no spaces counted in CJK");
  assert.ok(captionCharCount(["नमस्ते"]) < "नमस्ते".length, "graphemes (vowel signs join their consonant), not code units");
});

test("groupWordsForCaptions: reading speed is enforced without the old 1.8x allowance", () => {
  // 20 chars/s of speech with no gaps: a 4-word Latin group at 17 cps max must split.
  const words = [tw("abcde", 0, 0.3), tw("fghij", 0.3, 0.6), tw("klmno", 0.6, 0.9), tw("pqrst", 0.9, 1.2), tw("uvwxy", 1.2, 1.5)];
  const groups = groupWordsForCaptions(words, { wordsPerCaption: 4, maxPauseSec: 1 });
  assert.ok(groups.length >= 2);
  for (const g of groups) assert.ok(g.length < 4, "under the old 1.8x rule this was one 4-word group at ~19 cps");
});

test("groupWordsForCaptions: maxDuration and a cut inside a word", () => {
  const slow = [tw("one", 0, 1), tw("two", 1.1, 2.1), tw("three", 2.2, 3.4)];
  const g = groupWordsForCaptions(slow, { wordsPerCaption: 5, maxDurationSec: 3 });
  assert.deepEqual(g.map((x) => x.length), [2, 1]);
  // cut at 1.2 s lies in "shot" (1.1-1.6): most of the word is after it, so the word opens the next group
  const w = [tw("a", 0.5, 0.9), tw("b", 0.9, 1.05), tw("shot", 1.1, 1.6), tw("c", 1.6, 1.8)];
  const g2 = groupWordsForCaptions(w, { wordsPerCaption: 5, shotBoundariesSec: [1.2] });
  assert.deepEqual(g2.map((x) => x.map((y) => y.word)), [["a", "b"], ["shot", "c"]]);
  const g3 = groupWordsForCaptions(w, { wordsPerCaption: 5, shotBoundariesSec: [1.2], breakOnShotChange: false });
  assert.equal(g3.length, 1);
});

test("balanceLinesBottomHeavy: no one-word top line; fits on one line when it can", () => {
  const b = balanceLinesBottomHeavy(["Never", "give", "up", "on", "your", "dreams"]);
  assert.ok(b.line1.length >= 2);
  assert.ok(captionCharCount(b.line1) <= captionCharCount(b.line2));
  const one = balanceLinesBottomHeavy(["short", "and", "sweet", "line"], { maxCharsPerLine: 42 });
  assert.equal(one.line2.length, 0, "fits on one line");
});
