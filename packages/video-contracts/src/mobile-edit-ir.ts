import { CAPTION_ANIMATIONS } from "./caption-templates";
import { z } from "zod";
import {
  EditIR, VideoClip, CaptionSegment, VIDEO_EFFECT_TYPES,
  TEXT_ENTER_TYPES, TEXT_EXIT_TYPES, TEXT_LOOP_TYPES, TextEnterSchema, TextExitSchema, TextLoopSchema, OverlayLayerSchema, ChromaKeySchema, LayerMaskSchema,
} from "./edit-ir.schema";
import { RationalTimeMath } from "./time";
import { ORIGINAL_AUDIO_TRACK_ID } from "./creative-plan.schema";
import { MobileWatermarkSchema, MobileWatermark } from "./director-context";

/**
 * MobileEditIR ("mobile-editir/1") — the millisecond, renderer-oriented projection of the
 * canonical rational-time EditIR. This is the exact subset the Android Media3 / iOS renderers
 * must support. Contract doc: docs/social-studio-mobile/AI_DIRECTOR_CONTRACT.md
 */

const ms = z.number().int().nonnegative();
const hex = z.string().regex(/^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/);
const aspect = z.enum(["16:9", "9:16", "1:1", "4:5"]);

export const MobileCropSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().gt(0).max(1),
  height: z.number().gt(0).max(1),
});

export const MobileFilterSchema = z.object({
  preset: z.string(),
  brightness: z.number(),
  contrast: z.number(),
  saturation: z.number(),
  /** Added 2026-10 (editor E2.1); absent = neutral. Exposure in stops; temperature/tint -1..1; vignette 0..1. */
  exposure: z.number().min(-2).max(2).optional(),
  temperature: z.number().min(-1).max(1).optional(),
  tint: z.number().min(-1).max(1).optional(),
  vignette: z.number().min(0).max(1).optional(),
});

/** Transitions the Android renderer draws natively (added 2026-09: dips, zooms, glitch); others map to CROSSFADE. */
export const MOBILE_TRANSITION_TYPES = ["CROSSFADE", "DISSOLVE", "CUT", "DIP_BLACK", "DIP_WHITE", "ZOOM_SWOOSH", "ZOOM_OUT", "GLITCH"] as const;

export const MobileTransitionSchema = z.object({
  type: z.enum(MOBILE_TRANSITION_TYPES),
  durationMs: ms,
});

export const MobileClipSchema = z.object({
  id: z.string().min(1),
  assetId: z.string().min(1),
  sourceStartMs: ms,
  sourceEndMs: ms,
  timelineStartMs: ms,
  timelineEndMs: ms,
  /** Same range the renderers (and the changeSpeed operation) accept. */
  speed: z.number().min(0.25).max(4),
  volumeDb: z.number(),
  crop: MobileCropSchema.nullable(),
  filter: MobileFilterSchema.nullable(),
  transitionIn: MobileTransitionSchema.nullable(),
  /** Clockwise rotation of the source, applied before `crop`. Absent = 0 (omitted on output when 0). */
  rotationDeg: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional(),
  /** Horizontal mirror, applied with the rotation before `crop`. Absent = false (omitted on output when false). */
  flipH: z.boolean().optional(),
  /** Fade of the clip's own sound at its start / end (added 2026-10, editor E2.2). Absent = 0. */
  audioFadeInMs: ms.optional(),
  audioFadeOutMs: ms.optional(),
  /** Reduce background noise on the clip's own sound (added 2026-10, editor E3). */
  voiceCleanup: z.boolean().optional(),
  /** On-device processing still to run (set by the AI Director; the phone clears it). */
  process: z.enum(["reverse", "stabilize"]).optional(),
});

export const MobileMediaSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("url"), url: z.string().url(), query: z.string().optional() }),
  z.object({ kind: z.literal("asset"), assetId: z.string().min(1) }),
  z.object({ kind: z.literal("stock_query"), query: z.string().min(1), url: z.null() }),
]);

export const MobileOverlaySchema = z.object({
  id: z.string().min(1),
  kind: z.literal("broll"),
  timelineStartMs: ms,
  timelineEndMs: ms,
  sourceStartMs: ms,
  source: MobileMediaSourceSchema,
  fit: z.enum(["cover", "contain"]),
  opacity: z.number().min(0).max(1),
  muted: z.boolean(),
  /** "image" = still photo held for the slot (added 2026-09). Absent = video. */
  mediaType: z.enum(["video", "image"]).optional(),
  /** Layer placement (added 2026-10). Absent = full-frame cutaway (the original behaviour). */
  layer: OverlayLayerSchema.optional(),
  /** Green / blue screen key on a layer (added 2026-10, editor E2.3). */
  chromaKey: ChromaKeySchema.optional(),
  mask: LayerMaskSchema.optional(),
  /** On-device processing still to run (set by the AI Director; the phone clears it). */
  process: z.enum(["remove_background"]).optional(),
});

/** Timeline effect (optional `effects`, added 2026-09); ids from VIDEO_EFFECT_TYPES. Older clients ignore it. */
export const MobileEffectSchema = z.object({
  id: z.string().min(1),
  type: z.enum(VIDEO_EFFECT_TYPES),
  startMs: ms,
  endMs: ms,
  intensity: z.number().min(0).max(1),
});
export type MobileEffect = z.infer<typeof MobileEffectSchema>;

export const MobileCaptionWordSchema = z.object({
  text: z.string(),
  startMs: ms,
  endMs: ms,
  highlight: z.boolean(),
  color: hex.nullable(),
  scale: z.number().positive(),
});

/** Text motion (CapCut-style in / out / loop). Evaluated identically by the phone preview and the Android renderer. */
export { TEXT_ENTER_TYPES, TEXT_EXIT_TYPES, TEXT_LOOP_TYPES };
export const MobileTextEnterSchema = TextEnterSchema;
export const MobileTextExitSchema = TextExitSchema;
export const MobileTextLoopSchema = TextLoopSchema;
export const MobileOverlayLayerSchema = OverlayLayerSchema;

export const MobileCaptionStyleSchema = z.object({
  preset: z.string(),
  animation: z.enum(CAPTION_ANIMATIONS),
  fontFamily: z.string(),
  fontWeight: z.number().int(),
  fontSizePx: z.number().positive(),
  textColor: hex,
  highlightColor: hex,
  strokeColor: hex,
  strokeWidthPx: z.number().nonnegative(),
  shadow: z.boolean(),
  background: z.object({ color: z.string(), paddingPx: z.number(), radiusPx: z.number() }).nullable(),
  uppercase: z.boolean(),
  positionX: z.number().min(0).max(1),
  positionY: z.number().min(0).max(1),
  maxWidthFraction: z.number().gt(0).max(1),
  /** Neon glow in the highlight colour (renderer-supported; kept so AI round-trips do not drop it). */
  glow: z.boolean().optional(),
  enter: MobileTextEnterSchema.optional(),
  exit: MobileTextExitSchema.optional(),
  loop: MobileTextLoopSchema.optional(),
});

export const MobileCaptionSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["caption", "text"]),
  startMs: ms,
  endMs: ms,
  text: z.string(),
  words: z.array(MobileCaptionWordSchema),
  style: MobileCaptionStyleSchema,
});

export const MobileZoomSchema = z.object({
  id: z.string().min(1),
  startMs: ms,
  endMs: ms,
  scale: z.number().min(1).max(4),
  centerX: z.number().min(0).max(1),
  centerY: z.number().min(0).max(1),
  rampMs: ms,
});

export const MobileMusicSchema = z.object({
  id: z.string().min(1),
  timelineStartMs: ms,
  timelineEndMs: ms,
  sourceStartMs: ms,
  source: z.union([
    z.object({ kind: z.literal("url"), url: z.string().url(), query: z.string().optional() }),
    z.object({ kind: z.literal("stock_query"), query: z.string().min(1), url: z.null() }),
  ]),
  volumeDb: z.number(),
  fadeInMs: ms,
  fadeOutMs: ms,
  duck: z.object({
    enabled: z.boolean(),
    duckDb: z.number(),
    attackMs: ms,
    releaseMs: ms,
  }),
});

/**
 * One-shot sound effect on the timeline (optional `audio.sfx`, added 2026-09). Older clients ignore
 * the field. `durationMs` is how long the clip plays (absent = the whole file).
 */
export const MobileSfxSchema = z.object({
  id: z.string().min(1),
  timelineStartMs: ms,
  durationMs: ms.optional(),
  source: z.object({ kind: z.literal("url"), url: z.string().url() }),
  volumeDb: z.number(),
  /** Attribution to show on export (CC BY needs it). Absent = no credit required. */
  credit: z.string().optional(),
});
export type MobileSfx = z.infer<typeof MobileSfxSchema>;

/**
 * Voiceover recorded on the phone (optional `audio.voiceovers`, added 2026-10, editor E2.4). The file stays on the
 * device: `source.assetId` is resolved through the draft's local asset paths at export. Music ducks under it.
 */
export const MobileVoiceoverSchema = z.object({
  id: z.string().min(1),
  timelineStartMs: ms,
  durationMs: ms,
  sourceStartMs: ms,
  source: z.object({ kind: z.literal("asset"), assetId: z.string().min(1) }),
  volumeDb: z.number(),
  fadeInMs: ms.optional(),
  fadeOutMs: ms.optional(),
});
export type MobileVoiceover = z.infer<typeof MobileVoiceoverSchema>;

export const MobileEditIRSchema = z.object({
  schemaVersion: z.literal("mobile-editir/1"),
  projectId: z.string().min(1),
  canvas: z.object({
    aspect,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    fps: z.number().positive(),
    background: hex,
  }),
  durationMs: ms,
  sources: z.array(
    z.object({ assetId: z.string().min(1), durationMs: ms, width: z.number().int().positive(), height: z.number().int().positive() })
  ).min(1),
  clips: z.array(MobileClipSchema).min(1),
  overlays: z.array(MobileOverlaySchema),
  captions: z.array(MobileCaptionSchema),
  zooms: z.array(MobileZoomSchema),
  /** Optional effects lane; omitted when empty. */
  effects: z.array(MobileEffectSchema).max(60).optional(),
  audio: z.object({
    originalTrack: z.object({ volumeDb: z.number() }),
    music: z.array(MobileMusicSchema).max(1),
    speechRangesMs: z.array(z.tuple([ms, ms])),
    /** Optional SFX lane; omitted when empty. */
    sfx: z.array(MobileSfxSchema).max(40).optional(),
    /** Optional voiceover lane; omitted when empty. */
    voiceovers: z.array(MobileVoiceoverSchema).max(20).optional(),
  }),
  /**
   * Optional brand logo drawn over the whole output (above B-roll and captions, not zoomed).
   * Absent = no watermark. The server keeps a watermark the client sent unless the turn adds/removes it.
   */
  watermark: MobileWatermarkSchema.optional(),
});

export type MobileEditIR = z.infer<typeof MobileEditIRSchema>;
export type MobileClip = z.infer<typeof MobileClipSchema>;

/** What the phone tells us about its (single) source clip. Times in ms, source-clip time. */
export const MobileMediaDescriptorSchema = z.object({
  assetId: z.string().min(1).max(128).default("primary"),
  durationMs: z.number().int().positive().max(4 * 60 * 60 * 1000),
  width: z.number().int().positive().max(16384),
  height: z.number().int().positive().max(16384),
  fps: z.number().positive().max(240).default(30),
  transcript: z
    .object({
      words: z
        .array(z.object({ text: z.string().max(100), startMs: ms, endMs: ms }))
        .max(20000),
    })
    .optional(),
  silences: z.array(z.object({ startMs: ms, endMs: ms })).max(5000).optional(),
  /**
   * On-device face track (ML Kit, sampled every ~500 ms): one entry per detected face, the
   * face-box CENTRE (x, y) and size (w, h) as 0..1 fractions of the display-oriented frame, at
   * source time tMs. Used to centre reframe crops and FACE zooms on the speaker.
   */
  faces: z
    .array(z.object({
      tMs: ms,
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      w: z.number().min(0).max(1),
      h: z.number().min(0).max(1),
    }))
    .max(20000)
    .optional(),
  /** On-device beat/onset times of the clip's own audio (source ms, ascending). */
  beatsMs: z.array(ms).max(20000).optional(),
  /** On-device scene/shot cut times (source ms, ascending). */
  scenesMs: z.array(ms).max(20000).optional(),
  /** On-device OCR (on-screen text) per source range. Untrusted: fenced as data in prompts. */
  ocr: z.array(z.object({ startMs: ms, endMs: ms, text: z.string().max(500) })).max(2000).optional(),
  /**
   * On-device scene labels (ML Kit image labeling, offline): what each source range shows ("laptop", "food").
   * Words only, never pixels. Untrusted client data: sanitised before it reaches a prompt.
   */
  labels: z
    .array(z.object({ startMs: ms, endMs: ms, labels: z.array(z.string().max(40)).max(10) }))
    .max(500)
    .optional(),
  /** Loudness of the clip's own audio (EBU R128 integrated LUFS, true peak dBTP, % of clipped samples). */
  loudness: z
    .object({
      integratedLufs: z.number().min(-100).max(10),
      truePeakDb: z.number().min(-100).max(20).optional(),
      clippingPct: z.number().min(0).max(100).optional(),
    })
    .optional(),
});

export type MobileMediaDescriptor = z.infer<typeof MobileMediaDescriptorSchema>;
export type MobileFaceSample = NonNullable<MobileMediaDescriptor["faces"]>[number];

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * The dominant face centre: the largest face of each sample, then the median x/y over the
 * samples in [fromMs, toMs] (the whole clip by default), clamped to 0.1..0.9 so a crop never
 * hugs the frame edge. Null when no face was seen in that range.
 */
export function dominantFaceCenter(
  faces: MobileFaceSample[] | null | undefined,
  range: { fromMs?: number; toMs?: number } = {}
): { x: number; y: number } | null {
  if (!faces?.length) return null;
  const largest = new Map<number, MobileFaceSample>();
  for (const f of faces) {
    if (range.fromMs != null && f.tMs < range.fromMs) continue;
    if (range.toMs != null && f.tMs > range.toMs) continue;
    const cur = largest.get(f.tMs);
    if (!cur || f.w * f.h > cur.w * cur.h) largest.set(f.tMs, f);
  }
  if (largest.size === 0) return null;
  const picks = [...largest.values()];
  const c = (v: number) => Math.round(Math.min(0.9, Math.max(0.1, v)) * 10000) / 10000;
  return { x: c(median(picks.map((f) => f.x))), y: c(median(picks.map((f) => f.y))) };
}

const sec = (t: { value: number; timescale: number }) => RationalTimeMath.toSeconds(t);
const toMs = (s: number) => Math.max(0, Math.round(s * 1000));
const R = (s: number) => RationalTimeMath.fromSeconds(s);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function aspectFromSize(width: number, height: number): "16:9" | "9:16" | "1:1" | "4:5" {
  const r = width / height;
  const candidates: Array<["16:9" | "9:16" | "1:1" | "4:5", number]> = [["16:9", 16 / 9], ["9:16", 9 / 16], ["1:1", 1], ["4:5", 4 / 5]];
  return candidates.reduce((best, c) => (Math.abs(c[1] - r) < Math.abs(best[1] - r) ? c : best))[0];
}

export function mainClipsSorted(editIR: EditIR): VideoClip[] {
  const main = editIR.tracks.videoTracks.find((t) => t.type === "MAIN_VIDEO") || editIR.tracks.videoTracks[0];
  if (!main) return [];
  return [...main.clips].sort((a, b) => sec(a.timelineRange.start) - sec(b.timelineRange.start));
}

/**
 * Maps a source-clip time (seconds) to the timeline, through the main-track clips that
 * reference `assetId`. Returns null when that source moment was cut out of the timeline.
 * If the same source moment appears twice (duplicate), the first occurrence wins.
 */
export function mapSourceToTimeline(editIR: EditIR, assetId: string, sourceSec: number): number | null {
  for (const clip of mainClipsSorted(editIR)) {
    if (clip.assetId !== assetId) continue;
    const s0 = sec(clip.sourceRange.start);
    const s1 = s0 + sec(clip.sourceRange.duration);
    if (sourceSec >= s0 - 1e-6 && sourceSec <= s1 + 1e-6) {
      const speed = clip.speedMultiplier || 1;
      return sec(clip.timelineRange.start) + (Math.min(Math.max(sourceSec, s0), s1) - s0) / speed;
    }
  }
  return null;
}

/** Builds the canonical starting EditIR for a single on-device clip (no edits yet). */
export function editIRFromMobileMedia(media: MobileMediaDescriptor, projectId: string, title = "Mobile project"): EditIR {
  const durSec = media.durationMs / 1000;
  const aspectRatio = aspectFromSize(media.width, media.height);
  return {
    version: "1.0.0",
    meta: {
      projectId,
      title,
      targetAspect: aspectRatio,
      resolution: { width: media.width, height: media.height },
      fps: { numerator: Math.round(media.fps || 30), denominator: 1 },
      totalDuration: R(durSec),
    },
    directorStyle: { preset: "CUSTOM", pacingMultiplier: 1, zoomAggressiveness: 0.5, brollFrequencySeconds: 15 },
    tracks: {
      videoTracks: [
        {
          id: "main",
          type: "MAIN_VIDEO",
          zIndex: 0,
          clips: [
            {
              id: "c1",
              assetId: media.assetId || "primary",
              sourcePath: `device-asset://${media.assetId || "primary"}`,
              sourceRange: { start: R(0), duration: R(durSec) },
              timelineRange: { start: R(0), duration: R(durSec) },
              transform: {
                scale: { start: 1, end: 1, easing: "spring" },
                position: { x: 0, y: 0 },
                anchor: { x: 0.5, y: 0.5 },
                rotationDeg: 0,
                opacity: 1,
              },
              speedMultiplier: 1,
              volumeDb: 0,
              effects: [],
            },
          ],
        },
      ],
      cameraTrack: [],
      captionTrack: [],
      audioTracks: [],
    },
  };
}

/** Fill crop of a srcW x srcH (display-oriented) source for the canvas; null when aspects match. */
export function cropFor(srcW: number, srcH: number, canvasW: number, canvasH: number, centerX = 0.5, centerY = 0.5) {
  const S = srcW / srcH;
  const A = canvasW / canvasH;
  if (Math.abs(S - A) / A < 0.01) return null;
  if (S > A) {
    const width = A / S;
    const x = clamp01(Math.min(1 - width, Math.max(0, centerX - width / 2)));
    return { x: round4(x), y: 0, width: round4(width), height: 1 };
  }
  const height = S / A;
  const y = clamp01(Math.min(1 - height, Math.max(0, centerY - height / 2)));
  return { x: 0, y: round4(y), width: 1, height: round4(height) };
}

const round4 = (v: number) => Math.round(v * 10000) / 10000;
const round6 = (v: number) => Math.round(v * 1e6) / 1e6;
const HEX_RE = /^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/;

/** Normalizes any rotation to 0/90/180/270 (nearest quarter turn). */
function quarterTurn(deg: number | undefined): 0 | 90 | 180 | 270 {
  const d = ((Math.round((deg || 0) / 90) * 90) % 360 + 360) % 360;
  return d as 0 | 90 | 180 | 270;
}

/** Canonical crop insets -> mobile crop rect; null when the insets are not a valid rect. */
function insetsToRect(c: { top: number; bottom: number; left: number; right: number }) {
  const x = round6(c.left);
  const y = round6(c.top);
  const width = round6(1 - c.left - c.right);
  const height = round6(1 - c.top - c.bottom);
  const ok = x >= 0 && y >= 0 && width > 0 && height > 0 && x + width <= 1.000001 && y + height <= 1.000001;
  return ok ? { x, y, width: Math.min(width, 1 - x), height: Math.min(height, 1 - y) } : null;
}

/** Mobile crop rect -> canonical crop insets. */
function rectToInsets(r: { x: number; y: number; width: number; height: number }) {
  return { left: r.x, top: r.y, right: Math.max(0, 1 - r.x - r.width), bottom: Math.max(0, 1 - r.y - r.height) };
}

const CANONICAL_CAPTION_PRESETS = ["HORMOZI_BOUNCE", "ALI_ABDAAL_CLEAN", "MINIMAL_SUBTITLE", "BOLD_CENTER"];

/**
 * Speech ranges on the timeline: every source word of `primaryAssetId` is intersected with every
 * main-track clip that plays that source range (so reordered, duplicated or partly cut clips are
 * handled), muted clips are skipped, and ranges closer than `mergeGapMs` are merged.
 */
export function speechRangesForClips(
  clips: Array<Pick<MobileClip, "assetId" | "sourceStartMs" | "sourceEndMs" | "timelineStartMs" | "timelineEndMs" | "speed" | "volumeDb">>,
  sourceWords: Array<{ startSec: number; endSec: number }>,
  primaryAssetId: string,
  mergeGapMs = 300
): Array<[number, number]> {
  const words = sourceWords
    .map((w) => [w.startSec * 1000, w.endSec * 1000] as [number, number])
    .filter(([a, b]) => b > a)
    .sort((p, q) => p[0] - q[0]);
  const raw: Array<[number, number]> = [];
  for (const c of clips) {
    if (c.assetId !== primaryAssetId || c.volumeDb <= -60) continue;
    for (const [ws, we] of words) {
      if (we <= c.sourceStartMs) continue;
      if (ws >= c.sourceEndMs) break;
      const a = Math.max(ws, c.sourceStartMs);
      const b = Math.min(we, c.sourceEndMs);
      const s = Math.round(c.timelineStartMs + (a - c.sourceStartMs) / c.speed);
      const e = Math.min(c.timelineEndMs, Math.round(c.timelineStartMs + (b - c.sourceStartMs) / c.speed));
      if (e > s) raw.push([s, e]);
    }
  }
  raw.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const out: Array<[number, number]> = [];
  for (const r of raw) {
    const last = out[out.length - 1];
    if (last && r[0] - last[1] <= mergeGapMs) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

function hexOr(v: string | undefined | null, fallback: string): string {
  return v && /^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/.test(v) ? v.toUpperCase() : fallback;
}

export interface MobileProjectionInput {
  editIR: EditIR;
  sources: Array<{ assetId: string; durationMs: number; width: number; height: number }>;
  /** Source-time transcript words (seconds) of the primary asset, to derive speechRangesMs. */
  sourceWords?: Array<{ startSec: number; endSec: number }>;
  primaryAssetId: string;
  /** Where fill crops of the primary asset centre (e.g. `dominantFaceCenter(media.faces)`). Default {0.5, 0.4}. */
  faceCenter?: { x: number; y: number } | null;
  /** Credit line per SFX clip id (canonical clips have no credit field). */
  sfxCredits?: Record<string, string>;
  /** Optional brand watermark explicitly provided or passed down. */
  watermark?: MobileWatermark | null;
}

/**
 * Projects canonical EditIR -> MobileEditIR. Anything outside the mobile subset is dropped
 * and reported in `warnings` (never silently).
 */
export function toMobileEditIR(input: MobileProjectionInput): { editIR: MobileEditIR; warnings: string[] } {
  const { editIR, sources, primaryAssetId } = input;
  const warnings: string[] = [];
  const canvas = { w: editIR.meta.resolution.width, h: editIR.meta.resolution.height };
  const srcById = new Map(sources.map((s) => [s.assetId, s]));
  // Fill crops centre on the detected face of the primary asset; other sources keep the
  // upper-centre default where a speaker's face usually is.
  const defaultCenter = { x: 0.5, y: 0.4 };

  const clips = mainClipsSorted(editIR);
  let cursor = 0;
  const mClips: MobileClip[] = clips.map((c, i) => {
    const src = srcById.get(c.assetId);
    const speed = Math.round((c.speedMultiplier || 1) * 1000) / 1000;
    const sourceStartMs = toMs(sec(c.sourceRange.start));
    let sourceEndMs = toMs(sec(c.sourceRange.start) + sec(c.sourceRange.duration));
    if (src) sourceEndMs = Math.min(sourceEndMs, src.durationMs);
    const timelineStartMs = cursor; // enforce contiguity
    const timelineEndMs = timelineStartMs + Math.max(1, Math.round((sourceEndMs - sourceStartMs) / speed));
    cursor = timelineEndMs;
    const t = c.transform || ({} as any);
    const rotationDeg = quarterTurn(t.rotationDeg);
    if ((t.rotationDeg || 0) % 90 !== 0) warnings.push(`clip ${c.id}: rotation ${t.rotationDeg}° rounded to ${rotationDeg}° (mobile supports quarter turns only)`);
    const sideways = rotationDeg === 90 || rotationDeg === 270;
    // Crop precedence: explicit "fit" (letterbox) > the timeline's own crop > a computed fill crop.
    let crop: MobileClip["crop"] = null;
    if (t.letterbox) {
      crop = null;
    } else if (t.crop) {
      crop = insetsToRect(t.crop);
      if (!crop) warnings.push(`clip ${c.id}: invalid crop was replaced by a centred fill crop`);
    }
    if (!t.letterbox && !crop && src) {
      // Face coordinates are in the unrotated display frame, so a quarter-turned clip keeps the default.
      const faceCenter = (c.assetId === primaryAssetId && !sideways && input.faceCenter) || defaultCenter;
      crop = cropFor(sideways ? src.height : src.width, sideways ? src.width : src.height, canvas.w, canvas.h, faceCenter.x, faceCenter.y);
    }
    const hasFilter =
      (t.filterPreset && t.filterPreset !== "NORMAL") ||
      (t.brightness ?? 1) !== 1 || (t.contrast ?? 1) !== 1 || (t.saturation ?? 1) !== 1 ||
      !!t.exposure || !!t.temperature || !!t.tint || !!t.vignette;
    // EditIR keeps temperature / tint / vignette in -100..100 (0..100); the phone uses -1..1 (0..1).
    const unit = (v: number | undefined, lo: number, hi: number) => Math.min(hi, Math.max(lo, (v ?? 0) / 100));
    let transitionIn: MobileClip["transitionIn"] = null;
    if (i > 0 && c.transitionIn) {
      const t = c.transitionIn.type;
      const type: (typeof MOBILE_TRANSITION_TYPES)[number] = (MOBILE_TRANSITION_TYPES as readonly string[]).includes(t) ? (t as any) : "CROSSFADE";
      if (type !== c.transitionIn.type) warnings.push(`transition ${c.transitionIn.type} rendered as CROSSFADE on mobile`);
      transitionIn = { type, durationMs: toMs(sec(c.transitionIn.duration)) };
    }
    return {
      id: c.id,
      assetId: c.assetId,
      sourceStartMs,
      sourceEndMs,
      timelineStartMs,
      timelineEndMs,
      speed,
      volumeDb: c.volumeDb ?? 0,
      crop,
      filter: hasFilter
        ? {
            preset: t.filterPreset || "NORMAL",
            brightness: t.brightness ?? 1,
            contrast: t.contrast ?? 1,
            saturation: t.saturation ?? 1,
            ...(t.exposure ? { exposure: Math.min(2, Math.max(-2, t.exposure)) } : {}),
            ...(t.temperature ? { temperature: unit(t.temperature, -1, 1) } : {}),
            ...(t.tint ? { tint: unit(t.tint, -1, 1) } : {}),
            ...(t.vignette ? { vignette: unit(t.vignette, 0, 1) } : {}),
          }
        : null,
      transitionIn,
      ...(rotationDeg !== 0 ? { rotationDeg } : {}),
      ...(t.flipH ? { flipH: true } : {}),
      ...(c.audioFadeInMs ? { audioFadeInMs: c.audioFadeInMs } : {}),
      ...(c.audioFadeOutMs ? { audioFadeOutMs: c.audioFadeOutMs } : {}),
      ...(c.voiceCleanup ? { voiceCleanup: true } : {}),
      ...(c.process === "reverse" || c.process === "stabilize" ? { process: c.process } : {}),
    };
  });
  const durationMs = cursor;
  const clampT = (v: number) => Math.min(durationMs, Math.max(0, v));

  const overlays: MobileEditIR["overlays"] = [];
  for (const track of editIR.tracks.videoTracks) {
    if (track.type === "MAIN_VIDEO") continue;
    if (track.type !== "B_ROLL_OVERLAY") {
      if (track.clips.length > 0) warnings.push(`${track.type} track (${track.clips.length} clip(s)) is not supported on mobile and was dropped`);
      continue;
    }
    for (const c of track.clips) {
      const start = clampT(toMs(sec(c.timelineRange.start)));
      const end = clampT(toMs(sec(c.timelineRange.start) + sec(c.timelineRange.duration)));
      if (end - start < 100) continue;
      let source: MobileEditIR["overlays"][number]["source"];
      if (/^https:\/\//i.test(c.sourcePath)) {
        source = { kind: "url", url: c.sourcePath, ...(c.assetId.startsWith("stock:") ? { query: c.assetId.slice(6) } : {}) };
      } else if (c.sourcePath.startsWith("stock-query://")) {
        source = { kind: "stock_query", query: decodeURIComponent(c.sourcePath.slice("stock-query://".length)), url: null };
      } else {
        source = { kind: "asset", assetId: c.assetId };
      }
      overlays.push({
        id: c.id, kind: "broll", timelineStartMs: start, timelineEndMs: end,
        sourceStartMs: toMs(sec(c.sourceRange.start)), source, fit: c.fit ?? "cover",
        opacity: c.transform?.opacity ?? 1, muted: (c.volumeDb ?? -60) <= -60,
        ...(c.mediaType === "image" ? { mediaType: "image" as const } : {}),
        ...(c.layer ? { layer: c.layer } : {}),
        ...(c.chromaKey ? { chromaKey: c.chromaKey } : {}),
        ...(c.mask ? { mask: c.mask } : {}),
        ...(c.process === "remove_background" ? { process: c.process } : {}),
      });
    }
  }

  const captions: MobileEditIR["captions"] = editIR.tracks.captionTrack
    .map((cap: CaptionSegment) => {
      const kind = cap.role === "title" ? "text" : "caption";
      const startMs = clampT(toMs(sec(cap.timeRange.start)));
      const endMs = clampT(toMs(sec(cap.timeRange.start) + sec(cap.timeRange.duration)));
      const highlightColor = hexOr(cap.style.highlightColor, "#FFE600");
      const words = (kind === "text"
        ? [{ text: cap.text, startMs, endMs, highlight: false, color: null, scale: 1 }]
        : cap.words.map((w) => ({
            text: w.word,
            startMs: Math.min(endMs, Math.max(startMs, toMs(sec(w.start)))),
            endMs: Math.min(endMs, Math.max(startMs, toMs(sec(w.end)))),
            highlight: !!w.highlight,
            color: w.color ? hexOr(w.color, highlightColor) : null,
            scale: w.scaleMultiplier || 1,
          }))
            // A word that a cut pushed past its caption's end clamps to nothing: drop it (it was not heard).
            .filter((w) => w.endMs > w.startMs));
      const bg = cap.style.pillBackground
        ? { color: cap.style.pillBackground, paddingPx: cap.style.pillPadding ?? 16, radiusPx: cap.style.pillRadius ?? 16 }
        : null;
      return {
        id: cap.id,
        kind,
        startMs,
        endMs,
        text: kind === "caption" && words.length > 0 && words.length < cap.words.length ? words.map((w) => w.text).join(" ") : cap.text,
        words,
        style: {
          preset: cap.style.presetLabel || cap.style.preset,
          animation: cap.style.animation || (kind === "text" ? "none" : "word_pop"),
          fontFamily: cap.style.fontFamily || "Inter",
          fontWeight: cap.style.fontWeight || 800,
          fontSizePx: cap.style.fontSize || 64,
          textColor: hexOr(cap.style.textColor, "#FFFFFF"),
          highlightColor,
          strokeColor: hexOr(cap.style.strokeColor, "#000000"),
          strokeWidthPx: cap.style.strokeWidth ?? 0,
          shadow: cap.style.shadow ?? true,
          background: bg,
          uppercase: !!cap.style.uppercase,
          positionX: clamp01(cap.style.position?.x ?? 0.5),
          positionY: clamp01(cap.style.position?.y ?? 0.8),
          maxWidthFraction: cap.style.maxWidthFraction && cap.style.maxWidthFraction > 0 && cap.style.maxWidthFraction <= 1 ? cap.style.maxWidthFraction : 0.86,
          ...(cap.style.glow ? { glow: true } : {}),
          ...(cap.style.enter ? { enter: cap.style.enter } : {}),
          ...(cap.style.exit ? { exit: cap.style.exit } : {}),
          ...(cap.style.loop ? { loop: cap.style.loop } : {}),
        },
      } as MobileEditIR["captions"][number];
    })
    .filter((c) => c.endMs - c.startMs >= 50 && (c.kind === "text" || c.words.length > 0))
    .sort((a, b) => a.startMs - b.startMs);

  const zooms: MobileEditIR["zooms"] = [];
  const cams = [...editIR.tracks.cameraTrack].sort((a, b) => sec(a.timeRange.start) - sec(b.timeRange.start));
  let lastEnd = -1;
  for (const z of cams) {
    let startMs = clampT(toMs(sec(z.timeRange.start)));
    const endMs = clampT(toMs(sec(z.timeRange.start) + sec(z.timeRange.duration)));
    if (startMs < lastEnd) startMs = lastEnd;
    if (endMs - startMs < 200) continue;
    zooms.push({
      id: z.id, startMs, endMs,
      scale: Math.min(4, Math.max(1, z.scale)),
      centerX: clamp01(z.targetCoords.x), centerY: clamp01(z.targetCoords.y),
      rampMs: z.rampMs != null
        ? Math.max(0, Math.min(Math.round(z.rampMs), Math.floor((endMs - startMs) / 2)))
        : Math.min(250, Math.floor((endMs - startMs) / 3)),
    });
    lastEnd = endMs;
  }

  const effects: NonNullable<MobileEditIR["effects"]> = (editIR.tracks.effectTrack ?? [])
    .map((e) => ({
      id: e.id,
      type: e.type,
      startMs: clampT(toMs(sec(e.timeRange.start))),
      endMs: clampT(toMs(sec(e.timeRange.start) + sec(e.timeRange.duration))),
      intensity: Math.min(1, Math.max(0, e.intensity ?? 0.6)),
    }))
    .filter((e) => e.endMs - e.startMs >= 100)
    .sort((a, b) => a.startMs - b.startMs)
    .slice(0, 60);

  const music: MobileEditIR["audio"]["music"] = [];
  const sfx: MobileSfx[] = [];
  const voiceovers: MobileVoiceover[] = [];
  for (const t of editIR.tracks.audioTracks) {
    if (t.type === "BGM") {
      const c = t.clips[0];
      if (!c) continue;
      if (music.length > 0) { warnings.push("only one music track is supported on mobile; extra dropped"); continue; }
      const source = /^https:\/\//i.test(c.sourcePath)
        ? { kind: "url" as const, url: c.sourcePath, ...(c.sourceQuery ? { query: c.sourceQuery } : {}) }
        : { kind: "stock_query" as const, query: c.sourceQuery || decodeURIComponent(c.sourcePath.replace(/^stock-music:\/\//, "")) || "background music", url: null };
      music.push({
        id: c.id,
        timelineStartMs: clampT(toMs(sec(c.timelineRange.start))),
        timelineEndMs: clampT(toMs(sec(c.timelineRange.start) + sec(c.timelineRange.duration))),
        sourceStartMs: toMs(sec(c.sourceRange.start)),
        source,
        volumeDb: (t.volumeDb ?? 0) + (c.volumeDb ?? 0),
        fadeInMs: c.fadeInDuration ? toMs(sec(c.fadeInDuration)) : 0,
        fadeOutMs: c.fadeOutDuration ? toMs(sec(c.fadeOutDuration)) : 0,
        duck: {
          enabled: !!t.duckWithSpeech,
          duckDb: t.duckingConfig?.duckDb ?? -12,
          attackMs: t.duckingConfig?.attackMs ?? 120,
          releaseMs: t.duckingConfig?.releaseMs ?? 350,
        },
      });
    } else if (t.type === "SFX") {
      // Only real HTTPS files reach mobile; synthetic desktop placeholders are dropped.
      let dropped = 0;
      for (const c of t.clips) {
        const startMs = toMs(sec(c.timelineRange.start));
        if (!/^https:\/\//i.test(c.sourcePath) || startMs >= durationMs) { dropped++; continue; }
        sfx.push({
          id: c.id,
          timelineStartMs: clampT(startMs),
          durationMs: toMs(sec(c.sourceRange.duration)),
          source: { kind: "url", url: c.sourcePath },
          volumeDb: (t.volumeDb ?? 0) + (c.volumeDb ?? 0),
          ...(input.sfxCredits?.[c.id] ? { credit: input.sfxCredits[c.id] } : {}),
        });
      }
      if (dropped) warnings.push(`${dropped} SFX clip(s) without an HTTPS file were dropped on mobile`);
    } else if (t.type === "VOICEOVER") {
      for (const c of t.clips) {
        const assetId = c.sourcePath.startsWith("asset://") ? c.sourcePath.slice("asset://".length) : "";
        const startMs = toMs(sec(c.timelineRange.start));
        if (!assetId || startMs >= durationMs) {
          warnings.push(`voiceover ${c.id} has no recording on this device or starts after the end, so it was dropped`);
          continue;
        }
        voiceovers.push({
          id: c.id,
          timelineStartMs: clampT(startMs),
          durationMs: toMs(sec(c.timelineRange.duration)),
          sourceStartMs: toMs(sec(c.sourceRange.start)),
          source: { kind: "asset", assetId },
          volumeDb: (t.volumeDb ?? 0) + (c.volumeDb ?? 0),
          ...(c.fadeInDuration ? { fadeInMs: toMs(sec(c.fadeInDuration)) } : {}),
          ...(c.fadeOutDuration ? { fadeOutMs: toMs(sec(c.fadeOutDuration)) } : {}),
        });
      }
    } else if (t.clips.length > 0) {
      warnings.push(`${t.type} audio track (${t.clips.length} clip(s)) is not supported on mobile and was dropped`);
    }
  }

  const originalVolumeDb = editIR.tracks.audioTracks.find((t) => t.id === ORIGINAL_AUDIO_TRACK_ID)?.volumeDb ?? 0;

  // Speech ranges on the EDITED timeline (cuts, reorders, speed), from the source transcript.
  // Nothing is ducked for when the original audio is muted.
  const speech = originalVolumeDb <= -60 ? [] : speechRangesForClips(mClips, input.sourceWords || [], primaryAssetId)
    .map(([s, e]) => [clampT(s), clampT(e)] as [number, number])
    .filter(([s, e]) => e > s);

  const rawWm = input.watermark ?? (editIR.meta as any).watermark;
  let watermark: MobileEditIR["watermark"];
  if (rawWm && rawWm.imageUrl) {
    watermark = {
      imageUrl: rawWm.imageUrl,
      position: rawWm.position ?? "top_right",
      opacityPct: rawWm.opacityPct ?? 85,
      widthFraction: rawWm.widthFraction ?? 0.14,
      ...(rawWm.localPath ? { localPath: rawWm.localPath } : {}),
      ...(rawWm.x !== undefined ? { x: rawWm.x } : {}),
      ...(rawWm.y !== undefined ? { y: rawWm.y } : {}),
      ...(rawWm.width !== undefined ? { width: rawWm.width } : {}),
      ...(rawWm.height !== undefined ? { height: rawWm.height } : {}),
    };
  }

  const background = editIR.meta.background && HEX_RE.test(editIR.meta.background) ? editIR.meta.background.toUpperCase() : "#000000";
  const mobile: MobileEditIR = {
    schemaVersion: "mobile-editir/1",
    projectId: editIR.meta.projectId,
    canvas: { aspect: editIR.meta.targetAspect, width: canvas.w, height: canvas.h, fps: editIR.meta.fps.numerator / editIR.meta.fps.denominator, background },
    durationMs,
    sources: sources.map((s) => ({ assetId: s.assetId, durationMs: s.durationMs, width: s.width, height: s.height })),
    clips: mClips,
    overlays,
    captions,
    zooms,
    ...(effects.length > 0 ? { effects } : {}),
    audio: { originalTrack: { volumeDb: originalVolumeDb }, music, speechRangesMs: speech, ...(sfx.length ? { sfx: sfx.sort((a, b) => a.timelineStartMs - b.timelineStartMs) } : {}), ...(voiceovers.length ? { voiceovers: voiceovers.sort((a, b) => a.timelineStartMs - b.timelineStartMs) } : {}) },
    ...(watermark ? { watermark } : {}),
  };
  return { editIR: MobileEditIRSchema.parse(mobile), warnings: Array.from(new Set(warnings)) };
}

/** Rebuilds canonical EditIR from a MobileEditIR the client sent back (for the next turn). */
export function editIRFromMobile(m: MobileEditIR, title = "Mobile project"): EditIR {
  const S = (msv: number) => R(msv / 1000);
  const srcById = new Map(m.sources.map((s) => [s.assetId, s]));
  const fps = Number.isInteger(m.canvas.fps)
    ? { numerator: m.canvas.fps, denominator: 1 }
    : { numerator: Math.round(m.canvas.fps * 1000), denominator: 1000 };
  /**
   * crop:null is "fit" (letterbox) only when a fill crop would actually be needed; when the
   * oriented source already matches the canvas, null just means "no crop" and stays automatic.
   */
  const explicitFit = (c: MobileClip) => {
    if (c.crop) return false;
    const src = srcById.get(c.assetId);
    if (!src) return true;
    const sideways = c.rotationDeg === 90 || c.rotationDeg === 270;
    return cropFor(sideways ? src.height : src.width, sideways ? src.width : src.height, m.canvas.width, m.canvas.height) !== null;
  };
  return {
    version: "1.0.0",
    meta: {
      projectId: m.projectId,
      title,
      targetAspect: m.canvas.aspect,
      resolution: { width: m.canvas.width, height: m.canvas.height },
      fps,
      totalDuration: S(m.durationMs),
      background: m.canvas.background.toUpperCase(),
      ...(m.watermark ? { watermark: m.watermark } : {}),
    },
    directorStyle: { preset: "CUSTOM", pacingMultiplier: 1, zoomAggressiveness: 0.5, brollFrequencySeconds: 15 },
    tracks: {
      videoTracks: [
        {
          id: "main",
          type: "MAIN_VIDEO",
          zIndex: 0,
          clips: m.clips.map((c) => ({
            id: c.id,
            assetId: c.assetId,
            sourcePath: `device-asset://${c.assetId}`,
            sourceRange: { start: S(c.sourceStartMs), duration: S(c.sourceEndMs - c.sourceStartMs) },
            timelineRange: { start: S(c.timelineStartMs), duration: S(c.timelineEndMs - c.timelineStartMs) },
            transform: {
              scale: { start: 1, end: 1, easing: "spring" as const },
              position: { x: 0, y: 0 },
              anchor: { x: 0.5, y: 0.5 },
              rotationDeg: c.rotationDeg ?? 0,
              ...(c.flipH ? { flipH: true } : {}),
              ...(c.crop ? { crop: rectToInsets(c.crop) } : explicitFit(c) ? { letterbox: true } : {}),
              opacity: 1,
              ...(c.filter
                ? {
                    filterPreset: c.filter.preset,
                    brightness: c.filter.brightness,
                    contrast: c.filter.contrast,
                    saturation: c.filter.saturation,
                    ...(c.filter.exposure ? { exposure: c.filter.exposure } : {}),
                    ...(c.filter.temperature ? { temperature: c.filter.temperature * 100 } : {}),
                    ...(c.filter.tint ? { tint: c.filter.tint * 100 } : {}),
                    ...(c.filter.vignette ? { vignette: c.filter.vignette * 100 } : {}),
                  }
                : {}),
            },
            ...(c.transitionIn ? { transitionIn: { type: c.transitionIn.type, duration: S(c.transitionIn.durationMs) } } : {}),
            speedMultiplier: c.speed,
            volumeDb: c.volumeDb,
            effects: [],
            ...(c.audioFadeInMs ? { audioFadeInMs: c.audioFadeInMs } : {}),
            ...(c.audioFadeOutMs ? { audioFadeOutMs: c.audioFadeOutMs } : {}),
            ...(c.voiceCleanup ? { voiceCleanup: true } : {}),
            ...(c.process ? { process: c.process } : {}),
          })),
        },
        ...(m.overlays.length > 0
          ? [{
              id: "broll",
              type: "B_ROLL_OVERLAY" as const,
              zIndex: 10,
              clips: m.overlays.map((o) => ({
                id: o.id,
                assetId: o.source.kind === "asset" ? o.source.assetId : o.source.query ? `stock:${o.source.query}` : "url",
                sourcePath: o.source.kind === "url" ? o.source.url : o.source.kind === "stock_query" ? `stock-query://${encodeURIComponent(o.source.query)}` : `device-asset://${o.source.assetId}`,
                sourceRange: { start: S(o.sourceStartMs), duration: S(o.timelineEndMs - o.timelineStartMs) },
                timelineRange: { start: S(o.timelineStartMs), duration: S(o.timelineEndMs - o.timelineStartMs) },
                transform: { scale: { start: 1, end: 1, easing: "spring" as const }, position: { x: 0, y: 0 }, anchor: { x: 0.5, y: 0.5 }, rotationDeg: 0, opacity: o.opacity },
                speedMultiplier: 1,
                volumeDb: o.muted ? -60 : 0,
                effects: [],
                ...(o.mediaType === "image" ? { mediaType: "image" as const } : {}),
                ...(o.layer ? { layer: o.layer } : {}),
                ...(o.chromaKey ? { chromaKey: o.chromaKey } : {}),
                ...(o.mask ? { mask: o.mask } : {}),
                ...(o.process ? { process: o.process } : {}),
                ...(o.fit && o.fit !== "cover" ? { fit: o.fit } : {}),
              })),
            }]
          : []),
      ],
      cameraTrack: m.zooms.map((z) => ({
        id: z.id,
        timeRange: { start: S(z.startMs), duration: S(z.endMs - z.startMs) },
        targetType: "MANUAL" as const,
        targetCoords: { x: z.centerX, y: z.centerY },
        scale: z.scale,
        rampMs: z.rampMs,
        spring: { stiffness: 180, damping: 18, mass: 1, overshootClamping: false },
        motionBlur: false,
      })),
      effectTrack: (m.effects ?? []).map((e) => ({
        id: e.id,
        type: e.type,
        timeRange: { start: S(e.startMs), duration: S(e.endMs - e.startMs) },
        intensity: e.intensity,
      })),
      captionTrack: m.captions.map((c) => ({
        id: c.id,
        role: c.kind === "text" ? ("title" as const) : ("caption" as const),
        timeRange: { start: S(c.startMs), duration: S(c.endMs - c.startMs) },
        text: c.text,
        words: c.words.map((w) => ({ word: w.text, start: S(w.startMs), end: S(w.endMs), highlight: w.highlight, ...(w.color ? { color: w.color } : {}), scaleMultiplier: w.scale })),
        style: {
          preset: (CANONICAL_CAPTION_PRESETS.includes(c.style.preset) ? c.style.preset : "HORMOZI_BOUNCE") as any,
          ...(CANONICAL_CAPTION_PRESETS.includes(c.style.preset) ? {} : { presetLabel: c.style.preset }),
          fontFamily: c.style.fontFamily,
          maxWidthFraction: c.style.maxWidthFraction,
          fontSize: c.style.fontSizePx,
          textColor: c.style.textColor,
          highlightColor: c.style.highlightColor,
          position: { x: c.style.positionX, y: c.style.positionY },
          shadow: c.style.shadow,
          strokeWidth: c.style.strokeWidthPx,
          strokeColor: c.style.strokeColor,
          ...(c.style.background ? { pillBackground: c.style.background.color, pillPadding: c.style.background.paddingPx, pillRadius: c.style.background.radiusPx } : {}),
          uppercase: c.style.uppercase,
          animation: c.style.animation,
          fontWeight: c.style.fontWeight,
          ...(c.style.glow ? { glow: true } : {}),
          ...(c.style.enter ? { enter: c.style.enter } : {}),
          ...(c.style.exit ? { exit: c.style.exit } : {}),
          ...(c.style.loop ? { loop: c.style.loop } : {}),
        },
      })),
      audioTracks: [
        // The footage's own audio gain (mobile audio.originalTrack) as a clip-less gain track.
        ...(m.audio.originalTrack.volumeDb !== 0
          ? [{ id: ORIGINAL_AUDIO_TRACK_ID, type: "PRIMARY_VOICE" as const, volumeDb: m.audio.originalTrack.volumeDb, duckWithSpeech: false, clips: [] }]
          : []),
        ...m.audio.music.map((mu) => ({
        id: `bgm_${mu.id}`,
        type: "BGM" as const,
        volumeDb: mu.volumeDb,
        duckWithSpeech: mu.duck.enabled,
        // Kept even when disabled so the client's duck settings survive the round trip.
        duckingConfig: { duckDb: mu.duck.duckDb, attackMs: mu.duck.attackMs, releaseMs: mu.duck.releaseMs },
        clips: [{
          id: mu.id,
          sourcePath: mu.source.kind === "url" ? mu.source.url : `stock-music://${encodeURIComponent(mu.source.query)}`,
          ...(mu.source.query ? { sourceQuery: mu.source.query } : {}),
          sourceRange: { start: S(mu.sourceStartMs), duration: S(mu.timelineEndMs - mu.timelineStartMs) },
          timelineRange: { start: S(mu.timelineStartMs), duration: S(mu.timelineEndMs - mu.timelineStartMs) },
          volumeDb: 0,
          fadeInDuration: S(mu.fadeInMs),
          fadeOutDuration: S(mu.fadeOutMs),
        }],
      })),
        // Optional SFX lane: one clip-per-effect track, so cuts move each effect with the timeline.
        ...(m.audio.sfx?.length
          ? [{
            id: "sfx_lane",
            type: "SFX" as const,
            volumeDb: 0,
            duckWithSpeech: false,
            clips: m.audio.sfx.map((fx) => ({
              id: fx.id,
              sourcePath: fx.source.url,
              sourceRange: { start: S(0), duration: S(fx.durationMs ?? 1000) },
              timelineRange: { start: S(fx.timelineStartMs), duration: S(fx.durationMs ?? 1000) },
              volumeDb: fx.volumeDb,
            })),
          }]
          : []),
        ...(m.audio.voiceovers?.length
          ? [{
            id: "voiceover_lane",
            type: "VOICEOVER" as const,
            volumeDb: 0,
            duckWithSpeech: false,
            clips: m.audio.voiceovers.map((v) => ({
              id: v.id,
              sourcePath: `asset://${v.source.assetId}`,
              sourceRange: { start: S(v.sourceStartMs), duration: S(v.durationMs) },
              timelineRange: { start: S(v.timelineStartMs), duration: S(v.durationMs) },
              volumeDb: v.volumeDb,
              ...(v.fadeInMs ? { fadeInDuration: S(v.fadeInMs) } : {}),
              ...(v.fadeOutMs ? { fadeOutDuration: S(v.fadeOutMs) } : {}),
            })),
          }]
          : []),
      ],
    },
  };
}
