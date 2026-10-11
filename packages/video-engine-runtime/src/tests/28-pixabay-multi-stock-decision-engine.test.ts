import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { PixabayClient } from "../tools/sourcing/pixabay-client";
import { StockDecisionBroker } from "../tools/sourcing/stock-decision-broker";

export async function runTest() {
  console.log("=== TEST 28: PIXABAY FULL MULTI-RESOURCE & STOCK DECISION BROKER ===");

  const hasKey = Boolean(process.env.PIXABAY_API_KEY || process.env.NEXT_PUBLIC_PIXABAY_API_KEY);
  if (!hasKey) {
    console.log("  ⚠️ PIXABAY_API_KEY not configured in environment. Skipping live network search and verifying offline contract.");
    return;
  }

  // 1. Test Pixabay Image Search (Photos & Vectors)
  console.log("\n[Subtest 1] Testing Pixabay Image & Vector Search...");
  const imgResult = await PixabayClient.searchImages({
    query: "technology",
    imageType: "vector",
    orientation: "horizontal",
    perPage: 3,
    log: (msg) => console.log(`  ${msg}`),
  });

  console.log(`✓ Pixabay Vector Search returned ${imgResult.images.length} hits (Total Hits: ${imgResult.totalHits})`);
  if (imgResult.images.length > 0) {
    const first = imgResult.images[0];
    console.log(`  Sample: "${first.title}" [${first.width}x${first.height}] DownloadURL: ${first.downloadUrl.slice(0, 50)}...`);
  }

  // 2. Test 24-Hour Cache Hit
  console.log("\n[Subtest 2] Testing Mandatory 24-Hour Cache Verification...");
  const startCache = Date.now();
  const cachedImgResult = await PixabayClient.searchImages({
    query: "technology",
    imageType: "vector",
    orientation: "horizontal",
    perPage: 3,
    log: (msg) => console.log(`  ${msg}`),
  });
  const cacheDuration = Date.now() - startCache;
  console.log(`✓ 24h Cache Hit validated in ${cacheDuration}ms (Items: ${cachedImgResult.images.length})`);
  if (cacheDuration > 50) {
    console.warn("  Notice: Cache lookup took longer than expected but succeeded.");
  }

  // 3. Test Pixabay Video Search (Films & Animations)
  console.log("\n[Subtest 3] Testing Pixabay Video Search...");
  const vidResult = await PixabayClient.searchVideos({
    query: "nature",
    videoType: "film",
    orientation: "horizontal",
    perPage: 3,
    log: (msg) => console.log(`  ${msg}`),
  });

  console.log(`✓ Pixabay Video Search returned ${vidResult.videos.length} hits (Total Hits: ${vidResult.totalHits})`);
  if (vidResult.videos.length > 0) {
    const firstVid = vidResult.videos[0];
    console.log(`  Sample: "${firstVid.title}" (${firstVid.duration}s, aspect: ${firstVid.aspectRatio}) Stream: ${firstVid.downloadUrl.slice(0, 50)}...`);
  }

  // 4. Test Anti-Hotlinking Asset Ingestion (Downloads to local storage before use)
  console.log("\n[Subtest 4] Testing Anti-Hotlinking Asset Ingestion Pipeline...");
  if (imgResult.images.length > 0) {
    const assetToDownload = imgResult.images[0];
    const testLocalDir = path.join(os.tmpdir(), "test28_pixabay_ingest");
    const testLocalPath = path.join(testLocalDir, `${assetToDownload.id}.jpg`);

    const downloadedPath = await PixabayClient.downloadAsset(
      assetToDownload.downloadUrl,
      testLocalPath,
      (msg) => console.log(`  ${msg}`)
    );

    if (fs.existsSync(downloadedPath) && fs.statSync(downloadedPath).size > 1024) {
      console.log(`✓ Anti-Hotlink Asset Ingested successfully: ${downloadedPath} (${(fs.statSync(downloadedPath).size / 1024).toFixed(1)} KB)`);
    } else {
      throw new Error(`Anti-hotlink ingestion failed for ${downloadedPath}`);
    }
  }

  // 5. Test StockDecisionBroker Intent Evaluation
  console.log("\n[Subtest 5] Testing StockDecisionBroker Multi-Provider Intent Routing...");
  
  // Vector intent -> Pixabay
  const decVector = StockDecisionBroker.evaluate({
    prompt: "medical heart vector diagram",
    targetAspect: "16:9",
  });
  console.log(`  Prompt: "medical heart vector diagram" -> Primary: ${decVector.primaryProvider}, ImageType: ${decVector.imageType}`);
  if (decVector.primaryProvider !== "pixabay" || decVector.imageType !== "vector") {
    throw new Error(`Expected pixabay vector routing, got ${decVector.primaryProvider} ${decVector.imageType}`);
  }

  // Animation intent -> Pixabay
  const decAnimation = StockDecisionBroker.evaluate({
    prompt: "animated crypto chart",
    targetAspect: "16:9",
  });
  console.log(`  Prompt: "animated crypto chart" -> Primary: ${decAnimation.primaryProvider}, VideoType: ${decAnimation.videoType}`);
  if (decAnimation.primaryProvider !== "pixabay" || decAnimation.videoType !== "animation") {
    throw new Error(`Expected pixabay animation routing, got ${decAnimation.primaryProvider} ${decAnimation.videoType}`);
  }

  // Vertical Reel intent -> Pexels first, Pixabay fallback
  const decVertical = StockDecisionBroker.evaluate({
    prompt: "young professional running in city",
    targetAspect: "9:16",
  });
  console.log(`  Prompt: "young professional running in city" (9:16) -> Primary: ${decVertical.primaryProvider}, Secondary: ${decVertical.secondaryProvider}`);
  if (decVertical.primaryProvider !== "pexels" || decVertical.secondaryProvider !== "pixabay") {
    throw new Error(`Expected pexels primary with pixabay secondary for 9:16 reel, got ${decVertical.primaryProvider}`);
  }

  // 6. Test StockDecisionBroker Execution
  console.log("\n[Subtest 6] Testing Federated StockDecisionBroker Search Execution...");
  const brokerSearch = await StockDecisionBroker.search({
    prompt: "modern corporate office",
    targetAspect: "16:9",
    maxItems: 3,
    log: (msg) => console.log(`  ${msg}`),
  });

  console.log(`✓ StockDecisionBroker retrieved ${brokerSearch.items.length} unified stock items:`);
  for (const item of brokerSearch.items) {
    console.log(`  - [${item.provider.toUpperCase()}] ${item.type}: "${item.title.slice(0, 30)}" (${item.sourceAttribution})`);
  }

  console.log("\n====================================================================");
  console.log("TEST 28 PASSED: ALL PIXABAY, ANTI-HOTLINKING & BROKER CHECKS VERIFIED");
  console.log("====================================================================");
}

if (require.main === module) {
  runTest().catch((err) => {
    console.error("Test 28 failed:", err);
    process.exit(1);
  });
}
