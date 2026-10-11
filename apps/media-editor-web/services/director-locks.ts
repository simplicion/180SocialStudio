/**
 * Timeline locks → the director's `constraints`, plus a client-side check of every AI result against them (defense in
 * depth: the server validator enforces the same constraints; this makes sure a result that slipped through is never
 * applied silently).
 *
 * Semantics follow packages/video-contracts/src/director-constraints.ts:
 *  - `lockedRanges` are integer ms on the CURRENT timeline; the footage they play must still play in full, at the same
 *    speed, after the edit (it may move if something before it is cut).
 *  - `lockedTracks` ∈ music | captions | broll | sfx | effects | text; that part of the timeline must not change.
 * The camera lane has no server-side lock, so it is only protected here (restored, never sent).
 */
import type { EditIR } from "@workspace/video-contracts";

export const LOCKABLE_TRACKS = ["music", "captions", "broll", "sfx", "effects", "text"] as const;
export type LockableTrack = (typeof LOCKABLE_TRACKS)[number];
/** Client-only lock (no server equivalent). */
export type ClientLock = LockableTrack | "camera";

export interface DirectorConstraintsPayload {
  lockedRanges?: Array<[number, number]>;
  lockedTracks?: LockableTrack[];
}

const toSec = (t: { value: number; timescale: number }) => t.value / t.timescale;
const mainTrackOf = (ir: EditIR) => ir.tracks.videoTracks.find((t) => t.type === "MAIN_VIDEO") ?? ir.tracks.videoTracks[0];

/**
 * Timeline lock keys (Timeline.tsx: "c1" camera, "t1" captions lane, "fx", "v_<trackId>", "a_<trackId>") → locks.
 * A locked main video track locks its whole duration as a range.
 */
export function locksFromTimelineKeys(editIR: EditIR, keys: Record<string, boolean>): { tracks: ClientLock[]; mainLocked: boolean } {
  const out = new Set<ClientLock>();
  let mainLocked = false;
  for (const [key, on] of Object.entries(keys)) {
    if (!on) continue;
    if (key === "c1") out.add("camera");
    else if (key === "t1") {
      out.add("captions");
      out.add("text");
    } else if (key === "fx") out.add("effects");
    else if (key.startsWith("v_")) {
      const id = key.slice(2);
      const idx = editIR.tracks.videoTracks.findIndex((t, i) => (t.id || String(i)) === id);
      const t = editIR.tracks.videoTracks[idx];
      if (!t) continue;
      if (t === mainTrackOf(editIR)) mainLocked = true;
      else out.add("broll");
    } else if (key.startsWith("a_")) {
      const id = key.slice(2);
      const t = editIR.tracks.audioTracks.find((a, i) => (a.id || String(i)) === id);
      if (t?.type === "BGM") out.add("music");
      else if (t?.type === "SFX") out.add("sfx");
    }
  }
  return { tracks: [...out], mainLocked };
}

/** Sorted, merged, integer, non-empty ranges clamped to [0, durationMs]. */
export function normalizeRanges(ranges: Array<[number, number]>, durationMs?: number): Array<[number, number]> {
  const clean = ranges
    .map(([s, e]) => [Math.max(0, Math.round(Math.min(s, e))), Math.round(Math.max(s, e))] as [number, number])
    .map(([s, e]) => [s, durationMs != null ? Math.min(e, Math.round(durationMs)) : e] as [number, number])
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  for (const r of clean) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

/** The `constraints` block for a director request; undefined when nothing is locked. */
export function buildDirectorConstraints(editIR: EditIR, lockKeys: Record<string, boolean>, lockedRangesMs: Array<[number, number]>): DirectorConstraintsPayload | undefined {
  const { tracks, mainLocked } = locksFromTimelineKeys(editIR, lockKeys);
  const durationMs = Math.round(toSec(editIR.meta.totalDuration) * 1000);
  const ranges = normalizeRanges([...lockedRangesMs, ...(mainLocked && durationMs > 0 ? [[0, durationMs] as [number, number]] : [])], durationMs);
  const serverTracks = tracks.filter((t): t is LockableTrack => t !== "camera");
  if (!ranges.length && !serverTracks.length) return undefined;
  return { ...(ranges.length ? { lockedRanges: ranges } : {}), ...(serverTracks.length ? { lockedTracks: serverTracks } : {}) };
}

// ── verification of an AI result ────────────────────────────────────────────

interface Span { assetId: string; s: number; e: number; speed: number }

function clipSpans(ir: EditIR) {
  return (mainTrackOf(ir)?.clips ?? []).map((c) => {
    const tl0 = toSec(c.timelineRange.start);
    return { assetId: c.assetId || c.sourcePath, tl0, tl1: tl0 + toSec(c.timelineRange.duration), src0: toSec(c.sourceRange.start), speed: c.speedMultiplier || 1 };
  });
}

function sourceSpans(ir: EditIR, startMs: number, endMs: number): Span[] {
  const a = startMs / 1000;
  const b = endMs / 1000;
  const out: Span[] = [];
  for (const c of clipSpans(ir)) {
    const s = Math.max(a, c.tl0);
    const e = Math.min(b, c.tl1);
    if (e - s <= 0.001) continue;
    out.push({ assetId: c.assetId, s: c.src0 + (s - c.tl0) * c.speed, e: c.src0 + (e - c.tl0) * c.speed, speed: c.speed });
  }
  return out;
}

/** Problems with the footage of each locked range after the edit (cut or re-timed). Empty = preserved. */
export function lockedRangeProblems(before: EditIR, after: EditIR, rangesMs: Array<[number, number]>): string[] {
  const problems: string[] = [];
  const clips = clipSpans(after);
  for (const [r0, r1] of rangesMs) {
    let missing = 0;
    let speedChanged = false;
    for (const span of sourceSpans(before, r0, r1)) {
      const covers: Array<[number, number]> = [];
      for (const c of clips) {
        if (c.assetId !== span.assetId) continue;
        const lo = Math.max(span.s, c.src0);
        const hi = Math.min(span.e, c.src0 + (c.tl1 - c.tl0) * c.speed);
        if (hi - lo <= 0.001) continue;
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
    const label = `${(r0 / 1000).toFixed(1)}–${(r1 / 1000).toFixed(1)} s`;
    if (missing > 0.05) problems.push(`${missing.toFixed(2)} s of the locked range ${label} was cut`);
    else if (speedChanged) problems.push(`the speed of the locked range ${label} changed`);
  }
  return problems;
}

/** The part of the timeline each lock protects (JSON-comparable). */
function lockedPart(ir: EditIR, lock: ClientLock): unknown {
  const caps = ir.tracks.captionTrack ?? [];
  switch (lock) {
    case "captions":
      return caps.filter((c) => c.role !== "title");
    case "text":
      return caps.filter((c) => c.role === "title");
    case "effects":
      return ir.tracks.effectTrack ?? [];
    case "camera":
      return ir.tracks.cameraTrack ?? [];
    case "broll":
      return ir.tracks.videoTracks.filter((t) => t !== mainTrackOf(ir));
    case "music":
      return ir.tracks.audioTracks.filter((t) => t.type === "BGM");
    case "sfx":
      return ir.tracks.audioTracks.filter((t) => t.type === "SFX");
  }
}

function restorePart(after: EditIR, before: EditIR, lock: ClientLock): EditIR {
  const t = after.tracks;
  const b = before.tracks;
  switch (lock) {
    case "captions":
    case "text": {
      const keepRole = (c: { role?: string }) => (lock === "text" ? c.role === "title" : c.role !== "title");
      return { ...after, tracks: { ...t, captionTrack: [...(t.captionTrack ?? []).filter((c) => !keepRole(c)), ...(b.captionTrack ?? []).filter(keepRole)] } };
    }
    case "effects":
      return { ...after, tracks: { ...t, effectTrack: b.effectTrack ?? [] } };
    case "camera":
      return { ...after, tracks: { ...t, cameraTrack: b.cameraTrack ?? [] } };
    case "broll": {
      const main = mainTrackOf(after);
      return { ...after, tracks: { ...t, videoTracks: [...(main ? [main] : []), ...b.videoTracks.filter((x) => x !== mainTrackOf(before))] } };
    }
    case "music":
    case "sfx": {
      const type = lock === "music" ? "BGM" : "SFX";
      return { ...after, tracks: { ...t, audioTracks: [...t.audioTracks.filter((a) => a.type !== type), ...b.audioTracks.filter((a) => a.type === type)] } };
    }
  }
}

export interface LockCheck {
  /** The timeline to apply (locked tracks restored from `before`). */
  editIR: EditIR;
  /** Locked tracks the AI result changed (restored). */
  restoredTracks: ClientLock[];
  /** Locked ranges whose footage was cut or re-timed: the result must NOT be applied. */
  rangeProblems: string[];
  blocked: boolean;
}

/** Checks an AI result against the user's locks. Locked tracks are restored; broken locked ranges block the result. */
export function enforceLocksOnResult(before: EditIR, after: EditIR, locks: { tracks: ClientLock[]; rangesMs: Array<[number, number]> }): LockCheck {
  let editIR = after;
  const restoredTracks: ClientLock[] = [];
  for (const lock of locks.tracks) {
    if (JSON.stringify(lockedPart(before, lock)) !== JSON.stringify(lockedPart(after, lock))) {
      editIR = restorePart(editIR, before, lock);
      restoredTracks.push(lock);
    }
  }
  const rangeProblems = locks.rangesMs.length ? lockedRangeProblems(before, after, locks.rangesMs) : [];
  return { editIR, restoredTracks, rangeProblems, blocked: rangeProblems.length > 0 };
}
