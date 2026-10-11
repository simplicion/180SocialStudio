import ffmpeg from "../ffmpeg-setup";
import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";
import { MediaProber } from "../prober";
import { AudioDuckingMixer } from "../audio-ducking-mixer";
import {
  EditIR,
  RationalTimeMath,
  EditIRCompiler,
  CreativeEditPlan,
} from "@workspace/video-contracts";

/**
 * TEST 15: Golden Media Export, Audio Ducking & Vertical 9:16 Render
 * Synthesizes source media, compiles autonomous 9:16 vertical plan with audio ducking,
 * renders the video with FFmpeg, and probes the exported master to verify 1080x1920 resolution,
 * valid AAC audio, and accurate duration.
 */
export async function runTest(): Promise<boolean> {
  console.log("\n[Test 15] Golden Media Export, Audio Ducking & Vertical 9:16 Render...");

  const scratchDir = path.resolve(__dirname, "../../../scratch");
  if (!fs.existsSync(scratchDir)) {
    fs.mkdirSync(scratchDir, { recursive: true });
  }

  const rawInputVideo = path.join(scratchDir, "golden_test_input.mp4");
  const bgmAudio = path.join(scratchDir, "golden_bgm_input.wav");
  const exportedMaster = path.join(scratchDir, "golden_master_1080x1920.mp4");

  // Clean old test files
  if (fs.existsSync(exportedMaster)) fs.unlinkSync(exportedMaster);

  // 1. Synthesize 4.0s 16:9 source speech video
  console.log("  [1/4] Synthesizing source speech video...");
  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input("testsrc=duration=4:size=1920x1080:rate=30")
      .inputOption("-f", "lavfi")
      .input("sine=frequency=300:duration=4")
      .inputOption("-f", "lavfi")
      .videoCodec("libx264")
      .audioCodec("aac")
      .outputOptions(["-pix_fmt yuv420p", "-shortest"])
      .output(rawInputVideo)
      .on("end", () => resolve())
      .on("error", (err) => reject(err))
      .run();
  });

  // 2. Synthesize 4.0s BGM music audio
  console.log("  [2/4] Synthesizing background music audio track...");
  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input("sine=frequency=880:duration=4")
      .inputOption("-f", "lavfi")
      .audioCodec("pcm_s16le")
      .output(bgmAudio)
      .on("end", () => resolve())
      .on("error", (err) => reject(err))
      .run();
  });

  const probedSource = await MediaProber.probeFile(rawInputVideo);
  console.log(`  ✓ Probed raw source: ${probedSource.width}x${probedSource.height}, ${probedSource.durationSeconds.toFixed(1)}s`);

  // 3. Compile autonomous 9:16 CreativeEditPlan with audio ducking and trim
  console.log("  [3/4] Compiling 9:16 Autonomous Edit Plan...");
  const baseEditIR: EditIR = {
    version: "1.0.0",
    meta: {
      projectId: crypto.randomUUID(),
      title: "Golden Master Reel",
      targetAspect: "16:9",
      resolution: { width: 1920, height: 1080 },
      fps: { numerator: 30, denominator: 1 },
      totalDuration: RationalTimeMath.fromSeconds(4.0),
    },
    directorStyle: {
      preset: "MRBEAST_FAST",
      pacingMultiplier: 1.25,
      zoomAggressiveness: 0.75,
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
              assetId: probedSource.id,
              sourcePath: rawInputVideo,
              sourceRange: { start: RationalTimeMath.fromSeconds(0), duration: RationalTimeMath.fromSeconds(4.0) },
              timelineRange: { start: RationalTimeMath.fromSeconds(0), duration: RationalTimeMath.fromSeconds(4.0) },
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
          type: "PRIMARY_VOICE",
          volumeDb: 0,
          duckWithSpeech: false,
          clips: [
            {
              id: crypto.randomUUID(),
              sourcePath: rawInputVideo,
              sourceRange: { start: RationalTimeMath.fromSeconds(0), duration: RationalTimeMath.fromSeconds(4.0) },
              timelineRange: { start: RationalTimeMath.fromSeconds(0), duration: RationalTimeMath.fromSeconds(4.0) },
              volumeDb: 0,
            },
          ],
        },
        {
          id: crypto.randomUUID(),
          type: "BGM",
          volumeDb: -6,
          duckWithSpeech: true,
          clips: [
            {
              id: crypto.randomUUID(),
              sourcePath: bgmAudio,
              sourceRange: { start: RationalTimeMath.fromSeconds(0), duration: RationalTimeMath.fromSeconds(4.0) },
              timelineRange: { start: RationalTimeMath.fromSeconds(0), duration: RationalTimeMath.fromSeconds(4.0) },
              volumeDb: -6,
            },
          ],
        },
      ],
    },
  };

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
      {
        type: "removeRange",
        startSec: 3.0,
        durationSec: 1.0,
        ripple: true,
        reason: "Trim dead pause at tail",
      },
      {
        type: "reframeSubject",
        targetAspect: "9:16",
        smoothingFactor: 0.85,
      },
      {
        type: "duckAudio",
        duckDb: -18.0,
        attackMs: 80,
        releaseMs: 350,
      },
    ],
    confidence: 0.98,
    explanation: "Autonomous 9:16 vertical reel export with audio ducking and tail trim.",
    requiresConfirmation: false,
  };

  const compiled = EditIRCompiler.compile(baseEditIR, plan, [probedSource]);
  const finalDurationSec = RationalTimeMath.toSeconds(compiled.updatedEditIR.meta.totalDuration);
  console.log(`  ✓ Compiled EditIR: ${compiled.updatedEditIR.meta.targetAspect} aspect (${compiled.updatedEditIR.meta.resolution.width}x${compiled.updatedEditIR.meta.resolution.height}), ${finalDurationSec.toFixed(1)}s total duration`);

  // 4. Render Master Video using FFmpeg
  console.log("  [4/4] Rendering 1080x1920 master video with FFmpeg & audio sidechain ducking...");
  const duckingFilter = AudioDuckingMixer.buildFilterGraph(compiled.updatedEditIR.tracks.audioTracks);

  await new Promise<void>((resolve, reject) => {
    const proc = ffmpeg()
      .input(rawInputVideo)
      .input(bgmAudio)
      .complexFilter([
        // 9:16 scale and crop filter
        `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[vOut]`,
        // Audio ducking sidechain
        duckingFilter,
      ])
      .map("[vOut]")
      .map("[out_audio]")
      .duration(finalDurationSec)
      .videoCodec("libx264")
      .audioCodec("aac")
      .outputOptions(["-preset ultrafast", "-pix_fmt yuv420p", "-b:a 192k"])
      .output(exportedMaster)
      .on("end", () => resolve())
      .on("error", (err) => reject(err));

    proc.run();
  });

  // 5. Probe and Validate Exported Master
  if (!fs.existsSync(exportedMaster)) {
    throw new Error(`Master export file not created: ${exportedMaster}`);
  }

  const probedMaster = await MediaProber.probeFile(exportedMaster);
  console.log(`  ✓ Probed Exported Master:`);
  console.log(`     - Resolution: ${probedMaster.width}x${probedMaster.height} (Target: 1080x1920)`);
  console.log(`     - Duration: ${probedMaster.durationSeconds.toFixed(2)}s (Target: ${finalDurationSec.toFixed(2)}s)`);
  console.log(`     - Codecs: Video: ${probedMaster.codecVideo}, Audio: ${probedMaster.codecAudio}`);
  console.log(`     - File Size: ${(probedMaster.fileSizeBytes / 1024).toFixed(1)} KB`);

  if (probedMaster.width !== 1080 || probedMaster.height !== 1920) {
    throw new Error(`Master video resolution mismatch: Expected 1080x1920, got ${probedMaster.width}x${probedMaster.height}`);
  }

  if (Math.abs(probedMaster.durationSeconds - finalDurationSec) > 0.3) {
    throw new Error(`Master video duration mismatch: Expected ~${finalDurationSec}s, got ${probedMaster.durationSeconds}s`);
  }

  if (!probedMaster.hasAudio || probedMaster.codecAudio !== "aac") {
    throw new Error(`Master audio invalid or missing: codec=${probedMaster.codecAudio}`);
  }

  console.log("  ✓ Golden Master Video passed all production checks!");
  return true;
}

if (process.argv[1]?.includes("15-golden-media-export.test.ts")) {
  runTest()
    .then(() => console.log("✓ Test 15 Passed Successfully.\n"))
    .catch((err) => {
      console.error("❌ Test 15 Failed:", err);
      process.exit(1);
    });
}
