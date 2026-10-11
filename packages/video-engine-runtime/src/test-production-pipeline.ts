import ffmpeg from "./ffmpeg-setup";
import * as path from "path";
import * as fs from "fs";
import { MediaProber } from "./prober";
import { TelemetryExtractor } from "./telemetry-extractor";
import { LosslessSplicer } from "./lossless-splicer";
import { AssSubtitleGenerator } from "./ass-subtitle-generator";
import { SpringPhysicsSolver } from "./spring-physics-solver";
import { AudioDuckingMixer } from "./audio-ducking-mixer";
import {
  EditIR,
  RationalTimeMath,
  OtioAdapter,
} from "@workspace/video-contracts";
import * as crypto from "crypto";

async function runProductionTestSuite() {
  const scratchDir = path.resolve(__dirname, "../../../scratch");
  if (!fs.existsSync(scratchDir)) {
    fs.mkdirSync(scratchDir, { recursive: true });
  }

  const sampleVideo = path.join(scratchDir, "raw_sample_input.mp4");
  const productionOutput = path.join(scratchDir, "production_karaoke_output.mp4");
  const tempDir = path.join(scratchDir, ".prod_render_tmp");

  console.log("=================================================================");
  console.log("  180 AUTONOMOUS VIDEO ENGINE - PRODUCTION TEST SUITE            ");
  console.log("=================================================================");

  // 1. Verify Analytical Spring Physics Solver
  console.log("\n[Test 1/5] Testing Analytical Spring Physics Solver...");
  const spring1 = SpringPhysicsSolver.evaluate(0.0, 1.0, 1.35);
  const spring2 = SpringPhysicsSolver.evaluate(0.1, 1.0, 1.35);
  const spring3 = SpringPhysicsSolver.evaluate(0.5, 1.0, 1.35);
  console.log(`  ✓ Spring evaluation: t=0s -> ${spring1.position.toFixed(3)}, t=0.1s -> ${spring2.position.toFixed(3)}, t=0.5s -> ${spring3.position.toFixed(3)}`);
  if (Math.abs(spring1.position - 1.0) > 0.01) throw new Error("Spring t=0 failed");

  // 2. Synthesize Source Video
  console.log("\n[Test 2/5] Synthesizing 4s test video...");
  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input("testsrc=duration=4:size=1280x720:rate=30")
      .inputOption("-f", "lavfi")
      .input("sine=frequency=440:duration=4")
      .inputOption("-f", "lavfi")
      .videoCodec("libx264")
      .audioCodec("aac")
      .outputOptions(["-pix_fmt yuv420p", "-shortest"])
      .output(sampleVideo)
      .on("end", () => {
        console.log(`  ✓ Sample video ready (${fs.statSync(sampleVideo).size} bytes)`);
        resolve();
      })
      .on("error", (err: any) => reject(err))
      .run();
  });

  // 3. Compile Master EditIR with Captions & Camera Zoom
  console.log("\n[Test 3/5] Compiling Production EditIR AST...");
  const editIR: EditIR = {
    version: "1.0.0",
    meta: {
      projectId: crypto.randomUUID(),
      title: "Production Demo Reel",
      targetAspect: "16:9",
      resolution: { width: 1280, height: 720 },
      fps: { numerator: 30, denominator: 1 },
      totalDuration: RationalTimeMath.fromSeconds(4.0),
    },
    directorStyle: {
      preset: "HORMOZI_PUNCH",
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
              assetId: "asset_sample_1",
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
              assetId: "asset_sample_1",
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
      captionTrack: [
        {
          id: crypto.randomUUID(),
          timeRange: {
            start: RationalTimeMath.fromSeconds(0.5),
            duration: RationalTimeMath.fromSeconds(1.2),
          },
          text: "SCALE FASTER",
          style: {
            preset: "HORMOZI_BOUNCE",
            fontFamily: "Inter",
            fontSize: 48,
            textColor: "#FACC15",
            highlightColor: "#00FF88",
            position: { x: 0.5, y: 0.8 },
            shadow: true,
          },
          words: [
            {
              word: "SCALE",
              start: RationalTimeMath.fromSeconds(0.5),
              end: RationalTimeMath.fromSeconds(1.0),
              highlight: true,
              scaleMultiplier: 1.15,
            },
            {
              word: "FASTER",
              start: RationalTimeMath.fromSeconds(1.05),
              end: RationalTimeMath.fromSeconds(1.7),
              highlight: true,
              scaleMultiplier: 1.15,
            },
          ],
        },
      ],
      audioTracks: [
        {
          id: crypto.randomUUID(),
          type: "PRIMARY_VOICE",
          volumeDb: 0.0,
          duckWithSpeech: false,
          clips: [],
        },
      ],
    },
  };

  // 4. Test OTIO Bidirectional Roundtrip
  console.log("\n[Test 4/5] Testing OpenTimelineIO (OTIO) Bidirectional Roundtrip...");
  const otioTimeline = OtioAdapter.toOtio(editIR);
  const roundtripIR = OtioAdapter.fromOtio(otioTimeline);
  console.log(`  ✓ Serialized to OTIO Timeline: ${otioTimeline.tracks.children.length} tracks, ${otioTimeline.tracks.children[0].children.length} clips`);
  console.log(`  ✓ Deserialized back to EditIR: ${roundtripIR.tracks.videoTracks[0].clips.length} clips preserved`);
  if (roundtripIR.tracks.videoTracks[0].clips.length !== 2) {
    throw new Error("OTIO Roundtrip clip count mismatch!");
  }

  // 5. Test ASS Subtitle Generation & Splicing Render
  console.log("\n[Test 5/5] Testing ASS Subtitle Generation & Final Render...");
  const assScript = AssSubtitleGenerator.generateAss(editIR.tracks.captionTrack, editIR.meta.resolution);
  console.log(`  ✓ Generated ASS Subtitle Script (${assScript.length} characters)`);

  await LosslessSplicer.render(editIR, productionOutput, tempDir, (prog) => {
    console.log(`  -> Render progress: ${prog.percent}%`);
  });

  const finalStats = fs.statSync(productionOutput);
  console.log(`\n🎉 ALL 5 PRODUCTION TESTS PASSED! Output: ${productionOutput} (${finalStats.size} bytes)\n`);
}

runProductionTestSuite().catch((err) => {
  console.error("✗ Production test suite failed:", err);
  process.exit(1);
});
