import { AssetClassifier } from "../intelligence/asset-classifier";
import { MediaAssetDescriptor } from "@workspace/video-contracts";

export async function runTest(): Promise<void> {
  console.log("\n[Test 17] Multi-Asset Auto-Classification Engine...");

  // Synthesize 10 diverse project assets (1 talking head, 4 B-rolls, 2 BGM, 1 SFX, 2 Logos)
  const mockAssets: MediaAssetDescriptor[] = [
    {
      id: "asset_talking_head_main",
      name: "interview_camera_a_4k.mp4",
      filePath: "/mock/interview_camera_a_4k.mp4",
      fileSizeBytes: 1024 * 1024 * 250,
      mimeType: "video/mp4",
      durationSeconds: 120.5,
      width: 3840,
      height: 2160,
      fps: 30,
      hasAudio: true,
      sha256Hash: "hash_a_roll",
      isVfr: false,
      audioChannels: 2,
      audioSampleRate: 48000,
      isAudioOnly: false,
    },
    {
      id: "asset_broll_drone",
      name: "drone_city_cinematic.mp4",
      filePath: "/mock/drone_city_cinematic.mp4",
      fileSizeBytes: 1024 * 1024 * 50,
      mimeType: "video/mp4",
      durationSeconds: 8.2,
      width: 1920,
      height: 1080,
      fps: 60,
      hasAudio: false,
      sha256Hash: "hash_drone",
      isVfr: false,
      audioChannels: 0,
      audioSampleRate: 0,
      isAudioOnly: false,
    },
    {
      id: "asset_screencast_loom",
      name: "loom_dashboard_demo.mp4",
      filePath: "/mock/loom_dashboard_demo.mp4",
      fileSizeBytes: 1024 * 1024 * 40,
      mimeType: "video/mp4",
      durationSeconds: 45.0,
      width: 1920,
      height: 1080,
      fps: 30,
      hasAudio: false,
      sha256Hash: "hash_loom",
      isVfr: false,
      audioChannels: 0,
      audioSampleRate: 0,
      isAudioOnly: false,
    },
    {
      id: "asset_bgm_lofi",
      name: "upbeat_lofi_vibes_bgm.mp3",
      filePath: "/mock/upbeat_lofi_vibes_bgm.mp3",
      fileSizeBytes: 1024 * 1024 * 8,
      mimeType: "audio/mpeg",
      durationSeconds: 180.0,
      width: 0,
      height: 0,
      fps: 0,
      hasAudio: true,
      sha256Hash: "hash_bgm",
      isVfr: false,
      audioChannels: 2,
      audioSampleRate: 44100,
      isAudioOnly: true,
    },
    {
      id: "asset_sfx_whoosh",
      name: "whoosh_fast_pop.wav",
      filePath: "/mock/whoosh_fast_pop.wav",
      fileSizeBytes: 1024 * 150,
      mimeType: "audio/wav",
      durationSeconds: 0.8,
      width: 0,
      height: 0,
      fps: 0,
      hasAudio: true,
      sha256Hash: "hash_sfx",
      isVfr: false,
      audioChannels: 2,
      audioSampleRate: 48000,
      isAudioOnly: true,
    },
    {
      id: "asset_logo_pinterest",
      name: "pinterest_brand_logo.png",
      filePath: "/mock/pinterest_brand_logo.png",
      fileSizeBytes: 1024 * 45,
      mimeType: "image/png",
      durationSeconds: 0,
      width: 512,
      height: 512,
      fps: 0,
      hasAudio: false,
      sha256Hash: "hash_logo",
      isVfr: false,
      audioChannels: 0,
      audioSampleRate: 0,
      isAudioOnly: false,
    },
  ];

  const report = await AssetClassifier.classifyProjectFiles(mockAssets);

  // 1. Primary A-Roll validation
  if (!report.primaryARoll || report.primaryARoll.asset.id !== "asset_talking_head_main") {
    throw new Error(`A-Roll classification failed: expected asset_talking_head_main, got ${report.primaryARoll?.asset.id}`);
  }
  console.log(`  ✓ Identified Primary A-Roll: ${report.primaryARoll.asset.name} (${report.primaryARoll.semanticRole})`);

  // 2. Screencast validation
  const screencast = report.supportiveAssets.find((a) => a.semanticRole === "SCREENCAST");
  if (!screencast || screencast.asset.id !== "asset_screencast_loom") {
    throw new Error("Screencast detection failed.");
  }
  console.log(`  ✓ Identified Screencast Cutaway: ${screencast.asset.name}`);

  // 3. Audio BGM & SFX validation
  if (report.bgmTracks.length !== 1 || report.sfxTracks.length !== 1) {
    throw new Error(`Audio classification failed: expected 1 BGM and 1 SFX, got ${report.bgmTracks.length} BGM / ${report.sfxTracks.length} SFX`);
  }
  console.log(`  ✓ Separated Audio Beds: 1 BGM (${report.bgmTracks[0].asset.name}) & 1 SFX (${report.sfxTracks[0].asset.name})`);

  // 4. Logo validation
  const logo = report.graphicOverlays.find((g) => g.semanticRole === "BRAND_LOGO");
  if (!logo) {
    throw new Error("Brand logo detection failed.");
  }
  console.log(`  ✓ Identified Vector Brand Logo: ${logo.asset.name}`);
  console.log(`  ✓ Complete Project Summary: ${report.summary}`);
}
