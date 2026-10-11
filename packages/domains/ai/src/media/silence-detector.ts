import ffmpeg from "./ffmpeg-setup";
import * as crypto from "crypto";
import type { ClassifiedSilence, SilenceClassification } from "@workspace/video-contracts";
import { RationalTimeMath } from "@workspace/video-contracts";

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
export class SilenceAnalyzer {
  static async detect(
    mediaPath: string,
    totalDurationSeconds: number,
    options: SilenceDetectOptions = {}
  ): Promise<ClassifiedSilence[]> {
    const noiseThreshold = options.noiseThresholdDb ?? -35;
    const minDuration = options.minDurationSeconds ?? 0.3;

    const [rawIntervals, measuredMeanDb] = await Promise.all([
      this.detectSilenceIntervals(mediaPath, totalDurationSeconds, noiseThreshold, minDuration),
      this.measureMeanVolumeDb(mediaPath),
    ]);

    const classified: ClassifiedSilence[] = [];

    for (const { start, duration } of rawIntervals) {
      const end = start + duration;

      let classification: SilenceClassification;
      let recommendation: "KEEP" | "REMOVE" | "POTENTIALLY_KEEP";
      let confidence = 0.95;
      let contextReason = "";

      if (start < 0.25) {
        classification = "START_SILENCE";
        recommendation = "REMOVE";
        confidence = 0.98;
        contextReason = "Introductory dead air hurts initial retention hook.";
      } else if (end >= totalDurationSeconds - 0.5) {
        classification = "END_SILENCE";
        recommendation = "REMOVE";
        confidence = 0.98;
        contextReason = "Trailing silence after dialogue should be trimmed.";
      } else if (duration < 0.45) {
        classification = "SHORT_NATURAL_PAUSE";
        recommendation = "KEEP";
        confidence = 0.9;
        contextReason = "Natural speech breathing pause; keeping preserves natural vocal rhythm.";
      } else if (duration > 0.6) {
        classification = "DEAD_AIR";
        recommendation = "REMOVE";
        confidence = 0.95;
        contextReason = `Unnatural silence of ${duration.toFixed(2)}s causes retention drop; candidate for ripple cut.`;
      } else {
        classification = "DRAMATIC_PAUSE";
        recommendation = "POTENTIALLY_KEEP";
        confidence = 0.8;
        contextReason = "Borderline pause; keep if speech carries emotional emphasis, otherwise trim.";
      }

      classified.push({
        id: `silence_${crypto.randomUUID().slice(0, 8)}`,
        timeRange: {
          start: RationalTimeMath.fromSeconds(start),
          duration: RationalTimeMath.fromSeconds(duration),
        },
        startSeconds: start,
        durationSeconds: duration,
        averageDecibels: measuredMeanDb ?? noiseThreshold,
        classification,
        recommendation,
        confidence,
        contextReason,
      });
    }

    return classified;
  }

  private static async detectSilenceIntervals(
    mediaPath: string,
    totalDurationSeconds: number,
    noiseThreshold: number,
    minDuration: number
  ): Promise<Array<{ start: number; duration: number }>> {
    const rawIntervals: Array<{ start: number; duration: number }> = [];

    await new Promise<void>((resolve) => {
      let currentStart: number | null = null;

      ffmpeg(mediaPath)
        .audioFilters(`silencedetect=noise=${noiseThreshold}dB:d=${minDuration}`)
        .format("null")
        .output("-")
        .on("stderr", (line: string) => {
          const startMatch = line.match(/silence_start:\s*([0-9.]+)/);
          if (startMatch) {
            currentStart = parseFloat(startMatch[1]);
          }
          const endMatch = line.match(/silence_end:\s*([0-9.]+)\s*\|\s*silence_duration:\s*([0-9.]+)/);
          if (endMatch && currentStart !== null) {
            const end = parseFloat(endMatch[1]);
            const duration = parseFloat(endMatch[2]);
            rawIntervals.push({ start: currentStart, duration });
            currentStart = null;
          }
        })
        .on("end", () => {
          if (currentStart !== null && totalDurationSeconds > currentStart) {
            const trailingDuration = totalDurationSeconds - currentStart;
            if (trailingDuration >= minDuration) {
              rawIntervals.push({ start: currentStart, duration: trailingDuration });
            }
          }
          resolve();
        })
        .on("error", () => resolve()) // e.g. media has no audio track — no silence data is safer than throwing
        .run();
    });

    return rawIntervals;
  }

  private static async measureMeanVolumeDb(mediaPath: string): Promise<number | null> {
    return new Promise<number | null>((resolve) => {
      let meanDb: number | null = null;
      ffmpeg(mediaPath)
        .audioFilters("volumedetect")
        .format("null")
        .output("-")
        .on("stderr", (line: string) => {
          const match = line.match(/mean_volume:\s*(-?[0-9.]+)\s*dB/);
          if (match) meanDb = parseFloat(match[1]);
        })
        .on("end", () => resolve(meanDb))
        .on("error", () => resolve(null))
        .run();
    });
  }
}
