import {
  EditIR,
  EditIRSchema,
  RationalTimeMath,
  VideoCriticService,
  EditIRCompiler,
  CreativeEditPlan,
} from "@workspace/video-contracts";
import * as crypto from "crypto";

/**
 * TEST 14: AI Critic & Autonomous Repair Loop
 * Validates that the QA Critic analyzes timeline pacing, detects retention flaws,
 * and executes a bounded repair loop (max 3 iterations) to elevate retention scores.
 */
export async function runTest(): Promise<boolean> {
  console.log("\n[Test 14] AI Critic & Autonomous Repair Loop...");

  const totalDurationSec = 14.0;
  const totalDuration = RationalTimeMath.fromSeconds(totalDurationSec);

  // 1. Setup an initial raw timeline: 14s talking head with NO camera zooms and NO captions
  let currentIR: EditIR = {
    version: "1.0.0",
    meta: {
      projectId: crypto.randomUUID(),
      title: "Raw Unedited Talking Head",
      targetAspect: "9:16",
      resolution: { width: 1080, height: 1920 },
      fps: { numerator: 30, denominator: 1 },
      totalDuration,
    },
    directorStyle: {
      preset: "MRBEAST_FAST",
      pacingMultiplier: 1.0,
      zoomAggressiveness: 0.5,
      brollFrequencySeconds: 10.0,
    },
    tracks: {
      videoTracks: [
        {
          id: crypto.randomUUID(),
          type: "MAIN_VIDEO",
          zIndex: 0,
          clips: [
            {
              id: crypto.randomUUID(),
              assetId: "asset_raw_speech",
              sourcePath: "C:/footage/speech.mp4",
              sourceRange: { start: RationalTimeMath.fromSeconds(0), duration: totalDuration },
              timelineRange: { start: RationalTimeMath.fromSeconds(0), duration: totalDuration },
              transform: {
                scale: { start: 1, end: 1, easing: "linear" },
                position: { x: 0, y: 0 },
                anchor: { x: 0.5, y: 0.5 },
                rotationDeg: 0,
                opacity: 1,
              },
              speedMultiplier: 1,
              effects: [],
            },
          ],
        },
      ],
      cameraTrack: [],
      captionTrack: [],
      audioTracks: [],
    },
  };

  // 2. Initial Critic Evaluation
  const initialCritique = VideoCriticService.analyze(currentIR);
  console.log(`  Initial Critic Score: ${initialCritique.overallScore}/100 | Issues: ${initialCritique.issues.length}`);
  if (initialCritique.issues.length === 0) {
    throw new Error("Critic failed to flag unpaced 14s talking head segment without zooms or captions");
  }

  // 3. Autonomous Critic-Repair Loop (Max 3 iterations)
  const MAX_REPAIR_ITERATIONS = 3;
  let iterations = 0;
  let scoreAchieved = initialCritique.overallScore;

  while (iterations < MAX_REPAIR_ITERATIONS) {
    iterations++;
    const critique = VideoCriticService.analyze(currentIR);
    scoreAchieved = critique.overallScore;

    if (critique.issues.length === 0 || scoreAchieved >= 95) {
      console.log(`  ✓ Quality Invariant satisfied at iteration ${iterations} (Score: ${scoreAchieved}/100)`);
      break;
    }

    console.log(`  [Repair Iteration ${iterations}/${MAX_REPAIR_ITERATIONS}] Found ${critique.issues.length} issues. Applying autonomous repairs...`);

    // Formulate a targeted repair plan based on detected flaws
    const repairOperations: any[] = [];

    for (const issue of critique.issues) {
      if (issue.category === "PACING" && issue.timeRangeSec) {
        // Inject a punch zoom in the middle of the unpaced span
        const zoomStart = issue.timeRangeSec.start + Math.min(2.0, issue.timeRangeSec.duration / 2);
        repairOperations.push({
          type: "addZoom",
          startSec: zoomStart,
          durationSec: 1.5,
          targetType: "FACE",
          targetCoords: { x: 0.5, y: 0.35 },
          scale: 1.3,
          motionBlur: true,
        });
      } else if (issue.category === "SUBTITLE") {
        // Inject kinetic bouncing subtitles
        repairOperations.push({
          type: "addCaption",
          startSec: 0.5,
          durationSec: 4.0,
          text: "Mastering Autonomous Video Editing",
          words: [
            { word: "Mastering", startSec: 0.5, endSec: 1.2, highlight: true, scale: 1.2 },
            { word: "Autonomous", startSec: 1.3, endSec: 2.2, highlight: true, scale: 1.3 },
            { word: "Video", startSec: 2.3, endSec: 2.9, highlight: false, scale: 1.0 },
            { word: "Editing", startSec: 3.0, endSec: 3.9, highlight: true, scale: 1.25 },
          ],
          stylePreset: "HORMOZI_BOUNCE",
        });
      }
    }

    if (repairOperations.length === 0) break;

    const repairPlan: CreativeEditPlan = {
      version: "1.0.0",
      intent: {
        platform: "instagram",
        aspectRatio: "9:16",
        resolution: { width: 1080, height: 1920 },
        pacing: "fast-natural",
        energy: "high",
        stylePreset: "MRBEAST_FAST",
        captionStyle: "HORMOZI_BOUNCE",
        audioStyle: "VOICE_PRIORITY_DUCKED",
        visualStyle: "CLEAN_ATTENTION",
      },
      constraints: {
        doNotRemoveIntro: false,
        keepEnding: false,
        protectedTimeRanges: [],
        doNotAddMusic: false,
        useUploadedBrollOnly: true,
        lockedTrackIds: [],
        preserveVoiceAudio: true,
      },
      selectedSegments: [],
      removedSegments: [],
      reorderedSegments: [],
      brollPlan: [],
      captionPlan: [],
      operations: repairOperations,
      confidence: 0.98,
      explanation: `Critic autonomous repair iteration ${iterations}`,
      requiresConfirmation: false,
    };

    const compilation = EditIRCompiler.compile(currentIR, repairPlan);
    currentIR = compilation.updatedEditIR;
  }

  // 4. Validate Final State
  const finalCritique = VideoCriticService.analyze(currentIR);
  console.log(`  Final Critic Score: ${finalCritique.overallScore}/100 (Retention: ${finalCritique.retentionPrediction}%)`);

  if (finalCritique.overallScore <= initialCritique.overallScore) {
    throw new Error(`Critic-repair loop failed to improve score: ${finalCritique.overallScore} <= ${initialCritique.overallScore}`);
  }

  // Schema gatekeeper check
  const schemaRes = EditIRSchema.safeParse(currentIR);
  if (!schemaRes.success) {
    throw new Error(`Repaired EditIR failed schema validation: ${JSON.stringify(schemaRes.error)}`);
  }
  console.log("  ✓ Final repaired EditIR passed EditIRSchema validation");
  console.log(`  ✓ Critic-repair loop successfully converged in ${iterations} iterations`);

  return true;
}

if (process.argv[1]?.includes("14-critic-repair-loop.test.ts")) {
  runTest()
    .then(() => console.log("✓ Test 14 Passed Successfully.\n"))
    .catch((err) => {
      console.error("❌ Test 14 Failed:", err);
      process.exit(1);
    });
}
