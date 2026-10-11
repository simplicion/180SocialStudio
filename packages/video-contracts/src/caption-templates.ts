/**
 * Caption templates (creator looks). One catalog for the AI Director and the clients: ids and values match
 * `viralCaptionPresets` in the Flutter app (timeline_ops.dart) and `CAPTION_STYLE_PRESETS` in
 * CaptionStudioModal.tsx. Font sizes and stroke widths are canvas pixels.
 */
/**
 * Word highlighting of a caption:
 * word_pop = the spoken word grows and takes the highlight colour; karaoke = spoken words stay highlighted;
 * word_box = a rounded box in the highlight colour sits behind the spoken word;
 * word_reveal = each word appears when it is spoken; none = static.
 */
export const CAPTION_ANIMATIONS = ["word_pop", "karaoke", "word_box", "word_reveal", "none"] as const;
export type CaptionAnimation = (typeof CAPTION_ANIMATIONS)[number];

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

export interface CaptionTemplate {
  id: string;
  name: string;
  /** Lower-case names a creator may use for this look ("mr beast", "hormozi"). */
  aliases: readonly string[];
  style: CaptionTemplateStyle;
}

export const CAPTION_TEMPLATE_IDS = [
  "HORMOZI_BOUNCE",
  "MRBEAST_HYPE",
  "ALI_ABDAAL_CLEAN",
  "DAN_KOE_MINIMAL",
  "CYBER_NEON",
  "KARAOKE_FROSTED",
  "VOX_EXPLAINER",
  "CINEMATIC_SUBTITLE",
  "RAJ_SHAMANI_BOLD",
  "VARUN_MAYYA_BOX",
  "IMAN_GADZHI_LUXE",
  "MUMBAI_BUBBLE",
] as const;
export type CaptionTemplateId = (typeof CAPTION_TEMPLATE_IDS)[number];

export const CAPTION_TEMPLATES: readonly CaptionTemplate[] = [
  {
    id: "HORMOZI_BOUNCE",
    name: "Hormozi Viral",
    aliases: ["hormozi", "alex hormozi", "hormozi viral"],
    style: { animation: "word_pop", fontFamily: "Anton", fontWeight: 400, fontSize: 52, textColor: "#FACC15", highlightColor: "#22C55E", strokeWidth: 3, strokeColor: "#000000", shadow: true, uppercase: true },
  },
  {
    id: "MRBEAST_HYPE",
    name: "MrBeast Punch",
    aliases: ["mrbeast", "mr beast", "beast", "mrbeast punch"],
    style: { animation: "word_pop", fontFamily: "Montserrat", fontWeight: 900, fontSize: 54, textColor: "#FFFFFF", highlightColor: "#EF4444", strokeWidth: 4, strokeColor: "#000000", shadow: true, uppercase: true },
  },
  {
    id: "ALI_ABDAAL_CLEAN",
    name: "Abdaal Aesthetic",
    aliases: ["ali abdaal", "abdaal", "ali abdal", "abdal"],
    style: { animation: "karaoke", fontFamily: "Poppins", fontWeight: 600, fontSize: 44, textColor: "#FFFFFF", highlightColor: "#14B8A6", strokeWidth: 0, strokeColor: "#000000", shadow: true, uppercase: false, pillBackground: "#00000073", pillPadding: 6, pillRadius: 14 },
  },
  {
    id: "DAN_KOE_MINIMAL",
    name: "Dan Koe Clean",
    aliases: ["dan koe", "minimal", "minimalist", "clean minimal"],
    style: { animation: "none", fontFamily: "Syne", fontWeight: 700, fontSize: 40, textColor: "#FFFFFF", highlightColor: "#94A3B8", strokeWidth: 0, strokeColor: "#000000", shadow: false, uppercase: false },
  },
  {
    id: "CYBER_NEON",
    name: "Cyber Neon",
    aliases: ["neon", "cyber", "cyber neon", "glow"],
    style: { animation: "word_pop", fontFamily: "Outfit", fontWeight: 800, fontSize: 48, textColor: "#38BDF8", highlightColor: "#EC4899", strokeWidth: 1, strokeColor: "#0284C7", shadow: false, uppercase: false, glow: true },
  },
  {
    id: "KARAOKE_FROSTED",
    name: "Frosted Pill",
    aliases: ["frosted", "frosted pill", "pill", "karaoke pill"],
    style: { animation: "karaoke", fontFamily: "Inter", fontWeight: 800, fontSize: 46, textColor: "#FFFFFF", highlightColor: "#FBBF24", strokeWidth: 0, strokeColor: "#000000", shadow: true, uppercase: false, pillBackground: "#0F172AD9", pillPadding: 10, pillRadius: 20 },
  },
  {
    id: "VOX_EXPLAINER",
    name: "Vox Explainer",
    aliases: ["vox", "explainer", "highlighter"],
    style: { animation: "none", fontFamily: "Roboto", fontWeight: 700, fontSize: 42, textColor: "#0F172A", highlightColor: "#000000", strokeWidth: 0, strokeColor: "#000000", shadow: false, uppercase: false, pillBackground: "#FACC15", pillPadding: 6, pillRadius: 6 },
  },
  {
    id: "CINEMATIC_SUBTITLE",
    name: "Cinema Subtitle",
    aliases: ["cinematic", "cinema", "movie subtitle", "film subtitle"],
    style: { animation: "none", fontFamily: "Bebas Neue", fontWeight: 400, fontSize: 48, textColor: "#F8FAFC", highlightColor: "#F59E0B", strokeWidth: 1, strokeColor: "#0F172A", shadow: true, uppercase: true },
  },
  {
    id: "RAJ_SHAMANI_BOLD",
    name: "Shamani Bold",
    aliases: ["raj shamani", "shamani", "podcast bold"],
    style: { animation: "word_pop", fontFamily: "Montserrat", fontWeight: 800, fontSize: 50, textColor: "#FFFFFF", highlightColor: "#FFD60A", strokeWidth: 3, strokeColor: "#000000", shadow: true, uppercase: false },
  },
  {
    id: "VARUN_MAYYA_BOX",
    name: "Mayya Box",
    aliases: ["varun mayya", "mayya", "word box", "box highlight"],
    style: { animation: "word_box", fontFamily: "Inter", fontWeight: 700, fontSize: 46, textColor: "#FFFFFF", highlightColor: "#7C3AED", strokeWidth: 0, strokeColor: "#000000", shadow: true, uppercase: false },
  },
  {
    id: "IMAN_GADZHI_LUXE",
    name: "Gadzhi Luxe",
    aliases: ["iman gadzhi", "gadzhi", "luxe", "luxury"],
    style: { animation: "word_reveal", fontFamily: "Inter", fontWeight: 500, fontSize: 38, textColor: "#FFFFFF", highlightColor: "#D4AF37", strokeWidth: 0, strokeColor: "#000000", shadow: true, uppercase: false },
  },
  {
    id: "MUMBAI_BUBBLE",
    name: "Mumbai Bubble",
    aliases: ["mumbai", "bubble", "desi bubble", "bubble style"],
    style: { animation: "word_box", fontFamily: "Baloo 2", fontWeight: 800, fontSize: 48, textColor: "#FFFFFF", highlightColor: "#FF5A1F", strokeWidth: 0, strokeColor: "#000000", shadow: false, uppercase: false, pillBackground: "#111827E6", pillPadding: 10, pillRadius: 22 },
  },
];

const key = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** The template with this id, display name or alias (case and punctuation are ignored). */
export function resolveCaptionTemplate(nameOrId?: string | null): CaptionTemplate | undefined {
  if (!nameOrId) return undefined;
  const k = key(nameOrId);
  if (!k) return undefined;
  return CAPTION_TEMPLATES.find((t) => key(t.id) === k || key(t.name) === k || t.aliases.includes(k));
}

/** The template a free-text request names ("mr beast style captions"), longest alias first. */
export function findCaptionTemplateInText(text: string): CaptionTemplate | undefined {
  const k = ` ${key(text)} `;
  let best: { t: CaptionTemplate; len: number } | undefined;
  for (const t of CAPTION_TEMPLATES) {
    for (const a of [key(t.name), ...t.aliases]) {
      if (k.includes(` ${a} `) && (!best || a.length > best.len)) best = { t, len: a.length };
    }
  }
  return best?.t;
}
