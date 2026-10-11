import { ResolvedDirectorStyle, DirectorStyleKey } from "@workspace/video-contracts";

export type MoodTone =
  | "CLINICAL_AUTHORITY"
  | "URGENT_WARNING"
  | "EXCITED_VIRAL"
  | "PLAYFUL_COMEDIC"
  | "CALM_EDUCATIONAL"
  | "CINEMATIC_LUXURY";

export interface VisualCueRule {
  keywords: string[];
  category: "ANATOMICAL_DIAGRAM" | "WARNING_BADGE" | "EMOJI_3D" | "ICON_VECTOR" | "CALLOUT_CARD" | "METRIC_STAT";
  suggestedAssetQuery: string;
  mood: MoodTone;
  preferredPosition: "UPPER_RIGHT" | "UPPER_LEFT" | "CENTER_RIGHT" | "LOWER_THIRD";
  durationSeconds: number;
  sfxType: "POP" | "WHOOSH" | "DING" | "ALERT" | "CHIME";
}

export interface DirectorSkill {
  id: string;
  name: string;
  genre: string;
  description: string;
  defaultPresetKey: DirectorStyleKey;
  
  // Editorial Pacing & Cadence
  pacingMultiplier: number;
  deadAirTrimThresholdSeconds: number;
  zoomFrequencySeconds: number;
  zoomScale: number;
  
  // Visual & Typography
  captionPreset: "HORMOZI_BOUNCE" | "ALI_ABDAAL_CLEAN" | "NEON_PUNCH" | "EDITORIAL_SUBTLE" | "MINIMAL_SERIF";
  captionColors: {
    primary: string;
    highlight: string;
    background?: string;
  };
  safeMarginVPercent: number;
  
  // Visual Cue Rules
  visualCueRules: VisualCueRule[];
  
  // Sound Design
  soundDesignEnabled: boolean;
  duckingDb: number;
  
  // Evaluation & Scoring Heuristics
  retentionRules: {
    maxVisualStagnationSeconds: number; // Max seconds allowed without a zoom, overlay, or cut
    requireHookInFirstSeconds: number;
    targetOverlayDensityPerMinute: number;
  };
  
  matchScore(prompt: string, transcriptSummary?: string): number;
  resolveStyle(prompt: string): ResolvedDirectorStyle;
}
