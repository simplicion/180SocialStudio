import assert from "node:assert";
import { AssetClassifier } from "../intelligence/asset-classifier";
import { SemanticAssetMatcher } from "../intelligence/semantic-asset-matcher";
import { DirectorStyleResolver } from "@workspace/video-contracts";
import { MediaAssetDescriptor } from "@workspace/video-contracts";

export async function runTest() {
  const mockFiles: MediaAssetDescriptor[] = [
    // 1. Primary Talking Head
    {
      id: "asset_aroll_main",
      name: "main_talking_head_take1.mp4",
      filePath: "/mock/main_talking_head_take1.mp4",
      fileSizeBytes: 1024 * 1024 * 20,
      sha256Hash: "mock_hash_01",
      mimeType: "video/mp4",
      durationSeconds: 45.2,
      width: 1080,
      height: 1920,
      fps: 30,
      hasAudio: true,
      audioChannels: 2,
      isAudioOnly: false,
    },
    // 2-4. Supportive B-Roll
    {
      id: "asset_broll_1",
      name: "broll_coffee_shop.mp4",
      filePath: "/mock/broll_coffee_shop.mp4",
      fileSizeBytes: 1024 * 1024 * 5,
      sha256Hash: "mock_hash_02",
      mimeType: "video/mp4",
      durationSeconds: 6.4,
      width: 1920,
      height: 1080,
      fps: 60,
      hasAudio: false,
      audioChannels: 0,
      isAudioOnly: false,
    },
    {
      id: "asset_broll_2",
      name: "broll_typing_laptop.mp4",
      filePath: "/mock/broll_typing_laptop.mp4",
      fileSizeBytes: 1024 * 1024 * 4,
      sha256Hash: "mock_hash_03",
      mimeType: "video/mp4",
      durationSeconds: 4.8,
      width: 1920,
      height: 1080,
      fps: 60,
      hasAudio: false,
      audioChannels: 0,
      isAudioOnly: false,
    },
    {
      id: "asset_broll_3",
      name: "broll_city_timelapse.mp4",
      filePath: "/mock/broll_city_timelapse.mp4",
      fileSizeBytes: 1024 * 1024 * 8,
      sha256Hash: "mock_hash_04",
      mimeType: "video/mp4",
      durationSeconds: 12.0,
      width: 1920,
      height: 1080,
      fps: 30,
      hasAudio: false,
      audioChannels: 0,
      isAudioOnly: false,
    },
    // 5-6. Screencasts
    {
      id: "asset_screen_1",
      name: "screen_recording_dashboard_demo.mp4",
      filePath: "/mock/screen_recording_dashboard_demo.mp4",
      fileSizeBytes: 1024 * 1024 * 10,
      sha256Hash: "mock_hash_05",
      mimeType: "video/mp4",
      durationSeconds: 15.0,
      width: 1920,
      height: 1080,
      fps: 30,
      hasAudio: false,
      audioChannels: 0,
      isAudioOnly: false,
    },
    {
      id: "asset_screen_2",
      name: "loom_walkthrough_features.mp4",
      filePath: "/mock/loom_walkthrough_features.mp4",
      fileSizeBytes: 1024 * 1024 * 6,
      sha256Hash: "mock_hash_06",
      mimeType: "video/mp4",
      durationSeconds: 8.5,
      width: 1920,
      height: 1080,
      fps: 30,
      hasAudio: false,
      audioChannels: 0,
      isAudioOnly: false,
    },
    // 7-8. BGM Beds
    {
      id: "asset_bgm_1",
      name: "lofi_ambient_beat_track.mp3",
      filePath: "/mock/lofi_ambient_beat_track.mp3",
      fileSizeBytes: 1024 * 1024 * 3,
      sha256Hash: "mock_hash_07",
      mimeType: "audio/mpeg",
      durationSeconds: 120.0,
      width: 0,
      height: 0,
      fps: 0,
      hasAudio: true,
      audioChannels: 2,
      isAudioOnly: true,
    },
    {
      id: "asset_bgm_2",
      name: "cinematic_electronic_soundtrack.wav",
      filePath: "/mock/cinematic_electronic_soundtrack.wav",
      fileSizeBytes: 1024 * 1024 * 5,
      sha256Hash: "mock_hash_08",
      mimeType: "audio/wav",
      durationSeconds: 90.0,
      width: 0,
      height: 0,
      fps: 0,
      hasAudio: true,
      audioChannels: 2,
      isAudioOnly: true,
    },
    // 9-11. SFX Transients
    {
      id: "asset_sfx_1",
      name: "whoosh_transition_fast.wav",
      filePath: "/mock/whoosh_transition_fast.wav",
      fileSizeBytes: 1024 * 200,
      sha256Hash: "mock_hash_09",
      mimeType: "audio/wav",
      durationSeconds: 0.8,
      width: 0,
      height: 0,
      fps: 0,
      hasAudio: true,
      audioChannels: 2,
      isAudioOnly: true,
    },
    {
      id: "asset_sfx_2",
      name: "pop_click_ui.wav",
      filePath: "/mock/pop_click_ui.wav",
      fileSizeBytes: 1024 * 100,
      sha256Hash: "mock_hash_10",
      mimeType: "audio/wav",
      durationSeconds: 0.4,
      width: 0,
      height: 0,
      fps: 0,
      hasAudio: true,
      audioChannels: 2,
      isAudioOnly: true,
    },
    {
      id: "asset_sfx_3",
      name: "riser_tension_hit.wav",
      filePath: "/mock/riser_tension_hit.wav",
      fileSizeBytes: 1024 * 300,
      sha256Hash: "mock_hash_11",
      mimeType: "audio/wav",
      durationSeconds: 1.8,
      width: 0,
      height: 0,
      fps: 0,
      hasAudio: true,
      audioChannels: 2,
      isAudioOnly: true,
    },
    // 12-15. Brand Logos & Graphic Stills
    {
      id: "asset_brand_1",
      name: "pinterest_brand_logo.svg",
      filePath: "/mock/pinterest_brand_logo.svg",
      fileSizeBytes: 1024 * 50,
      sha256Hash: "mock_hash_12",
      mimeType: "image/svg+xml",
      durationSeconds: 0,
      width: 512,
      height: 512,
      fps: 0,
      hasAudio: false,
      audioChannels: 0,
      isAudioOnly: false,
    },
    {
      id: "asset_brand_2",
      name: "instagram_verified_badge.png",
      filePath: "/mock/instagram_verified_badge.png",
      fileSizeBytes: 1024 * 30,
      sha256Hash: "mock_hash_13",
      mimeType: "image/png",
      durationSeconds: 0,
      width: 256,
      height: 256,
      fps: 0,
      hasAudio: false,
      audioChannels: 0,
      isAudioOnly: false,
    },
    {
      id: "asset_brand_3",
      name: "stripe_payment_icon.png",
      filePath: "/mock/stripe_payment_icon.png",
      fileSizeBytes: 1024 * 40,
      sha256Hash: "mock_hash_14",
      mimeType: "image/png",
      durationSeconds: 0,
      width: 256,
      height: 256,
      fps: 0,
      hasAudio: false,
      audioChannels: 0,
      isAudioOnly: false,
    },
    {
      id: "asset_graphic_4",
      name: "five_star_reviews_card.png",
      filePath: "/mock/five_star_reviews_card.png",
      fileSizeBytes: 1024 * 80,
      sha256Hash: "mock_hash_15",
      mimeType: "image/png",
      durationSeconds: 0,
      width: 600,
      height: 200,
      fps: 0,
      hasAudio: false,
      audioChannels: 0,
      isAudioOnly: false,
    },
  ];

  const report = await AssetClassifier.classifyProjectFiles(mockFiles);

  assert.ok(report.primaryARoll, "Primary A-Roll must be identified");
  assert.strictEqual(report.primaryARoll.asset.id, "asset_aroll_main");
  assert.strictEqual(report.primaryARoll.semanticRole, "A_ROLL_TALKING_HEAD");
  assert.strictEqual(report.supportiveAssets.length, 5);
  assert.strictEqual(report.bgmTracks.length, 2);
  assert.strictEqual(report.sfxTracks.length, 3);
  assert.strictEqual(report.graphicOverlays.length, 4);

  const transcript = [
    { word: "Welcome", startSeconds: 0.5, endSeconds: 0.9, confidence: 0.95, isEmphasis: false },
    { word: "to", startSeconds: 0.9, endSeconds: 1.1, confidence: 0.95, isEmphasis: false },
    { word: "Pinterest", startSeconds: 1.1, endSeconds: 1.8, confidence: 0.98, isEmphasis: true },
    { word: "growth", startSeconds: 1.8, endSeconds: 2.2, confidence: 0.95, isEmphasis: false },
    { word: "Here", startSeconds: 5.0, endSeconds: 5.3, confidence: 0.95, isEmphasis: false },
    { word: "is", startSeconds: 5.3, endSeconds: 5.5, confidence: 0.95, isEmphasis: false },
    { word: "our", startSeconds: 5.5, endSeconds: 5.8, confidence: 0.95, isEmphasis: false },
    { word: "dashboard", startSeconds: 5.8, endSeconds: 6.5, confidence: 0.98, isEmphasis: true },
  ];

  const style = DirectorStyleResolver.resolve("Instagram aesthetic reel with smooth transitions");
  const match = SemanticAssetMatcher.matchAssetsToTranscript(transcript, report, style, 45.2);

  assert.ok(match.cues.length > 0, "Cues must be matched from transcript");
  const brandCue = match.cues.find((c) => c.type === "BRAND_BADGE");
  assert.ok(brandCue, "Brand badge cue must be created");
  assert.strictEqual(brandCue.assetId, "asset_brand_1");

  console.log("  ✔ Test 20 Passed: Multi-asset batch project classification (15 files) & semantic assembly.");
}
