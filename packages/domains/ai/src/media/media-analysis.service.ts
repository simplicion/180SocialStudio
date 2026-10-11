import {
  MediaGraphBuilder,
  MediaIntelligenceGraph,
  TechnicalMetadata,
} from "@workspace/video-contracts";
import { SceneDetector } from "./scene-detector";
import { SilenceAnalyzer } from "./silence-detector";
import { MediaTranscriber } from "./transcriber";

export interface MediaAnalysisParams {
  assetId: string;
  sourcePath: string;
  technicalMetadata: TechnicalMetadata;
  language?: string;
  /** Skip the (paid, slower) transcription call — useful when a transcript is already known. */
  skipTranscription?: boolean;
}

/**
 * Builds a real MediaIntelligenceGraph for a source asset by actually analyzing the
 * media file (ffmpeg scene-cut + silence detection, cloud/local transcription), instead
 * of the empty/neutral defaults `MediaGraphBuilder.build()` falls back to when no real
 * data is supplied.
 *
 * Scope: this wires up the two detectors that are genuinely generic and already-real
 * (scene cuts, silence) plus transcription. Faces/objects/motion/beats/highlights have
 * no real data source anywhere in this codebase yet (see the architecture audit) and
 * are intentionally left as the schema's honest empty defaults here rather than being
 * approximated — a future phase should add real producers for those before this service
 * claims to populate them.
 *
 * Results are cached in-memory per asset for the life of the process, since scene/silence/
 * transcription analysis is expensive and a project's source video does not change between
 * prompts in the same session. This is a process-local cache, not yet persisted across
 * server restarts — see the implementation plan for a follow-up DB-backed cache.
 */
export class MediaAnalysisService {
  private static cache = new Map<string, Promise<MediaIntelligenceGraph>>();

  static getOrBuildGraph(params: MediaAnalysisParams): Promise<MediaIntelligenceGraph> {
    const cacheKey = `${params.assetId}:${params.sourcePath}:${params.technicalMetadata.durationSeconds}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const built = this.buildGraph(params).catch((err) => {
      // Don't poison the cache with a rejected analysis — allow retry on the next call.
      this.cache.delete(cacheKey);
      throw err;
    });
    this.cache.set(cacheKey, built);
    return built;
  }

  private static async buildGraph(params: MediaAnalysisParams): Promise<MediaIntelligenceGraph> {
    const { sourcePath, technicalMetadata } = params;
    const durationSeconds = technicalMetadata.durationSeconds;

    const [sceneResult, silences, transcription] = await Promise.all([
      SceneDetector.detect(sourcePath, durationSeconds).catch((err) => {
        console.warn(`[MediaAnalysisService] scene detection failed for ${sourcePath}:`, err?.message);
        return { shots: [], scenes: [] };
      }),
      SilenceAnalyzer.detect(sourcePath, durationSeconds).catch((err) => {
        console.warn(`[MediaAnalysisService] silence detection failed for ${sourcePath}:`, err?.message);
        return [];
      }),
      params.skipTranscription
        ? Promise.resolve(null)
        : MediaTranscriber.transcribe(sourcePath, { language: params.language }).catch((err) => {
            console.warn(`[MediaAnalysisService] transcription failed for ${sourcePath}:`, err?.message);
            return null;
          }),
    ]);

    return MediaGraphBuilder.build({
      assetId: params.assetId,
      technicalMetadata,
      scenes: sceneResult.scenes,
      shots: sceneResult.shots,
      silences,
      transcript: transcription && !transcription.transcriptionFailed ? transcription.words : [],
    });
  }

  /** For tests / explicit invalidation — analysis inputs rarely change for a given asset. */
  static clearCache(assetId?: string): void {
    if (!assetId) {
      this.cache.clear();
      return;
    }
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${assetId}:`)) this.cache.delete(key);
    }
  }
}
