import { FfmpegHardwareAccelerator } from "../ffmpeg-hardware";

async function testHardwareAcceleration() {
  console.log("=== [TEST SUITE] FFmpeg Hardware Acceleration & Optimization ===");

  console.log("-> Step 1: Resolving Host Hardware Encoder Profile...");
  const profile = await FfmpegHardwareAccelerator.resolveEncoderProfile();

  console.log("Resolved Encoder Profile:", {
    codecName: profile.codecName,
    isHardwareAccelerated: profile.isHardwareAccelerated,
    outputOptions: profile.outputOptions,
  });

  if (!profile.codecName) {
    throw new Error("Failed to resolve any video encoder profile");
  }

  console.log("-> Step 2: Testing Cache Resolution Speed...");
  const t0 = performance.now();
  const cached = await FfmpegHardwareAccelerator.resolveEncoderProfile();
  const t1 = performance.now();

  if (cached.codecName !== profile.codecName) {
    throw new Error("Cached profile does not match initial profile");
  }
  if (t1 - t0 > 5) {
    console.warn(`Cache lookup took ${(t1 - t0).toFixed(2)}ms (expected < 1ms)`);
  }

  console.log(`✓ Cache lookup took ${(t1 - t0).toFixed(3)}ms`);
  console.log("✓ Encoder negotiated cleanly: " + profile.codecName + (profile.isHardwareAccelerated ? " (GPU Accelerated 🚀)" : " (High-Efficiency CPU)"));
  console.log("=== ALL FFMPEG HARDWARE TESTS PASSED SUCCESSFULLY! ===");
}

testHardwareAcceleration().catch((err) => {
  console.error("Hardware Acceleration Test Failed:", err);
  process.exit(1);
});

