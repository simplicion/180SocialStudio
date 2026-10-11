/**
 * Editor parity E1.4: the Director reaches the editor's text motion, PiP / sticker layers and item removal through
 * tools, and what it plans survives the trip to the phone's timeline.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { EditIRCompiler } from "../src/edit-ir-compiler";
import { CreativeEditPlanSchema } from "../src/creative-plan.schema";
import { editIRFromMobileMedia, toMobileEditIR, editIRFromMobile } from "../src/mobile-edit-ir";
import { buildDirectorToolDefinitions, validateDirectorToolCalls } from "../src/director-tools";
import { constraintViolation } from "../src/director-constraints";

const media = { assetId: "primary", durationMs: 20000, width: 1080, height: 1920, fps: 30 } as any;
const sources = [{ assetId: "primary", durationMs: 20000, width: 1080, height: 1920 }];
const intent = { aspectRatio: "9:16", resolution: { width: 1080, height: 1920 } };

function run(calls: Array<{ name: string; args: any }>, base = editIRFromMobileMedia(media, "p1")) {
  const v = validateDirectorToolCalls(calls);
  assert.deepEqual(v.errors, []);
  const r = EditIRCompiler.compile(base, CreativeEditPlanSchema.parse({ intent, operations: v.operations, explanation: "t" }));
  return { r, mobile: toMobileEditIR({ editIR: r.updatedEditIR, sources, primaryAssetId: "primary" }).editIR };
}

test("tool list exposes removeItem and the new addText / insertBroll fields", () => {
  const tools = buildDirectorToolDefinitions();
  const byName = (n: string) => tools.find((t) => t.function.name === n)!.function.parameters;
  assert.ok(byName("removeItem"));
  for (const k of ["fontFamily", "enter", "exit", "loop", "glow", "strokeColor"]) assert.ok(byName("addText").properties[k], k);
  for (const k of ["layout", "position", "scale", "animationIn", "keepAudio"]) assert.ok(byName("insertBroll").properties[k], k);
});

test("addText with font, colours and motion reaches the phone timeline", () => {
  const { mobile } = run([{ name: "addText", args: {
    text: "STOP SCROLLING", timelineStartSec: 0, durationSec: 2.5, position: { x: 0, y: -0.6 }, fontFamily: "Anton",
    color: "#FF2D2D", strokeColor: "#000000", uppercase: true, glow: true,
    enter: { type: "pop", durationMs: 300 }, exit: { type: "fade", durationMs: 250 }, loop: { type: "pulse", periodMs: 800 },
  } }]);
  const t = mobile.captions.find((c) => c.kind === "text")!;
  const st = t.style as any;
  assert.equal(st.fontFamily, "Anton");
  assert.equal(st.textColor, "#FF2D2D");
  assert.equal(st.strokeColor, "#000000");
  assert.equal(st.uppercase, true);
  assert.equal(st.glow, true);
  assert.deepEqual(st.enter, { type: "pop", durationMs: 300 });
  assert.deepEqual(st.loop, { type: "pulse", periodMs: 800 });
});

test("insertBroll as an animated PiP becomes a keyframed overlay layer", () => {
  const { mobile, r } = run([{ name: "insertBroll", args: {
    sourceUrl: "https://cdn.test/chart.mp4", timelineStartSec: 3, durationSec: 4, layout: "pip", animationIn: "zoom_in", keepAudio: true,
  } }]);
  assert.match(r.appliedOperations.join("\n"), /as pip/);
  const o = mobile.overlays[0];
  assert.equal(o.fit, "contain");
  assert.equal(o.muted, false);
  assert.equal(o.layer?.mode, "overlay");
  assert.equal(o.layer?.scale, 0.42);
  assert.deepEqual(o.layer?.keyframes?.[1], { atMs: 400, scale: 0.42, opacity: 1 });
});

test("plain insertBroll stays a muted full-screen cutaway", () => {
  const { mobile } = run([{ name: "insertBroll", args: { sourceUrl: "https://cdn.test/b.mp4", timelineStartSec: 1, durationSec: 2 } }]);
  assert.equal(mobile.overlays[0].layer, undefined);
  assert.equal(mobile.overlays[0].fit, "cover");
  assert.equal(mobile.overlays[0].muted, true);
});

test("removeItem removes by id, by time, and all of a kind; reports a miss", () => {
  const { r } = run([
    { name: "addZoom", args: { startSec: 2, durationSec: 1, scale: 1.3, targetCoords: { x: 0.5, y: 0.4 } } },
    { name: "addZoom", args: { startSec: 8, durationSec: 1, scale: 1.3, targetCoords: { x: 0.5, y: 0.4 } } },
    { name: "addText", args: { text: "A", timelineStartSec: 0, durationSec: 2 } },
  ]);
  const ir = r.updatedEditIR;
  assert.equal(ir.tracks.cameraTrack.length, 2);
  const zoomId = ir.tracks.cameraTrack[0].id;
  const r2 = run([
    { name: "removeItem", args: { kind: "zoom", id: zoomId } },
    { name: "removeItem", args: { kind: "title", atSec: 1 } },
    { name: "removeItem", args: { kind: "broll" } },
  ], editIRFromMobile(toMobileEditIR({ editIR: ir, sources, primaryAssetId: "primary" }).editIR)).r;
  assert.equal(r2.updatedEditIR.tracks.cameraTrack.length, 1);
  assert.equal(r2.updatedEditIR.tracks.captionTrack.filter((c) => c.role === "title").length, 0);
  assert.match(r2.rejectedOperations.join("\n"), /removeItem: no broll/);
});

test("locks stop removeItem from touching a locked track or range", () => {
  const tl = { durationSec: 20, clips: [], musicTrackIds: [] };
  assert.match(constraintViolation({ type: "removeItem", kind: "caption" }, { lockedRanges: [], lockedTracks: ["captions"] }, tl)!, /locked captions/);
  assert.equal(constraintViolation({ type: "removeItem", kind: "zoom", atSec: 15 }, { lockedRanges: [[0, 5000]], lockedTracks: [] }, tl), null);
  assert.ok(constraintViolation({ type: "removeItem", kind: "zoom", atSec: 2 }, { lockedRanges: [[0, 5000]], lockedTracks: [] }, tl));
});

test("applyFilter exposure / warmth / tint / vignette reach the phone in phone units and round-trip", () => {
  const { mobile } = run([{ name: "applyFilter", args: { preset: "CINEMATIC_TEAL_ORANGE", exposure: 0.3, temperature: 0.5, tint: -0.2, vignette: 0.4 } }]);
  const f = mobile.clips[0].filter!;
  assert.equal(f.preset, "CINEMATIC_TEAL_ORANGE");
  assert.equal(f.exposure, 0.3);
  assert.equal(f.temperature, 0.5);
  assert.equal(f.tint, -0.2);
  assert.equal(f.vignette, 0.4);
  const back = toMobileEditIR({ editIR: editIRFromMobile(mobile), sources, primaryAssetId: "primary" }).editIR.clips[0].filter!;
  assert.deepEqual(back, f);
  const plain = run([{ name: "applyFilter", args: { preset: "VIVID" } }]).mobile.clips[0].filter!;
  assert.equal("exposure" in plain || "vignette" in plain, false);
});

test("fadeClipAudio sets clip fades that reach the phone and round-trip", () => {
  const { mobile, r } = run([{ name: "fadeClipAudio", args: { fadeInSec: 0.5, fadeOutSec: 5 } }]);
  assert.match(r.appliedOperations.join("\n"), /Faded clip audio/);
  const c = mobile.clips[0];
  assert.equal(c.audioFadeInMs, 500);
  assert.equal(c.audioFadeOutMs, 5000);
  const back = toMobileEditIR({ editIR: editIRFromMobile(mobile), sources, primaryAssetId: "primary" }).editIR.clips[0];
  assert.equal(back.audioFadeInMs, 500);
  assert.equal(back.audioFadeOutMs, 5000);
  assert.match(run([{ name: "fadeClipAudio", args: { clipId: "nope", fadeInSec: 1 } }]).r.rejectedOperations.join(), /no main clip/);
});

test("addSticker places an emoji image layer the phone draws itself; non-emoji is rejected", () => {
  const { mobile, r } = run([{ name: "addSticker", args: { emoji: "🔥", timelineStartSec: 4, durationSec: 2 } }]);
  assert.match(r.appliedOperations.join("\n"), /🔥 sticker/);
  const o = mobile.overlays[0];
  assert.deepEqual(o.source, { kind: "asset", assetId: "emoji:🔥" });
  assert.equal(o.mediaType, "image");
  assert.equal(o.fit, "contain");
  assert.equal(o.layer?.mode, "overlay");
  assert.equal(o.layer?.scale, 0.26);
  assert.equal(o.layer?.keyframes?.length, 2);
  assert.deepEqual(toMobileEditIR({ editIR: editIRFromMobile(mobile), sources, primaryAssetId: "primary" }).editIR.overlays[0].source, o.source);
  assert.match(validateDirectorToolCalls([{ name: "addSticker", args: { emoji: "<script>", timelineStartSec: 1 } }]).errors.join(), /emoji/);
});

test("insertBroll greenScreen keys out the background as a full-frame layer, and the key round-trips", () => {
  const { mobile } = run([{ name: "insertBroll", args: { sourceUrl: "https://cdn.test/gs.mp4", timelineStartSec: 1, durationSec: 3, greenScreen: "green" } }]);
  const o = mobile.overlays[0];
  assert.deepEqual(o.chromaKey, { color: "#00FF00", similarity: 0.3, smoothness: 0.1, spill: 0.5 });
  assert.equal(o.layer?.mode, "overlay");
  assert.equal(o.layer?.scale, 1);
  const back = toMobileEditIR({ editIR: editIRFromMobile(mobile), sources, primaryAssetId: "primary" }).editIR.overlays[0];
  assert.deepEqual(back.chromaKey, o.chromaKey);
});

test("beatAlign trims cuts back onto real beats, and refuses to guess without beat analysis", () => {
  const base = editIRFromMobileMedia(media, "p1");
  // Two clips: cut at 8.0 s (split), beats every 0.5 s with one at 7.85 s.
  const split = EditIRCompiler.compile(base, CreativeEditPlanSchema.parse({ intent, operations: [{ type: "splitClip", clipId: base.tracks.videoTracks[0].clips[0].id, splitTimeSec: 8 }], explanation: "t" })).updatedEditIR;
  const ops = validateDirectorToolCalls([{ name: "beatAlign", args: { snapToleranceSec: 0.3 } }]).operations as any[];
  const withBeats = [{ ...ops[0], beatsSec: [7.35, 7.85, 8.35] }];
  const r = EditIRCompiler.compile(split, CreativeEditPlanSchema.parse({ intent, operations: withBeats, explanation: "t" }));
  assert.match(r.appliedOperations.join("\n"), /Moved 1 cut\(s\) onto the beat/);
  const clips = r.updatedEditIR.tracks.videoTracks[0].clips;
  assert.ok(Math.abs(clips[0].timelineRange.duration.value / clips[0].timelineRange.duration.timescale - 7.85) < 0.01);
  const none = EditIRCompiler.compile(split, CreativeEditPlanSchema.parse({ intent, operations: ops, explanation: "t" }));
  assert.match(none.rejectedOperations.join(), /no beat analysis/);
  assert.equal(none.appliedOperations.some((a) => /beat|bpm/i.test(a)), false);
});

test("addNarration becomes a voiceover the phone speaks (tts:<text>) and round-trips", () => {
  const { mobile, r } = run([{ name: "addNarration", args: { text: "Wait for the last tip", timelineStartSec: 2 } }]);
  assert.match(r.appliedOperations.join("\n"), /AI narration/);
  const v = mobile.audio.voiceovers![0];
  assert.deepEqual(v.source, { kind: "asset", assetId: "tts:Wait for the last tip" });
  assert.equal(v.timelineStartMs, 2000);
  assert.ok(v.durationMs > 1500 && v.durationMs < 3000);
  const back = toMobileEditIR({ editIR: editIRFromMobile(mobile), sources, primaryAssetId: "primary" }).editIR.audio.voiceovers![0];
  assert.deepEqual(back.source, v.source);
});

test("cleanVoice turns on noise reduction for the clips and it round-trips", () => {
  const { mobile, r } = run([{ name: "cleanVoice", args: {} }]);
  assert.match(r.appliedOperations.join("\n"), /Reduced background noise on 1 clip/);
  assert.equal(mobile.clips[0].voiceCleanup, true);
  assert.equal(toMobileEditIR({ editIR: editIRFromMobile(mobile), sources, primaryAssetId: "primary" }).editIR.clips[0].voiceCleanup, true);
});

test("insertBroll pip with shape circle carries a mask that round-trips", () => {
  const { mobile } = run([{ name: "insertBroll", args: { sourceUrl: "https://cdn.test/cam.mp4", timelineStartSec: 1, durationSec: 3, layout: "pip", shape: "circle" } }]);
  assert.deepEqual(mobile.overlays[0].mask, { shape: "circle", radius: 0.15, feather: 0.01 });
  assert.deepEqual(toMobileEditIR({ editIR: editIRFromMobile(mobile), sources, primaryAssetId: "primary" }).editIR.overlays[0].mask, mobile.overlays[0].mask);
});

test("speedRamp splits the clip into the preset's parts with their speeds", () => {
  const base = editIRFromMobileMedia(media, "p1");
  const clipId = base.tracks.videoTracks[0].clips[0].id;
  const r = EditIRCompiler.compile(base, CreativeEditPlanSchema.parse({ intent, operations: validateDirectorToolCalls([{ name: "speedRamp", args: { clipId, preset: "hero" } }]).operations, explanation: "t" }));
  assert.match(r.appliedOperations.join("\n"), /Speed ramp "hero"/);
  const clips = r.updatedEditIR.tracks.videoTracks[0].clips;
  assert.deepEqual(clips.map((c) => c.speedMultiplier), [1, 0.4, 1]);
  // The slow middle part is longer on the timeline than in the source.
  const mid = clips[1];
  const tl = mid.timelineRange.duration.value / mid.timelineRange.duration.timescale;
  const src = mid.sourceRange.duration.value / mid.sourceRange.duration.timescale;
  assert.ok(tl > src * 2.4, `${tl} vs ${src}`);
});

test("processFootage queues phone-side reverse / stabilise / cut-out flags that round-trip to the phone", () => {
  const base = editIRFromMobileMedia(media, "p1");
  const clipId = base.tracks.videoTracks[0].clips[0].id;
  const r = EditIRCompiler.compile(base, CreativeEditPlanSchema.parse({ intent, operations: validateDirectorToolCalls([{ name: "processFootage", args: { action: "stabilize", targetId: clipId } }]).operations, explanation: "t" }));
  assert.match(r.appliedOperations.join("\n"), /Queued stabilize/);
  const mobile = toMobileEditIR({ editIR: r.updatedEditIR, sources, primaryAssetId: "primary" }).editIR;
  assert.equal(mobile.clips[0].process, "stabilize");
  assert.equal(toMobileEditIR({ editIR: editIRFromMobile(mobile), sources, primaryAssetId: "primary" }).editIR.clips[0].process, "stabilize");
  const withPip = run([{ name: "insertBroll", args: { sourceUrl: "https://cdn.test/p.mp4", timelineStartSec: 1, durationSec: 2 } }]).mobile;
  const cut = EditIRCompiler.compile(editIRFromMobile(withPip), CreativeEditPlanSchema.parse({ intent, operations: validateDirectorToolCalls([{ name: "processFootage", args: { action: "remove_background", targetId: withPip.overlays[0].id } }]).operations, explanation: "t" }));
  const o = toMobileEditIR({ editIR: cut.updatedEditIR, sources, primaryAssetId: "primary" }).editIR.overlays[0];
  assert.equal(o.process, "remove_background");
  assert.equal(o.layer?.mode, "overlay");
});

test("addSticker style 3d leaves a named library lookup (with the emoji as fallback) for the phone", () => {
  const { mobile } = run([{ name: "addSticker", args: { emoji: "🚀", name: "rocket", style: "3d", timelineStartSec: 2 } }]);
  const o = mobile.overlays[0];
  assert.deepEqual(o.source, { kind: "stock_query", query: "sticker3d:rocket|🚀", url: null });
  assert.equal(o.mediaType, "image");
  assert.equal(o.layer?.mode, "overlay");
});
