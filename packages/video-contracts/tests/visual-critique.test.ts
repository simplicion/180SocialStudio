/**
 * Visual critic contracts (AI Director quality-fix plan, Phase 5).
 * Run: npx tsx --test packages/video-contracts/tests/visual-critique.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { MobileEditIRSchema } from "../src/mobile-edit-ir";
import { MobileAIDirectRequestSchema } from "../src/ai-director-api.schema";
import { critiqueCheckpoints, MAX_CHECKPOINTS, VisualCritiqueSchema, visualRepairInstruction } from "../src/visual-critique";

const clip = (id: string, a: number, b: number) => ({ id, assetId: "primary", sourceStartMs: a, sourceEndMs: b, timelineStartMs: a, timelineEndMs: b, speed: 1, volumeDb: 0, crop: null, filter: null, transitionIn: null });
const ir = (extra: Record<string, unknown> = {}) =>
  MobileEditIRSchema.parse({
    schemaVersion: "mobile-editir/1", projectId: "p",
    canvas: { aspect: "9:16", width: 1080, height: 1920, fps: 30, background: "#000000" },
    durationMs: 12000,
    sources: [{ assetId: "primary", durationMs: 12000, width: 1080, height: 1920 }],
    clips: [clip("c0", 0, 4000), clip("c1", 4000, 8000), clip("c2", 8000, 12000)],
    overlays: [], captions: [], zooms: [],
    audio: { originalTrack: { volumeDb: 0 }, music: [], speechRangesMs: [] },
    ...extra,
  });

test("checkpoints: hook, both sides of every cut, zoom and title midpoints, with what is on screen", () => {
  const cps = critiqueCheckpoints(
    ir({
      zooms: [{ id: "z1", startMs: 5000, endMs: 7000, scale: 1.4, centerX: 0.5, centerY: 0.35, rampMs: 300 }],
      captions: [
        { id: "t1", kind: "text", startMs: 0, endMs: 2000, text: "3 apps I use daily", words: [], style: {} },
        { id: "k1", kind: "caption", startMs: 9000, endMs: 10000, text: "every single morning", words: [], style: {} },
      ],
    })
  );
  const kinds = cps.map((c) => c.kind);
  assert.ok(kinds.includes("hook"));
  assert.ok(cps.some((c) => c.kind === "cut_before" && c.tMs === 3800));
  assert.ok(cps.some((c) => c.kind === "cut_after" && c.tMs === 4200));
  const zoom = cps.find((c) => c.kind === "zoom")!;
  assert.match(zoom.label, /zoom 1\.40x on \(0\.50,0\.35\)/);
  assert.deepEqual(zoom.refs, ["z1"]);
  const hook = cps.find((c) => c.kind === "hook")!;
  assert.match(hook.label, /the opening \(hook\): title "3 apps I use daily"/);
  assert.ok(cps.some((c) => c.refs.includes("k1")), "a caption is checked");
  assert.deepEqual(cps.map((c) => c.tMs), [...cps.map((c) => c.tMs)].sort((a, b) => a - b));
});

test("checkpoints are capped (hook and cuts first) and merged within 150 ms", () => {
  const clips = Array.from({ length: 30 }, (_, i) => clip(`c${i}`, i * 1000, (i + 1) * 1000));
  const zooms = Array.from({ length: 30 }, (_, i) => ({ id: `z${i}`, startMs: i * 1000 + 100, endMs: i * 1000 + 900, scale: 1.2, centerX: 0.5, centerY: 0.4, rampMs: 200 }));
  const cps = critiqueCheckpoints(ir({ durationMs: 30000, clips, zooms, sources: [{ assetId: "primary", durationMs: 30000, width: 1080, height: 1920 }] }));
  assert.ok(cps.length <= MAX_CHECKPOINTS);
  assert.ok(cps.some((c) => c.kind === "cut_before"));
  for (let i = 1; i < cps.length; i++) assert.ok(cps[i].tMs - cps[i - 1].tMs >= 150);
});

test("the repair instruction lists only critical/major issues, fenced, with the original request", () => {
  const critique = VisualCritiqueSchema.parse({
    score: 6.5,
    issues: [
      { kind: "caption_over_face", severity: "critical", atMs: 5200, refs: ["k1"], description: "captions cover the mouth", fix: "move captions to the lower third" },
      { kind: "color_inconsistent", severity: "minor", atMs: 9000, description: "slightly warmer" },
    ],
  });
  const text = visualRepairInstruction("make it a punchy reel", { round: 1, critique });
  assert.match(text, /<<<UNTRUSTED_DATA source="vision"/);
  assert.match(text, /5\.2 s, critical caption_over_face \(items k1\): captions cover the mouth Fix: move captions/);
  assert.ok(!text.includes("slightly warmer"), "minor issues are only reported");
  assert.match(text, /Do not undo or remove anything the creator asked for/);
  assert.match(text, /"make it a punchy reel"/);
});

test("the Director request accepts a visual repair (rounds 1-2 only)", () => {
  const base = { prompt: "x", media: { durationMs: 1000, width: 1080, height: 1920 } };
  const critique = { score: 7, issues: [] };
  assert.ok(MobileAIDirectRequestSchema.parse({ ...base, visualCritique: { round: 1, critique } }).visualCritique);
  assert.throws(() => MobileAIDirectRequestSchema.parse({ ...base, visualCritique: { round: 3, critique } }));
});
