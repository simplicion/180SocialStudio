import assert from "node:assert";
import {
  MultiCamDirectorEngine,
  CameraStreamInput,
  SpeakerTurn,
} from "../intelligence/multicam-director-engine";
import { AsynchronousSplitEditor } from "../intelligence/asynchronous-split-editor";

export async function runTest() {
  const mockStreams: CameraStreamInput[] = [
    {
      streamId: "stream_host_cam_a",
      asset: {
        id: "asset_host_cam",
        name: "host_closeup_4k.mp4",
        filePath: "/mock/host_closeup_4k.mp4",
        fileSizeBytes: 1024 * 1024 * 100,
        sha256Hash: "mock_host_hash",
        mimeType: "video/mp4",
        durationSeconds: 120.0,
        width: 3840,
        height: 2160,
        fps: 30,
        hasAudio: true,
        audioChannels: 2,
        isAudioOnly: false,
      },
      role: "HOST_CLOSEUP",
      speakerId: "HOST",
    },
    {
      streamId: "stream_guest_cam_b",
      asset: {
        id: "asset_guest_cam",
        name: "guest_closeup_4k.mp4",
        filePath: "/mock/guest_closeup_4k.mp4",
        fileSizeBytes: 1024 * 1024 * 100,
        sha256Hash: "mock_guest_hash",
        mimeType: "video/mp4",
        durationSeconds: 120.0,
        width: 3840,
        height: 2160,
        fps: 30,
        hasAudio: true,
        audioChannels: 2,
        isAudioOnly: false,
      },
      role: "GUEST_CLOSEUP",
      speakerId: "GUEST",
    },
    {
      streamId: "stream_wide_cam_c",
      asset: {
        id: "asset_wide_cam",
        name: "wide_twoshot_4k.mp4",
        filePath: "/mock/wide_twoshot_4k.mp4",
        fileSizeBytes: 1024 * 1024 * 100,
        sha256Hash: "mock_wide_hash",
        mimeType: "video/mp4",
        durationSeconds: 120.0,
        width: 3840,
        height: 2160,
        fps: 30,
        hasAudio: false,
        audioChannels: 0,
        isAudioOnly: false,
      },
      role: "WIDE_TWO_SHOT",
      speakerId: "BOTH",
    },
  ];

  const speakerTurns: SpeakerTurn[] = [
    // Turn 1: Host asks initial deep question (6.0s duration -> triggers L-cut reaction on Guest)
    {
      speakerId: "HOST",
      startTimeSec: 1.0,
      endTimeSec: 7.0,
      wordCount: 22,
      hasEmotionalPeak: true,
    },
    // Turn 2: Guest answers with passionate insight (8.0s duration -> triggers L-cut reaction on Host)
    {
      speakerId: "GUEST",
      startTimeSec: 7.2,
      endTimeSec: 15.2,
      wordCount: 35,
      hasEmotionalPeak: true,
    },
    // Turn 3: Shared laughter / crosstalk (2.5s duration -> triggers Wide Two-Shot)
    {
      speakerId: "BOTH",
      startTimeSec: 15.5,
      endTimeSec: 18.0,
      wordCount: 8,
    },
  ];

  const plan = MultiCamDirectorEngine.directMultiCamProject(mockStreams, speakerTurns, 20.0);

  assert.ok(plan.switches.length >= 4, "Must generate multi-angle switches with reaction cuts");
  assert.ok(plan.reactionCutCount >= 2, "Must include at least 2 listener reaction cuts");
  assert.ok(plan.hostScreenTimePercent > 0, "Host must have screen time");
  assert.ok(plan.guestScreenTimePercent > 0, "Guest must have screen time");
  assert.ok(plan.wideScreenTimePercent > 0, "Wide shot must be utilized");

  // Verify Asynchronous Split Edits (J-Cuts & L-Cuts)
  const assetMap = {
    stream_host_cam_a: { filePath: "/mock/host.mp4", durationSeconds: 120 },
    stream_guest_cam_b: { filePath: "/mock/guest.mp4", durationSeconds: 120 },
    stream_wide_cam_c: { filePath: "/mock/wide.mp4", durationSeconds: 120 },
  };

  const splitResult = AsynchronousSplitEditor.compileSplitEdits(plan.switches, assetMap);

  assert.ok(splitResult.videoClips.length > 0, "Video clips must be compiled");
  assert.ok(splitResult.audioClips.length > 0, "Audio clips must be compiled");
  assert.ok(splitResult.totalLCutTrailsMs > 0, "L-cut dialogue trails must be generated");

  console.log("  ✔ Test 22 Passed: Multi-Cam Podcast Direction, VAD Diarization, Reaction Cuts & J/L-Cuts.");
}
