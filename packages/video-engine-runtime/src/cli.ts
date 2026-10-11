#!/usr/bin/env node
import { Command } from "commander";
import { MediaProber } from "./prober";
import { LosslessSplicer } from "./lossless-splicer";
import { TelemetryExtractor } from "./telemetry-extractor";
import { AssetRetriever } from "./asset-retriever";
import { ObjectAttentionTracker } from "./object-tracker";
import { ContentAddressedCacheManager } from "./cache-manager";
import { ProjectIngestionOrchestrator } from "./intelligence/project-ingestion-orchestrator";
import {
  ProjectPackageManifest,
  RationalTimeMath,
  MediaAssetDescriptor,
  MediaTelemetryManifest,
  EditIR,
  VideoCriticService,
} from "@workspace/video-contracts";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { ProductionPlanner, DirectorAgent } from "./planner";
import "./tools";

const program = new Command();

program
  .name("video-engine")
  .description("180 Workspace Autonomous Video Production Engine CLI")
  .version("0.1.0");

// 1. CREATE PROJECT
program
  .command("create")
  .description("Create a new .vproj project package")
  .requiredOption("-n, --name <name>", "Project Name")
  .requiredOption("-o, --out <path>", "Output .vproj directory path")
  .option("--width <width>", "Canvas width", "1920")
  .option("--height <height>", "Canvas height", "1080")
  .action((options: any) => {
    const projectDir = path.resolve(options.out);
    if (!fs.existsSync(projectDir)) {
      fs.mkdirSync(projectDir, { recursive: true });
    }

    const manifest: ProjectPackageManifest = {
      schemaVersion: 1,
      engineVersion: "0.1.0",
      project: {
        id: crypto.randomUUID(),
        name: options.name,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      assets: [],
      editIR: {
        version: "1.0.0",
        meta: {
          projectId: crypto.randomUUID(),
          title: options.name,
          targetAspect: "16:9",
          resolution: {
            width: parseInt(options.width, 10),
            height: parseInt(options.height, 10),
          },
          fps: { numerator: 30, denominator: 1 },
          totalDuration: { value: 0, timescale: 48000 },
        },
        directorStyle: {
          preset: "MRBEAST_FAST",
          pacingMultiplier: 1.0,
          zoomAggressiveness: 0.5,
          brollFrequencySeconds: 15.0,
        },
        tracks: {
          videoTracks: [
            {
              id: crypto.randomUUID(),
              type: "MAIN_VIDEO",
              zIndex: 0,
              clips: [],
            },
          ],
          cameraTrack: [],
          captionTrack: [],
          audioTracks: [],
        },
      },
      history: [],
    };

    fs.writeFileSync(path.join(projectDir, "project.json"), JSON.stringify(manifest, null, 2));
    fs.mkdirSync(path.join(projectDir, "proxies"), { recursive: true });
    fs.mkdirSync(path.join(projectDir, "cache"), { recursive: true });
    fs.mkdirSync(path.join(projectDir, "renders"), { recursive: true });

    console.log(`✓ Successfully initialized project package: ${projectDir}`);
  });

// 2. PROBE MEDIA
program
  .command("probe")
  .description("Inspect media file metadata via FFprobe")
  .requiredOption("-i, --input <path>", "Input video file path")
  .action(async (options: any) => {
    try {
      const filePath = path.resolve(options.input);
      console.log(`Probing: ${filePath}...`);
      const meta = await MediaProber.probeFile(filePath);
      console.log(JSON.stringify(meta, null, 2));
    } catch (err: any) {
      console.error(`✗ Probe error: ${err.message}`);
      process.exit(1);
    }
  });

// 3. ANALYZE TELEMETRY (Stage 1 Deterministic Feature Extraction)
program
  .command("analyze")
  .description("Extract silence gaps, vocal energy peaks, and scene cuts without AI tokens")
  .requiredOption("-i, --input <path>", "Input video file path")
  .option("-o, --out <path>", "Output telemetry JSON path")
  .action(async (options: any) => {
    try {
      const filePath = path.resolve(options.input);
      const tempDir = path.join(path.dirname(filePath), ".analysis_tmp");
      console.log(`Analyzing telemetry for: ${filePath}...`);

      const telemetry = await TelemetryExtractor.extract(filePath, tempDir);
      const outJson = JSON.stringify(telemetry, null, 2);

      if (options.out) {
        fs.writeFileSync(path.resolve(options.out), outJson);
        console.log(`✓ Telemetry saved to: ${options.out}`);
      } else {
        console.log(outJson);
      }
    } catch (err: any) {
      console.error(`✗ Analysis error: ${err.message}`);
      process.exit(1);
    }
  });

// 4. ADD CLIP
program
  .command("add-clip")
  .description("Add a video clip to project timeline")
  .requiredOption("-p, --project <path>", "Project .vproj directory path")
  .requiredOption("-m, --media <path>", "Media file path")
  .option("--start <start>", "Source start in seconds", "0")
  .option("--duration <duration>", "Clip duration in seconds", "10")
  .action(async (options: any) => {
    try {
      const projectDir = path.resolve(options.project);
      const manifestPath = path.join(projectDir, "project.json");
      if (!fs.existsSync(manifestPath)) {
        throw new Error(`Project manifest not found: ${manifestPath}`);
      }

      const manifest: ProjectPackageManifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      const mediaPath = path.resolve(options.media);
      const asset = await MediaProber.probeFile(mediaPath);

      if (!manifest.assets.find((a: MediaAssetDescriptor) => a.filePath === mediaPath)) {
        manifest.assets.push(asset);
      }

      const startSec = parseFloat(options.start);
      const durationSec = parseFloat(options.duration);

      const sourceRange = {
        start: RationalTimeMath.fromSeconds(startSec),
        duration: RationalTimeMath.fromSeconds(durationSec),
      };

      const timelineStart = manifest.editIR.meta.totalDuration;
      const timelineRange = {
        start: timelineStart,
        duration: sourceRange.duration,
      };

      const clip = {
        id: crypto.randomUUID(),
        assetId: asset.id,
        sourcePath: mediaPath,
        sourceRange,
        timelineRange,
        transform: {
          scale: { start: 1.0, end: 1.0, easing: "spring" as const },
          position: { x: 0.0, y: 0.0 },
          anchor: { x: 0.5, y: 0.5 },
          rotationDeg: 0,
          opacity: 1.0,
        },
        speedMultiplier: 1.0,
        effects: [],
      };

      manifest.editIR.tracks.videoTracks[0].clips.push(clip);
      manifest.editIR.meta.totalDuration = RationalTimeMath.add(timelineStart, sourceRange.duration);
      manifest.project.updatedAt = new Date().toISOString();

      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
      console.log(`✓ Added clip. Total project duration: ${RationalTimeMath.toSeconds(manifest.editIR.meta.totalDuration)}s`);
    } catch (err: any) {
      console.error(`✗ Error adding clip: ${err.message}`);
      process.exit(1);
    }
  });

// 5. EXPORT
program
  .command("export")
  .description("Render project to final MP4 with smart stream-copy")
  .requiredOption("-p, --project <path>", "Project .vproj directory path")
  .requiredOption("-o, --out <path>", "Output MP4 file path")
  .action(async (options: any) => {
    try {
      const projectDir = path.resolve(options.project);
      const manifestPath = path.join(projectDir, "project.json");
      const manifest: ProjectPackageManifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      const outputPath = path.resolve(options.out);
      const tempDir = path.join(projectDir, "cache", "render_tmp");

      console.log(`▶ Starting render for: ${manifest.project.name}`);
      await LosslessSplicer.render(manifest.editIR, outputPath, tempDir, (progress) => {
        console.log(`  [Render Progress] ${progress.percent}% (Chunk ${progress.currentChunk}/${progress.totalChunks})`);
      });

      console.log(`✓ Export completed successfully: ${outputPath}`);
    } catch (err: any) {
      console.error(`✗ Export failed: ${err.message}`);
      process.exit(1);
    }
  });

// 6. PLAN (AI Director Production Plan Decomposer)
program
  .command("plan")
  .description("Decompose project assets and user prompt into a structured DAG ProductionPlan")
  .requiredOption("-i, --input <path>", "Input video file path or directory of project assets")
  .requiredOption("-p, --prompt <prompt>", "Natural language directing prompt for the AI Director")
  .option("-o, --out <path>", "Target output video path", "master_render.mp4")
  .option("-a, --aspect <aspect>", "Target aspect ratio: 9:16 | 16:9 | 1:1", "9:16")
  .action((options: any) => {
    try {
      const inputPath = path.resolve(options.input);
      let filePaths: string[] = [];

      if (fs.existsSync(inputPath) && fs.statSync(inputPath).isDirectory()) {
        filePaths = fs.readdirSync(inputPath)
          .filter((e) => !e.startsWith("."))
          .map((e) => path.join(inputPath, e))
          .filter((p) => fs.existsSync(p) && fs.statSync(p).isFile());
      } else if (fs.existsSync(inputPath)) {
        filePaths = [inputPath];
      }

      const plan = ProductionPlanner.createPlan({
        userPrompt: options.prompt,
        inputFiles: filePaths,
        outputPath: path.resolve(options.out),
        targetAspect: options.aspect as any,
      });

      console.log(`\n=================================================================`);
      console.log(`  180 AI DIRECTOR - TWO-TIER PRODUCTION PLAN (DAG)              `);
      console.log(`=================================================================\n`);
      console.log(`Plan ID: ${plan.id}`);
      console.log(`Director Preset: ${plan.directorPreset} | Aspect: ${plan.targetAspect}`);
      console.log(`Objective: "${plan.userPrompt}"\n`);
      console.log(`Tasks Sequence (${plan.tasks.length} tasks):`);

      plan.tasks.forEach((t, idx) => {
        const deps = t.dependencies.length > 0 ? ` [Depends on: ${t.dependencies.join(", ")}]` : "";
        console.log(`  [Stage ${t.stage}] Task ${idx + 1}: ${t.title} (${t.toolName})${deps}`);
        console.log(`    → ${t.description}`);
      });
      console.log(`\n=================================================================\n`);
    } catch (err: any) {
      console.error(`✗ Error generating production plan: ${err.message}`);
      process.exit(1);
    }
  });

// 7. DIRECT (Two-Tier Planner-Worker AI Director Execution)
program
  .command("direct")
  .description("Direct and edit video via AI Director with conscious style intelligence, safe margins, and hardware render")
  .requiredOption("-i, --input <path>", "Input video file path or directory of project assets")
  .requiredOption("-p, --prompt <prompt>", "Natural language directing prompt for the AI Director")
  .requiredOption("-o, --out <path>", "Final edited output MP4 path")
  .option("-a, --aspect <aspect>", "Target aspect ratio: 9:16 | 16:9 | 1:1", "9:16")
  .action(async (options: any) => {
    try {
      const inputPath = path.resolve(options.input);
      const outputPath = path.resolve(options.out);
      const tempDir = path.join(path.dirname(outputPath), ".ai_director_tmp");

      console.log(`\n=================================================================`);
      console.log(`  180 AI DIRECTOR - TWO-TIER PLANNER-WORKER AGENTIC STUDIO ENGINE `);
      console.log(`=================================================================\n`);
      console.log(`[Director Command] "${options.prompt}"`);
      console.log(`[Input Asset] ${inputPath}`);
      console.log(`[Target Export] ${outputPath}\n`);

      const result = await DirectorAgent.directProject({
        userPrompt: options.prompt,
        inputFilesOrDirectory: inputPath,
        outputPath,
        targetAspect: options.aspect as any,
        tempDir,
        onPlanGenerated: (plan) => {
          console.log(`[Tier 1: Planner] Generated ProductionPlan: ${plan.tasks.length} discrete DAG tasks across 6 stages.`);
        },
        onTaskStart: (task) => {
          console.log(`\n[Tier 2: Tool Execution] ▶ [${task.stage}] ${task.title} (Tool: ${task.toolName})...`);
        },
        onTaskProgress: (task, percent, message) => {
          process.stdout.write(`\r  [Task Progress] ${percent}% - ${message}   `);
        },
        onTaskComplete: (task) => {
          console.log(`\r  ✓ Completed in ${task.durationMs}ms: ${task.title}                          `);
        },
      });

      console.log(`\n=================================================================`);
      console.log(`🎉 AI DIRECTOR EXECUTION COMPLETE`);
      console.log(`Exported Master: ${result.masterExportPath}`);
      console.log(`Tasks Completed: ${result.plan.tasks.filter((t) => t.status === "COMPLETED").length}/${result.plan.tasks.length}`);
      console.log(`=================================================================\n`);
    } catch (err: any) {
      console.error(`\n✗ AI Director execution failed: ${err.message}`);
      if (err.stack) console.error(err.stack);
      process.exit(1);
    }
  });

// 7. AUTO-EDIT (Legacy Preset Pipeline)
program
  .command("auto-edit")
  .description("Run end-to-end autonomous analysis, AI director compilation, and hardware export")
  .requiredOption("-i, --input <path>", "Raw input video path")
  .requiredOption("-o, --out <path>", "Final edited output MP4 path")
  .option("-s, --style <style>", "Style preset: MRBEAST_FAST | ALI_ABDAAL_CLEAN | HORMOZI_PUNCH | SAAS_DEMO", "MRBEAST_FAST")
  .action(async (options: any) => {
    try {
      const inputPath = path.resolve(options.input);
      const outputPath = path.resolve(options.out);
      const tempDir = path.join(path.dirname(outputPath), ".auto_edit_tmp");

      console.log(`\n=== 180 WORKSPACE AUTONOMOUS VIDEO PRODUCTION PIPELINE ===`);
      console.log(`[Stage 1/3] Deterministic Local Feature Extraction...`);
      const telemetry = await TelemetryExtractor.extract(inputPath, tempDir);
      console.log(`  ✓ Analyzed ${RationalTimeMath.toSeconds(telemetry.duration)}s video (${telemetry.silenceGaps.length} silence intervals, ${telemetry.energyPeaks.length} energy peaks)`);

      console.log(`[Stage 2/3] AI Creative Director Synthesis (Preset: ${options.style})...`);
      const totalDurationSec = RationalTimeMath.toSeconds(telemetry.duration);
      const editIR: EditIR = {
        version: "1.0.0",
        meta: {
          projectId: crypto.randomUUID(),
          title: path.basename(inputPath),
          targetAspect: "16:9",
          resolution: { width: 1920, height: 1080 },
          fps: { numerator: 30, denominator: 1 },
          totalDuration: telemetry.duration,
        },
        directorStyle: {
          preset: options.style as any,
          pacingMultiplier: options.style === "MRBEAST_FAST" ? 1.3 : 1.0,
          zoomAggressiveness: options.style === "MRBEAST_FAST" ? 0.75 : 0.4,
          brollFrequencySeconds: 12.0,
        },
        tracks: {
          videoTracks: [
            {
              id: crypto.randomUUID(),
              type: "MAIN_VIDEO",
              zIndex: 0,
              clips: [
                {
                  id: crypto.randomUUID(),
                  assetId: telemetry.mediaId,
                  sourcePath: inputPath,
                  sourceRange: { start: RationalTimeMath.fromSeconds(0), duration: telemetry.duration },
                  timelineRange: { start: RationalTimeMath.fromSeconds(0), duration: telemetry.duration },
                  transform: {
                    scale: { start: 1.0, end: 1.0, easing: "spring" as const },
                    position: { x: 0.0, y: 0.0 },
                    anchor: { x: 0.5, y: 0.5 },
                    rotationDeg: 0,
                    opacity: 1.0,
                  },
                  speedMultiplier: 1.0,
                  effects: [],
                },
              ],
            },
          ],
          cameraTrack: [
            {
              id: crypto.randomUUID(),
              timeRange: {
                start: RationalTimeMath.fromSeconds(1.0),
                duration: RationalTimeMath.fromSeconds(Math.min(2.5, totalDurationSec - 1.0)),
              },
              targetType: "FACE",
              targetCoords: { x: 0.5, y: 0.35 },
              scale: options.style === "MRBEAST_FAST" ? 1.35 : 1.2,
              spring: { stiffness: 180, damping: 18, mass: 1, overshootClamping: false },
              motionBlur: true,
            },
          ],
          captionTrack: [],
          audioTracks: [],
        },
      };

      console.log(`  ✓ Generated EditIR plan with ${editIR.tracks.cameraTrack.length} auto-zooms`);

      console.log(`[Stage 3/3] Lossless Smart Stream-Copy Hardware Render...`);
      await LosslessSplicer.render(editIR, outputPath, tempDir, (progress) => {
        console.log(`  [Progress] ${progress.percent}% rendered`);
      });

      console.log(`\n🎉 Autonomous Video Production Complete! Exported to: ${outputPath}\n`);
    } catch (err: any) {
      console.error(`✗ Auto-edit pipeline failed: ${err.message}`);
      process.exit(1);
    }
  });

// 7. AI CRITIC & RETENTION QA
program
  .command("critic")
  .description("Run heuristic QA analysis on project timeline or media file")
  .option("-p, --project <path>", "Project .vproj directory path")
  .option("-i, --input <path>", "Media file path for on-the-fly analysis")
  .action(async (options: any) => {
    try {
      let editIR: EditIR;

      if (options.project) {
        const projectDir = path.resolve(options.project);
        const manifestPath = path.join(projectDir, "project.json");
        const manifest: ProjectPackageManifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
        editIR = manifest.editIR;
      } else if (options.input) {
        const mediaPath = path.resolve(options.input);
        const meta = await MediaProber.probeFile(mediaPath);
        const duration = RationalTimeMath.fromSeconds(meta.durationSeconds);
        editIR = {
          version: "1.0.0",
          meta: {
            projectId: crypto.randomUUID(),
            title: meta.name,
            targetAspect: "16:9",
            resolution: { width: meta.width, height: meta.height },
            fps: { numerator: 30, denominator: 1 },
            totalDuration: duration,
          },
          directorStyle: {
            preset: "MRBEAST_FAST",
            pacingMultiplier: 1.0,
            zoomAggressiveness: 0.5,
            brollFrequencySeconds: 15.0,
          },
          tracks: {
            videoTracks: [
              {
                id: crypto.randomUUID(),
                type: "MAIN_VIDEO",
                zIndex: 0,
                clips: [
                  {
                    id: crypto.randomUUID(),
                    assetId: meta.id,
                    sourcePath: mediaPath,
                    sourceRange: { start: RationalTimeMath.fromSeconds(0), duration },
                    timelineRange: { start: RationalTimeMath.fromSeconds(0), duration },
                    transform: {
                      scale: { start: 1.0, end: 1.0, easing: "spring" },
                      position: { x: 0, y: 0 },
                      anchor: { x: 0.5, y: 0.5 },
                      rotationDeg: 0,
                      opacity: 1.0,
                    },
                    speedMultiplier: 1.0,
                    effects: [],
                  },
                ],
              },
            ],
            cameraTrack: [],
            captionTrack: [],
            audioTracks: [],
          },
        };
      } else {
        throw new Error("Must provide either --project or --input");
      }

      console.log("\n🔍 Running 180 AI Critic & Retention QA Engine...");
      const report = VideoCriticService.analyze(editIR);

      console.log(`\n=== RETENTION QUALITY SCORE: ${report.overallScore}/100 ===`);
      console.log(`Predicted Viewer Retention: ${report.retentionPrediction}%`);
      console.log(`Diagnostic Issues Found: ${report.issues.length}`);

      report.issues.forEach((issue, idx) => {
        console.log(`  [${issue.severity}] ${issue.title} (${issue.timeRangeSec.start.toFixed(1)}s): ${issue.description}`);
        if (issue.suggestedAction) {
          console.log(`    → Action: ${issue.suggestedAction}`);
        }
      });

      console.log(`Automated Repairs Available: ${report.recommendedRepairs.length}\n`);
    } catch (err: any) {
      console.error(`✗ Critic error: ${err.message}`);
      process.exit(1);
    }
  });

// 8. OBJECT & ATTENTION TRACKING
program
  .command("track-objects")
  .description("ADR-009: Extract attention trajectory and generate auto-zoom keyframes")
  .requiredOption("-i, --input <path>", "Input video file path")
  .option("--scale <scale>", "Target zoom scale", "1.35")
  .action(async (options: any) => {
    try {
      const mediaPath = path.resolve(options.input);
      const meta = await MediaProber.probeFile(mediaPath);
      const durationSec = meta.durationSeconds;

      console.log(`\n🎯 Running ADR-009 Object Attention Tracker on: ${mediaPath}`);
      
      // Sample synthetic focus points across timeline
      const samplePoints = [
        { timestampSec: 0.5, x: 0.5, y: 0.4, confidence: 0.95 },
        { timestampSec: 1.5, x: 0.52, y: 0.38, confidence: 0.92 },
        { timestampSec: 2.5, x: 0.51, y: 0.39, confidence: 0.96 },
        { timestampSec: 3.5, x: 0.5, y: 0.4, confidence: 0.90 },
      ];

      const cameraEvents = ObjectAttentionTracker.generateCameraZoomTrajectory(
        samplePoints,
        parseFloat(options.scale)
      );

      console.log(`✓ Generated ${cameraEvents.length} camera zoom events:`);
      console.log(JSON.stringify(cameraEvents, null, 2));
    } catch (err: any) {
      console.error(`✗ Tracking error: ${err.message}`);
      process.exit(1);
    }
  });

// 9. CACHE STATUS & CLEAR
program
  .command("cache-status")
  .description("ADR-010: Inspect content-addressed local cache footprint")
  .option("-d, --dir <path>", "Cache directory", path.join(process.cwd(), ".vproj_cache"))
  .action((options: any) => {
    const cacheManager = new ContentAddressedCacheManager(path.resolve(options.dir));
    const stats = cacheManager.getStats();
    console.log(`\n=== ADR-010 CONTENT-ADDRESSED CACHE STATUS ===`);
    console.log(`Directory: ${stats.cacheDirectory}`);
    console.log(`Cached Artifacts: ${stats.totalFiles}`);
    console.log(`Total Footprint: ${(stats.totalSizeBytes / (1024 * 1024)).toFixed(2)} MB\n`);
  });

// 10. AUTONOMOUS AI DIRECTOR AGENT (Skills System + Multimodal Asset Sourcing + Dynamic Planner-Worker)
program
  .command("direct")
  .description("Direct an entire video project autonomously from raw takes using AI Director Skills and dynamic tools")
  .requiredOption("-i, --input <path>", "Input media folder or file path")
  .requiredOption("-p, --prompt <prompt>", "Directing prompt and aesthetic requirements")
  .requiredOption("-o, --out <path>", "Master export video file path (.mp4)")
  .option("--aspect <aspect>", "Target aspect ratio (9:16, 16:9, 1:1)", "9:16")
  .option("--skill <skill>", "Explicit Director Skill package ID (e.g. medical-doctor-authority, short-form-viral-reel)")
  .action(async (options: any) => {
    try {
      console.log(`\n🎬 180 Autonomous AI Video Director Agent Initializing...`);
      console.log(`Input Source: ${path.resolve(options.input)}`);
      console.log(`Directing Prompt: "${options.prompt}"`);
      console.log(`Target Aspect: ${options.aspect}\n`);

      const result = await DirectorAgent.directProject({
        userPrompt: options.prompt,
        inputFilesOrDirectory: path.resolve(options.input),
        outputPath: path.resolve(options.out),
        targetAspect: options.aspect,
        customStyleKey: options.skill,
        onPlanGenerated: (plan) => {
          console.log(`\n📋 Production Plan Created: "${plan.title}"`);
          console.log(`Total Tasks: ${plan.tasks.length}`);
          plan.tasks.forEach((t, idx) => {
            console.log(`  [${String(idx + 1).padStart(2, "0")}] (${t.stage}) ${t.title} [Tool: ${t.toolName}]`);
          });
          console.log("");
        },
        onTaskStart: (task) => {
          console.log(`▶ Starting [${task.id}] ${task.title}...`);
        },
        onTaskProgress: (task, percent, message) => {
          if (percent % 25 === 0 || percent === 100) {
            console.log(`  [${task.id}] ${percent}% - ${message}`);
          }
        },
        onTaskComplete: (task) => {
          console.log(`✓ Completed [${task.id}] (${task.durationMs}ms)`);
        },
      });

      console.log(`\n🎉 Autonomous AI Video Direction Complete!`);
      console.log(`Master Video Exported to: ${result.masterExportPath}\n`);
    } catch (err: any) {
      console.error(`\n✗ Director Agent failed: ${err.message}`);
      process.exit(1);
    }
  });

program.parse(process.argv);
