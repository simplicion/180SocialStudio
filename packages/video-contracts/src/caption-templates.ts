/**
 * Caption templates (creator looks). One catalog for the AI Director and the clients: ids and values match
 * `viralCaptionPresets` in the Flutter app (timeline_ops.dart) and `CAPTION_STYLE_PRESETS` in
 * CaptionStudioModal.tsx. Font sizes and stroke widths are canvas pixels.
 *
 * NOTE on creator names: Real people's names (MrBeast, Hormozi, Raj Shamani, etc.) are strictly kept as
 * hidden aliases in `aliases` so the AI Director maps free-text queries accurately without personality-rights
 * or trademark risk. User-facing `name` and `description` are neutral and descriptive.
 */
import type { CaptionStyleV2 } from "./caption-style-v2";

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
  description?: string;
  /** Lower-case names a creator or user may use for this look ("mr beast", "hormozi", "minimal", etc.). */
  aliases: readonly string[];
  style: CaptionTemplateStyle;
  styleV2?: CaptionStyleV2;
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
  "EDITORIAL_SERIF",
  "DOCUMENTARY_LOWER",
  "NEON_PULSE",
  "STREET_IMPACT",
  "PASTEL_CREATOR",
  "MONOCHROME_BOLD",
  "NIGHT_RETRO",
  "DYNAMIC_DUO",
] as const;
export type CaptionTemplateId = (typeof CAPTION_TEMPLATE_IDS)[number];

export const CAPTION_TEMPLATES: readonly CaptionTemplate[] = [
  {
    id: "HORMOZI_BOUNCE",
    name: "Punchy Bounce",
    description: "Ultra-bold energetic captions with spring active word and high-contrast yellow/green punch",
    aliases: ["hormozi", "alex hormozi", "hormozi viral", "punchy bounce", "punchy", "bounce", "viral bounce"],
    style: { animation: "word_pop", fontFamily: "Anton", fontWeight: 400, fontSize: 52, textColor: "#FACC15", highlightColor: "#22C55E", strokeWidth: 3, strokeColor: "#000000", shadow: true, uppercase: true },
  },
  {
    id: "MRBEAST_HYPE",
    name: "High Energy",
    description: "Heavy impact sans with black stroke and bold red keyword emphasis",
    aliases: ["mrbeast", "mr beast", "beast", "mrbeast punch", "high energy", "hype", "hype punch", "punch"],
    style: { animation: "word_pop", fontFamily: "Montserrat", fontWeight: 900, fontSize: 54, textColor: "#FFFFFF", highlightColor: "#EF4444", strokeWidth: 4, strokeColor: "#000000", shadow: true, uppercase: true },
  },
  {
    id: "ALI_ABDAAL_CLEAN",
    name: "Clean Frosted",
    description: "Aesthetic frosted background pill with soft teal karaoke progression",
    aliases: ["ali abdaal", "abdaal", "ali abdal", "abdal", "clean frosted", "modern pill", "aesthetic", "clean pill"],
    style: { animation: "karaoke", fontFamily: "Poppins", fontWeight: 600, fontSize: 44, textColor: "#FFFFFF", highlightColor: "#14B8A6", strokeWidth: 0, strokeColor: "#000000", shadow: true, uppercase: false, pillBackground: "#00000073", pillPadding: 6, pillRadius: 14 },
  },
  {
    id: "DAN_KOE_MINIMAL",
    name: "Minimal Clean",
    description: "Restrained geometric typography with subtle emphasis for deep-thought videos",
    aliases: ["dan koe", "minimal", "minimalist", "clean minimal", "dan koe clean", "pure minimal"],
    style: { animation: "none", fontFamily: "Syne", fontWeight: 700, fontSize: 40, textColor: "#FFFFFF", highlightColor: "#94A3B8", strokeWidth: 0, strokeColor: "#000000", shadow: false, uppercase: false },
  },
  {
    id: "CYBER_NEON",
    name: "Cyber Neon",
    description: "Vibrant glowing outline with hot pink keyword pop for tech and gaming shorts",
    aliases: ["neon", "cyber", "cyber neon", "glow", "neon glow", "synth neon"],
    style: { animation: "word_pop", fontFamily: "Outfit", fontWeight: 800, fontSize: 48, textColor: "#38BDF8", highlightColor: "#EC4899", strokeWidth: 1, strokeColor: "#0284C7", shadow: false, uppercase: false, glow: true },
  },
  {
    id: "KARAOKE_FROSTED",
    name: "Frosted Karaoke",
    description: "Dark rounded pill container with amber active word sweep",
    aliases: ["frosted", "frosted pill", "pill", "karaoke pill", "frosted karaoke"],
    style: { animation: "karaoke", fontFamily: "Inter", fontWeight: 800, fontSize: 46, textColor: "#FFFFFF", highlightColor: "#FBBF24", strokeWidth: 0, strokeColor: "#000000", shadow: true, uppercase: false, pillBackground: "#0F172AD9", pillPadding: 10, pillRadius: 20 },
  },
  {
    id: "VOX_EXPLAINER",
    name: "Highlighter Tag",
    description: "Bright yellow marker tag with dark slate text for explainers and documentary shorts",
    aliases: ["vox", "explainer", "highlighter", "vox explainer", "highlight tag", "marker"],
    style: { animation: "none", fontFamily: "Roboto", fontWeight: 700, fontSize: 42, textColor: "#0F172A", highlightColor: "#000000", strokeWidth: 0, strokeColor: "#000000", shadow: false, uppercase: false, pillBackground: "#FACC15", pillPadding: 6, pillRadius: 6 },
  },
  {
    id: "CINEMATIC_SUBTITLE",
    name: "Cinema Classic",
    description: "Condensed all-caps film subtitle with subtle bottom-heavy anchor and fine outline",
    aliases: ["cinematic", "cinema", "movie subtitle", "film subtitle", "cinema classic", "cinema subtitle"],
    style: { animation: "none", fontFamily: "Bebas Neue", fontWeight: 400, fontSize: 48, textColor: "#F8FAFC", highlightColor: "#F59E0B", strokeWidth: 1, strokeColor: "#0F172A", shadow: true, uppercase: true },
  },
  {
    id: "RAJ_SHAMANI_BOLD",
    name: "Podcast Punch",
    description: "Thick bold sans with golden yellow highlight, optimised for talking-head conversations",
    aliases: ["raj shamani", "shamani", "podcast bold", "podcast punch", "bold talk", "podcast"],
    style: { animation: "word_pop", fontFamily: "Montserrat", fontWeight: 800, fontSize: 50, textColor: "#FFFFFF", highlightColor: "#FFD60A", strokeWidth: 3, strokeColor: "#000000", shadow: true, uppercase: false },
  },
  {
    id: "VARUN_MAYYA_BOX",
    name: "Electric Box",
    description: "Sleek sliding purple pill box behind the active word for modern tech storytelling",
    aliases: ["varun mayya", "mayya", "word box", "box highlight", "electric box", "tech box"],
    style: { animation: "word_box", fontFamily: "Inter", fontWeight: 700, fontSize: 46, textColor: "#FFFFFF", highlightColor: "#7C3AED", strokeWidth: 0, strokeColor: "#000000", shadow: true, uppercase: false },
  },
  {
    id: "IMAN_GADZHI_LUXE",
    name: "Luxe Minimal",
    description: "Understated luxury look with word fade-in reveal and warm metallic gold accent",
    aliases: ["iman gadzhi", "gadzhi", "luxe", "luxury", "luxe minimal", "gold luxe", "quiet luxury"],
    style: { animation: "word_reveal", fontFamily: "Inter", fontWeight: 500, fontSize: 38, textColor: "#FFFFFF", highlightColor: "#D4AF37", strokeWidth: 0, strokeColor: "#000000", shadow: true, uppercase: false },
  },
  {
    id: "MUMBAI_BUBBLE",
    name: "Vibrant Bubble",
    description: "Playful rounded desi bubble with warm orange box indicator for dynamic vlogs",
    aliases: ["mumbai", "bubble", "desi bubble", "bubble style", "mumbai bubble", "vibrant bubble"],
    style: { animation: "word_box", fontFamily: "Baloo 2", fontWeight: 800, fontSize: 48, textColor: "#FFFFFF", highlightColor: "#FF5A1F", strokeWidth: 0, strokeColor: "#000000", shadow: false, uppercase: false, pillBackground: "#111827E6", pillPadding: 10, pillRadius: 22 },
  },
  {
    id: "EDITORIAL_SERIF",
    name: "Editorial Serif",
    description: "Sophisticated serif typography with subtle gold emphasis for fashion and culture reels",
    aliases: ["editorial", "serif", "editorial serif", "vogue", "magazine", "fashion serif"],
    style: { animation: "none", fontFamily: "Playfair Display", fontWeight: 700, fontSize: 44, textColor: "#FFFFFF", highlightColor: "#E2BA65", strokeWidth: 1, strokeColor: "#1E293B", shadow: true, uppercase: false },
  },
  {
    id: "DOCUMENTARY_LOWER",
    name: "Documentary Lower",
    description: "Clean lower-third documentary presentation with translucent pill and sky blue karaoke",
    aliases: ["documentary", "doc", "documentary lower", "lower third", "natgeo", "bbc", "journalism"],
    style: { animation: "karaoke", fontFamily: "Roboto", fontWeight: 500, fontSize: 40, textColor: "#F1F5F9", highlightColor: "#38BDF8", strokeWidth: 0, strokeColor: "#000000", shadow: false, uppercase: false, pillBackground: "#020617CC", pillPadding: 8, pillRadius: 10 },
  },
  {
    id: "NEON_PULSE",
    name: "Neon Pulse",
    description: "High-saturation cyberpunk violet with cyan pulse effect for EDM and fast edits",
    aliases: ["neon pulse", "synthwave", "pulse", "vaporwave", "cyber pulse", "glow pulse"],
    style: { animation: "word_pop", fontFamily: "Outfit", fontWeight: 900, fontSize: 50, textColor: "#F0ABFC", highlightColor: "#22D3EE", strokeWidth: 2, strokeColor: "#701A75", shadow: false, uppercase: true, glow: true },
  },
  {
    id: "STREET_IMPACT",
    name: "Street Impact",
    description: "Gritty urban all-caps with heavy double black stroke and fiery yellow active pop",
    aliases: ["street", "impact", "street impact", "urban", "heavy impact", "grunge"],
    style: { animation: "word_pop", fontFamily: "Bebas Neue", fontWeight: 400, fontSize: 58, textColor: "#F97316", highlightColor: "#FEF08A", strokeWidth: 4, strokeColor: "#000000", shadow: true, uppercase: true },
  },
  {
    id: "PASTEL_CREATOR",
    name: "Soft Pastel",
    description: "Gentle warm cream letters over deep navy pill with lilac karaoke highlighting",
    aliases: ["pastel", "soft", "soft pastel", "lifestyle", "creator pastel", "vlog pastel"],
    style: { animation: "karaoke", fontFamily: "Poppins", fontWeight: 600, fontSize: 42, textColor: "#FEF3C7", highlightColor: "#C084FC", strokeWidth: 0, strokeColor: "#000000", shadow: false, uppercase: false, pillBackground: "#1E1B4BD9", pillPadding: 8, pillRadius: 16 },
  },
  {
    id: "MONOCHROME_BOLD",
    name: "Monochrome Bold",
    description: "Stark Swiss black-and-white high-contrast block for modern corporate and design reels",
    aliases: ["monochrome", "mono", "monochrome bold", "swiss", "black and white", "bw"],
    style: { animation: "none", fontFamily: "Inter", fontWeight: 900, fontSize: 48, textColor: "#FFFFFF", highlightColor: "#000000", strokeWidth: 0, strokeColor: "#000000", shadow: false, uppercase: true, pillBackground: "#000000EE", pillPadding: 10, pillRadius: 8 },
  },
  {
    id: "NIGHT_RETRO",
    name: "Night Retro",
    description: "Warm amber arcade glow with sequential word reveal for nostalgic and retro formats",
    aliases: ["retro", "night retro", "vintage", "arcade", "80s", "amber retro"],
    style: { animation: "word_reveal", fontFamily: "Space Grotesk", fontWeight: 700, fontSize: 44, textColor: "#FDE047", highlightColor: "#FB923C", strokeWidth: 1, strokeColor: "#78350F", shadow: true, uppercase: true },
  },
  {
    id: "DYNAMIC_DUO",
    name: "Dual Gradient",
    description: "Two-tone rose-coral pop over crisp white type with spring motion for lifestyle content",
    aliases: ["gradient", "dual gradient", "dynamic duo", "sunset gradient", "coral gradient"],
    style: { animation: "word_pop", fontFamily: "Montserrat", fontWeight: 800, fontSize: 52, textColor: "#F8FAFC", highlightColor: "#F43F5E", strokeWidth: 3, strokeColor: "#0F172A", shadow: true, uppercase: true },
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
