/**
 * Manual-editing library shared by the desktop Media Studio panels, the preview and the compatibility renderer:
 *  - text templates (ids/styles identical to apps/social-studio-mobile/lib/features/studio/text_templates.dart)
 *  - the video-effect catalog (the fixed VIDEO_EFFECT_TYPES enum from @workspace/video-contracts)
 *  - pure EditIR operations (add a title / effect at the playhead, retime, remove)
 *  - `effectVisualsAt`, the per-frame look of the effect track. Its formulas mirror the FFmpeg chains in
 *    native-render-plan.ts (`buildEffectChains`) so preview, compatibility export and native export agree.
 *
 * Pure and dependency-light so it can be unit-tested (tests/unit/offline/editor-library.test.ts).
 */

import {
  RationalTimeMath,
  VIDEO_EFFECT_TYPES,
  type CaptionSegment,
  type EditIR,
  type EffectEvent,
  type VideoEffectType,
  type TransitionType,
} from "@workspace/video-contracts";
import { EFFECT_CONSTANTS } from "./effect-constants";

// ── text templates ─────────────────────────────────────────────────────────────

/** Brand look applied on top of a template. Only values the brand actually has; missing keeps the template's value. */
export interface BrandLook {
  font?: string | null;
  primaryColor?: string | null;
  accentColor?: string | null;
}

export type CaptionStyle = CaptionSegment["style"];

export interface TextTemplate {
  id: string;
  name: string;
  sample: string;
  positionY: number;
  defaultSeconds: number;
  build: (brand: BrandLook) => CaptionStyle;
}

/** Same values as mobile `TimelineOps.captionStyle('TITLE')`, mapped to EditIR caption-style field names. */
function baseTitle(presetLabel: string, y: number, b: BrandLook): CaptionStyle {
  return {
    // Non-canonical presets travel as `presetLabel` (the canonical enum value is only a fallback), as in mobile-edit-ir.ts.
    preset: "HORMOZI_BOUNCE",
    presetLabel,
    animation: "none",
    fontFamily: b.font ? b.font : "Inter",
    fontWeight: 800,
    fontSize: 88,
    textColor: "#FFFFFF",
    highlightColor: "#FFE600",
    strokeColor: "#000000",
    strokeWidth: 6,
    shadow: true,
    uppercase: false,
    position: { x: 0.5, y },
    maxWidthFraction: 0.86,
  };
}

const pill = (color: string, padding: number, radius: number) => ({ pillBackground: color, pillPadding: padding, pillRadius: radius });

export const TEXT_TEMPLATES: TextTemplate[] = [
  {
    id: "bold_title",
    name: "Bold title",
    sample: "THE ONE MISTAKE",
    positionY: 0.22,
    defaultSeconds: 3,
    build: (b) => ({ ...baseTitle("TPL_BOLD_TITLE", 0.22, b), fontSize: 92, fontWeight: 900, uppercase: true }),
  },
  {
    id: "lower_third",
    name: "Lower third",
    sample: "Jane Doe · Founder",
    positionY: 0.8,
    defaultSeconds: 4,
    build: (b) => ({
      ...baseTitle("TPL_LOWER_THIRD", 0.8, b),
      fontSize: 44,
      fontWeight: 700,
      strokeWidth: 0,
      shadow: false,
      ...pill(`${b.primaryColor ?? "#111111"}E6`, 18, 10),
    }),
  },
  {
    id: "subscribe_cta",
    name: "Follow CTA",
    sample: "Follow for part 2 →",
    positionY: 0.86,
    defaultSeconds: 3,
    build: (b) => ({
      ...baseTitle("TPL_CTA", 0.86, b),
      fontSize: 52,
      fontWeight: 800,
      textColor: "#111111",
      strokeWidth: 0,
      shadow: false,
      ...pill(b.accentColor ?? "#FFE600", 20, 28),
    }),
  },
  {
    id: "quote",
    name: "Quote",
    sample: "“Make it simple.”",
    positionY: 0.45,
    defaultSeconds: 4,
    build: (b) => ({ ...baseTitle("TPL_QUOTE", 0.45, b), fontSize: 64, fontWeight: 600, strokeWidth: 0, shadow: true }),
  },
  {
    id: "big_number",
    name: "Big number",
    sample: "3X",
    positionY: 0.4,
    defaultSeconds: 2,
    build: (b) => ({ ...baseTitle("TPL_BIG_NUMBER", 0.4, b), fontSize: 180, fontWeight: 900, textColor: b.accentColor ?? "#FFE600", strokeWidth: 8 }),
  },
  {
    id: "minimal",
    name: "Minimal",
    sample: "Day 1 of 30",
    positionY: 0.12,
    defaultSeconds: 3,
    build: (b) => ({ ...baseTitle("TPL_MINIMAL", 0.12, b), fontSize: 40, fontWeight: 500, strokeWidth: 0, shadow: true }),
  },
  {
    id: "boxed_label",
    name: "Boxed label",
    sample: "STEP 1",
    positionY: 0.3,
    defaultSeconds: 2,
    build: (b) => ({
      ...baseTitle("TPL_BOXED", 0.3, b),
      fontSize: 48,
      fontWeight: 800,
      uppercase: true,
      strokeWidth: 0,
      shadow: false,
      ...pill("#000000CC", 16, 8),
    }),
  },
  {
    id: "highlight",
    name: "Highlight",
    sample: "Save this!",
    positionY: 0.55,
    defaultSeconds: 2,
    build: (b) => ({
      ...baseTitle("TPL_HIGHLIGHT", 0.55, b),
      fontSize: 72,
      fontWeight: 900,
      textColor: b.primaryColor ?? "#FFFFFF",
      strokeColor: "#000000",
      strokeWidth: 8,
    }),
  },
];

export const textTemplateById = (id: string): TextTemplate | undefined => TEXT_TEMPLATES.find((t) => t.id === id);

/** True for free-text overlays (template titles, addText) as opposed to speech-synced captions. */
export const isTitleSegment = (c: CaptionSegment): boolean => c.role === "title";

// ── effect catalog ─────────────────────────────────────────────────────────────

export interface EffectInfo {
  type: VideoEffectType;
  name: string;
  description: string;
  defaultSeconds: number;
  defaultIntensity: number;
}

const EFFECT_INFO: Record<VideoEffectType, Omit<EffectInfo, "type">> = {
  flash: { name: "Flash", description: "A quick white flash. Good on a beat or a cut.", defaultSeconds: 0.3, defaultIntensity: 0.8 },
  fade_black: { name: "Dip to black", description: "Fades to black and back. Marks a new section.", defaultSeconds: 0.6, defaultIntensity: 1 },
  shake: { name: "Camera shake", description: "Jitters the frame for impact moments.", defaultSeconds: 0.5, defaultIntensity: 0.6 },
  zoom_pulse: { name: "Zoom pulse", description: "Punches in and back out to stress a word.", defaultSeconds: 0.5, defaultIntensity: 0.6 },
  black_white: { name: "Black & white", description: "Removes colour for the range, e.g. a flashback.", defaultSeconds: 2, defaultIntensity: 1 },
  vignette: { name: "Vignette", description: "Darkens the edges to pull focus to the centre.", defaultSeconds: 3, defaultIntensity: 0.6 },
};

export const EFFECT_CATALOG: EffectInfo[] = VIDEO_EFFECT_TYPES.map((type) => ({ type, ...EFFECT_INFO[type] }));
export const effectInfo = (type: VideoEffectType): EffectInfo => ({ type, ...EFFECT_INFO[type] });

// ── EditIR operations (pure; return a new EditIR) ──────────────────────────────

const S = (sec: number) => RationalTimeMath.fromSeconds(Math.max(0, sec));
const toSec = (t: { value: number; timescale: number }) => RationalTimeMath.toSeconds(t);
const clamp01 = (n: number) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));

const newId = (prefix: string): string => {
  const c: any = typeof globalThis !== "undefined" ? (globalThis as any).crypto : undefined;
  if (c?.randomUUID) return `${prefix}_${c.randomUUID()}`;
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
};

function extendTotal(ir: EditIR, endSec: number): EditIR["meta"] {
  return toSec(ir.meta.totalDuration) >= endSec ? ir.meta : { ...ir.meta, totalDuration: S(endSec) };
}

/** Adds a template title (role "title") at `startSec`. Empty text falls back to the template's sample. */
export function addTitleFromTemplate(
  ir: EditIR,
  templateId: string,
  text: string,
  startSec: number,
  brand: BrandLook = {},
  durationSec?: number
): { editIR: EditIR; segment: CaptionSegment } {
  const tpl = textTemplateById(templateId);
  if (!tpl) throw new Error(`Unknown text template "${templateId}"`);
  const dur = Math.max(0.2, durationSec ?? tpl.defaultSeconds);
  const segment: CaptionSegment = {
    id: newId("title"),
    role: "title",
    timeRange: { start: S(startSec), duration: S(dur) },
    text: text.trim() || tpl.sample,
    words: [],
    style: tpl.build(brand),
  };
  const captionTrack = [...(ir.tracks.captionTrack ?? []), segment].sort((a, b) => toSec(a.timeRange.start) - toSec(b.timeRange.start));
  return {
    segment,
    editIR: { ...ir, meta: extendTotal(ir, Math.max(0, startSec) + dur), tracks: { ...ir.tracks, captionTrack } },
  };
}

/** Adds an effect at `startSec` with the catalog's default duration (or `durationSec`). */
export function addEffect(
  ir: EditIR,
  type: VideoEffectType,
  startSec: number,
  intensity?: number,
  durationSec?: number
): { editIR: EditIR; effect: EffectEvent } {
  if (!(VIDEO_EFFECT_TYPES as readonly string[]).includes(type)) throw new Error(`Unknown effect "${type}"`);
  const info = effectInfo(type);
  const dur = Math.max(0.1, durationSec ?? info.defaultSeconds);
  const effect: EffectEvent = {
    id: newId("fx"),
    type,
    timeRange: { start: S(startSec), duration: S(dur) },
    intensity: clamp01(intensity ?? info.defaultIntensity),
  };
  const effectTrack = [...(ir.tracks.effectTrack ?? []), effect].sort((a, b) => toSec(a.timeRange.start) - toSec(b.timeRange.start));
  return {
    effect,
    editIR: { ...ir, meta: extendTotal(ir, Math.max(0, startSec) + dur), tracks: { ...ir.tracks, effectTrack } },
  };
}

/** Retimes an effect or a caption/title by id. Returns the same object when the id is not on those tracks. */
export function retimeOverlayItem(ir: EditIR, id: string, startSec: number, durationSec: number): EditIR {
  const range = { start: S(startSec), duration: S(Math.max(0.1, durationSec)) };
  const fx = ir.tracks.effectTrack ?? [];
  if (fx.some((e) => e.id === id)) {
    return { ...ir, tracks: { ...ir.tracks, effectTrack: fx.map((e) => (e.id === id ? { ...e, timeRange: range } : e)) } };
  }
  const caps = ir.tracks.captionTrack ?? [];
  if (caps.some((c) => c.id === id)) {
    return { ...ir, tracks: { ...ir.tracks, captionTrack: caps.map((c) => (c.id === id ? { ...c, timeRange: range } : c)) } };
  }
  return ir;
}

export function setEffectIntensity(ir: EditIR, id: string, intensity: number): EditIR {
  const fx = ir.tracks.effectTrack ?? [];
  return { ...ir, tracks: { ...ir.tracks, effectTrack: fx.map((e) => (e.id === id ? { ...e, intensity: clamp01(intensity) } : e)) } };
}

/** Removes an effect or caption/title by id. Returns the same object when nothing matched. */
export function removeOverlayItem(ir: EditIR, id: string): EditIR {
  const fx = ir.tracks.effectTrack ?? [];
  if (fx.some((e) => e.id === id)) return { ...ir, tracks: { ...ir.tracks, effectTrack: fx.filter((e) => e.id !== id) } };
  const caps = ir.tracks.captionTrack ?? [];
  if (caps.some((c) => c.id === id)) return { ...ir, tracks: { ...ir.tracks, captionTrack: caps.filter((c) => c.id !== id) } };
  return ir;
}

// ── per-frame effect look (preview + compatibility renderer) ────────────────────

export { EFFECT_CONSTANTS };

export interface EffectVisuals {
  /** extra zoom factor (1 = none) */
  zoom: number;
  /** shake offsets as a fraction of the canvas width / height */
  shakeX: number;
  shakeY: number;
  /** 0..1 desaturation */
  grayscale: number;
  /** 0..1 vignette strength */
  vignette: number;
  /** 0..1 white / black overlay opacity */
  white: number;
  black: number;
}

export const NO_EFFECT: EffectVisuals = { zoom: 1, shakeX: 0, shakeY: 0, grayscale: 0, vignette: 0, white: 0, black: 0 };

export function effectVisualsAt(effects: readonly EffectEvent[] | undefined, t: number): EffectVisuals {
  if (!effects || effects.length === 0) return NO_EFFECT;
  const v: EffectVisuals = { ...NO_EFFECT };
  const k = EFFECT_CONSTANTS;
  for (const e of effects) {
    const a = toSec(e.timeRange.start);
    const d = Math.max(0.1, toSec(e.timeRange.duration));
    if (t < a || t > a + d) continue;
    const I = clamp01(e.intensity ?? 0.6);
    const p = (t - a) / d; // 0..1 through the range
    switch (e.type) {
      case "flash": {
        const env = p < k.flashAttack ? p / k.flashAttack : (1 - p) / (1 - k.flashAttack);
        v.white = Math.max(v.white, I * clamp01(env));
        break;
      }
      case "fade_black":
        v.black = Math.max(v.black, I * clamp01(p < 0.5 ? p * 2 : (1 - p) * 2));
        break;
      case "shake": {
        const amp = k.shakeMargin * I;
        v.shakeX = Math.max(-k.shakeMargin, Math.min(k.shakeMargin, v.shakeX + amp * Math.sin(2 * Math.PI * k.shakeFreqX * t)));
        v.shakeY = Math.max(-k.shakeMargin, Math.min(k.shakeMargin, v.shakeY + amp * Math.cos(2 * Math.PI * k.shakeFreqY * t)));
        // The native render crops the margin and scales back up; the preview does the same.
        v.zoom *= 1 / (1 - 2 * k.shakeMargin);
        break;
      }
      case "zoom_pulse":
        v.zoom *= 1 + k.zoomPulsePeak * I * Math.sin(Math.PI * p);
        break;
      case "black_white":
        v.grayscale = Math.max(v.grayscale, I);
        break;
      case "vignette":
        v.vignette = Math.max(v.vignette, I);
        break;
    }
  }
  return v;
}

/** Items that are new in `after` compared with `before` (by id), so the UI can highlight what the director placed. */
export function newTimelineItemIds(before: EditIR, after: EditIR): string[] {
  const ids = (ir: EditIR) => [
    ...ir.tracks.videoTracks.flatMap((t) => t.clips.map((c) => c.id)),
    ...(ir.tracks.audioTracks ?? []).flatMap((t) => t.clips.map((c) => c.id)),
    ...(ir.tracks.captionTrack ?? []).map((c) => c.id),
    ...(ir.tracks.effectTrack ?? []).map((e) => e.id),
  ];
  const old = new Set(ids(before));
  return ids(after).filter((id) => !old.has(id));
}

// ── transitions (names for the pickers; ids = TRANSITION_TYPES in the contract) ──

export const TRANSITION_OPTIONS: ReadonlyArray<{ id: TransitionType; name: string }> = [
  { id: "CUT", name: "None (Cut)" },
  { id: "CROSSFADE", name: "Crossfade" },
  { id: "DISSOLVE", name: "Dissolve" },
  { id: "ZOOM_SWOOSH", name: "Zoom Swoosh" },
  { id: "ZOOM_OUT", name: "Zoom Out" },
  { id: "SLIDE_LEFT", name: "Whip Pan (Left)" },
  { id: "SLIDE_UP", name: "Slide Up" },
  { id: "WIPE", name: "Wipe Left" },
  { id: "WIPE_RIGHT", name: "Wipe Right" },
  { id: "BLUR_PUNCH", name: "Blur Punch" },
  { id: "GLITCH", name: "Glitch" },
  { id: "DIP_BLACK", name: "Dip to Black" },
  { id: "DIP_WHITE", name: "Dip to White" },
];
