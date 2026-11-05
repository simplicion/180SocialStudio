import { z } from "zod";
import { DIRECTOR_LOCKABLE_TRACKS, DirectorLockableTrack } from "./director-constraints";
import { MobileEditIR } from "./mobile-edit-ir";

/**
 * Understand first, then edit (editor overhaul Phase 3, audit F-08 scope, F-22).
 *
 * Before planning, every request is classified into a scope: change something that is there, add something new, do
 * a whole edit, answer a question, or ask what the creator means. The planner then only gets the tools of that
 * scope, and every track the request does not mention is locked for the turn.
 */
export const DIRECTOR_INTENT_MODES = ["modify_existing", "add_new", "full_edit", "question", "ambiguous"] as const;
export type DirectorIntentMode = (typeof DIRECTOR_INTENT_MODES)[number];

export const INTENT_TARGET_KINDS = [
  "caption", "title", "music", "zoom", "broll", "sticker", "sfx", "effect", "transition", "color", "clip", "canvas", "audio", "voiceover", "watermark",
] as const;
export type IntentTargetKind = (typeof INTENT_TARGET_KINDS)[number];

export const DirectorIntentSchema = z.object({
  mode: z.enum(DIRECTOR_INTENT_MODES),
  targets: z
    .array(z.object({
      kind: z.enum(INTENT_TARGET_KINDS),
      ids: z.array(z.string().min(1).max(128)).max(20).optional(),
      timeSec: z.number().nonnegative().optional(),
      /** add = the request asks for a new one; change = it is about what is there. Absent = follow `mode`. */
      action: z.enum(["add", "change"]).optional(),
    }))
    .max(12)
    .default([]),
  allowedTools: z.array(z.string().min(1).max(60)).max(60).default([]),
  mustNotTouch: z.array(z.enum(DIRECTOR_LOCKABLE_TRACKS)).max(6).default([]),
  clarifyingQuestion: z.string().max(400).nullable().default(null),
});
export type DirectorIntent = z.infer<typeof DirectorIntentSchema>;

/** The result the turn used, and where it came from. */
export interface ResolvedDirectorIntent extends DirectorIntent {
  source: "llm" | "offline";
  /** Why the mode was changed after classification (e.g. a whole edit on hand-edited work became a question). */
  note?: string;
  /**
   * The request could not be scoped before planning (words the rules do not know and no LLM intent): every tool is
   * offered, under the "change only what was asked" rule, and nothing is locked.
   */
  unscoped?: boolean;
}

/** An offline classification; `unknown` = the rules found nothing they recognise (an LLM should decide). */
export type OfflineIntent = DirectorIntent & { unknown?: boolean };

/** Tools that act on each kind of target. A scoped turn only offers these (plus reply / finish). */
export const TOOLS_BY_TARGET: Record<IntentTargetKind, readonly string[]> = {
  caption: ["autoCaptions", "styleCaption", "addCaption", "editText", "updateTextStyle", "emphasizeWord", "translateCaptions", "retimeItem", "removeItem"],
  title: ["addText", "renderMotionGraphic", "editText", "updateTextStyle", "retimeItem", "removeItem"],
  music: ["addBackgroundMusic", "updateMusic", "changeMusicTrack", "adjustVolume", "duckAudio", "muteTrack", "removeItem"],
  zoom: ["addZoom", "updateZoom", "retimeItem", "removeItem"],
  broll: ["insertBroll", "updateOverlay", "setKeyframe", "removeKeyframe", "retimeItem", "removeItem", "processFootage"],
  sticker: ["addSticker", "updateOverlay", "setKeyframe", "removeKeyframe", "retimeItem", "removeItem"],
  sfx: ["addSoundEffect", "autoSoundDesign", "setSfxVolume", "muteTrack", "retimeItem", "removeItem"],
  effect: ["addEffect", "updateEffect", "retimeItem", "removeItem"],
  transition: ["addTransition"],
  color: ["applyFilter"],
  clip: [
    "removeRange", "removeSilences", "cleanFillers", "trimClip", "rippleDelete", "splitClip", "moveClip", "reorderSegment", "changeSpeed",
    "speedRamp", "duplicateClip", "freezeFrame", "replaceClip", "rotateClip", "setCrop", "panClip", "beatAlign", "processFootage", "jlCut",
  ],
  canvas: ["reframeSubject", "changeAspectRatio", "setCrop", "panClip"],
  audio: ["adjustVolume", "cleanVoice", "fadeClipAudio", "setClipVolume", "muteTrack", "jlCut"],
  voiceover: ["addNarration", "updateVoiceover", "retimeItem", "removeItem", "muteTrack"],
  // The brand logo is set by finish_edit / the server (no edit tool).
  watermark: [],
};

/** The lockable track a target kind belongs to (the others are locked in a scoped turn). */
const TRACK_OF: Partial<Record<IntentTargetKind, DirectorLockableTrack>> = {
  caption: "captions", title: "text", music: "music", broll: "broll", sticker: "broll", sfx: "sfx", effect: "effects", transition: "effects", color: "effects",
};

/** Tools that create new items. A request to change what is there does not get them ("make the title bigger" never adds a title). */
export const CREATION_TOOLS = new Set([
  "addText", "addZoom", "insertBroll", "addSticker", "addSoundEffect", "autoSoundDesign", "addEffect", "addCaption", "autoCaptions",
  "addBackgroundMusic", "addNarration", "renderMotionGraphic", "addImage",
]);

/** Tools a scoped intent may use: the ones it names that exist, plus those of its targets. */
export function scopedTools(intent: Pick<DirectorIntent, "mode" | "targets" | "allowedTools"> & { unscoped?: boolean }, known: readonly string[]): string[] | null {
  if (intent.mode === "full_edit" || intent.unscoped) return null; // everything
  if (intent.mode === "question" || intent.mode === "ambiguous") return [];
  const set = new Set<string>();
  for (const t of intent.targets) {
    const change = t.action ? t.action === "change" : intent.mode === "modify_existing";
    for (const tool of TOOLS_BY_TARGET[t.kind] ?? []) {
      if (change && CREATION_TOOLS.has(tool)) continue;
      set.add(tool);
    }
  }
  // Tools the classifier named explicitly are kept (an LLM intent may know "add a caption line" is needed).
  for (const tool of intent.allowedTools) set.add(tool);
  return known.filter((k) => set.has(k));
}

/** Tracks locked for a scoped turn: every lockable track the request does not target, plus mustNotTouch. */
export function scopedLockedTracks(intent: Pick<DirectorIntent, "mode" | "targets" | "mustNotTouch"> & { unscoped?: boolean }): DirectorLockableTrack[] {
  if (intent.mode === "full_edit" || intent.unscoped) return [...new Set(intent.mustNotTouch)];
  const targeted = new Set(intent.targets.map((t) => TRACK_OF[t.kind]).filter(Boolean) as DirectorLockableTrack[]);
  return [...new Set([...DIRECTOR_LOCKABLE_TRACKS.filter((t) => !targeted.has(t)), ...intent.mustNotTouch])];
}

// ─── Offline classification (no LLM, or the intent call failed) ───────────────────────────────────

const KIND_WORDS: Array<[IntentTargetKind, RegExp]> = [
  ["caption", /\b(captions?|captioning|subtitl\w*|subs)\b/],
  ["title", /\b(titles?|headlines?|hook text|text overlays?|lower[- ]thirds?|the text|on-screen text|call to action|cta text)\b/],
  ["music", /\b(music|soundtrack|bgm|song|track|beat|lo-?fi|heavy metal|metal|rock|jazz|edm|hip[- ]hop|piano|phonk|synthwave)\b/],
  ["zoom", /\b(zooms?|punch[- ]?ins?|zoom[- ]ins?)\b/],
  ["broll", /\b(b[- ]?roll|cutaways?|stock (clip|footage|video)s?|overlays?|picture[- ]in[- ]picture|pip|visuals?|footage of)\b/],
  ["sticker", /\b(stickers?|emojis?)\b/],
  ["sfx", /\b(sound effects?|sfx|whoosh\w*|swoosh\w*|pops?|dings?)\b/],
  ["effect", /\b((?<!sound )effects?|shake|flash|glitch effect|vignette|black and white|b&w)\b/],
  ["transition", /\b(transitions?|crossfades?|dissolves?|fades? between)\b/],
  ["color", /\b(colou?r( grade| grading)?|grade|filter|lut|warmer|cooler|brighter|darker|saturat\w*|contrast|exposure|black and white|b&w|monochrome|look)\b/],
  ["clip", /\b(cut|cuts|trim|pauses?|silences?|dead air|fillers?|filler words|ums?|uhs?|speed( up)?|slow[- ]?mo\w*|slow (it )?down|faster|slower|reorder|rearrange|move the (part|section|clip)|first \d+ ?s(ec(ond)?s?)?|last \d+ ?s(ec(ond)?s?)?|(make|keep) (it|this|the video) shorter|shorten (it|this|the video)|tighten|freeze|duplicate|repeat|split|rotate|upside down|sideways|mirror|flip|stabili[sz]e|reverse|parts?|sections?|segments?|clips?)\b|\b\d+(\.\d+)?x\b|\b\d+(\.\d+)?\s*-\s*\d+(\.\d+)?\s*s\b|\bput (the|that|this) ((last|first|end|ending|middle|best) )?(part|section|bit|clip|segment)s?\b.{0,20}\b(first|last|at the (start|end))\b|\bput \d+(\.\d+)?\s*-\s*\d+(\.\d+)?\s*s\b/],
  ["canvas", /\b(vertical|horizontal|landscape|portrait|square|9:16|16:9|1:1|4:5|aspect( ratio)?|reframe|crop|framing|frame me|keep me in (the )?frame|fit the frame|fill the frame)\b/],
  ["audio", /\b(noise|echo|my voice|the voice|voice (is )?(too )?(quiet|loud)|audio|volume|louder|quieter|mute|unmute|sound quality|background noise)\b/],
  ["voiceover", /\b(voice[- ]?overs?|narration|narrate|voice ?line)\b/],
  ["watermark", /\b(logo|watermark|brand it|branding)\b/],
];

/** Whole-video asks: "edit this", "make it viral", "make it punchy for reels", "do your thing". */
const WHOLE_EDIT = /\b(edit (this|it|the video|my video)( for (reels?|tiktok|shorts|instagram|youtube))?|(make|turn) (it|this|the video)( more| a bit| a little)? (viral|punch(y|ier)|engaging|professional|pro|snappy|tiktok[- ]ready|pop|better|good|nice|great)|(for|ready for) (reels?|tiktok|shorts|youtube shorts|instagram)|do your (thing|magic)|full (edit|pass)|edit (it )?(from scratch|for me)|polish (it|this)|clean (it|this) up|improve( it| this)?|start over|redo (it|everything|the (whole )?edit))\b/g;
/** Small talk: answered in the chat, nothing is edited. */
const SMALL_TALK = /^\s*(hi|hey|hello|yo|hiya|thanks?|thank you|thx|ty|cool|nice|great|awesome|love it|perfect|good job|amazing|lol|haha)\b[\s!.:)]*$/i;
/** The creator explicitly wants everything redone, even over their own edits. */
const FULL_CONFIRMED = /\b(from scratch|start over|redo (it|everything|the (whole )?edit)|full edit|everything|whole (video|thing) again|ignore my edits)\b/;
const QUESTION = /^(what|how|why|which|when|where|who|can you|could you tell|do you|does|is it|is there|are there|should i|would it)\b[^]*\?\s*$|^[^]*\?\s*$/;
const EDIT_VERB = /\b(add|put|insert|remove|delete|cut|trim|make|change|move|fix|turn|set|lower|raise|use|apply|give|swap|replace|speed|slow|mute|edit|show|hide|drop)\b/;
const CREATE_VERB = /\b(add|adds|adding|put|insert|give|include|throw in|slap|drop in|with|some|more|another|new|create|generate|apply|use)\b/;
/** Changing what is there: verbs, comparatives ("bigger", "too loud") and pointing at an item ("the zoom at 5s"). */
const CHANGE_VERB = /\b(make|change|fix|move|lower|raise|edit|adjust|replace|update|tweak|shorten|lengthen|resize|recolou?r|restyle|turn|set|reduce|increase|swap|shift|nudge|tone down|soften|remove|delete|cut|trim|tighten|mute|unmute|stop|speed|slow|rotate|mirror|flip|freeze|duplicate|reorder|rearrange|crop|reframe|hide|drop)\b/;
const CHANGE_AFTER = /^\s*(is|are|was|were|should|looks?|feels?|sounds?|seems?|at \d|on \d|(is |are )?too\b|(a bit |a little )?(louder|quieter|softer|stronger|weaker|bigger|smaller|larger|longer|shorter|faster|slower|higher|lower|brighter|darker|white|black|red|yellow|blue|green)\b)/;
const POINTER = /\b(the|my|this|that|these|those|your|its)\s+([\w-]+\s+)?$/;

/** Whether the target word at `index` asks for a new item ("add a zoom", "zoom on the punchline") or a change. */
function targetAction(text: string, index: number, length: number): "add" | "change" {
  const clauseStart = Math.max(0, ...[...text.slice(0, index).matchAll(/[.,;!?+]|\b(and|then|also|plus)\b/g)].map((m) => (m.index ?? 0) + m[0].length));
  const before = text.slice(clauseStart, index).slice(-48);
  const after = text.slice(index + length).split(/[.,;!?+]|\b(and|then)\b/)[0] ?? "";
  if (CREATE_VERB.test(before)) return "add";
  if (CHANGE_VERB.test(before) || CHANGE_AFTER.test(after) || CHANGE_VERB.test(after.slice(0, 24))) return "change";
  if (POINTER.test(before)) return "change";
  return "add";
}
const VAGUE = /^\s*(fix it|do something|help|i don'?t know|whatever|you decide|surprise me|change (it|something)|edit|anything)\s*[.!]?\s*$/;

/** The first spoken / pointed-at moment in a request ("the zoom at 5s", "at 0:12"). */
function timeIn(text: string): number | undefined {
  const m = /\b(?:at|around|near)\s+(\d{1,2}):(\d{2})\b/.exec(text) || /\b(?:at|around|near)\s+(\d+(?:\.\d+)?)\s*(?:s|sec|secs|seconds)\b/.exec(text);
  if (!m) return undefined;
  return m.length === 3 && m[2] !== undefined && text.includes(":") ? Number(m[1]) * 60 + Number(m[2]) : Number(m[1]);
}

/** Whether the timeline carries the creator's own work (items they made by hand). */
export function hasManualWork(ir: MobileEditIR | null | undefined): boolean {
  return !!ir && Object.values(ir.itemMeta ?? {}).some((m) => m.origin === "manual");
}

/**
 * Offline intent: the request's target kinds from its words, and whether it asks to add or to change.
 * Used when no LLM is available (or its answer could not be used); the LLM's own answer goes through
 * `finalizeIntent` the same way.
 */
export function classifyDirectorIntentOffline(prompt: string): OfflineIntent {
  const text = prompt.toLowerCase().trim();
  const base = { allowedTools: [] as string[], mustNotTouch: [] as DirectorLockableTrack[], clarifyingQuestion: null as string | null };
  if (!text) return { ...base, mode: "full_edit", targets: [] };
  if (SMALL_TALK.test(text)) return { ...base, mode: "question", targets: [] };
  if (VAGUE.test(text)) {
    return { ...base, mode: "ambiguous", targets: [], clarifyingQuestion: "Happy to! What should I focus on: the cuts and pacing, the captions, music, or zooms and B-roll?" };
  }
  // A whole-edit phrase ("make it pop", "clean it up") is not read for item words ("pop" is not a sound effect).
  const wholeEdit = new RegExp(WHOLE_EDIT.source).test(text);
  const itemText = text.replace(WHOLE_EDIT, " ");
  const kinds: IntentTargetKind[] = [];
  const actions = new Map<IntentTargetKind, "add" | "change">();
  for (const [kind, re] of KIND_WORDS) {
    const m = re.exec(itemText);
    if (!m) continue;
    kinds.push(kind);
    // Cuts, framing and the video's own sound always change the footage that is there.
    const footage = kind === "clip" || kind === "canvas" || kind === "audio";
    actions.set(kind, footage ? "change" : targetAction(itemText, m.index, m[0].length));
  }
  // "music" also matches "track" and "beat"; "cut to the beat" is about the cuts.
  if (kinds.includes("music") && /\b(to|on) the beat\b/.test(text) && !/\b(music|soundtrack|song|bgm)\b/.test(text)) kinds.splice(kinds.indexOf("music"), 1);
  // "the voice is too quiet" is the original sound, not a voiceover.
  if (kinds.includes("voiceover") && !/\b(voice[- ]?overs?|narration|narrate)\b/.test(text)) kinds.splice(kinds.indexOf("voiceover"), 1);
  // "make the music quieter" is about the music, not the video's own sound.
  if (kinds.includes("audio") && kinds.some((k) => k === "music" || k === "sfx" || k === "voiceover") && !/\b(my voice|the voice|voice|noise|echo|original sound|audio quality)\b/.test(itemText)) {
    kinds.splice(kinds.indexOf("audio"), 1);
  }
  const isQuestion = QUESTION.test(text) && (!EDIT_VERB.test(text) || /^(what|how|why|which|should i|do you|is it|is there|are there)\b/.test(text));
  if (isQuestion) return { ...base, mode: "question", targets: kinds.map((kind) => ({ kind })) };
  if (wholeEdit && kinds.length === 0) return { ...base, mode: "full_edit", targets: [] };
  if (kinds.length === 0) {
    // Nothing the rules know ("yes", another language, an unusual phrasing): an LLM decides, with the conversation.
    return { ...base, mode: "ambiguous", targets: [], unknown: true };
  }
  const at = timeIn(text);
  const targets = kinds.map((kind) => ({ kind, action: actions.get(kind) ?? "add", ...(at !== undefined ? { timeSec: at } : {}) }));
  // Adding vs changing is decided per target ("cut the pauses and add captions"); the request is "add" when it adds anything.
  const mode: DirectorIntentMode = targets.some((t) => t.action === "add") ? "add_new" : "modify_existing";
  // "Don't touch the music" keeps that track out of the turn.
  const mustNotTouch = DIRECTOR_LOCKABLE_TRACKS.filter((t) => new RegExp(`\\b(don'?t|do not|never|without|leave|keep)\\b[^.,;]{0,24}\\b${t === "text" ? "(title|text)" : t === "broll" ? "b[- ]?roll" : t === "effects" ? "effects?" : t === "sfx" ? "(sfx|sound effects?)" : t}\\b`).test(text));
  return { ...base, mode, targets: targets.filter((t) => !mustNotTouch.includes(TRACK_OF[t.kind] as any)), mustNotTouch };
}

/**
 * Applies the rules every intent follows, whoever classified it:
 * - a whole edit over the creator's own work is a question first, unless they confirmed ("from scratch", "everything",
 *   or "yes" to that question);
 * - the opening turn on a raw clip may be a whole edit;
 * - a scoped intent with no target and no tool cannot do anything: it becomes a question.
 */
export function finalizeIntent(
  intent: OfflineIntent,
  ctx: { prompt: string; timeline: MobileEditIR | null | undefined; confirmedFullEdit?: boolean; source: "llm" | "offline" }
): ResolvedDirectorIntent {
  const { unknown, ...rest } = intent;
  const out: ResolvedDirectorIntent = { ...rest, source: ctx.source };
  if (unknown) {
    // Could not be scoped (no LLM intent): planned without a scope, under "change only what was asked".
    return { ...out, mode: "add_new", clarifyingQuestion: null, unscoped: true, note: "the request could not be scoped before planning" };
  }
  const confirmed = ctx.confirmedFullEdit || FULL_CONFIRMED.test(ctx.prompt.toLowerCase());
  if (out.mode === "full_edit" && hasManualWork(ctx.timeline) && !confirmed) {
    return {
      ...out,
      mode: "ambiguous",
      clarifyingQuestion: FULL_EDIT_QUESTION,
      note: "a whole edit would change work the creator did by hand, so the creator is asked first",
    };
  }
  if ((out.mode === "modify_existing" || out.mode === "add_new") && out.targets.length === 0 && out.allowedTools.length === 0 && !out.unscoped) {
    return { ...out, mode: "ambiguous", clarifyingQuestion: out.clarifyingQuestion || "What should I change: the cuts, captions, title, music, zooms or B-roll?", note: "no target in the request" };
  }
  if (out.mode === "ambiguous" && !out.clarifyingQuestion) out.clarifyingQuestion = "What should I change: the cuts, captions, title, music, zooms or B-roll?";
  return out;
}

/**
 * The destructive variants of a few tools need the request to ask for them, in any mode ("never regenerate captions,
 * replace music or overwrite transitions unless asked"). Without the ask, an op is downgraded (captions restyled,
 * only empty cuts get a transition) or dropped (music swap). Returns the operations to keep and one note per change.
 */
export function guardDestructiveVariants<T extends { type: string; [k: string]: any }>(ops: T[], prompt: string): { ops: T[]; notes: string[] } {
  const p = prompt.toLowerCase();
  const wantsNewMusic = /\b(different|another|new|other|change|replace|swap|switch)\b.{0,24}\b(music|song|track|soundtrack)\b|\b(music|song|track)\b.{0,24}\b(instead|different)\b/.test(p);
  const wantsNewCaptions = /\b(redo|regenerate|re-?do|remake|rebuild|from scratch|start over|new)\b.{0,24}\b(captions?|subtitles?)\b|\b(captions?|subtitles?)\b.{0,24}\b(again|from scratch|over)\b/.test(p);
  const wantsAllTransitions = /\b(change|replace|swap|all|every|each)\b.{0,24}\btransitions?\b/.test(p);
  const notes: string[] = [];
  const out: T[] = [];
  for (const op of ops) {
    if ((op.type === "addBackgroundMusic" && op.replace) || op.type === "changeMusicTrack") {
      if (!wantsNewMusic) {
        notes.push("kept your music track (ask for different music to swap it)");
        continue;
      }
    }
    if (op.type === "autoCaptions" && op.replaceExisting && !wantsNewCaptions) {
      notes.push("kept the caption text (ask to redo the captions to regenerate them)");
      out.push({ ...op, replaceExisting: false });
      continue;
    }
    if (op.type === "addTransition" && op.overwrite && !wantsAllTransitions) {
      notes.push("kept the transitions you have (only cuts without one got a new one)");
      out.push({ ...op, overwrite: false });
      continue;
    }
    out.push(op);
  }
  return { ops: out, notes: [...new Set(notes)] };
}

/** Asked before a whole edit of a timeline the creator edited by hand; "yes" to it confirms the whole edit. */
export const FULL_EDIT_QUESTION =
  "You've already edited this by hand. Should I do a full pass (that can change your cuts, captions and music), or only work on something specific?";

/** The creator answered "yes / full pass" to FULL_EDIT_QUESTION in the previous turn. */
export function confirmsFullEdit(prompt: string, lastAssistant: string | undefined): boolean {
  if (!lastAssistant || !lastAssistant.includes(FULL_EDIT_QUESTION.slice(0, 40))) return false;
  return /\b(yes|yeah|yep|sure|ok(ay)?|go ahead|do it|full( pass)?|everything|all of it)\b/i.test(prompt) && !/\b(only|just|no\b|don'?t)/i.test(prompt);
}

/** Prompt for the structured intent call (the model answers with one `classify_request` tool call). */
export const INTENT_TOOL_NAME = "classify_request";

export function buildIntentPrompt(params: { prompt: string; timelineLines: string[]; history?: Array<{ role: string; content: string }> }): string {
  return [
    `You classify a video creator's request to their AI video editor BEFORE anything is edited. Do not edit; call ${INTENT_TOOL_NAME} once.`,
    `Modes:`,
    `- modify_existing: change something already on the timeline ("make the music quieter", "title bigger", "the zoom at 5s is too strong", "fix the typo").`,
    `- add_new: add something specific ("add captions", "put a zoom on the punchline", "add b-roll when I talk about the gym").`,
    `- full_edit: a whole-video edit ("edit this for reels", "make it viral", "make it punchy"). Only for whole-video asks.`,
    `- question: the creator asks something and does not ask for an edit.`,
    `- ambiguous: you cannot tell what to change ("make it better" with no hint): give clarifyingQuestion (one short friendly sentence).`,
    `targets: the kinds of things the request is about (caption, title, music, zoom, broll, sticker, sfx, effect, transition, color, clip = cuts/speed/order of footage, canvas = aspect/framing, audio = the video's own sound, voiceover), with item ids from the timeline when the request points at specific items, and timeSec when it names a moment.`,
    `allowedTools: the editor tools needed, nothing more. mustNotTouch: tracks the creator said to leave alone (music, captions, broll, sfx, effects, text).`,
    ``,
    `## Current timeline`,
    ...params.timelineLines,
    ``,
    ...(params.history?.length ? [`## Last turns`, ...params.history.slice(-4).map((t) => `${t.role === "user" ? "Creator" : "Editor"}: ${t.content.slice(0, 300)}`), ``] : []),
    `## Request`,
    JSON.stringify(params.prompt),
  ].join("\n");
}
