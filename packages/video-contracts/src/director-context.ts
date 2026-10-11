import { z } from "zod";
import { fenceUntrusted } from "./untrusted-content";

/**
 * Brand + script context for the AI Director (WS5). Everything here is pure and deterministic:
 * the server loads the brand profile and the calendar piece / post, turns them into a
 * `DirectorContext`, and these helpers derive style defaults, the opening proposal and the
 * script alignment from it. No I/O, no LLM.
 * Contract doc: docs/social-studio-mobile/AI_DIRECTOR_CONTRACT.md §2.3–2.5
 */

const HEX = /^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/;

export type AspectRatio = "16:9" | "9:16" | "1:1" | "4:5";

export interface DirectorBrandContext {
  projectId: string;
  name?: string;
  brandType?: string;
  positioning?: string;
  tagline?: string;
  colors: { primary?: string; accent?: string; background?: string; text?: string };
  logoUrl?: string | null;
  font?: string;
  captionStylePreset?: string;
  watermarkEnabled?: boolean;
  tone?: string;
  targetAudience?: string;
  targetPlatforms?: string[];
  forbiddenWords?: string[];
  standardCtas?: string[];
  /** Free-text brand brief for the planner prompt (WS1 `toPromptContext()` when available). */
  promptContext?: string;
  /**
   * WS1 `resolveBrandRendering()` output, computed by the server. When present the style agent uses
   * it for colours/font/caption preset/watermark, so neutral defaults are explicit (listed in
   * `usedDefaults`, reported as warnings) and never saved to the brand.
   */
  rendering?: DirectorBrandRendering;
  /** Project autonomy policy (editing AUTO|ASSISTED|MANUAL). Absent = the ASSISTED default. */
  autonomy?: { editing: "AUTO" | "ASSISTED" | "MANUAL"; publishing: "ASSISTED" | "MANUAL" };
}

export interface DirectorBrandRendering {
  colors: { primary: string; accent: string; background: string; text: string };
  font: string;
  captionStylePreset: string;
  watermarkEnabled: boolean;
  logoUrl?: string | null;
  /** Fields filled with neutral render defaults, e.g. "colors.accent", "font". */
  usedDefaults: string[];
}

export interface DirectorScriptSection {
  /** "hook" | "problem" | "solution" | "retention" | "cta" | "body" */
  kind: string;
  text: string;
}

export interface DirectorPieceContext {
  calendarPieceId?: string;
  postId?: string;
  headline?: string;
  platform?: string;
  contentType?: string;
  dayLabel?: string;
  hook?: string;
  sections: DirectorScriptSection[];
  callToAction?: string;
  targetDurationSec?: number;
}

export interface DirectorContext {
  brand?: DirectorBrandContext;
  piece?: DirectorPieceContext;
  /** Non-fatal problems while loading (e.g. "brand profile not found"). */
  warnings: string[];
}

/** Fonts the mobile renderer can draw without the client supplying a font file. */
export const MOBILE_RENDERER_FONTS = ["Inter"];

const CAPTION_PRESETS = ["HORMOZI_BOUNCE", "ALI_ABDAAL_CLEAN", "MINIMAL_SUBTITLE", "BOLD_CENTER"] as const;
export type BrandCaptionPreset = (typeof CAPTION_PRESETS)[number];

// ---------------------------------------------------------------------------------------------
// Watermark (mobile-editir/1 optional field)
// ---------------------------------------------------------------------------------------------

export const MobileWatermarkSchema = z.object({
  /** HTTPS image (PNG with alpha preferred). The client downloads it and passes a local path to the renderer. */
  imageUrl: z.string().url().refine((u) => /^https:\/\//i.test(u), "watermark imageUrl must be https"),
  position: z.enum(["top_left", "top_right", "bottom_left", "bottom_right"]).default("top_right"),
  /** 0..100 */
  opacityPct: z.number().min(0).max(100).default(85),
  /** Logo width as a fraction of the canvas width (0.04..0.5). Height keeps the image aspect. */
  widthFraction: z.number().min(0.04).max(0.5).default(0.14),
  localPath: z.string().optional(),
  x: z.number().min(0).max(1).optional(),
  y: z.number().min(0).max(1).optional(),
  width: z.number().min(0).max(1).optional(),
  height: z.number().min(0).max(1).optional(),
});
export type MobileWatermark = z.infer<typeof MobileWatermarkSchema>;

export function brandWatermark(brand?: DirectorBrandContext): MobileWatermark | null {
  if (!brand?.logoUrl || !/^https:\/\//i.test(brand.logoUrl)) return null;
  // Top-right keeps it clear of captions (bottom third) and of platform UI on the left.
  return { imageUrl: brand.logoUrl, position: "top_right", opacityPct: 85, widthFraction: 0.14 };
}

// ---------------------------------------------------------------------------------------------
// Style defaults from the brand
// ---------------------------------------------------------------------------------------------

export interface BrandStyleDefaults {
  textColor: string;
  highlightColor: string;
  captionPreset: BrandCaptionPreset;
  fontFamily: string;
  pacing: "fast" | "balanced" | "calm";
  /** Zoom scale that fits the pacing. */
  zoomScale: number;
  transition: "CUT" | "CROSSFADE";
  /** Add the brand logo as a watermark (a logo exists and the brand did not turn it off). */
  watermark: boolean;
  warnings: string[];
}

function hexOk(v?: string | null): v is string {
  return !!v && HEX.test(v);
}

/** Relative luminance 0..1 of #RRGGBB. */
export function luminance(hex: string): number {
  const h = hex.replace("#", "").slice(0, 6);
  const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

export function pacingFromTone(tone?: string): BrandStyleDefaults["pacing"] {
  const t = (tone || "").toLowerCase();
  if (/(energetic|bold|hype|punchy|fun|playful|viral|aggressive|urgent|excit)/.test(t)) return "fast";
  if (/(calm|minimal|luxury|elegant|serene|thoughtful|premium|soft|mindful)/.test(t)) return "calm";
  return "balanced";
}

/**
 * Applies the server-resolved rendering (WS1 `resolveBrandRendering`) to the brand: the brand's own
 * values, and neutral defaults for the gaps. A default accent is only used when the brand has
 * neither accent nor primary, so a brand primary is never replaced by a grey default.
 */
function withRendering(brand: DirectorBrandContext | undefined, warnings: string[]): DirectorBrandContext | undefined {
  const r = brand?.rendering;
  if (!brand || !r) return brand;
  const set = (k: keyof DirectorBrandRendering["colors"]) => (r.usedDefaults.includes(`colors.${k}`) ? undefined : r.colors[k]);
  const colors: DirectorBrandContext["colors"] = { primary: set("primary"), accent: set("accent"), background: set("background"), text: r.colors.text };
  if (!colors.accent && !colors.primary) colors.accent = r.colors.accent;
  if (r.usedDefaults.length) {
    warnings.push(`brand profile does not set ${r.usedDefaults.join(", ")}: neutral render defaults are used for this edit (not saved to the brand)`);
  }
  return {
    ...brand,
    colors,
    font: r.font,
    captionStylePreset: r.captionStylePreset,
    watermarkEnabled: r.watermarkEnabled,
    logoUrl: r.logoUrl !== undefined ? r.logoUrl : brand.logoUrl,
  };
}

export function brandStyleDefaults(inputBrand?: DirectorBrandContext): BrandStyleDefaults {
  const warnings: string[] = [];
  const brand = withRendering(inputBrand, warnings);
  const colors = brand?.colors || {};
  // Highlight = the brand colour that stands out on video: accent first, then primary.
  let highlight = hexOk(colors.accent) ? colors.accent : hexOk(colors.primary) ? colors.primary : "#FFE600";
  // A near-black highlight is invisible on a black stroke; fall back to the other brand colour.
  if (luminance(highlight) < 0.08 && hexOk(colors.primary) && luminance(colors.primary) >= 0.08) highlight = colors.primary;
  let text = hexOk(colors.text) ? colors.text : "#FFFFFF";
  // Captions sit on footage with a black stroke: dark body text is unreadable, so keep white.
  if (luminance(text) < 0.35) text = "#FFFFFF";
  const rawPreset = (brand?.captionStylePreset || "").toUpperCase();
  const captionPreset: BrandCaptionPreset = (CAPTION_PRESETS as readonly string[]).includes(rawPreset)
    ? (rawPreset as BrandCaptionPreset)
    : "HORMOZI_BOUNCE";
  let fontFamily = "Inter";
  const wanted = (brand?.font || "").trim();
  if (wanted) {
    const hit = MOBILE_RENDERER_FONTS.find((f) => f.toLowerCase() === wanted.toLowerCase());
    if (hit) fontFamily = hit;
    else warnings.push(`brand font "${wanted}" is not available in the mobile renderer; captions use Inter`);
  }
  const pacing = pacingFromTone(brand?.tone);
  return {
    textColor: text.toUpperCase(),
    highlightColor: highlight.toUpperCase(),
    captionPreset,
    fontFamily,
    pacing,
    zoomScale: pacing === "fast" ? 1.35 : pacing === "calm" ? 1.12 : 1.22,
    transition: pacing === "calm" ? "CROSSFADE" : "CUT",
    watermark: !!brand?.logoUrl && brand.watermarkEnabled !== false,
    warnings,
  };
}

// ---------------------------------------------------------------------------------------------
// Platform → aspect / duration
// ---------------------------------------------------------------------------------------------

export function aspectForPlatform(platform?: string, contentType?: string): AspectRatio | null {
  const p = `${platform || ""} ${contentType || ""}`.toLowerCase();
  if (/(reel|tiktok|short|story|stories)/.test(p)) return "9:16";
  if (/(instagram|facebook)/.test(p)) return /(video|reel)/.test(p) || !contentType ? "9:16" : "4:5";
  if (/linkedin/.test(p)) return "4:5";
  if (/(youtube)/.test(p)) return /short/.test(p) ? "9:16" : "16:9";
  if (/(twitter|\bx\b)/.test(p)) return "16:9";
  return null;
}

export function platformLabel(platform?: string, contentType?: string): string {
  const p = (platform || "").toLowerCase();
  const c = (contentType || "").toLowerCase();
  if (p.includes("instagram")) return c.includes("reel") || !c ? "Reels" : "Instagram";
  if (p.includes("tiktok")) return "TikTok";
  if (p.includes("youtube")) return c.includes("short") || p.includes("short") ? "Shorts" : "YouTube";
  if (p.includes("linkedin")) return "LinkedIn";
  if (p.includes("facebook")) return "Facebook";
  if (p === "x" || p.includes("twitter")) return "X";
  return platform || "social";
}

/** Platform default length cap in seconds (used when the piece has no target duration). */
export function platformMaxDurationSec(platform?: string, contentType?: string): number | null {
  const label = platformLabel(platform, contentType);
  if (label === "Reels" || label === "TikTok" || label === "Shorts") return label === "Shorts" ? 60 : 90;
  return null;
}

// ---------------------------------------------------------------------------------------------
// Script parsing and transcript alignment (transcript words only; no media on the server)
// ---------------------------------------------------------------------------------------------

/** Parses `videoScriptOrHooks` (JSON from the calendar agent, or plain text) into sections. */
export function parsePieceScript(raw: unknown): { hook?: string; sections: DirectorScriptSection[]; callToAction?: string } {
  let data: any = raw;
  if (typeof raw === "string") {
    const s = raw.trim();
    if (s.startsWith("{")) {
      try {
        data = JSON.parse(s);
      } catch {
        data = s;
      }
    } else data = s;
  }
  const sections: DirectorScriptSection[] = [];
  if (data && typeof data === "object") {
    const tp = data.teleprompterScript || data.script || data;
    const push = (kind: string, v: unknown) => {
      if (typeof v === "string" && v.trim()) sections.push({ kind, text: v.trim() });
    };
    push("hook", tp.hook);
    push("problem", tp.problem);
    push("solution", tp.solution);
    if (Array.isArray(tp.actionSteps)) tp.actionSteps.forEach((st: unknown) => push("solution", st));
    push("retention", tp.retentionLoop);
    push("cta", tp.callToAction || tp.cta);
    if (sections.length === 0 && typeof tp.body === "string") push("body", tp.body);
    const hook = sections.find((x) => x.kind === "hook")?.text || (typeof data.hook === "string" ? data.hook : undefined);
    return { hook, sections, callToAction: sections.find((x) => x.kind === "cta")?.text };
  }
  if (typeof data === "string" && data) {
    // Plain text: first sentence is the hook, the rest is the body.
    const sentences = data.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
    if (sentences.length) sections.push({ kind: "hook", text: sentences[0] });
    if (sentences.length > 1) sections.push({ kind: "body", text: sentences.slice(1).join(" ") });
    return { hook: sentences[0], sections };
  }
  return { sections };
}

export function normalizeToken(t: string): string {
  return t.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}']/gu, "").replace(/'/g, "");
}

const STOP = new Set(["the", "a", "an", "and", "or", "to", "of", "in", "on", "is", "it", "you", "i", "that", "this", "for", "with", "are", "be", "so", "um", "uh", "like"]);

function tokens(text: string): string[] {
  return text.split(/\s+/).map(normalizeToken).filter(Boolean);
}

interface Word { text: string; startMs: number; endMs: number }

/**
 * Scores the window of transcript tokens starting at `s` against the section (fraction of the
 * section's tokens present). The window stops early at a restart: when the section's opening
 * token comes round again after being matched, which is how a re-recorded line looks.
 */
function windowAt(want: Map<string, number>, n: number, first: string, norm: string[], s: number): { start: number; end: number; score: number } {
  const win = Math.max(1, Math.round(n * 1.25));
  const e = Math.min(norm.length, s + win);
  const have = new Map<string, number>();
  let hits = 0;
  let last = s;
  for (let i = s; i < e; i++) {
    const t = norm[i];
    if (i > s && t === first && (have.get(t) || 0) >= (want.get(t) || 0)) break;
    const cap = want.get(t) || 0;
    const cur = have.get(t) || 0;
    if (cur < cap) {
      hits++;
      have.set(t, cur + 1);
      last = i;
    }
  }
  return { start: s, end: last, score: hits / n };
}

function prep(sectionTokens: string[]) {
  const want = new Map<string, number>();
  for (const t of sectionTokens) want.set(t, (want.get(t) || 0) + 1);
  return { want, n: sectionTokens.length, first: sectionTokens[0] };
}

/** Best window anywhere from `from` (used to report the closest miss). */
function bestWindow(sectionTokens: string[], norm: string[], from = 0): { start: number; end: number; score: number } | null {
  if (sectionTokens.length === 0 || norm.length === 0) return null;
  const { want, n, first } = prep(sectionTokens);
  let best: { start: number; end: number; score: number } | null = null;
  for (let s = from; s < norm.length; s++) {
    if (!want.has(norm[s])) continue;
    const w = windowAt(want, n, first, norm, s);
    if (!best || w.score > best.score + 1e-9) best = w;
  }
  return best;
}

/** First acceptable take at or after `from` (sequential scan, so earlier re-records are found too). */
function nextTake(sectionTokens: string[], norm: string[], from: number, threshold: number): { start: number; end: number; score: number } | null {
  if (sectionTokens.length === 0) return null;
  const { want, n, first } = prep(sectionTokens);
  for (let s = from; s < norm.length; s++) {
    if (!want.has(norm[s])) continue;
    const w = windowAt(want, n, first, norm, s);
    if (w.score >= threshold) return w;
  }
  return null;
}

export interface ScriptTake { startMs: number; endMs: number; score: number; wordCount: number }

export interface ScriptAlignment {
  /** Source ms where the scripted hook starts being spoken, or null when it was not found. */
  hookStartMs: number | null;
  /** Speech before the hook (false starts, "ok recording", etc.). */
  preHookSpeechMs: number;
  sections: Array<{ kind: string; text: string; found: boolean; score: number; startMs: number | null; endMs: number | null }>;
  missingSections: string[];
  /** Spoken ranges that match no script section (ad-libs, tangents), ≥ 1.5 s. */
  extraRanges: Array<{ startMs: number; endMs: number; text: string }>;
  /** Sections that were spoken more than once, with the recommended take. */
  repeatedTakes: Array<{ kind: string; takes: ScriptTake[]; bestIndex: number }>;
  coverage: number;
}

const FOUND = 0.5;

/**
 * Aligns the script with the transcript. Deterministic fuzzy matching on normalized tokens:
 * - each section is located by the best window of transcript words that covers its tokens
 * - sections found twice or more (same line re-recorded) are reported as repeated takes; the
 *   best take is the most complete one, ties going to the later take (creators usually nail it last)
 * - transcript runs that match nothing are "extra"
 */
export function alignScriptToTranscript(sections: DirectorScriptSection[], words: Word[]): ScriptAlignment {
  const norm = words.map((w) => normalizeToken(w.text));
  const covered = new Array(words.length).fill(false);
  const out: ScriptAlignment["sections"] = [];
  const repeated: ScriptAlignment["repeatedTakes"] = [];
  for (const sec of sections) {
    const st = tokens(sec.text);
    const content = st.filter((t) => !STOP.has(t));
    const use = content.length >= 2 ? content : st;
    // Match on content words only (stop words make every window look similar).
    const normContent = norm.map((t) => (use === content && STOP.has(t) ? "" : t));
    // Find every take: scan from the start, not only after the cursor, so re-records before are seen.
    const takes: Array<{ start: number; end: number; score: number }> = [];
    let from = 0;
    while (from < normContent.length) {
      const w = nextTake(use, normContent, from, FOUND);
      if (!w) break;
      takes.push(w);
      from = w.end + 1;
    }
    if (takes.length === 0) {
      const w = bestWindow(use, normContent, 0);
      out.push({ kind: sec.kind, text: sec.text, found: false, score: w ? round2(w.score) : 0, startMs: null, endMs: null });
      continue;
    }
    // Prefer a take at/after the cursor for the section's position; best take = highest score, later on ties.
    let bestIndex = 0;
    takes.forEach((t, i) => {
      const b = takes[bestIndex];
      if (t.score > b.score + 0.05 || (Math.abs(t.score - b.score) <= 0.05 && t.start >= b.start)) bestIndex = i;
    });
    for (const t of takes) for (let i = t.start; i <= t.end; i++) covered[i] = true;
    const best = takes[bestIndex];
    out.push({ kind: sec.kind, text: sec.text, found: true, score: round2(best.score), startMs: words[best.start].startMs, endMs: words[best.end].endMs });
    if (takes.length > 1) {
      repeated.push({
        kind: sec.kind,
        takes: takes.map((t) => ({ startMs: words[t.start].startMs, endMs: words[t.end].endMs, score: round2(t.score), wordCount: t.end - t.start + 1 })),
        bestIndex,
      });
    }
  }
  // Hook start: the best take of the hook (a fluffed first attempt is not the hook).
  const hookRep = repeated.find((r) => r.kind === "hook");
  const hookSec = out.find((s) => s.kind === "hook" && s.found);
  const hookStartMs = hookRep ? hookRep.takes[hookRep.bestIndex].startMs : hookSec ? hookSec.startMs : null;
  const firstWordMs = words[0]?.startMs ?? 0;
  const preHookSpeechMs = hookStartMs != null ? Math.max(0, hookStartMs - firstWordMs) : 0;

  const extraRanges: ScriptAlignment["extraRanges"] = [];
  let i = 0;
  while (i < words.length) {
    if (covered[i] || !norm[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < words.length && !covered[j + 1]) j++;
    const s = words[i].startMs;
    const e = words[j].endMs;
    if (e - s >= 1500) extraRanges.push({ startMs: s, endMs: e, text: words.slice(i, j + 1).map((w) => w.text).join(" ").slice(0, 200) });
    i = j + 1;
  }
  const foundCount = out.filter((s) => s.found).length;
  return {
    hookStartMs,
    preHookSpeechMs,
    sections: out,
    missingSections: out.filter((s) => !s.found).map((s) => s.kind),
    extraRanges,
    repeatedTakes: repeated,
    coverage: sections.length ? round2(foundCount / sections.length) : 0,
  };
}

const round2 = (v: number) => Math.round(v * 100) / 100;

// ---------------------------------------------------------------------------------------------
// B-roll research: visual queries from transcript entities (deterministic)
// ---------------------------------------------------------------------------------------------

const VISUAL_STOP = new Set([
  ...STOP, "here", "there", "thing", "things", "people", "most", "they", "them", "their", "we", "our", "my", "me", "your", "yours",
  "do", "does", "dont", "did", "not", "no", "yes", "just", "really", "very", "way", "too", "need", "want", "get", "got", "go", "going",
  "first", "every", "single", "time", "times", "day", "days", "month", "because", "what", "when", "where", "why", "how", "who", "which",
  "stop", "doing", "make", "made", "know", "think", "say", "said", "see", "look", "will", "would", "can", "could", "should", "have", "has",
  "had", "been", "was", "were", "then", "than", "also", "only", "even", "about", "into", "out", "up", "down", "over", "more", "less",
  "punchline", "okay", "ok", "right", "well", "gonna", "let", "lets", "one", "two", "three", "twenty", "hours", "minutes", "and",
]);

export interface BrollQuery { query: string; atMs: number; durationMs: number; score: number }

/**
 * Picks up to `max` concrete nouns/entities from the transcript as stock search phrases, spread
 * across the video (never in the first 3 s, where the hook and face should stay on screen).
 */
export function extractBrollQueries(words: Word[], opts: { max?: number; minGapMs?: number; skipBeforeMs?: number } = {}): BrollQuery[] {
  const max = opts.max ?? 3;
  const minGap = opts.minGapMs ?? 4000;
  const skip = opts.skipBeforeMs ?? 3000;
  const freq = new Map<string, number>();
  const norm = words.map((w) => normalizeToken(w.text));
  norm.forEach((t) => {
    if (t.length >= 4 && !VISUAL_STOP.has(t)) freq.set(t, (freq.get(t) || 0) + 1);
  });
  const candidates: BrollQuery[] = [];
  words.forEach((w, i) => {
    const t = norm[i];
    if (!freq.has(t) || w.startMs < skip) return;
    const capital = /^[A-Z]/.test(w.text) && i > 0 && !/[.!?]$/.test(words[i - 1].text);
    const score = (freq.get(t) || 0) + t.length / 10 + (capital ? 1 : 0);
    // Two-word phrase when the neighbour is also a content word ("gym workout").
    const next = norm[i + 1];
    const q = next && freq.has(next) && next !== t ? `${t} ${next}` : t;
    candidates.push({ query: q, atMs: Math.max(0, w.startMs - 150), durationMs: 2500, score });
  });
  candidates.sort((a, b) => b.score - a.score || a.atMs - b.atMs);
  const picked: BrollQuery[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    const key = c.query.split(" ")[0];
    if (seen.has(key)) continue;
    if (picked.some((p) => Math.abs(p.atMs - c.atMs) < minGap)) continue;
    picked.push(c);
    seen.add(key);
    if (picked.length >= max) break;
  }
  return picked.sort((a, b) => a.atMs - b.atMs);
}

// ---------------------------------------------------------------------------------------------
// Music mood from brand tone
// ---------------------------------------------------------------------------------------------

export function musicMoodForBrand(brand?: DirectorBrandContext): string {
  const pacing = pacingFromTone(brand?.tone);
  const t = (brand?.tone || "").toLowerCase();
  if (/(warm|friendly|authentic|human)/.test(t)) return "acoustic warm";
  if (/(cinematic|epic|inspir)/.test(t)) return "cinematic epic";
  return pacing === "fast" ? "upbeat energetic" : pacing === "calm" ? "calm ambient piano" : "lofi chill";
}

// ---------------------------------------------------------------------------------------------
// Promise timeout
// ---------------------------------------------------------------------------------------------

export class DirectorTimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms} ms`);
    this.name = "DirectorTimeoutError";
  }
}

export function withTimeout<T>(p: Promise<T>, ms: number, label = "operation"): Promise<T> {
  let timer: any;
  return Promise.race([
    p.finally(() => clearTimeout(timer)),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new DirectorTimeoutError(label, ms)), ms);
    }),
  ]);
}

/** Short prompt-ready description of brand + piece for the planner. */
export function describeDirectorContext(ctx: DirectorContext, style: BrandStyleDefaults, align?: ScriptAlignment | null): string[] {
  const lines: string[] = [];
  const b = ctx.brand;
  if (b) {
    lines.push(`## Brand (apply by default unless the creator asks otherwise)`);
    if (b.promptContext) lines.push(b.promptContext.slice(0, 2500));
    else {
      lines.push(`- ${b.name || "Brand"}${b.positioning ? `: ${b.positioning}` : ""}${b.tagline ? ` ("${b.tagline}")` : ""}`);
      if (b.tone) lines.push(`- tone: ${b.tone}`);
      if (b.targetAudience) lines.push(`- audience: ${b.targetAudience}`);
    }
    lines.push(`- caption colours: text ${style.textColor}, highlight ${style.highlightColor}; caption stylePreset ${style.captionPreset}; pacing ${style.pacing} (zoom scale ~${style.zoomScale})`);
    if (b.logoUrl) lines.push(`- brand logo available: the server adds it as a watermark when finish_edit sets brandWatermark "add"`);
    if (b.forbiddenWords?.length) lines.push(`- never put these words on screen: ${b.forbiddenWords.slice(0, 30).join(", ")}`);
    lines.push(``);
  }
  const p = ctx.piece;
  if (p) {
    lines.push(`## Calendar piece`);
    if (p.headline) lines.push(`- title: ${p.headline}`);
    if (p.platform) lines.push(`- platform: ${p.platform}${p.contentType ? ` (${p.contentType})` : ""}; target aspect ${aspectForPlatform(p.platform, p.contentType) || "unchanged"}`);
    if (p.targetDurationSec) lines.push(`- target length: under ${p.targetDurationSec}s`);
    if (p.sections.length) {
      // Script text may come from web research / imported docs: it is data, never instructions.
      lines.push(`- script:`);
      lines.push(fenceUntrusted("script", p.sections.slice(0, 12).map((s) => `${s.kind}: ${s.text.slice(0, 400)}`).join(" | "), { maxChars: 6000 }).block);
    }
    if (align) {
      if (align.hookStartMs != null) lines.push(`- the scripted hook starts at SOURCE ${(align.hookStartMs / 1000).toFixed(2)}s${align.preHookSpeechMs > 800 ? ` (${(align.preHookSpeechMs / 1000).toFixed(1)}s of pre-hook talk before it)` : ""}`);
      if (align.missingSections.length) lines.push(`- script sections not found in the transcript: ${align.missingSections.join(", ")}`);
      for (const r of align.repeatedTakes) lines.push(`- "${r.kind}" was recorded ${r.takes.length} times; best take ${r.bestIndex + 1} at SOURCE ${(r.takes[r.bestIndex].startMs / 1000).toFixed(2)}s`);
      if (align.extraRanges.length) lines.push(`- off-script speech (SOURCE s): ${align.extraRanges.slice(0, 6).map((r) => `${(r.startMs / 1000).toFixed(1)}-${(r.endMs / 1000).toFixed(1)}`).join(", ")}`);
    }
    lines.push(``);
  }
  return lines;
}

/**
 * Greeting without media (web Media Studio before the footage is analysed, or any client that
 * wants the brand summary first). Returns the text and a ready-to-send prompt that performs the
 * proposal through the normal edit path.
 */
export function buildContextGreeting(ctx: DirectorContext): { greeting: string; suggestedPrompt: string | null; steps: string[] } {
  const style = brandStyleDefaults(ctx.brand);
  const piece = ctx.piece;
  const platform = piece?.platform || ctx.brand?.targetPlatforms?.[0];
  const aspect = aspectForPlatform(platform, piece?.contentType);
  const label = platformLabel(platform, piece?.contentType);
  const target = piece?.targetDurationSec || platformMaxDurationSec(piece?.platform, piece?.contentType);
  const steps: string[] = [];
  if (piece?.hook) steps.push("open on your hook");
  steps.push("cut the pauses");
  if (ctx.brand) steps.push(`add captions in your brand colour ${style.highlightColor}`);
  else steps.push("add captions");
  if (style.watermark) steps.push("add your logo watermark");
  if (aspect) steps.push(`reframe to ${aspect} for ${label}`);
  if (target) steps.push(`keep it under ${target}s`);
  const name = piece
    ? `${piece.dayLabel ? `${piece.dayLabel} ` : ""}${piece.headline ? `"${piece.headline}"` : "this piece"}`
    : ctx.brand?.name || "your video";
  const hookLine = piece?.hook ? ` Your script opens with: "${piece.hook.slice(0, 160)}".` : "";
  const greeting = ctx.brand || piece
    ? `${name}${ctx.brand?.name && piece ? ` for ${ctx.brand.name}` : ""}.${hookLine} I can ${steps.slice(0, -1).join(", ")}${steps.length > 1 ? " and " : ""}${steps[steps.length - 1]}. Apply?`
    : "Tell me how you'd like to edit this video.";
  const parts = [
    piece?.hook ? `Start the video where I begin saying the scripted hook ("${piece.hook.slice(0, 120)}")` : null,
    "remove the pauses",
    ctx.brand ? `add captions with highlight ${style.highlightColor} and text ${style.textColor}` : "add captions",
    style.watermark ? "add my logo watermark" : null,
    aspect ? `reframe to ${aspect}` : null,
    target ? `keep it under ${target} seconds` : null,
  ].filter(Boolean);
  return { greeting, suggestedPrompt: ctx.brand || piece ? `${parts.join(", ")}.` : null, steps };
}
