/**
 * Speaker diarization reaches the Director: a transcript word's `speaker` (from services/diarize-worker) becomes the
 * graph word's speakerId, mapped through the cuts like every word.
 *
 * Run: npx tsx --test packages/video-contracts/tests/speaker-labels.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { editIRFromMobile, MobileEditIRSchema, MobileMediaDescriptorSchema } from "../src/mobile-edit-ir";
import { graphFromMobileMedia } from "../src/plan-expander";

const ir = MobileEditIRSchema.parse({
  schemaVersion: "mobile-editir/1", projectId: "spk",
  canvas: { aspect: "9:16", width: 1080, height: 1920, fps: 30, background: "#000000" },
  durationMs: 4000,
  sources: [{ assetId: "primary", durationMs: 4000, width: 1080, height: 1920 }],
  clips: [{ id: "c0", assetId: "primary", sourceStartMs: 0, sourceEndMs: 4000, timelineStartMs: 0, timelineEndMs: 4000, speed: 1, volumeDb: 0, crop: null, filter: null, transitionIn: null }],
  overlays: [], captions: [], zooms: [],
  audio: { originalTrack: { volumeDb: 0 }, music: [], speechRangesMs: [] },
});

test("labelled words carry their speaker into the Director's graph", () => {
  const media = MobileMediaDescriptorSchema.parse({
    assetId: "primary", durationMs: 4000, width: 1080, height: 1920,
    transcript: { words: [
      { text: "So", startMs: 100, endMs: 300, speaker: "S1" },
      { text: "why?", startMs: 500, endMs: 800, speaker: "S1" },
      { text: "Because", startMs: 1500, endMs: 1900, speaker: "S2" },
      { text: "yes", startMs: 2000, endMs: 2200 },
    ] },
  });
  const g = graphFromMobileMedia(media, editIRFromMobile(ir));
  const words = (g as any).transcript?.words ?? (g as any).words;
  assert.ok(Array.isArray(words), "the graph has words");
  assert.deepEqual(words.map((w: any) => w.speakerId), ["S1", "S1", "S2", undefined]);
});
