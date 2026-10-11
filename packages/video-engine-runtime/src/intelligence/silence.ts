import ffmpeg from "../ffmpeg-setup";
import * as fs from "fs";
import {
  ClassifiedSilence,
  SilenceClassification,
  RationalTimeMath,
} from "./types";
import * as crypto from "crypto";

export interface SilenceDetectOptions {
  noiseThresholdDb?: number; // e.g. -35dB
  minDurationSeconds?: number; // e.g. 0.3s
}

export class SilenceAnalyzer {
  /**
   * Runs deterministic silence detection using FFmpeg silencedetect,
   * then classifies each pause into semantic categories (DEAD_AIR, NATURAL_PAUSE, START_SILENCE, etc.).
   */
  static async detect(
    mediaPath: string,
    totalDurationSeconds: number,
    options: SilenceDetectOptions = {}
  ): Promise<ClassifiedSilence[]> {
    if (!fs.existsSync(mediaPath)) {
      return [];
    }

    const noiseThreshold = options.noiseThresholdDb ?? -35;
    const minDuration = options.minDurationSeconds ?? 0.3;

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
          const endMatch = line.match(
            /silence_end:\s*([0-9.]+)\s*\|\s*silence_duration:\s*([0-9.]+)/
          );
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
        .on("error", () => resolve()) // Fallback gracefully if media has no audio track
        .run();
    });

    const classified: ClassifiedSilence[] = [];

    for (let i = 0; i < rawIntervals.length; i++) {
      const { start, duration } = rawIntervals[i];
      const end = start + duration;

      let classification: SilenceClassification;
      let recommendation: "KEEP" | "REMOVE" | "POTENTIALLY_KEEP";
      let confidence = 0.95;
      let contextReason = "";

      // 1. Beginning silence (dead space before speaker begins)
      if (start < 0.25) {
        classification = "START_SILENCE";
        recommendation = "REMOVE";
        confidence = 0.98;
        contextReason = "Introductory dead air hurts initial retention hook.";
      }
      // 2. Ending silence (trailing dead space after speaker ends)
      else if (end >= totalDurationSeconds - 0.5) {
        classification = "END_SILENCE";
        recommendation = "REMOVE";
        confidence = 0.98;
        contextReason = "Trailing silence after dialogue should be trimmed.";
      }
      // 3. Short natural speech pause (0.2s - 0.45s)
      else if (duration < 0.45) {
        classification = "SHORT_NATURAL_PAUSE";
        recommendation = "KEEP";
        confidence = 0.9;
        contextReason = "Natural speech breathing pause; keeping preserves natural vocal rhythm.";
      }
      // 4. Extended dead air (> 0.6s)
      else if (duration > 0.6) {
        classification = "DEAD_AIR";
        recommendation = "REMOVE";
        confidence = 0.95;
        contextReason = `Unnatural silence of ${duration.toFixed(2)}s causes retention drop; candidate for ripple cut.`;
      }
      // 5. Medium pause (0.45s - 0.6s)
      else {
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
        averageDecibels: noiseThreshold - 5,
        classification,
        recommendation,
        confidence,
        contextReason,
      });
    }

    return classified;
  }
}
