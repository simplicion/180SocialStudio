/**
 * Editor overhaul Phase 2: the Director can change every item the manual editor can, in place, by id (F-20), and it
 * respects item provenance and locks (F-21).
 *
 * Run: npx tsx --test packages/video-contracts/tests/phase2-update-tools.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EditIRCompiler } from "../src/edit-ir-compiler";
import { CreativeEditPlanSchema } from "../src/creative-plan.schema";
import { toMobileEditIR, editIRFromMobile, MobileEditIR, MobileEditIRSchema } from "../src/mobile-edit-ir";
import { DIRECTOR_TOOL_SPECS, validateDirectorToolCalls } from "../src/director-tools";
import { applyItemLocks, enforceItemLocks } from "../src/item-locks";
import { decideAutoApply } from "../src/director-constraints";

const manifest = JSON.parse(readFileSync(join(__dirname, "../src/director-tool-parity.json"), "utf8")).ops as Record<string, string>;

/** A 12 s, 3-clip vertical timeline with one of every item kind. */
function fixture(extra: Partial<MobileEditIR> = {}): MobileEditIR {
  const clip = (i: number) => ({ id: `c${i}`, assetId: "primary", sourceStartMs: i * 4000, sourceEndMs: (i + 1) * 4000, timelineStartMs: i * 4000, timelineEndMs: (i + 1) * 4000, speed: 1, volumeDb: 0, crop: { x: 0.34, y: 0, width: 0.3164, height: 1 }, filter: null, transitionIn: null });
  return MobileEditIRSchema.parse({
    schemaVersion: "mobile-editir/1", projectId: "p",
    canvas: { aspect: "9:16", width: 1080, height: 1920, fps: 30, background: "#000000" },
    durationMs: 12000,
    sources: [{ assetId: "primary", durationMs: 20000, width: 1920, height: 1080 }, { assetId: "take2", durationMs: 15000, width: 1920, height: 1080 }],
    clips: [clip(0), clip(1), clip(2)],
    overlays: [{ id: "pip1", kind: "broll", timelineStartMs: 2000, timelineEndMs: 5000, sourceStartMs: 0, source: { kind: "url", url: "https://cdn.test/b.mp4" }, fit: "contain", opacity: 1, muted: true, layer: { mode: "overlay", x: 0.7, y: 0.3, scale: 0.4, rotation: 0 } }],
    captions: [
      { id: "cap1", kind: "caption", startMs: 0, endMs: 1500, text: "hello there", words: [{ text: "hello", startMs: 0, endMs: 700 }, { text: "there", startMs: 700, endMs: 1500, highlight: true, color: "#FFE600" }], style: {} },
      { id: "t1", kind: "text", startMs: 0, endMs: 2000, text: "BIG NEWS", words: [], style: { fontSizePx: 64, textColor: "#FFFFFF" } },
    ],
    zooms: [{ id: "z1", startMs: 5000, endMs: 6500, scale: 1.6, centerX: 0.5, centerY: 0.4, rampMs: 200 }],
    effects: [{ id: "fx1", type: "shake", startMs: 7000, endMs: 7500, intensity: 0.8 }],
    audio: {
      originalTrack: { volumeDb: 0 },
      music: [{ id: "m1", timelineStartMs: 0, timelineEndMs: 12000, sourceStartMs: 0, source: { kind: "url", url: "https://cdn.test/song.mp3", query: "lofi" }, volumeDb: -14, fadeInMs: 500, fadeOutMs: 1000, duck: { enabled: true, duckDb: -12, attackMs: 120, releaseMs: 350 } }],
      speechRangesMs: [],
      sfx: [{ id: "s1", timelineStartMs: 3000, durationMs: 600, source: { kind: "url", url: "https://cdn.test/pop.mp3" }, volumeDb: -6 }],
      voiceovers: [{ id: "vo1", timelineStartMs: 8000, durationMs: 2000, sourceStartMs: 0, source: { kind: "asset", assetId: "rec1" }, volumeDb: 0 }],
    },
    ...extra,
  });
}

function run(client: MobileEditIR, calls: Array<{ name: string; args: any }>) {
  const v = validateDirectorToolCalls(calls);
  assert.deepEqual(v.errors, []);
  const before = editIRFromMobile(client);
  const plan = CreativeEditPlanSchema.parse({ intent: { aspectRatio: "9:16", resolution: { width: 1080, height: 1920 } }, operations: v.operations, explanation: "t" });
  const r = EditIRCompiler.compile(before, plan, [], { sources: client.sources });
  const out = toMobileEditIR({ editIR: r.updatedEditIR, sources: client.sources, primaryAssetId: "primary" }).editIR;
  return { r, out };
}

test("parity manifest: every public TimelineOps operation maps to a Director tool or says why it is UI-only", () => {
  const dart = readFileSync(join(__dirname, "../../../apps/social-studio-mobile/lib/features/studio/timeline_ops.dart"), "utf8");
  const ops = [...dart.matchAll(/^ {2}static MobileEditIr ([a-zA-Z]+)\(/gm)].map((m) => m[1]).sort();
  assert.deepEqual(Object.keys(manifest).sort(), ops, "manifest keys = TimelineOps operations");
  const tools = new Set(DIRECTOR_TOOL_SPECS.map((s) => s.name as string));
  for (const [op, tool] of Object.entries(manifest)) {
    if (tool.startsWith("ui-only:")) assert.ok(tool.length > 12, `${op}: ui-only needs a reason`);
    else assert.ok(tools.has(tool), `${op} -> ${tool} is not a Director tool`);
  }
});

test("editText changes the words, keeps timing and look", () => {
  const { out } = run(fixture(), [{ name: "editText", args: { id: "t1", text: "DAY 1" } }, { name: "editText", args: { id: "cap1", text: "hi everyone" } }]);
  const t = out.captions.find((c) => c.id === "t1")!;
  assert.equal(t.text, "DAY 1");
  assert.deepEqual([t.startMs, t.endMs], [0, 2000]);
  const c = out.captions.find((c) => c.id === "cap1")!;
  assert.deepEqual(c.words.map((w) => w.text), ["hi", "everyone"]);
  assert.equal(c.endMs, 1500);
});

test("updateTextStyle patches only the given fields; all_titles leaves captions alone", () => {
  const { out } = run(fixture(), [{ name: "updateTextStyle", args: { target: "all_titles", fontSizePx: 110, textColor: "#EF4444", positionY: 0.2 } }]);
  const t = out.captions.find((c) => c.id === "t1")!;
  assert.equal(t.style.fontSizePx, 110);
  assert.equal(t.style.textColor, "#EF4444");
  assert.equal(t.style.positionY, 0.2);
  assert.equal(out.captions.length, 2, "no duplicate title");
  const cap = out.captions.find((c) => c.id === "cap1")!;
  assert.equal(cap.style.textColor, "#FFFFFF");
});

test("retimeItem moves a title and a zoom; their length follows durationSec", () => {
  const { out } = run(fixture(), [
    { name: "retimeItem", args: { kind: "title", id: "t1", startSec: 1, durationSec: 3 } },
    { name: "retimeItem", args: { kind: "zoom", id: "z1", startSec: 9 } },
  ]);
  const t = out.captions.find((c) => c.id === "t1")!;
  assert.deepEqual([t.startMs, t.endMs], [1000, 4000]);
  const z = out.zooms.find((x) => x.id === "z1")!;
  assert.deepEqual([z.startMs, z.endMs], [9000, 10500]);
});

test("updateOverlay, setKeyframe and removeKeyframe change the layer in place", () => {
  const { out } = run(fixture(), [
    { name: "updateOverlay", args: { id: "pip1", x: 0.25, scale: 0.6, opacity: 0.8, mask: "circle" } },
    { name: "setKeyframe", args: { overlayId: "pip1", atSec: 0, opacity: 0 } },
    { name: "setKeyframe", args: { overlayId: "pip1", atSec: 0.5, opacity: 1 } },
    { name: "removeKeyframe", args: { overlayId: "pip1", atSec: 0 } },
  ]);
  const o = out.overlays.find((x) => x.id === "pip1")!;
  assert.equal(o.layer?.x, 0.25);
  assert.equal(o.layer?.y, 0.3);
  assert.equal(o.layer?.scale, 0.6);
  assert.equal(o.opacity, 0.8);
  assert.equal(o.mask?.shape, "circle");
  assert.deepEqual(o.layer?.keyframes, [{ atMs: 500, opacity: 1 }]);
});

test("updateZoom softens one zoom; updateEffect changes intensity", () => {
  const { out } = run(fixture(), [{ name: "updateZoom", args: { id: "z1", scale: 1.2 } }, { name: "updateEffect", args: { id: "fx1", intensity: 0.3 } }]);
  assert.equal(out.zooms.find((z) => z.id === "z1")!.scale, 1.2);
  assert.equal(out.zooms.length, 1);
  assert.equal(out.effects?.find((e) => e.id === "fx1")!.intensity, 0.3);
});

test("updateMusic keeps the track; changeMusicTrack keeps level, fades and ducking", () => {
  const quiet = run(fixture(), [{ name: "updateMusic", args: { volumeDb: -24, fadeOutSec: 2, duck: false } }]).out.audio.music[0];
  assert.equal(quiet.id, "m1");
  assert.deepEqual(quiet.source, { kind: "url", url: "https://cdn.test/song.mp3", query: "lofi" });
  assert.equal(quiet.volumeDb, -24);
  assert.equal(quiet.fadeOutMs, 2000);
  assert.equal(quiet.duck.enabled, false);
  const swapped = run(fixture(), [{ name: "changeMusicTrack", args: { sourceUrl: "https://cdn.test/other.mp3" } }]).out.audio.music[0];
  assert.equal(swapped.source.kind === "url" && swapped.source.url, "https://cdn.test/other.mp3");
  assert.equal(swapped.volumeDb, -14);
  assert.equal(swapped.fadeInMs, 500);
  assert.equal(swapped.duck.enabled, true);
});

test("setSfxVolume, setClipVolume, updateVoiceover and muteTrack set levels", () => {
  const { out } = run(fixture(), [
    { name: "setSfxVolume", args: { id: "s1", volumeDb: -20 } },
    { name: "setClipVolume", args: { clipId: "c1", volumeDb: -6 } },
    { name: "updateVoiceover", args: { id: "vo1", volumeDb: 3, fadeInSec: 0.2 } },
    { name: "muteTrack", args: { track: "original", muted: true } },
  ]);
  assert.equal(out.audio.sfx?.[0].volumeDb, -20);
  assert.equal(out.clips[1].volumeDb, -6);
  assert.equal(out.audio.voiceovers?.[0].volumeDb, 3);
  assert.equal(out.audio.voiceovers?.[0].fadeInMs, 200);
  assert.equal(out.audio.originalTrack.volumeDb, -60);
});

test("setCrop and panClip reframe a clip", () => {
  const { out } = run(fixture(), [
    { name: "setCrop", args: { clipId: "c0", x: 0.1, y: 0, width: 0.3164, height: 1 } },
    { name: "panClip", args: { clipId: "c1", centerX: 0.9, centerY: 0.5 } },
  ]);
  assert.equal(out.clips[0].crop?.x, 0.1);
  assert.ok(Math.abs(out.clips[1].crop!.x - (1 - 0.3164)) < 1e-3, "panned right, clamped to the frame");
  assert.equal(out.clips[1].crop?.width, 0.3164);
});

test("duplicateClip and freezeFrame insert footage; later items move back", () => {
  const dup = run(fixture(), [{ name: "duplicateClip", args: { clipId: "c0" } }]).out;
  assert.equal(dup.durationMs, 16000);
  assert.deepEqual(dup.clips.map((c) => c.id).slice(0, 2), ["c0", "c0_copy"]);
  assert.equal(dup.zooms[0].startMs, 9000, "zoom after the copy moved 4 s");
  const fz = run(fixture(), [{ name: "freezeFrame", args: { timestampSec: 6, durationSec: 1.5 } }]);
  assert.equal(fz.out.durationMs, 13500);
  const still = fz.out.clips.find((c) => c.assetId.startsWith("freeze:"))!;
  assert.equal(still.assetId, "freeze:primary@6000");
  assert.equal(still.timelineStartMs, 6000);
  assert.equal(still.timelineEndMs - still.timelineStartMs, 1500);
});

test("replaceClip swaps footage when the new source is long enough", () => {
  const { out, r } = run(fixture(), [{ name: "replaceClip", args: { clipId: "c2", replacementAssetId: "take2" } }, { name: "replaceClip", args: { clipId: "c0", replacementAssetId: "nope" } }]);
  assert.equal(out.clips[2].assetId, "take2");
  assert.match(r.rejectedOperations.join("\n"), /no footage "nope"/);
});

test("removeItem reaches music, voiceovers and stickers", () => {
  const { out } = run(fixture(), [{ name: "removeItem", args: { kind: "music" } }, { name: "removeItem", args: { kind: "voiceover", id: "vo1" } }]);
  assert.equal(out.audio.music.length, 0);
  assert.equal(out.audio.voiceovers, undefined);
});

test("update tools apply straight away under ASSISTED; changeMusicTrack and duplicateClip are proposals", () => {
  const d = (types: string[]) => decideAutoApply({ editing: "ASSISTED", operationTypes: types, plannerRequiresConfirmation: false, violations: 0, plannerSource: "llm" });
  assert.equal(d(["updateTextStyle", "updateMusic", "updateZoom", "editText"]).autoApplied, true);
  assert.equal(d(["changeMusicTrack"]).autoApplied, false);
  assert.equal(d(["duplicateClip"]).autoApplied, false);
});

// ── Provenance and locks (F-21) ─────────────────────────────────────────────────────────────────

const withMeta = (meta: MobileEditIR["itemMeta"]) => fixture({ itemMeta: meta });

test("locks: an op naming a locked item is refused", () => {
  const ir = withMeta({ t1: { origin: "manual", locked: true } });
  const r = applyItemLocks(validateDirectorToolCalls([{ name: "updateTextStyle", args: { target: "t1", fontSizePx: 120 } }, { name: "updateZoom", args: { id: "z1", scale: 1.1 } }]).operations, ir, { meta: ir.itemMeta!, allowManualSweep: false });
  assert.deepEqual(r.ops.map((o) => o.type), ["updateZoom"]);
  assert.match(r.violations[0], /locked title t1/);
});

test("locks: cuts over a locked clip are refused; 'all clips' sweeps skip it", () => {
  const ir = withMeta({ c1: { locked: true } });
  const ops = validateDirectorToolCalls([
    { name: "removeRange", args: { startSec: 4.5, durationSec: 1, reason: "pause" } },
    { name: "removeRange", args: { startSec: 0.5, durationSec: 1, reason: "pause" } },
    { name: "setClipVolume", args: { clipId: "all", volumeDb: -3 } },
  ]).operations;
  const r = applyItemLocks(ops, ir, { meta: ir.itemMeta!, allowManualSweep: false });
  assert.equal(r.ops.filter((o) => o.type === "removeRange").length, 1);
  assert.deepEqual(r.ops.filter((o) => o.type === "setClipVolume").map((o: any) => o.clipId), ["c0", "c2"]);
  assert.equal(r.violations.length, 2);
});

test("locks: 'remove the zooms' keeps the creator's own zooms unless they say all", () => {
  const ir = fixture({
    zooms: [
      { id: "z1", startMs: 5000, endMs: 6500, scale: 1.6, centerX: 0.5, centerY: 0.4, rampMs: 200 },
      { id: "z2", startMs: 8000, endMs: 9000, scale: 1.3, centerX: 0.5, centerY: 0.4, rampMs: 200 },
    ],
    itemMeta: { z1: { origin: "manual" }, z2: { origin: "director" } },
  });
  const op = validateDirectorToolCalls([{ name: "removeItem", args: { kind: "zoom" } }]).operations;
  const r = applyItemLocks(op, ir, { meta: ir.itemMeta!, allowManualSweep: false });
  assert.deepEqual(r.ops.map((o: any) => o.id), ["z2"]);
  const all = applyItemLocks(op, ir, { meta: ir.itemMeta!, allowManualSweep: true });
  assert.equal((all.ops[0] as any).id, undefined, "'remove all the zooms' removes them all");
});

test("locks backstop: a sweep that still changed a locked caption is undone; only its timing follows cuts", () => {
  const client = withMeta({ cap1: { locked: true } });
  const { out } = run(client, [{ name: "updateTextStyle", args: { target: "all_captions", textColor: "#00E5FF" } }]);
  assert.equal(out.captions.find((c) => c.id === "cap1")!.style.textColor, "#00E5FF", "the sweep reached it");
  const fixed = enforceItemLocks(client, out);
  assert.deepEqual(fixed.restored, ["cap1"]);
  assert.deepEqual(fixed.editIR.captions.find((c) => c.id === "cap1"), client.captions.find((c) => c.id === "cap1"));
});
