import assert from "node:assert";
import { PsychoacousticSoundDesigner } from "../intelligence/psychoacoustic-sound-designer";
import { CinematicColorGradePipeline } from "../cinematic-color-grade-pipeline";

export async function runTest() {
  // 1. Psychoacoustic Sound Stage
  const soundStage = PsychoacousticSoundDesigner.designSoundStage(
    60.0,
    [5.0, 22.0, 48.0], // 3 high emphasis moments
    [3.0, 15.0, 30.0, 45.0] // 4 visual transition moments
  );

  assert.strictEqual(soundStage.layers.length, 4, "Must contain exactly 4 audio stem layers");
  assert.strictEqual(soundStage.integratedLoudnessTargetLufs, -16.0, "Vocal loudness target must be -16 LUFS");
  assert.strictEqual(soundStage.roomToneFloorDb, -44.0, "Room tone acoustic floor must be -44 dB");
  assert.ok(soundStage.totalTransientTriggers >= 6, "Must generate sub-drops and whoosh transient triggers");

  // Check Layer 3 (Frequency-Pocketed BGM)
  const bgmLayer = soundStage.layers.find((l) => l.type === "BGM_POCKETED");
  assert.ok(bgmLayer, "BGM layer must exist");
  assert.strictEqual(bgmLayer.duckWithSpeech, true, "BGM must duck with speech");
  assert.strictEqual(bgmLayer.duckingDb, -18.0, "Ducking depth must be -18 dB");

  // 2. Cinematic Color Grade Pipeline
  const filmicLook = CinematicColorGradePipeline.resolveLook("FILMIC_CLEAN");
  assert.ok(filmicLook.ffmpegFilterExpression.includes("curves=preset=medium_contrast"));
  assert.ok(filmicLook.filmGrainOpacity > 0);

  const tealOrangeLook = CinematicColorGradePipeline.resolveLook("TEAL_ORANGE_BLOCKBUSTER");
  assert.ok(tealOrangeLook.ffmpegFilterExpression.includes("colorbalance"));
  assert.strictEqual(tealOrangeLook.contrastMultiplier, 1.10);

  console.log("  ✔ Test 23 Passed: 4-Layer Psychoacoustic Sound Stage & Cinematic Look Pipeline.");
}
