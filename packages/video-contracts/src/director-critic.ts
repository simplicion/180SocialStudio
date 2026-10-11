import type { MobileEditIR, MobileMediaDescriptor } from "./mobile-edit-ir";
import type { LastExportQa } from "./ai-director-api.schema";

/**
 * Director critic (observe → critique → repair). Deterministic checks on the compiled MobileEditIR (integer ms),
 * the source analysis the device sent, and the device QA of the last export. It extends `critic.ts`
 * (VideoCriticService, EditIR heuristics) with signals the Director loop can act on.
 *
 * Severity: CRITICAL = broken or clearly wrong output; WARNING = quality problem; SUGGESTION = optional polish.
 * Only issues marked repairable are sent back to the planner; the rest are reported honestly.
 */

export type CritiqueSeverity = "CRITICAL" | "WARNING" | "SUGGESTION";
export type CritiqueCategory = "PACING" | "VISUAL" | "AUDIO" | "SUBTITLE" | "BROLL" | "EXPORT" | "CONSTRAINT";

export interface DirectorCritiqueIssue {
  /** Stable across repair rounds for the same problem (kind + time). */
  id: string;
  severity: CritiqueSeverity;
  category: CritiqueCategory;
  title: string;
  timeRangeMs?: [number, number];
}

export interface DirectorCritique {
  score: number;
  issues: DirectorCritiqueIssue[];
  repairRounds: number;
}

export interface DirectorCritiqueResult {
  score: number;
  issues: DirectorCritiqueIssue[];
  /** Ids of CRITICAL issues the planner can fix with operations. */
  repairable: string[];
}

export interface DirectorCritiqueInput {
  editIR: MobileEditIR;
  /** Source-time transcript words of the primary asset. */
  sourceWords?: Array<{ text: string; startMs: number; endMs: number }>;
  primaryAssetId?: string;
  loudness?: MobileMediaDescriptor["loudness"];
  /** QA of the last export and the timeline that was exported (normally the request's currentEditIR). */
  lastExportQa?: LastExportQa;
  exportedEditIR?: MobileEditIR | null;
  /** Problems found by `verifyLockedRangesPreserved` (director). */
  lockedRangeProblems?: Array<{ rangeMs: [number, number]; detail: string }>;
}

export const CRITIC_THRESHOLDS = {
  microClipMs: 250,
  deadAirInteriorMs: 1500,
  deadAirEdgeMs: 1000,
  maxZoomsPerMinute: 20,
  maxZoomScale: 1.8,
  minCaptionMs: 250,
  unduckedMusicMaxDb: -20,
  duckedMusicUnderSpeechMaxDb: -24,
  quietVoiceLufs: -26,
  exportDurationToleranceMs: 250,
  blackMaxMs: 500,
  frozenMaxMs: 1000,
  loudLufs: -9,
  quietLufs: -20,
  clippingPct: 0.5,
} as const;

const STOP = new Set([
  "the", "and", "for", "with", "that", "this", "from", "your", "you", "are", "was", "but", "not", "have", "has",
  "our", "out", "into", "about", "shot", "video", "footage", "clip", "stock", "close", "closeup", "slow", "motion",
]);
const stem = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "").replace(/(?:ing|ers|er|es|s|ed)$/u, "");
const tokens = (s: string) => s.split(/\s+/).map(stem).filter((t) => t.length > 2 && !STOP.has(t));
const sec = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

/** Transcript words mapped onto the edited timeline (through clips of the primary asset). */
export function timelineWordsOf(ir: MobileEditIR, words: Array<{ text: string; startMs: number; endMs: number }>, primaryAssetId = "primary") {
  const out: Array<{ text: string; startMs: number; endMs: number }> = [];
  for (const c of ir.clips) {
    if (c.assetId !== primaryAssetId) continue;
    for (const w of words) {
      if (w.endMs <= c.sourceStartMs || w.startMs >= c.sourceEndMs) continue;
      const s = Math.max(w.startMs, c.sourceStartMs);
      const e = Math.min(w.endMs, c.sourceEndMs);
      out.push({ text: w.text, startMs: Math.round(c.timelineStartMs + (s - c.sourceStartMs) / c.speed), endMs: Math.round(c.timelineStartMs + (e - c.sourceStartMs) / c.speed) });
    }
  }
  return out.sort((a, b) => a.startMs - b.startMs);
}

const overlapMs = (a: [number, number], b: [number, number]) => Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]));

export function critiqueDirectorEdit(input: DirectorCritiqueInput): DirectorCritiqueResult {
  const T = CRITIC_THRESHOLDS;
  const ir = input.editIR;
  const issues: DirectorCritiqueIssue[] = [];
  const repairable = new Set<string>();
  const add = (i: DirectorCritiqueIssue, canRepair = false) => {
    if (issues.some((x) => x.id === i.id)) return;
    issues.push(i);
    if (canRepair && i.severity === "CRITICAL") repairable.add(i.id);
  };
  const dur = ir.durationMs;

  // 1. Micro cuts on the main track.
  for (const c of ir.clips) {
    const d = c.timelineEndMs - c.timelineStartMs;
    if (d < T.microClipMs) add({ id: `micro_clip:${c.timelineStartMs}`, severity: "CRITICAL", category: "VISUAL", title: `A ${d} ms clip flashes on screen at ${sec(c.timelineStartMs)}`, timeRangeMs: [c.timelineStartMs, c.timelineEndMs] }, true);
  }

  // 2. Dead air left (speech ranges are recomputed on the edited timeline).
  const speech = [...(ir.audio?.speechRangesMs || [])].sort((a, b) => a[0] - b[0]);
  if (speech.length && (input.sourceWords?.length ?? 1) > 0) {
    if (speech[0][0] > T.deadAirEdgeMs) add({ id: `dead_air:0`, severity: "WARNING", category: "PACING", title: `${sec(speech[0][0])} of silence before the first word`, timeRangeMs: [0, speech[0][0]] });
    for (let i = 1; i < speech.length; i++) {
      const gap = speech[i][0] - speech[i - 1][1];
      if (gap > T.deadAirInteriorMs) add({ id: `dead_air:${speech[i - 1][1]}`, severity: "WARNING", category: "PACING", title: `${sec(gap)} of dead air at ${sec(speech[i - 1][1])}`, timeRangeMs: [speech[i - 1][1], speech[i][0]] });
    }
    const tail = dur - speech[speech.length - 1][1];
    if (tail > T.deadAirInteriorMs) add({ id: `dead_air:tail`, severity: "WARNING", category: "PACING", title: `${sec(tail)} of silence after the last word`, timeRangeMs: [speech[speech.length - 1][1], dur] });
  }

  // 3. Zoom density and overlap (renderers require non-overlapping zooms).
  const zooms = [...(ir.zooms || [])].sort((a, b) => a.startMs - b.startMs);
  for (let i = 1; i < zooms.length; i++) {
    if (zooms[i].startMs < zooms[i - 1].endMs) add({ id: `zoom_overlap:${zooms[i].startMs}`, severity: "CRITICAL", category: "VISUAL", title: `Zooms overlap at ${sec(zooms[i].startMs)}`, timeRangeMs: [zooms[i].startMs, Math.min(zooms[i].endMs, zooms[i - 1].endMs)] }, true);
  }
  if (dur > 0 && zooms.length / (dur / 60000) > T.maxZoomsPerMinute && zooms.length >= 4) {
    add({ id: `zoom_density`, severity: "WARNING", category: "VISUAL", title: `${zooms.length} zooms in ${sec(dur)} (more than one every 3 s) can feel jumpy` });
  }
  for (const z of zooms) if (z.scale > T.maxZoomScale) add({ id: `zoom_scale:${z.startMs}`, severity: "WARNING", category: "VISUAL", title: `Zoom at ${sec(z.startMs)} is ${z.scale}x (strong punch-ins look soft)`, timeRangeMs: [z.startMs, z.endMs] });

  // 4. Captions: overlap, out of bounds, too short, words outside their caption.
  const caps = [...(ir.captions || [])].filter((c) => c.kind === "caption").sort((a, b) => a.startMs - b.startMs);
  for (let i = 0; i < caps.length; i++) {
    const c = caps[i];
    if (i > 0 && c.startMs < caps[i - 1].endMs - 20) add({ id: `caption_overlap:${c.startMs}`, severity: "CRITICAL", category: "SUBTITLE", title: `Captions overlap at ${sec(c.startMs)}`, timeRangeMs: [c.startMs, caps[i - 1].endMs] }, true);
    if (c.endMs > dur + 50) add({ id: `caption_bounds:${c.startMs}`, severity: "CRITICAL", category: "SUBTITLE", title: `A caption runs past the end of the video (${sec(c.endMs)} > ${sec(dur)})`, timeRangeMs: [c.startMs, c.endMs] }, true);
    if (c.endMs - c.startMs < T.minCaptionMs) add({ id: `caption_short:${c.startMs}`, severity: "WARNING", category: "SUBTITLE", title: `Caption at ${sec(c.startMs)} is on screen for only ${c.endMs - c.startMs} ms`, timeRangeMs: [c.startMs, c.endMs] });
    if ((c.words || []).some((w) => w.startMs < c.startMs - 5 || w.endMs > c.endMs + 5)) add({ id: `caption_timing:${c.startMs}`, severity: "WARNING", category: "SUBTITLE", title: `Word timings fall outside the caption at ${sec(c.startMs)}`, timeRangeMs: [c.startMs, c.endMs] });
  }

  // 5. B-roll relevance vs what is said around it.
  const tlWords = input.sourceWords?.length ? timelineWordsOf(ir, input.sourceWords, input.primaryAssetId) : [];
  if (tlWords.length) {
    const allTokens = new Set(tlWords.flatMap((w) => tokens(w.text)));
    for (const o of ir.overlays || []) {
      const query = (o.source as any)?.query as string | undefined;
      if (!query) continue;
      const q = tokens(query);
      if (!q.length) continue;
      const near = new Set(tlWords.filter((w) => w.endMs >= o.timelineStartMs - 3000 && w.startMs <= o.timelineEndMs + 3000).flatMap((w) => tokens(w.text)));
      if (q.some((t) => near.has(t))) continue;
      if (q.some((t) => allTokens.has(t))) add({ id: `broll_offcue:${o.timelineStartMs}`, severity: "SUGGESTION", category: "BROLL", title: `B-roll "${query}" at ${sec(o.timelineStartMs)} does not match what is said at that moment`, timeRangeMs: [o.timelineStartMs, o.timelineEndMs] });
      else add({ id: `broll_unrelated:${o.timelineStartMs}`, severity: "WARNING", category: "BROLL", title: `B-roll "${query}" at ${sec(o.timelineStartMs)} is not related to anything in the transcript`, timeRangeMs: [o.timelineStartMs, o.timelineEndMs] });
    }
  }

  // 6. Music over speech (levels, ducking, source loudness).
  const music = ir.audio?.music || [];
  const hasSpeech = speech.length > 0 && (ir.audio?.originalTrack?.volumeDb ?? 0) > -60;
  for (const m of music) {
    if (!hasSpeech) break;
    const range: [number, number] = [m.timelineStartMs, m.timelineEndMs];
    const underSpeech = speech.reduce((a, r) => a + overlapMs(range, r), 0);
    if (underSpeech <= 0) continue;
    if (!m.duck?.enabled && m.volumeDb > T.unduckedMusicMaxDb) {
      add({ id: `music_over_speech:${m.id}`, severity: "CRITICAL", category: "AUDIO", title: `Music at ${m.volumeDb} dB is not ducked under speech and will mask the voice`, timeRangeMs: range }, true);
    } else if (m.duck?.enabled && m.volumeDb + (m.duck.duckDb ?? 0) > T.duckedMusicUnderSpeechMaxDb) {
      add({ id: `music_duck_shallow:${m.id}`, severity: "WARNING", category: "AUDIO", title: `Music stays at ${m.volumeDb + (m.duck.duckDb ?? 0)} dB under speech; duck it deeper`, timeRangeMs: range });
    }
    if (input.loudness && input.loudness.integratedLufs < T.quietVoiceLufs && m.volumeDb + (m.duck?.enabled ? m.duck.duckDb ?? 0 : 0) > -30) {
      add({ id: `quiet_voice_music:${m.id}`, severity: "WARNING", category: "AUDIO", title: `The voice is quiet (${input.loudness.integratedLufs} LUFS) for this music level`, timeRangeMs: range });
    }
  }
  if (input.loudness?.clippingPct != null && input.loudness.clippingPct > T.clippingPct) {
    add({ id: `source_clipping`, severity: "WARNING", category: "AUDIO", title: `${input.loudness.clippingPct}% of the source audio samples clip (distortion)` });
  }

  // 7. Locked ranges (checked by the director against the timeline before this turn).
  for (const p of input.lockedRangeProblems || []) {
    add({ id: `locked_range:${p.rangeMs[0]}`, severity: "CRITICAL", category: "CONSTRAINT", title: p.detail, timeRangeMs: p.rangeMs });
  }

  // 8. Device QA of the last export, compared with the exported timeline.
  const qa = input.lastExportQa;
  const ref = input.exportedEditIR || null;
  if (qa && ref) {
    const tol = Math.max(T.exportDurationToleranceMs, Math.round(ref.durationMs * 0.02));
    if (Math.abs(qa.durationMs - ref.durationMs) > tol) add({ id: `export_duration`, severity: "CRITICAL", category: "EXPORT", title: `The last export is ${sec(qa.durationMs)} long but the timeline is ${sec(ref.durationMs)}` });
    // Export resolution is the creator's choice (up- or down-scaled): only a different ASPECT is a defect.
    const qaAspect = qa.width / qa.height;
    const refAspect = ref.canvas.width / ref.canvas.height;
    if (Math.abs(qaAspect - refAspect) / refAspect > 0.02) add({ id: `export_aspect`, severity: "CRITICAL", category: "EXPORT", title: `The last export is ${qa.width}x${qa.height}, which does not match the timeline's ${ref.canvas.aspect} frame` });
    const expectsAudio = (ref.audio?.originalTrack?.volumeDb ?? 0) > -60 || (ref.audio?.music?.length ?? 0) > 0 || (ref.audio?.sfx?.length ?? 0) > 0;
    if (expectsAudio && !qa.hasAudio) add({ id: `export_no_audio`, severity: "CRITICAL", category: "EXPORT", title: `The last export has no audio stream` });
    if (qa.fps && ref.canvas.fps && Math.abs(qa.fps - ref.canvas.fps) > 1) add({ id: `export_fps`, severity: "WARNING", category: "EXPORT", title: `The last export is ${qa.fps} fps, the timeline is ${ref.canvas.fps} fps` });
    // Intentional black (fade_black effects, dip-to-black transitions) is not a defect.
    const intendedBlack: Array<[number, number]> = [
      ...((ref as any).effects || []).filter((e: any) => e.type === "fade_black").map((e: any) => [e.startMs, e.endMs] as [number, number]),
      ...ref.clips.filter((c) => c.transitionIn?.type === "DIP_BLACK").map((c) => [c.timelineStartMs - (c.transitionIn!.durationMs || 0), c.timelineStartMs + (c.transitionIn!.durationMs || 0)] as [number, number]),
    ];
    const black = qa.blackRangesMs.filter((r) => !intendedBlack.some((b) => overlapMs(r, b) >= (r[1] - r[0]) * 0.5));
    const blackMs = black.reduce((a, r) => a + Math.max(0, r[1] - r[0]), 0);
    if (blackMs >= T.blackMaxMs) add({ id: `export_black`, severity: "CRITICAL", category: "EXPORT", title: `The last export has ${sec(blackMs)} of unexpected black frames`, timeRangeMs: black[0] });
    // Still photos hold a frame on purpose.
    const stills: Array<[number, number]> = (ref.overlays || []).filter((o: any) => o.mediaType === "image").map((o) => [o.timelineStartMs, o.timelineEndMs] as [number, number]);
    for (const r of qa.frozenRangesMs) {
      if (r[1] - r[0] < T.frozenMaxMs) continue;
      if (stills.some((s) => overlapMs(r, s) >= (r[1] - r[0]) * 0.5)) continue;
      add({ id: `export_frozen:${r[0]}`, severity: "WARNING", category: "EXPORT", title: `The last export freezes for ${sec(r[1] - r[0])} at ${sec(r[0])}`, timeRangeMs: r });
    }
    if (qa.integratedLufs != null && (qa.integratedLufs > T.loudLufs || qa.integratedLufs < T.quietLufs)) {
      add({ id: `export_loudness`, severity: "WARNING", category: "EXPORT", title: `The last export is ${qa.integratedLufs} LUFS (social platforms expect about -14)` });
    }
    if (qa.clippingPct != null && qa.clippingPct > T.clippingPct) add({ id: `export_clipping`, severity: "WARNING", category: "EXPORT", title: `${qa.clippingPct}% of the exported audio clips` });
  }

  const n = (s: CritiqueSeverity) => issues.filter((i) => i.severity === s).length;
  const score = Math.max(0, Math.min(100, 100 - 20 * n("CRITICAL") - 7 * n("WARNING") - 2 * n("SUGGESTION")));
  return { score, issues, repairable: Array.from(repairable) };
}
