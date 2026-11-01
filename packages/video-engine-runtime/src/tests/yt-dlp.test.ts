import { YtDlpService } from "../ingest/yt-dlp-service";

async function runTests() {
  console.log("--- Running YtDlpService Unit Tests ---");

  // 1. SSRF and Domain Validation Tests
  console.log("Test 1: SSRF Validation");
  const badIps = [
    "http://127.0.0.1/video.mp4",
    "http://localhost:4000/test",
    "http://169.254.169.254/latest/meta-data/",
    "http://192.168.1.1/router",
    "ftp://youtube.com/watch?v=123",
    "http://malicious-site.com/exploit.mp4",
  ];

  for (const url of badIps) {
    const res = YtDlpService.validateUrl(url);
    if (res.valid) {
      throw new Error(`Expected URL to fail validation: ${url}`);
    }
    console.log(`  [PASS] Blocked disallowed: ${url} (${res.error})`);
  }

  // 2. Allowed domain validations
  console.log("\nTest 2: Allowed Domain Validation");
  const allowed = [
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ",
    "https://www.instagram.com/reel/C3abc123/",
    "https://www.tiktok.com/@creator/video/1234567890",
    "https://vimeo.com/12345678",
  ];

  for (const url of allowed) {
    const res = YtDlpService.validateUrl(url);
    if (!res.valid) {
      throw new Error(`Expected URL to pass validation: ${url} (${res.error})`);
    }
    console.log(`  [PASS] Allowed verified: ${url}`);
  }

  console.log("\n--- All YtDlpService Unit Tests Passed Successfully! ---");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});

