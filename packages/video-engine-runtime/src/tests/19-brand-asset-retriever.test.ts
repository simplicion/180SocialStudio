import * as fs from "fs";
import * as path from "path";
import { AssetRetriever } from "../asset-retriever";

export async function runTest(): Promise<void> {
  console.log("\n[Test 19] Autonomous Brand Asset Retriever & Vector Engine...");

  const tempDir = path.join(process.cwd(), "temp_brand_test_19");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  // 1. Retrieve Pinterest official vector brand logo
  const pinterestLogo = await AssetRetriever.retrieveBrandLogo("pinterest", tempDir);
  if (!fs.existsSync(pinterestLogo.localCachedPath) || fs.statSync(pinterestLogo.localCachedPath).size === 0) {
    throw new Error("Pinterest brand logo generation failed.");
  }
  console.log(`  ✓ Retrieved Pinterest Vector Brand Asset: ${pinterestLogo.localCachedPath} (${fs.statSync(pinterestLogo.localCachedPath).size} bytes)`);

  // 2. Retrieve Instagram official vector logo
  const igLogo = await AssetRetriever.retrieveBrandLogo("instagram", tempDir);
  if (!fs.existsSync(igLogo.localCachedPath) || fs.statSync(igLogo.localCachedPath).size === 0) {
    throw new Error("Instagram brand logo generation failed.");
  }
  console.log(`  ✓ Retrieved Instagram Vector Brand Asset: ${igLogo.localCachedPath} (${fs.statSync(igLogo.localCachedPath).size} bytes)`);

  // 3. Retrieve 5-Star Reviews badge
  const reviewsBadge = await AssetRetriever.retrieveBrandLogo("reviews_stars", tempDir);
  if (!fs.existsSync(reviewsBadge.localCachedPath) || fs.statSync(reviewsBadge.localCachedPath).size === 0) {
    throw new Error("Reviews badge generation failed.");
  }
  console.log(`  ✓ Retrieved 5-Star Rating Badge: ${reviewsBadge.localCachedPath} (${fs.statSync(reviewsBadge.localCachedPath).size} bytes)`);

  // Clean temp dir
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {}
}
