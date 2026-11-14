/**
 * Style playbooks (AI Director quality-fix plan, Phase 6): choose one per edit, put only it in the prompt, measure the
 * finished edit against its targets.
 */
import type { EditIR } from "../edit-ir.schema";
import { deriveEditStyle } from "../edit-style";
import { RationalTimeMath } from "../time";
import { CALM_EDUCATIONAL, CINEMATIC_VLOG, FAST_HYPE, PODCAST_CLIP, STYLE_PLAYBOOKS } from "./playbooks";
import type { PlaybookId, Range, StylePlaybook } from "./types";

export * from "./types";
export { CALM_EDUCATIONAL, CINEMATIC_VLOG, FAST_HYPE, PODCAST_CLIP, STYLE_PLAYBOOKS } from "./playbooks";

export const playbookById = (id: PlaybookId | string): StylePlaybook | undefined => STYLE_PLAYBOOKS.find((p) => p.id === id);

/**
 * The playbook for a request. The creator's words win (content words before energy words: "a punchy travel vlog" is
 * a vlog cut fast, not a talking-head hype edit); then what the clip is (two speakers → podcast, a screen recording →
 * calm); then the brand's pacing; then the canvas (9:16 → fast, else calm).
 */
export function choosePlaybook(p: {
  prompt: string;
  brandPacing?: "fast" | "balanced" | "calm";
  speakers?: number;
  screenRecording?: boolean;
  aspect?: string;
}): { playbook: StylePlaybook; reason: string } {
  const text = p.prompt || "";
  for (const pb of [PODCAST_CLIP, CINEMATIC_VLOG, CALM_EDUCATIONAL, FAST_HYPE]) {
    const m = pb.matches.exec(text);
    if (m) return { playbook: pb, reason: `the request says "${m[0]}"` };
  }
  if ((p.speakers ?? 0) >= 2) return { playbook: PODCAST_CLIP, reason: `${p.speakers} speakers` };
  if (p.screenRecording) return { playbook: CALM_EDUCATIONAL, reason: "a screen recording" };
  if (p.brandPacing === "fast") return { playbook: FAST_HYPE, reason: "the brand's pacing is fast" };
  if (p.brandPacing === "calm") return { playbook: CALM_EDUCATIONAL, reason: "the brand's pacing is calm" };
  return p.aspect === "9:16" || p.aspect === "4:5"
    ? { playbook: FAST_HYPE, reason: "a vertical short" }
    : { playbook: CALM_EDUCATIONAL, reason: "a horizontal video" };
}

const r = (x: Range, unit = "") => `${x[0]}-${x[1]}${unit}`;

/** The playbook as system-prompt lines (only the chosen one is ever sent). */
export function playbookPromptLines(pb: StylePlaybook): string[] {
  const t = pb.targets;
  return [
    `## Style for this edit: ${pb.label} (playbook ${pb.id} v${pb.version}; how you edit, never recite it to the creator)`,
    ...pb.craft.map((c) => `- ${c}`),
    `Targets (the finished edit is measured against them):`,
    `- something changes on screen at least every ${t.maxStaticSec} s; cuts ${r(t.cutsPerMin)}/min (pause cuts at ${t.pauseCutSec} s+)`,
    `- zooms ${r(t.zoomsPerMin)}/min at ${r(t.zoomScale, "x")}`,
    `- captions: template ${t.captionTemplate} (also fine: ${t.captionTemplatesOk.filter((x) => x !== t.captionTemplate).join(", ")})`,
    `- B-roll / layers ${r(t.brollPerMin)}/min, covering at most ${Math.round(t.brollMaxShare * 100)}% of the video`,
    `- music (if any) at ${r(t.musicDb, " dB")}, ducked under speech; sound effects ${r(t.sfxPerMin)}/min`,
    `Example of a great edit in this style:`,
    ...pb.examples.map((e) => `- ${e.input} → ${e.ops}`),
    `The creator's explicit words always win over these targets.`,
    ``,
  ];
}

/** Per-stage numbers for the agent loop (Phase 4 stages). */
export function playbookStageBriefs(pb: StylePlaybook): Record<string, string> {
  const t = pb.targets;
  return {
    cleanup: `Cut pauses of ${t.pauseCutSec} s or more and fillers (removeSilences minDurationSec ${t.pauseCutSec}); do not cut spoken lines the story kept.`,
    captions: `Captions with template ${t.captionTemplate}, clear of faces and the platform UI.`,
    framing: `Frame for the platform; ${r(t.zoomsPerMin)} zooms per minute at ${r(t.zoomScale, "x")}, centred on the subject, landing just before the key words.`,
    overlays: `B-roll / layers ${r(t.brollPerMin)} per minute, covering at most ${Math.round(t.brollMaxShare * 100)}% of the video, only over shots that can be covered; a hook title in the first 2 s.`,
    audio: `Music (if it fits the request) at ${r(t.musicDb, " dB")}, ducked under speech; sound effects ${r(t.sfxPerMin)} per minute.`,
    finish: `Nothing should stay static for more than ${t.maxStaticSec} s. Transitions only where they help; a colour grade if the footage needs it. Then call finish_edit.`,
  };
}

/** Longest stretch (s) of the timeline with no visual change (cut, zoom start/end, overlay start/end, title start). */
export function longestStaticSec(ir: EditIR): number {
  const sec = (t: any) => RationalTimeMath.toSeconds(t);
  const dur = sec(ir.meta.totalDuration);
  const ev: number[] = [0, dur];
  const main = ir.tracks.videoTracks.find((t) => t.type === "MAIN_VIDEO")?.clips ?? [];
  for (const c of main.slice(1)) ev.push(sec(c.timelineRange.start));
  for (const z of ir.tracks.cameraTrack) ev.push(sec(z.timeRange.start), sec(z.timeRange.start) + sec(z.timeRange.duration));
  for (const o of ir.tracks.videoTracks.filter((t) => t.type !== "MAIN_VIDEO").flatMap((t) => t.clips)) {
    ev.push(sec(o.timelineRange.start), sec(o.timelineRange.start) + sec(o.timelineRange.duration));
  }
  for (const c of ir.tracks.captionTrack.filter((c) => c.role === "title")) ev.push(sec(c.timeRange.start));
  const s = [...new Set(ev.map((x) => Math.round(x * 100) / 100))].filter((x) => x >= 0 && x <= dur).sort((a, b) => a - b);
  let max = 0;
  for (let i = 1; i < s.length; i++) max = Math.max(max, s[i] - s[i - 1]);
  return Math.round(max * 100) / 100;
}

export interface PlaybookCheck {
  metric: string;
  value: number | string | null;
  target: string;
  ok: boolean;
}

export interface PlaybookReport {
  playbookId: PlaybookId;
  version: string;
  checks: PlaybookCheck[];
  met: number;
  total: number;
}

/** Share of the runtime covered by B-roll / layers (overlaps counted once). */
function overlayShare(ir: EditIR): number {
  const sec = (t: any) => RationalTimeMath.toSeconds(t);
  const dur = sec(ir.meta.totalDuration);
  if (dur <= 0) return 0;
  const spans = ir.tracks.videoTracks
    .filter((t) => t.type !== "MAIN_VIDEO")
    .flatMap((t) => t.clips)
    .map((o) => [sec(o.timelineRange.start), sec(o.timelineRange.start) + sec(o.timelineRange.duration)] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  let covered = 0;
  let end = -1;
  for (const [a, b] of spans) {
    if (b <= end) continue;
    covered += b - Math.max(a, end);
    end = b;
  }
  return Math.round((covered / dur) * 100) / 100;
}

/**
 * The finished edit against its playbook. Ranges are met within ±tolerance (25% by default); per-minute rates are
 * only judged on videos of 20 s or more (shorter ones make rates noise).
 */
export function measurePlaybook(ir: EditIR, pb: StylePlaybook, tolerance = 0.25): PlaybookReport {
  const f = deriveEditStyle(ir);
  const t = pb.targets;
  const checks: PlaybookCheck[] = [];
  const within = (v: number, [a, b]: Range) => v >= a * (1 - tolerance) && v <= b * (1 + tolerance) + (b === 0 ? tolerance : 0);
  const staticSec = longestStaticSec(ir);
  checks.push({ metric: "longest static stretch (s)", value: staticSec, target: `≤ ${t.maxStaticSec}`, ok: staticSec <= t.maxStaticSec * (1 + tolerance) });
  if (f.durationSec >= 20) {
    checks.push({ metric: "cuts per minute", value: f.cutsPerMin, target: r(t.cutsPerMin), ok: within(f.cutsPerMin, t.cutsPerMin) });
    checks.push({ metric: "zooms per minute", value: f.zoomsPerMin, target: r(t.zoomsPerMin), ok: within(f.zoomsPerMin, t.zoomsPerMin) });
    checks.push({ metric: "B-roll per minute", value: f.brollPerMin, target: r(t.brollPerMin), ok: within(f.brollPerMin, t.brollPerMin) });
    checks.push({ metric: "sound effects per minute", value: f.sfxPerMin, target: r(t.sfxPerMin), ok: within(f.sfxPerMin, t.sfxPerMin) });
  }
  if (f.avgZoomScale != null) checks.push({ metric: "zoom scale", value: f.avgZoomScale, target: r(t.zoomScale, "x"), ok: within(f.avgZoomScale, t.zoomScale) });
  const share = overlayShare(ir);
  checks.push({ metric: "B-roll share of runtime", value: share, target: `≤ ${t.brollMaxShare}`, ok: share <= t.brollMaxShare * (1 + tolerance) });
  if (f.music) {
    checks.push({ metric: "music level (dB)", value: f.music.volumeDb, target: r(t.musicDb, " dB"), ok: f.music.volumeDb >= t.musicDb[0] - 3 && f.music.volumeDb <= t.musicDb[1] + 3 });
    checks.push({ metric: "music ducked", value: f.music.ducked ? "yes" : "no", target: "yes", ok: f.music.ducked });
  }
  if (f.captions) {
    const preset = (f.captions.preset || "").toUpperCase().replace(/[^A-Z_]/g, "_");
    const ok = t.captionTemplatesOk.some((x) => preset.includes(x));
    checks.push({ metric: "caption template", value: f.captions.preset || null, target: t.captionTemplatesOk.join(" | "), ok });
  }
  return { playbookId: pb.id, version: pb.version, checks, met: checks.filter((c) => c.ok).length, total: checks.length };
}
