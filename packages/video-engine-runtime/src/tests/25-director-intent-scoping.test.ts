import assert from "node:assert";
import * as fs from "fs";
import * as path from "path";
import { DirectorIntentClassifier } from "@workspace/video-contracts";
import { MotionGraphicCardGenerator } from "../motion-graphic-card-generator";

export async function runTest() {
  // 1. Surgical Caption Only Intent
  const captionScope = DirectorIntentClassifier.classifyIntent(
    "Just add the captions in blue color in an animated way"
  );
  assert.strictEqual(captionScope.intentScope, "CHANGE_CAPTION_STYLE");
  assert.strictEqual(captionScope.isSurgicalPatch, true);
  assert.strictEqual(captionScope.captionColorOverride, "#38BDF8"); // Ice Blue
  assert.ok(captionScope.lockedTracks.includes("MAIN_VIDEO"), "Main video track MUST be locked");
  assert.ok(captionScope.lockedTracks.includes("CAMERA"), "Camera track MUST be locked");
  assert.ok(captionScope.lockedTracks.includes("AUDIO_VOICE"), "Audio voice track MUST be locked");

  // 2. Motion Graphics & Visual Explanation Intent
  const visualScope = DirectorIntentClassifier.classifyIntent(
    "Add some visuals and animated explanations according to what I am explaining in the video"
  );
  assert.strictEqual(visualScope.intentScope, "INSERT_CONTEXTUAL_VISUALS");
  assert.strictEqual(visualScope.isSurgicalPatch, true);
  assert.ok(visualScope.allowedMutations.includes("INSERT_GRAPHICS"));
  assert.ok(visualScope.lockedTracks.includes("MAIN_VIDEO"), "Main dialogue cuts MUST NOT be destroyed");

  // 3. Test Motion Graphic Card Generator
  const tempDir = path.resolve(__dirname, "../../temp_motion_test_25");
  const card = MotionGraphicCardGenerator.generateCard({
    type: "STAT_CARD",
    headline: "+150% Retention",
    subtext: "Conscious AI Director Pipeline",
    accentColor: "#38BDF8",
    outputDir: tempDir,
  });

  assert.ok(fs.existsSync(card.filePath), "Generated SVG card must exist on disk");
  const content = fs.readFileSync(card.filePath, "utf-8");
  assert.ok(content.includes("+150% Retention"));
  assert.ok(content.includes("#38BDF8"));
  assert.strictEqual(card.recommendedPosition.y, 0.22, "Must be placed in safe zone");

  // Cleanup
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  // 4. Multi-Cam Podcast Direction Intent
  const podcastScope = DirectorIntentClassifier.classifyIntent(
    "Direct this podcast between host and guest and switch camera angles"
  );
  assert.strictEqual(podcastScope.intentScope, "MULTICAM_PODCAST_DIRECT");
  assert.strictEqual(podcastScope.isSurgicalPatch, false);
  assert.ok(podcastScope.allowedMutations.includes("SWITCH_CAMERAS"));

  console.log("  ✔ Test 25 Passed: Surgical Intent Scoping, Track Locks & Motion Graphic Card Generation.");
}
