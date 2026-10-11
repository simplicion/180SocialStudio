import { MediaProber } from "../prober";
import { IntelligenceCacheManager } from "./cache";
import { SilenceAnalyzer } from "./silence";
import { TranscriptIntelligenceService } from "./transcript";
import { FillerAnalyzer } from "./fillers";
import { RepetitionAnalyzer } from "./repetition";
import { SceneDetector } from "./scenes";
import { MotionActivityAnalyzer } from "./motion";
import { AudioIntelligenceAnalyzer } from "./audio";
import { BeatAnalyzer } from "./beats";
import { FaceTracker } from "./faces";
import { ObjectDetector } from "./objects";
import { HighlightScorer, HookDetector } from "./highlights";
import { BrollIndexer } from "./broll";
import { MediaGraphBuilder, MediaIntelligenceGraph, MediaAssetDescriptor } from "./types";
import * as path from "path";
import * as fs from "fs";

export interface AnalysisProgressEvent {
  stage: "METADATA" | "SILENCE" | "TRANSCRIPT" | "SCENES" | "AUDIO" | "DEEP_INTELLIGENCE" | "COMPLETE";
  percent: number;
  message: string;
}

export interface AnalyzeMediaOptions {
  subtitlesText?: string;
  isMusicTrack?: boolean;
  projectAssets?: MediaAssetDescriptor[];
  onProgress?: (event: AnalysisProgressEvent) => void;
  bypassCache?: boolean;
}

export class MediaIntelligenceEngine {
  /**
   * Orchestrates the progressive analysis pipeline for raw media assets.
   * Leverages caching, memory-safe streaming probing, and deterministic feature extractors.
   */
  static async analyze(
    filePath: string,
    options: AnalyzeMediaOptions = {}
  ): Promise<MediaIntelligenceGraph> {
    const notify = (stage: AnalysisProgressEvent["stage"], percent: number, message: string) => {
      if (options.onProgress) {
        options.onProgress({ stage, percent, message });
      }
    };

    // Stage 1: Technical Media Probing (Immediate)
    notify("METADATA", 5, "Probing technical media container & streams...");
    const descriptor = await MediaProber.probeFile(filePath);

    // Cache Check
    const cacheKey = IntelligenceCacheManager.generateKey({
      assetSha256: descriptor.sha256Hash || "unknown_hash",
      analysisVersion: "2.0.0",
    });

    if (!options.bypassCache) {
      const cached = IntelligenceCacheManager.get(cacheKey);
      if (cached) {
        notify("COMPLETE", 100, "Loaded from cache.");
        return cached;
      }
    }

    const durationSec = descriptor.durationSeconds || 10.0;

    // Stage 2: Silence & Pauses (Fast)
    notify("SILENCE", 20, "Detecting vocal silences and speech pauses...");
    const silences = descriptor.hasAudio
      ? await SilenceAnalyzer.detect(filePath, durationSec)
      : [];

    // Stage 3: Transcript & Speech Intelligence (Fast)
    notify("TRANSCRIPT", 40, "Extracting word-level timing and sentence boundaries...");
    let transcriptText = options.subtitlesText || "";
    // Check if matching sidecar .srt or .vtt exists
    if (!transcriptText) {
      const srtPath = filePath.replace(/\.[^/.]+$/, ".srt");
      if (fs.existsSync(srtPath)) {
        try {
          transcriptText = fs.readFileSync(srtPath, "utf-8");
        } catch {}
      }
    }

    const { words, sentences, speakers } = TranscriptIntelligenceService.parseFromTextOrSubtitles(
      transcriptText,
      durationSec,
      silences
    );

    // Filler & Repetition Analysis
    const fillers = FillerAnalyzer.detect(words);
    const repetitions = RepetitionAnalyzer.detect(sentences);

    // Stage 4: Visual Scenes & Shots (Medium)
    notify("SCENES", 60, "Analyzing visual cut boundaries and camera transitions...");
    const { shots, scenes } = await SceneDetector.detect(filePath, durationSec);

    // Stage 5: Audio & Dynamics (Medium)
    notify("AUDIO", 75, "Analyzing RMS dynamics and frequency spectrum...");
    const audioAnalysis = descriptor.hasAudio
      ? await AudioIntelligenceAnalyzer.analyze(filePath)
      : {
          overallRmsEnergy: 0,
          peakDecibels: -60,
          hasSpeech: false,
          hasMusic: false,
          speechRatio: 0,
          clippingDetected: false,
        };

    const beats = BeatAnalyzer.analyze(durationSec, options.isMusicTrack || false);

    // Stage 6: Deep Intelligence (Motion, Faces, Highlights, Hooks, B-Roll)
    notify("DEEP_INTELLIGENCE", 90, "Evaluating subject trajectories, hooks, and retention...");
    const { overallActivity, segments: motionSegments } = MotionActivityAnalyzer.analyze(
      durationSec,
      shots
    );
    const faces = FaceTracker.trackSubject(durationSec);

    const objectDetector = new ObjectDetector();
    const objects = await objectDetector.detectObjects(filePath, durationSec);

    const highlights = HighlightScorer.scoreSegments(sentences, shots);
    const candidateHooks = HookDetector.detect(sentences);

    const brollIndexer = new BrollIndexer(options.projectAssets || [descriptor]);
    const candidateBroll = brollIndexer.getAllCandidates();

    // Stage 7: Assemble Canonical Graph & Cache
    const graph = MediaGraphBuilder.build({
      assetId: descriptor.id,
      technicalMetadata: {
        durationSeconds: descriptor.durationSeconds,
        width: descriptor.width,
        height: descriptor.height,
        fps: descriptor.fps,
        codecVideo: descriptor.codecVideo,
        codecAudio: descriptor.codecAudio,
        hasAudio: descriptor.hasAudio,
        fileSizeBytes: descriptor.fileSizeBytes || 0,
        sha256Hash: descriptor.sha256Hash || "unknown_hash",
        isVariableFrameRate: false,
      },
      scenes,
      shots,
      transcript: words,
      sentences,
      speakers,
      silences,
      fillers,
      repetitions,
      faces,
      objects,
      motion: motionSegments,
      visualActivity: overallActivity,
      audioAnalysis,
      music: beats,
      beats,
      highlights,
      candidateHooks,
      candidateBroll,
    });

    IntelligenceCacheManager.set(cacheKey, graph);
    notify("COMPLETE", 100, "Media intelligence graph compiled successfully.");

    return graph;
  }
}
