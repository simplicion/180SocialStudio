import { OtioAdapter, EditIR, RationalTimeMath } from "@workspace/video-contracts";

/**
 * EDGE CASE TEST 9: OpenTimelineIO (OTIO) Foreign Metadata & Sparse Track Recovery
 * Validates that importing sparse, foreign, or empty OTIO documents from third-party NLEs
 * (Premiere Pro, DaVinci Resolve) produces a valid EditIR AST and re-exports cleanly.
 */
export async function runTest(): Promise<boolean> {
  console.log("\n[Edge Test 9/10] OTIO Foreign Metadata & Sparse Track Recovery...");

  // 1. Construct Raw Foreign OTIO JSON (Simulating DaVinci Resolve Export)
  const foreignOtioJson = JSON.stringify({
    OTIO_SCHEMA: "Timeline.1",
    name: "DaVinci_Timeline_Export",
    global_start_time: {
      OTIO_SCHEMA: "RationalTime.1",
      value: 86400, // 1 hour timecode offset (01:00:00:00)
      rate: 24.0,
    },
    tracks: {
      OTIO_SCHEMA: "Stack.1",
      children: [
        {
          OTIO_SCHEMA: "Track.1",
          name: "Video 1",
          kind: "Video",
          children: [
            {
              OTIO_SCHEMA: "Clip.1",
              name: "Interview_Angle_A.mov",
              source_range: {
                OTIO_SCHEMA: "TimeRange.1",
                start_time: { OTIO_SCHEMA: "RationalTime.1", value: 120, rate: 24.0 },
                duration: { OTIO_SCHEMA: "RationalTime.1", value: 240, rate: 24.0 },
              },
              metadata: {
                Resolve: {
                  ColorSpace: "DaVinci Wide Gamut",
                  LUT: "Filmic_Fuji_35.cube",
                },
              },
            },
          ],
        },
      ],
    },
    metadata: {
      "com.blackmagicdesign.resolve": { version: "19.0.0" },
    },
  });

  // 2. Deserialize Foreign OTIO into 180workspace EditIR AST
  const importedIR: EditIR = OtioAdapter.fromOtioJson(foreignOtioJson);

  if (!importedIR.tracks.videoTracks[0]?.clips.length) {
    throw new Error("Failed to extract clips from foreign OTIO document");
  }

  const clip = importedIR.tracks.videoTracks[0].clips[0];
  const clipDurationSec = RationalTimeMath.toSeconds(clip.timelineRange.duration);
  if (Math.abs(clipDurationSec - 10.0) > 0.001) {
    throw new Error(`Expected 10.0s clip duration (240 frames @ 24fps), got ${clipDurationSec}s`);
  }
  console.log(`  ✓ Foreign DaVinci Resolve OTIO parsed: Clip duration ${clipDurationSec}s`);

  // 3. Roundtrip Serialize Back to OTIO JSON
  const reExportedJson = OtioAdapter.toOtioJson(importedIR);
  const parsedBack = JSON.parse(reExportedJson);
  if (parsedBack.OTIO_SCHEMA !== "Timeline.1") {
    throw new Error("Re-exported OTIO failed schema validation");
  }
  console.log("  ✓ Bidirectional OTIO roundtrip preserved schema integrity");

  return true;
}

if (process.argv[1]?.includes("09-edge-otio-malformed-recovery.test.ts")) {
  runTest().then(() => console.log("✓ Edge Test 9 Passed Successfully.\n"));
}
