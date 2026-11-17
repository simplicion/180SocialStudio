/**
 * Caption template catalog (captions v2, Phase 4). One catalog for the AI Director, the server compiler and the
 * phone (apps/social-studio-mobile/lib/features/studio/caption_catalog.g.dart is GENERATED from this file by
 * scripts/gen-caption-catalog.ts; a test fails when it is stale).
 *
 * Each template is a full Caption Style Spec v2 (`styleV2`) plus a flat v1 `style` derived from it, so renderers
 * that only read the flat fields keep working.
 *
 * Names and descriptions are neutral. Real people's / brands' names exist ONLY in `aliases` (hidden, never shown) so
 * "mrbeast style" or "netflix subtitles" still resolve. Old template ids (`legacyIds`) open as their new template.
 */
import {
  CaptionStyleV2Schema,
  type CaptionStyleV2,
  type CaptionStyleV2Input,
  type EditableField,
  type WritingScript,
  EDITABLE_FIELDS,
  scriptOf,
} from "./caption-style-v2";

/**
 * Word highlighting of a caption (v1, flat):
 * word_pop = the spoken word grows and takes the highlight colour; karaoke = spoken words stay highlighted;
 * word_box = a rounded box in the highlight colour sits behind the spoken word;
 * word_reveal = each word appears when it is spoken; none = static.
 */
export const CAPTION_ANIMATIONS = ["word_pop", "karaoke", "word_box", "word_reveal", "none"] as const;
export type CaptionAnimation = (typeof CAPTION_ANIMATIONS)[number];

/** The flat v1 template style (what older renderers read). */
export interface CaptionTemplateStyle {
  animation: CaptionAnimation;
  fontFamily: string;
  fontWeight: number;
  fontSize: number;
  textColor: string;
  highlightColor: string;
  strokeWidth: number;
  strokeColor: string;
  shadow: boolean;
  uppercase: boolean;
  glow?: boolean;
  pillBackground?: string;
  pillPadding?: number;
  pillRadius?: number;
}

export type CaptionMood = "hype" | "bold" | "clean" | "cinematic" | "calm" | "luxury" | "playful" | "techy" | "news";

export interface CaptionTemplate {
  id: string;
  name: string;
  description: string;
  /** Content this look suits (tags the Director's selection policy uses). */
  bestFor: readonly string[];
  mood: CaptionMood;
  /** 1 (calm) .. 5 (hype). */
  energy: 1 | 2 | 3 | 4 | 5;
  /** ISO-639-1 codes (plus "hinglish") this template is designed for; "*" = any language its fonts cover. */
  languages: readonly string[];
  /** Scripts with a display font chosen for this template (the rest use DEFAULT_SCRIPT_FONTS). */
  scripts: readonly WritingScript[];
  /** Fields a user (or the Director) may change; everything else is the template's signature. */
  editable: readonly EditableField[];
  /** Older template ids that open as this template. */
  legacyIds: readonly string[];
  /** Hidden lower-case lookup names (may include creator / brand names; never shown to users). */
  aliases: readonly string[];
  /** Preview image rendered by the real renderer (not generated yet: null). */
  thumbnail: string | null;
  styleV2: CaptionStyleV2;
  /** Flat v1 style derived from styleV2. */
  style: CaptionTemplateStyle;
}

/* ───────────────────────────── fonts ───────────────────────────── */

/**
 * Every font a template may name, with its licence. Only Google Fonts families under SIL OFL 1.1 or Apache 2.0
 * (both allow embedding in a commercial app). A test checks every template font is listed here.
 */
export const CAPTION_FONT_ALLOWLIST: Readonly<Record<string, { license: "OFL-1.1" | "Apache-2.0"; source: "Google Fonts" }>> = Object.fromEntries(
  ([
    ["Inter", "OFL-1.1"], ["Anton", "OFL-1.1"], ["Montserrat", "OFL-1.1"], ["Poppins", "OFL-1.1"], ["Syne", "OFL-1.1"],
    ["Outfit", "OFL-1.1"], ["Roboto", "Apache-2.0"], ["Bebas Neue", "OFL-1.1"], ["Playfair Display", "OFL-1.1"],
    ["Space Grotesk", "OFL-1.1"], ["Courier Prime", "OFL-1.1"],
    ["Baloo 2", "OFL-1.1"], ["Baloo Da 2", "OFL-1.1"], ["Baloo Thambi 2", "OFL-1.1"], ["Baloo Tammudu 2", "OFL-1.1"],
    ["Baloo Bhai 2", "OFL-1.1"], ["Baloo Paaji 2", "OFL-1.1"], ["Baloo Tamma 2", "OFL-1.1"], ["Baloo Chettan 2", "OFL-1.1"],
    ["Baloo Bhaina 2", "OFL-1.1"], ["Mukta", "OFL-1.1"], ["Cairo", "OFL-1.1"], ["Kanit", "OFL-1.1"],
    ["Noto Sans", "OFL-1.1"], ["Noto Sans Devanagari", "OFL-1.1"], ["Noto Sans Bengali", "OFL-1.1"], ["Noto Sans Tamil", "OFL-1.1"],
    ["Noto Sans Telugu", "OFL-1.1"], ["Noto Sans Gujarati", "OFL-1.1"], ["Noto Sans Gurmukhi", "OFL-1.1"], ["Noto Sans Kannada", "OFL-1.1"],
    ["Noto Sans Malayalam", "OFL-1.1"], ["Noto Sans Oriya", "OFL-1.1"], ["Noto Sans Arabic", "OFL-1.1"], ["Noto Sans SC", "OFL-1.1"],
    ["Noto Sans JP", "OFL-1.1"], ["Noto Sans KR", "OFL-1.1"], ["Noto Sans Thai", "OFL-1.1"], ["Noto Serif", "OFL-1.1"],
  ] as const).map(([f, license]) => [f, { license, source: "Google Fonts" as const }])
);

/** Every font family a spec names (its stack). */
export function fontsOfSpec(spec: CaptionStyleV2): string[] {
  return Object.values(spec.typography.fonts).filter((f): f is string => typeof f === "string");
}

/* ───────────────────────────── v2 -> flat v1 ───────────────────────────── */

const alphaHex = (opacity: number) => Math.round(Math.max(0, Math.min(1, opacity)) * 255).toString(16).padStart(2, "0").toUpperCase();
const fillColor = (spec: CaptionStyleV2) => (spec.paint.fill.type === "solid" ? spec.paint.fill.color : spec.paint.fill.top);

/** The v1 word animation that best matches a v2 spec. */
export function v1AnimationOf(spec: CaptionStyleV2): CaptionAnimation {
  switch (spec.motion.activeWord.type) {
    case "scale-spring":
    case "bounce":
      return "word_pop";
    case "color-sweep":
      return "karaoke";
    case "box-slide":
      return "word_box";
    default:
      if (spec.motion.wordEnter.type !== "none" || spec.words.resting.opacity === 0) return "word_reveal";
      return "none";
  }
}

/** The colour the spoken / key word takes in a flat style. */
export function highlightOf(spec: CaptionStyleV2): string {
  return spec.words.active.color ?? spec.words.active.background?.color ?? spec.emphasis.colors.emphasis;
}

/** Flat v1 template style of a v2 spec. */
export function legacyStyleOf(spec: CaptionStyleV2): CaptionTemplateStyle {
  const bg = spec.paint.background;
  const stroke = spec.paint.strokes[0];
  return {
    animation: v1AnimationOf(spec),
    fontFamily: spec.typography.fonts.latin,
    fontWeight: spec.typography.weight,
    fontSize: spec.typography.sizePx,
    textColor: fillColor(spec),
    highlightColor: highlightOf(spec),
    strokeWidth: stroke?.widthPx ?? 0,
    strokeColor: stroke?.color.slice(0, 7) ?? "#000000",
    shadow: !!spec.paint.shadow,
    uppercase: spec.typography.case === "upper",
    ...(spec.paint.glow ? { glow: true } : {}),
    ...(bg.mode !== "none" ? { pillBackground: `${bg.color.slice(0, 7)}${alphaHex(bg.opacity)}`, pillPadding: bg.paddingPx, pillRadius: bg.radiusPx } : {}),
  };
}

const V2_TO_TEXT_ENTER: Record<string, "fade" | "pop" | "slide_up" | "slide_down" | "typewriter" | undefined> = {
  fade: "fade", pop: "pop", "spring-pop": "pop", "slide-up": "slide_up", "slide-down": "slide_down", "blur-in": "fade", "scale-down-in": "pop", typewriter: "typewriter", "mask-wipe": "fade",
};

/**
 * The phone's flat caption style (MobileCaptionStyle fields) for a v2 spec, with `styleV2` attached. Renderers that
 * know v2 draw `styleV2`; older ones draw the flat fields, which say the same thing as closely as v1 can.
 */
export function mobileCaptionStyleFromV2(spec: CaptionStyleV2, templateId: string): Record<string, unknown> {
  const flat = legacyStyleOf(spec);
  const bg = spec.paint.background;
  const pos = spec.layout.position;
  const y = pos === "custom" ? spec.layout.y : pos === "center" ? 0.5 : pos === "upper-third" ? 0.3 : 0.72;
  const enter = V2_TO_TEXT_ENTER[spec.motion.groupEnter.type];
  const exit = V2_TO_TEXT_ENTER[spec.motion.groupExit.type];
  const s2 = spec.paint.strokes[1];
  return {
    preset: templateId,
    animation: flat.animation,
    fontFamily: flat.fontFamily,
    fontWeight: flat.fontWeight,
    fontSizePx: flat.fontSize,
    textColor: flat.textColor.slice(0, 7),
    highlightColor: flat.highlightColor.slice(0, 7),
    strokeColor: flat.strokeColor,
    strokeWidthPx: flat.strokeWidth,
    shadow: flat.shadow,
    background: bg.mode !== "none" ? { color: flat.pillBackground!, paddingPx: bg.paddingPx, radiusPx: bg.radiusPx } : null,
    uppercase: flat.uppercase,
    positionX: pos === "custom" ? spec.layout.x : 0.5,
    positionY: y,
    maxWidthFraction: spec.layout.maxWidthFraction,
    ...(flat.glow ? { glow: true } : {}),
    ...(enter && enter !== "typewriter" ? { enter: { type: enter, durationMs: Math.max(50, spec.motion.groupEnter.durationMs) } } : {}),
    ...(enter === "typewriter" ? { enter: { type: "typewriter", durationMs: Math.max(50, spec.motion.groupEnter.durationMs) } } : {}),
    ...(exit && exit !== "typewriter" ? { exit: { type: exit, durationMs: Math.max(50, spec.motion.groupExit.durationMs) } } : {}),
    ...(s2 ? { stroke2Color: s2.color.slice(0, 7), stroke2WidthPx: s2.widthPx } : {}),
    ...(spec.paint.fill.type === "gradient" ? { gradient: { top: spec.paint.fill.top.slice(0, 7), bottom: spec.paint.fill.bottom.slice(0, 7) } } : {}),
    ...(spec.paint.glow ? { glowRadiusPx: spec.paint.glow.radiusPx, glowColor: spec.paint.glow.color.slice(0, 7), glowStrength: spec.paint.glow.strength } : {}),
    safeZone: spec.layout.safeZone,
    faceAvoid: spec.layout.faceAvoid,
    maxLines: spec.layout.maxLines,
    backgroundMode: bg.mode,
    ...(bg.mode !== "none" ? { backgroundOpacity: bg.opacity } : {}),
    styleV2: spec,
  };
}

/* ───────────────────────────── the catalog ───────────────────────────── */

const LATIN_LANGS = ["en", "es", "pt", "fr", "de", "it", "id", "ms", "tr", "vi", "fil", "sw", "hinglish"] as const;
const ALL_EDITABLE = [...EDITABLE_FIELDS];
const INDIC_FONTS = { devanagari: "Baloo 2", arabic: "Cairo", thai: "Kanit" } as const;

interface TemplateDef extends Omit<CaptionTemplate, "styleV2" | "style" | "thumbnail" | "scripts" | "editable"> {
  editable?: readonly EditableField[];
  v2: Omit<CaptionStyleV2Input, "version" | "editable">;
}

function define(d: TemplateDef): CaptionTemplate {
  const editable = d.editable ?? ALL_EDITABLE;
  const styleV2 = CaptionStyleV2Schema.parse({ version: 2, ...d.v2, editable: [...editable] });
  const scripts = (Object.keys(styleV2.typography.fonts) as WritingScript[]).filter((s) => styleV2.typography.fonts[s]);
  const { v2: _v2, ...rest } = d;
  return { ...rest, editable, scripts, thumbnail: null, styleV2, style: legacyStyleOf(styleV2) };
}

const range = (size: number, lo = 0.7, hi = 1.4) => ({ min: Math.max(8, Math.round(size * lo)), max: Math.min(400, Math.round(size * hi)) });
const spring = (stiffness: number, damping: number) => ({ type: "spring" as const, stiffness, damping });

export const CAPTION_TEMPLATES: readonly CaptionTemplate[] = [
  define({
    id: "IMPACT_BOLD",
    name: "Impact Bold",
    description: "Condensed heavy capitals in yellow with a double black outline; each phrase springs in.",
    bestFor: ["hype", "challenge", "gaming", "reaction", "giveaway", "high-energy vlog"],
    mood: "hype",
    energy: 5,
    languages: [...LATIN_LANGS, "hi"],
    editable: ["colors", "sizePx", "position", "maxWords", "motionIntensity"],
    legacyIds: ["MRBEAST_HYPE", "STREET_IMPACT", "BOLD_CENTER"],
    aliases: ["mrbeast", "mr beast", "beast", "beast style", "mrbeast style", "high energy", "hype", "hype punch", "impact", "street", "street impact", "urban", "heavy impact", "youtube hype"],
    v2: {
      typography: { fonts: { latin: "Anton", ...INDIC_FONTS }, weight: 400, sizePx: 72, sizeRangePx: range(72), case: "upper", lineHeight: 1.05 },
      paint: {
        fill: { type: "solid", color: "#FFE600" },
        strokes: [{ color: "#000000", widthPx: 6 }, { color: "#000000", widthPx: 14 }],
        shadow: { xPx: 0, yPx: 6, blurPx: 0, color: "#000000CC" },
      },
      words: { active: { color: "#FFFFFF", scale: 1.12 }, emphasis: { scale: 1.2 } },
      motion: {
        groupEnter: { type: "spring-pop", durationMs: 260, easing: spring(420, 16) },
        groupExit: { type: "fade", durationMs: 120 },
        activeWord: { type: "scale-spring", durationMs: 160, easing: spring(500, 20) },
      },
      layout: { position: "center", maxLines: 2, safeZone: "shorts" },
      grouping: { mode: "phrase", maxWords: 3, minDurationMs: 400, maxDurationMs: 2000 },
      emphasis: { policy: "auto-keyword", colors: { emphasis: "#FF3B30" } },
    },
  }),
  define({
    id: "SPOTLIGHT_WORD",
    name: "Spotlight Word",
    description: "Ultra-bold white capitals; the spoken word lights up in an accent colour with a spring.",
    bestFor: ["business", "education", "talking head", "sales", "coaching", "tips"],
    mood: "bold",
    energy: 4,
    languages: [...LATIN_LANGS, "hi"],
    legacyIds: ["HORMOZI_BOUNCE", "ONE_WORD_PUNCH"],
    aliases: ["hormozi", "alex hormozi", "hormozi style", "hormozi viral", "punchy bounce", "punchy", "bounce", "viral bounce", "spotlight", "spotlight word"],
    v2: {
      typography: { fonts: { latin: "Montserrat", ...INDIC_FONTS }, weight: 900, sizePx: 64, sizeRangePx: range(64), case: "upper", lineHeight: 1.08 },
      paint: { fill: { type: "solid", color: "#FFFFFF" }, strokes: [{ color: "#000000", widthPx: 6 }], shadow: { xPx: 0, yPx: 4, blurPx: 4, color: "#000000B3" } },
      words: { active: { color: "#FACC15", scale: 1.18 }, emphasis: { scale: 1.18 } },
      motion: {
        groupEnter: { type: "pop", durationMs: 160, easing: { type: "back", overshoot: 1.4 } },
        groupExit: { type: "none", durationMs: 0 },
        activeWord: { type: "scale-spring", durationMs: 160, easing: spring(380, 18) },
      },
      layout: { position: "lower-third", maxLines: 2, safeZone: "reels" },
      grouping: { mode: "phrase", maxWords: 3, minDurationMs: 500, maxDurationMs: 2200 },
      emphasis: { policy: "auto-keyword", colors: { emphasis: "#22C55E", positive: "#22C55E", negative: "#EF4444" } },
    },
  }),
  define({
    id: "KEYWORD_POP",
    name: "Keyword Pop",
    description: "Two to four words; one key word is larger and coloured by its meaning (gain, warning or emphasis).",
    bestFor: ["business", "finance", "explainer", "tips", "education", "facts"],
    mood: "bold",
    energy: 4,
    languages: [...LATIN_LANGS, "hi"],
    legacyIds: ["VOX_EXPLAINER"],
    aliases: ["keyword", "keyword pop", "key word", "highlighter", "highlighter tag", "highlight tag", "marker", "explainer", "vox", "vox explainer", "vox style"],
    v2: {
      typography: { fonts: { latin: "Poppins", ...INDIC_FONTS }, weight: 800, sizePx: 60, sizeRangePx: range(60), case: "none" },
      paint: { fill: { type: "solid", color: "#FFFFFF" }, strokes: [{ color: "#000000", widthPx: 5 }], shadow: { xPx: 0, yPx: 3, blurPx: 6, color: "#000000B3" } },
      words: { emphasis: { scale: 1.35, yOffsetPx: -4 } },
      motion: { groupEnter: { type: "pop", durationMs: 180, easing: { type: "back", overshoot: 1.7 } }, groupExit: { type: "fade", durationMs: 120 } },
      layout: { position: "lower-third", maxLines: 2, safeZone: "tiktok" },
      grouping: { mode: "phrase", maxWords: 4, minDurationMs: 600, maxDurationMs: 2500 },
      emphasis: { policy: "ai-chosen", colors: { emphasis: "#FACC15", positive: "#22C55E", negative: "#EF4444" }, maxPerGroup: 1 },
    },
  }),
  define({
    id: "CINEMA_SUBTITLE",
    name: "Cinema Subtitle",
    description: "Elegant sans in white with a soft shadow, one or two lines, gentle fades and reading-speed timing.",
    bestFor: ["storytelling", "film", "travel", "interview", "documentary", "emotional"],
    mood: "cinematic",
    energy: 1,
    languages: ["*"],
    editable: ["colors", "sizePx", "position", "motionIntensity"],
    legacyIds: ["CINEMATIC_SUBTITLE", "MINIMAL_SUBTITLE"],
    aliases: ["netflix", "netflix subtitles", "netflix style", "netflix captions", "cinematic", "cinematic captions", "cinematic subtitles", "cinema", "cinema classic", "cinema subtitle", "movie subtitle", "movie subtitles", "film subtitle", "film subtitles", "subtitle style"],
    v2: {
      typography: { fonts: { latin: "Inter", devanagari: "Mukta", arabic: "Cairo", thai: "Kanit" }, weight: 600, sizePx: 48, sizeRangePx: range(48, 0.75, 1.3), case: "none", lineHeight: 1.2 },
      paint: { fill: { type: "solid", color: "#FFFFFF" }, shadow: { xPx: 0, yPx: 2, blurPx: 8, color: "#000000CC" } },
      motion: { groupEnter: { type: "fade", durationMs: 180 }, groupExit: { type: "fade", durationMs: 160 } },
      layout: { position: "lower-third", maxLines: 2, maxWidthFraction: 0.8, safeZone: "reels" },
      grouping: { mode: "line", maxWords: 12, minDurationMs: 833, maxDurationMs: 7000, maxCharsPerLine: 42, pauseBreakMs: 500 },
      emphasis: { policy: "none" },
    },
  }),
  define({
    id: "FILM_LOWER_THIRD",
    name: "Film Lower-Third",
    description: "Small, widely tracked capitals low in the frame with a slow fade, for a filmic look.",
    bestFor: ["travel", "documentary", "brand film", "storytelling", "b-roll heavy"],
    mood: "cinematic",
    energy: 1,
    languages: [...LATIN_LANGS],
    legacyIds: ["DOCUMENTARY_LOWER"],
    aliases: ["lower third", "lower thirds", "film look", "film lower third", "documentary lower", "natgeo", "nat geo", "filmic"],
    v2: {
      typography: { fonts: { latin: "Montserrat", devanagari: "Mukta" }, weight: 500, sizePx: 38, sizeRangePx: range(38, 0.8, 1.5), letterSpacingEm: 0.18, case: "upper" },
      paint: { fill: { type: "solid", color: "#F5F5F0" }, shadow: { xPx: 0, yPx: 1, blurPx: 6, color: "#000000B3" } },
      motion: { groupEnter: { type: "fade", durationMs: 400, easing: { type: "cubic", mode: "inOut" } }, groupExit: { type: "fade", durationMs: 400, easing: { type: "cubic", mode: "inOut" } } },
      layout: { position: "custom", x: 0.5, y: 0.8, maxLines: 1, maxWidthFraction: 0.84, safeZone: "reels" },
      grouping: { mode: "line", maxWords: 8, minDurationMs: 1000, maxDurationMs: 5000, maxCharsPerLine: 36 },
      emphasis: { policy: "none" },
    },
  }),
  define({
    id: "GLASS_PILL",
    name: "Glass Pill",
    description: "A frosted dark pill behind the line; the spoken word sweeps into a soft teal.",
    bestFor: ["education", "productivity", "lifestyle", "aesthetic vlog", "talking head"],
    mood: "clean",
    energy: 3,
    languages: [...LATIN_LANGS, "hi"],
    legacyIds: ["ALI_ABDAAL_CLEAN", "PASTEL_CREATOR"],
    aliases: ["ali abdaal", "abdaal", "ali abdal", "abdal", "clean frosted", "frosted", "glass", "glass pill", "modern pill", "aesthetic", "clean pill", "pastel", "soft pastel", "creator pastel", "vlog pastel"],
    v2: {
      typography: { fonts: { latin: "Poppins", ...INDIC_FONTS }, weight: 600, sizePx: 50, sizeRangePx: range(50), case: "none" },
      paint: { fill: { type: "solid", color: "#FFFFFF" }, background: { mode: "pill", color: "#0F172A", opacity: 0.55, paddingPx: 14, radiusPx: 22 } },
      words: { active: { color: "#5EEAD4" }, spoken: { color: "#FFFFFF" } },
      motion: { groupEnter: { type: "fade", durationMs: 160 }, groupExit: { type: "fade", durationMs: 140 }, activeWord: { type: "color-sweep", durationMs: 140, easing: { type: "linear" } } },
      layout: { position: "lower-third", maxLines: 2, safeZone: "reels" },
      grouping: { mode: "phrase", maxWords: 4 },
      emphasis: { policy: "auto-keyword", colors: { emphasis: "#5EEAD4" } },
    },
  }),
  define({
    id: "WORD_BOX_SLIDE",
    name: "Word Box Slide",
    description: "A rounded colour box slides from word to word under the one being spoken.",
    bestFor: ["tech", "startup", "explainer", "news commentary", "talking head"],
    mood: "techy",
    energy: 4,
    languages: [...LATIN_LANGS, "hi"],
    legacyIds: ["VARUN_MAYYA_BOX"],
    aliases: ["varun mayya", "mayya", "word box", "box highlight", "electric box", "tech box", "box slide", "sliding box"],
    v2: {
      typography: { fonts: { latin: "Inter", ...INDIC_FONTS }, weight: 800, sizePx: 56, sizeRangePx: range(56), case: "none" },
      paint: { fill: { type: "solid", color: "#FFFFFF" }, shadow: { xPx: 0, yPx: 2, blurPx: 6, color: "#00000099" } },
      words: { active: { background: { color: "#7C3AED", paddingPx: 10, radiusPx: 12 } } },
      motion: { groupEnter: { type: "pop", durationMs: 150 }, activeWord: { type: "box-slide", durationMs: 140, easing: { type: "cubic", mode: "out" } } },
      layout: { position: "lower-third", maxLines: 2, safeZone: "tiktok" },
      grouping: { mode: "phrase", maxWords: 3 },
      emphasis: { policy: "none" },
    },
  }),
  define({
    id: "KARAOKE_SWEEP",
    name: "Karaoke Sweep",
    description: "Colour fills through each word as it is spoken (right to left for RTL scripts).",
    bestFor: ["music", "lyrics", "podcast clip", "storytelling", "kids"],
    mood: "playful",
    energy: 3,
    languages: ["*"],
    legacyIds: ["KARAOKE_FROSTED"],
    aliases: ["karaoke", "karaoke sweep", "frosted karaoke", "karaoke pill", "frosted pill", "sing along", "lyrics", "lyric captions"],
    v2: {
      typography: { fonts: { latin: "Montserrat", ...INDIC_FONTS }, weight: 800, sizePx: 56, sizeRangePx: range(56), case: "none" },
      paint: { fill: { type: "solid", color: "#FFFFFF" }, strokes: [{ color: "#000000", widthPx: 5 }] },
      words: { active: { color: "#FBBF24" }, spoken: { color: "#FBBF24" } },
      motion: { groupEnter: { type: "fade", durationMs: 120 }, activeWord: { type: "color-sweep", durationMs: 120, easing: { type: "linear" } } },
      layout: { position: "lower-third", maxLines: 2, safeZone: "tiktok" },
      grouping: { mode: "phrase", maxWords: 5 },
      emphasis: { policy: "none" },
    },
  }),
  define({
    id: "MINIMAL_CLEAN",
    name: "Minimal Clean",
    description: "Medium-weight sentence case, no outline, a subtle shadow: quiet and premium.",
    bestFor: ["brand", "premium", "deep thoughts", "productivity", "corporate", "calm voice-over"],
    mood: "clean",
    energy: 2,
    languages: ["*"],
    legacyIds: ["DAN_KOE_MINIMAL"],
    aliases: ["dan koe", "dan koe clean", "minimal", "minimalist", "clean minimal", "pure minimal", "minimal clean"],
    v2: {
      typography: { fonts: { latin: "Inter", devanagari: "Mukta", arabic: "Cairo", thai: "Kanit" }, weight: 500, sizePx: 48, sizeRangePx: range(48), case: "none" },
      paint: { fill: { type: "solid", color: "#FFFFFF" }, shadow: { xPx: 0, yPx: 1, blurPx: 4, color: "#00000099" } },
      words: { active: { color: "#CBD5E1" } },
      motion: { groupEnter: { type: "fade", durationMs: 150 }, groupExit: { type: "fade", durationMs: 150 } },
      layout: { position: "lower-third", maxLines: 2, safeZone: "reels" },
      grouping: { mode: "phrase", maxWords: 5 },
      emphasis: { policy: "none" },
    },
  }),
  define({
    id: "LUXE_REVEAL",
    name: "Luxe Reveal",
    description: "Refined serif; words reveal with a soft blur and a gentle rise, with a gold accent.",
    bestFor: ["luxury", "fashion", "real estate", "lifestyle", "premium brand"],
    mood: "luxury",
    energy: 2,
    languages: [...LATIN_LANGS],
    legacyIds: ["IMAN_GADZHI_LUXE", "GOLDEN_LUXURY"],
    aliases: ["iman gadzhi", "gadzhi", "luxe", "luxury", "luxe minimal", "gold luxe", "quiet luxury", "luxe reveal"],
    v2: {
      typography: { fonts: { latin: "Playfair Display", devanagari: "Mukta" }, weight: 400, sizePx: 50, sizeRangePx: range(50), letterSpacingEm: 0.02, case: "none" },
      paint: { fill: { type: "solid", color: "#FFFFFF" }, shadow: { xPx: 0, yPx: 2, blurPx: 10, color: "#00000099" } },
      words: { resting: { opacity: 0, yOffsetPx: 10, blurPx: 6 }, active: { color: "#D4AF37" } },
      motion: { wordEnter: { type: "blur-in", staggerMs: 60, durationMs: 320, easing: { type: "cubic", mode: "out" } }, groupExit: { type: "fade", durationMs: 220 } },
      layout: { position: "lower-third", maxLines: 2, safeZone: "reels" },
      grouping: { mode: "phrase", maxWords: 4 },
      emphasis: { policy: "ai-chosen", colors: { emphasis: "#D4AF37" } },
    },
  }),
  define({
    id: "NEON_NIGHT",
    name: "Neon Night",
    description: "Glowing cyan type with a magenta pulse on the spoken word, steady and flicker-free.",
    bestFor: ["gaming", "tech", "nightlife", "music", "edm", "fast edits"],
    mood: "techy",
    energy: 4,
    languages: [...LATIN_LANGS],
    legacyIds: ["CYBER_NEON", "NEON_PULSE", "NEON_PUNCH"],
    aliases: ["neon", "cyber", "cyber neon", "glow", "neon glow", "synth neon", "neon pulse", "synthwave", "vaporwave", "cyber pulse", "glow pulse", "cyberpunk", "neon night"],
    v2: {
      typography: { fonts: { latin: "Outfit", ...INDIC_FONTS }, weight: 800, sizePx: 58, sizeRangePx: range(58), case: "upper" },
      paint: { fill: { type: "solid", color: "#E0F2FE" }, strokes: [{ color: "#0EA5E9", widthPx: 2 }], glow: { radiusPx: 18, color: "#22D3EE", strength: 0.85 } },
      words: { active: { color: "#F472B6", scale: 1.08 } },
      motion: { groupEnter: { type: "blur-in", durationMs: 200 }, activeWord: { type: "scale-spring", durationMs: 180, easing: spring(300, 22) } },
      layout: { position: "lower-third", maxLines: 2, safeZone: "tiktok" },
      grouping: { mode: "phrase", maxWords: 3 },
      emphasis: { policy: "auto-keyword", colors: { emphasis: "#F472B6" } },
    },
  }),
  define({
    id: "DOCUMENTARY",
    name: "Documentary",
    description: "Centred serif with wider tracking and slow fades, for considered narration.",
    bestFor: ["documentary", "storytelling", "history", "editorial", "culture", "interview"],
    mood: "cinematic",
    energy: 1,
    languages: ["*"],
    editable: ["colors", "sizePx", "position", "case", "motionIntensity"],
    legacyIds: ["EDITORIAL_SERIF", "EDITORIAL_SUBTLE", "MINIMAL_SERIF"],
    aliases: ["documentary", "documentary style", "docu", "editorial", "serif", "editorial serif", "vogue", "magazine", "fashion serif", "journalism", "bbc"],
    v2: {
      typography: { fonts: { latin: "Playfair Display", devanagari: "Mukta", arabic: "Cairo" }, weight: 600, sizePx: 46, sizeRangePx: range(46, 0.75, 1.4), letterSpacingEm: 0.04, case: "none", lineHeight: 1.25 },
      paint: { fill: { type: "solid", color: "#FFFFFF" }, shadow: { xPx: 0, yPx: 2, blurPx: 8, color: "#000000B3" } },
      motion: { groupEnter: { type: "fade", durationMs: 350, easing: { type: "cubic", mode: "inOut" } }, groupExit: { type: "fade", durationMs: 350, easing: { type: "cubic", mode: "inOut" } } },
      layout: { position: "lower-third", maxLines: 2, maxWidthFraction: 0.8, safeZone: "reels" },
      grouping: { mode: "line", maxWords: 10, minDurationMs: 1000, maxDurationMs: 6000 },
      emphasis: { policy: "none" },
    },
  }),
  define({
    id: "TYPEWRITER_STORY",
    name: "Typewriter Story",
    description: "Monospaced letters type on in time with the words, on a dark line box.",
    bestFor: ["storytelling", "true story", "retro", "mystery", "journal"],
    mood: "calm",
    energy: 2,
    languages: [...LATIN_LANGS],
    legacyIds: ["NIGHT_RETRO"],
    aliases: ["typewriter", "typewriter story", "typed", "retro", "night retro", "vintage", "arcade", "80s", "amber retro"],
    v2: {
      typography: { fonts: { latin: "Courier Prime", devanagari: "Mukta" }, weight: 700, sizePx: 46, sizeRangePx: range(46), case: "none" },
      paint: { fill: { type: "solid", color: "#FFFFFF" }, background: { mode: "line", color: "#000000", opacity: 0.6, paddingPx: 10, radiusPx: 4 } },
      words: { resting: { opacity: 0 } },
      motion: { groupEnter: { type: "typewriter", durationMs: 400, easing: { type: "linear" } }, groupExit: { type: "fade", durationMs: 150 } },
      layout: { position: "lower-third", maxLines: 2, safeZone: "reels", align: "start" },
      grouping: { mode: "phrase", maxWords: 6 },
      emphasis: { policy: "none" },
    },
  }),
  define({
    id: "PODCAST_DUO",
    name: "Podcast Duo",
    description: "Bold readable captions with a different colour for each speaker.",
    bestFor: ["podcast", "interview", "conversation", "debate", "talk show"],
    mood: "bold",
    energy: 3,
    languages: [...LATIN_LANGS, "hi"],
    legacyIds: ["RAJ_SHAMANI_BOLD"],
    aliases: ["raj shamani", "shamani", "podcast", "podcast bold", "podcast punch", "podcast duo", "bold talk", "two speakers", "duo"],
    v2: {
      typography: { fonts: { latin: "Montserrat", ...INDIC_FONTS }, weight: 800, sizePx: 54, sizeRangePx: range(54), case: "none" },
      paint: { fill: { type: "solid", color: "#FFFFFF" }, strokes: [{ color: "#000000", widthPx: 5 }], shadow: { xPx: 0, yPx: 3, blurPx: 4, color: "#000000B3" } },
      words: { active: { color: "#FFD60A", scale: 1.1 } },
      motion: { groupEnter: { type: "pop", durationMs: 150 }, activeWord: { type: "scale-spring", durationMs: 150 } },
      layout: { position: "lower-third", maxLines: 2, safeZone: "reels" },
      grouping: { mode: "phrase", maxWords: 4 },
      emphasis: { policy: "auto-keyword", colors: { emphasis: "#FFD60A" } },
      speakerColors: ["#FFFFFF", "#7DD3FC"],
    },
  }),
  define({
    id: "COMIC_PUNCH",
    name: "Comic Punch",
    description: "Rounded heavy display letters with a deep outline and a playful bounce on each word.",
    bestFor: ["comedy", "kids", "pets", "food", "playful vlog", "memes"],
    mood: "playful",
    energy: 5,
    languages: [...LATIN_LANGS, "hi"],
    legacyIds: [],
    aliases: ["comic", "comic punch", "cartoon", "cartoony", "playful", "meme captions", "funny captions"],
    v2: {
      typography: { fonts: { latin: "Baloo 2", devanagari: "Baloo 2" }, weight: 800, sizePx: 64, sizeRangePx: range(64), case: "none" },
      paint: { fill: { type: "solid", color: "#FFFFFF" }, strokes: [{ color: "#1E1B4B", widthPx: 7 }], shadow: { xPx: 0, yPx: 6, blurPx: 0, color: "#1E1B4B" } },
      words: { active: { color: "#FF5A1F", scale: 1.2 } },
      motion: { groupEnter: { type: "spring-pop", durationMs: 260, easing: spring(360, 14) }, activeWord: { type: "bounce", durationMs: 200, easing: spring(420, 12) } },
      layout: { position: "center", maxLines: 2, safeZone: "tiktok" },
      grouping: { mode: "phrase", maxWords: 3 },
      emphasis: { policy: "auto-keyword", colors: { emphasis: "#FF5A1F" }, emoji: false },
    },
  }),
  define({
    id: "BOLD_DESI",
    name: "Bold Desi",
    description: "Indic-first rounded display type on a dark pill, with a bright box under the spoken word. Hinglish-friendly.",
    bestFor: ["hindi", "hinglish", "indian creators", "regional language", "vlog", "comedy"],
    mood: "bold",
    energy: 4,
    languages: ["hi", "hinglish", "mr", "ne", "bn", "as", "ta", "te", "gu", "kn", "ml", "pa", "or", "en"],
    legacyIds: ["MUMBAI_BUBBLE"],
    aliases: ["desi", "bold desi", "desi style", "hindi captions", "hinglish captions", "mumbai", "mumbai bubble", "desi bubble", "bubble", "bubble style", "vibrant bubble", "bollywood"],
    v2: {
      typography: {
        fonts: {
          latin: "Baloo 2", devanagari: "Baloo 2", bengali: "Baloo Da 2", tamil: "Baloo Thambi 2", telugu: "Baloo Tammudu 2", gujarati: "Baloo Bhai 2",
          gurmukhi: "Baloo Paaji 2", kannada: "Baloo Tamma 2", malayalam: "Baloo Chettan 2", odia: "Baloo Bhaina 2",
        },
        weight: 800, sizePx: 58, sizeRangePx: range(58), case: "none", lineHeight: 1.3,
      },
      paint: { fill: { type: "solid", color: "#FFFFFF" }, background: { mode: "pill", color: "#111827", opacity: 0.9, paddingPx: 12, radiusPx: 22 } },
      words: { active: { background: { color: "#FF7A00", paddingPx: 8, radiusPx: 14 } } },
      motion: { groupEnter: { type: "pop", durationMs: 160, easing: { type: "back", overshoot: 1.5 } }, activeWord: { type: "box-slide", durationMs: 140 } },
      layout: { position: "lower-third", maxLines: 2, safeZone: "reels" },
      grouping: { mode: "phrase", maxWords: 3 },
      emphasis: { policy: "auto-keyword", colors: { emphasis: "#FF7A00" } },
    },
  }),
  define({
    id: "GRADIENT_EDGE",
    name: "Gradient Edge",
    description: "Warm gradient letters with a crisp dark outline that scale down into place.",
    bestFor: ["lifestyle", "fitness", "travel", "product", "motivation"],
    mood: "bold",
    energy: 4,
    languages: [...LATIN_LANGS],
    legacyIds: ["DYNAMIC_DUO"],
    aliases: ["gradient", "gradient edge", "dual gradient", "dynamic duo", "sunset gradient", "coral gradient"],
    v2: {
      typography: { fonts: { latin: "Outfit", ...INDIC_FONTS }, weight: 900, sizePx: 62, sizeRangePx: range(62), case: "upper" },
      paint: { fill: { type: "gradient", top: "#FDE68A", bottom: "#F43F5E" }, strokes: [{ color: "#0F172A", widthPx: 4 }], shadow: { xPx: 0, yPx: 4, blurPx: 6, color: "#00000099" } },
      words: { active: { scale: 1.1 } },
      motion: { groupEnter: { type: "scale-down-in", durationMs: 220, easing: { type: "back", overshoot: 1.2 } }, activeWord: { type: "scale-spring", durationMs: 160 } },
      layout: { position: "lower-third", maxLines: 2, safeZone: "tiktok" },
      grouping: { mode: "phrase", maxWords: 3 },
      emphasis: { policy: "auto-keyword", colors: { emphasis: "#F43F5E" } },
    },
  }),
  define({
    id: "BREAKING_NEWS",
    name: "Breaking News",
    description: "White capitals on a solid colour bar that slides in, for facts and explainers.",
    bestFor: ["news", "explainer", "facts", "announcements", "corporate", "updates"],
    mood: "news",
    energy: 3,
    languages: [...LATIN_LANGS, "hi"],
    editable: ["colors", "sizePx", "position", "maxWords", "motionIntensity"],
    legacyIds: ["MONOCHROME_BOLD"],
    aliases: ["breaking news", "news bar", "news style", "news captions", "headline bar", "monochrome", "monochrome bold", "swiss", "black and white"],
    v2: {
      typography: { fonts: { latin: "Roboto", ...INDIC_FONTS }, weight: 900, sizePx: 48, sizeRangePx: range(48), case: "upper" },
      paint: { fill: { type: "solid", color: "#FFFFFF" }, background: { mode: "line", color: "#DC2626", opacity: 1, paddingPx: 12, radiusPx: 4 } },
      words: { active: { color: "#FDE047" } },
      motion: { groupEnter: { type: "slide-up", durationMs: 200, easing: { type: "cubic", mode: "out" } }, groupExit: { type: "fade", durationMs: 120 } },
      layout: { position: "lower-third", maxLines: 2, safeZone: "reels" },
      grouping: { mode: "phrase", maxWords: 5 },
      emphasis: { policy: "none" },
    },
  }),
];

export const CAPTION_TEMPLATE_IDS = [
  "IMPACT_BOLD", "SPOTLIGHT_WORD", "KEYWORD_POP", "CINEMA_SUBTITLE", "FILM_LOWER_THIRD", "GLASS_PILL", "WORD_BOX_SLIDE",
  "KARAOKE_SWEEP", "MINIMAL_CLEAN", "LUXE_REVEAL", "NEON_NIGHT", "DOCUMENTARY", "TYPEWRITER_STORY", "PODCAST_DUO",
  "COMIC_PUNCH", "BOLD_DESI", "GRADIENT_EDGE", "BREAKING_NEWS",
] as const;
export type CaptionTemplateId = (typeof CAPTION_TEMPLATE_IDS)[number];

/** Old template id -> current id (every id the catalog ever shipped, plus the old style keys). */
export const LEGACY_CAPTION_TEMPLATE_IDS: Readonly<Record<string, CaptionTemplateId>> = Object.fromEntries(
  CAPTION_TEMPLATES.flatMap((t) => t.legacyIds.map((l) => [l, t.id as CaptionTemplateId]))
);

/**
 * How each OLD template looked (the editable flat fields only): [textColor, highlightColor, strokeColor, pill, fontSize,
 * uppercase]. Used to tell which fields a creator changed on a caption saved before captions v2.
 */
const LEGACY_LOOK_ROWS: Record<string, [string, string, string, string | null, number, boolean]> = {
  HORMOZI_BOUNCE: ["#FACC15", "#22C55E", "#000000", null, 52, true],
  MRBEAST_HYPE: ["#FFFFFF", "#EF4444", "#000000", null, 54, true],
  ALI_ABDAAL_CLEAN: ["#FFFFFF", "#14B8A6", "#000000", "#00000073", 44, false],
  DAN_KOE_MINIMAL: ["#FFFFFF", "#94A3B8", "#000000", null, 40, false],
  CYBER_NEON: ["#38BDF8", "#EC4899", "#0284C7", null, 48, false],
  KARAOKE_FROSTED: ["#FFFFFF", "#FBBF24", "#000000", "#0F172AD9", 46, false],
  VOX_EXPLAINER: ["#0F172A", "#000000", "#000000", "#FACC15", 42, false],
  CINEMATIC_SUBTITLE: ["#F8FAFC", "#F59E0B", "#0F172A", null, 48, true],
  RAJ_SHAMANI_BOLD: ["#FFFFFF", "#FFD60A", "#000000", null, 50, false],
  VARUN_MAYYA_BOX: ["#FFFFFF", "#7C3AED", "#000000", null, 46, false],
  IMAN_GADZHI_LUXE: ["#FFFFFF", "#D4AF37", "#000000", null, 38, false],
  MUMBAI_BUBBLE: ["#FFFFFF", "#FF5A1F", "#000000", "#111827E6", 48, false],
  EDITORIAL_SERIF: ["#FFFFFF", "#E2BA65", "#1E293B", null, 44, false],
  DOCUMENTARY_LOWER: ["#F1F5F9", "#38BDF8", "#000000", "#020617CC", 40, false],
  NEON_PULSE: ["#F0ABFC", "#22D3EE", "#701A75", null, 50, true],
  STREET_IMPACT: ["#F97316", "#FEF08A", "#000000", null, 58, true],
  PASTEL_CREATOR: ["#FEF3C7", "#C084FC", "#000000", "#1E1B4BD9", 42, false],
  MONOCHROME_BOLD: ["#FFFFFF", "#000000", "#000000", "#000000EE", 48, true],
  NIGHT_RETRO: ["#FDE047", "#FB923C", "#78350F", null, 44, true],
  DYNAMIC_DUO: ["#F8FAFC", "#F43F5E", "#0F172A", null, 52, true],
};

/**
 * The look a caption with preset label `id` was given: the old template's for an old id, else the current template's.
 * Fields: EditIR caption style names (textColor, highlightColor, strokeColor, pillBackground, fontSize, uppercase).
 */
export function captionTemplateLook(id?: string | null): { textColor: string; highlightColor: string; strokeColor: string; pillBackground?: string; fontSize: number; uppercase: boolean } | null {
  if (!id) return null;
  const row = LEGACY_LOOK_ROWS[id];
  if (row) return { textColor: row[0], highlightColor: row[1], strokeColor: row[2], ...(row[3] ? { pillBackground: row[3] } : {}), fontSize: row[4], uppercase: row[5] };
  const t = CAPTION_TEMPLATES.find((x) => x.id === id);
  if (!t) return null;
  return { textColor: t.style.textColor, highlightColor: t.style.highlightColor, strokeColor: t.style.strokeColor, ...(t.style.pillBackground ? { pillBackground: t.style.pillBackground } : {}), fontSize: t.style.fontSize, uppercase: t.style.uppercase };
}

const key = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const BY_KEY = new Map<string, CaptionTemplate>();
for (const t of CAPTION_TEMPLATES) for (const k of [t.id, t.name, ...t.legacyIds]) BY_KEY.set(key(k), t);
for (const t of CAPTION_TEMPLATES) for (const a of t.aliases) if (!BY_KEY.has(key(a))) BY_KEY.set(key(a), t);

/** The current id for a template id (old ids map to their new template); unknown ids are returned unchanged. */
export function canonicalCaptionTemplateId(id: string): string {
  return LEGACY_CAPTION_TEMPLATE_IDS[id] ?? id;
}

/** The template with this id, old id, display name or hidden alias (case and punctuation are ignored). */
export function resolveCaptionTemplate(nameOrId?: string | null): CaptionTemplate | undefined {
  if (!nameOrId) return undefined;
  const k = key(nameOrId);
  if (!k) return undefined;
  return BY_KEY.get(k) ?? BY_KEY.get(k.replace(/ (style|captions?|subtitles?|look|template)$/, ""));
}

/** The template a free-text request names ("mr beast style captions", "netflix subtitles"), longest match first. */
export function findCaptionTemplateInText(text: string): CaptionTemplate | undefined {
  const k = ` ${key(text)} `;
  let best: { t: CaptionTemplate; len: number } | undefined;
  for (const t of CAPTION_TEMPLATES) {
    for (const a of [key(t.name), ...t.aliases.map(key)]) {
      if (k.includes(` ${a} `) && (!best || a.length > best.len)) best = { t, len: a.length };
    }
  }
  return best?.t;
}

/* ───────────────────────────── Director: compact catalog + selection policy ───────────────────────────── */

/** One line per template for the planner prompt: id, name, mood, best for, energy, languages, editable fields. */
export function captionCatalogForPrompt(): string[] {
  return CAPTION_TEMPLATES.map(
    (t) => `${t.id} | ${t.name} | mood ${t.mood} | energy ${t.energy}/5 | best for: ${t.bestFor.join(", ")} | languages: ${t.languages.includes("*") ? "any" : t.languages.join(",")} | editable: ${t.editable.join(",")}`
  );
}

/** How the Director picks a caption template (prompt text; neutral, no creator names). */
export const CAPTION_SELECTION_POLICY = [
  "Caption template selection (applyCaptionTemplate):",
  "- If the creator names a look, use it (names and well-known style nicknames resolve to a template id automatically).",
  "- Otherwise choose by content type first: storytelling, travel, film, emotional -> CINEMA_SUBTITLE, DOCUMENTARY or FILM_LOWER_THIRD; business, education, coaching, tips -> SPOTLIGHT_WORD or KEYWORD_POP; podcasts and interviews -> PODCAST_DUO; news, facts, explainers -> BREAKING_NEWS or KEYWORD_POP; hype, challenges, gaming -> IMPACT_BOLD or NEON_NIGHT; comedy, kids, pets -> COMIC_PUNCH; luxury, fashion -> LUXE_REVEAL; brand / premium / calm -> MINIMAL_CLEAN or GLASS_PILL.",
  "- Language: Hindi, Hinglish or another Indic language -> BOLD_DESI when the tone is bold or energetic (else CINEMA_SUBTITLE or MINIMAL_CLEAN, which have Indic fonts); Arabic, CJK, Thai -> a template whose languages include them or 'any'.",
  "- Energy: match the template energy (1 calm .. 5 hype) to the pacing of the video and the creator's request.",
  "- Platform: TikTok/Reels/Shorts keep captions inside the safe zone (templates do this); YouTube landscape suits CINEMA_SUBTITLE or MINIMAL_CLEAN.",
  "- Brand colours: pass them as overrides.colors (text / active / emphasis / background), never by switching template; only fields listed as editable can be overridden.",
  "- Emphasis: optionally pick at most ONE meaningful word per caption group (not a stop word such as the/and/is/hai/ka/el/de) with role emphasis, positive (money, wins, growth) or negative (warnings, mistakes, losses). Cinematic and documentary templates usually need none.",
].join("\n");

const CONTENT_RULES: Array<[RegExp, CaptionTemplateId]> = [
  [/\b(podcast|interview|conversation|debate|talk show)\b/, "PODCAST_DUO"],
  [/\b(news|breaking|facts?|announcement)\b/, "BREAKING_NEWS"],
  [/\b(documentary|docu|history|editorial)\b/, "DOCUMENTARY"],
  [/\b(story|storytelling|travel|cinematic|film|movie|emotional|journey)\b/, "CINEMA_SUBTITLE"],
  [/\b(luxury|luxe|fashion|real estate|elegant)\b/, "LUXE_REVEAL"],
  [/\b(funny|comedy|kids?|pets?|meme|playful)\b/, "COMIC_PUNCH"],
  [/\b(gaming|gamer|neon|nightlife|edm)\b/, "NEON_NIGHT"],
  [/\b(hype|challenge|giveaway|insane|crazy|energetic|high energy|viral)\b/, "IMPACT_BOLD"],
  [/\b(finance|money|business|sales|marketing|startup|explainer)\b/, "KEYWORD_POP"],
  [/\b(tips?|education|tutorial|course|coaching|lesson)\b/, "SPOTLIGHT_WORD"],
  [/\b(minimal|calm|premium)\b/, "MINIMAL_CLEAN"],
];
const INDIC_SCRIPTS: ReadonlySet<WritingScript> = new Set(["devanagari", "bengali", "tamil", "telugu", "gujarati", "gurmukhi", "kannada", "malayalam", "odia"]);

/** The dominant script of a transcript (by word). */
export function dominantScript(text: string): WritingScript {
  const counts = new Map<WritingScript, number>();
  for (const w of text.split(/\s+/).slice(0, 300)) if (w) counts.set(scriptOf(w), (counts.get(scriptOf(w)) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "latin";
}

/**
 * The selection policy (CAPTION_SELECTION_POLICY) as rules, for the offline planner: the template the creator named,
 * else one for the language and the content, else undefined (the caller keeps its default look).
 */
export function chooseCaptionTemplate(input: { prompt: string; transcriptText?: string; energy?: "high" | "medium" | "calm" }): CaptionTemplate | undefined {
  const named = findCaptionTemplateInText(input.prompt);
  if (named) return named;
  const p = input.prompt.toLowerCase();
  const byId = (id: CaptionTemplateId) => CAPTION_TEMPLATES.find((t) => t.id === id)!;
  const script = input.transcriptText ? dominantScript(input.transcriptText) : "latin";
  const calm = input.energy === "calm" || /\b(calm|cinematic|story|storytelling|documentary|emotional|minimal|subtle)\b/.test(p);
  if (INDIC_SCRIPTS.has(script) || /\b(hindi|hinglish|desi|marathi|bengali|tamil|telugu|punjabi|gujarati)\b/.test(p)) return byId(calm ? "CINEMA_SUBTITLE" : "BOLD_DESI");
  if (script !== "latin" && script !== "cyrillic") return byId(calm ? "CINEMA_SUBTITLE" : "MINIMAL_CLEAN");
  for (const [re, id] of CONTENT_RULES) if (re.test(p)) return byId(id);
  return undefined;
}
