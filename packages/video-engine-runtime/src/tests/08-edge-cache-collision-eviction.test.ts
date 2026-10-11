import { ContentAddressedKeyGenerator } from "@workspace/video-contracts";
import { ContentAddressedCacheManager } from "../cache-manager";
import * as path from "path";
import * as fs from "fs";

/**
 * EDGE CASE TEST 8: Content-Addressed Cache Collision Resistance & Corrupted File Recovery
 * Validates that hash keys are uniquely distinct for subtle parameter shifts (1ms difference)
 * and corrupt/truncated cache entries on disk are handled gracefully without crashes.
 */
export async function runTest(): Promise<boolean> {
  console.log("\n[Edge Test 8/10] Content-Addressed Cache Collision & Corrupted Recovery...");

  const scratchCacheDir = path.resolve(process.cwd(), "scratch", ".edge_cache_test");
  if (!fs.existsSync(scratchCacheDir)) fs.mkdirSync(scratchCacheDir, { recursive: true });

  const cacheManager = new ContentAddressedCacheManager(scratchCacheDir);

  // 1. Test Hash Collision Resistance for Minor Time Difference (1.000s vs 1.001s)
  const key1 = ContentAddressedKeyGenerator.computeKey({
    sourceHash: "sha256_abcdef1234567890",
    timeRange: { start: 0.0, duration: 1.0 },
    effectParams: { scale: 1.35, blur: true },
    engineVersion: "0.1.0",
  });

  const key2 = ContentAddressedKeyGenerator.computeKey({
    sourceHash: "sha256_abcdef1234567890",
    timeRange: { start: 0.0, duration: 1.001 }, // 1ms difference
    effectParams: { scale: 1.35, blur: true },
    engineVersion: "0.1.0",
  });

  if (key1 === key2) {
    throw new Error(`Hash collision detected for different timestamps: ${key1}`);
  }
  console.log(`  ✓ Sub-millisecond parameter shift produced distinct keys:\n    Key A: ${key1}\n    Key B: ${key2}`);

  // 2. Set Valid Cache Entry
  cacheManager.set(key1, { status: "OK", telemetry: [1, 2, 3] });
  const retrieved = cacheManager.get<{ status: string }>(key1);
  if (retrieved?.status !== "OK") {
    throw new Error("Failed to store/retrieve valid cache entry");
  }

  // 3. Simulate Corrupted / Truncated Cache File on Disk
  const corruptKey = "corrupt_entry_test_01";
  const corruptFilePath = path.join(scratchCacheDir, `${corruptKey}.cache`);
  fs.writeFileSync(corruptFilePath, "{ invalid json corrupt content %%$$#@!");

  const corruptResult = cacheManager.get(corruptKey);
  if (corruptResult !== null) {
    throw new Error("Corrupted cache file should return null, but did not");
  }
  console.log("  ✓ Corrupted disk file handled gracefully without crashing (returned null)");

  // 4. Test Cache Purge
  cacheManager.clear();
  const stats = cacheManager.getStats();
  if (stats.totalFiles !== 0) {
    throw new Error(`Cache clear failed, ${stats.totalFiles} files remained`);
  }
  console.log("  ✓ Cache directory purged successfully (0 files remaining)");

  return true;
}

if (process.argv[1]?.includes("08-edge-cache-collision-eviction.test.ts")) {
  runTest().then(() => console.log("✓ Edge Test 8 Passed Successfully.\n"));
}
