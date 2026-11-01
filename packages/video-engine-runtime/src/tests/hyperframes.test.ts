import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { HyperFramesRunner } from "../hyperframes/hyperframes-runner";
import { buildHyperFramesSvg } from "../hyperframes/templates";
import { DeterministicPlanner, TimelineContext, MediaIntelligenceGraph } from "@workspace/video-contracts";

async function testHyperFrames() {
  console.log("=== [TEST SUITE] HyperFrames & AI Director Motion Graphics ===");

  const tmpDir = path.join(os.tmpdir(), `hyperframes_test_${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    // 1. Test SVG Template Rendering
    console.log("-> Step 1: Testing Hormozi Counter Card Template...");
    const hormozi = buildHyperFramesSvg("hormozi-counter", {
      title: "Quarterly Revenue Peak",
      metricValue: "$2.4M",
      metricLabel: "Net ARR Generated",
      tag: "PROVEN RECORD",
    });

    if (!hormozi.svg.includes("$2.4M") || !hormozi.svg.includes("Quarterly Revenue Peak")) {
      throw new Error("Hormozi card missing expected props");
    }
    console.log("✓ Hormozi Counter Card compiled successfully (width: " + hormozi.width + ", height: " + hormozi.height + ")");

    console.log("-> Step 2: Testing Vox Explainer Card Template...");
    const vox = buildHyperFramesSvg("vox-explainer", {
      title: "The 3-Second Retention Rule",
      subtitle: "Why the opening hook determines algorithmic velocity",
      tag: "KEY INSIGHT",
      accentColor: "#3B82F6",
    });

    if (!vox.svg.includes("The 3-Second Retention Rule") || !vox.svg.includes("#3B82F6")) {
      throw new Error("Vox Explainer card missing expected styling");
    }
    console.log("✓ Vox Explainer Card compiled successfully");

    // 2. Test HyperFramesRunner disk generation and FFmpeg filter generation
    console.log("-> Step 3: Testing HyperFramesRunner disk asset creation & FFmpeg filter syntax...");
    const descriptor = HyperFramesRunner.generateCard(
      {
        type: "renderMotionGraphic",
        templateId: "vox-explainer",
        title: "Rule #1: High Retention Cut",
        subtitle: "Never leave more than 150ms of dead air",
        tag: "EDIT RULE",
        timelineStartSec: 4.5,
        durationSec: 3.5,
        position: "lower_third",
      },
      tmpDir
    );

    if (!fs.existsSync(descriptor.svgPath)) {
      throw new Error("SVG file was not created on disk");
    }
    if (!descriptor.filterComplexString.includes("overlay=x=") || !descriptor.filterComplexString.includes("between(t,4.5,8)")) {
      throw new Error("Generated FFmpeg filter string has invalid syntax: " + descriptor.filterComplexString);
    }
    console.log("✓ Card generated at: " + descriptor.svgPath);
    console.log("✓ Filter complex string: " + descriptor.filterComplexString);

    // 3. Test Autonomous AI Director Placement
    console.log("-> Step 4: Testing Autonomous AI Director Semantic Cue Placement...");
    const mockContext: any = {
      projectDurationSec: 30.0,
      clipsCount: 1,
      currentAspect: "9:16",
      currentResolution: { width: 1080, height: 1920 },
      hasMusic: false,
      hasCaptions: false,
      transcriptWordsCount: 10,
      userConstraints: {
        doNotRemoveIntro: false,
        keepEnding: false,
        protectedTimeRanges: [],
        doNotAddMusic: false,
        useUploadedBrollOnly: true,
        lockedTrackIds: [],
        preserveVoiceAudio: true,
      },
    };

    const mockGraph: any = {
      transcript: [
        { id: "w1", word: "Welcome", startSeconds: 0.5, endSeconds: 0.9, confidence: 0.98, isEmphasis: false, emphasisScore: 0, energyScore: 0.5 },
        { id: "w2", word: "Here", startSeconds: 1.0, endSeconds: 1.3, confidence: 0.98, isEmphasis: false, emphasisScore: 0, energyScore: 0.5 },
        { id: "w3", word: "is", startSeconds: 1.4, endSeconds: 1.6, confidence: 0.98, isEmphasis: false, emphasisScore: 0, energyScore: 0.5 },
        { id: "w4", word: "the", startSeconds: 1.7, endSeconds: 1.9, confidence: 0.98, isEmphasis: false, emphasisScore: 0, energyScore: 0.5 },
        { id: "w5", word: "secret", startSeconds: 2.0, endSeconds: 2.4, confidence: 0.98, isEmphasis: true, emphasisScore: 0.9, energyScore: 0.8 },
        { id: "w6", word: "to", startSeconds: 2.5, endSeconds: 2.7, confidence: 0.98, isEmphasis: false, emphasisScore: 0, energyScore: 0.5 },
        { id: "w7", word: "making", startSeconds: 2.8, endSeconds: 3.1, confidence: 0.98, isEmphasis: false, emphasisScore: 0, energyScore: 0.5 },
        { id: "w8", word: "$100,000", startSeconds: 9.5, endSeconds: 10.2, confidence: 0.98, isEmphasis: true, emphasisScore: 0.95, energyScore: 0.9 },
        { id: "w9", word: "every", startSeconds: 10.3, endSeconds: 10.6, confidence: 0.98, isEmphasis: false, emphasisScore: 0, energyScore: 0.5 },
        { id: "w10", word: "month", startSeconds: 10.7, endSeconds: 11.0, confidence: 0.98, isEmphasis: false, emphasisScore: 0, energyScore: 0.5 },
      ],
      silences: [],
      faces: [],
      audioEvents: [],
      brollOpportunities: [],
      fillerWords: [],
      sceneChanges: [],
    };

    const plan = DeterministicPlanner.plan("edit this video with high energy and motion graphics", mockContext, mockGraph);
    const motionOps = plan.operations.filter((o) => o.type === "renderMotionGraphic");

    console.log("Autonomous Director generated " + motionOps.length + " motion graphic operations:");
    motionOps.forEach((op: any) => {
      console.log(`  - [${op.templateId}] @ ${op.timelineStartSec}s: "${op.title}" (Reason: ${op.reason})`);
    });

    if (motionOps.length === 0) {
      throw new Error("AI Director failed to autonomously place motion graphics based on transcript cues");
    }

    const hasHormozi = motionOps.some((o: any) => o.templateId === "hormozi-counter" && o.metricValue.includes("$100,000"));
    const hasVox = motionOps.some((o: any) => o.templateId === "vox-explainer");

    if (!hasHormozi && !hasVox) {
      throw new Error("Expected AI Director to detect $100,000 metric or secret explainer cue");
    }

    console.log("✓ AI Director autonomously identified cues and injected motion graphic operations!");
    console.log("=== ALL HYPERFRAMES TESTS PASSED SUCCESSFULLY! ===");
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

testHyperFrames().catch((err) => {
  console.error("HyperFrames Test Failed:", err);
  process.exit(1);
});
