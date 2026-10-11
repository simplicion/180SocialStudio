import type { ClassifiedSilence } from "@workspace/video-contracts";
export interface SilenceDetectOptions {
    noiseThresholdDb?: number;
    minDurationSeconds?: number;
}
/**
 * Real ffmpeg-based silence detection + classification, generalized from
 * packages/video-engine-runtime/src/intelligence/silence.ts.
 *
 * Difference from that version: `averageDecibels` is no longer fabricated as
 * `noiseThreshold - 5` (an invented number, not a measurement). Instead it is the
 * source file's actual measured mean volume (via ffmpeg's `volumedetect` filter,
 * one pass, shared across all intervals) — a real, if track-wide rather than
 * per-interval, loudness reading.
 */
export declare class SilenceAnalyzer {
    static detect(mediaPath: string, totalDurationSeconds: number, options?: SilenceDetectOptions): Promise<ClassifiedSilence[]>;
    private static detectSilenceIntervals;
    private static measureMeanVolumeDb;
}
