/**
 * F-05: a turn that changes nothing gives the client's timeline back unchanged, and a turn that changes one thing
 * leaves every other item exactly as the client sent it.
 *
 * Run: npx tsx --test packages/video-contracts/tests/roundtrip-identity.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { EditIRCompiler } from "../src/edit-ir-compiler";
import { CreativeEditPlanSchema } from "../src/creative-plan.schema";
import { toMobileEditIR, editIRFromMobile, MobileEditIR, MobileEditIRSchema } from "../src/mobile-edit-ir";
import { preserveUntouched } from "../src/mobile-preserve";
import { PlanExpander } from "../src/plan-expander";
import { randomMobileEditIR } from "./support/random-mobile-ir";

function turn(client: MobileEditIR, operations: any[]) {
  const before = editIRFromMobile(client);
  const plan = CreativeEditPlanSchema.parse({
    intent: {
      platform: "general", aspectRatio: before.meta.targetAspect, resolution: before.meta.resolution, stylePreset: "CUSTOM",
      energy: "medium", pacing: "dynamic", captionStyle: "HORMOZI_BOUNCE", audioStyle: "VOICE_PRIORITY_DUCKED", visualStyle: "CLEAN_ATTENTION",
    },
    operations,
    confidence: 1,
    explanation: "",
  });
  const after = EditIRCompiler.compile(editIRFromMobile(client), plan, []).updatedEditIR;
  const c = client;
  const preexistingIds = new Set([...c.overlays, ...c.captions, ...c.zooms, ...(c.effects ?? []), ...c.audio.music, ...(c.audio.sfx ?? []), ...(c.audio.voiceovers ?? [])].map((x) => x.id));
  const projected = toMobileEditIR({ editIR: after, sources: client.sources, primaryAssetId: client.sources[0].assetId, preexistingIds }).editIR;
  const out = MobileEditIRSchema.parse({ ...preserveUntouched(client, before, after, projected), ...(client.watermark ? { watermark: client.watermark } : {}) });
  return out;
}
const noSpeech = (m: MobileEditIR) => ({ ...m, audio: { ...m.audio, speechRangesMs: [] } });

test("F-05 property: a no-op turn returns the client timeline unchanged (200 seeds)", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const client = randomMobileEditIR(seed);
    assert.deepEqual(noSpeech(turn(client, [])), noSpeech(client), `seed ${seed}`);
  }
});

test("F-05 property: a turn that adds one zoom leaves every other item verbatim (200 seeds)", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const client = randomMobileEditIR(seed);
    const out = turn(client, [{ type: "addZoom", startSec: 0, durationSec: 0.5, scale: 1.2, targetCoords: { x: 0.5, y: 0.4 } }]);
    const strip = (m: MobileEditIR) => { const { itemMeta: _m, ...rest } = noSpeech(m); return { ...rest, zooms: [] }; };
    assert.deepEqual(strip(out), strip(client), `seed ${seed}`);
    // Provenance: the new zoom is the Director's; everything else keeps the creator's entries.
    const added = out.zooms.find((z) => !client.zooms.some((c) => c.id === z.id))!;
    assert.deepEqual(out.itemMeta?.[added.id], { origin: "director" }, `seed ${seed}`);
    for (const [id, m] of Object.entries(client.itemMeta ?? {})) assert.deepEqual(out.itemMeta?.[id], m, `seed ${seed}: ${id}`);
    for (const z of client.zooms) assert.deepEqual(out.zooms.find((x) => x.id === z.id), z, `seed ${seed}: manual zoom ${z.id} kept as is`);
    assert.equal(out.zooms.length, client.zooms.length + 1, `seed ${seed}`);
  }
});

test("F-03/F-05: device music and SFX, whole-file SFX, http music and styled title words survive the round trip", () => {
  const base = randomMobileEditIR(7);
  const client = MobileEditIRSchema.parse({
    ...base,
    captions: [{ id: "t1", kind: "text", startMs: 0, endMs: 1000, text: "Big News", words: [
      { text: "Big", startMs: 0, endMs: 500, highlight: true, color: "#EF4444", scale: 1.2 },
      { text: "News", startMs: 500, endMs: 1000, highlight: false, color: null, scale: 1 },
    ], style: {} }],
    audio: {
      ...base.audio,
      music: [{ id: "m1", timelineStartMs: 0, timelineEndMs: base.durationMs, sourceStartMs: 0, source: { kind: "asset", assetId: "song_1" }, volumeDb: -18, fadeInMs: 0, fadeOutMs: 0, duck: { enabled: true, duckDb: -12, attackMs: 120, releaseMs: 350 } }],
      sfx: [
        { id: "s1", timelineStartMs: 100, source: { kind: "asset", assetId: "pop_1" }, volumeDb: -3 },
        { id: "s2", timelineStartMs: 200, durationMs: 700, source: { kind: "file", path: "/sdcard/whoosh.wav" }, volumeDb: 0 },
      ],
    },
  });
  // The projection on its own (what a turn that ripples them gives back), without the verbatim restore.
  const projected = toMobileEditIR({ editIR: editIRFromMobile(client), sources: client.sources, primaryAssetId: client.sources[0].assetId }).editIR;
  assert.deepEqual(projected.audio.music[0].source, { kind: "asset", assetId: "song_1" });
  assert.equal(projected.audio.sfx?.find((s) => s.id === "s1")?.durationMs, undefined, "whole-file SFX stays whole-file (was 1000 ms)");
  assert.deepEqual(projected.audio.sfx?.find((s) => s.id === "s2")?.source, { kind: "file", path: "/sdcard/whoosh.wav" });
  assert.deepEqual(projected.captions[0].words.map((w) => w.color), ["#EF4444", null], "per-word title colours kept");

  const http = MobileEditIRSchema.parse({ ...client, audio: { ...client.audio, music: [{ ...client.audio.music[0], source: { kind: "url", url: "http://legacy.example.com/a.mp3" } }] } });
  const p2 = toMobileEditIR({ editIR: editIRFromMobile(http), sources: http.sources, primaryAssetId: http.sources[0].assetId }).editIR;
  assert.deepEqual(p2.audio.music[0].source, { kind: "url", url: "http://legacy.example.com/a.mp3" }, "http music is not turned into a search");
});

test("F-05: a cut that ripples manual overlapping / short zooms moves them but does not trim or drop them", () => {
  const base = randomMobileEditIR(3);
  const client = MobileEditIRSchema.parse({
    ...base,
    zooms: [
      { id: "za", startMs: 2000, endMs: 3000, scale: 1.3, centerX: 0.5, centerY: 0.4, rampMs: 100 },
      { id: "zb", startMs: 2500, endMs: 3500, scale: 1.5, centerX: 0.5, centerY: 0.4, rampMs: 100 }, // overlaps za
      { id: "zc", startMs: 4000, endMs: 4120, scale: 1.2, centerX: 0.5, centerY: 0.4, rampMs: 0 }, // 120 ms
    ],
  });
  if (client.durationMs < 5000) return;
  const out = turn(client, [{ type: "removeRange", startSec: 0, durationSec: 1, reason: "cut the start" }]);
  const ids = out.zooms.map((z) => z.id);
  assert.deepEqual(ids, ["za", "zb", "zc"]);
  const zb = out.zooms.find((z) => z.id === "zb")!;
  assert.equal(zb.endMs - zb.startMs, 1000, "overlapping manual zoom not trimmed");
});

test("F-06: autoCaptions on a timeline with captions restyles them and keeps the hand-fixed text", () => {
  const expanded = PlanExpander.expand(
    CreativeEditPlanSchema.parse({
      intent: { platform: "general", aspectRatio: "9:16", resolution: { width: 1080, height: 1920 }, stylePreset: "CUSTOM", energy: "medium", pacing: "dynamic", captionStyle: "HORMOZI_BOUNCE", audioStyle: "VOICE_PRIORITY_DUCKED", visualStyle: "CLEAN_ATTENTION" },
      operations: [{ type: "autoCaptions", textColor: "#FFE600" }],
      confidence: 1, explanation: "",
    }),
    { transcript: [{ word: "hello", startSeconds: 0, endSeconds: 0.4 }] } as any,
    [],
    { existingCaptions: 3 }
  );
  assert.deepEqual(expanded.operations.map((o) => o.type), ["styleCaption"]);
  assert.equal((expanded.operations[0] as any).textColor, "#FFE600");

  const regen = PlanExpander.expand(
    { ...expanded, operations: [{ type: "autoCaptions", replaceExisting: true } as any] },
    { transcript: [{ word: "hello", startSeconds: 0, endSeconds: 0.4 }] } as any,
    [],
    { existingCaptions: 3 }
  );
  assert.equal(regen.operations[0].type, "clearCaptions", "explicit regenerate still works");
});

const captionFixture = (positionY: number): MobileEditIR => {
  const base = randomMobileEditIR(11);
  return MobileEditIRSchema.parse({
    ...base,
    captions: [
      { id: "k1", kind: "caption", startMs: 0, endMs: 900, text: "hand fixed", words: [{ text: "hand", startMs: 0, endMs: 400 }, { text: "fixed", startMs: 400, endMs: 900 }], style: { positionX: 0.5, positionY } },
      { id: "t1", kind: "text", startMs: 0, endMs: 900, text: "Title", words: [], style: { textColor: "#EF4444" } },
    ],
  });
};

test("F-06: styleCaption patches only the fields given, never titles or text", () => {
  const client = captionFixture(0.3);
  const out = turn(client, [{ type: "styleCaption", textColor: "#FFE600" }]);
  const cap = out.captions.find((c) => c.id === "k1")!;
  assert.equal(cap.style.textColor, "#FFE600");
  assert.equal(cap.text, "hand fixed");
  assert.equal(cap.style.positionY, 0.3, "position kept");
  assert.deepEqual(out.captions.find((c) => c.id === "t1"), client.captions.find((c) => c.id === "t1"), "title untouched");
});

test("F-08: reframe to the canvas it already has keeps manual crops and caption positions", () => {
  const client = captionFixture(0.3);
  const out = turn(client, [{ type: "reframeSubject", targetAspect: client.canvas.aspect }]);
  assert.deepEqual(out.clips.map((c) => c.crop), client.clips.map((c) => c.crop));
  assert.equal(out.captions.find((c) => c.id === "k1")!.style.positionY, 0.3);
});

test("F-08: reframe to a new canvas moves only captions at the default spot", () => {
  const moved = captionFixture(0.8);
  const placed = captionFixture(0.3);
  const target = moved.canvas.aspect === "9:16" ? "16:9" : "9:16";
  const vertical = target === "9:16";
  assert.equal(turn(moved, [{ type: "reframeSubject", targetAspect: target }]).captions.find((c) => c.id === "k1")!.style.positionY, vertical ? 0.72 : 0.8);
  assert.equal(turn(placed, [{ type: "reframeSubject", targetAspect: target }]).captions.find((c) => c.id === "k1")!.style.positionY, 0.3, "hand-placed caption stays");
});

test("F-07: addBackgroundMusic does not replace existing music unless replace is set", () => {
  const base = randomMobileEditIR(5);
  const client = MobileEditIRSchema.parse({
    ...base,
    audio: { ...base.audio, music: [{ id: "mine", timelineStartMs: 0, timelineEndMs: base.durationMs, sourceStartMs: 0, source: { kind: "asset", assetId: "song" }, volumeDb: -14, fadeInMs: 300, fadeOutMs: 900, duck: { enabled: true, duckDb: -10, attackMs: 100, releaseMs: 300 } }] },
  });
  const op = { type: "addBackgroundMusic", query: "calm piano", volumeDb: -20 };
  const kept = turn(client, [op]);
  assert.deepEqual(kept.audio.music, client.audio.music);
  const replaced = turn(client, [{ ...op, replace: true }]);
  assert.notEqual(replaced.audio.music[0].id, "mine");
});

test("F-07: addTransition '*' fills only cuts without a transition unless overwrite is set", () => {
  const base = randomMobileEditIR(2);
  const D = 6000;
  const clips = [0, 1, 2].map((i) => ({
    id: `c${i}`, assetId: base.sources[0].assetId, sourceStartMs: 0, sourceEndMs: 2000, timelineStartMs: i * 2000, timelineEndMs: (i + 1) * 2000,
    speed: 1, volumeDb: 0, crop: null, filter: null,
    transitionIn: i === 1 ? { type: "GLITCH" as const, durationMs: 300 } : null,
  }));
  const client = MobileEditIRSchema.parse({ ...base, durationMs: D, sources: [{ ...base.sources[0], durationMs: 10000 }], clips, overlays: [], captions: [], zooms: [], effects: undefined, audio: { originalTrack: { volumeDb: 0 }, music: [], speechRangesMs: [] } });
  const out = turn(client, [{ type: "addTransition", transitionType: "CROSSFADE" }]);
  assert.deepEqual(out.clips.map((c) => c.transitionIn?.type ?? null), [null, "GLITCH", "CROSSFADE"]);
  const over = turn(client, [{ type: "addTransition", transitionType: "CROSSFADE", overwrite: true }]);
  assert.deepEqual(over.clips.map((c) => c.transitionIn?.type ?? null), [null, "CROSSFADE", "CROSSFADE"]);
});

test("F-05 regression: a canvas change re-projects clips whose crop was automatic (no verbatim restore)", () => {
  const base = randomMobileEditIR(1);
  const client = MobileEditIRSchema.parse({
    ...base,
    canvas: { aspect: "16:9", width: 1920, height: 1080, fps: 30, background: "#000000" },
    sources: [{ assetId: "primary", durationMs: 4000, width: 1920, height: 1080 }],
    durationMs: 4000,
    clips: [{ id: "c0", assetId: "primary", sourceStartMs: 0, sourceEndMs: 4000, timelineStartMs: 0, timelineEndMs: 4000, speed: 1, volumeDb: 0, crop: null, filter: null, transitionIn: null }],
    overlays: [], captions: [], zooms: [], effects: undefined, itemMeta: undefined,
    audio: { originalTrack: { volumeDb: 0 }, music: [], speechRangesMs: [] },
  });
  const out = turn(client, [{ type: "reframeSubject", targetAspect: "9:16" }]);
  assert.equal(out.canvas.aspect, "9:16");
  assert.ok(out.clips[0].crop && out.clips[0].crop.height === 1 && out.clips[0].crop.width < 0.4, "16:9 footage is cropped to fill the 9:16 canvas");
});
