/**
 * Caption Style Spec v2 (captions v2, Phase 1): the single source of truth for how a caption looks, moves, is laid
 * out and is grouped. The server (Director, compiler), the Flutter preview and both native renderers read this one
 * shape; Dart / Kotlin / Swift mirror the schema and the pure helpers below (easing, safe zones, grouping defaults,
 * case), so the same inputs give the same frame everywhere.
 *
 * Units: sizes, strokes, offsets, paddings and radii are CANVAS pixels; times are milliseconds. Motion is defined in
 * milliseconds (never frames), so it is frame-rate independent.
 *
 * v1 (CaptionTemplateStyle, MobileCaptionStyle) keeps working: `migrateV1TemplateStyle` and
 * `migrateMobileCaptionStyle` turn either into a v2 spec.
 */
import { z } from "zod";
import type { CaptionTemplateStyle } from "./caption-templates";

/* ───────────────────────────── primitives ───────────────────────────── */

/** #RRGGBB or #RRGGBBAA. */
export const ColorHexSchema = z.string().regex(/^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/, "colour must be #RRGGBB or #RRGGBBAA");
const px = z.number().min(0).max(2000);
const durMs = z.number().int().min(0).max(5000);

/* ───────────────────────────── typography ───────────────────────────── */

/** Scripts that get their own font in a template's font stack (Phase 2 bundles a display font per script). */
export const WRITING_SCRIPTS = [
  "latin", "devanagari", "bengali", "tamil", "telugu", "gujarati", "gurmukhi", "kannada", "malayalam", "odia",
  "arabic", "cjk-sc", "cjk-jp", "korean", "thai", "cyrillic", "fallback",
] as const;
export type WritingScript = (typeof WRITING_SCRIPTS)[number];

/** The readable default per script (Noto, SIL OFL). Templates override the scripts they have a display font for. */
export const DEFAULT_SCRIPT_FONTS: Readonly<Record<WritingScript, string>> = {
  latin: "Inter",
  devanagari: "Noto Sans Devanagari",
  bengali: "Noto Sans Bengali",
  tamil: "Noto Sans Tamil",
  telugu: "Noto Sans Telugu",
  gujarati: "Noto Sans Gujarati",
  gurmukhi: "Noto Sans Gurmukhi",
  kannada: "Noto Sans Kannada",
  malayalam: "Noto Sans Malayalam",
  odia: "Noto Sans Oriya",
  arabic: "Noto Sans Arabic",
  "cjk-sc": "Noto Sans SC",
  "cjk-jp": "Noto Sans JP",
  korean: "Noto Sans KR",
  thai: "Noto Sans Thai",
  cyrillic: "Inter",
  fallback: "Noto Sans",
};

/** Font family per script; a missing script uses DEFAULT_SCRIPT_FONTS. */
export const FontStackSchema = z
  .object(Object.fromEntries(WRITING_SCRIPTS.map((s) => [s, z.string().min(1).optional()])) as Record<WritingScript, z.ZodOptional<z.ZodString>>)
  .extend({ latin: z.string().min(1) });
export type FontStack = z.infer<typeof FontStackSchema>;

export const CAPTION_CASES = ["none", "upper", "title"] as const;
export type CaptionCase = (typeof CAPTION_CASES)[number];

export const TypographySchema = z
  .object({
    fonts: FontStackSchema,
    weight: z.number().int().min(100).max(1000).default(700),
    sizePx: z.number().min(8).max(400),
    /** The range a user may move `sizePx` within (when "sizePx" is editable). */
    sizeRangePx: z.object({ min: z.number().min(8), max: z.number().max(400) }).optional(),
    /** Tracking in em (0.1 = 10 % of the font size). */
    letterSpacingEm: z.number().min(-0.1).max(0.5).default(0),
    lineHeight: z.number().min(0.8).max(2).default(1.15),
    /** Applied only to scripts that have case (Latin, Cyrillic, Greek), locale-aware (Turkish i/İ). */
    case: z.enum(CAPTION_CASES).default("none"),
  })
  .refine((t) => !t.sizeRangePx || (t.sizeRangePx.min <= t.sizePx && t.sizePx <= t.sizeRangePx.max), "sizePx must lie inside sizeRangePx");
export type CaptionTypography = z.infer<typeof TypographySchema>;

/* ───────────────────────────── paint layers ───────────────────────────── */

/** Drawn in this order: background, glow, shadow, strokes (outermost first), fill. */
export const FillSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("solid"), color: ColorHexSchema }),
  /** Vertical gradient over each line's glyph box. */
  z.object({ type: z.literal("gradient"), top: ColorHexSchema, bottom: ColorHexSchema }),
]);
export const StrokeSchema = z.object({ color: ColorHexSchema, widthPx: px, join: z.literal("round").default("round") });
export const ShadowSchema = z.object({ xPx: z.number().min(-200).max(200), yPx: z.number().min(-200).max(200), blurPx: px, color: ColorHexSchema });
export const GlowSchema = z.object({ radiusPx: px, color: ColorHexSchema, strength: z.number().min(0).max(1) });
export const CAPTION_BACKGROUND_MODES = ["none", "line", "word", "pill"] as const;
/** `line` = a box per line, `word` = a box per word, `pill` = one rounded box around the whole group. */
export const BackgroundSchema = z.object({
  mode: z.enum(CAPTION_BACKGROUND_MODES).default("none"),
  color: ColorHexSchema.default("#000000"),
  paddingPx: px.default(12),
  radiusPx: px.default(12),
  opacity: z.number().min(0).max(1).default(1),
});

export const PaintSchema = z.object({
  fill: FillSchema,
  strokes: z.array(StrokeSchema).max(2).default([]),
  shadow: ShadowSchema.nullable().default(null),
  glow: GlowSchema.nullable().default(null),
  background: BackgroundSchema.default({}),
});
export type CaptionPaint = z.infer<typeof PaintSchema>;

/* ───────────────────────────── word states ───────────────────────────── */

/** How a word looks in one state. `color: null` = the paint's fill. */
export const WordStateSchema = z.object({
  color: ColorHexSchema.nullable().default(null),
  scale: z.number().min(0.2).max(3).default(1),
  opacity: z.number().min(0).max(1).default(1),
  yOffsetPx: z.number().min(-400).max(400).default(0),
  background: z.object({ color: ColorHexSchema, paddingPx: px.default(8), radiusPx: px.default(10) }).nullable().default(null),
  blurPx: px.default(0),
});
export type CaptionWordState = z.infer<typeof WordStateSchema>;

/** resting = not yet spoken; active = being spoken; spoken = already said; emphasis = a keyword (wins over the others). */
export const WordStatesSchema = z.object({
  resting: WordStateSchema.default({}),
  active: WordStateSchema.default({}),
  spoken: WordStateSchema.default({}),
  emphasis: WordStateSchema.default({}),
});

/* ───────────────────────────── motion ───────────────────────────── */

export const EasingSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("linear") }),
  z.object({ type: z.literal("cubic"), mode: z.enum(["in", "out", "inOut"]).default("out") }),
  /** Ease-out-back: overshoots by `overshoot` (1.70158 ≈ 10 %) then settles. */
  z.object({ type: z.literal("back"), overshoot: z.number().min(0).max(5).default(1.70158) }),
  /** Damped spring from 0 to 1 (unit mass), evaluated in real time; damping < 2·√stiffness overshoots. */
  z.object({ type: z.literal("spring"), stiffness: z.number().min(10).max(2000).default(300), damping: z.number().min(1).max(200).default(18) }),
]);
export type CaptionEasing = z.infer<typeof EasingSchema>;

export const GROUP_MOTIONS = ["none", "fade", "pop", "spring-pop", "slide-up", "slide-down", "blur-in", "scale-down-in", "typewriter", "mask-wipe"] as const;
export const WORD_ENTER_MOTIONS = ["none", "fade", "pop", "rise", "blur-in"] as const;
export const ACTIVE_WORD_MOTIONS = ["none", "scale-spring", "color-sweep", "underline-grow", "box-slide", "bounce"] as const;

export const GroupMotionSchema = z.object({
  type: z.enum(GROUP_MOTIONS).default("none"),
  durationMs: durMs.default(200),
  easing: EasingSchema.default({ type: "cubic", mode: "out" }),
});
export const MotionSchema = z.object({
  /** Exit plays the type in reverse (a slide-up enter exits by sliding up and out). */
  groupEnter: GroupMotionSchema.default({}),
  groupExit: GroupMotionSchema.default({}),
  wordEnter: z
    .object({ type: z.enum(WORD_ENTER_MOTIONS).default("none"), staggerMs: durMs.default(0), durationMs: durMs.default(150), easing: EasingSchema.default({ type: "cubic", mode: "out" }) })
    .default({}),
  activeWord: z
    .object({ type: z.enum(ACTIVE_WORD_MOTIONS).default("none"), durationMs: durMs.default(160), easing: EasingSchema.default({ type: "spring", stiffness: 300, damping: 18 }) })
    .default({}),
  /** Scales every motion amplitude (offsets, scale overshoot, blur); 0 = static, 1 = as designed. */
  intensity: z.number().min(0).max(1).default(1),
});
export type CaptionMotion = z.infer<typeof MotionSchema>;

/* ───────────────────────────── layout ───────────────────────────── */

export const SAFE_ZONE_PROFILES = ["tiktok", "reels", "shorts", "none"] as const;
export type SafeZoneProfile = (typeof SAFE_ZONE_PROFILES)[number];

/**
 * UI-covered margins on a 1080×1920 frame (research notes, conservative; the apps change them over time).
 * Shorts: the title/channel area covers the bottom like Reels; no published figure, so Reels-like margins are used.
 */
export const SAFE_ZONES_1080x1920: Readonly<Record<SafeZoneProfile, { top: number; bottom: number; left: number; right: number }>> = {
  tiktok: { top: 220, bottom: 480, left: 60, right: 140 },
  reels: { top: 270, bottom: 670, left: 65, right: 120 },
  shorts: { top: 240, bottom: 600, left: 60, right: 140 },
  none: { top: 0, bottom: 0, left: 0, right: 0 },
};

export const POSITION_PRESETS = ["lower-third", "center", "upper-third", "custom"] as const;
/** Vertical centre of the caption block per preset, as a fraction of the canvas height (before safe-zone clamping). */
export const POSITION_PRESET_Y: Readonly<Record<Exclude<(typeof POSITION_PRESETS)[number], "custom">, number>> = {
  "lower-third": 0.68,
  center: 0.5,
  "upper-third": 0.3,
};

export const LayoutSchema = z.object({
  position: z.enum(POSITION_PRESETS).default("lower-third"),
  /** Used when position is "custom": the block's centre as canvas fractions. */
  x: z.number().min(0).max(1).default(0.5),
  y: z.number().min(0).max(1).default(0.68),
  maxWidthFraction: z.number().gt(0).max(1).default(0.86),
  maxLines: z.union([z.literal(1), z.literal(2)]).default(2),
  /** start/end follow the line's direction (start = right for Arabic). */
  align: z.enum(["start", "center", "end"]).default("center"),
  safeZone: z.enum(SAFE_ZONE_PROFILES).default("tiktok"),
  /** Move the block up or down when it would cover the face track. */
  faceAvoid: z.boolean().default(true),
});
export type CaptionLayout = z.infer<typeof LayoutSchema>;

/* ───────────────────────────── grouping ───────────────────────────── */

export const GroupingSchema = z
  .object({
    /** word = one word at a time; phrase = a few words (maxWords); line = full subtitle lines. */
    mode: z.enum(["word", "phrase", "line"]).default("phrase"),
    maxWords: z.number().int().min(1).max(20).default(4),
    /** null = the language default (CJK counts characters, Latin counts letters and spaces). */
    maxCharsPerLine: z.number().int().min(4).max(80).nullable().default(null),
    minDurationMs: z.number().int().min(0).max(5000).default(700),
    maxDurationMs: z.number().int().min(500).max(10000).default(3000),
    /** Reading speed cap (characters per second); null = the language default. */
    maxCharsPerSecond: z.number().min(3).max(40).nullable().default(null),
    breakOnPunctuation: z.boolean().default(true),
    /** A pause longer than this starts a new group. */
    pauseBreakMs: z.number().int().min(0).max(5000).default(350),
    breakOnShotChange: z.boolean().default(true),
    /** Two-line groups are bottom-heavy (shorter top line) and never leave a 1-word top line. */
    balance: z.enum(["bottom-heavy", "none"]).default("bottom-heavy"),
  })
  .refine((g) => g.minDurationMs <= g.maxDurationMs, "minDurationMs must not exceed maxDurationMs");
export type CaptionGrouping = z.infer<typeof GroupingSchema>;
// Groups never split inside a grapheme cluster: that is a rule of every renderer, not a setting.

/* ───────────────────────────── emphasis ───────────────────────────── */

export const EMPHASIS_ROLES = ["emphasis", "positive", "negative"] as const;
export type EmphasisRole = (typeof EMPHASIS_ROLES)[number];
export const EmphasisSchema = z.object({
  policy: z.enum(["none", "auto-keyword", "ai-chosen"]).default("none"),
  /** Colour per meaning: emphasis (default), positive (money, wins), negative (warnings, mistakes). */
  colors: z
    .object({ emphasis: ColorHexSchema.default("#F7C204"), positive: ColorHexSchema.default("#22C55E"), negative: ColorHexSchema.default("#EF4444") })
    .default({}),
  maxPerGroup: z.number().int().min(0).max(3).default(1),
  /** An emoji after an emphasised word (off by default; never on cinematic templates). */
  emoji: z.boolean().default(false),
});

/* ───────────────────────────── editable fields ───────────────────────────── */

/** What a user may change on a template; everything else is the template's signature and stays locked. */
export const EDITABLE_FIELDS = ["colors", "sizePx", "position", "case", "maxWords", "motionIntensity"] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];

/* ───────────────────────────── the spec ───────────────────────────── */

export const CaptionStyleV2Schema = z.object({
  version: z.literal(2),
  typography: TypographySchema,
  paint: PaintSchema,
  words: WordStatesSchema.default({}),
  motion: MotionSchema.default({}),
  layout: LayoutSchema.default({}),
  grouping: GroupingSchema.default({}),
  emphasis: EmphasisSchema.default({}),
  editable: z.array(z.enum(EDITABLE_FIELDS)).default([...EDITABLE_FIELDS]),
});
export type CaptionStyleV2 = z.infer<typeof CaptionStyleV2Schema>;
export type CaptionStyleV2Input = z.input<typeof CaptionStyleV2Schema>;

/* ───────────────────────────── user overrides ───────────────────────────── */

/** A user's light changes. Each key maps to one EditableField. */
export const CaptionOverridesSchema = z.object({
  colors: z
    .object({ text: ColorHexSchema, active: ColorHexSchema, stroke: ColorHexSchema, background: ColorHexSchema, emphasis: ColorHexSchema })
    .partial()
    .optional(),
  sizePx: z.number().min(8).max(400).optional(),
  position: z.object({ preset: z.enum(POSITION_PRESETS), x: z.number().min(0).max(1).optional(), y: z.number().min(0).max(1).optional() }).optional(),
  case: z.enum(CAPTION_CASES).optional(),
  maxWords: z.number().int().min(1).max(20).optional(),
  motionIntensity: z.number().min(0).max(1).optional(),
});
export type CaptionOverrides = z.infer<typeof CaptionOverridesSchema>;

const OVERRIDE_FIELD: Record<keyof CaptionOverrides, EditableField> = {
  colors: "colors", sizePx: "sizePx", position: "position", case: "case", maxWords: "maxWords", motionIntensity: "motionIntensity",
};

/**
 * Applies a user's overrides to a template spec. Overrides of locked fields are refused (listed in `rejected`), a
 * size outside the template's range is clamped. The template's look (fonts, paint layers, motion types) never changes.
 */
export function applyCaptionOverrides(spec: CaptionStyleV2, overrides: CaptionOverrides): { spec: CaptionStyleV2; rejected: EditableField[] } {
  const o = CaptionOverridesSchema.parse(overrides);
  const allowed = new Set(spec.editable);
  const rejected: EditableField[] = [];
  const out: CaptionStyleV2 = structuredClone(spec);
  for (const k of Object.keys(o) as Array<keyof CaptionOverrides>) {
    if (o[k] === undefined) continue;
    const field = OVERRIDE_FIELD[k];
    if (!allowed.has(field)) {
      rejected.push(field);
      continue;
    }
    switch (k) {
      case "colors": {
        const c = o.colors!;
        if (c.text) out.paint.fill = out.paint.fill.type === "solid" ? { type: "solid", color: c.text } : { ...out.paint.fill, top: c.text };
        if (c.active) out.words.active = { ...out.words.active, color: c.active };
        if (c.stroke && out.paint.strokes.length > 0) out.paint.strokes = out.paint.strokes.map((s, i) => (i === 0 ? { ...s, color: c.stroke! } : s));
        if (c.background) out.paint.background = { ...out.paint.background, color: c.background };
        if (c.emphasis) out.emphasis.colors = { ...out.emphasis.colors, emphasis: c.emphasis };
        break;
      }
      case "sizePx": {
        const r = out.typography.sizeRangePx;
        out.typography.sizePx = r ? Math.min(r.max, Math.max(r.min, o.sizePx!)) : o.sizePx!;
        break;
      }
      case "position": {
        const p = o.position!;
        out.layout.position = p.preset;
        if (p.preset === "custom") {
          if (p.x !== undefined) out.layout.x = p.x;
          if (p.y !== undefined) out.layout.y = p.y;
        }
        break;
      }
      case "case":
        out.typography.case = o.case!;
        break;
      case "maxWords":
        out.grouping.maxWords = o.maxWords!;
        break;
      case "motionIntensity":
        out.motion.intensity = o.motionIntensity!;
        break;
    }
  }
  return { spec: CaptionStyleV2Schema.parse(out), rejected };
}

/* ───────────────────────────── pure helpers (mirrored by the renderers) ───────────────────────────── */

/**
 * Progress of a motion at `elapsedMs` (0 at the start, 1 when done; back and spring overshoot above 1).
 * Time-based, so 24, 30 and 60 fps sample the same curve. A spring is forced to exactly 1 at `durationMs`.
 */
export function easeAt(easing: CaptionEasing, elapsedMs: number, durationMs: number): number {
  if (elapsedMs <= 0) return 0;
  if (durationMs <= 0 || elapsedMs >= durationMs) return 1;
  const t = elapsedMs / durationMs;
  switch (easing.type) {
    case "linear":
      return t;
    case "cubic":
      return easing.mode === "in" ? t * t * t : easing.mode === "out" ? 1 - Math.pow(1 - t, 3) : t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    case "back": {
      const c1 = easing.overshoot;
      const c3 = c1 + 1;
      return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    }
    case "spring": {
      // x'' = -k(x-1) - c x', x(0)=0, x'(0)=0, unit mass; closed form per damping regime.
      const k = easing.stiffness, c = easing.damping, s = elapsedMs / 1000;
      const w0 = Math.sqrt(k);
      const zeta = c / (2 * w0);
      if (zeta < 1) {
        const wd = w0 * Math.sqrt(1 - zeta * zeta);
        return 1 - Math.exp(-zeta * w0 * s) * (Math.cos(wd * s) + ((zeta * w0) / wd) * Math.sin(wd * s));
      }
      if (zeta === 1) return 1 - Math.exp(-w0 * s) * (1 + w0 * s);
      const r1 = -w0 * (zeta - Math.sqrt(zeta * zeta - 1));
      const r2 = -w0 * (zeta + Math.sqrt(zeta * zeta - 1));
      return 1 - (r2 * Math.exp(r1 * s) - r1 * Math.exp(r2 * s)) / (r2 - r1);
    }
  }
}

/** The safe rectangle (canvas pixels) for a profile, scaled from the 1080×1920 margins to the canvas. */
export function safeRect(profile: SafeZoneProfile, canvasW: number, canvasH: number): { left: number; top: number; right: number; bottom: number } {
  const m = SAFE_ZONES_1080x1920[profile];
  const sx = canvasW / 1080, sy = canvasH / 1920;
  return { left: m.left * sx, top: m.top * sy, right: canvasW - m.right * sx, bottom: canvasH - m.bottom * sy };
}

/**
 * Where the caption block's centre goes (canvas pixels): the preset (or custom x/y), moved so a block of
 * `blockW`×`blockH` stays inside the safe rectangle. Face avoidance is applied by the renderer on top of this.
 */
export function anchorInSafeZone(layout: CaptionLayout, canvasW: number, canvasH: number, blockW: number, blockH: number): { x: number; y: number } {
  const r = safeRect(layout.safeZone, canvasW, canvasH);
  const fx = layout.position === "custom" ? layout.x : 0.5;
  const fy = layout.position === "custom" ? layout.y : POSITION_PRESET_Y[layout.position];
  const clamp = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)));
  return { x: clamp(fx * canvasW, r.left + blockW / 2, r.right - blockW / 2), y: clamp(fy * canvasH, r.top + blockH / 2, r.bottom - blockH / 2) };
}

/** The script of a text: the first letter that is not Common/Latin decides; Latin when there is none. */
export function scriptOf(text: string): WritingScript {
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c >= 0x0900 && c <= 0x097f) return "devanagari";
    if (c >= 0x0980 && c <= 0x09ff) return "bengali";
    if (c >= 0x0a00 && c <= 0x0a7f) return "gurmukhi";
    if (c >= 0x0a80 && c <= 0x0aff) return "gujarati";
    if (c >= 0x0b00 && c <= 0x0b7f) return "odia";
    if (c >= 0x0b80 && c <= 0x0bff) return "tamil";
    if (c >= 0x0c00 && c <= 0x0c7f) return "telugu";
    if (c >= 0x0c80 && c <= 0x0cff) return "kannada";
    if (c >= 0x0d00 && c <= 0x0d7f) return "malayalam";
    if ((c >= 0x0600 && c <= 0x06ff) || (c >= 0x0750 && c <= 0x077f) || (c >= 0x08a0 && c <= 0x08ff) || (c >= 0xfb50 && c <= 0xfeff)) return "arabic";
    if (c >= 0x0e00 && c <= 0x0e7f) return "thai";
    if ((c >= 0x1100 && c <= 0x11ff) || (c >= 0x3130 && c <= 0x318f) || (c >= 0xac00 && c <= 0xd7af)) return "korean";
    if ((c >= 0x3040 && c <= 0x30ff) || (c >= 0x31f0 && c <= 0x31ff)) return "cjk-jp";
    if ((c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3400 && c <= 0x4dbf)) return "cjk-sc";
    if (c >= 0x0400 && c <= 0x04ff) return "cyrillic";
  }
  return "latin";
}

/** Scripts written without spaces between words (Phase 2: never joined with " "). */
export const NO_SPACE_SCRIPTS: ReadonlySet<WritingScript> = new Set(["cjk-sc", "cjk-jp", "thai"]);
/** Scripts with upper/lower case (casing is skipped for the rest). */
export const CASED_SCRIPTS: ReadonlySet<WritingScript> = new Set(["latin", "cyrillic"]);

/**
 * Grouping defaults per script (Netflix timed-text guides): 42 chars/line for Latin, 39 Cyrillic, 16 for CJK;
 * reading speed 17 cps (Latin), 22 (Indic), 9 (CJK).
 */
export const GROUPING_DEFAULTS_BY_SCRIPT: Readonly<Record<WritingScript, { maxCharsPerLine: number; maxCharsPerSecond: number }>> = {
  latin: { maxCharsPerLine: 42, maxCharsPerSecond: 17 },
  cyrillic: { maxCharsPerLine: 39, maxCharsPerSecond: 17 },
  devanagari: { maxCharsPerLine: 42, maxCharsPerSecond: 22 },
  bengali: { maxCharsPerLine: 42, maxCharsPerSecond: 22 },
  tamil: { maxCharsPerLine: 42, maxCharsPerSecond: 22 },
  telugu: { maxCharsPerLine: 42, maxCharsPerSecond: 22 },
  gujarati: { maxCharsPerLine: 42, maxCharsPerSecond: 22 },
  gurmukhi: { maxCharsPerLine: 42, maxCharsPerSecond: 22 },
  kannada: { maxCharsPerLine: 42, maxCharsPerSecond: 22 },
  malayalam: { maxCharsPerLine: 42, maxCharsPerSecond: 22 },
  odia: { maxCharsPerLine: 42, maxCharsPerSecond: 22 },
  arabic: { maxCharsPerLine: 42, maxCharsPerSecond: 17 },
  thai: { maxCharsPerLine: 35, maxCharsPerSecond: 17 },
  korean: { maxCharsPerLine: 16, maxCharsPerSecond: 12 },
  "cjk-sc": { maxCharsPerLine: 16, maxCharsPerSecond: 9 },
  "cjk-jp": { maxCharsPerLine: 16, maxCharsPerSecond: 9 },
  fallback: { maxCharsPerLine: 42, maxCharsPerSecond: 17 },
};

/** The grouping limits that apply to `text`: the spec's values, or the script's defaults where the spec says null. */
export function groupingLimitsFor(grouping: CaptionGrouping, text: string): { maxCharsPerLine: number; maxCharsPerSecond: number } {
  const d = GROUPING_DEFAULTS_BY_SCRIPT[scriptOf(text)];
  return { maxCharsPerLine: grouping.maxCharsPerLine ?? d.maxCharsPerLine, maxCharsPerSecond: grouping.maxCharsPerSecond ?? d.maxCharsPerSecond };
}

/** The font for `text` under a stack (its script's entry, else the default for that script). */
export function fontForText(fonts: FontStack, text: string): string {
  const s = scriptOf(text);
  return fonts[s] ?? DEFAULT_SCRIPT_FONTS[s];
}

/**
 * Applies the template's case, locale-aware (`tr`/`az`: i→İ, ı→I), only for scripts with case. Title case
 * capitalises the first letter of each space-separated word and leaves the rest as written.
 */
export function applyCaptionCase(text: string, mode: CaptionCase, locale?: string): string {
  if (mode === "none" || !CASED_SCRIPTS.has(scriptOf(text))) return text;
  const loc = locale || undefined;
  if (mode === "upper") return text.toLocaleUpperCase(loc);
  return text.replace(/(^|\s)(\p{L})/gu, (_m, sp: string, ch: string) => sp + ch.toLocaleUpperCase(loc));
}

/* ───────────────────────────── migration from v1 ───────────────────────────── */

const splitAlpha = (c: string): { color: string; opacity: number } =>
  c.length === 9 ? { color: c.slice(0, 7), opacity: Math.round((parseInt(c.slice(7), 16) / 255) * 1000) / 1000 } : { color: c, opacity: 1 };

/** v1 word animation → v2 word states + active-word motion. */
function v1Animation(animation: string, highlight: string): { words: z.input<typeof WordStatesSchema>; motion: z.input<typeof MotionSchema> } {
  switch (animation) {
    case "word_pop":
      return { words: { active: { color: highlight, scale: 1.15 } }, motion: { activeWord: { type: "scale-spring", durationMs: 160 } } };
    case "karaoke":
      return { words: { active: { color: highlight }, spoken: { color: highlight } }, motion: { activeWord: { type: "color-sweep", durationMs: 120, easing: { type: "linear" } } } };
    case "word_box":
      return { words: { active: { background: { color: highlight, paddingPx: 8, radiusPx: 10 } } }, motion: { activeWord: { type: "box-slide", durationMs: 140, easing: { type: "cubic", mode: "out" } } } };
    case "word_reveal":
      return { words: { resting: { opacity: 0 } }, motion: { wordEnter: { type: "fade", durationMs: 150 } } };
    default:
      return { words: {}, motion: {} };
  }
}

const V1_ENTER: Record<string, (typeof GROUP_MOTIONS)[number]> = {
  fade: "fade", slide_up: "slide-up", slide_down: "slide-down", pop: "pop", typewriter: "typewriter", slide_left: "fade", slide_right: "fade",
};

/** A v1 catalog template style (caption-templates.ts) as a v2 spec. */
export function migrateV1TemplateStyle(style: CaptionTemplateStyle): CaptionStyleV2 {
  const anim = v1Animation(style.animation, style.highlightColor);
  const pill = style.pillBackground ? splitAlpha(style.pillBackground) : null;
  return CaptionStyleV2Schema.parse({
    version: 2,
    typography: {
      fonts: { latin: style.fontFamily },
      weight: style.fontWeight,
      sizePx: style.fontSize,
      sizeRangePx: { min: Math.max(8, Math.round(style.fontSize * 0.6)), max: Math.min(400, Math.round(style.fontSize * 1.6)) },
      case: style.uppercase ? "upper" : "none",
    },
    paint: {
      fill: { type: "solid", color: style.textColor },
      strokes: style.strokeWidth > 0 ? [{ color: style.strokeColor, widthPx: style.strokeWidth }] : [],
      shadow: style.shadow ? { xPx: 0, yPx: 2, blurPx: 6, color: "#000000B3" } : null,
      glow: style.glow ? { radiusPx: 12, color: style.highlightColor, strength: 0.8 } : null,
      background: pill ? { mode: "pill", color: pill.color, opacity: pill.opacity, paddingPx: style.pillPadding ?? 10, radiusPx: style.pillRadius ?? 16 } : { mode: "none" },
    },
    words: anim.words,
    motion: anim.motion,
  });
}

/**
 * A caption's v1 style map (MobileCaptionStyle: what the phone stores per caption) as a v2 spec. Position, width,
 * background and enter / exit motion carry over. Per-item transform (rotation, scale, keyframes) and `loop` motion
 * belong to the caption item, not the template, and are left on the v1 style.
 */
export function migrateMobileCaptionStyle(style: {
  animation?: string; fontFamily?: string; fontWeight?: number; fontSizePx?: number; textColor?: string; highlightColor?: string;
  strokeColor?: string; strokeWidthPx?: number; shadow?: boolean; uppercase?: boolean; glow?: boolean;
  background?: { color: string; paddingPx?: number; radiusPx?: number } | null;
  positionX?: number; positionY?: number; maxWidthFraction?: number;
  enter?: { type: string; durationMs: number }; exit?: { type: string; durationMs: number };
}): CaptionStyleV2 {
  const highlight = style.highlightColor ?? "#FFE600";
  const base = migrateV1TemplateStyle({
    animation: (style.animation as CaptionTemplateStyle["animation"]) ?? "none",
    fontFamily: style.fontFamily ?? "Inter",
    fontWeight: style.fontWeight ?? 800,
    fontSize: Math.min(400, Math.max(8, style.fontSizePx ?? 64)),
    textColor: style.textColor ?? "#FFFFFF",
    highlightColor: highlight,
    strokeWidth: style.strokeWidthPx ?? 0,
    strokeColor: style.strokeColor ?? "#000000",
    shadow: style.shadow ?? true,
    uppercase: style.uppercase ?? false,
    glow: style.glow,
  });
  const bg = style.background ? splitAlpha(style.background.color.startsWith("#") ? style.background.color : "#000000") : null;
  const motionOf = (m?: { type: string; durationMs: number }) => (m && V1_ENTER[m.type] ? { type: V1_ENTER[m.type], durationMs: Math.min(5000, m.durationMs) } : undefined);
  return CaptionStyleV2Schema.parse({
    ...base,
    paint: {
      ...base.paint,
      background: bg && style.background
        ? { mode: "pill", color: bg.color, opacity: bg.opacity, paddingPx: style.background.paddingPx ?? 16, radiusPx: style.background.radiusPx ?? 16 }
        : base.paint.background,
    },
    motion: { ...base.motion, groupEnter: motionOf(style.enter) ?? base.motion.groupEnter, groupExit: motionOf(style.exit) ?? base.motion.groupExit },
    layout: {
      ...base.layout,
      position: "custom",
      x: style.positionX ?? 0.5,
      y: style.positionY ?? 0.72,
      maxWidthFraction: style.maxWidthFraction ?? 0.86,
      // A v1 caption was placed by hand: keep its position exactly (no safe-zone push, no face avoidance).
      safeZone: "none",
      faceAvoid: false,
    },
  });
}
