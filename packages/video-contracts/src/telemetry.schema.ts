import { z } from "zod";
import { RationalTimeSchema, TimeRangeSchema } from "./time";

/**
 * Speech Recognition Token with Confidence & Timing
 */
export const TranscriptWordSchema = z.object({
  word: z.string(),
  startSeconds: z.number(),
  endSeconds: z.number(),
  confidence: z.number().min(0).max(1),
  isEmphasis: z.boolean().optional().default(false),
});

export type TranscriptWord = z.infer<typeof TranscriptWordSchema>;

/**
 * Silence & Dead-Air Detection Interval
 */
export const SilenceIntervalSchema = z.object({
  timeRange: TimeRangeSchema,
  averageDecibels: z.number(),
  isEligibleForTrim: z.boolean().default(true),
});

export type SilenceInterval = z.infer<typeof SilenceIntervalSchema>;

/**
 * Vocal Pitch & RMS Energy Peak
 */
export const VocalEnergyPeakSchema = z.object({
  timestamp: RationalTimeSchema,
  rmsEnergy: z.number(),
  pitchHz: z.number().optional(),
  importanceScore: z.number().min(0).max(1),
});

export type VocalEnergyPeak = z.infer<typeof VocalEnergyPeakSchema>;

/**
 * Visual Object / Face / Cursor Tracking Point
 */
export const TrackedObjectPointSchema = z.object({
  timestamp: RationalTimeSchema,
  objectType: z.enum(["FACE", "PERSON", "CURSOR", "PRODUCT", "SCREEN_ROI", "TEXT_REGION"]),
  boundingBox: z.object({
    x: z.number(), // 0.0 to 1.0 normalized
    y: z.number(),
    width: z.number(),
    height: z.number(),
  }),
  confidence: z.number().min(0).max(1),
});

export type TrackedObjectPoint = z.infer<typeof TrackedObjectPointSchema>;

/**
 * Scene Cut / Shot Boundary Event
 */
export const SceneCutEventSchema = z.object({
  timestamp: RationalTimeSchema,
  frameIndex: z.number().int(),
  transitionScore: z.number(),
});

export type SceneCutEvent = z.infer<typeof SceneCutEventSchema>;

/**
 * Unified Deterministic Telemetry Manifest (Passed to AI Director)
 */
export const MediaTelemetryManifestSchema = z.object({
  mediaId: z.string(),
  sourcePath: z.string(),
  duration: RationalTimeSchema,
  totalFrames: z.number().int(),
  transcript: z.array(TranscriptWordSchema),
  silenceGaps: z.array(SilenceIntervalSchema),
  energyPeaks: z.array(VocalEnergyPeakSchema),
  sceneCuts: z.array(SceneCutEventSchema),
  trackedObjects: z.array(TrackedObjectPointSchema),
});

export type MediaTelemetryManifest = z.infer<typeof MediaTelemetryManifestSchema>;
