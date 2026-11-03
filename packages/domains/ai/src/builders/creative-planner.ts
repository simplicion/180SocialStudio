import {
  CreativeEditPlan,
  CreativeOperation,
  TimelineContext,
  DirectorState,
  MediaIntelligenceGraph,
  MediaAssetDescriptor,
  DeterministicPlanner,
  EditIR,
  RationalTimeMath,
  buildDirectorToolDefinitions,
  validateDirectorToolCalls,
  PlannerSource,
  DirectorHistoryTurn,
  DirectorTimeoutError,
  withTimeout,
  UNTRUSTED_DATA_POLICY,
  fenceUntrusted,
  sanitizeInlineUntrusted,
  neutraliseWordSequence,
  deriveEditStyle,
  describeEditStyle,
} from "@workspace/video-contracts";
import { AIProviderService, AIClient, AISettings } from "../kernel/ai-provider.service";
import {
  CHAT_TOOL_NAME,
  DIRECTOR_PERSONA,
  DirectorConversation,
  buildChatToolDefinition,
  conversationFromText,
  parseConversation,
} from "./director-conversation";

export interface PlanGenerationParams {
  prompt: string;
  /**
   * Check that the plan covers every feature the creator asked for (and ask once more if not). Off for critic
   * repair calls: their prompt quotes the original request, but a repair must stay minimal.
   */
  checkCoverage?: boolean;
  timelineContext: TimelineContext;
  mediaGraph: MediaIntelligenceGraph;
  directorState?: DirectorState;
  availableAssets?: MediaAssetDescriptor[];
  companyId?: string;
  /** Earlier chat turns, oldest first. */
  history?: DirectorHistoryTurn[];
  /** Per-call LLM timeout in ms (default `AI_DIRECTOR_LLM_TIMEOUT_MS` or 60000). */
  llmTimeoutMs?: number;
  /** Current timeline, used to describe the edit state to the LLM. */
  currentEditIR?: EditIR;
  /**
   * Inject an LLM client (tests, or callers that already resolved one).
   * `null` = explicitly no LLM; `undefined` = resolve from the company's AI settings.
   */
  llmClient?: AIClient | null;
  /** Model id override for the injected/resolved client. */
  llmModel?: string;
  /** Extra prompt sections (brand, calendar piece, script alignment), inserted before the request. */
  contextSections?: string[];
}

export interface PlannerOutcome {
  plan: CreativeEditPlan;
  plannerSource: PlannerSource;
  /** Human-readable reason: model used, or exactly why we fell back. */
  plannerReason: string;
  /** Number of LLM calls made (0, 1, or 2 with the repair retry). */
  llmAttempts: number;
  /** Validation errors from the first LLM attempt that triggered a repair (for telemetry). */
  repairedErrors?: string[];
  /** finish_edit `brandWatermark` from the LLM (undefined = keep). */
  brandWatermark?: "add" | "remove" | "keep";
  /** finish_edit `preserve`: locks the model derived from the creator's words (can only add locks). */
  preserve?: { lockedRanges?: Array<{ startSec: number; endSec: number }>; lockedTracks?: string[] };
  /** Untrusted inputs in this prompt that contained instruction-like text (neutralised). */
  injectionFlags?: string[];
  /** What the model said to the creator (`reply_to_creator`, or a text-only answer). */
  conversation?: DirectorConversation;
}

const MAX_TRANSCRIPT_WORDS = 2500;
const SPOKEN_LINE_PAUSE_SEC = 0.6;
const MAX_HISTORY_TURNS = 12;
/** Phases in which the director only proposes: edits are never applied before the creator agrees. */
const PROPOSAL_PHASES = new Set(["recommend", "gather", "confirm"]);

/**
 * What the creator explicitly asked for, as tool families. A plan that skips one of these is sent back to the model
 * once ("you skipped …"); weaker models often stop after the cuts. Negated asks ("no music", "don't zoom") and asks
 * that cannot be done (captions without a transcript) are not required.
 */
const COVERAGE_RULES: Array<{ label: string; ask: RegExp; ops: string[]; needsTranscript?: boolean; removal?: boolean }> = [
  { label: "captions", ask: /\b(captions?|subtitles?)\b/, ops: ["autoCaptions", "styleCaption"], needsTranscript: true },
  { label: "caption translation", ask: /\b(translate (the |my )?(captions?|subtitles?)|(captions?|subtitles?) (in|into|to) (hinglish|roman|english|hindi|tamil|telugu|bengali|marathi|gujarati|urdu|punjabi|spanish|french)|hinglish (captions?|subtitles?))\b/, ops: ["translateCaptions"], needsTranscript: true },
  { label: "zoom / punch-in", ask: /\b(zooms?|punch[- ]?ins?)\b/, ops: ["addZoom", "reframeSubject"] },
  { label: "B-roll", ask: /\b(b[- ]?roll|cutaways?|stock (clip|footage|video))\b/, ops: ["insertBroll"] },
  { label: "sticker", ask: /\b(stickers?|emojis?)\b/, ops: ["addSticker"] },
  { label: "background music", ask: /\b(music|soundtrack|bgm)\b/, ops: ["addBackgroundMusic"] },
  { label: "colour grade", ask: /\b(colou?r ?grad\w*|grade|filter|lut)\b/, ops: ["applyFilter"] },
  { label: "title text", ask: /\b(title|headline|hook text|text overlay)\b/, ops: ["addText"] },
  { label: "transitions", ask: /\b(transitions?|crossfades?|dissolves?)\b/, ops: ["addTransition"] },
  { label: "filler-word removal", ask: /\bfillers?\b/, ops: ["cleanFillers"], needsTranscript: true, removal: true },
  { label: "sound effects", ask: /\b(sound effects?|sfx|whoosh\w*)\b/, ops: ["addSoundEffect", "autoSoundDesign"] },
];
const NEGATION = /\b(no|not|don'?t|do not|without|remove|keep|skip|never)\b[\w\s,'-]{0,24}$/;

/** Feature labels the creator explicitly asked for (see COVERAGE_RULES). */
export function requestedFeatures(prompt: string, hasTranscript: boolean): string[] {
  const text = prompt.toLowerCase();
  const out: string[] = [];
  for (const r of COVERAGE_RULES) {
    const m = r.ask.exec(text);
    if (!m) continue;
    // "remove / cut the fillers" is the ask itself, not a negation.
    if (!r.removal && NEGATION.test(text.slice(Math.max(0, m.index - 30), m.index))) continue;
    if (r.needsTranscript && !hasTranscript) continue;
    out.push(r.label);
  }
  return out;
}

/** Requested tool families the plan does not contain. */
export function missingRequestedOperations(prompt: string, operationTypes: string[], hasTranscript: boolean): string[] {
  const have = new Set(operationTypes);
  const wanted = new Set(requestedFeatures(prompt, hasTranscript));
  return COVERAGE_RULES.filter((r) => wanted.has(r.label) && !r.ops.some((o) => have.has(o))).map((r) => `${r.label} (${r.ops.join(" / ")})`);
}

/** Model defaults per provider. Anthropic default follows the product decision (latest Sonnet). */
function modelFor(provider: string, override?: string): string | undefined {
  if (override) return override;
  if (provider === "claude") return process.env.AI_DIRECTOR_CLAUDE_MODEL || "claude-sonnet-5";
  if (provider === "openai") return process.env.AI_DIRECTOR_OPENAI_MODEL || undefined;
  return undefined;
}

/** Per-call LLM timeout: `AI_DIRECTOR_LLM_TIMEOUT_MS` (default 60 s). A timeout is a DirectorTimeoutError. */
export function directorLlmTimeoutMs(override?: number): number {
  if (override && override > 0) return override;
  const env = Number(process.env.AI_DIRECTOR_LLM_TIMEOUT_MS);
  return Number.isFinite(env) && env > 0 ? env : 60000;
}

function llmFailureReason(what: string, label: string, err: any): string {
  if (err instanceof DirectorTimeoutError) return `LLM_TIMEOUT: ${what} (${label}) ${err.message}`;
  return `${what} failed (${label}): ${truncate(err?.message || String(err), 240)}`;
}

export class CreativePlanner {
  /**
   * Backwards-compatible entry point: returns only the plan.
   * Prefer `planWithSource`, which also reports whether an LLM or the deterministic engine planned.
   */
  static async plan(params: PlanGenerationParams): Promise<CreativeEditPlan> {
    return (await this.planWithSource(params)).plan;
  }

  /**
   * LLM-first planning via structured tool calling:
   *   1. resolve an LLM client (company key or platform env key)
   *   2. model calls one tool per CreativeOperation (schemas derived from the Zod union)
   *   3. every call is Zod-validated; on failure ONE repair retry is made with the errors
   *   4. no key / call failure / still-invalid output => deterministic planner, and the
   *      outcome says so explicitly (plannerSource + plannerReason). Never silent.
   */
  static async planWithSource(params: PlanGenerationParams): Promise<PlannerOutcome> {
    const { client, reason: noClientReason, model } = await this.resolveClient(params);
    if (!client) {
      return this.deterministicOutcome(params, noClientReason, 0);
    }
    if (typeof client.generateWithTools !== "function") {
      return this.deterministicOutcome(params, `LLM provider "${client.provider}" does not support tool calling`, 0);
    }

    const tools = [...buildDirectorToolDefinitions(), buildChatToolDefinition()];
    const basePrompt = this.buildPrompt(params);
    const options: any = { max_tokens: 16000, temperature: 0.2 };
    if (model) options.model = model;
    const label = `${client.provider}${model ? `/${model}` : ""}`;
    const timeoutMs = directorLlmTimeoutMs(params.llmTimeoutMs);

    let first;
    try {
      first = await withTimeout(client.generateWithTools(basePrompt, tools, options), timeoutMs, "LLM call");
    } catch (err: any) {
      return this.deterministicOutcome(params, llmFailureReason("LLM call", label, err), 1);
    }

    const split = splitChatCalls(first?.toolCalls || []);
    const firstCalls = split.calls;
    let conversation = split.conversation;
    // A chat turn (recommendation, question, plan to confirm, small talk): nothing is edited until the creator
    // agrees, so edit calls next to a proposal are dropped.
    if (firstCalls.length === 0 || (conversation && PROPOSAL_PHASES.has(conversation.phase))) {
      conversation = conversation || conversationFromText(first?.text || "") || undefined;
      if (!conversation) return this.deterministicOutcome(params, `LLM (${label}) returned an empty response`, 1);
      return {
        plan: this.buildPlan(params, [], conversation.reply, false),
        plannerSource: "llm",
        plannerReason: `${label} replied without edits (conversational turn: ${conversation.phase})`,
        llmAttempts: 1,
        conversation,
      };
    }

    let validation = validateDirectorToolCalls(firstCalls);
    let attempts = 1;
    let repairedErrors: string[] | undefined;

    if (validation.errors.length > 0) {
      repairedErrors = validation.errors;
      attempts = 2;
      const repairPrompt = this.buildRepairPrompt(basePrompt, firstCalls, validation.errors);
      let second;
      try {
        second = await withTimeout(client.generateWithTools(repairPrompt, tools, options), timeoutMs, "LLM repair call");
      } catch (err: any) {
        return this.deterministicOutcome(params, llmFailureReason("LLM repair call", label, err), 2);
      }
      const secondSplit = splitChatCalls(second?.toolCalls || []);
      if (secondSplit.conversation) conversation = secondSplit.conversation;
      const retry = validateDirectorToolCalls(secondSplit.calls);
      if (retry.errors.length > 0 || (retry.operations.length === 0 && !retry.finish)) {
        const errs = retry.errors.length > 0 ? retry.errors : ["no tool calls in repair response"];
        return this.deterministicOutcome(
          params,
          `LLM output (${label}) failed validation after 1 repair attempt: ${truncate(errs.join(" | "), 400)}`,
          2
        );
      }
      validation = retry;
    }

    // Coverage: everything the creator explicitly asked for must be planned (or honestly skipped by the model).
    const hasTranscript = (params.mediaGraph?.transcript?.length ?? 0) > 0;
    const missing = params.checkCoverage === false ? [] : missingRequestedOperations(params.prompt, validation.operations.map((o: any) => o.type), hasTranscript);
    let coverageNote = "";
    if (missing.length > 0) {
      const calls = validation.operations.map((o: any) => ({ name: o.type, args: o }));
      const prompt = this.buildCoveragePrompt(basePrompt, calls, missing);
      try {
        const third = await withTimeout(client.generateWithTools(prompt, tools, options), timeoutMs, "LLM coverage call");
        const thirdSplit = splitChatCalls(third?.toolCalls || []);
        const retry = validateDirectorToolCalls(thirdSplit.calls);
        const stillMissing = missingRequestedOperations(params.prompt, retry.operations.map((o: any) => o.type), hasTranscript);
        if (retry.errors.length === 0 && retry.operations.length > 0 && stillMissing.length < missing.length) {
          validation = retry;
          if (thirdSplit.conversation) conversation = thirdSplit.conversation;
          coverageNote = `, completed ${missing.length - stillMissing.length} skipped request(s)`;
        } else {
          coverageNote = ", coverage retry not better";
        }
      } catch {
        coverageNote = ", coverage retry failed";
      }
      attempts += 1;
    }

    // After edits the chat reply is the "done" report; finish_edit.summary stays the fallback.
    if (conversation && validation.operations.length > 0) conversation = { ...conversation, phase: "done", proposedPlan: [] };
    const summary = conversation?.reply || validation.finish?.summary || this.summarizeOperations(validation.operations);
    return {
      plan: this.buildPlan(params, validation.operations, summary, validation.finish?.requiresConfirmation ?? false),
      plannerSource: "llm",
      plannerReason: `${label} tool-calling plan (${attempts} attempt${attempts === 1 ? "" : "s"}${repairedErrors ? ", repaired" : ""}${coverageNote})`,
      llmAttempts: attempts,
      repairedErrors,
      brandWatermark: validation.finish?.brandWatermark,
      preserve: validation.finish?.preserve,
      ...(conversation ? { conversation } : {}),
    };
  }

  private static async resolveClient(params: PlanGenerationParams): Promise<{ client: AIClient | null; reason: string; model?: string }> {
    if (params.llmClient !== undefined) {
      if (params.llmClient === null) return { client: null, reason: "LLM disabled for this request" };
      return { client: params.llmClient, reason: "", model: modelFor(params.llmClient.provider, params.llmModel) };
    }
    if (!params.companyId) {
      return { client: null, reason: "no workspace (company) context, so no LLM key could be resolved" };
    }
    let settings: AISettings;
    try {
      // Lazy import: keeps prisma out of the module graph for callers that inject a client.
      const { AICompanyConfigService } = await import("../kernel/ai-company-config.service");
      settings = (await AICompanyConfigService.getCompanyAISettings(params.companyId)).settings;
    } catch (err: any) {
      return { client: null, reason: `could not load AI settings: ${truncate(err?.message || String(err), 160)}` };
    }
    const client = await AIProviderService.getInstance().getClient(settings);
    if (!client) {
      return { client: null, reason: `no AI API key configured in server environment (provider "${settings.aiProvider || "none"}")` };
    }
    return { client, reason: "", model: modelFor(client.provider, params.llmModel) };
  }

  private static deterministicOutcome(params: PlanGenerationParams, reason: string, attempts: number): PlannerOutcome {
    const plan = this.planDeterministically(
      params.prompt,
      params.timelineContext,
      params.mediaGraph,
      params.directorState,
      params.availableAssets
    );
    return { plan, plannerSource: "deterministic", plannerReason: reason, llmAttempts: attempts };
  }

  private static buildPlan(
    params: PlanGenerationParams,
    operations: CreativeOperation[],
    explanation: string,
    requiresConfirmation: boolean
  ): CreativeEditPlan {
    const ctx = params.timelineContext;
    const reframe = operations.find((o) => o.type === "reframeSubject" || o.type === "changeAspectRatio") as any;
    const aspect = reframe?.targetAspect || ctx.currentAspect;
    return {
      version: "1.0.0",
      intent: {
        platform: aspect === "9:16" ? "tiktok" : "general",
        aspectRatio: aspect,
        resolution: ctx.currentResolution,
        stylePreset: "CUSTOM",
        energy: "medium",
        pacing: "dynamic",
        captionStyle: "HORMOZI_BOUNCE",
        audioStyle: "VOICE_PRIORITY_DUCKED",
        visualStyle: "CLEAN_ATTENTION",
      },
      constraints: ctx.userConstraints,
      selectedSegments: [],
      removedSegments: [],
      reorderedSegments: [],
      brollPlan: [],
      captionPlan: [],
      operations,
      confidence: 0.9,
      explanation,
      requiresConfirmation,
    };
  }

  static summarizeOperations(ops: CreativeOperation[]): string {
    if (ops.length === 0) return "No changes were needed.";
    const names = Array.from(new Set(ops.map((o) => o.type)));
    return `Applied ${ops.length} edit${ops.length === 1 ? "" : "s"}: ${names.join(", ")}.`;
  }

  /** Builds the full director prompt. Exported for tests / prompt inspection. */
  static buildPrompt(params: PlanGenerationParams): string {
    const ctx = params.timelineContext;
    const g = params.mediaGraph;
    const lines: string[] = [];

    lines.push(
      DIRECTOR_PERSONA,
      `## Editing craft (how you edit; never recite this to the creator)`,
      `- Hook: start tight on the first spoken word; a pattern interrupt in the first 1.5s (punch-in zoom, bold title or cutaway) works well.`,
      `- Pacing: on energetic edits avoid a static frame for more than ~4s; alternate the main shot, punch-in zooms on key phrases, B-roll that shows what is being said, highlighted captions.`,
      `- High-energy styles (MrBeast, Hormozi): cut pauses over 0.4s, zooms on punchlines, kinetic captions, sound design. Calm / educational styles (Vox, Ali Abdaal): cleaner cuts, clean captions, atmospheric B-roll, subtle music.`,
      `- Audio: voice first; background music via addBackgroundMusic with duckUnderSpeech=true (about -18 to -22 dB under speech); whooshes and pops sparingly.`,
      `- B-roll: insertBroll with a vivid, specific stockQuery that matches what is being said ('laptop keyboard typing code', 'drone skyline sunset').`,
      `- 9:16: keep faces and captions in the middle safe zone, away from the platform UI at the top and bottom.`,
      ``,
      `Rules:`,
      `- All times are SECONDS on the CURRENT timeline described below (0 .. ${ctx.projectDurationSec.toFixed(2)}). Never go past the end.`,
      `- Times in one response all refer to the timeline as it is NOW, before any of your operations; the server orders cuts safely. Do not adjust later times for earlier cuts.`,
      `- Do what the creator asked. For vague style requests ("make it punchier for TikTok") choose a small set of concrete, tasteful operations (e.g. remove pauses, captions, 1-3 zooms on key moments, vertical reframe, autoSoundDesign).`,
      `- Use the transcript to find moments ("the punchline", "when I talk about the gym"). A zoom on a moment should start just before the key words.`,
      `- Prefer removeSilences over many removeRange calls for pauses, and autoCaptions for captions.`,
      `- Colours are #RRGGBB (yellow = #FFE600, cyan = #00E5FF, white = #FFFFFF).`,
      `- A named caption look (MrBeast, Hormozi, Ali Abdaal, neon, cinematic ...) is a template: set autoCaptions.template, or styleCaption.preset when captions already exist. Add highlightColor only when a colour is named ("MrBeast captions with red highlights" -> template MRBEAST_HYPE, highlightColor #EF4444).`,
      `- If something is impossible (e.g. captions without a transcript), do NOT fake it: skip that tool and say so briefly in your reply.`,
      `- When you edit: call the edit tools, then ${CHAT_TOOL_NAME} (phase "done": 1-2 casual sentences on what you actually did, quickReplies for likely tweaks), then exactly one finish_edit with the same short summary.`,
      `- When you only talk (recommend / gather / confirm / chat): call ONLY ${CHAT_TOOL_NAME}. No edit tools, no finish_edit.`,
      `- When the creator asks to keep something unchanged ("don't touch the music", "keep the first 10 seconds"), put it in finish_edit.preserve and do not edit it.`,
      `- ${UNTRUSTED_DATA_POLICY}`,
      ``
    );

    lines.push(`## Current timeline`);
    lines.push(`- duration: ${ctx.projectDurationSec.toFixed(2)}s, canvas ${ctx.currentAspect} (${ctx.currentResolution.width}x${ctx.currentResolution.height}), ${ctx.clipsCount} clip(s)`);
    if (params.currentEditIR) lines.push(...this.describeEditIR(params.currentEditIR));
    lines.push(``);

    lines.push(`## Media analysis (timeline seconds)`);
    const words = g.transcript || [];
    if (words.length === 0) {
      lines.push(`Transcript: NONE AVAILABLE (captions, filler removal and transcript-based edits are not possible).`);
    } else {
      const shown = words.slice(0, MAX_TRANSCRIPT_WORDS);
      lines.push(`Transcript (${words.length} words, format start-end:word${words.length > shown.length ? `, first ${shown.length} shown` : ""}):`);
      // Spoken words are untrusted data (a video can say "ignore your instructions"): fenced and neutralised.
      // Phrase detection runs on the joined words (the timed listing would hide "ignore previous instructions").
      const safeWords = neutraliseWordSequence(shown.map((w) => w.word)).words;
      lines.push(fenceUntrusted("transcript", shown.map((w, i) => `${w.startSeconds.toFixed(2)}-${w.endSeconds.toFixed(2)}:${safeWords[i]}`).join(" "), { maxChars: 120000 }).block);
      // The same words as spoken lines (split at pauses), so sentences, questions and changes of speaker are
      // readable; a long pause before/after a line that sounds like a question usually means another speaker.
      const spoken: string[] = [];
      let from = 0;
      for (let i = 1; i <= shown.length; i++) {
        if (i < shown.length && shown[i].startSeconds - shown[i - 1].endSeconds < SPOKEN_LINE_PAUSE_SEC) continue;
        const gapBefore = from > 0 ? shown[from].startSeconds - shown[from - 1].endSeconds : shown[0].startSeconds;
        spoken.push(`[${shown[from].startSeconds.toFixed(2)}-${shown[i - 1].endSeconds.toFixed(2)}, pause before ${gapBefore.toFixed(1)}s] ${safeWords.slice(from, i).join(" ")}`);
        from = i;
      }
      lines.push(`Spoken lines (split at pauses of ${SPOKEN_LINE_PAUSE_SEC}s+; speakers are NOT labelled, judge from wording and pauses):`);
      lines.push(fenceUntrusted("transcript", spoken.join("\n"), { maxChars: 60000 }).block);
    }
    const sil = g.silences || [];
    lines.push(
      sil.length === 0
        ? `Silences: none detected/supplied.`
        : `Silences (start+duration): ${sil.slice(0, 200).map((s) => `${s.startSeconds.toFixed(2)}+${s.durationSeconds.toFixed(2)}`).join(", ")}`
    );
    const sceneStarts = (g.scenes || []).map((s) => s.startSeconds).filter((t) => t > 0);
    if (sceneStarts.length) lines.push(`Scene cuts at: ${sceneStarts.slice(0, 100).map((t) => t.toFixed(2)).join(", ")}`);
    if (g.faces?.[0]?.averageCoords) lines.push(`Main face centre (0..1): x=${g.faces[0].averageCoords.x.toFixed(2)}, y=${g.faces[0].averageCoords.y.toFixed(2)}`);
    const assets = params.availableAssets || [];
    if (assets.length > 0) {
      lines.push(`Available assets for B-roll (assetId: name, duration):`);
      lines.push(fenceUntrusted("filename", assets.slice(0, 30).map((a) => `${sanitizeInlineUntrusted(a.id, 128)}: ${sanitizeInlineUntrusted(a.name, 120)}, ${a.durationSeconds}s`).join("; ")).block);
    }
    const c = ctx.userConstraints;
    const constraints = [
      c.doNotRemoveIntro ? "do not cut anything in the first 5s" : null,
      c.doNotAddMusic ? "do not add music" : null,
      ...(c.protectedTimeRanges || []).map((r) => `LOCKED ${r.startSec.toFixed(2)}s-${(r.startSec + r.durationSec).toFixed(2)}s (no cuts, speed changes, reorders, zooms, B-roll, effects or text there)`),
      ...((c as any).lockedTracks || []).map((t: string) => `LOCKED ${t} track (do not change it)`),
    ].filter(Boolean);
    if (constraints.length) lines.push(`Creator constraints (enforced by the server; operations that break them are dropped): ${constraints.join("; ")}`);
    lines.push(``);

    const history = (params.history || []).slice(-MAX_HISTORY_TURNS);
    if (history.length) {
      lines.push(`## Conversation so far (oldest first)`);
      for (const t of history) lines.push(`${t.role === "user" ? "Creator" : "You"}: ${truncate(t.content, 900)}`);
      lines.push(``);
    }

    if (params.contextSections?.length) lines.push(...params.contextSections);

    lines.push(`## Creator's latest message (reply to it following the conversation flow above)`);
    lines.push(JSON.stringify(params.prompt));
    return lines.join("\n");
  }

  private static describeEditIR(ir: EditIR): string[] {
    const s = (t: any) => RationalTimeMath.toSeconds(t).toFixed(2);
    const out: string[] = [];
    const main = ir.tracks.videoTracks[0];
    if (main) {
      const clips = main.clips.slice(0, 40).map((c) => {
        const rot = c.transform?.rotationDeg ? ` rot${c.transform.rotationDeg}` : "";
        const flip = c.transform?.flipH ? " mirrored" : "";
        const mute = (c.volumeDb ?? 0) <= -60 ? " muted" : "";
        return `${c.id}[${s(c.timelineRange.start)}+${s(c.timelineRange.duration)}${(c.speedMultiplier || 1) !== 1 ? ` @${c.speedMultiplier}x` : ""}${rot}${flip}${mute}]`;
      });
      out.push(`- main clips: ${clips.join(" ")}${main.clips.length > 40 ? " ..." : ""}`);
    }
    const caps = ir.tracks.captionTrack.filter((c) => c.role !== "title");
    const titles = ir.tracks.captionTrack.filter((c) => c.role === "title");
    out.push(`- captions: ${caps.length}${caps[0] ? ` (preset ${caps[0].style.preset}, text ${caps[0].style.textColor}, highlight ${caps[0].style.highlightColor})` : ""}; titles: ${titles.map((t) => `${t.id}:"${sanitizeInlineUntrusted(truncate(t.text, 40), 60)}"@${s(t.timeRange.start)}+${s(t.timeRange.duration)}`).join(", ") || "none"}`);
    out.push(`- zooms: ${ir.tracks.cameraTrack.map((z) => `${z.id}@${s(z.timeRange.start)}+${s(z.timeRange.duration)} x${z.scale}`).join(", ") || "none"}`);
    const fx = ir.tracks.effectTrack ?? [];
    if (fx.length) out.push(`- effects: ${fx.slice(0, 40).map((e: any) => `${e.id}:${e.type}@${s(e.timeRange.start)}+${s(e.timeRange.duration)}`).join(", ")}`);
    const sfx = ir.tracks.audioTracks.filter((t) => t.type === "SFX").flatMap((t) => t.clips);
    if (sfx.length) out.push(`- sound effects: ${sfx.slice(0, 40).map((c: any) => `${c.id}@${s(c.timelineRange.start)}`).join(", ")}`);
    const vo = ir.tracks.audioTracks.filter((t) => t.type === "VOICEOVER").flatMap((t) => t.clips);
    if (vo.length) out.push(`- creator's recorded voiceovers (keep them; music ducks under them): ${vo.slice(0, 20).map((c) => `${s(c.timelineRange.start)}+${s(c.timelineRange.duration)}`).join(", ")}`);
    const broll = ir.tracks.videoTracks.filter((t) => t.type !== "MAIN_VIDEO").flatMap((t) => t.clips);
    const layerDesc = (b: (typeof broll)[number]) =>
      b.layer?.mode === "overlay" ? ` layer(x${b.layer.x} y${b.layer.y} scale${b.layer.scale}${b.layer.keyframes?.length ? " keyframed" : ""})` : "";
    out.push(`- b-roll overlays: ${broll.map((b) => `${b.id}(${sanitizeInlineUntrusted(b.assetId, 60)})@${s(b.timelineRange.start)}+${s(b.timelineRange.duration)}${layerDesc(b)}`).join(", ") || "none"}`);
    const bgm = ir.tracks.audioTracks.find((t) => t.type === "BGM" && t.clips.length > 0);
    out.push(`- music: ${bgm ? `yes (track "${bgm.id}", ${bgm.volumeDb}dB${bgm.duckWithSpeech ? ", ducked under speech" : ""})` : "none"}`);
    const original = ir.tracks.audioTracks.find((t) => t.id === "original");
    out.push(`- original audio (trackId "original"): ${original ? original.volumeDb : 0}dB`);
    // Measured edit style + the still-raw tail, so "complete / continue this video" follows the creator's own style.
    out.push(...describeEditStyle(deriveEditStyle(ir)));
    return out;
  }

  private static buildCoveragePrompt(basePrompt: string, calls: Array<{ name: string; args: any }>, missing: string[]): string {
    return [
      basePrompt,
      ``,
      `## Your previous plan skipped part of the creator's request`,
      `Previous tool calls: ${truncate(JSON.stringify(calls), 6000)}`,
      `The creator explicitly asked for these, and the plan has none of them:`,
      ...missing.map((m) => `- ${m}`),
      ``,
      `Call the tools again with the COMPLETE set of operations (keep the good ones, add the missing ones), then finish_edit. If one is truly impossible with this footage, skip it and say why in finish_edit.`,
    ].join("\n");
  }

  private static buildRepairPrompt(basePrompt: string, calls: Array<{ name: string; args: any }>, errors: string[]): string {
    return [
      basePrompt,
      ``,
      `## Your previous attempt was rejected by the validator`,
      `Previous tool calls: ${truncate(JSON.stringify(calls.map((c) => ({ name: c.name, args: c.args }))), 6000)}`,
      `Errors:`,
      ...errors.map((e) => `- ${e}`),
      ``,
      `Call the tools again with the COMPLETE corrected set of operations (not only the fixed ones), then finish_edit.`,
    ].join("\n");
  }

  /**
   * Deterministic local planner (keyword + telemetry heuristics). Used only as a labelled
   * fallback when no LLM is available or the LLM output could not be validated.
   */
  public static planDeterministically(
    prompt: string,
    context: TimelineContext,
    graph: MediaIntelligenceGraph,
    directorState?: DirectorState,
    availableAssets: MediaAssetDescriptor[] = []
  ): CreativeEditPlan {
    return DeterministicPlanner.plan(prompt, context, graph, directorState, availableAssets);
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/** Separates the `reply_to_creator` call (the conversation) from the edit / finish_edit calls. */
function splitChatCalls(calls: Array<{ name: string; args: any }>): { calls: Array<{ name: string; args: any }>; conversation?: DirectorConversation } {
  let conversation: DirectorConversation | undefined;
  const rest: Array<{ name: string; args: any }> = [];
  for (const c of calls) {
    if (c?.name === CHAT_TOOL_NAME) conversation = parseConversation(c.args) || conversation;
    else rest.push(c);
  }
  return { calls: rest, conversation };
}
