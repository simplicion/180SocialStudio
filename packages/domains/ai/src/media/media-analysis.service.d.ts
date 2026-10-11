import { MediaIntelligenceGraph, TechnicalMetadata } from "@workspace/video-contracts";
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
export declare class MediaAnalysisService {
    private static cache;
    static getOrBuildGraph(params: MediaAnalysisParams): Promise<MediaIntelligenceGraph>;
    private static buildGraph;
    /** For tests / explicit invalidation — analysis inputs rarely change for a given asset. */
    static clearCache(assetId?: string): void;
}
