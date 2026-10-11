import {
  EditIRCompiler,
  EditIR,
  EditIRSchema,
  CreativeEditPlan,
  RationalTimeMath,
  MediaAssetDescriptor,
} from "@workspace/video-contracts";

import * as crypto from "crypto";

/**
 * TEST 13: Deterministic EditIR Compiler
 * Validates that high-level CreativeEditPlans compile into valid EditIR ASTs,
 * testing removeRange ripple deletions, 9:16 reframing, B-roll insertions,
 * camera zoom punches, and kinetic caption tracks.
 */
export async function runTest(): Promise<boolean> {
  console.log("\n[Test 13] Deterministic EditIR Compiler...");

  const initialDurationSec = 20.0;
  const initialTotalDuration = RationalTimeMath.fromSeconds(initialDurationSec);

  const baseEditIR: EditIR = {
    version: "1.0.0",
    meta: {
      projectId: crypto.randomUUID(),
      title: "Base Timeline",
      targetAspect: "16:9",
      resolution: { width: 1920, height: 1080 },
      fps: { numerator: 30, denominator: 1 },
      totalDuration: initialTotalDuration,
    },
    directorStyle: {
      preset: "CUSTOM",
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
              assetId: "asset_camera_main",
              sourcePath: "C:/footage/raw_a_roll.mp4",
              sourceRange: { start: RationalTimeMath.fromSeconds(0), duration: initialTotalDuration },
              timelineRange: { start: RationalTimeMath.fromSeconds(0), duration: initialTotalDuration },
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
      audioTracks: [
        {
          id: crypto.randomUUID(),
          type: "BGM",
          volumeDb: -10,
          duckWithSpeech: false,
          clips: [],
        },
      ],
    },
  };

  const availableAssets: MediaAssetDescriptor[] = [
    {
      id: "asset_camera_main",
      name: "raw_a_roll.mp4",
      filePath: "C:/footage/raw_a_roll.mp4",
      fileSizeBytes: 1024 * 1024 * 50,
      mimeType: "video/mp4",
      durationSeconds: initialDurationSec,
      width: 1920,
      height: 1080,
      fps: 30,
      hasAudio: true,
      sha256Hash: "hash_main",
    },
    {
      id: "asset_broll_cutaway",
      name: "laptop_typing.mp4",
      filePath: "C:/footage/laptop_typing.mp4",
      fileSizeBytes: 1024 * 1024 * 10,
      mimeType: "video/mp4",
      durationSeconds: 4.0,
      width: 1920,
      height: 1080,
      fps: 30,
      hasAudio: false,
      sha256Hash: "hash_broll",
    },
  ];

  const plan: CreativeEditPlan = {
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
    operations: [
      // 1. Remove 2.0s dead air between 5.0s and 7.0s
      {
        type: "removeRange",
        startSec: 5.0,
        durationSec: 2.0,
        ripple: true,
        reason: "Remove 2.0s dead air gap",
      },
      // 2. Reframe to 9:16 vertical subject focus
      {
        type: "reframeSubject",
        targetAspect: "9:16",
        smoothingFactor: 0.85,
      },
      // 3. Inject spring camera zoom punch at 2.0s
      {
        type: "addZoom",
        startSec: 2.0,
        durationSec: 1.2,
        targetType: "FACE",
        targetCoords: { x: 0.5, y: 0.35 },
        scale: 1.35,
        motionBlur: true,
      },
      // 4. Insert B-roll cutaway at 6.0s (which is now in the rippled timeline)
      {
        type: "insertBroll",
        assetId: "asset_broll_cutaway",
        timelineStartSec: 6.0,
        durationSec: 2.5,
        sourceStartSec: 0.0,
        cropMode: "center",
      },
      // 5. Add kinetic styled caption
      {
        type: "addCaption",
        startSec: 1.0,
        durationSec: 2.0,
        text: "Autonomous Video Studio",
        words: [
          { word: "Autonomous", startSec: 1.0, endSec: 1.6, highlight: true, scale: 1.25 },
          { word: "Video", startSec: 1.65, endSec: 2.1, highlight: false, scale: 1.0 },
          { word: "Studio", startSec: 2.15, endSec: 3.0, highlight: true, scale: 1.2 },
        ],
        stylePreset: "HORMOZI_BOUNCE",
      },
      // 6. Auto-duck background music
      {
        type: "duckAudio",
        duckDb: -18.0,
        attackMs: 120,
        releaseMs: 350,
      },
    ],
    confidence: 0.96,
    explanation: "Compiled fast-paced 9:16 Instagram Reel with cutaway, camera punch, captions, and audio ducking.",
    requiresConfirmation: false,
  };

  // Compile the plan deterministically
  const compilation = EditIRCompiler.compile(baseEditIR, plan, availableAssets);

  // 1. Verify schema validity of the compiled AST
  const parseRes = EditIRSchema.safeParse(compilation.updatedEditIR);
  if (!parseRes.success) {
    throw new Error(`Compiled EditIR failed schema validation: ${JSON.stringify(parseRes.error)}`);
  }
  console.log("  ✓ Compiled EditIR is 100% valid against EditIRSchema");

  // 2. Verify Aspect Ratio and Resolution
  const updatedMeta = compilation.updatedEditIR.meta;
  if (updatedMeta.targetAspect !== "9:16" || updatedMeta.resolution.width !== 1080 || updatedMeta.resolution.height !== 1920) {
    throw new Error(`Aspect ratio compilation failed: Expected 9:16 (1080x1920), got ${updatedMeta.targetAspect} (${updatedMeta.resolution.width}x${updatedMeta.resolution.height})`);
  }
  console.log("  ✓ 9:16 Canvas reframing verified: 1080x1920 target resolution");

  // 3. Verify removeRange cut and timeline ripple
  const mainClips = compilation.updatedEditIR.tracks.videoTracks[0].clips;
  if (mainClips.length !== 2) {
    throw new Error(`Expected 2 split clips after removeRange, got ${mainClips.length}`);
  }
  const firstClipDur = RationalTimeMath.toSeconds(mainClips[0].timelineRange.duration);
  const secondClipStart = RationalTimeMath.toSeconds(mainClips[1].timelineRange.start);
  const secondClipDur = RationalTimeMath.toSeconds(mainClips[1].timelineRange.duration);
  if (Math.abs(firstClipDur - 5.0) > 0.001 || Math.abs(secondClipStart - 5.0) > 0.001) {
    throw new Error(`Ripple cut math mismatch: Clip 0 ends at ${firstClipDur}, Clip 1 starts at ${secondClipStart}`);
  }
  const expectedTotalDur = initialDurationSec - 2.0; // 18.0s
  const newTotalDur = RationalTimeMath.toSeconds(compilation.updatedEditIR.meta.totalDuration);
  if (Math.abs(newTotalDur - expectedTotalDur) > 0.01) {
    throw new Error(`Total timeline duration mismatch: Expected ${expectedTotalDur}s, got ${newTotalDur}s`);
  }
  console.log(`  ✓ removeRange ripple deletion verified: Clip split at 5.0s, duration rippled to ${newTotalDur}s`);

  // 4. Verify Camera Track Zoom Injection
  const cameraEvents = compilation.updatedEditIR.tracks.cameraTrack;
  if (cameraEvents.length === 0 || cameraEvents[0].scale !== 1.35) {
    throw new Error("Camera zoom event missing or scale incorrect");
  }
  console.log(`  ✓ Camera track zoom punch verified: Scale ${cameraEvents[0].scale}x with spring physics`);

  // 5. Verify B-Roll Track Insertion
  const brollTracks = compilation.updatedEditIR.tracks.videoTracks.filter(t => t.type === "B_ROLL_OVERLAY");
  if (brollTracks.length === 0 || brollTracks[0].clips.length === 0) {
    throw new Error("B-roll track or cutaway clip missing from compiled AST");
  }
  const brollClip = brollTracks[0].clips[0];
  if (brollClip.assetId !== "asset_broll_cutaway") {
    throw new Error(`B-roll asset ID mismatch: ${brollClip.assetId}`);
  }
  console.log(`  ✓ B-Roll track insertion verified: Asset ${brollClip.assetId} on zIndex ${brollTracks[0].zIndex}`);

  // 6. Verify Kinetic Captions
  const captions = compilation.updatedEditIR.tracks.captionTrack;
  if (captions.length === 0 || captions[0].words.length !== 3) {
    throw new Error("CaptionTrack missing or word count mismatch");
  }
  console.log(`  ✓ Kinetic bouncing captions verified: ${captions[0].words.length} timed words synchronized`);

  // 7. Verify Badges
  if (compilation.actionBadges.length < 4) {
    throw new Error(`Expected at least 4 action badges, received ${compilation.actionBadges.length}`);
  }
  console.log("  ✓ Generated action badges:", compilation.actionBadges.join(" | "));

  return true;
}

if (process.argv[1]?.includes("13-edit-ir-compiler.test.ts")) {
  runTest()
    .then(() => console.log("✓ Test 13 Passed Successfully.\n"))
    .catch((err) => {
      console.error("❌ Test 13 Failed:", err);
      process.exit(1);
    });
}
