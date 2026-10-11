/**
 * Desktop media intelligence + post-export QA: the FFmpeg command lines (mirrors of apps/desktop-app/src-tauri/src/
 * analysis.rs) and the parsers for their reports. Pure functions: the desktop app runs FFmpeg, this turns the report
 * into the director's `media.scenesMs` / `media.loudness` and `lastExportQa` shapes, and QA issues for the UI.
 *
 * Nothing here invents a value: a measurement that FFmpeg did not report stays undefined.
 * Verified against the real bundled FFmpeg in tests/integration/media-analysis.integration.ts and the E2E.
 */
import type { EditIR } from "@workspace/video-contracts";

export type AnalysisKind = "scenes" | "loudness" | "qa" | "qa_nofreeze";
export type RangeMs = [number, number];

export const DEFAULT_SCENE_THRESHOLD = 0.3;

const LOUD = "ebur128=peak=true:framelog=verbose,astats=metadata=0";

/** Same clamp as analysis.rs `clamp_threshold`. */
export function clampSceneThreshold(t?: number): number {
  const v = t ?? DEFAULT_SCENE_THRESHOLD;
  return Number.isFinite(v) ? Math.min(0.9, Math.max(0.1, v)) : DEFAULT_SCENE_THRESHOLD;
}

/** The fixed FFmpeg arguments for one analysis (analysis.rs `build_analysis_args`; keep in sync). */
export function analysisArgs(kind: AnalysisKind, input: string, sceneThreshold?: number): string[] {
  const a = ["-hide_banner", "-nostats", "-loglevel", "info", "-progress", "pipe:1", "-i", input];
  if (kind === "scenes") {
    a.push("-an", "-sn", "-dn", "-vf", `scale=160:-2,select='gt(scene,${clampSceneThreshold(sceneThreshold).toFixed(2)})',showinfo`);
  } else if (kind === "loudness") {
    a.push("-vn", "-sn", "-dn", "-af", LOUD);
  } else {
    // qa_nofreeze: builds without freezedetect measure frozen picture with mpdecimate + showinfo instead.
    const vf = kind === "qa" ? "blackdetect=d=0.1:pix_th=0.10,freezedetect=n=-60dB:d=0.5" : "blackdetect=d=0.1:pix_th=0.10,mpdecimate,showinfo";
    a.push("-sn", "-dn", "-vf", vf, "-af", LOUD);
  }
  a.push("-f", "null", "-");
  return a;
}

const KEEP_KEYS = [
  "Duration:", "pts_time:", "black_start:", "freeze_start", "freeze_end", "Integrated loudness", " I:", "True peak",
  "Peak:", "Parsed_astats", "No such filter", "does not contain any stream", "matches no streams", "Stream #0",
  "Error", "Invalid",
];

/** analysis.rs `keep_line`: only the lines the parsers read survive. */
export function keepAnalysisLine(line: string): boolean {
  return KEEP_KEYS.some((k) => line.includes(k));
}

export function filterReport(stderr: string): string {
  return stderr.split(/\r?\n/).filter(keepAnalysisLine).join("\n");
}

/** True when the FFmpeg build lacks `freezedetect` (then QA reruns as `qa_nofreeze`). */
export function missingFilter(report: string, name: string): boolean {
  return new RegExp(`No such filter: '${name}'`).test(report);
}

// ── parsers ────────────────────────────────────────────────────────────────────

const num = (s: string | undefined): number | undefined => {
  if (s == null) return undefined;
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : undefined;
};

/** `Duration: HH:MM:SS.xx` of the (first) input, in ms. */
export function parseDurationMs(report: string): number | undefined {
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(report);
  if (!m) return undefined;
  return Math.round((parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseFloat(m[3])) * 1000);
}

/**
 * Scene-cut times (ms) from `select=gt(scene,T),showinfo`. Cuts closer than `minGapMs` to the previous one are merged
 * (a flash or a fast pan can score twice), and a "cut" at 0 is dropped (the first frame is not a cut).
 */
export function parseSceneCutsMs(report: string, minGapMs = 400): number[] {
  const out: number[] = [];
  for (const m of report.matchAll(/Parsed_showinfo[^\n]*?pts_time:\s*([0-9.]+)/g)) {
    const t = Math.round(parseFloat(m[1]) * 1000);
    if (!Number.isFinite(t) || t <= 0) continue;
    if (out.length && t - out[out.length - 1] < minGapMs) continue;
    out.push(t);
  }
  return out;
}

export interface LoudnessReport {
  integratedLufs: number;
  truePeakDb?: number;
  /** Share of samples at digital full scale (|x| >= -0.1 dBFS peak), in percent. */
  clippingPct?: number;
  audioChannels?: number;
}

/**
 * ebur128 summary (integrated loudness, true peak) + astats (per-channel peak level / peak count) → loudness.
 * Returns null when the report has no ebur128 summary (no audio stream).
 */
export function parseLoudness(report: string): LoudnessReport | null {
  const summary = report.slice(Math.max(0, report.lastIndexOf("Integrated loudness")));
  const i = /\bI:\s*(-?[0-9.]+|-inf)\s*LUFS/.exec(summary);
  if (!report.includes("Integrated loudness") || !i) return null;
  const integratedLufs = i[1] === "-inf" ? -70 : num(i[1]);
  if (integratedLufs == null) return null;
  const tp = /True peak:[\s\S]*?Peak:\s*(-?[0-9.]+|-inf)\s*dBFS/.exec(summary);
  const truePeakDb = tp ? (tp[1] === "-inf" ? -120 : num(tp[1])) : undefined;

  // astats: per-channel blocks ("Channel: N" … "Peak level dB" … "Peak count"), then "Overall" with "Number of samples".
  const lines = report.split(/\r?\n/).filter((l) => l.includes("Parsed_astats"));
  const channels: Array<{ peakDb?: number; peakCount?: number }> = [];
  let inOverall = false;
  let samplesPerChannel: number | undefined;
  for (const l of lines) {
    const body = l.replace(/^.*?\]\s*/, "");
    if (/^Channel:\s*\d+/.test(body)) {
      channels.push({});
      inOverall = false;
    } else if (/^Overall/.test(body)) inOverall = true;
    else if (inOverall) {
      const n = /^Number of samples:\s*([0-9.]+)/.exec(body);
      if (n) samplesPerChannel = num(n[1]);
    } else if (channels.length) {
      const cur = channels[channels.length - 1];
      const p = /^Peak level dB:\s*(-?[0-9.]+|-inf)/.exec(body);
      if (p) cur.peakDb = p[1] === "-inf" ? -Infinity : num(p[1]);
      const c = /^Peak count:\s*([0-9.]+)/.exec(body);
      if (c) cur.peakCount = num(c[1]);
    }
  }
  let clippingPct: number | undefined;
  if (channels.length && samplesPerChannel && channels.every((c) => c.peakDb != null && c.peakCount != null)) {
    const clipped = channels.reduce((n, c) => n + ((c.peakDb as number) >= -0.1 ? (c.peakCount as number) : 0), 0);
    clippingPct = Math.round((clipped / (samplesPerChannel * channels.length)) * 100 * 10000) / 10000;
  }
  return {
    integratedLufs,
    ...(truePeakDb != null ? { truePeakDb } : {}),
    ...(clippingPct != null ? { clippingPct } : {}),
    ...(channels.length ? { audioChannels: channels.length } : {}),
  };
}

/** blackdetect → [[startMs, endMs]]. */
export function parseBlackRangesMs(report: string): RangeMs[] {
  const out: RangeMs[] = [];
  for (const m of report.matchAll(/black_start:\s*([0-9.]+)\s+black_end:\s*([0-9.]+)/g)) {
    const s = Math.round(parseFloat(m[1]) * 1000);
    const e = Math.round(parseFloat(m[2]) * 1000);
    if (e > s) out.push([s, e]);
  }
  return out;
}

/** freezedetect → [[startMs, endMs]]; a freeze still open at the end of the file closes at `durationMs`. */
export function parseFrozenRangesMs(report: string, durationMs?: number): RangeMs[] {
  const out: RangeMs[] = [];
  let open: number | null = null;
  for (const m of report.matchAll(/freezedetect\.freeze_(start|end):\s*([0-9.]+)/g)) {
    const t = Math.round(parseFloat(m[2]) * 1000);
    if (m[1] === "start") open = t;
    else if (open != null) {
      if (t > open) out.push([open, t]);
      open = null;
    }
  }
  if (open != null && durationMs != null && durationMs > open) out.push([open, durationMs]);
  return out;
}

/**
 * Frozen picture from `mpdecimate,showinfo` (the qa_nofreeze pass): the frames that survive decimation are the ones
 * that changed, so a gap of `minMs` or more between two kept frames (or from the last one to the end) is a freeze.
 */
export function parseFrozenFromDecimate(report: string, durationMs: number, minMs = 500): RangeMs[] {
  const kept = [...report.matchAll(/Parsed_showinfo[^\n]*?pts_time:\s*([0-9.]+)/g)].map((m) => Math.round(parseFloat(m[1]) * 1000)).filter(Number.isFinite);
  const out: RangeMs[] = [];
  const points = [...kept, durationMs];
  for (let i = 1; i < points.length; i++) {
    if (points[i] - points[i - 1] >= minMs) out.push([points[i - 1], points[i]]);
  }
  return out;
}

// ── director payloads ─────────────────────────────────────────────────────────

/** What the desktop sends with a director turn (web route: inside `telemetry`, see tauri-bridge). */
export interface DesktopMediaAnalysis {
  scenesMs?: number[];
  loudness?: { integratedLufs: number; truePeakDb?: number; clippingPct?: number };
}

/** The shared-contract `lastExportQa` block (LastExportQaSchema in @workspace/video-contracts). */
export interface LastExportQa {
  durationMs: number;
  width: number;
  height: number;
  fps?: number;
  hasAudio: boolean;
  audioChannels?: number;
  blackRangesMs: RangeMs[];
  frozenRangesMs: RangeMs[];
  integratedLufs?: number;
  clippingPct?: number;
}

type Probe = { format?: Record<string, any>; streams?: Array<Record<string, any>> };

function parseRate(r: unknown): number | undefined {
  if (typeof r !== "string") return undefined;
  const [n, d] = r.split("/").map(Number);
  if (!n || !d) return undefined;
  return Math.round((n / d) * 1000) / 1000;
}

/**
 * ffprobe JSON + the QA report of the same file → `lastExportQa`. `freezeMethod` says which pass produced the report:
 * "freezedetect" (qa) or "mpdecimate" (qa_nofreeze).
 */
export function exportQaFromReports(probe: Probe, qaReport: string, freezeMethod: "freezedetect" | "mpdecimate" = "freezedetect"): LastExportQa {
  const v = (probe.streams || []).find((s) => s.codec_type === "video");
  const a = (probe.streams || []).find((s) => s.codec_type === "audio");
  const durSec = num(String(probe.format?.duration ?? "")) ?? num(String(v?.duration ?? ""));
  const durationMs = durSec != null ? Math.round(durSec * 1000) : parseDurationMs(qaReport) ?? 0;
  const loud = a ? parseLoudness(qaReport) : null;
  return {
    durationMs,
    width: Number(v?.width) || 0,
    height: Number(v?.height) || 0,
    ...(parseRate(v?.avg_frame_rate) ?? parseRate(v?.r_frame_rate) ? { fps: parseRate(v?.avg_frame_rate) ?? parseRate(v?.r_frame_rate) } : {}),
    hasAudio: !!a,
    ...(a ? { audioChannels: Number(a.channels) || loud?.audioChannels } : {}),
    blackRangesMs: parseBlackRangesMs(qaReport),
    frozenRangesMs: freezeMethod === "freezedetect" ? parseFrozenRangesMs(qaReport, durationMs) : parseFrozenFromDecimate(qaReport, durationMs),
    ...(loud ? { integratedLufs: loud.integratedLufs } : {}),
    ...(loud?.clippingPct != null ? { clippingPct: loud.clippingPct } : {}),
  };
}

// ── QA → issues ──────────────────────────────────────────────────────────────

export type QaSeverity = "critical" | "warning" | "info";
export interface QaIssue {
  id: string;
  severity: QaSeverity;
  category: "video" | "audio" | "format";
  title: string;
  timeRangeMs?: RangeMs;
}

export interface QaExpectations {
  durationMs?: number;
  width?: number;
  height?: number;
  /** The timeline has sound (so the export must have an audio stream). */
  hasAudio?: boolean;
  /** Ranges where black is intended (dip-to-black transitions, fade_black effects, empty gaps the user left). */
  intendedBlackRangesMs?: RangeMs[];
  /** Ranges where a still picture is intended (photos, freeze frames). */
  intendedStillRangesMs?: RangeMs[];
}

const overlapMs = (a: RangeMs, b: RangeMs) => Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]));
/** The part of `r` not covered by `allowed` (ms). */
function uncoveredMs(r: RangeMs, allowed: RangeMs[] = []): number {
  const covered = allowed.reduce((n, a) => n + overlapMs(r, a), 0);
  return Math.max(0, r[1] - r[0] - covered);
}
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** Social-platform loudness window (streaming platforms normalise to about -14 LUFS). */
export const LOUDNESS_TOO_QUIET_LUFS = -24;
export const LOUDNESS_TOO_LOUD_LUFS = -9;

/** Turns a measured export into issues the user (and the AI Director) can act on. Only measured facts are reported. */
export function qaIssues(qa: LastExportQa, expect: QaExpectations = {}): QaIssue[] {
  const issues: QaIssue[] = [];
  if (expect.durationMs != null && Math.abs(qa.durationMs - expect.durationMs) > 250) {
    issues.push({ id: "duration", severity: "warning", category: "format", title: `Duration is ${secs(qa.durationMs)}, the timeline is ${secs(expect.durationMs)}` });
  }
  if (expect.width && expect.height && (qa.width !== expect.width || qa.height !== expect.height)) {
    issues.push({ id: "resolution", severity: "critical", category: "format", title: `Resolution is ${qa.width}x${qa.height}, expected ${expect.width}x${expect.height}` });
  }
  if (expect.hasAudio && !qa.hasAudio) {
    issues.push({ id: "no-audio", severity: "critical", category: "audio", title: "The export has no audio, but the timeline does" });
  }
  qa.blackRangesMs.forEach((r, i) => {
    const bad = uncoveredMs(r, expect.intendedBlackRangesMs);
    if (bad >= 100) issues.push({ id: `black-${i}`, severity: bad >= 500 ? "critical" : "warning", category: "video", title: `Black frames for ${secs(r[1] - r[0])}`, timeRangeMs: r });
  });
  qa.frozenRangesMs.forEach((r, i) => {
    // black frames are also "frozen"; they are reported (or intended) as black, not twice
    const bad = uncoveredMs(r, [...(expect.intendedStillRangesMs ?? []), ...qa.blackRangesMs, ...(expect.intendedBlackRangesMs ?? [])]);
    if (bad >= 1000) issues.push({ id: `frozen-${i}`, severity: "warning", category: "video", title: `Picture frozen for ${secs(r[1] - r[0])}`, timeRangeMs: r });
  });
  if (qa.hasAudio && qa.integratedLufs != null) {
    if (qa.integratedLufs < LOUDNESS_TOO_QUIET_LUFS) {
      issues.push({ id: "too-quiet", severity: "warning", category: "audio", title: `Audio is quiet (${qa.integratedLufs.toFixed(1)} LUFS; aim for about -14)` });
    } else if (qa.integratedLufs > LOUDNESS_TOO_LOUD_LUFS) {
      issues.push({ id: "too-loud", severity: "warning", category: "audio", title: `Audio is very loud (${qa.integratedLufs.toFixed(1)} LUFS; aim for about -14)` });
    }
  }
  if (qa.clippingPct != null && qa.clippingPct > 0.01) {
    issues.push({ id: "clipping", severity: qa.clippingPct > 1 ? "critical" : "warning", category: "audio", title: `Audio clips (${qa.clippingPct.toFixed(2)}% of samples at full scale)` });
  }
  return issues;
}

// ── expectations from the timeline ────────────────────────────────────────────

const toMs = (t: { value: number; timescale: number }) => Math.round((t.value / t.timescale) * 1000);

/** What the export of `editIR` should look like: size, duration, audio, and where black / stills are intended. */
export function qaExpectationsFor(editIR: EditIR, opts: { width: number; height: number; durationSec: number; hasAudio: boolean }): QaExpectations {
  const black: RangeMs[] = [];
  const still: RangeMs[] = [];
  const main = editIR.tracks.videoTracks.find((t) => t.type === "MAIN_VIDEO") ?? editIR.tracks.videoTracks[0];
  const totalMs = Math.round(opts.durationSec * 1000);
  // gaps in the main track render as the background colour
  const mainRanges = (main?.clips ?? []).map((c) => [toMs(c.timelineRange.start), toMs(c.timelineRange.start) + toMs(c.timelineRange.duration)] as RangeMs).sort((a, b) => a[0] - b[0]);
  let cursor = 0;
  for (const [s, e] of mainRanges) {
    if (s > cursor + 50) black.push([cursor, s]);
    cursor = Math.max(cursor, e);
  }
  if (totalMs > cursor + 50) black.push([cursor, totalMs]);
  for (const t of editIR.tracks.videoTracks) {
    for (const c of t.clips) {
      const s = toMs(c.timelineRange.start);
      const e = s + toMs(c.timelineRange.duration);
      if (c.mediaType === "image") still.push([s, e]);
      for (const tr of [c.transitionIn, c.transitionOut]) {
        if (tr && (tr.type === "DIP_BLACK" || tr.type === "DIP_WHITE")) {
          const d = toMs(tr.duration);
          const at = tr === c.transitionIn ? s : e;
          black.push([at - d, at + d]);
        }
      }
    }
  }
  for (const fx of editIR.tracks.effectTrack ?? []) {
    if (fx.type === "fade_black") black.push([toMs(fx.timeRange.start), toMs(fx.timeRange.start) + toMs(fx.timeRange.duration)]);
  }
  return { durationMs: totalMs, width: opts.width, height: opts.height, hasAudio: opts.hasAudio, intendedBlackRangesMs: black, intendedStillRangesMs: still };
}
