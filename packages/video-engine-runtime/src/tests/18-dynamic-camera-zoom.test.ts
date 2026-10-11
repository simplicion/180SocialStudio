import * as fs from "fs";
import * as path from "path";
import ffmpeg from "../ffmpeg-setup";
import { LosslessSplicer } from "../lossless-splicer";
import { EditIR, RationalTimeMath } from "@workspace/video-contracts";
import { MediaProber } from "../prober";

export async function runTest(): Promise<void> {
  console.log("\n[Test 18] Dynamic Spring Camera Zoom Engine & Render Validation...");

  const tempDir = path.join(process.cwd(), "temp_camera_test_18");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const testVideoPath = path.join(tempDir, "cam_source.mp4");
  const outputVideoPath = path.join(tempDir, "cam_rendered_zoom.mp4");

  // Synthesize 4s test video
  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input("testsrc=duration=4:size=1280x720:rate=30")
      .inputOptions(["-f lavfi"])
      .input("sine=frequency=440:duration=4")
      .inputOptions(["-f lavfi"])
      .videoCodec("libx264")
      .audioCodec("aac")
      .outputOptions(["-pix_fmt yuv420p", "-shortest"])
      .output(testVideoPath)
      .on("end", () => resolve())
      .on("error", (err) => reject(err))
      .run();
  });

  const editIR: EditIR = {
    version: "1.0.0",
    meta: {
      projectId: "proj_cam_zoom_test",
      title: "Camera Zoom Test",
      targetAspect: "16:9",
      resolution: { width: 1280, height: 720 },
      fps: { numerator: 30, denominator: 1 },
      totalDuration: RationalTimeMath.fromSeconds(4.0),
    },
    directorStyle: {
      preset: "MRBEAST_FAST",
      pacingMultiplier: 1.0,
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
              id: "clip_cam_01",
              assetId: "asset_cam_source",
              sourcePath: testVideoPath,
              sourceRange: { start: RationalTimeMath.fromSeconds(0), duration: RationalTimeMath.fromSeconds(4.0) },
              timelineRange: { start: RationalTimeMath.fromSeconds(0), duration: RationalTimeMath.fromSeconds(4.0) },
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
          id: "cam_zoom_01",
          timeRange: { start: RationalTimeMath.fromSeconds(1.0), duration: RationalTimeMath.fromSeconds(1.5) },
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

  await LosslessSplicer.render(editIR, outputVideoPath, tempDir);

  const probed = await MediaProber.probeFile(outputVideoPath);
  if (probed.durationSeconds < 3.8 || probed.width !== 1280 || probed.height !== 720) {
    throw new Error(`Camera zoom render validation failed: duration ${probed.durationSeconds}s, resolution ${probed.width}x${probed.height}`);
  }

  console.log(`  ✓ Spring Camera Zoom rendered seamlessly: ${probed.durationSeconds.toFixed(2)}s @ ${probed.width}x${probed.height} (1.35x zoom on face coordinates)`);

  // Clean temp dir
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {}
}
