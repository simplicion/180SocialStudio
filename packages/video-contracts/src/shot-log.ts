import { z } from "zod";
import { fenceUntrusted, sanitizeInlineUntrusted } from "./untrusted-content";

/**
 * ShotLog (AI Director quality-fix plan, Phase 2): what a vision model saw in a few still frames of one source file.
 *
 * The phone extracts ~60 small JPEG stills per clip (one per scene + one every ~2 s, 512 px) and, only with the
 * creator's consent, sends them to `POST /media-editor/vision/shot-log`. The server describes them with a vision model
 * IN THAT REQUEST and returns this log; the stills are never stored. The phone caches the log by source hash and sends
 * it with each Director turn (`media.shotLog`), like the transcript. All times are SOURCE ms of that file.
 *
 * Model-written text (descriptions, labels, on-screen text) is untrusted data: fenced and sanitised in prompts.
 */

const ms = z.number().int().nonnegative().max(4 * 60 * 60 * 1000);
const unit = z.number().min(0).max(1);

export const SHOT_FRAMINGS = ["extreme_wide", "wide", "medium", "close", "extreme_close", "screen", "other"] as const;
export const SHOT_CAMERA_MOTIONS = ["static", "pan", "tilt", "zoom", "handheld", "tracking", "unknown"] as const;
export const SHOT_QUALITY_ISSUES = ["blur", "dark", "overexposed", "shaky", "noisy", "low_contrast", "obstructed"] as const;
export const SHOT_ENERGIES = ["low", "medium", "high"] as const;

/** A subject in the frame: box of the visible subject, x/y = TOP-LEFT corner, as 0..1 fractions of the upright frame. */
export const ShotSubjectSchema = z.object({
  label: z.string().trim().min(1).max(40),
  box: z.object({ x: unit, y: unit, w: unit, h: unit }),
  /** The main subject of the frame (the speaker, the product, the screen area being discussed). */
  primary: z.boolean().optional(),
});
export type ShotSubject = z.infer<typeof ShotSubjectSchema>;

/** What the vision model reports for ONE still frame (the model's tool output, validated). */
export const FrameObservationSchema = z.object({
  /** Index of the frame in the batch as given to the model. */
  index: z.number().int().nonnegative().max(500),
  description: z.string().trim().max(300),
  subjects: z.array(ShotSubjectSchema).max(6).default([]),
  framing: z.enum(SHOT_FRAMINGS).catch("other"),
  cameraMotion: z.enum(SHOT_CAMERA_MOTIONS).catch("unknown"),
  quality: z.array(z.enum(SHOT_QUALITY_ISSUES)).max(7).catch([]).default([]),
  onScreenText: z.string().trim().max(200).optional(),
  /** 0 = this frame must stay on screen (a face speaking, the key action); 1 = fine to cover with B-roll. */
  brollSuitability: unit.catch(0.5),
  energy: z.enum(SHOT_ENERGIES).catch("medium"),
});
export type FrameObservation = z.infer<typeof FrameObservationSchema>;

export const ShotSchema = z.object({
  startMs: ms,
  endMs: ms,
  description: z.string().trim().max(300),
  subjects: z.array(ShotSubjectSchema).max(6),
  framing: z.enum(SHOT_FRAMINGS),
  cameraMotion: z.enum(SHOT_CAMERA_MOTIONS),
  quality: z.array(z.enum(SHOT_QUALITY_ISSUES)).max(7),
  onScreenText: z.string().trim().max(200).optional(),
  brollSuitability: unit,
  energy: z.enum(SHOT_ENERGIES),
});
export type Shot = z.infer<typeof ShotSchema>;

export const ShotLogSchema = z.object({
  version: z.literal("shotlog/1"),
  assetId: z.string().min(1).max(128),
  /** Hash of the source file the phone computed (cache key). */
  sourceHash: z.string().min(8).max(128),
  durationMs: ms,
  /** provider/model that looked at the frames. */
  model: z.string().max(120),
  frameCount: z.number().int().nonnegative().max(200),
  shots: z.array(ShotSchema).max(300),
});
export type ShotLog = z.infer<typeof ShotLogSchema>;

/** Most frames one vision request takes (the phone caps at 60). */
export const MAX_SHOTLOG_FRAMES = 60;
/** A shot longer than this (no scene cut) is split so subject positions stay current. */
export const MAX_SHOT_MS = 8000;

/**
 * Frame times the phone extracts: one shortly after each scene cut, plus one every [everyMs], capped at [max]
 * (evenly thinned). Sorted, unique to 250 ms.
 */
export function keyframeTimesMs(durationMs: number, scenesMs: number[] = [], opts: { everyMs?: number; max?: number } = {}): number[] {
  const every = opts.everyMs ?? 2000;
  const max = Math.max(1, Math.min(MAX_SHOTLOG_FRAMES, opts.max ?? MAX_SHOTLOG_FRAMES));
  const end = Math.max(0, durationMs - 100);
  const raw = [
    ...scenesMs.filter((t) => t >= 0 && t < end).map((t) => Math.min(end, t + 300)),
    ...Array.from({ length: Math.floor(end / every) + 1 }, (_, i) => Math.min(end, i * every + Math.min(500, every / 2))),
  ].sort((a, b) => a - b);
  const uniq: number[] = [];
  for (const t of raw) if (!uniq.length || t - uniq[uniq.length - 1] >= 250) uniq.push(Math.round(t));
  if (uniq.length <= max) return uniq;
  // Keep every scene's first frame where possible: thin evenly over the sorted list.
  const step = uniq.length / max;
  return Array.from({ length: max }, (_, i) => uniq[Math.floor(i * step)]);
}

/**
 * Groups frame observations into shots: boundaries at the scene cuts (and the clip ends), long shots split at
 * MAX_SHOT_MS. Each shot takes the frame nearest its middle for description/subjects/framing, and the union of the
 * quality issues of its frames. Deterministic: the model only describes frames.
 */
export function shotsFromObservations(
  frames: Array<{ tMs: number; obs: FrameObservation }>,
  durationMs: number,
  scenesMs: number[] = []
): Shot[] {
  const sorted = [...frames].sort((a, b) => a.tMs - b.tMs);
  if (!sorted.length || durationMs <= 0) return [];
  const cuts = [...new Set([0, ...scenesMs.filter((t) => t > 0 && t < durationMs), durationMs])].sort((a, b) => a - b);
  const bounds: Array<[number, number]> = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const [a, b] = [cuts[i], cuts[i + 1]];
    const n = Math.max(1, Math.ceil((b - a) / MAX_SHOT_MS));
    for (let k = 0; k < n; k++) bounds.push([Math.round(a + ((b - a) * k) / n), Math.round(a + ((b - a) * (k + 1)) / n)]);
  }
  const shots: Shot[] = [];
  for (const [a, b] of bounds) {
    const inside = sorted.filter((f) => f.tMs >= a && f.tMs < b);
    const mid = (a + b) / 2;
    // No frame inside: the nearest frame describes it (a short shot between two samples).
    const pool = inside.length ? inside : [sorted.reduce((best, f) => (Math.abs(f.tMs - mid) < Math.abs(best.tMs - mid) ? f : best))];
    const rep = pool.reduce((best, f) => (Math.abs(f.tMs - mid) < Math.abs(best.tMs - mid) ? f : best));
    const quality = [...new Set(pool.flatMap((f) => f.obs.quality))] as Shot["quality"];
    const energyRank = { low: 0, medium: 1, high: 2 } as const;
    const energy = pool.reduce((e, f) => (energyRank[f.obs.energy] > energyRank[e] ? f.obs.energy : e), rep.obs.energy);
    shots.push({
      startMs: a,
      endMs: b,
      description: rep.obs.description,
      subjects: rep.obs.subjects,
      framing: rep.obs.framing,
      cameraMotion: pool.find((f) => f.obs.cameraMotion !== "unknown" && f.obs.cameraMotion !== "static")?.obs.cameraMotion ?? rep.obs.cameraMotion,
      quality,
      ...(rep.obs.onScreenText ? { onScreenText: rep.obs.onScreenText } : {}),
      brollSuitability: Math.round((pool.reduce((s, f) => s + f.obs.brollSuitability, 0) / pool.length) * 100) / 100,
      energy,
    });
  }
  return shots;
}

/** The main subject of a shot (the one marked primary, else the largest). */
export function primarySubject(shot: Pick<Shot, "subjects">): ShotSubject | null {
  if (!shot.subjects.length) return null;
  return shot.subjects.find((s) => s.primary) ?? shot.subjects.reduce((a, b) => (b.box.w * b.box.h > a.box.w * a.box.h ? b : a));
}

/**
 * Face-track-shaped samples (centre x/y + size, every shot's middle) from the ShotLog's main subjects, for sources
 * that have no on-device face track (screen recordings, objects, people ML Kit missed). FACE zooms and moving crops
 * then centre on what the vision model saw instead of the frame centre.
 */
export function subjectSamplesFromShotLog(log: Pick<ShotLog, "shots">): Array<{ tMs: number; x: number; y: number; w: number; h: number }> {
  const out: Array<{ tMs: number; x: number; y: number; w: number; h: number }> = [];
  const c = (v: number) => Math.min(1, Math.max(0, Math.round(v * 10000) / 10000));
  for (const s of log.shots) {
    const p = primarySubject(s);
    if (!p) continue;
    const sample = { x: c(p.box.x + p.box.w / 2), y: c(p.box.y + p.box.h / 2), w: c(p.box.w), h: c(p.box.h) };
    // Like a face track: every 500 ms inside the shot, 150 ms away from its edges, so a zoom next to a cut takes the
    // subject of its own shot (samples on the edges mixed two shots' subjects).
    const from = s.startMs + Math.min(150, (s.endMs - s.startMs) / 4);
    const to = s.endMs - Math.min(150, (s.endMs - s.startMs) / 4);
    for (let t = from; t <= to; t += 500) out.push({ tMs: Math.round(t), ...sample });
    if (to - from < 500) out.push({ tMs: Math.round(to), ...sample });
  }
  return out.sort((a, b) => a.tMs - b.tMs).filter((x, i, all) => i === 0 || x.tMs !== all[i - 1].tMs);
}

const f2 = (v: number) => v.toFixed(2);

/**
 * The ShotLog as prompt lines for the Director (SOURCE seconds), fenced as untrusted data. One line per shot:
 * `0.0-6.0 medium static | person talking to camera | main: person centre (0.50,0.36) size 0.30x0.40 | others: laptop
 * (0.80,0.70) | text: "..." | issues: dark | b-roll ok 0.2 | energy medium`.
 */
export function shotLogPromptLines(log: Pick<ShotLog, "shots" | "frameCount" | "model">, maxShots = 80): string[] {
  const shots = log.shots.slice(0, maxShots);
  if (!shots.length) return [];
  const centre = (b: ShotSubject["box"]) => `(${f2(b.x + b.w / 2)},${f2(b.y + b.h / 2)})`;
  const lines = shots.map((s) => {
    const main = primarySubject(s);
    const others = s.subjects.filter((x) => x !== main).slice(0, 3);
    return [
      `${(s.startMs / 1000).toFixed(1)}-${(s.endMs / 1000).toFixed(1)} ${s.framing} ${s.cameraMotion}`,
      sanitizeInlineUntrusted(s.description, 300),
      main ? `main: ${sanitizeInlineUntrusted(main.label, 40)} centre ${centre(main.box)} size ${f2(main.box.w)}x${f2(main.box.h)}` : `main: none`,
      ...(others.length ? [`others: ${others.map((o) => `${sanitizeInlineUntrusted(o.label, 40)} ${centre(o.box)}`).join(", ")}`] : []),
      ...(s.onScreenText ? [`text: "${sanitizeInlineUntrusted(s.onScreenText, 200)}"`] : []),
      ...(s.quality.length ? [`issues: ${s.quality.join(", ")}`] : []),
      `b-roll ok ${s.brollSuitability.toFixed(1)}`,
      `energy ${s.energy}`,
    ].join(" | ");
  });
  return [
    `What the picture shows (a vision model looked at ${log.frameCount} stills of this source; SOURCE s; centres and sizes are 0..1 of the frame; use the main subject's centre as a zoom's targetCoords; cover only shots with a high "b-roll ok"; pick B-roll and stickers that fit what is shown):`,
    fenceUntrusted("vision", lines.join("\n"), { maxChars: 16000 }).block,
  ];
}
