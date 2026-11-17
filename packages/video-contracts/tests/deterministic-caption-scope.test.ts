/**
 * Offline planner and existing captions (regression from ab9d61f): "make the captions yellow" must change only the
 * colour; a full template restyle happens only when the creator names a look.
 * Run: npx tsx --test packages/video-contracts/tests/deterministic-caption-scope.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { DeterministicPlanner } from "../src/deterministic-planner";

const context: any = {
  projectDurationSec: 12, tracksCount: 2, clipsCount: 1, assetIds: ["primary"], currentAspect: "9:16",
  currentResolution: { width: 1080, height: 1920 }, currentPlayheadSec: 0, existingCaptionsCount: 3,
  existingEffects: [], existingAudioTracks: [], lockedTrackIds: [], directorPreferences: {},
  userConstraints: { doNotRemoveIntro: false, keepEnding: false, protectedTimeRanges: [], doNotAddMusic: false, useUploadedBrollOnly: false, lockedTrackIds: [], preserveVoiceAudio: true },
};
const w = (id: string, word: string, s: number) => ({ id, word, startSeconds: s, endSeconds: s + 0.3, confidence: 0.98, isEmphasis: false, emphasisScore: 0, energyScore: 0.5 });
const graph: any = {
  transcript: [w("w1", "Here", 0.5), w("w2", "is", 0.9), w("w3", "the", 1.3), w("w4", "secret", 1.7)],
  silences: [], faces: [], audioEvents: [], brollOpportunities: [], fillerWords: [], sceneChanges: [],
};
const captionOps = (prompt: string) => DeterministicPlanner.plan(prompt, context, graph).operations.filter((o) => o.type === "styleCaption" || o.type === "applyCaptionTemplate" || o.type === "addCaption" || o.type === "autoCaptions");

test("'make the captions yellow' on existing captions patches only the colour (no preset restyle)", () => {
  const ops = captionOps("make the captions yellow");
  assert.equal(ops.length, 1, JSON.stringify(ops));
  const op = ops[0] as any;
  assert.equal(op.type, "styleCaption");
  assert.equal(op.preset, undefined, "no template restyle: font, size and stroke stay");
  assert.match(op.highlightColor, /^#/);
});

test("naming a look restyles existing captions with that template", () => {
  const op = captionOps("give the captions the hormozi style")[0] as any;
  assert.equal(op?.type, "applyCaptionTemplate");
  assert.equal(op.templateId, "SPOTLIGHT_WORD");
});
