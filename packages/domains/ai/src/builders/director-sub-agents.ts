/**
 * Sub-agents under the AI Director (WS5). Each is a deterministic "tool" the director calls: it
 * reads the brand/script context and the transcript, and returns CreativeOperations (never pixels)
 * plus warnings. None of them calls an LLM, so a director turn stays within its LLM budget
 * (planner: 1 call + at most 1 repair). Stock/SFX lookups are injected and run under a deadline.
 */
import {
  CreativeOperation,
  CreativeOperationSchema,
  DirectorContext,
  BrandStyleDefaults,
  ScriptAlignment,
  EditIR,
  RationalTimeMath,
  brandStyleDefaults,
  extractBrollQueries,
  musicMoodForBrand,
  aspectForPlatform,
  platformLabel,
  platformMaxDurationSec,
  mapSourceToTimeline,
  withTimeout,
  resolveCaptionTemplate,
  findCaptionTemplateInText,
} from "@workspace/video-contracts";

type Word = { text: string; startMs: number; endMs: number };

const op = (o: Record<string, any>): CreativeOperation => CreativeOperationSchema.parse(o);

/**
 * Style agent: brand → caption colours/font/preset, zoom, transition and watermark choices.
 * When the server resolved WS1 `resolveBrandRendering()` (`ctx.brand.rendering`), its values are
 * used and every neutral default is named in the warnings (never saved to the brand).
 */
export function styleAgent(ctx: DirectorContext): BrandStyleDefaults {
  return brandStyleDefaults(ctx.brand);
}

/** B-roll research agent: visual queries from transcript entities, placed on the current timeline. */
export function brollResearchAgent(args: { words: Word[]; baseIR: EditIR; assetId: string; max?: number }): CreativeOperation[] {
  const queries = extractBrollQueries(args.words, { max: args.max ?? 2 });
  const out: CreativeOperation[] = [];
  for (const q of queries) {
    const t = mapSourceToTimeline(args.baseIR, args.assetId, q.atMs / 1000);
    if (t == null) continue;
    const total = RationalTimeMath.toSeconds(args.baseIR.meta.totalDuration);
    const dur = Math.min(q.durationMs / 1000, total - t - 0.2);
    if (dur < 1) continue;
    out.push(op({ type: "insertBroll", stockQuery: q.query, timelineStartSec: round2(t), durationSec: round2(dur), reason: `b-roll research: "${q.query}" is mentioned here` }));
  }
  return out;
}

export interface SfxSuggestion { title: string; url: string; durationSec?: number; license?: string | null; attribution?: string; query: string }

/** Sound agent: brand mood → music bed from the catalogue; optional Freesound SFX suggestions. */
export async function soundAgent(args: {
  ctx: DirectorContext;
  resolveSfx?: (query: string) => Promise<SfxSuggestion[]>;
  timeoutMs: number;
  warnings: string[];
}): Promise<{ music: CreativeOperation; sfx: SfxSuggestion[] }> {
  const mood = musicMoodForBrand(args.ctx.brand);
  const music = op({ type: "addBackgroundMusic", query: mood, volumeDb: -18, duckUnderSpeech: true, reason: `sound agent: ${mood} fits the brand tone` });
  let sfx: SfxSuggestion[] = [];
  if (args.resolveSfx) {
    try {
      sfx = (await withTimeout(args.resolveSfx("whoosh transition"), args.timeoutMs, "SFX lookup")).slice(0, 3);
    } catch (err: any) {
      args.warnings.push(`sound agent: SFX lookup skipped (${err?.message || err})`);
    }
  }
  return { music, sfx };
}

/**
 * SFX placement: puts the sound agent's HTTPS effects on an SFX audio lane at the timeline's
 * transitions (B-roll cutaway starts, then joins between main clips), slightly early so the
 * whoosh lands on the cut. Returns credit lines per placed clip id. Mutates `ir`.
 */
export function placeSfxOnTimeline(ir: EditIR, sfx: SfxSuggestion[], opts: { max?: number; volumeDb?: number } = {}): { placed: number; credits: Record<string, string>; used: SfxSuggestion[] } {
  const usable = sfx.filter((s) => /^https:\/\//i.test(s.url));
  const credits: Record<string, string> = {};
  if (!usable.length) return { placed: 0, credits, used: [] };
  const total = RationalTimeMath.toSeconds(ir.meta.totalDuration);
  const sec = (t: any) => RationalTimeMath.toSeconds(t);
  const points: number[] = [];
  for (const t of ir.tracks.videoTracks) {
    if (t.type === "B_ROLL_OVERLAY") for (const c of t.clips) points.push(sec(c.timelineRange.start));
  }
  const main = ir.tracks.videoTracks.find((t) => t.type === "MAIN_VIDEO") || ir.tracks.videoTracks[0];
  const mainStarts = (main?.clips || []).map((c) => sec(c.timelineRange.start)).sort((a, b) => a - b).slice(1);
  points.push(...mainStarts);
  const chosen: number[] = [];
  for (const p of points) {
    if (p <= 0.3 || p >= total - 0.3) continue;
    if (chosen.some((c) => Math.abs(c - p) < 1.5)) continue;
    chosen.push(p);
    if (chosen.length >= (opts.max ?? 4)) break;
  }
  if (!chosen.length) return { placed: 0, credits, used: [] };
  let lane = ir.tracks.audioTracks.find((t) => t.type === "SFX");
  if (!lane) {
    lane = { id: "sfx_lane", type: "SFX", volumeDb: 0, duckWithSpeech: false, clips: [] };
    ir.tracks.audioTracks.push(lane);
  }
  const used = new Set<SfxSuggestion>();
  chosen.sort((a, b) => a - b).forEach((p, i) => {
    const fx = usable[i % usable.length];
    used.add(fx);
    const start = Math.max(0, p - 0.08);
    const dur = Math.max(0.1, Math.min(fx.durationSec || 1, 2, total - start));
    const id = `sfx_${Math.round(start * 1000)}_${i}`;
    lane!.clips.push({
      id,
      sourcePath: fx.url,
      sourceQuery: fx.query,
      sourceRange: { start: RationalTimeMath.fromSeconds(0), duration: RationalTimeMath.fromSeconds(round2(dur)) },
      timelineRange: { start: RationalTimeMath.fromSeconds(round2(start)), duration: RationalTimeMath.fromSeconds(round2(dur)) },
      volumeDb: opts.volumeDb ?? -12,
    } as any);
    if (fx.attribution) credits[id] = fx.attribution;
  });
  return { placed: chosen.length, credits, used: [...used] };
}

export interface GreetingProposal {
  operations: CreativeOperation[];
  /** Short bullet list of what the proposal does, in the order applied. */
  steps: string[];
  watermark: boolean;
  /** "Day 3 \"Stop doing X\"" or the brand name. */
  name: string;
  notes: string[];
  targetSec: number | null;
  platformLabel: string;
}

/** Final greeting text, once the proposal is compiled and its real length is known. */
export function greetingReply(p: GreetingProposal, finalSec: number): string {
  const steps = [...p.steps];
  const notes = [...p.notes];
  if (p.targetSec) {
    if (finalSec <= p.targetSec + 0.5) steps.push(`keep it under ${p.targetSec}s for ${p.platformLabel} (${finalSec.toFixed(0)}s)`);
    else notes.push(`After these cuts it runs ${finalSec.toFixed(0)}s, over the ${p.targetSec}s target for ${p.platformLabel}; say "tighten it" and I'll trim further.`);
  }
  return steps.length
    ? `${p.name}: I can ${joinSteps(steps)}. Apply?${notes.length ? ` ${notes.join(" ")}` : ""}`
    : `${p.name}: tell me what you'd like to change.${notes.length ? ` ${notes.join(" ")}` : ""}`;
}

/**
 * The opening proposal: open on the hook, cut pauses, drop weaker repeated takes, captions in
 * brand colours, platform aspect, one hook zoom, brand-mood music, B-roll, logo watermark.
 * Everything is expressed as CreativeOperations on the CURRENT timeline.
 */
export function buildGreetingProposal(args: {
  ctx: DirectorContext;
  style: BrandStyleDefaults;
  alignment: ScriptAlignment | null;
  baseIR: EditIR;
  assetId: string;
  words: Word[];
  hasSilences: boolean;
  broll: CreativeOperation[];
  music: CreativeOperation | null;
}): GreetingProposal {
  const { ctx, style, alignment, baseIR, assetId, words } = args;
  const ops: CreativeOperation[] = [];
  const steps: string[] = [];
  const total = RationalTimeMath.toSeconds(baseIR.meta.totalDuration);
  const toTl = (ms: number) => mapSourceToTimeline(baseIR, assetId, ms / 1000);
  const cuts: Array<[number, number]> = [];
  const addCut = (s: number, e: number, reason: string) => {
    s = Math.max(0, s);
    e = Math.min(total, e);
    if (e - s < 0.15) return false;
    ops.push(op({ type: "removeRange", startSec: round2(s), durationSec: round2(e - s), reason }));
    cuts.push([s, e]);
    return true;
  };

  // 1. Open on the hook.
  if (alignment?.hookStartMs != null && alignment.preHookSpeechMs > 800) {
    const hookTl = toTl(alignment.hookStartMs);
    if (hookTl != null && addCut(0, hookTl - 0.1, "open on the scripted hook")) steps.push(`open on your hook (cut ${hookTl.toFixed(1)}s of warm-up)`);
  }
  // 2. Weaker repeated takes.
  let dropped = 0;
  for (const rep of alignment?.repeatedTakes || []) {
    rep.takes.forEach((t, i) => {
      if (i === rep.bestIndex) return;
      const s = toTl(t.startMs);
      const e = toTl(t.endMs);
      if (s == null || e == null) return;
      if (cuts.some(([a, b]) => s < b && e > a)) return;
      if (addCut(s - 0.05, e + 0.05, `keep the best take of the ${rep.kind}`)) dropped++;
    });
  }
  if (dropped) steps.push(`keep your best take (${dropped} repeated line${dropped === 1 ? "" : "s"} removed)`);
  // 3. Pauses.
  if (words.length || args.hasSilences) {
    const min = style.pacing === "fast" ? 0.35 : style.pacing === "calm" ? 0.8 : 0.5;
    ops.push(op({ type: "removeSilences", minDurationSec: min, reason: `pacing: ${style.pacing}` }));
    steps.push("cut the pauses");
  }
  // 4. Captions in brand colours.
  if (words.length) {
    ops.push(op({ type: "autoCaptions", stylePreset: style.captionPreset, textColor: style.textColor, highlightColor: style.highlightColor, wordsPerCaption: style.pacing === "calm" ? 4 : 3, reason: "brand captions" }));
    steps.push(`add captions in your brand colour ${style.highlightColor}`);
  }
  // 5. Hook zoom.
  const hookTl = alignment?.hookStartMs != null ? toTl(alignment.hookStartMs) : words[0] ? toTl(words[0].startMs) : null;
  if (hookTl != null && total - hookTl > 2) {
    ops.push(op({ type: "addZoom", startSec: round2(Math.max(0, hookTl)), durationSec: 1.4, targetCoords: { x: 0.5, y: 0.38 }, scale: style.zoomScale, reason: "punch in on the hook" }));
  }
  // 6. Platform aspect.
  const piece = ctx.piece;
  const aspect = aspectForPlatform(piece?.platform || ctx.brand?.targetPlatforms?.[0], piece?.contentType);
  if (aspect && aspect !== baseIR.meta.targetAspect) {
    ops.push(op({ type: "changeAspectRatio", targetAspect: aspect, mode: "fill" }));
    steps.push(`reframe to ${aspect} for ${platformLabel(piece?.platform || ctx.brand?.targetPlatforms?.[0], piece?.contentType)}`);
  }
  // 7. B-roll + music (sub-agents).
  if (args.broll.length) {
    ops.push(...args.broll);
    steps.push(`add ${args.broll.length} B-roll cutaway${args.broll.length === 1 ? "" : "s"} (${args.broll.map((b: any) => b.stockQuery).join(", ")})`);
  }
  if (args.music) {
    ops.push(args.music);
    steps.push(`add ${(args.music as any).query} music, ducked under your voice`);
  }
  // 8. Watermark.
  // The style agent decides (brand rendering: logo present and watermark not turned off).
  const watermark = style.watermark && !!ctx.brand?.logoUrl && /^https:\/\//i.test(ctx.brand.logoUrl);
  if (watermark) steps.push("add your logo watermark");

  const target = piece?.targetDurationSec || platformMaxDurationSec(piece?.platform, piece?.contentType) || null;
  const label = platformLabel(piece?.platform || ctx.brand?.targetPlatforms?.[0], piece?.contentType);

  const name = piece?.dayLabel || piece?.headline ? `${piece?.dayLabel ? `${piece.dayLabel} ` : ""}${piece?.headline ? `"${piece.headline}"` : ""}`.trim() : ctx.brand?.name || "your video";
  const notes: string[] = [];
  if (alignment) {
    if (alignment.hookStartMs == null && piece?.hook) notes.push("I couldn't find your scripted hook in the recording.");
    const missing = alignment.missingSections.filter((k) => k !== "hook");
    if (missing.length) notes.push(`These script parts weren't in the take: ${Array.from(new Set(missing)).join(", ")}.`);
    if (alignment.extraRanges.length) notes.push(`${alignment.extraRanges.length} off-script stretch${alignment.extraRanges.length === 1 ? "" : "es"} I left in; ask me to cut ${alignment.extraRanges.length === 1 ? "it" : "them"}.`);
  }
  if (!words.length) notes.push("Send a transcript and I can also add captions and match your script.");
  return { operations: ops, steps, watermark, name, notes, targetSec: target, platformLabel: label };
}

function joinSteps(steps: string[]): string {
  if (steps.length <= 1) return steps.join("");
  return `${steps.slice(0, -1).join(", ")} and ${steps[steps.length - 1]}`;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

const COLOUR_WORDS = /(#[0-9a-f]{3,8}\b|\b(red|orange|yellow|gold|green|lime|teal|cyan|blue|navy|purple|violet|pink|magenta|white|black|grey|gray|brown|neon)\b)/i;
const PRESET_WORDS = /(hormozi|ali abdaal|abdaal|minimal|bold center|bold centre|preset|subtitle style)/i;

/**
 * Brand defaults on planned operations: captions the creator did not colour/style explicitly
 * get the brand colours and caption preset. Returns human notes of what was applied.
 */
export function applyBrandDefaults(ops: CreativeOperation[], prompt: string, style: BrandStyleDefaults): string[] {
  const applied: string[] = [];
  const namedColour = COLOUR_WORDS.test(prompt);
  const namedPreset = PRESET_WORDS.test(prompt);
  // A creator look named in the request ("MrBeast captions") decides the style, not the brand defaults.
  const namedTemplate = findCaptionTemplateInText(prompt);
  for (const o of ops as any[]) {
    if (o.type === "autoCaptions" && (resolveCaptionTemplate(o.template) || namedTemplate)) {
      o.template = (resolveCaptionTemplate(o.template) || namedTemplate)!.id;
      // No colour named: the template's own colours apply.
      if (!namedColour) {
        delete o.textColor;
        delete o.highlightColor;
      }
      applied.push(`captions in the ${resolveCaptionTemplate(o.template)!.name} template`);
    } else if (o.type === "styleCaption" && (resolveCaptionTemplate(o.preset) || namedTemplate)) {
      o.preset = (resolveCaptionTemplate(o.preset) || namedTemplate)!.id;
      if (!namedColour) delete o.highlightColor;
      applied.push(`captions in the ${resolveCaptionTemplate(o.preset)!.name} template`);
    } else if (o.type === "autoCaptions") {
      if (!namedColour) {
        o.textColor = style.textColor;
        o.highlightColor = style.highlightColor;
        applied.push(`captions in brand colours (${style.highlightColor} highlight)`);
      }
      if (!namedPreset) o.stylePreset = style.captionPreset;
    } else if (o.type === "addCaption") {
      // The rule-based planner emits explicit caption chunks with its style's colours.
      if (!namedColour) {
        const oldH = (o.highlightColor || "").toUpperCase();
        const oldT = (o.textColor || "").toUpperCase();
        o.highlightColor = style.highlightColor;
        o.textColor = style.textColor;
        for (const w of o.words || []) {
          const c = (w.color || "").toUpperCase();
          if (c && c === oldH) w.color = style.highlightColor;
          else if (c && c === oldT) w.color = style.textColor;
        }
        applied.push(`captions in brand colours (${style.highlightColor} highlight)`);
      }
      if (!namedPreset) o.stylePreset = style.captionPreset;
    } else if (o.type === "styleCaption" && !namedColour && !o.highlightColor) {
      o.highlightColor = style.highlightColor;
    } else if (o.type === "addZoom" && o.scale === 1.3) {
      o.scale = style.zoomScale; // schema default → brand pacing
    }
  }
  return Array.from(new Set(applied));
}

/** Watermark intent from the prompt (deterministic path) or finish_edit (LLM). */
export function watermarkIntent(prompt: string, llm?: "add" | "remove" | "keep"): "add" | "remove" | "keep" {
  if (llm && llm !== "keep") return llm;
  const p = prompt.toLowerCase();
  if (/(remove|hide|delete|drop|without|no)\b[^.]*\b(logo|watermark)/.test(p)) return "remove";
  if (/(add|put|show|include|place|stamp|use)\b[^.]*\b(logo|watermark)/.test(p)) return "add";
  return llm || "keep";
}
