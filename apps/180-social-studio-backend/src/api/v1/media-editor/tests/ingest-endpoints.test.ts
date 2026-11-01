import { YtDlpService } from "@workspace/video-engine-runtime";

async function runSimulation() {
  console.log("=== Testing Media Ingest Endpoints & Validation ===");

  // 1. Validate invalid URL handling
  const badUrls = [
    "",
    "http://127.0.0.1:8080/evil.mp4",
    "https://unsupported-host.xyz/video.mp4",
  ];

  for (const url of badUrls) {
    const val = YtDlpService.validateUrl(url);
    if (val.valid) {
      throw new Error(`Expected URL to fail validation: ${url}`);
    }
    console.log(`  [OK] Successfully rejected: ${url || "(empty)"} -> ${val.error}`);
  }

  // 2. Validate valid URL handling
  const goodUrls = [
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ",
    "https://www.instagram.com/reel/C3abc123/",
  ];

  for (const url of goodUrls) {
    const val = YtDlpService.validateUrl(url);
    if (!val.valid) {
      throw new Error(`Expected URL to pass validation: ${url}`);
    }
    console.log(`  [OK] Valid URL accepted: ${url}`);
  }

  console.log("=== All Ingest Service Checks Passed! ===");
}

runSimulation().catch((err) => {
  console.error("Simulation failed:", err);
  process.exit(1);
});

