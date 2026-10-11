import * as fs from "fs";
import * as path from "path";
import assert from "assert";
import { ProductionPlanner } from "../planner/production-planner";
import { PlanExecutor } from "../planner/plan-executor";
import { DirectorExecutionContext } from "../tools/base-tool";
import { EditIR, RationalTimeMath } from "@workspace/video-contracts";

export async function runTest(): Promise<void> {
  console.log("\n==========================================================================");
  console.log("🎬 [Test 27] Zero-Footage Autonomous Video Creation & Cartesia Speech Engine");
  console.log("==========================================================================");

  const tempDir = path.join(process.cwd(), "temp_zero_footage_test_27");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const outputPath = path.join(tempDir, "master_zero_footage.mp4");
  const creativePrompt =
    "Create a punchy 15-second vertical TikTok ad showcasing 180workspace autonomous video editing with confident commercial voiceover and tech stock visuals.";

  // -------------------------------------------------------------------------
  // 1. Verify DAG Generation for Zero-Footage Input (inputFiles: [])
  // -------------------------------------------------------------------------
  console.log("  → Formulating DAG Production Plan for 0 input files...");
  const plan = ProductionPlanner.createPlan({
    userPrompt: creativePrompt,
    inputFiles: [], // Zero footage provided
    outputPath,
    targetAspect: "9:16",
    customStyleKey: "HORMOZI_VIRAL",
  });

  assert.ok(plan.tasks.length >= 8, `Plan should have at least 8 DAG tasks (got ${plan.tasks.length})`);
  console.log(`  ✓ Plan generated with ${plan.tasks.length} discrete DAG tasks`);

  // Verify task_00b_voice_synthesize is present and is root task
  const voiceTask = plan.tasks.find((t) => t.id === "task_00b_voice_synthesize");
  assert.ok(voiceTask, "task_00b_voice_synthesize must be present in zero-footage plan");
  assert.strictEqual(voiceTask.toolName, "voice_synthesize", "Tool must be voice_synthesize");
  assert.deepStrictEqual(voiceTask.dependencies, [], "Voice synthesis must have 0 dependencies");
  console.log("  ✓ task_00b_voice_synthesize correctly scheduled as root DAG task");

  // Verify speech_transcribe depends on voice synthesis
  const transcribeTask = plan.tasks.find((t) => t.id === "task_02_transcribe");
  assert.ok(transcribeTask, "task_02_transcribe must be present");
  assert.ok(
    transcribeTask.dependencies.includes("task_00b_voice_synthesize"),
    "Transcription must depend on voice synthesis"
  );
  console.log("  ✓ task_02_transcribe correctly depends on task_00b_voice_synthesize");

  // Verify B-roll cutaway search is scheduled
  const brollTask = plan.tasks.find((t) => t.id === "task_05c_broll_search");
  assert.ok(brollTask, "task_05c_broll_search must be present in zero-footage mode");
  console.log("  ✓ task_05c_broll_search correctly scheduled for stock video sourcing");

  // Verify timeline_assembler dependencies
  const assembleTask = plan.tasks.find((t) => t.id === "task_07_assemble_timeline");
  assert.ok(assembleTask, "task_07_assemble_timeline must be present");
  assert.ok(
    assembleTask.dependencies.includes("task_05c_broll_search"),
    "Timeline assembly must depend on B-roll search in zero footage mode"
  );
  console.log("  ✓ task_07_assemble_timeline correctly depends on B-roll sourcing");

  // -------------------------------------------------------------------------
  // 2. Execute Plan via PlanExecutor (End-to-End Test)
  // -------------------------------------------------------------------------
  console.log("\n  → Executing Zero-Footage Plan through PlanExecutor DAG...");
  const executedPlan = await PlanExecutor.executePlan(plan, {
    tempDir,
    log: (msg) => {
      if (
        msg.includes("CartesiaVoiceTool") ||
        msg.includes("BrollSearchTool") ||
        msg.includes("TimelineAssemblyTool") ||
        msg.includes("MultiTakeTranscriber") ||
        msg.includes("CriticAutoRepair")
      ) {
        console.log(`    [DAG LOG] ${msg}`);
      }
    },
  });

  assert.strictEqual(executedPlan.status, "COMPLETED", "Plan execution must succeed with status COMPLETED");
  console.log("  ✓ Full DAG executed successfully to COMPLETED status");

  // -------------------------------------------------------------------------
  // 3. Inspect Artifact Bus & Multi-Track EditIR Output
  // -------------------------------------------------------------------------
  const assemblerResult = executedPlan.tasks.find((t) => t.id === "task_07_assemble_timeline")?.resultArtifact as EditIR;
  assert.ok(assemblerResult, "Timeline assembler must produce an EditIR AST");

  // Verify target aspect ratio is 9:16 vertical
  assert.strictEqual(assemblerResult.meta.targetAspect, "9:16", "Target aspect must be 9:16");
  assert.strictEqual(assemblerResult.meta.resolution.width, 1080, "Vertical width must be 1080");
  assert.strictEqual(assemblerResult.meta.resolution.height, 1920, "Vertical height must be 1920");
  console.log("  ✓ EditIR compiled for 9:16 Vertical (1080x1920)");

  // Verify Main Video Track has visual clips
  const mainVideoTrack = assemblerResult.tracks.videoTracks[0];
  assert.ok(mainVideoTrack, "Main video track must exist");
  assert.ok(mainVideoTrack.clips.length > 0, `Main video track must contain visual clips (got ${mainVideoTrack.clips.length})`);
  console.log(`  ✓ Main video track contains ${mainVideoTrack.clips.length} visual clip(s)`);

  // Verify Audio Tracks (Primary Voice + Ducked BGM)
  const audioTracks = assemblerResult.tracks.audioTracks || [];
  const primaryVoice = audioTracks.find((t) => t.type === "PRIMARY_VOICE");
  assert.ok(primaryVoice, "Audio tracks must contain PRIMARY_VOICE from Cartesia synthesis");
  assert.ok(primaryVoice.clips.length > 0, "PRIMARY_VOICE track must contain the synthesized voiceover clip");
  console.log(`  ✓ Primary voice track populated with Cartesia synthesized audio: "${primaryVoice.clips[0].sourcePath}"`);

  // Verify BGM track is present and configured for ducking
  const bgmTrack = audioTracks.find((t) => t.type === "BGM");
  if (bgmTrack) {
    assert.strictEqual(bgmTrack.duckWithSpeech, true, "BGM track must have duckWithSpeech: true");
    console.log(`  ✓ Background music track configured with sidechain ducking (${bgmTrack.volumeDb}dB)`);
  }

  // Verify Captions Track
  const captions = assemblerResult.tracks.captionTrack || [];
  console.log(`  ✓ Caption track generated with ${captions.length} word-timed kinetic subtitle segment(s)`);

  const totalDurationSec = RationalTimeMath.toSeconds(assemblerResult.meta.totalDuration);
  assert.ok(totalDurationSec > 0, `Total duration must be greater than 0 (got ${totalDurationSec.toFixed(1)}s)`);
  console.log(`  ✓ Final broadcast duration: ${totalDurationSec.toFixed(1)}s`);

  console.log("\n==========================================================================");
  console.log("🎉 [Test 27] PASSED! Zero-footage autonomous prompt-to-video verified.");
  console.log("==========================================================================\n");
}

// Direct runner
if (require.main === module) {
  runTest()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Test 27 FAILED:", err);
      process.exit(1);
    });
}
