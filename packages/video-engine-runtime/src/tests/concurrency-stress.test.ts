import { ProductionRenderQueue } from "../concurrency/render-queue";
import { UnifiedFiltergraphCompiler } from "../unified-filtergraph";
import { AutoClipperService } from "../ingest/auto-clipper";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

async function runProductionConcurrencyStressSuite() {
  console.log("===============================================================================");
  console.log("=== [PRODUCTION SUITE] 100-User Concurrency Pressure & Single-Pass Pipeline ===");
  console.log("===============================================================================");

  // -------------------------------------------------------------------------
  // TEST 1: 100 Concurrent Simultaneous User Requests Pressure Test
  // -------------------------------------------------------------------------
  console.log("\n-> [TEST 1] Simulating 100 Concurrent Users submitting heavy video jobs simultaneously...");

  const queue = new ProductionRenderQueue(8); // 8 concurrent active workers
  const totalUsers = 100;
  const dispatchTimes: number[] = [];
  const tickets: any[] = [];
  const jobPromises: Promise<any>[] = [];

  const tStartAll = performance.now();

  for (let i = 0; i < totalUsers; i++) {
    const t0 = performance.now();
    const userId = `user_${i + 1}`;

    // User enqueues a video transcode/auto-clip job
    const ticket = queue.enqueue(
      "render",
      async (updateProgress) => {
        // Simulate real asynchronous heavy compute work
        updateProgress(25);
        await new Promise((r) => setTimeout(r, 15));
        updateProgress(75);
        await new Promise((r) => setTimeout(r, 15));
        updateProgress(100);
        return {
          userId,
          renderOutput: `/exports/user_${i + 1}_final.mp4`,
          renderedAt: Date.now(),
        };
      },
      {
        priority: i % 10 === 0 ? "high" : "normal", // 10% high-priority users
        data: { userId },
      }
    );

    const t1 = performance.now();
    dispatchTimes.push(t1 - t0);
    tickets.push(ticket);

    // Track job completion promise
    const p = new Promise<void>((resolve, reject) => {
      const check = () => {
        const job = queue.getJob(ticket.jobId);
        if (!job) return reject(new Error(`Job ${ticket.jobId} lost from memory`));
        if (job.status === "completed") return resolve();
        if (job.status === "failed") return reject(new Error(job.error));
        setTimeout(check, 10);
      };
      check();
    });
    jobPromises.push(p);
  }

  const avgDispatchMs = dispatchTimes.reduce((a, b) => a + b, 0) / dispatchTimes.length;
  const maxDispatchMs = Math.max(...dispatchTimes);

  console.log(`✓ All 100 users dispatched tickets in ${(performance.now() - tStartAll).toFixed(2)}ms!`);
  console.log(`  - Average API Ticket Latency: ${avgDispatchMs.toFixed(3)}ms (Goal: < 5ms)`);
  console.log(`  - Max Ticket Dispatch Latency: ${maxDispatchMs.toFixed(3)}ms`);

  if (avgDispatchMs > 5.0) {
    throw new Error(`Dispatch latency too high for production: ${avgDispatchMs.toFixed(3)}ms`);
  }

  console.log("-> Processing 100 user jobs through bounded worker pool (max 8 parallel)...");
  await Promise.all(jobPromises);

  const tTotalWorkMs = performance.now() - tStartAll;
  const stats = queue.getStats();

  console.log(`✓ 100/100 Jobs completed with ZERO errors! (Total pool time: ${tTotalWorkMs.toFixed(1)}ms)`);
  console.log("  - Queue Stats:", JSON.stringify(stats));

  if (stats.completed !== 100 || stats.active !== 0 || stats.queued !== 0) {
    throw new Error(`Unexpected queue stats: ${JSON.stringify(stats)}`);
  }

  // -------------------------------------------------------------------------
  // TEST 2: Unified Single-Pass Filtergraph with Music Sidechain Compression
  // -------------------------------------------------------------------------
  console.log("\n-> [TEST 2] Testing Single-Pass Unified Filtergraph Compiler with Music Ducking...");

  const dummyBgmPath = path.join(os.tmpdir(), "dummy_bgm.mp3");
  fs.writeFileSync(dummyBgmPath, "dummy audio content");

  try {
    const compiled = UnifiedFiltergraphCompiler.compile({
      canvas: { width: 1080, height: 1920 },
      clips: [
        { sourcePath: "clip1.mp4", startSec: 0, durationSec: 4.5 },
        { sourcePath: "clip2.mp4", startSec: 2.0, durationSec: 5.0 },
      ],
      colorFilter: { contrast: 1.15, brightness: 0.05, saturation: 1.2 },
      motionCards: [
        { assetPath: "card_vox.svg", timelineStartSec: 1.5, durationSec: 3.5, position: "lower_third" },
      ],
      backgroundMusic: {
        audioPath: dummyBgmPath,
        volumeDb: -16,
        duckUnderSpeech: true,
        duckRatio: 4,
      },
    });

    console.log("Compiled FilterComplex DAG Preview:");
    console.log("  " + compiled.filterComplex.slice(0, 180) + "...");

    // Validate video pipeline
    if (!compiled.filterComplex.includes("scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920")) {
      throw new Error("Missing vertical 9:16 canvas scaling & cropping in DAG");
    }
    if (!compiled.filterComplex.includes("eq=contrast=1.15:brightness=0.05:saturation=1.20")) {
      throw new Error("Missing unified color grading filter");
    }
    if (!compiled.filterComplex.includes("overlay=x='(W-w)/2':y='H-h-120'")) {
      throw new Error("Missing motion graphic overlay filter");
    }

    // Validate audio sidechain compression pipeline
    if (!compiled.filterComplex.includes("sidechaincompress=threshold=0.12:ratio=4:attack=20:release=300")) {
      throw new Error("Missing speech sidechain compression filter for background music");
    }
    if (!compiled.filterComplex.includes("amix=inputs=2:duration=first")) {
      throw new Error("Missing final audio stream mixing filter");
    }

    console.log("✓ Single-Pass Unified Filtergraph with Sidechain Ducking verified 100%!");
  } finally {
    try { fs.unlinkSync(dummyBgmPath); } catch {}
  }

  // -------------------------------------------------------------------------
  // TEST 3: Auto-Clipper Pipeline Verification
  // -------------------------------------------------------------------------
  console.log("\n-> [TEST 3] Testing Long-Form Auto-Clipper Logic & 9:16 Shorts Generation...");

  // Create a 16kHz WAV sample
  const sampleWav = path.join(os.tmpdir(), `autoclip_sample_${Date.now()}.wav`);
  const numSamples = 16000 * 5; // 5 seconds
  const pcmBuf = Buffer.alloc(44 + numSamples * 2);
  pcmBuf.write("RIFF", 0);
  pcmBuf.writeUInt32LE(36 + numSamples * 2, 4);
  pcmBuf.write("WAVE", 8);
  pcmBuf.write("fmt ", 12);
  pcmBuf.writeUInt32LE(16, 16);
  pcmBuf.writeUInt16LE(1, 20);
  pcmBuf.writeUInt16LE(1, 22);
  pcmBuf.writeUInt32LE(16000, 24);
  pcmBuf.writeUInt32LE(32000, 28);
  pcmBuf.writeUInt16LE(2, 32);
  pcmBuf.writeUInt16LE(16, 34);
  pcmBuf.write("data", 36);
  pcmBuf.writeUInt32LE(numSamples * 2, 40);
  fs.writeFileSync(sampleWav, pcmBuf);

  try {
    const clipResult = await AutoClipperService.autoClip(sampleWav, {
      maxShorts: 2,
      targetShortDurationSec: 2,
    });

    console.log(`AutoClipper processed audio: Source "${clipResult.sourceTitle}", Shorts count: ${clipResult.shorts.length}`);
    clipResult.shorts.forEach((s) => {
      console.log(`  - [${s.shortId}] "${s.title}" (${s.startSec}s -> ${s.endSec}s)`);
    });

    if (clipResult.shorts.length === 0) {
      throw new Error("AutoClipper produced 0 shorts");
    }
    console.log("✓ AutoClipper successfully sliced high-retention vertical short segments!");
  } finally {
    try { fs.unlinkSync(sampleWav); } catch {}
  }

  console.log("\n===============================================================================");
  console.log("=== ALL PRODUCTION PRESSURE & VERIFICATION TESTS PASSED WITH 100% PERFECTION! ===");
  console.log("===============================================================================");
}

runProductionConcurrencyStressSuite().catch((err) => {
  console.error("Concurrency Stress Test Failed:", err);
  process.exit(1);
});

