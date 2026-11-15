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

  // 3 words: "WATCH THIS NOW"
  const three = ["WATCH", "THIS", "NOW"];
  const bThree = balanceLinesBottomHeavy(three);
  assert.equal(bThree.line1.length, 1);
  assert.equal(bThree.line2.length, 2);

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
