/**
 * ShotLog (AI Director quality-fix plan, Phase 2): schema, keyframe times, frame → shot grouping, subject samples.
 * Run: npx tsx --test packages/video-contracts/tests/shot-log.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  FrameObservationSchema,
  keyframeTimesMs,
  MAX_SHOT_MS,
  primarySubject,
  ShotLogSchema,
  shotsFromObservations,
  subjectSamplesFromShotLog,
} from "../src/shot-log";
import { MobileMediaDescriptorSchema } from "../src/mobile-edit-ir";

const obs = (index: number, extra: Record<string, unknown> = {}) =>
  FrameObservationSchema.parse({ index, description: `frame ${index}`, framing: "medium", cameraMotion: "static", brollSuitability: 0.2, energy: "medium", ...extra });

test("keyframe times: one per scene + one every 2 s, capped and sorted", () => {
  const t = keyframeTimesMs(10000, [3100, 7000]);
  assert.deepEqual(t, [...t].sort((a, b) => a - b));
  assert.ok(t.includes(3400) && t.includes(7300), "a frame just after each cut");
  assert.ok(t.length >= 5 && t.length <= 8);
  assert.ok(t.every((x) => x < 10000));
  const long = keyframeTimesMs(30 * 60 * 1000, []);
  assert.equal(long.length, 60, "capped at 60");
  assert.ok(long[59] > 25 * 60 * 1000, "thinned evenly over the whole clip");
  assert.deepEqual(keyframeTimesMs(300), [200], "a very short clip: one frame before the end");
});

test("frame observations: unknown enum values fall back instead of failing the whole log", () => {
  const o = FrameObservationSchema.parse({ index: 0, description: "x", framing: "dutch-angle", cameraMotion: "orbit", quality: ["blurry?"], brollSuitability: 7, energy: "insane" });
  assert.equal(o.framing, "other");
  assert.equal(o.cameraMotion, "unknown");
  assert.deepEqual(o.quality, []);
  assert.equal(o.brollSuitability, 0.5);
  assert.equal(o.energy, "medium");
  assert.throws(() => FrameObservationSchema.parse({ index: 0, description: "x", subjects: [{ label: "a", box: { x: 2, y: 0, w: 0.1, h: 0.1 } }] }), "boxes stay inside the frame");
});

test("shots: split at scene cuts and every 8 s, middle frame describes, quality issues are unioned", () => {
  const frames = [
    { tMs: 500, obs: obs(0, { quality: ["dark"] }) },
    { tMs: 2500, obs: obs(1) },
    { tMs: 4500, obs: obs(2, { quality: ["blur"], energy: "high" }) },
    { tMs: 6500, obs: obs(3, { description: "after cut" }) },
  ];
  const shots = shotsFromObservations(frames, 20000, [6000]);
  assert.equal(shots[0].startMs, 0);
  assert.equal(shots[0].endMs, 6000);
  assert.deepEqual(shots[0].quality.sort(), ["blur", "dark"]);
  assert.equal(shots[0].energy, "high");
  assert.equal(shots[0].description, "frame 1", "the frame nearest the shot's middle (3 s)");
  assert.ok(shots.slice(1).every((s) => s.endMs - s.startMs <= MAX_SHOT_MS));
  assert.equal(shots[shots.length - 1].endMs, 20000);
  assert.ok(shots.slice(1).every((s) => s.description === "after cut"), "shots without a frame use the nearest one");
});

test("primary subject and face-track-shaped samples from subject boxes", () => {
  const log = ShotLogSchema.parse({
    version: "shotlog/1", assetId: "primary", sourceHash: "abcdef0123", durationMs: 4000, model: "claude/claude-opus-5-5", frameCount: 2,
    shots: [{
      startMs: 0, endMs: 4000, description: "settings screen", framing: "screen", cameraMotion: "static", quality: [], brollSuitability: 0.1, energy: "low",
      subjects: [{ label: "sidebar", box: { x: 0, y: 0, w: 0.2, h: 1 } }, { label: "backup tab", box: { x: 0.6, y: 0.2, w: 0.2, h: 0.1 }, primary: true }],
    }],
  });
  assert.equal(primarySubject(log.shots[0])?.label, "backup tab");
  const samples = subjectSamplesFromShotLog(log);
  assert.equal(samples.length, 8, "every 500 ms inside the 4 s shot");
  assert.ok(samples[0].tMs >= 150 && samples[samples.length - 1].tMs <= 3850, "kept away from the shot edges");
  assert.deepEqual({ x: samples[1].x, y: samples[1].y }, { x: 0.7, y: 0.25 }, "the box centre");
});

test("the media descriptor accepts a shotLog and rejects a malformed one", () => {
  const base = { durationMs: 4000, width: 1080, height: 1920 };
  const shotLog = { version: "shotlog/1", assetId: "primary", sourceHash: "abcdef0123", durationMs: 4000, model: "m", frameCount: 0, shots: [] };
  assert.ok(MobileMediaDescriptorSchema.parse({ ...base, shotLog }).shotLog);
  assert.throws(() => MobileMediaDescriptorSchema.parse({ ...base, shotLog: { ...shotLog, version: "shotlog/9" } }));
});

test("a FACE zoom that runs across a shot change is framed on the subject where it lands", async () => {
  const { PlanExpander } = await import("../src/plan-expander");
  const sample = (t: number, x: number, y: number) => ({ timeSeconds: t, subjectId: "s", x, y, width: 0.1, height: 0.1, confidence: 0.9, isPrimarySpeaker: true });
  const graph: any = {
    technicalMetadata: { width: 1920, height: 1080 },
    faces: [{ subjectId: "s", label: "s", isPrimarySpeaker: true, averageCoords: { x: 0.5, y: 0.5 },
      // the Save button until 23.0 s, then a banner at the top
      samples: [21.5, 22.0, 22.5, 22.9].map((t) => sample(t, 0.83, 0.87)).concat([23.1, 23.5, 23.9].map((t) => sample(t, 0.5, 0.09))) }],
  };
  const c = PlanExpander.faceZoomCenter(graph, 22.3, 23.7)!;
  assert.deepEqual([c.x, c.y], [0.83, 0.87]);
});
