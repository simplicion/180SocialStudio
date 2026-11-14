/**
 * Style playbooks (AI Director quality-fix plan, Phase 6): editing craft as versioned data with numeric targets.
 * The Director gets only the chosen playbook; the critic measures the finished edit against it.
 */

export type PlaybookId = "fast_hype" | "calm_educational" | "cinematic_vlog" | "podcast_clip";

/** [min, max] (inclusive). */
export type Range = [number, number];

export interface PlaybookTargets {
  /** Longest stretch (s) with no visual change (cut, zoom, B-roll / layer, title). */
  maxStaticSec: number;
  cutsPerMin: Range;
  zoomsPerMin: Range;
  zoomScale: Range;
  /** The caption template to use, and the others that fit the style. */
  captionTemplate: string;
  captionTemplatesOk: string[];
  brollPerMin: Range;
  /** Most of the runtime B-roll / layers may cover (0..1). */
  brollMaxShare: number;
  /** Music bed level (dB) when there is music; ducked under speech. */
  musicDb: Range;
  sfxPerMin: Range;
  /** removeSilences.minDurationSec for this style. */
  pauseCutSec: number;
}

export interface StylePlaybook {
  id: PlaybookId;
  /** Bump when targets change, so eval results stay comparable. */
  version: string;
  label: string;
  /** Creator words that pick this style. */
  matches: RegExp;
  targets: PlaybookTargets;
  /** Short craft rules (how the style edits; never recited to the creator). */
  craft: string[];
  /** 1-2 compact worked examples: input summary → operations. */
  examples: Array<{ input: string; ops: string }>;
}
