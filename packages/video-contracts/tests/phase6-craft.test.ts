/**
 * Editor overhaul Phase 6: short-form craft. Moving auto-reframe (F-18), J/L cuts, text transform, several music beds.
 *
 * Run: npx tsx --test packages/video-contracts/tests/phase6-craft.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { computeCropPath } from "../src/reframe-path";
import { EditIRCompiler } from "../src/edit-ir-compiler";
import { CreativeEditPlanSchema } from "../src/creative-plan.schema";
import { toMobileEditIR, editIRFromMobile, MobileEditIR, MobileEditIRSchema } from "../src/mobile-edit-ir";
import { validateDirectorToolCalls } from "../src/director-tools";

const WINDOW = { width: 0.3164, height: 1 };
const walk = (fromX: number, toX: number, ms = 10000, step = 500) =>
  Array.from({ length: ms / step + 1 }, (_, i) => ({ tMs: i * step, x: fromX + ((toX - fromX) * i * step) / ms, y: 0.4, w: 0.2, h: 0.3 }));

test("reframe path: a speaker walking across the frame is followed smoothly, within the frame", () => {
  const path = computeCropPath(walk(0.25, 0.75), { sourceStartMs: 0, sourceEndMs: 10000 }, WINDOW);
  assert.ok(path.length > 3, `a moving camera (${path.length} keyframes)`);
  assert.ok(path.every((k) => k.x >= 0 && k.x <= 1 - WINDOW.width + 1e-9 && k.y === 0), "inside the frame");
  for (let i = 1; i < path.length; i++) assert.ok(path[i].sourceMs > path[i - 1].sourceMs, "time increases");
  const last = path[path.length - 1];
  assert.ok(last.x + WINDOW.width / 2 > 0.6, `ends near the speaker (${last.x + WINDOW.width / 2})`);
  // Never faster than the pan limit (0.35 frame widths per second).
  for (let i = 1; i < path.length; i++) {
    const v = Math.abs(path[i].x - path[i - 1].x) / Math.max(0.001, (path[i].sourceMs - path[i - 1].sourceMs) / 1000);
    assert.ok(v <= 0.35 + 1e-6, `pan speed ${v.toFixed(3)} at ${path[i].sourceMs} ms`);
  }
});

test("reframe path: small movements inside the dead zone do not move the camera", () => {
  const jitter = Array.from({ length: 21 }, (_, i) => ({ tMs: i * 500, x: 0.5 + (i % 2 ? 0.02 : -0.02), y: 0.4, w: 0.2, h: 0.3 }));
  const path = computeCropPath(jitter, { sourceStartMs: 0, sourceEndMs: 10000 }, WINDOW);
  assert.equal(path.length, 1, "a still camera is one static crop");
});

test("reframe path: a scene cut re-centres at once (no pan across the cut)", () => {
  const faces = [...walk(0.2, 0.2, 4000).map((f) => f), ...walk(0.8, 0.8, 4000).map((f) => ({ ...f, tMs: f.tMs + 5000 }))];
  const path = computeCropPath(faces, { sourceStartMs: 0, sourceEndMs: 9000 }, WINDOW, [5000]);
  const before = path.find((k) => k.sourceMs === 4999)!;
  const after = path.find((k) => k.sourceMs === 5000)!;
  assert.ok(before && after, JSON.stringify(path));
  assert.ok(after.x - before.x > 0.4, "jumps to the new shot's subject");
});

test("reframe path: no face track, or a window as wide as the frame, gives no path", () => {
  assert.deepEqual(computeCropPath([], { sourceStartMs: 0, sourceEndMs: 1000 }, WINDOW), []);
  assert.deepEqual(computeCropPath(walk(0.2, 0.8), { sourceStartMs: 0, sourceEndMs: 10000 }, { width: 1, height: 1 }), []);
});

// ── Through the compiler and the projection ──────────────────────────────────────────────────────────

function wide(extra: Partial<MobileEditIR> = {}): MobileEditIR {
  return MobileEditIRSchema.parse({
    schemaVersion: "mobile-editir/1", projectId: "p6",
    canvas: { aspect: "16:9", width: 1920, height: 1080, fps: 30, background: "#000000" },
    durationMs: 10000,
    sources: [{ assetId: "primary", durationMs: 20000, width: 1920, height: 1080 }],
    clips: [
      { id: "c0", assetId: "primary", sourceStartMs: 2000, sourceEndMs: 7000, timelineStartMs: 0, timelineEndMs: 5000, speed: 1, volumeDb: 0, crop: null, filter: null, transitionIn: null },
      { id: "c1", assetId: "primary", sourceStartMs: 9000, sourceEndMs: 14000, timelineStartMs: 5000, timelineEndMs: 10000, speed: 1, volumeDb: 0, crop: null, filter: null, transitionIn: null },
    ],
    overlays: [], captions: [], zooms: [],
    audio: { originalTrack: { volumeDb: 0 }, music: [{ id: "m1", timelineStartMs: 0, timelineEndMs: 5000, sourceStartMs: 0, source: { kind: "url", url: "https://cdn.test/a.mp3" }, volumeDb: -16, fadeInMs: 0, fadeOutMs: 0, duck: { enabled: false, duckDb: -12, attackMs: 120, releaseMs: 350 } }], speechRangesMs: [] },
    ...extra,
  });
}

function run(client: MobileEditIR, calls: Array<{ name: string; args: any }>, faces?: any[]) {
  const v = validateDirectorToolCalls(calls);
  assert.deepEqual(v.errors, []);
  const before = editIRFromMobile(client);
  const plan = CreativeEditPlanSchema.parse({ intent: { aspectRatio: before.meta.targetAspect, resolution: before.meta.resolution }, operations: v.operations, explanation: "t" });
  const r = EditIRCompiler.compile(before, plan, [], { sources: client.sources });
  const out = toMobileEditIR({ editIR: r.updatedEditIR, sources: client.sources, primaryAssetId: "primary", faceSamplesByAsset: { primary: faces } }).editIR;
  return { r, out: MobileEditIRSchema.parse(out) };
}

test("reframeSubject mode 'track' gives each clip a moving crop over its own source range", () => {
  const { out } = run(wide(), [{ name: "reframeSubject", args: { targetAspect: "9:16", mode: "track" } }], walk(0.2, 0.8, 16000).map((f) => ({ ...f, tMs: f.tMs })));
  for (const c of out.clips) {
    assert.ok(c.crop, "cropped to fill 9:16");
    assert.ok((c.cropKeyframes?.length ?? 0) > 1, `clip ${c.id} follows the speaker`);
    assert.ok(c.cropKeyframes!.every((k) => k.sourceMs >= c.sourceStartMs && k.sourceMs <= c.sourceEndMs), "keyframes inside the clip's source range");
  }
  // A static reframe has no moving crop.
  const still = run(wide(), [{ name: "reframeSubject", args: { targetAspect: "9:16" } }], walk(0.2, 0.8, 16000)).out;
  assert.ok(still.clips.every((c) => !c.cropKeyframes));
});

test("a manual crop replaces a moving crop", () => {
  const tracked = run(wide(), [{ name: "reframeSubject", args: { targetAspect: "9:16", mode: "track" } }], walk(0.2, 0.8, 16000)).out;
  const { out } = run(tracked, [{ name: "setCrop", args: { clipId: "c0", x: 0.1, y: 0, width: 0.3164, height: 1 } }]);
  assert.equal(out.clips[0].cropKeyframes, undefined);
  assert.ok(out.clips[1].cropKeyframes?.length, "the other clip keeps its moving crop");
});

test("jlCut sets lead / lag and clamps them to the footage and half the neighbour", () => {
  const { out, r } = run(wide(), [
    { name: "jlCut", args: { clipId: "c1", leadMs: 300 } },
    { name: "jlCut", args: { clipId: "c0", lagMs: 5000 > 2000 ? 2000 : 5000 } },
  ]);
  assert.equal(out.clips[1].audioLeadMs, 300);
  assert.equal(out.clips[0].audioLagMs, 2000);
  const first = run(wide(), [{ name: "jlCut", args: { clipId: "c0", leadMs: 300 } }]);
  assert.equal(first.out.clips[0].audioLeadMs, undefined, "the first clip has nothing before it");
  assert.match(first.r.rejectedOperations.join("\n"), /no clip before it/);
  assert.ok(r.appliedOperations.some((a) => /J-cut 300 ms/.test(a)));
});

test("a cut through a J/L clip keeps the lead at its front and the lag at its back", () => {
  const client = wide({ clips: wide().clips.map((c, i) => (i === 1 ? { ...c, audioLeadMs: 200, audioLagMs: 0 } : { ...c, audioLagMs: 250 })) });
  const { out } = run(client, [{ name: "removeRange", args: { startSec: 2, durationSec: 1, reason: "pause" } }]);
  const pieces = out.clips.filter((c) => c.sourceEndMs <= 7000);
  assert.equal(pieces.length, 2);
  assert.equal(pieces[0].audioLagMs, undefined, "the left piece now ends at the cut");
  assert.equal(pieces[1].audioLagMs, 250, "the right piece keeps the clip's L-cut");
});

test("a second music bed for part of the video; overlapping beds are refused", () => {
  const { out, r } = run(wide(), [{ name: "addBackgroundMusic", args: { query: "hype", startSec: 5, durationSec: 5 } }]);
  assert.equal(out.audio.music.length, 2);
  assert.deepEqual(out.audio.music.map((m) => [m.timelineStartMs, m.timelineEndMs]), [[0, 5000], [5000, 10000]]);
  const clash = run(wide(), [{ name: "addBackgroundMusic", args: { query: "hype", startSec: 3, durationSec: 4 } }]);
  assert.equal(clash.out.audio.music.length, 1);
  assert.match(clash.r.rejectedOperations.join("\n"), /overlaps the music already there/);
  assert.ok(r.appliedOperations.length > 0);
});

test("updateMusic targets one bed by id", () => {
  const two = run(wide(), [{ name: "addBackgroundMusic", args: { query: "hype", startSec: 5, durationSec: 5, volumeDb: -10 } }]).out;
  const second = two.audio.music[1].id;
  const { out } = run(two, [{ name: "updateMusic", args: { id: second, volumeDb: -30 } }]);
  assert.equal(out.audio.music.find((m) => m.id === second)!.volumeDb, -30);
  assert.equal(out.audio.music.find((m) => m.id === "m1")!.volumeDb, -16);
});

test("updateTextStyle rotates and scales text; the contract keeps transform keyframes", () => {
  const client = wide({ captions: [{ id: "t1", kind: "text", startMs: 0, endMs: 2000, text: "Hi", words: [], style: { transformKeyframes: [{ atMs: 0, scale: 0.5 }, { atMs: 300, scale: 1 }] } } as any] });
  const { out } = run(client, [{ name: "updateTextStyle", args: { target: "t1", rotationDeg: -8, scale: 1.4 } }]);
  const st = out.captions[0].style;
  assert.equal(st.rotationDeg, -8);
  assert.equal(st.scale, 1.4);
  assert.deepEqual(st.transformKeyframes, [{ atMs: 0, scale: 0.5 }, { atMs: 300, scale: 1 }]);
});

test("the contract refuses overlapping music beds", () => {
  const bad = MobileEditIRSchema.safeParse({ ...wide(), audio: { ...wide().audio, music: [wide().audio.music[0], { ...wide().audio.music[0], id: "m2", timelineStartMs: 4000, timelineEndMs: 8000 }] } });
  assert.equal(bad.success, false);
});

test("frame-accurate cuts (6.7): a cut at odd milliseconds lands on frame boundaries and never cuts into kept time", () => {
  const { out } = run(wide({ clips: [{ id: "c0", assetId: "primary", sourceStartMs: 0, sourceEndMs: 10000, timelineStartMs: 0, timelineEndMs: 10000, speed: 1, volumeDb: 0, crop: null, filter: null, transitionIn: null }], audio: { ...wide().audio, music: [] } }), [
    { name: "removeRange", args: { startSec: 1.234, durationSec: 1.111, reason: "pause" } },
  ]);
  const frame = 1000 / 30;
  const end = out.clips[0].timelineEndMs;
  assert.ok(Math.abs(end - Math.round(end / frame) * frame) <= 1.5, `first piece ends on a frame (${end})`);
  assert.ok(end >= 1234, "the cut starts at or after the asked point");
  assert.ok(out.clips[1].sourceStartMs <= 2345, "and ends at or before it");
});

test("renderMotionGraphic is drawn as an animated title card (it used to be rejected every time)", () => {
  const { out, r } = run(wide({ audio: { ...wide().audio, music: [] } }), [
    { name: "renderMotionGraphic", args: { timelineStartSec: 2, durationSec: 3, templateId: "hormozi-counter", title: "Revenue", metricValue: "$100K+", metricLabel: "in 90 days", tag: "proven" } },
  ]);
  assert.equal(r.rejectedOperations.length, 0, r.rejectedOperations.join("; "));
  const titles = out.captions.filter((c) => c.kind === "text");
  assert.equal(titles.length, 2, "the big line and the detail line");
  assert.equal(titles[0].text, "PROVEN · $100K+");
  assert.equal(titles[0].style.enter?.type, "pop");
  assert.ok(titles[0].style.background, "on an accent box");
  assert.match(titles[1].text, /in 90 days/);
  assert.deepEqual([titles[0].startMs, titles[0].endMs], [2000, 5000]);
});
