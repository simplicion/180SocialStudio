import { ObjectAttentionTracker } from "./object-tracker";
import { ContentAddressedCacheManager } from "./cache-manager";
import {
  ContentAddressedKeyGenerator,
  RationalTimeMath,
  PluginManifestSchema,
} from "@workspace/video-contracts";
import * as path from "path";
import * as fs from "fs";

async function runAdvancedSubsystemsTest() {
  const scratchDir = path.resolve(__dirname, "../../../scratch");
  const cacheDir = path.join(scratchDir, "test_cache");

  console.log("=================================================================");
  console.log("  180 ADVANCED ARCHITECTURE SUBSYSTEMS TEST (ADRs 009-011)       ");
  console.log("=================================================================");

  // 1. Test ADR-009 Universal Attention & Trajectory Engine
  console.log("\n[Test 1/3] Testing ADR-009 Universal Object Attention Solver...");
  const sampleTrajectory = [
    { timestampSec: 0.0, x: 0.5, y: 0.35, confidence: 0.95 },
    { timestampSec: 0.5, x: 0.52, y: 0.36, confidence: 0.96 },
    { timestampSec: 1.0, x: 0.51, y: 0.34, confidence: 0.92 },
    { timestampSec: 1.8, x: 0.49, y: 0.35, confidence: 0.90 },
    { timestampSec: 2.0, x: 0.0, y: 0.0, confidence: 0.2 }, // Lost tracking
  ];

  const cameraEvents = ObjectAttentionTracker.generateCameraZoomTrajectory(sampleTrajectory);
  console.log(`  ✓ Generated ${cameraEvents.length} camera zoom events from trajectory`);
  if (cameraEvents.length === 0) throw new Error("Attention tracker failed to generate events");
  console.log(`  ✓ Zoom Event: scale=${cameraEvents[0].scale}x, coords=(${cameraEvents[0].targetCoords.x.toFixed(2)}, ${cameraEvents[0].targetCoords.y.toFixed(2)})`);

  // 2. Test ADR-010 Content-Addressed Cache Storage
  console.log("\n[Test 2/3] Testing ADR-010 Content-Addressed Cache Manager...");
  const cacheKey = ContentAddressedKeyGenerator.computeCacheKey({
    sourceHash: "abc123sha256hash",
    timeRange: {
      start: RationalTimeMath.fromSeconds(0.0),
      duration: RationalTimeMath.fromSeconds(5.0),
    },
    engineVersion: "0.1.0",
  });
  console.log(`  ✓ Computed deterministic content-addressed key: ${cacheKey}`);

  const cacheManager = new ContentAddressedCacheManager(cacheDir);
  cacheManager.set(cacheKey, { status: "OK", precomputedWaveform: [0.1, 0.4, 0.9, 0.2] });
  if (!cacheManager.has(cacheKey)) throw new Error("Cache manager set failed");

  const cachedData = cacheManager.get<any>(cacheKey);
  if (!cachedData || cachedData.status !== "OK") throw new Error("Cache manager get failed");
  const stats = cacheManager.getStats();
  console.log(`  ✓ Cache manager validated: ${stats.totalFiles} files (${stats.totalSizeBytes} bytes)`);

  // 3. Test ADR-011 Sandboxed Plugin Schema Validation
  console.log("\n[Test 3/3] Testing ADR-011 Sandboxed Plugin Manifest Schema...");
  const validPlugin = PluginManifestSchema.parse({
    id: "com.180workspace.plugin.filmgrain",
    name: "35mm Film Grain FX",
    version: "1.0.0",
    author: "180 VFX Labs",
    description: "Hardware accelerated 35mm film grain shader",
    capabilities: ["RENDER_GPU_SHADER", "READ_TIMELINE"],
  });
  console.log(`  ✓ Sandboxed Plugin Validated: ${validPlugin.name} (Capabilities: ${validPlugin.capabilities.join(", ")})`);

  console.log("\n🎉 ALL ADVANCED ARCHITECTURE SUBSYSTEMS PASSED!\n");
}

runAdvancedSubsystemsTest().catch((err) => {
  console.error("✗ Advanced subsystems test failed:", err);
  process.exit(1);
});
