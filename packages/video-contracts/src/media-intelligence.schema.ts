import { z } from "zod";
import { RationalTimeSchema, TimeRangeSchema, FrameRateSchema } from "./time";

/**
 * Technical Media Metadata (Probed safely via memory-safe chunked stream)
 */
export const TechnicalMetadataSchema = z.object({
  durationSeconds: z.number().nonnegative(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().positive(),
  timeBase: z.string().optional(),
  codecVideo: z.string().optional(),
  codecAudio: z.string().optional(),
  pixelFormat: z.string().optional(),
  colorSpace: z.string().optional(),
  hasAudio: z.boolean(),
  audioChannels: z.number().int().nonnegative().optional(),
  sampleRate: z.number().int().positive().optional(),
  bitrateBps: z.number().nonnegative().optional(),
  isVariableFrameRate: z.boolean().default(false),
  container: z.string().optional(),
  fileSizeBytes: z.number().nonnegative(),
  sha256Hash: z.string(),
});

export type TechnicalMetadata = z.infer<typeof TechnicalMetadataSchema>;

/**
 * Word-level transcript entity with exact timestamps and analytical metadata
 */
export const TranscriptWordIntelligenceSchema = z.object({
  id: z.string(),
  word: z.string(),
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().nonnegative(),
  confidence: z.number().min(0).max(1),
  speakerId: z.string().optional(),
  isEmphasis: z.boolean().default(false),
  emphasisScore: z.number().min(0).max(1).default(0),
  pitchHint: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
  energyScore: z.number().min(0).max(1).default(0),
});

export type TranscriptWordIntelligence = z.infer<typeof TranscriptWordIntelligenceSchema>;

/**
 * Sentence-level transcript segment
 */
export const SentenceSegmentSchema = z.object({
  id: z.string(),
  text: z.string(),
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().nonnegative(),
  speakerId: z.string().optional(),
  words: z.array(TranscriptWordIntelligenceSchema),
  isQuestion: z.boolean().default(false),
  isClaim: z.boolean().default(false),
  isCallToAction: z.boolean().default(false),
  informationDensity: z.number().min(0).max(1).default(0.5),
});

export type SentenceSegment = z.infer<typeof SentenceSegmentSchema>;

/**
 * Speaker turn segmentation
 */
export const SpeakerSegmentSchema = z.object({
  speakerId: z.string(),
  speakerName: z.string().optional(),
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().nonnegative(),
  dominantRole: z.enum(["HOST", "GUEST", "CO_HOST", "AUDIENCE"]).default("HOST"),
});

export type SpeakerSegment = z.infer<typeof SpeakerSegmentSchema>;

/**
 * Deterministic Silence Classification
 */
export const SilenceClassificationEnum = z.enum([
  "SHORT_NATURAL_PAUSE",
  "DEAD_AIR",
  "DRAMATIC_PAUSE",
  "SENTENCE_BOUNDARY",
  "START_SILENCE",
  "END_SILENCE",
]);

export type SilenceClassification = z.infer<typeof SilenceClassificationEnum>;

export const ClassifiedSilenceSchema = z.object({
  id: z.string(),
  timeRange: TimeRangeSchema,
  startSeconds: z.number().nonnegative(),
  durationSeconds: z.number().positive(),
  averageDecibels: z.number(),
  classification: SilenceClassificationEnum,
  recommendation: z.enum(["KEEP", "REMOVE", "POTENTIALLY_KEEP"]),
  confidence: z.number().min(0).max(1),
  contextReason: z.string(),
});

export type ClassifiedSilence = z.infer<typeof ClassifiedSilenceSchema>;

/**
 * Filler-Word Analysis
 */
export const FillerCandidateSchema = z.object({
  id: z.string(),
  word: z.string(),
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().nonnegative(),
  candidateAction: z.enum([
    "REMOVE_FILLER",
    "REMOVE_FALSE_START",
    "KEEP_FILLER_FOR_NATURALNESS",
  ]),
  confidence: z.number().min(0).max(1),
  surroundingContext: z.string(),
});

export type FillerCandidate = z.infer<typeof FillerCandidateSchema>;

/**
 * Semantic & Textual Repetition Detection
 */
export const RepetitionCandidateSchema = z.object({
  id: z.string(),
  firstSegment: z.object({
    startSeconds: z.number().nonnegative(),
    endSeconds: z.number().nonnegative(),
    text: z.string(),
  }),
  secondSegment: z.object({
    startSeconds: z.number().nonnegative(),
    endSeconds: z.number().nonnegative(),
    text: z.string(),
  }),
  similarity: z.number().min(0).max(1),
  reason: z.string(),
  recommendedRetain: z.enum(["FIRST", "SECOND", "BOTH"]),
  confidence: z.number().min(0).max(1),
});

export type RepetitionCandidate = z.infer<typeof RepetitionCandidateSchema>;

/**
 * Visual Scene & Shot Detection
 */
export const ShotSegmentSchema = z.object({
  id: z.string(),
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().nonnegative(),
  shotType: z.enum(["CLOSE_UP", "MEDIUM_SHOT", "WIDE_SHOT", "EXTREME_CLOSE_UP", "UNKNOWN"]).default("UNKNOWN"),
  visualActivity: z.number().min(0).max(1).default(0.5),
  cameraMovement: z.enum(["STATIC", "PAN", "ZOOM", "TILT", "HANDHELD", "DYNAMIC"]).default("STATIC"),
  dominantSubjects: z.array(z.string()).default([]),
  brightness: z.number().min(0).max(1).default(0.5),
  motionScore: z.number().min(0).max(1).default(0.5),
  transitionScore: z.number().min(0).max(1).default(1.0),
  semanticSummary: z.string().optional(),
});

export type ShotSegment = z.infer<typeof ShotSegmentSchema>;

export const SceneSegmentSchema = z.object({
  id: z.string(),
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().nonnegative(),
  shots: z.array(ShotSegmentSchema),
  topic: z.string().optional(),
  visualSummary: z.string().optional(),
});

export type SceneSegment = z.infer<typeof SceneSegmentSchema>;

/**
 * Face & Person Tracking Data (Time-indexed for smart reframing & zoom)
 */
export const FaceTrackPointSchema = z.object({
  timeSeconds: z.number().nonnegative(),
  subjectId: z.string(),
  x: z.number().min(0).max(1), // Normalized center X
  y: z.number().min(0).max(1), // Normalized center Y
  width: z.number().min(0).max(1), // Normalized width
  height: z.number().min(0).max(1), // Normalized height
  confidence: z.number().min(0).max(1),
  isPrimarySpeaker: z.boolean().default(true),
});

export type FaceTrackPoint = z.infer<typeof FaceTrackPointSchema>;

export const FaceTrackSchema = z.object({
  subjectId: z.string(),
  label: z.string().default("speaker_1"),
  isPrimarySpeaker: z.boolean().default(true),
  averageCoords: z.object({ x: z.number(), y: z.number() }),
  samples: z.array(FaceTrackPointSchema),
});

export type FaceTrack = z.infer<typeof FaceTrackSchema>;

/**
 * Object Detection
 */
export const DetectedObjectSchema = z.object({
  timeSeconds: z.number().nonnegative(),
  label: z.enum(["phone", "laptop", "product", "car", "person", "screen", "document", "logo", "microphone", "other"]),
  customLabel: z.string().optional(),
  boundingBox: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  }),
  confidence: z.number().min(0).max(1),
});

export type DetectedObject = z.infer<typeof DetectedObjectSchema>;

/**
 * Motion & Visual Activity
 */
export const VisualActivitySegmentSchema = z.object({
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().nonnegative(),
  visualActivity: z.number().min(0).max(1), // 0.0 - 1.0 (static vs high movement)
  cameraMotion: z.number().min(0).max(1),
  subjectMotion: z.number().min(0).max(1),
  isStaticTalkingHead: z.boolean().default(false),
});

export type VisualActivitySegment = z.infer<typeof VisualActivitySegmentSchema>;

/**
 * Audio Intelligence Profile
 */
export const AudioAnalysisProfileSchema = z.object({
  overallRmsEnergy: z.number().min(0).max(1),
  peakDecibels: z.number(),
  hasSpeech: z.boolean(),
  hasMusic: z.boolean(),
  speechRatio: z.number().min(0).max(1),
  averageLoudnessLufs: z.number().optional(),
  clippingDetected: z.boolean().default(false),
});

export type AudioAnalysisProfile = z.infer<typeof AudioAnalysisProfileSchema>;

/**
 * Music Beat Analysis
 */
export const MusicBeatTrackSchema = z.object({
  hasMusic: z.boolean(),
  bpm: z.number().positive().optional(),
  confidence: z.number().min(0).max(1).default(0),
  beatTimestamps: z.array(z.number().nonnegative()).default([]),
  downbeatTimestamps: z.array(z.number().nonnegative()).default([]),
  energyCurve: z.array(z.object({ timeSeconds: z.number(), energy: z.number().min(0).max(1) })).default([]),
});

export type MusicBeatTrack = z.infer<typeof MusicBeatTrackSchema>;

/**
 * Candidate Highlight Scoring
 */
export const HighlightSegmentSchema = z.object({
  id: z.string(),
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().nonnegative(),
  durationSeconds: z.number().positive(),
  hookScore: z.number().min(0).max(1),
  informationScore: z.number().min(0).max(1),
  emotionScore: z.number().min(0).max(1),
  visualInterestScore: z.number().min(0).max(1),
  speechEnergy: z.number().min(0).max(1),
  audioEnergy: z.number().min(0).max(1),
  noveltyScore: z.number().min(0).max(1),
  repetitionScore: z.number().min(0).max(1),
  deadAirScore: z.number().min(0).max(1),
  brollPotential: z.number().min(0).max(1),
  retentionCandidateScore: z.number().min(0).max(1),
  summary: z.string(),
});

export type HighlightSegment = z.infer<typeof HighlightSegmentSchema>;

/**
 * Candidate Hook Detection
 */
export const HookCandidateSchema = z.object({
  id: z.string(),
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().nonnegative(),
  transcriptSnippet: z.string(),
  hookType: z.enum(["QUESTION", "STRONG_CLAIM", "HIGH_ENERGY", "CURIOSITY_GAP", "OPENING_STATEMENT", "AUDIENCE_ADDRESS"]),
  hookScore: z.number().min(0).max(1),
  rationale: z.string(),
  suggestedAction: z.enum(["USE_AS_START", "RETAIN_IN_PLACE", "TRIM_LEADING_PREAMBLE"]).default("USE_AS_START"),
});

export type HookCandidate = z.infer<typeof HookCandidateSchema>;

/**
 * B-Roll Semantic Asset Index Entry
 */
export const BrollCandidateSchema = z.object({
  assetId: z.string(),
  assetName: z.string(),
  filePath: z.string(),
  durationSeconds: z.number().nonnegative(),
  startSeconds: z.number().nonnegative().default(0),
  endSeconds: z.number().nonnegative(),
  visualSummary: z.string(),
  detectedObjects: z.array(z.string()).default([]),
  topics: z.array(z.string()).default([]),
  semanticTags: z.array(z.string()).default([]),
  suitabilityScore: z.number().min(0).max(1).default(0.8),
});

export type BrollCandidate = z.infer<typeof BrollCandidateSchema>;

/**
 * Master Canonical Media Intelligence Graph
 */
export const MediaIntelligenceGraphSchema = z.object({
  assetId: z.string(),
  technicalMetadata: TechnicalMetadataSchema,
  scenes: z.array(SceneSegmentSchema).default([]),
  shots: z.array(ShotSegmentSchema).default([]),
  transcript: z.array(TranscriptWordIntelligenceSchema).default([]),
  words: z.array(TranscriptWordIntelligenceSchema).default([]),
  sentences: z.array(SentenceSegmentSchema).default([]),
  speakers: z.array(SpeakerSegmentSchema).default([]),
  silences: z.array(ClassifiedSilenceSchema).default([]),
  fillers: z.array(FillerCandidateSchema).default([]),
  repetitions: z.array(RepetitionCandidateSchema).default([]),
  faces: z.array(FaceTrackSchema).default([]),
  people: z.array(FaceTrackSchema).default([]),
  objects: z.array(DetectedObjectSchema).default([]),
  motion: z.array(VisualActivitySegmentSchema).default([]),
  visualActivity: z.number().min(0).max(1).default(0.5),
  audioAnalysis: AudioAnalysisProfileSchema.default({
    overallRmsEnergy: 0.5,
    peakDecibels: -6.0,
    hasSpeech: true,
    hasMusic: false,
    speechRatio: 0.8,
    clippingDetected: false,
  }),
  music: MusicBeatTrackSchema.default({
    hasMusic: false,
    confidence: 0,
    beatTimestamps: [],
    downbeatTimestamps: [],
    energyCurve: [],
  }),
  beats: MusicBeatTrackSchema.default({
    hasMusic: false,
    confidence: 0,
    beatTimestamps: [],
    downbeatTimestamps: [],
    energyCurve: [],
  }),
  topics: z.array(z.string()).default([]),
  highlights: z.array(HighlightSegmentSchema).default([]),
  candidateHooks: z.array(HookCandidateSchema).default([]),
  candidateBroll: z.array(BrollCandidateSchema).default([]),
  analysisVersion: z.string().default("2.0.0"),
  generatedAt: z.string(),
});

export type MediaIntelligenceGraph = z.infer<typeof MediaIntelligenceGraphSchema>;
