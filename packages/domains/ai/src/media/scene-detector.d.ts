import type { ShotSegment, SceneSegment } from "@workspace/video-contracts";
/**
 * Real ffmpeg-based scene-cut detection, generalized from
 * packages/video-engine-runtime/src/intelligence/scenes.ts.
 *
 * Unlike that version, this does NOT fabricate shotType/brightness/dominantSubjects/
 * motionScore/transitionScore from duration heuristics — those fields are left unset
 * so MediaIntelligenceGraphSchema's honest defaults (e.g. shotType: "UNKNOWN") apply
 * instead of a confident-looking but invented classification.
 */
export declare class SceneDetector {
    static detect(mediaPath: string, totalDurationSeconds: number): Promise<{
        shots: ShotSegment[];
        scenes: SceneSegment[];
    }>;
}
