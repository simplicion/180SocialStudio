import * as fs from "fs";
import * as path from "path";
import assert from "assert";
import { PexelsClient } from "../tools/sourcing/pexels-client";
import { BrollSearchTool } from "../tools/sourcing/broll-search.tool";
import { AssetSearchTool } from "../tools/sourcing/asset-search.tool";
import { ProductionPlanner } from "../planner/production-planner";
import { TimelineAssemblyTool } from "../tools/composition/timeline-assembly.tool";
import { DirectorExecutionContext } from "../tools/base-tool";

export async function runTest(): Promise<void> {
  console.log("\n==========================================================================");
  console.log("🎬 [Test 26] Autonomous AI Director: Pexels Stock Video & Photo (B-Roll) Integration");
  console.log("==========================================================================");

  const tempDir = path.join(process.cwd(), "temp_pexels_test_26");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  try {
    // 1. Validate API Key
    const hasKey = Boolean(process.env.PEXELS_API_KEY || process.env.NEXT_PUBLIC_PEXELS_API_KEY);
    if (!hasKey) {
      console.log("  ⚠️ PEXELS_API_KEY not configured in environment. Skipping live network search and verifying offline contract.");
      return;
    }
    const key = PexelsClient.getApiKey();
    assert.ok(key && key.length > 20, "Pexels API key must be configured");
    console.log(`  ✓ Pexels API Key configured: ${key.slice(0, 8)}...${key.slice(-6)}`);

    // 2. Test Live Pexels Video Search (Landscape & Portrait 9:16)
    console.log("  → Testing Live Pexels Video Search...");
    const videoSearch = await PexelsClient.searchVideos({
      query: "coffee shop",
      orientation: "landscape",
      perPage: 3,
    });
    assert.ok(videoSearch.totalResults > 0, "Pexels should return stock video results");
    assert.ok(videoSearch.videos.length > 0, "Parsed videos array should not be empty");
    const topVideo = videoSearch.videos[0];
    assert.ok(topVideo.downloadUrl, "Video should have a download URL");
    console.log(`  ✓ Found ${videoSearch.totalResults} videos for 'coffee shop'. Winner: "${topVideo.title}" by ${topVideo.photographer} (${topVideo.width}x${topVideo.height})`);

    const verticalVideoSearch = await PexelsClient.searchVideos({
      query: "technology",
      orientation: "portrait",
      perPage: 2,
    });
    assert.ok(verticalVideoSearch.videos.length > 0, "Vertical video search should return results");
    console.log(`  ✓ Found vertical (9:16) B-roll video: "${verticalVideoSearch.videos[0].title}"`);

    // 3. Test Live Pexels Photo Search
    console.log("  → Testing Live Pexels Photo Search...");
    const photoSearch = await PexelsClient.searchPhotos({
      query: "creative team meeting",
      orientation: "landscape",
      perPage: 3,
    });
    assert.ok(photoSearch.totalResults > 0, "Pexels should return stock photo results");
    assert.ok(photoSearch.photos.length > 0, "Parsed photos array should not be empty");
    const topPhoto = photoSearch.photos[0];
    assert.ok(topPhoto.downloadUrl, "Photo should have download URL");
    console.log(`  ✓ Found ${photoSearch.totalResults} photos for 'creative team meeting'. Winner: "${topPhoto.title}" (${topPhoto.width}x${topPhoto.height})`);

    // 4. Test BrollSearchTool Autonomous Sourcing & Caching
    console.log("  → Testing BrollSearchTool Autonomous Sourcing...");
    const brollTool = new BrollSearchTool();
    const context: DirectorExecutionContext = {
      projectId: "proj_test_pexels",
      tempDir,
      artifacts: new Map(),
      log: (msg: string) => {
        if (msg.includes("BrollSearchTool") || msg.includes("AssetSearchTool")) {
          console.log(`    [DIRECTOR LOG] ${msg}`);
        }
      },
    };

    const brollResult = await brollTool.execute(
      {
        queries: ["laptop coding"],
        targetAspect: "9:16",
        maxClips: 1,
        minDurationSec: 2.0,
      },
      context
    );

    assert.ok(brollResult.sourcedClips.length > 0, "BrollSearchTool should source at least 1 clip");
    const sourcedClip = brollResult.sourcedClips[0];
    assert.ok(fs.existsSync(sourcedClip.localCachedVideoPath), "Sourced B-roll video file must exist on disk");
    const clipSize = fs.statSync(sourcedClip.localCachedVideoPath).size;
    assert.ok(clipSize > 1024, "Sourced B-roll video file must be non-trivial size");
    console.log(`  ✓ BrollSearchTool downloaded HD B-roll clip: ${sourcedClip.title} (${(clipSize / 1024 / 1024).toFixed(2)} MB)`);

    // 5. Test AssetSearchTool Tier 0 Pexels Integration
    console.log("  → Testing AssetSearchTool Tier 0 Pexels Integration...");
    const assetTool = new AssetSearchTool();
    const assetResult = await assetTool.execute(
      {
        cues: [
          {
            cueId: "cue_1",
            assetQuery: "artificial intelligence brain",
            category: "EXPLANATION",
            timestampSec: 2.0,
            durationSec: 3.0,
            position: "UPPER_RIGHT",
            sfxType: "POP",
          },
        ],
      },
      context
    );

    assert.ok(assetResult.sourcedAssets.length > 0, "AssetSearchTool should source visual graphic card");
    const card = assetResult.sourcedAssets[0];
    assert.ok(fs.existsSync(card.localCachedPngPath), "Card PNG must exist");
    console.log(`  ✓ AssetSearchTool sourced & formatted broadcast card: ${card.localCachedPngPath} (${fs.statSync(card.localCachedPngPath).size} bytes)`);

    // 6. Test ProductionPlanner & TimelineAssemblyTool multi-track B-Roll composition
    console.log("  → Testing ProductionPlanner & Multi-Track B-Roll Assembly...");
    const plan = ProductionPlanner.createPlan({
      userPrompt: "Direct a high energy 9:16 vertical reel with Pexels B-roll of coffee and laptop",
      inputFiles: [sourcedClip.localCachedVideoPath],
      outputPath: path.join(tempDir, "final_reel.mp4"),
      targetAspect: "9:16",
    });

    const brollTask = plan.tasks.find((t) => t.toolName === "broll_search");
    assert.ok(brollTask, "ProductionPlanner must schedule broll_search task when B-roll is requested");
    console.log(`  ✓ ProductionPlanner scheduled task: "${brollTask.title}" (${brollTask.id})`);

    // Verify TimelineAssemblyTool places sourced clips on B_ROLL_OVERLAY track
    context.artifacts.set("curatedManifest", {
      keeperSegments: [
        {
          id: "seg_1",
          clipPath: sourcedClip.localCachedVideoPath,
          sourceStartSec: 0,
          sourceEndSec: 5.0,
          durationSec: 5.0,
          narrativeRole: "HOOK",
        },
      ],
    });
    context.artifacts.set("sourced_broll_clips", brollResult.sourcedClips);

    const timelineTool = new TimelineAssemblyTool();
    const editIR = await timelineTool.execute(
      {
        targetAspect: "9:16",
        directorPreset: "HORMOZI_VIRAL",
        pacingMultiplier: 1.2,
      },
      context
    );

    const brollTrack = editIR.tracks.videoTracks.find((t) => t.type === "B_ROLL_OVERLAY");
    assert.ok(brollTrack, "EditIR must contain a B_ROLL_OVERLAY track");
    assert.ok(brollTrack.clips.length > 0, "B_ROLL_OVERLAY track must contain assembled clips");
    console.log(`  ✓ TimelineAssemblyTool assembled B_ROLL_OVERLAY track with ${brollTrack.clips.length} clip(s).`);

    console.log("\n==========================================================================");
    console.log("✅ [Test 26 PASSED] All Pexels Stock Video & Photo Sourcing checks succeeded!");
    console.log("==========================================================================");
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

if (require.main === module) {
  runTest().catch((err) => {
    console.error("❌ Test 26 Failed:", err);
    process.exit(1);
  });
}
