/**
 * Editor parity E1: overlay layers (PiP / keyframes / fit / overlay audio) and text motion + glow survive the
 * mobile → EditIR → mobile round trip that every AI Director turn performs. They used to be dropped silently.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { EditIRCompiler } from "../src/edit-ir-compiler";
import { CreativeEditPlanSchema } from "../src/creative-plan.schema";
import { editIRFromMobileMedia, toMobileEditIR, editIRFromMobile, MobileEditIRSchema } from "../src/mobile-edit-ir";

const media = { assetId: "primary", durationMs: 10000, width: 1080, height: 1920, fps: 30 } as any;
const sources = [{ assetId: "primary", durationMs: 10000, width: 1080, height: 1920 }];

function baseMobile() {
  const r = EditIRCompiler.compile(
    editIRFromMobileMedia(media, "p1"),
    CreativeEditPlanSchema.parse({ intent: { aspectRatio: "9:16", resolution: { width: 1080, height: 1920 } }, operations: [], explanation: "t" }),
  );
  return toMobileEditIR({ editIR: r.updatedEditIR, sources, primaryAssetId: "primary" }).editIR;
}

test("overlay layer, contain fit, keyframes and overlay audio survive the round trip", () => {
  const m = baseMobile();
  m.overlays.push({
    id: "pip1", kind: "broll", timelineStartMs: 1000, timelineEndMs: 4000, sourceStartMs: 0,
    source: { kind: "url", url: "https://cdn.test/b.mp4" } as any, fit: "contain", opacity: 0.8, muted: false,
    layer: { mode: "overlay", x: 0.75, y: 0.25, scale: 0.4, rotation: 5, keyframes: [{ atMs: 0, scale: 0.2 }, { atMs: 500, scale: 0.4, opacity: 1 }] },
  });
  assert.equal(MobileEditIRSchema.safeParse(m).success, true, JSON.stringify(MobileEditIRSchema.safeParse(m).error?.issues));
  const back = toMobileEditIR({ editIR: editIRFromMobile(m), sources, primaryAssetId: "primary" }).editIR;
  const o = back.overlays.find((x) => x.id === "pip1")!;
  assert.deepEqual(o.layer, m.overlays[0].layer);
  assert.equal(o.fit, "contain");
  assert.equal(o.muted, false);
  assert.equal(o.opacity, 0.8);
});

test("text motion and glow survive the round trip", () => {
  const m = baseMobile();
  m.captions.push({
    id: "t1", kind: "text", startMs: 0, endMs: 3000, text: "HELLO", words: [],
    style: {
      preset: "TPL_BOLD", animation: "none", fontFamily: "Anton", fontWeight: 800, fontSizePx: 80, textColor: "#FFFFFF",
      highlightColor: "#FFE600", strokeColor: "#000000", strokeWidthPx: 4, shadow: true, background: null, uppercase: true,
      positionX: 0.5, positionY: 0.3, maxWidthFraction: 0.86, glow: true,
      enter: { type: "slide_up", durationMs: 400 }, exit: { type: "fade", durationMs: 300 }, loop: { type: "pulse", periodMs: 900 },
    },
  } as any);
  assert.equal(MobileEditIRSchema.safeParse(m).success, true);
  const back = toMobileEditIR({ editIR: editIRFromMobile(m), sources, primaryAssetId: "primary" }).editIR;
  const st = back.captions.find((c) => c.id === "t1")!.style as any;
  assert.equal(st.glow, true);
  assert.deepEqual(st.enter, { type: "slide_up", durationMs: 400 });
  assert.deepEqual(st.exit, { type: "fade", durationMs: 300 });
  assert.deepEqual(st.loop, { type: "pulse", periodMs: 900 });
});

test("an old overlay without a layer stays a cutaway (no layer field invented)", () => {
  const m = baseMobile();
  m.overlays.push({ id: "b1", kind: "broll", timelineStartMs: 0, timelineEndMs: 2000, sourceStartMs: 0, source: { kind: "url", url: "https://cdn.test/b.mp4" } as any, fit: "cover", opacity: 1, muted: true });
  const back = toMobileEditIR({ editIR: editIRFromMobile(m), sources, primaryAssetId: "primary" }).editIR;
  assert.equal("layer" in back.overlays[0], false);
  assert.equal(back.overlays[0].muted, true);
});

test("voiceovers round-trip as a VOICEOVER track with their recording reference and fades", () => {
  const m = baseMobile();
  m.audio.voiceovers = [{ id: "vo1", timelineStartMs: 2000, durationMs: 3500, sourceStartMs: 0, source: { kind: "asset", assetId: "rec_1" }, volumeDb: 2, fadeInMs: 200, fadeOutMs: 300 }];
  assert.equal(MobileEditIRSchema.safeParse(m).success, true);
  const ir = editIRFromMobile(m);
  const track = ir.tracks.audioTracks.find((t) => t.type === "VOICEOVER")!;
  assert.equal(track.clips[0].sourcePath, "asset://rec_1");
  const back = toMobileEditIR({ editIR: ir, sources, primaryAssetId: "primary" }).editIR;
  assert.deepEqual(back.audio.voiceovers, m.audio.voiceovers);
  assert.equal(toMobileEditIR({ editIR: editIRFromMobile(baseMobile()), sources, primaryAssetId: "primary" }).editIR.audio.voiceovers, undefined);
});

test("watermark survives the mobile -> EditIR -> mobile round trip with all coordinates", () => {
  const m = baseMobile();
  m.watermark = {
    imageUrl: "https://workspace180.com/brand-logo.png",
    position: "top_right",
    opacityPct: 90,
    widthFraction: 0.18,
    localPath: "/tmp/cached_watermark.png",
    x: 0.8,
    y: 0.05,
    width: 0.18,
    height: 0.1,
  };
  assert.equal(MobileEditIRSchema.safeParse(m).success, true);
  const ir = editIRFromMobile(m);
  assert.equal((ir.meta as any).watermark?.imageUrl, "https://workspace180.com/brand-logo.png");
  const back = toMobileEditIR({ editIR: ir, sources, primaryAssetId: "primary" }).editIR;
  assert.deepEqual(back.watermark, m.watermark);
});


test("brand watermark keeps every attribute through EditIR and back (and an explicit input wins)", () => {
  const m = baseMobile();
  (m as any).watermark = {
    imageUrl: "https://cdn.test/logo.png", position: "bottom_left", opacityPct: 70, widthFraction: 0.2,
    localPath: "/data/logo.png", x: 0.05, y: 0.9, width: 0.2, height: 0.08,
  };
  assert.equal(MobileEditIRSchema.safeParse(m).success, true, JSON.stringify(MobileEditIRSchema.safeParse(m).error?.issues));
  const ir = editIRFromMobile(m);
  assert.equal((ir.meta as any).watermark?.imageUrl, "https://cdn.test/logo.png");
  const back = toMobileEditIR({ editIR: ir, sources, primaryAssetId: "primary" }).editIR;
  assert.deepEqual(back.watermark, (m as any).watermark);
  const override = toMobileEditIR({ editIR: ir, sources, primaryAssetId: "primary", watermark: { imageUrl: "https://cdn.test/other.png" } as any }).editIR;
  assert.equal(override.watermark?.imageUrl, "https://cdn.test/other.png");
  assert.equal(override.watermark?.position, "top_right");
});
