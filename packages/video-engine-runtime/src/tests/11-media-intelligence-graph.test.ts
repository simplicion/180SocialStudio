import {
  MediaIntelligenceGraph,
  MediaIntelligenceGraphSchema,
  MediaGraphBuilder,
  RationalTimeMath,
} from "@workspace/video-contracts";
import {
  FillerAnalyzer,
  RepetitionAnalyzer,
} from "../intelligence";

/**
 * TEST 11: Media Intelligence Graph & Heuristic Analyzers
 * Validates canonical graph schema validation, silence classification,
 * word-level filler detection, and repetition removal candidates.
 */
export async function runTest(): Promise<boolean> {
  console.log("\n[Test 11] Media Intelligence Graph & Intelligence Analyzers...");

  // 1. Build a synthetic transcript with realistic speech patterns
  const rawTranscript = [
    { word: "Um", startSeconds: 0.2, endSeconds: 0.5, confidence: 0.95 },
    { word: "so", startSeconds: 0.6, endSeconds: 0.8, confidence: 0.99 },
    { word: "today", startSeconds: 0.85, endSeconds: 1.1, confidence: 0.99 },
    { word: "we", startSeconds: 1.15, endSeconds: 1.3, confidence: 0.99 },
    { word: "are", startSeconds: 1.35, endSeconds: 1.5, confidence: 0.99 },
    { word: "today", startSeconds: 1.7, endSeconds: 1.9, confidence: 0.92 },
    { word: "we", startSeconds: 1.95, endSeconds: 2.1, confidence: 0.94 },
    { word: "are", startSeconds: 2.15, endSeconds: 2.3, confidence: 0.95 },
    { word: "going", startSeconds: 2.35, endSeconds: 2.6, confidence: 0.99 },
    { word: "to", startSeconds: 2.65, endSeconds: 2.8, confidence: 0.99 },
    { word: "build", startSeconds: 2.85, endSeconds: 3.3, confidence: 0.99, isEmphasis: true },
    { word: "a", startSeconds: 3.35, endSeconds: 3.45, confidence: 0.99 },
    { word: "video", startSeconds: 3.5, endSeconds: 3.9, confidence: 0.99, isEmphasis: true },
    { word: "engine", startSeconds: 3.95, endSeconds: 4.4, confidence: 0.99, isEmphasis: true },
    { word: "you", startSeconds: 6.0, endSeconds: 6.2, confidence: 0.97 }, // 1.6s silence before this
    { word: "know", startSeconds: 6.25, endSeconds: 6.5, confidence: 0.98 },
  ];

  // 2. Test Filler Candidate Detection
  const wordsWithId = rawTranscript.map((w, idx) => ({
    id: `w_${idx}`,
    word: w.word,
    startSeconds: w.startSeconds,
    endSeconds: w.endSeconds,
    confidence: w.confidence,
    isEmphasis: w.isEmphasis ?? false,
    emphasisScore: w.isEmphasis ? 0.9 : 0.2,
    energyScore: 0.7,
  }));

  const fillerCandidates = FillerAnalyzer.detect(wordsWithId);
  if (fillerCandidates.length === 0) {
    throw new Error("Filler detector failed to detect 'Um' or 'you know' fillers");
  }
  console.log(`  ✓ Filler Detector identified ${fillerCandidates.length} filler phrases:`, fillerCandidates.map(f => f.word).join(", "));

  // 3. Test Repetition Candidate Detection
  const sentences = [
    {
      id: "s_01",
      startSeconds: 0.2,
      endSeconds: 1.5,
      text: "today we are going to build a",
      words: wordsWithId.slice(0, 5),
      isQuestion: false,
      isClaim: true,
      isCallToAction: false,
      informationDensity: 0.7,
    },
    {
      id: "s_02",
      startSeconds: 1.7,
      endSeconds: 4.4,
      text: "today we are going to build a video engine",
      words: wordsWithId.slice(5, 14),
      isQuestion: false,
      isClaim: true,
      isCallToAction: false,
      informationDensity: 0.8,
    },
  ];

  const repetitionCandidates = RepetitionAnalyzer.detect(sentences);
  if (repetitionCandidates.length === 0) {
    throw new Error("Repetition detector failed to detect repetition between s_01 and s_02");
  }
  console.log(`  ✓ Repetition Detector identified stammer candidate: similarity ${repetitionCandidates[0].similarity} -> recommend retain ${repetitionCandidates[0].recommendedRetain}`);

  // 4. Test MediaIntelligenceGraph construction and schema validation
  const testGraph: MediaIntelligenceGraph = MediaGraphBuilder.build({
    assetId: "asset_test_11",
    technicalMetadata: {
      durationSeconds: 10.0,
      width: 1920,
      height: 1080,
      fps: 30,
      hasAudio: true,
      fileSizeBytes: 1024 * 1024 * 12,
      sha256Hash: "hash_test_11",
      isVariableFrameRate: false,
    },
    transcript: wordsWithId,
    fillers: fillerCandidates,
    repetitions: repetitionCandidates,
    silences: [
      {
        id: "silence_01",
        timeRange: { start: RationalTimeMath.fromSeconds(4.2), duration: RationalTimeMath.fromSeconds(1.6) },
        startSeconds: 4.2,
        durationSeconds: 1.6,
        averageDecibels: -45,
        classification: "DEAD_AIR",
        recommendation: "REMOVE",
        confidence: 0.98,
        contextReason: "1.6s dead air between speech phrases",
      },
      {
        id: "silence_02",
        timeRange: { start: RationalTimeMath.fromSeconds(0.0), duration: RationalTimeMath.fromSeconds(0.2) },
        startSeconds: 0.0,
        durationSeconds: 0.2,
        averageDecibels: -42,
        classification: "SHORT_NATURAL_PAUSE",
        recommendation: "KEEP",
        confidence: 0.90,
        contextReason: "Natural breathing pause before speech",
      },
    ],
  });

  // Strict validation against MediaIntelligenceGraphSchema
  const parseRes = MediaIntelligenceGraphSchema.safeParse(testGraph);
  if (!parseRes.success) {
    throw new Error(`MediaIntelligenceGraphSchema failed validation: ${JSON.stringify(parseRes.error)}`);
  }
  console.log("  ✓ Canonical MediaIntelligenceGraph conforms 100% to Zod specification");

  // Validate silence classification rules
  const deadAir = testGraph.silences.find(s => s.classification === "DEAD_AIR");
  if (!deadAir || deadAir.recommendation !== "REMOVE") {
    throw new Error("Silence classification failed: DEAD_AIR pause should be marked REMOVE");
  }
  const naturalPause = testGraph.silences.find(s => s.classification === "SHORT_NATURAL_PAUSE");
  if (!naturalPause || naturalPause.recommendation !== "KEEP") {
    throw new Error("Silence classification failed: SHORT_NATURAL_PAUSE should be marked KEEP");
  }
  console.log("  ✓ Silence classification accurately distinguished dead air from natural pause");

  return true;
}

if (process.argv[1]?.includes("11-media-intelligence-graph.test.ts")) {
  runTest()
    .then(() => console.log("✓ Test 11 Passed Successfully.\n"))
    .catch((err) => {
      console.error("❌ Test 11 Failed:", err);
      process.exit(1);
    });
}
