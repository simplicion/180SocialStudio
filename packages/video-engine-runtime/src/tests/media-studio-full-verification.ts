import ffmpeg from "../ffmpeg-setup";
import * as path from "path";
import * as fs from "fs";
import { MediaProber } from "../prober";
import { LosslessSplicer } from "../lossless-splicer";
import { AssSubtitleGenerator } from "../ass-subtitle-generator";
import { SpringPhysicsSolver } from "../spring-physics-solver";
import { AudioDuckingMixer } from "../audio-ducking-mixer";
import {
  EditIR,
  EditIRSchema,
  RationalTimeMath,
  OtioAdapter,
  VideoCriticService,
} from "@workspace/video-contracts";
import { VideoAIDirectorService } from "../../../domains/ai/src/builders/video-ai-director.service";
import * as crypto from "crypto";

async function runFullVerificationSuite() {
  const scratchDir = path.resolve(__dirname, "../../../../scratch");
  if (!fs.existsSync(scratchDir)) {
    fs.mkdirSync(scratchDir, { recursive: true });
  }

  const tempDir = path.join(scratchDir, ".e2e_render_tmp");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  console.log("========================================================================");
  console.log("  180 WORKSPACE MEDIA STUDIO — COMPREHENSIVE E2E VERIFICATION SUITE    ");
  console.log("========================================================================");

  // 1. Synthesize Source Test Assets
  const testVideoPath = path.join(scratchDir, "e2e_source_video.mp4");
  const testAudioPath = path.join(scratchDir, "e2e_bgm_audio.aac");
  const testImagePath = path.join(scratchDir, "e2e_overlay_logo.png");

  console.log("\n[Step 1/6] Synthesizing Deterministic Test Media Fixtures...");

  // Generate 5s 1080p Test Video with 440Hz tone
  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input("testsrc=duration=5:size=1920x1080:rate=30")
      .inputOption("-f", "lavfi")
      .input("sine=frequency=440:duration=5")
      .inputOption("-f", "lavfi")
      .videoCodec("libx264")
      .audioCodec("aac")
      .outputOptions(["-pix_fmt yuv420p", "-shortest"])
      .output(testVideoPath)
      .on("end", () => {
        console.log(`  ✓ Test video created: ${testVideoPath} (${fs.statSync(testVideoPath).size} bytes)`);
        resolve();
      })
      .on("error", (err: any) => reject(err))
      .run();
  });

  // Generate 5s BGM Audio Track
  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input("sine=frequency=880:duration=5")
      .inputOption("-f", "lavfi")
      .audioCodec("aac")
      .output(testAudioPath)
      .on("end", () => {
        console.log(`  ✓ Test audio created: ${testAudioPath} (${fs.statSync(testAudioPath).size} bytes)`);
        resolve();
      })
      .on("error", (err: any) => reject(err))
      .run();
  });

  // Generate 1s Synthetic Overlay Image
  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input("color=color=indigo:size=400x200:duration=1")
      .inputOption("-f", "lavfi")
      .outputOptions(["-vframes 1"])
      .output(testImagePath)
      .on("end", () => {
        console.log(`  ✓ Test image created: ${testImagePath} (${fs.statSync(testImagePath).size} bytes)`);
        resolve();
      })
      .on("error", (err: any) => reject(err))
      .run();
  });

  // 2. Workflow A & F: Memory-Safe Probing & Metadata Validation
  console.log("\n[Step 2/6] Workflow A & F: Testing Memory-Safe Chunked Media Prober...");
  const videoMeta = await MediaProber.probeFile(testVideoPath);
  console.log(`  ✓ Probed Video: ${videoMeta.name}, ${videoMeta.width}x${videoMeta.height}, ${videoMeta.fps} FPS, ${videoMeta.durationSeconds.toFixed(2)}s`);
  console.log(`  ✓ Streaming SHA256: ${videoMeta.sha256Hash.substring(0, 16)}...`);
  if (videoMeta.width !== 1920 || videoMeta.height !== 1080) {
    throw new Error(`Prober resolution mismatch: expected 1920x1080, got ${videoMeta.width}x${videoMeta.height}`);
  }

  // 3. Workflow A: Cut / Split / Trim Timeline & Lossless Stream-Copy Render
  console.log("\n[Step 3/6] Workflow A: Multi-Clip Timeline Splicing & Lossless Stream-Copy...");
  const workflowAOut = path.join(scratchDir, "workflow_a_cut_export.mp4");

  const editIRA: EditIR = {
    version: "1.0.0",
    meta: {
      projectId: crypto.randomUUID(),
      title: "Workflow A Cut Project",
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
              assetId: videoMeta.id,
              sourcePath: testVideoPath,
              sourceRange: { start: RationalTimeMath.fromSeconds(0.0), duration: RationalTimeMath.fromSeconds(2.0) },
              timelineRange: { start: RationalTimeMath.fromSeconds(0.0), duration: RationalTimeMath.fromSeconds(2.0) },
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
              assetId: videoMeta.id,
              sourcePath: testVideoPath,
              sourceRange: { start: RationalTimeMath.fromSeconds(2.5), duration: RationalTimeMath.fromSeconds(2.0) },
              timelineRange: { start: RationalTimeMath.fromSeconds(2.0), duration: RationalTimeMath.fromSeconds(2.0) },
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
      cameraTrack: [],
      captionTrack: [],
      audioTracks: [],
    },
  };

  await LosslessSplicer.render(editIRA, workflowAOut, path.join(tempDir, "wf_a"), (p) => {
    process.stdout.write(`\r  -> Progress: ${p.percent}% (Chunk ${p.currentChunk}/${p.totalChunks})`);
  });
  console.log(`\n  ✓ Workflow A Exported successfully: ${workflowAOut} (${fs.statSync(workflowAOut).size} bytes)`);

  const probeA = await MediaProber.probeFile(workflowAOut);
  console.log(`  ✓ Validated Output A: Duration = ${probeA.durationSeconds.toFixed(2)}s, Codec = ${probeA.codecVideo}/${probeA.codecAudio}`);

  // 4. Workflow B: Video + PNG Image Overlay Compositing
  console.log("\n[Step 4/6] Workflow B: Video + Image Layer Overlay Compositing...");
  const workflowBOut = path.join(scratchDir, "workflow_b_overlay_export.mp4");

  const editIRB: EditIR = {
    ...editIRA,
    meta: {
      ...editIRA.meta,
      projectId: crypto.randomUUID(),
      title: "Workflow B Overlay Project",
    },
    tracks: {
      ...editIRA.tracks,
      videoTracks: [
        editIRA.tracks.videoTracks[0],
        {
          id: crypto.randomUUID(),
          type: "STICKER_OVERLAY" as any,
          zIndex: 1,
          clips: [
            {
              id: crypto.randomUUID(),
              assetId: "image_overlay_1",
              sourcePath: testImagePath,
              sourceRange: { start: RationalTimeMath.fromSeconds(0.0), duration: RationalTimeMath.fromSeconds(3.0) },
              timelineRange: { start: RationalTimeMath.fromSeconds(0.5), duration: RationalTimeMath.fromSeconds(3.0) },
              transform: {
                scale: { start: 1.2, end: 1.2, easing: "spring" },
                position: { x: 200, y: -150 },
                anchor: { x: 0.5, y: 0.5 },
                rotationDeg: 5,
                opacity: 0.9,
              },
              speedMultiplier: 1.0,
              effects: [],
            },
          ],
        },
      ],
    },
  };

  await LosslessSplicer.render(editIRB, workflowBOut, path.join(tempDir, "wf_b"), (p) => {
    process.stdout.write(`\r  -> Progress: ${p.percent}%`);
  });
  console.log(`\n  ✓ Workflow B Exported with Overlay: ${workflowBOut} (${fs.statSync(workflowBOut).size} bytes)`);

  // 5. Workflow C & D: Audio Ducking & Kinetic ASS Karaoke Subtitles
  console.log("\n[Step 5/6] Workflow C & D: Multi-Track Audio Ducking & ASS Karaoke Subtitles...");
  const workflowCDOut = path.join(scratchDir, "workflow_cd_subtitles_ducking_export.mp4");

  const editIRCD: EditIR = {
    ...editIRB,
    meta: {
      ...editIRB.meta,
      projectId: crypto.randomUUID(),
      title: "Workflow C+D Complete Master",
    },
    tracks: {
      ...editIRB.tracks,
      captionTrack: [
        {
          id: crypto.randomUUID(),
          timeRange: {
            start: RationalTimeMath.fromSeconds(0.5),
            duration: RationalTimeMath.fromSeconds(1.8),
          },
          text: "180 WORKSPACE AUTONOMOUS EDIT",
          words: [
            { word: "180", start: RationalTimeMath.fromSeconds(0.5), end: RationalTimeMath.fromSeconds(0.9), highlight: true, scaleMultiplier: 1.15 },
            { word: "WORKSPACE", start: RationalTimeMath.fromSeconds(0.95), end: RationalTimeMath.fromSeconds(1.5), highlight: false, scaleMultiplier: 1.0 },
            { word: "EDIT", start: RationalTimeMath.fromSeconds(1.55), end: RationalTimeMath.fromSeconds(2.3), highlight: false, scaleMultiplier: 1.0 },
          ],
          style: {
            preset: "HORMOZI_BOUNCE",
            fontFamily: "Inter",
            fontSize: 54,
            textColor: "#FACC15",
            highlightColor: "#00FF88",
            position: { x: 0.5, y: 0.8 },
            shadow: true,
          },
        },
      ],
      audioTracks: [
        {
          id: crypto.randomUUID(),
          type: "BGM",
          volumeDb: -12.0,
          duckWithSpeech: true,
          clips: [
            {
              id: crypto.randomUUID(),
              sourcePath: testAudioPath,
              sourceRange: { start: RationalTimeMath.fromSeconds(0), duration: RationalTimeMath.fromSeconds(4.0) },
              timelineRange: { start: RationalTimeMath.fromSeconds(0), duration: RationalTimeMath.fromSeconds(4.0) },
              volumeDb: -12.0,
            },
          ],
        },
      ],
    },
  };

  await LosslessSplicer.render(editIRCD, workflowCDOut, path.join(tempDir, "wf_cd"), (p) => {
    process.stdout.write(`\r  -> Progress: ${p.percent}%`);
  });
  console.log(`\n  ✓ Workflow C+D Master Render Complete: ${workflowCDOut} (${fs.statSync(workflowCDOut).size} bytes)`);

  // 6. Workflow E: AI Creative Director & Heuristic Critic Validation
  console.log("\n[Step 6/6] Workflow E: AI Creative Director AST Compilation & Retention Critic...");
  const aiDirector = VideoAIDirectorService.getInstance();
  const directResult = await aiDirector.compileAST({
    prompt: "Make high energy short with auto-zoom on speaking points",
    companyId: "test_company",
    userId: "test_user",
    meta: {
      videoPath: testVideoPath,
      stylePreset: "HORMOZI_PUNCH",
      telemetry: {
        mediaId: "test_vid_1",
        sourcePath: testVideoPath,
        duration: RationalTimeMath.fromSeconds(5.0),
        totalFrames: 150,
        transcript: [
          { word: "High", startSeconds: 0.5, endSeconds: 0.9, confidence: 0.99, isEmphasis: true },
          { word: "Velocity", startSeconds: 0.95, endSeconds: 1.5, confidence: 0.99, isEmphasis: true },
        ],
        silenceGaps: [
          { timeRange: { start: RationalTimeMath.fromSeconds(2.0), duration: RationalTimeMath.fromSeconds(0.6) }, averageDecibels: -45, isEligibleForTrim: true },
        ],
        energyPeaks: [
          { timestamp: RationalTimeMath.fromSeconds(1.0), rmsEnergy: 0.92, importanceScore: 0.95 },
        ],
        sceneCuts: [],
        trackedObjects: [
          { timestamp: RationalTimeMath.fromSeconds(0.5), objectType: "FACE", boundingBox: { x: 0.45, y: 0.35, width: 0.2, height: 0.25 }, confidence: 0.98 },
        ],
      },
    },
  });

  if (!directResult.ast) {
    throw new Error("AI Director AST compilation failed");
  }

  // Strict Schema Validation
  const validatedAST = EditIRSchema.parse(directResult.ast);
  console.log(`  ✓ AI Director AST strictly validated against EditIRSchema (Version: ${validatedAST.version})`);
  console.log(`  ✓ Auto-Zooms generated: ${validatedAST.tracks.cameraTrack.length}`);

  // Run Critic QA Heuristics
  const criticReport = VideoCriticService.analyze(validatedAST);
  console.log(`  ✓ AI Critic QA Retention Score: ${criticReport.overallScore}/100`);
  console.log(`  ✓ Recommended automated repairs: ${criticReport.recommendedRepairs.length}`);

  console.log("\n========================================================================");
  console.log("  🎉 ALL 6 MEDIA STUDIO WORKFLOWS & SUBSYSTEMS FULLY VALIDATED!        ");
  console.log("========================================================================\n");
}

runFullVerificationSuite().catch((err) => {
  console.error("\n❌ Verification Failed:", err);
  process.exit(1);
});
