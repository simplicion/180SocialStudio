/**
 * Caption group timing end to end (captions v2, Phase 5.3): PlanExpander.captionOps, shot data from the phone's scene
 * cuts, and the A9 rule (a word a cut removed is never shown).
 * Run: npx tsx --test packages/video-contracts/tests/caption-timing.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { EditIRCompiler } from "../src/edit-ir-compiler";
import { CreativeEditPlanSchema, AutoCaptionsOpSchema } from "../src/creative-plan.schema";
import { editIRFromMobileMedia, toMobileEditIR } from "../src/mobile-edit-ir";
import { PlanExpander, graphFromMobileMedia, graphFromMobileMediaList, shotsFromCuts } from "../src/plan-expander";
import { RationalTimeMath } from "../src/time";

const FRAME = 1 / 30;
const op = AutoCaptionsOpSchema.parse({ type: "autoCaptions", wordsPerCaption: 3 });
const ws = (spec: Array<[string, number, number]>) =>
  spec.map(([word, s, e], i) => ({ id: `w${i}`, word, startSeconds: s, endSeconds: e, confidence: 1, isEmphasis: false, emphasisScore: 0, energyScore: 0.5 })) as any[];
const caps = (ops: any[]) => ops.filter((o) => o.type === "addCaption");

test("captionOps: each caption starts at most one frame before its first word and never overlaps the next", () => {
  const words = ws([["one", 1.0, 1.2], ["two", 1.25, 1.4], ["three", 1.45, 1.7], ["four", 1.75, 1.9], ["five", 3.0, 3.1]]);
  const out = caps(PlanExpander.captionOps(words, op, [], { fps: 30, videoEndSec: 10 }));
  assert.ok(out.length >= 2);
  for (const [i, c] of out.entries()) {
    const first = c.words[0].startSec;
    assert.ok(c.startSec >= first - FRAME - 0.0011 && c.startSec <= first + 1e-9, `caption ${i}: ${c.startSec} vs word ${first}`);
    if (i + 1 < out.length) assert.ok(c.startSec + c.durationSec <= out[i + 1].startSec + 0.0011, `caption ${i} overlaps the next`);
  }
  // "five" is a lone 100 ms word: it stays the GroupingSchema default 700 ms
  const last = out[out.length - 1];
  assert.ok(Math.abs(last.durationSec - 0.7) < 0.035, `lone word lasts ${last.durationSec}`);
});

test("captionOps: minDuration from the style's grouping; never past the video end", () => {
  const words = ws([["hey", 9.5, 9.6]]);
  const out = caps(PlanExpander.captionOps(words, op, [], { fps: 30, videoEndSec: 9.8, grouping: { minDurationMs: 1200 } }));
  assert.ok(out[0].startSec + out[0].durationSec <= 9.8 + 1e-9);
  const out2 = caps(PlanExpander.captionOps(ws([["hey", 1, 1.1]]), op, [], { grouping: { minDurationMs: 1200 } }));
  assert.ok(Math.abs(out2[0].durationSec - 1.2) < 0.035);
});

test("captionOps: a caption never crosses a shot change and is not extended past one", () => {
  const words = ws([["shot", 0.5, 0.8], ["one", 0.85, 1.1], ["shot", 1.3, 1.6], ["two", 1.65, 1.9]]);
  const out = caps(PlanExpander.captionOps(words, { ...op, wordsPerCaption: 6 }, [1.2], { fps: 30 }));
  assert.equal(out.length, 2);
  assert.ok(out[0].startSec + out[0].durationSec <= 1.2 + 1e-9, "first caption ends on the cut");
  assert.ok(out[1].startSec >= 1.2 - 1e-9);
});

test("the phone's scene cuts become graph shots, and autoCaptions groups around them", () => {
  const media = {
    assetId: "primary", durationMs: 6000, width: 1080, height: 1920, fps: 30, scenesMs: [2000],
    transcript: { words: [["we", 1400, 1600], ["start", 1650, 1950], ["here", 2050, 2300], ["today", 2350, 2700]].map(([text, startMs, endMs]) => ({ text, startMs, endMs })) },
  } as any;
  const ir = editIRFromMobileMedia(media, "p1");
  const graph = graphFromMobileMedia(media, ir);
  assert.deepEqual(graph.shots.map((s) => [s.startSeconds, s.endSeconds]), [[0, 2], [2, 6]]);
  const plan = CreativeEditPlanSchema.parse({
    intent: { aspectRatio: "9:16", resolution: { width: 1080, height: 1920 } },
    operations: [{ type: "autoCaptions", wordsPerCaption: 4 }],
    explanation: "t",
  });
  const out = caps(PlanExpander.expand(plan, graph).operations);
  for (const c of out) assert.ok(!(c.startSec < 2 - 1e-6 && c.startSec + c.durationSec > 2 + 1e-6), `caption "${c.text}" straddles the cut at 2 s`);
  assert.deepEqual(out.map((c) => c.text), ["we start", "here today"]);
});

test("a switch from one source to another is a shot change; jump cuts inside one source are not", () => {
  const a = { assetId: "a", durationMs: 3000, width: 1080, height: 1920, fps: 30 } as any;
  const b = { assetId: "b", durationMs: 3000, width: 1080, height: 1920, fps: 30 } as any;
  const ir = editIRFromMobileMedia(a, "p1");
  const main = ir.tracks.videoTracks[0];
  const first = main.clips[0];
  main.clips.push({ ...first, id: "clip_b", assetId: "b", timelineRange: { start: RationalTimeMath.fromSeconds(3), duration: RationalTimeMath.fromSeconds(3) } });
  ir.meta.totalDuration = RationalTimeMath.fromSeconds(6);
  const g = graphFromMobileMediaList([a, b], ir);
  assert.deepEqual(g.shots.map((s) => s.startSeconds), [0, 3]);
  assert.deepEqual(shotsFromCuts([], 5), []);
  assert.deepEqual(shotsFromCuts([1, 1.05, 4.99], 5).map((s) => s.startSeconds), [0, 1], "near-duplicate and edge cuts are ignored");
});

test("A9: a word that a cut removed is never shown; a caption that lost every word is dropped", () => {
  const media = { assetId: "primary", durationMs: 10000, width: 1080, height: 1920, fps: 30 } as any;
  const words = ws([["keep", 1.0, 1.3], ["this", 1.35, 1.6], ["gone", 1.65, 1.9], ["alone", 4.0, 4.4]]);
  const captionOps = PlanExpander.captionOps(words, { ...op, wordsPerCaption: 3 }, [], { fps: 30, videoEndSec: 10 });
  const plan = CreativeEditPlanSchema.parse({
    intent: { aspectRatio: "9:16", resolution: { width: 1080, height: 1920 } },
    // "gone" (1.65-1.9) and all of "alone" (4.0-4.4) are cut out
    operations: [...captionOps, { type: "removeRange", startSec: 1.62, durationSec: 0.3, ripple: true, reason: "cut" }, { type: "removeRange", startSec: 3.9, durationSec: 0.8, ripple: true, reason: "cut" }],
    explanation: "t",
  });
  const r = EditIRCompiler.compile(editIRFromMobileMedia(media, "p1"), plan);
  const mobile = toMobileEditIR({ editIR: r.updatedEditIR, sources: [{ assetId: "primary", durationMs: 10000, width: 1080, height: 1920 }], primaryAssetId: "primary" }).editIR;
  const shown = mobile.captions.filter((c: any) => !c.dropped);
  const shownWords = shown.flatMap((c: any) => c.words.map((w: any) => w.text.toLowerCase()));
  assert.ok(!shownWords.includes("gone"), `cut word shown: ${shownWords.join(" ")}`);
  assert.ok(!shownWords.includes("alone"));
  assert.ok(shownWords.includes("keep") && shownWords.includes("this"));
  assert.ok(!shown.some((c: any) => /\bgone\b/i.test(c.text)), "caption text drops the cut word too");
});
