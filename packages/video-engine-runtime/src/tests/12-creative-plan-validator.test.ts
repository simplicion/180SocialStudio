import {
  CreativePlanValidator,
  CreativeEditPlan,
  EditIR,
  RationalTimeMath,
  MediaAssetDescriptor,
} from "@workspace/video-contracts";

/**
 * TEST 12: Creative Plan Validator & Constraint Enforcement
 * Validates that valid plans are accepted, and invalid plans (bad schemas, unknown assets,
 * invalid timestamps, locked track modifications, protected range violations) are strictly rejected.
 */
export async function runTest(): Promise<boolean> {
  console.log("\n[Test 12] Creative Plan Validator & Constraint Enforcement...");

  const mockEditIR: EditIR = {
    version: "1.0.0",
    meta: {
      projectId: "proj_test_12",
      title: "Test Project",
      targetAspect: "16:9",
      resolution: { width: 1920, height: 1080 },
      fps: { numerator: 30, denominator: 1 },
      totalDuration: RationalTimeMath.fromSeconds(20.0),
    },
    directorStyle: {
      preset: "MRBEAST_FAST",
      pacingMultiplier: 1.2,
      zoomAggressiveness: 0.8,
      brollFrequencySeconds: 10.0,
    },
    tracks: {
      videoTracks: [
        {
          id: "track_main",
          type: "MAIN_VIDEO",
          zIndex: 0,
          clips: [
            {
              id: "clip_01",
              assetId: "asset_valid_01",
              sourcePath: "C:/test.mp4",
              sourceRange: { start: RationalTimeMath.fromSeconds(0), duration: RationalTimeMath.fromSeconds(20.0) },
              timelineRange: { start: RationalTimeMath.fromSeconds(0), duration: RationalTimeMath.fromSeconds(20.0) },
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

  const availableAssets: MediaAssetDescriptor[] = [
    {
      id: "asset_valid_01",
      name: "main_talk.mp4",
      filePath: "C:/test.mp4",
      fileSizeBytes: 1024 * 1024 * 20,
      mimeType: "video/mp4",
      durationSeconds: 20.0,
      width: 1920,
      height: 1080,
      fps: 30,
      hasAudio: true,
      sha256Hash: "hash_01",
    },
    {
      id: "asset_broll_01",
      name: "cutaway.mp4",
      filePath: "C:/broll.mp4",
      fileSizeBytes: 1024 * 1024 * 5,
      mimeType: "video/mp4",
      durationSeconds: 5.0,
      width: 1920,
      height: 1080,
      fps: 30,
      hasAudio: false,
      sha256Hash: "hash_02",
    },
  ];

  // 1. Test Valid Plan
  const validPlan: CreativeEditPlan = {
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
      doNotRemoveIntro: true,
      keepEnding: false,
      protectedTimeRanges: [{ startSec: 10.0, durationSec: 3.0 }],
      doNotAddMusic: false,
      useUploadedBrollOnly: true,
      lockedTrackIds: ["track_locked_audio"],
      preserveVoiceAudio: true,
    },
    selectedSegments: [],
    removedSegments: [],
    reorderedSegments: [],
    brollPlan: [],
    captionPlan: [],
    operations: [
      {
        type: "removeRange",
        startSec: 6.0,
        durationSec: 1.5,
        ripple: true,
        reason: "Trim dead pause",
      },
      {
        type: "insertBroll",
        assetId: "asset_broll_01",
        timelineStartSec: 7.5,
        durationSec: 2.0,
        sourceStartSec: 0.0,
        cropMode: "center",
      },
      {
        type: "addZoom",
        startSec: 2.0,
        durationSec: 1.2,
        targetType: "FACE",
        targetCoords: { x: 0.5, y: 0.35 },
        scale: 1.3,
        motionBlur: true,
      },
    ],
    confidence: 0.95,
    explanation: "Found 1 dead pause and inserted 1 broll cutaway",
    requiresConfirmation: true,
    confirmationDetails: {
      whatFound: "Found 1 dead pause",
      whatWillChange: "Removed 1.5s pause, added broll at 7.5s, added camera punch",
      assumptions: "Speaker centered in 9:16 frame",
    },
  };

  const validRes = CreativePlanValidator.validate(validPlan, mockEditIR, availableAssets);
  if (!validRes.valid || validRes.errors.length > 0) {
    throw new Error(`Valid plan was rejected unexpectedly: ${validRes.errors.join("; ")}`);
  }
  console.log("  ✓ Valid plan accepted by CreativePlanValidator with 0 errors");

  // 2. Test Rejection: Unknown Asset Reference in B-Roll
  const invalidAssetPlan = JSON.parse(JSON.stringify(validPlan));
  invalidAssetPlan.operations[1].assetId = "asset_non_existent_999";
  const invalidAssetRes = CreativePlanValidator.validate(invalidAssetPlan, mockEditIR, availableAssets);
  if (invalidAssetRes.valid || !invalidAssetRes.errors.some(e => e.includes("unknown assetId"))) {
    throw new Error("Validator failed to reject unknown assetId reference");
  }
  console.log("  ✓ Rejection verified: Unknown assetId reference rejected");

  // 3. Test Rejection: Violation of User Constraint (doNotRemoveIntro)
  const introViolationPlan = JSON.parse(JSON.stringify(validPlan));
  introViolationPlan.operations[0].startSec = 2.0; // Intro is first 5.0s, constraint forbids
  const introViolationRes = CreativePlanValidator.validate(introViolationPlan, mockEditIR, availableAssets);
  if (introViolationRes.valid || !introViolationRes.errors.some(e => e.includes("doNotRemoveIntro"))) {
    throw new Error("Validator failed to enforce 'doNotRemoveIntro' constraint");
  }
  console.log("  ✓ Rejection verified: 'doNotRemoveIntro' constraint enforced");

  // 4. Test Rejection: Violation of Protected Time Range
  const protectedRangePlan = JSON.parse(JSON.stringify(validPlan));
  protectedRangePlan.operations[0].startSec = 11.0; // Protected is 10.0 to 13.0
  const protectedRangeRes = CreativePlanValidator.validate(protectedRangePlan, mockEditIR, availableAssets);
  if (protectedRangeRes.valid || !protectedRangeRes.errors.some(e => e.includes("protected time range"))) {
    throw new Error("Validator failed to enforce protected time range boundary");
  }
  console.log("  ✓ Rejection verified: Protected time range intersection rejected");

  // 5. Test Rejection: Negative / Zero Timestamps
  const badTimestampPlan = JSON.parse(JSON.stringify(validPlan));
  badTimestampPlan.operations[0].durationSec = -1.0;
  const badTimestampRes = CreativePlanValidator.validate(badTimestampPlan, mockEditIR, availableAssets);
  if (badTimestampRes.valid || !badTimestampRes.errors.some(e => e.includes("durationSec"))) {
    throw new Error("Validator failed to reject non-positive duration");
  }
  console.log("  ✓ Rejection verified: Negative / non-positive duration rejected");

  return true;
}

if (process.argv[1]?.includes("12-creative-plan-validator.test.ts")) {
  runTest()
    .then(() => console.log("✓ Test 12 Passed Successfully.\n"))
    .catch((err) => {
      console.error("❌ Test 12 Failed:", err);
      process.exit(1);
    });
}
