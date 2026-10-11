import { z } from "zod";
import type { CreativeOperation } from "./creative-plan.schema";
import type { EditIR, VideoClip } from "./edit-ir.schema";
import { RationalTimeMath } from "./time";

/**
 * Preservation constraints and the autonomy policy for the AI Director.
 *
 * Constraints are ENFORCED, not only prompted: every operation is checked against them before it reaches the
 * EditIRCompiler, and an operation that would touch a locked range or a locked track is dropped and reported as a
 * violation. Constraints come from three places and are merged (union; nothing can loosen them):
 *   1. the request (`constraints.lockedRanges` / `constraints.lockedTracks`),
 *   2. the creator's own words, parsed deterministically ("don't change the music", "keep the first 10 seconds"),
 *   3. the model's `finish_edit.preserve` argument (it may only add locks).
 *
 * Locked ranges are integer milliseconds on the CURRENT timeline (the timeline the creator sees before this turn,
 * i.e. `currentEditIR` or the raw clip). Global styling (captions over the whole video, colour filters, aspect
 * ratio, music bed) is governed by `lockedTracks`, not by ranges.
 */

export const DIRECTOR_LOCKABLE_TRACKS = ["music", "captions", "broll", "sfx", "effects", "text"] as const;
export type DirectorLockableTrack = (typeof DIRECTOR_LOCKABLE_TRACKS)[number];

const msInt = z.number().int().nonnegative().max(4 * 60 * 60 * 1000);

export const DirectorConstraintsSchema = z.object({
  /** [startMs, endMs] ranges of the current timeline that must not be cut, sped up, reordered or covered. */
  lockedRanges: z
    .array(z.tuple([msInt, msInt]).refine(([s, e]) => e > s, { message: "endMs must be greater than startMs" }))
    .max(50)
    .optional(),
  /** Tracks the director must not change. */
  lockedTracks: z.array(z.enum(DIRECTOR_LOCKABLE_TRACKS)).max(DIRECTOR_LOCKABLE_TRACKS.length).optional(),
});
export type DirectorConstraints = z.infer<typeof DirectorConstraintsSchema>;

/** Normalised constraints: ranges sorted, merged and clamped; tracks de-duplicated. */
export interface ResolvedDirectorConstraints {
  lockedRanges: Array<[number, number]>;
  lockedTracks: DirectorLockableTrack[];
}

export const EMPTY_CONSTRAINTS: ResolvedDirectorConstraints = Object.freeze({ lockedRanges: [], lockedTracks: [] }) as ResolvedDirectorConstraints;

export function hasConstraints(c: ResolvedDirectorConstraints | null | undefined): boolean {
  return !!c && (c.lockedRanges.length > 0 || c.lockedTracks.length > 0);
}

export function mergeDirectorConstraints(durationMs: number | null, ...parts: Array<Partial<DirectorConstraints> | null | undefined>): ResolvedDirectorConstraints {
  const tracks = new Set<DirectorLockableTrack>();
  const ranges: Array<[number, number]> = [];
  for (const p of parts) {
    if (!p) continue;
    for (const t of p.lockedTracks || []) if ((DIRECTOR_LOCKABLE_TRACKS as readonly string[]).includes(t)) tracks.add(t);
    for (const r of p.lockedRanges || []) {
      if (!Array.isArray(r) || r.length !== 2) continue;
      let [s, e] = [Math.round(Number(r[0])), Math.round(Number(r[1]))];
      if (!Number.isFinite(s) || !Number.isFinite(e)) continue;
      s = Math.max(0, s);
      if (durationMs != null && durationMs > 0) e = Math.min(e, durationMs);
      if (e > s) ranges.push([s, e]);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return { lockedRanges: merged, lockedTracks: DIRECTOR_LOCKABLE_TRACKS.filter((t) => tracks.has(t)) };
}

// ─── Deterministic extraction from the creator's words ─────────────────────────────────────────────

const TRACK_NOUNS: Record<DirectorLockableTrack, string> = {
  music: "(?:background\\s+)?music|song|soundtrack|bgm|audio\\s+track|beat",
  captions: "captions?|subtitles?|subs",
  broll: "b[- ]?rolls?|broll|cutaways?|stock\\s+(?:footage|clips?)|overlays?",
  sfx: "sound\\s+effects?|sfx|whooshe?s?",
  effects: "effects?|filters?|transitions?|colou?r\\s+grade|look",
  text: "titles?|text(?:\\s+overlays?)?|lower[- ]thirds?|headlines?",
};

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  fifteen: 15, twenty: 20, thirty: 30, forty: 40, "forty-five": 45, sixty: 60, a: 1, an: 1,
};
const NUM = "(\\d+(?:\\.\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|forty-five|sixty)";
const parseNum = (s: string): number => (NUMBER_WORDS[s.toLowerCase()] ?? Number(s));
const toMs = (v: number, unit?: string) => Math.round(v * (unit && /^m(?:in)/i.test(unit) ? 60000 : 1000));
/** "1:05" or "65" or "65s" → ms. */
const clockToMs = (s: string): number => {
  const m = s.match(/^(\d{1,2}):(\d{2})(?:\.(\d+))?$/);
  if (m) return (parseInt(m[1], 10) * 60 + parseInt(m[2], 10)) * 1000 + (m[3] ? Math.round(Number(`0.${m[3]}`) * 1000) : 0);
  return Math.round(parseFloat(s) * 1000);
};

const KEEP_VERB = "(?:keep|preserve|leave|lock|protect)";
const DONT_VERB =
  "(?:don'?t|do\\s+not|never|no\\s+need\\s+to|without|avoid)\\s+(?:you\\s+)?(?:change|changing|touch|touching|alter|altering|modify|modifying|edit|editing|replace|replacing|remove|removing|mess(?:ing)?\\s+with|add|adding|cut|cutting|trim|trimming|speed(?:ing)?\\s+up)";
const EDIT_WORDS = /\b(?:quieter|louder|lower|raise|change|replace|swap|bigger|smaller|restyle|move|shorter|longer|remove|mute|different|new)\b/i;

export interface ExtractedConstraints extends ResolvedDirectorConstraints {
  /** Human notes, e.g. `locked music ("don't change the music")`. */
  notes: string[];
}

/**
 * Parses preservation requests out of the creator's prompt. Pure and deterministic; unknown phrasing yields
 * nothing (the model can still add locks through `finish_edit.preserve`). `durationMs` is the current timeline.
 */
export function extractConstraintsFromPrompt(prompt: string, durationMs: number): ExtractedConstraints {
  const text = String(prompt || "").replace(/[’‘]/g, "'").toLowerCase();
  const notes: string[] = [];
  const tracks: DirectorLockableTrack[] = [];
  const ranges: Array<[number, number]> = [];
  if (!text.trim()) return { lockedRanges: [], lockedTracks: [], notes };

  // Clauses so that "keep the music but make it quieter" does not lock music.
  const clauses = text.split(/\bbut\b|\bhowever\b|;|\.(?=\s|$)/);

  for (const track of DIRECTOR_LOCKABLE_TRACKS) {
    const n = TRACK_NOUNS[track];
    const patterns = [
      new RegExp(`\\b${KEEP_VERB}\\s+(?:the\\s+|my\\s+|our\\s+|all\\s+(?:the\\s+|my\\s+)?|existing\\s+)?(?:current\\s+|existing\\s+)?(?:${n})\\b`, "i"),
      new RegExp(`\\b${DONT_VERB}\\s+(?:any\\s+|the\\s+|my\\s+|our\\s+|more\\s+|new\\s+)?(?:${n})\\b`, "i"),
      new RegExp(`\\bno\\s+(?:more\\s+|new\\s+|extra\\s+)?(?:${n})\\b`, "i"),
      new RegExp(`\\b(?:${n})\\s+(?:stays?|as[- ]is|unchanged|untouched|alone|the\\s+same)\\b`, "i"),
      new RegExp(`\\bleave\\s+(?:the\\s+|my\\s+)?(?:${n})\\s+(?:alone|as[- ]is|untouched)\\b`, "i"),
    ];
    for (let ci = 0; ci < clauses.length; ci++) {
      // "effects" would also match "sound effects": that phrase belongs to the sfx track.
      const clause = track === "effects" ? clauses[ci].replace(/sound\s+effects?/g, "sfx") : clauses[ci];
      const hit = patterns.find((re) => re.test(clause));
      if (!hit) continue;
      // A positive "keep the music" is overridden when the creator also asks to edit it
      // ("keep the music but make it quieter", "keep the captions, make them bigger").
      if (hit === patterns[0]) {
        const nounRe = new RegExp(`\\b(?:${n})\\b`, "i");
        const next = clauses[ci + 1] || "";
        const m = clause.match(hit)!;
        const rest = clause.slice((m.index || 0) + m[0].length);
        const editedElsewhere =
          EDIT_WORDS.test(rest) ||
          clauses.some((c, j) => j !== ci && nounRe.test(c) && EDIT_WORDS.test(c)) ||
          (EDIT_WORDS.test(next) && !/\b(?:captions?|subtitles?|music|b[- ]?roll|effects?|titles?|text|sfx)\b/.test(next));
        if (editedElsewhere) continue;
      }
      if (!tracks.includes(track)) {
        tracks.push(track);
        notes.push(`locked ${track} ("${clause.trim().slice(0, 80)}")`);
      }
      break;
    }
  }

  const dur = Math.max(0, Math.round(durationMs || 0));
  const addRange = (s: number, e: number, why: string) => {
    const a = Math.max(0, Math.min(s, dur || s));
    const b = dur ? Math.min(e, dur) : e;
    if (b > a) {
      ranges.push([a, b]);
      notes.push(`locked ${(a / 1000).toFixed(1)}s–${(b / 1000).toFixed(1)}s ("${why}")`);
    }
  };
  const guard = `(?:${KEEP_VERB}|(?:don'?t|do\\s+not|never)\\s+(?:cut|trim|touch|change|edit|remove|speed\\s+up|mess\\s+with))`;

  // "keep the first 10 seconds", "don't cut the first ten seconds", "leave the first 2 minutes"
  for (const m of text.matchAll(new RegExp(`\\b${guard}\\s+(?:the\\s+)?(first|opening|last|final)\\s+${NUM}\\s*(seconds?|secs?|s|minutes?|mins?)\\b`, "gi"))) {
    const n = toMs(parseNum(m[2]), m[3]);
    if (/first|opening/.test(m[1])) addRange(0, n, m[0]);
    else if (dur) addRange(dur - n, dur, m[0]);
  }
  // "keep 5s to 12s", "don't touch 0:05-0:12", "keep from 5 to 12 seconds", "keep between 5 and 12 seconds"
  for (const m of text.matchAll(new RegExp(`\\b${guard}\\s+(?:the\\s+part\\s+|the\\s+section\\s+|everything\\s+)?(?:from\\s+|between\\s+)?(\\d{1,2}:\\d{2}(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)\\s*(?:s|sec|secs|seconds)?\\s*(?:-|–|to|and|until|till)\\s*(\\d{1,2}:\\d{2}(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)\\s*(?:s|sec|secs|seconds)?\\b`, "gi"))) {
    const a = clockToMs(m[1]);
    const b = clockToMs(m[2]);
    if (b > a) addRange(a, b, m[0]);
  }
  // "keep the intro" / "don't cut the ending"
  if (new RegExp(`\\b${guard}\\s+(?:the\\s+|my\\s+)?(?:intro|opening|hook|beginning|start)\\b`, "i").test(text)) addRange(0, 5000, "intro (first 5 s)");
  if (dur && new RegExp(`\\b${guard}\\s+(?:the\\s+|my\\s+)?(?:outro|ending|end|close|closing|cta|call to action)\\b`, "i").test(text)) addRange(Math.max(0, dur - 5000), dur, "ending (last 5 s)");

  const merged = mergeDirectorConstraints(dur || null, { lockedRanges: ranges, lockedTracks: tracks });
  return { ...merged, notes };
}

// ─── Enforcement ───────────────────────────────────────────────────────────────────────────────────

/** The operations each locked track forbids. */
export const TRACK_OPS: Record<DirectorLockableTrack, readonly string[]> = {
  music: ["addBackgroundMusic", "duckAudio"],
  captions: ["autoCaptions", "addCaption", "styleCaption", "translateCaptions", "emphasizeWord", "clearCaptions"],
  broll: ["insertBroll", "addImage", "addSticker"],
  sfx: ["addSoundEffect", "autoSoundDesign"],
  effects: ["addEffect", "applyFilter", "addTransition"],
  text: ["addText"],
};

/** removeItem kinds that belong to a lockable track (zooms are not lockable). */
const REMOVE_KIND_TRACK: Record<string, DirectorLockableTrack> = { caption: "captions", title: "text", broll: "broll", effect: "effects", sfx: "sfx" };

export interface ConstraintTimeline {
  durationSec: number;
  clips: Array<{ id: string; startSec: number; endSec: number }>;
  /** Audio track ids that are the music bed (adjustVolume on them touches the music). */
  musicTrackIds: string[];
}

export function mainTrackOf(ir: EditIR) {
  return ir.tracks.videoTracks.find((t) => t.type === "MAIN_VIDEO") || ir.tracks.videoTracks[0];
}

export function constraintTimelineFromEditIR(ir: EditIR): ConstraintTimeline {
  const s = RationalTimeMath.toSeconds;
  const main = mainTrackOf(ir);
  return {
    durationSec: s(ir.meta.totalDuration),
    clips: (main?.clips || []).map((c) => ({ id: c.id, startSec: s(c.timelineRange.start), endSec: s(c.timelineRange.start) + s(c.timelineRange.duration) })),
    musicTrackIds: ir.tracks.audioTracks.filter((t) => t.type === "BGM").map((t) => t.id),
  };
}

const EPS = 0.001;
const overlaps = (a0: number, a1: number, b0: number, b1: number) => Math.max(a0, b0) < Math.min(a1, b1) - EPS;
const inside = (t: number, b0: number, b1: number) => t > b0 + EPS && t < b1 - EPS;
const fmt = (sec: number) => `${sec.toFixed(1)}s`;

/** Timeline seconds an operation changes on the current timeline (empty = not a timed operation). */
function touchedRanges(op: any, tl: ConstraintTimeline): { ranges: Array<[number, number]>; points: number[] } {
  const clip = (id: string) => tl.clips.find((c) => c.id === id);
  const r = (a: number, d: number): [number, number] => [a, a + Math.max(0, d)];
  switch (op.type) {
    case "removeRange":
      return { ranges: [r(op.startSec, op.durationSec)], points: [] };
    case "processFootage":
      if (op.action === "remove_background") return { ranges: [], points: [] };
      {
        const c = clip(op.targetId);
        return { ranges: c ? [[c.startSec, c.endSec]] : [], points: [] };
      }
    case "rippleDelete":
    case "duplicateClip":
    case "replaceClip":
    case "detachAudio":
    case "asynchronousSplit": {
      const c = clip(op.clipId);
      return { ranges: c ? [[c.startSec, c.endSec]] : [], points: op.type === "duplicateClip" && typeof op.targetTimelineStartSec === "number" ? [op.targetTimelineStartSec] : [] };
    }
    case "trimClip": {
      const c = clip(op.clipId);
      if (!c) return { ranges: [], points: [] };
      const out: Array<[number, number]> = [];
      if (op.startTrimSec > 0) out.push([c.startSec, c.startSec + op.startTrimSec]);
      if (op.endTrimSec > 0) out.push([c.endSec - op.endTrimSec, c.endSec]);
      return { ranges: out, points: [] };
    }
    case "moveClip": {
      const c = clip(op.clipId);
      return { ranges: c ? [[c.startSec, c.endSec]] : [], points: [op.targetTimelineStartSec] };
    }
    case "reorderSegment":
      return { ranges: [r(op.segmentStartSec, op.segmentDurationSec)], points: [op.newStartSec] };
    case "changeSpeed": {
      if (!op.clipId || op.clipId === "all") return { ranges: [[0, tl.durationSec]], points: [] };
      const c = clip(op.clipId);
      return { ranges: c ? [[c.startSec, c.endSec]] : [], points: [] };
    }
    case "freezeFrame":
      return { ranges: [], points: [op.timestampSec] };
    case "insertBroll":
    case "addImage":
    case "addSticker":
    case "addText":
      return { ranges: [r(op.timelineStartSec, op.durationSec)], points: [] };
    case "addZoom":
    case "addEffect":
      return { ranges: [r(op.startSec, op.durationSec)], points: [] };
    case "addSoundEffect":
      return { ranges: [r(op.timelineStartSec, 0.5)], points: [] };
    case "addNarration":
      // Estimated spoken length (~2.6 words/s), as the compiler places it.
      return { ranges: [r(op.timelineStartSec, 0.4 + String(op.text || "").split(/\s+/).filter(Boolean).length / 2.6)], points: [] };
    case "removeItem":
      // By time it touches that moment; by id / "all" the item's span is unknown here, so treat it as the whole video.
      return typeof op.atSec === "number" && !op.id ? { ranges: [], points: [op.atSec] } : { ranges: [[0, tl.durationSec]], points: [] };
    default:
      return { ranges: [], points: [] };
  }
}

/** Why `op` breaks the constraints, or null when it is allowed. */
export function constraintViolation(op: CreativeOperation | any, c: ResolvedDirectorConstraints, tl: ConstraintTimeline): string | null {
  for (const track of c.lockedTracks) {
    if (TRACK_OPS[track].includes(op.type)) return `${op.type} would change the locked ${track}`;
    if (op.type === "removeItem" && REMOVE_KIND_TRACK[op.kind as string] === track) return `removeItem would change the locked ${track}`;
    if (op.type === "processFootage" && op.action === "remove_background" && track === "broll") return `processFootage would change the locked broll`;
    if (track === "music" && op.type === "adjustVolume" && (op.trackId === "music" || tl.musicTrackIds.includes(op.trackId))) {
      return `adjustVolume would change the locked music`;
    }
  }
  if (!c.lockedRanges.length) return null;
  const { ranges, points } = touchedRanges(op, tl);
  for (const [ls, le] of c.lockedRanges) {
    const a = ls / 1000;
    const b = le / 1000;
    const hit = ranges.find(([s, e]) => overlaps(s, e, a, b));
    if (hit) return `${op.type} at ${fmt(hit[0])}–${fmt(hit[1])} overlaps the locked range ${fmt(a)}–${fmt(b)}`;
    const p = points.find((t) => inside(t, a, b));
    if (p !== undefined) return `${op.type} would insert footage at ${fmt(p)}, inside the locked range ${fmt(a)}–${fmt(b)}`;
  }
  return null;
}

export interface ConstraintEnforcement<T> {
  kept: T[];
  /** One line per dropped operation. */
  violations: string[];
  droppedIndexes: number[];
}

/** Drops every operation that breaks the constraints. Pure. */
export function enforceDirectorConstraints<T extends { type: string }>(ops: T[], c: ResolvedDirectorConstraints, tl: ConstraintTimeline): ConstraintEnforcement<T> {
  const kept: T[] = [];
  const violations: string[] = [];
  const droppedIndexes: number[] = [];
  ops.forEach((op, i) => {
    const why = constraintViolation(op, c, tl);
    if (why) {
      violations.push(why);
      droppedIndexes.push(i);
    } else kept.push(op);
  });
  return { kept, violations, droppedIndexes };
}

// ─── Locked-range mapping through an edit (source-time based) ─────────────────────────────────────

interface SourceSpan { assetId: string; s: number; e: number; speed: number }

function clipSpans(clips: VideoClip[]) {
  const t = RationalTimeMath.toSeconds;
  return clips.map((c) => {
    const tl0 = t(c.timelineRange.start);
    const tl1 = tl0 + t(c.timelineRange.duration);
    const src0 = t(c.sourceRange.start);
    const speed = c.speedMultiplier || 1;
    return { assetId: c.assetId, tl0, tl1, src0, speed };
  });
}

/** Source spans (per asset) a timeline range of `ir` plays. */
export function sourceSpansOfRange(ir: EditIR, startMs: number, endMs: number): SourceSpan[] {
  const a = startMs / 1000;
  const b = endMs / 1000;
  const out: SourceSpan[] = [];
  for (const c of clipSpans(mainTrackOf(ir)?.clips || [])) {
    const s = Math.max(a, c.tl0);
    const e = Math.min(b, c.tl1);
    if (e - s <= EPS) continue;
    out.push({ assetId: c.assetId, s: c.src0 + (s - c.tl0) * c.speed, e: c.src0 + (e - c.tl0) * c.speed, speed: c.speed });
  }
  return out;
}

/**
 * Where the footage of `rangesMs` (timeline of `before`) sits on the timeline of `after`. Used to carry locks into
 * repair rounds and to verify that a locked range survived the edit.
 */
export function mapLockedRanges(before: EditIR, after: EditIR, rangesMs: Array<[number, number]>): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const clips = clipSpans(mainTrackOf(after)?.clips || []);
  for (const [s, e] of rangesMs) {
    for (const span of sourceSpansOfRange(before, s, e)) {
      for (const c of clips) {
        if (c.assetId !== span.assetId) continue;
        const cSrc1 = c.src0 + (c.tl1 - c.tl0) * c.speed;
        const lo = Math.max(span.s, c.src0);
        const hi = Math.min(span.e, cSrc1);
        if (hi - lo <= EPS) continue;
        out.push([Math.round((c.tl0 + (lo - c.src0) / c.speed) * 1000), Math.round((c.tl0 + (hi - c.src0) / c.speed) * 1000)]);
      }
    }
  }
  return mergeDirectorConstraints(null, { lockedRanges: out }).lockedRanges;
}

export interface LockedRangeCheck {
  ok: boolean;
  /** One line per locked range whose footage was cut, sped up or lost. */
  problems: Array<{ rangeMs: [number, number]; detail: string }>;
}

/** Verifies that every locked range's footage still plays in full, at the same speed, after the edit. */
export function verifyLockedRangesPreserved(before: EditIR, after: EditIR, rangesMs: Array<[number, number]>): LockedRangeCheck {
  const problems: LockedRangeCheck["problems"] = [];
  const clips = clipSpans(mainTrackOf(after)?.clips || []);
  for (const range of rangesMs) {
    let missing = 0;
    let speedChanged = false;
    for (const span of sourceSpansOfRange(before, range[0], range[1])) {
      // Covered length of [span.s, span.e] by clips of the same asset (union).
      const covers: Array<[number, number]> = [];
      for (const c of clips) {
        if (c.assetId !== span.assetId) continue;
        const cSrc1 = c.src0 + (c.tl1 - c.tl0) * c.speed;
        const lo = Math.max(span.s, c.src0);
        const hi = Math.min(span.e, cSrc1);
        if (hi - lo <= EPS) continue;
        covers.push([lo, hi]);
        if (Math.abs(c.speed - span.speed) > 1e-6) speedChanged = true;
      }
      covers.sort((x, y) => x[0] - y[0]);
      let covered = 0;
      let cur = -Infinity;
      for (const [lo, hi] of covers) {
        const from = Math.max(lo, cur);
        if (hi > from) covered += hi - from;
        cur = Math.max(cur, hi);
      }
      missing += Math.max(0, span.e - span.s - covered);
    }
    if (missing > 0.05) problems.push({ rangeMs: range, detail: `${missing.toFixed(2)}s of the locked range ${fmt(range[0] / 1000)}–${fmt(range[1] / 1000)} was cut` });
    else if (speedChanged) problems.push({ rangeMs: range, detail: `the speed of the locked range ${fmt(range[0] / 1000)}–${fmt(range[1] / 1000)} changed` });
  }
  return { ok: problems.length === 0, problems };
}

// ─── Autonomy policy ───────────────────────────────────────────────────────────────────────────────

export const EDITING_AUTONOMY_LEVELS = ["AUTO", "ASSISTED", "MANUAL"] as const;
export const PUBLISHING_AUTONOMY_LEVELS = ["ASSISTED", "MANUAL"] as const;
export type EditingAutonomy = (typeof EDITING_AUTONOMY_LEVELS)[number];
export type PublishingAutonomy = (typeof PUBLISHING_AUTONOMY_LEVELS)[number];
export interface AutonomyPolicy { editing: EditingAutonomy; publishing: PublishingAutonomy }

/** Policy defaults (not brand data): the AI proposes edits, and a person publishes. */
export const DEFAULT_AUTONOMY: Readonly<AutonomyPolicy> = Object.freeze({ editing: "ASSISTED", publishing: "MANUAL" });

/** Operations the director may apply without asking when the project's editing autonomy is AUTO. */
export const SAFE_OPS = [
  "removeSilences",
  "cleanFillers",
  "autoCaptions",
  "styleCaption",
  "adjustVolume",
  "duckAudio",
  "reframeSubject",
  "changeAspectRatio",
] as const;
export type SafeOp = (typeof SAFE_OPS)[number];

export const isSafeOp = (type: string): type is SafeOp => (SAFE_OPS as readonly string[]).includes(type);

export function normalizeAutonomy(a: Partial<AutonomyPolicy> | null | undefined): AutonomyPolicy {
  const editing = (EDITING_AUTONOMY_LEVELS as readonly string[]).includes(a?.editing as string) ? (a!.editing as EditingAutonomy) : DEFAULT_AUTONOMY.editing;
  const publishing = (PUBLISHING_AUTONOMY_LEVELS as readonly string[]).includes(a?.publishing as string) ? (a!.publishing as PublishingAutonomy) : DEFAULT_AUTONOMY.publishing;
  return { editing, publishing };
}

export interface AutoApplyDecision {
  autoApplied: boolean;
  requiresConfirmation: boolean;
  reason: string;
}

/**
 * AUTO: applied without asking only when there is at least one operation, every operation is in SAFE_OPS and no
 * operation was dropped for a constraint; otherwise it becomes a proposal. ASSISTED: the planner's own
 * `requiresConfirmation`. MANUAL: always a proposal.
 */
export function decideAutoApply(params: {
  editing: EditingAutonomy;
  operationTypes: string[];
  plannerRequiresConfirmation: boolean;
  violations: number;
  isGreeting?: boolean;
}): AutoApplyDecision {
  const { editing, operationTypes, plannerRequiresConfirmation, violations } = params;
  if (params.isGreeting) return { autoApplied: false, requiresConfirmation: true, reason: "opening proposal" };
  if (editing === "MANUAL") return { autoApplied: false, requiresConfirmation: true, reason: "editing autonomy is MANUAL: every change is a proposal" };
  if (editing === "AUTO") {
    if (!operationTypes.length) return { autoApplied: false, requiresConfirmation: plannerRequiresConfirmation, reason: "no operations" };
    const unsafe = Array.from(new Set(operationTypes.filter((t) => !isSafeOp(t))));
    if (unsafe.length) return { autoApplied: false, requiresConfirmation: true, reason: `not auto-applied: ${unsafe.join(", ")} ${unsafe.length === 1 ? "is" : "are"} not in the safe list` };
    if (violations > 0) return { autoApplied: false, requiresConfirmation: true, reason: "not auto-applied: some operations were dropped for your constraints" };
    return { autoApplied: true, requiresConfirmation: false, reason: "auto-applied: every operation is in the safe list" };
  }
  return { autoApplied: false, requiresConfirmation: plannerRequiresConfirmation, reason: "editing autonomy is ASSISTED" };
}
