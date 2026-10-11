import assert from "node:assert";
import { DirectorStyleResolver } from "@workspace/video-contracts";

export async function runTest() {
  // 1. Dan Koe Minimalist
  const styleDanKoe = DirectorStyleResolver.resolve("I want a clean Dan Koe minimalist aesthetic vertical reel");
  assert.strictEqual(styleDanKoe.presetKey, "DAN_KOE_MINIMALIST");
  assert.strictEqual(styleDanKoe.targetAspect, "9:16");
  assert.strictEqual(styleDanKoe.pacingMultiplier, 1.0);
  assert.strictEqual(styleDanKoe.zoomScale, 1.12);
  assert.strictEqual(styleDanKoe.captionColors.highlight, "#38BDF8"); // Ice Blue
  assert.strictEqual(styleDanKoe.safeMarginVPercent, 0.22);

  // 2. MrBeast Fast
  const styleMrBeast = DirectorStyleResolver.resolve("Make this super aggressive MrBeast fast viral style");
  assert.strictEqual(styleMrBeast.presetKey, "MRBEAST_FAST");
  assert.strictEqual(styleMrBeast.pacingMultiplier, 1.35);
  assert.strictEqual(styleMrBeast.zoomScale, 1.35);
  assert.strictEqual(styleMrBeast.deadAirTrimThresholdSeconds, 0.25);
  assert.strictEqual(styleMrBeast.captionColors.highlight, "#00FF88"); // Neon Green
  assert.strictEqual(styleMrBeast.duckingDb, -20.0);

  // 3. MagnatesMedia Mystery
  const styleMystery = DirectorStyleResolver.resolve("Edit this like a MagnatesMedia mystery documentary deep dive");
  assert.strictEqual(styleMystery.presetKey, "MAGNATES_MEDIA_MYSTERY");
  assert.strictEqual(styleMystery.captionColors.highlight, "#E11D48"); // Crimson
  assert.strictEqual(styleMystery.soundDesignEnabled, true);

  // 4. Vox Explainer
  const styleVox = DirectorStyleResolver.resolve("Create a Vox explainer video with motion graphics");
  assert.strictEqual(styleVox.presetKey, "VOX_EXPLAINER");
  assert.strictEqual(styleVox.captionColors.highlight, "#F59E0B"); // Amber Gold
  assert.strictEqual(styleVox.brollFrequencySeconds, 5.0);

  // 5. Alex Hormozi Viral
  const styleHormozi = DirectorStyleResolver.resolve("Apply Alex Hormozi viral captions and zooms");
  assert.strictEqual(styleHormozi.presetKey, "HORMOZI_VIRAL");
  assert.strictEqual(styleHormozi.captionColors.highlight, "#FFFF00"); // Yellow
  assert.strictEqual(styleHormozi.captionPreset, "HORMOZI_BOUNCE");
  assert.strictEqual(styleHormozi.zoomScale, 1.30);

  // 6. Conscious Research Synthesis
  const query = "Ali Abdaal productivity studio";
  const research = "Clean pastel colors, gentle 1.1x zooms, subtle lofi music, warm yellow highlights, high clarity";
  const synthesized = DirectorStyleResolver.synthesizeFromResearch(query, research);

  assert.ok(synthesized.aestheticRationale.includes("Conscious research resolved"));
  assert.strictEqual(synthesized.captionColors.highlight, "#FFFF00");
  assert.ok(synthesized.zoomScale <= 1.25);

  console.log("  ✔ Test 21 Passed: Conscious style resolver & dynamic research synthesis.");
}
