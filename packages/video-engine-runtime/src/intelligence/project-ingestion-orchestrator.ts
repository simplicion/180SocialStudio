import * as path from "path";
import * as fs from "fs";
import crypto from "crypto";
import {
  EditIR,
  RationalTimeMath,
  DirectorStyleResolver,
  ResolvedDirectorStyle,
  VideoClip,
  CameraEvent,
  CaptionSegment,
  TranscriptWord,
} from "@workspace/video-contracts";
import { MediaProber } from "../prober";
import { TelemetryExtractor } from "../telemetry-extractor";
import { AssetClassifier, ProjectClassificationReport } from "./asset-classifier";
import { SemanticAssetMatcher, SemanticMatchResult } from "./semantic-asset-matcher";
import { MultiTakeTranscriber, ClipTranscriptionResult } from "./multi-take-transcriber";
import { SemanticTakeCurator, CuratedTakeManifest } from "./semantic-take-curator";

export interface ProjectIngestionOptions {
  userPrompt?: string;
  targetAspect?: "16:9" | "9:16" | "1:1";
  customStyleKey?: string;
  outputDir?: string;
}

export interface ProjectAssemblyManifest {
  editIR: EditIR;
  classificationReport: ProjectClassificationReport;
  matchResult: SemanticMatchResult;
  resolvedStyle: ResolvedDirectorStyle;
  primaryARollPath: string;
  totalDurationSec: number;
  executionPlanSummary: string;
  curatedManifest?: CuratedTakeManifest;
}

export class ProjectIngestionOrchestrator {
  /**
   * Universal batch ingestion: Ingests 15–20+ arbitrary project files (or folder path),
   * validates and classifies assets, extracts A-roll speech telemetry, matches supportive media,
   * resolves director style, and compiles an automated multi-track EditIR AST.
   */
  static async ingestAndAssemble(
    inputFilesOrDirectory: string | string[],
    options: ProjectIngestionOptions = {}
  ): Promise<ProjectAssemblyManifest> {
    let filePaths: string[] = [];

    if (typeof inputFilesOrDirectory === "string") {
      if (fs.existsSync(inputFilesOrDirectory) && fs.statSync(inputFilesOrDirectory).isDirectory()) {
        const entries = fs.readdirSync(inputFilesOrDirectory);
        filePaths = entries
          .filter((e) => !e.startsWith("."))
          .map((e) => path.join(inputFilesOrDirectory, e))
          .filter((p) => {
            try {
              return fs.existsSync(p) && fs.statSync(p).isFile();
            } catch {
              return false;
            }
          });
      } else if (fs.existsSync(inputFilesOrDirectory)) {
        filePaths = [inputFilesOrDirectory];
      }
    } else if (Array.isArray(inputFilesOrDirectory)) {
      filePaths = inputFilesOrDirectory.filter((f) => {
        try {
          return fs.existsSync(f) && fs.statSync(f).isFile();
        } catch {
          return false;
        }
      });
    }

    if (filePaths.length === 0) {
      throw new Error("ProjectIngestionOrchestrator: No valid input files found to ingest.");
    }

    // 1. Asset Classification (Identifies A-Roll, B-Roll, BGM, SFX, Brand Badges)
    const isExportOrTestFile = (filename: string) => {
      const base = path.basename(filename).toLowerCase();
      return (
        base.startsWith("master_") ||
        base.startsWith("test_") ||
        base.startsWith("hevc_") ||
        base.startsWith("ffmpeg_") ||
        base.startsWith("render_") ||
        base.startsWith("export_") ||
        base.startsWith("final_") ||
        base.endsWith("_out.mp4") ||
        base.endsWith("_output.mp4")
      );
    };

    const rawSourceFiles = filePaths.filter((f) => !isExportOrTestFile(f));
    const effectiveFiles = rawSourceFiles.length > 0 ? rawSourceFiles : filePaths;

    const classificationReport = await AssetClassifier.classifyProjectFiles(effectiveFiles);
    
    // Filter video files
    const videoFiles = effectiveFiles.filter((f) => /\.(mp4|mov|mkv|webm|avi)$/i.test(f));
    const primaryAsset = classificationReport.primaryARoll?.asset || (videoFiles.length > 0 ? await MediaProber.probeFile(videoFiles[0]) : null);

    if (!primaryAsset) {
      throw new Error("ProjectIngestionOrchestrator: Failed to identify Primary A-Roll video stream in project assets.");
    }

    const primaryFilePath = primaryAsset.filePath;
    const tempDir = options.outputDir || path.join(path.dirname(primaryFilePath), ".vproj_temp");
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // 2. Resolve Conscious Director Style
    const prompt = options.userPrompt || "Create professional high-retention video";
    const resolvedStyle = DirectorStyleResolver.resolve(prompt);
    if (options.targetAspect) {
      resolvedStyle.targetAspect = options.targetAspect;
    }

    const isVertical = resolvedStyle.targetAspect === "9:16";
    const resolution = isVertical ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };
    const projectId = crypto.randomUUID();

    let mainVideoClips: VideoClip[] = [];
    let cameraTrack: CameraEvent[] = [];
    let captionTrack: CaptionSegment[] = [];
    let totalDurationSec = 0;
    let curatedManifest: CuratedTakeManifest | undefined;
    let allTranscriptWords: TranscriptWord[] = [];

    // 3. Multi-Take vs Single-File Routing
    if (videoFiles.length > 1) {
      console.log(`[ProjectIngestionOrchestrator] Multi-take shoot detected (${videoFiles.length} video files). Transcribing all takes...`);
      const transcriptions = await MultiTakeTranscriber.transcribeAllClips(videoFiles, tempDir);
      
      console.log(`[ProjectIngestionOrchestrator] Curating narrative story arc and pruning bloopers/retakes...`);
      curatedManifest = SemanticTakeCurator.curateStoryArc(transcriptions);

      let timelineSec = 0;
      const allTimelineWords: Array<{ word: TranscriptWord; timelineStart: number; timelineEnd: number }> = [];

      for (let i = 0; i < curatedManifest.keeperSegments.length; i++) {
        const seg = curatedManifest.keeperSegments[i];
        const clipStartSec = timelineSec;
        const clipDurSec = seg.durationSec;

        mainVideoClips.push({
          id: crypto.randomUUID(),
          assetId: seg.id,
          sourcePath: seg.clipPath,
          sourceRange: {
            start: RationalTimeMath.fromSeconds(seg.sourceStartSec),
            duration: RationalTimeMath.fromSeconds(clipDurSec),
          },
          timelineRange: {
            start: RationalTimeMath.fromSeconds(clipStartSec),
            duration: RationalTimeMath.fromSeconds(clipDurSec),
          },
          transform: {
            scale: { start: 1.0, end: 1.0, easing: "spring" },
            position: { x: 0.0, y: 0.0 },
            anchor: { x: 0.5, y: 0.5 },
            rotationDeg: 0,
            opacity: 1.0,
          },
          speedMultiplier: 1.0,
          effects: [],
        });

        // Map word timestamps to timeline space
        for (const w of seg.words) {
          const wordRelStart = Math.max(0, w.startSeconds - seg.sourceStartSec);
          const wordRelEnd = Math.max(wordRelStart + 0.15, w.endSeconds - seg.sourceStartSec);
          allTimelineWords.push({
            word: w,
            timelineStart: clipStartSec + wordRelStart,
            timelineEnd: clipStartSec + wordRelEnd,
          });
          allTranscriptWords.push(w);
        }

        // Camera spring zoom punch in keeper segment
        if (clipDurSec >= 4.0) {
          const zoomStart = clipStartSec + Math.min(1.5, clipDurSec * 0.25);
          const zoomDur = Math.min(2.5, clipDurSec - 1.5);
          cameraTrack.push({
            id: crypto.randomUUID(),
            timeRange: {
              start: RationalTimeMath.fromSeconds(zoomStart),
              duration: RationalTimeMath.fromSeconds(zoomDur),
            },
            targetType: "FACE",
            targetCoords: { x: 0.5, y: 0.38 },
            scale: resolvedStyle.zoomScale,
            spring: { stiffness: 180, damping: 18, mass: 1, overshootClamping: false },
            motionBlur: true,
          });
        }

        timelineSec += clipDurSec;
      }

      totalDurationSec = timelineSec;

      // Build kinetic captions
      if (allTimelineWords.length > 0) {
        for (let i = 0; i < allTimelineWords.length; i += 3) {
          const chunk = allTimelineWords.slice(i, i + 3);
          const startSec = chunk[0].timelineStart;
          const endSec = chunk[chunk.length - 1].timelineEnd;
          const text = chunk.map((c) => c.word.word).join(" ");

          captionTrack.push({
            id: crypto.randomUUID(),
            timeRange: {
              start: RationalTimeMath.fromSeconds(startSec),
              duration: RationalTimeMath.fromSeconds(Math.max(0.6, endSec - startSec)),
            },
            text,
            words: chunk.map((c) => ({
              word: c.word.word,
              start: RationalTimeMath.fromSeconds(c.timelineStart),
              end: RationalTimeMath.fromSeconds(c.timelineEnd),
              highlight: c.word.isEmphasis || false,
              color: c.word.isEmphasis ? resolvedStyle.captionColors.highlight : resolvedStyle.captionColors.primary,
              scaleMultiplier: c.word.isEmphasis ? 1.2 : 1.0,
            })),
            style: {
              preset: resolvedStyle.captionPreset === "HORMOZI_BOUNCE" ? "HORMOZI_BOUNCE" : "ALI_ABDAAL_CLEAN",
              fontFamily: "Inter",
              fontSize: isVertical ? 52 : 44,
              textColor: resolvedStyle.captionColors.primary,
              highlightColor: resolvedStyle.captionColors.highlight,
              position: { x: 0.5, y: isVertical ? 0.76 : 0.85 }, // 24% safe margin
              shadow: true,
            },
          });
        }
      }
    } else {
      // Single A-Roll Video Pipeline
      const telemetry = await TelemetryExtractor.extract(primaryFilePath, tempDir);
      totalDurationSec = RationalTimeMath.toSeconds(telemetry.duration);
      allTranscriptWords = telemetry.transcript || [];

      mainVideoClips.push({
        id: crypto.randomUUID(),
        assetId: primaryAsset.id,
        sourcePath: primaryFilePath,
        sourceRange: {
          start: RationalTimeMath.fromSeconds(0),
          duration: telemetry.duration,
        },
        timelineRange: {
          start: RationalTimeMath.fromSeconds(0),
          duration: telemetry.duration,
        },
        transform: {
          scale: { start: 1.0, end: 1.0, easing: "spring" },
          position: { x: 0.0, y: 0.0 },
          anchor: { x: 0.5, y: 0.5 },
          rotationDeg: 0,
          opacity: 1.0,
        },
        speedMultiplier: 1.0,
        effects: [],
      });

      const zoomInterval = resolvedStyle.zoomFrequencySeconds;
      for (let t = 1.5; t < totalDurationSec - 1.0; t += zoomInterval) {
        cameraTrack.push({
          id: crypto.randomUUID(),
          timeRange: {
            start: RationalTimeMath.fromSeconds(t),
            duration: RationalTimeMath.fromSeconds(Math.min(2.5, totalDurationSec - t)),
          },
          targetType: "FACE",
          targetCoords: { x: 0.5, y: 0.38 },
          scale: resolvedStyle.zoomScale,
          spring: { stiffness: 180, damping: 18, mass: 1, overshootClamping: false },
          motionBlur: true,
        });
      }

      if (telemetry.transcript && telemetry.transcript.length > 0) {
        const words = telemetry.transcript;
        for (let i = 0; i < words.length; i += 3) {
          const chunk = words.slice(i, i + 3);
          const startSec = chunk[0].startSeconds;
          const endSec = chunk[chunk.length - 1].endSeconds;
          const text = chunk.map((w) => w.word).join(" ");

          captionTrack.push({
            id: crypto.randomUUID(),
            timeRange: {
              start: RationalTimeMath.fromSeconds(startSec),
              duration: RationalTimeMath.fromSeconds(Math.max(0.6, endSec - startSec)),
            },
            text,
            words: chunk.map((w) => ({
              word: w.word,
              start: RationalTimeMath.fromSeconds(w.startSeconds),
              end: RationalTimeMath.fromSeconds(w.endSeconds),
              highlight: w.isEmphasis || false,
              color: w.isEmphasis ? resolvedStyle.captionColors.highlight : resolvedStyle.captionColors.primary,
              scaleMultiplier: w.isEmphasis ? 1.2 : 1.0,
            })),
            style: {
              preset: resolvedStyle.captionPreset === "HORMOZI_BOUNCE" ? "HORMOZI_BOUNCE" : "ALI_ABDAAL_CLEAN",
              fontFamily: "Inter",
              fontSize: isVertical ? 52 : 44,
              textColor: resolvedStyle.captionColors.primary,
              highlightColor: resolvedStyle.captionColors.highlight,
              position: { x: 0.5, y: isVertical ? 0.76 : 0.85 },
              shadow: true,
            },
          });
        }
      }
    }

    // 4. Match Supportive Assets (Overlays, Badges, BGM)
    const matchResult = SemanticAssetMatcher.matchAssetsToTranscript(
      allTranscriptWords.map((w) => ({
        word: w.word,
        startSeconds: w.startSeconds,
        endSeconds: w.endSeconds,
        confidence: w.confidence || 0.95,
        isEmphasis: w.isEmphasis || false,
      })),
      classificationReport,
      resolvedStyle,
      totalDurationSec
    );

    // 5. Audio Tracks
    const audioTracks: any[] = [];
    if (classificationReport.bgmTracks.length > 0) {
      const bgm = classificationReport.bgmTracks[0];
      audioTracks.push({
        id: crypto.randomUUID(),
        type: "BGM",
        volumeDb: -14.0,
        duckWithSpeech: true,
        duckingConfig: {
          duckDb: resolvedStyle.duckingDb,
          attackMs: 120,
          releaseMs: 350,
        },
        clips: [
          {
            id: crypto.randomUUID(),
            assetId: bgm.asset.id,
            sourcePath: bgm.asset.filePath,
            timelineStart: 0,
            duration: totalDurationSec,
          },
        ],
      });
    }

    // 6. Compile EditIR AST
    const editIR: EditIR = {
      version: "1.0.0",
      meta: {
        projectId,
        title: primaryAsset.name,
        targetAspect: resolvedStyle.targetAspect,
        resolution,
        fps: { numerator: 30, denominator: 1 },
        totalDuration: RationalTimeMath.fromSeconds(totalDurationSec),
      },
      directorStyle: {
        preset: resolvedStyle.presetKey as any,
        pacingMultiplier: resolvedStyle.pacingMultiplier,
        zoomAggressiveness: resolvedStyle.zoomScale > 1.25 ? 0.8 : 0.4,
        brollFrequencySeconds: resolvedStyle.brollFrequencySeconds,
      },
      tracks: {
        videoTracks: [
          {
            id: crypto.randomUUID(),
            type: "MAIN_VIDEO",
            zIndex: 0,
            clips: mainVideoClips,
          },
        ],
        cameraTrack,
        captionTrack,
        audioTracks,
      },
    };

    const executionPlanSummary = curatedManifest
      ? curatedManifest.summary
      : `Ingestion & assembly complete for ${filePaths.length} project assets. Resolved A-Roll (${primaryAsset.name}, ${totalDurationSec.toFixed(1)}s), ${cameraTrack.length} dynamic spring camera events, ${captionTrack.length} kinetic caption blocks in safe zone (y=${isVertical ? "76%" : "85%"}), and ${audioTracks.length} ducked audio tracks.`;

    return {
      editIR,
      classificationReport,
      matchResult,
      resolvedStyle,
      primaryARollPath: primaryFilePath,
      totalDurationSec,
      executionPlanSummary,
      curatedManifest,
    };
  }
}
