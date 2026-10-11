import ffmpeg from "./ffmpeg-setup";
import * as path from "path";
import * as fs from "fs";
import { MediaProber } from "./prober";
import { TelemetryExtractor } from "./telemetry-extractor";
import { LosslessSplicer } from "./lossless-splicer";
import { EditIR, RationalTimeMath } from "@workspace/video-contracts";
import * as crypto from "crypto";

async function runEndToEndTest() {
  const scratchDir = path.resolve(__dirname, "../../../scratch");
  if (!fs.existsSync(scratchDir)) {
    fs.mkdirSync(scratchDir, { recursive: true });
  }

  const sampleVideo = path.join(scratchDir, "raw_sample_input.mp4");
  const editedOutput = path.join(scratchDir, "autonomous_edit_output.mp4");
  const tempDir = path.join(scratchDir, ".render_tmp");

  console.log("=================================================================");
  console.log("  180 WORKSPACE AUTONOMOUS VIDEO ENGINE - END-TO-END SUITE       ");
  console.log("=================================================================");

  // Step 1: Synthesize a 4-second valid MP4 test video with audio tone
  console.log("\n[Step 1] Synthesizing 4s test video with ffmpeg-installer binaries...");
  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input("testsrc=duration=4:size=1280x720:rate=30")
      .inputOption("-f", "lavfi")
      .input("sine=frequency=880:duration=4")
      .inputOption("-f", "lavfi")
      .videoCodec("libx264")
      .audioCodec("aac")
      .outputOptions(["-pix_fmt yuv420p", "-shortest"])
      .output(sampleVideo)
      .on("end", () => {
        console.log(`  ✓ Sample video generated: ${sampleVideo} (${fs.statSync(sampleVideo).size} bytes)`);
        resolve();
      })
      .on("error", (err: any) => reject(err))
      .run();
  });

  // Step 2: Probe Media Assets
  console.log("\n[Step 2] Probing media metadata...");
  const asset = await MediaProber.probeFile(sampleVideo);
  console.log(`  ✓ Media asset probed: ${asset.width}x${asset.height} @ ${asset.fps}fps, duration: ${asset.durationSeconds}s`);

  // Step 3: Extract Telemetry (Deterministic Silence & Energy)
  console.log("\n[Step 3] Extracting media telemetry (Deterministic Stage 1)...");
  const telemetry = await TelemetryExtractor.extract(sampleVideo, tempDir);
  console.log(`  ✓ Telemetry extracted: ${telemetry.totalFrames} frames, ${telemetry.transcript.length} transcript tokens, ${telemetry.silenceGaps.length} silence gaps`);

  // Step 4: AI Creative Director Compilation into EditIR AST
  console.log("\n[Step 4] Compiling EditIR AST (AI Creative Director Stage 2)...");
  const editIR: EditIR = {
    version: "1.0.0",
    meta: {
      projectId: crypto.randomUUID(),
      title: "Test Autonomous Reel",
      targetAspect: "16:9",
      resolution: { width: 1280, height: 720 },
      fps: { numerator: 30, denominator: 1 },
      totalDuration: RationalTimeMath.fromSeconds(4.0),
    },
    directorStyle: {
      preset: "MRBEAST_FAST",
      pacingMultiplier: 1.2,
      zoomAggressiveness: 0.7,
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
              assetId: asset.id,
              sourcePath: sampleVideo,
              sourceRange: {
                start: RationalTimeMath.fromSeconds(0.0),
                duration: RationalTimeMath.fromSeconds(2.0),
              },
              timelineRange: {
                start: RationalTimeMath.fromSeconds(0.0),
                duration: RationalTimeMath.fromSeconds(2.0),
              },
              transform: {
                scale: { start: 1.0, end: 1.0, easing: "spring" },
                position: { x: 0, y: 0 },
                anchor: { x: 0.5, y: 0.5 },
                rotationDeg: 0,
                opacity: 1.0,
              },
              speedMultiplier: 1.0,
              effects: [],
            },
            {
              id: crypto.randomUUID(),
              assetId: asset.id,
              sourcePath: sampleVideo,
              sourceRange: {
                start: RationalTimeMath.fromSeconds(2.0),
                duration: RationalTimeMath.fromSeconds(2.0),
              },
              timelineRange: {
                start: RationalTimeMath.fromSeconds(2.0),
                duration: RationalTimeMath.fromSeconds(2.0),
              },
              transform: {
                scale: { start: 1.0, end: 1.0, easing: "spring" },
                position: { x: 0, y: 0 },
                anchor: { x: 0.5, y: 0.5 },
                rotationDeg: 0,
                opacity: 1.0,
              },
              speedMultiplier: 1.0,
              effects: [],
            },
          ],
        },
      ],
      cameraTrack: [
        {
          id: crypto.randomUUID(),
          timeRange: {
            start: RationalTimeMath.fromSeconds(0.5),
            duration: RationalTimeMath.fromSeconds(1.5),
          },
          targetType: "FACE",
          targetCoords: { x: 0.5, y: 0.4 },
          scale: 1.35,
          spring: { stiffness: 180, damping: 18, mass: 1, overshootClamping: false },
          motionBlur: true,
        },
      ],
      captionTrack: [],
      audioTracks: [],
    },
  };
  console.log(`  ✓ EditIR AST compiled with 2 spliced clips and dynamic spring camera track.`);

  // Step 5: Hardware Stream-Copy Splicing & Render (Stage 3)
  console.log("\n[Step 5] Splicing clips via Lossless Smart Stream-Copy...");
  await LosslessSplicer.render(editIR, editedOutput, tempDir, (prog) => {
    console.log(`  -> Render progress: ${prog.percent}% (Chunk ${prog.currentChunk}/${prog.totalChunks})`);
  });

  const finalStats = fs.statSync(editedOutput);
  console.log(`\n🎉 SUCCESS! Rendered final autonomous video to: ${editedOutput} (${finalStats.size} bytes)`);
}

runEndToEndTest().catch((err) => {
  console.error("✗ Test failed:", err);
  process.exit(1);
});
