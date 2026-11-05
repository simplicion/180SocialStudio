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
  DirectorIntent,
  DirectorIntentSchema,
  DIRECTOR_TOOL_SPECS,
  INTENT_TOOL_NAME,
  buildIntentPrompt,
  zodToPortableJsonSchema,
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
  /** Provenance and locks of the current timeline's items (MobileEditIR.itemMeta), shown to the model. */
  itemMeta?: Record<string, { origin?: string; locked?: boolean }>;
  /**
   * The request's scope (Phase 3): the planner only gets `tools` (null = every tool), and the prompt states what
   * may change. Absent = a whole edit (the desktop / legacy path).
   */
  scope?: { mode: DirectorIntent["mode"] | "open"; targets: DirectorIntent["targets"]; mustNotTouch: string[]; tools: string[] | null };
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
  { label: "captions", ask: /\b(captions?|subtitles?)\b/, ops: ["autoCaptions", "styleCaption", "addCaption", "updateTextStyle", "editText"], needsTranscript: true },
  { label: "caption translation", ask: /\b(translate (the |my )?(captions?|subtitles?)|(captions?|subtitles?) (in|into|to) (hinglish|roman|english|hindi|tamil|telugu|bengali|marathi|gujarati|urdu|punjabi|spanish|french)|hinglish (captions?|subtitles?))\b/, ops: ["translateCaptions"], needsTranscript: true },
  { label: "zoom / punch-in", ask: /\b(zooms?|punch[- ]?ins?)\b/, ops: ["addZoom", "reframeSubject", "updateZoom"] },
  { label: "B-roll", ask: /\b(b[- ]?roll|cutaways?|stock (clip|footage|video))\b/, ops: ["insertBroll", "updateOverlay"] },
  { label: "sticker", ask: /\b(stickers?|emojis?)\b/, ops: ["addSticker", "updateOverlay"] },
  { label: "background music", ask: /\b(music|soundtrack|bgm)\b/, ops: ["addBackgroundMusic", "updateMusic", "changeMusicTrack"] },
  { label: "colour grade", ask: /\b(colou?r ?grad\w*|grade|filter|lut)\b/, ops: ["applyFilter"] },
  { label: "title text", ask: /\b(title|headline|hook text|text overlay)\b/, ops: ["addText", "editText", "updateTextStyle"] },
  { label: "transitions", ask: /\b(transitions?|crossfades?|dissolves?)\b/, ops: ["addTransition"] },
  { label: "filler-word removal", ask: /\bfillers?\b/, ops: ["cleanFillers"], needsTranscript: true, removal: true },
  { label: "sound effects", ask: /\b(sound effects?|sfx|whoosh\w*)\b/, ops: ["addSoundEffect", "autoSoundDesign", "setSfxVolume"] },
];
const NEGATION = /\b(no|not|don'?t|do not|without|remove|keep|skip|never)\b[\w\s,'-]{0,24}$/;
/** Verbs that ask for something NEW ("add music", "put a zoom", "with captions"). */
const CREATE_VERB = /\b(add|adds|adding|put|insert|give|include|use|want|need|throw in|slap|drop in|with|some|more|another|new|create|generate|apply)\b/;
/** Verbs and phrasing that change something that is already there (F-07: "make the music quieter"). */
const MODIFY_VERB = /\b(make|change|fix|move|lower|raise|edit|adjust|replace|update|tweak|shorten|lengthen|resize|recolou?r|restyle|turn|set|reduce|increase|swap|shift|nudge|tone down|turn (up|down))\b/;
const MODIFY_AFTER = /^\s*(is|are|was|were|should|looks?|feels?|sounds?|seems?|at \d|on \d|(is |are )?too\b|(a bit |a little )?(louder|quieter|softer|stronger|weaker|bigger|smaller|larger|longer|shorter|faster|slower|higher|lower|brighter|darker)\b)/;
/** Pointing at an item that exists ("the music", "my title", "this zoom"). */
const REFERENCE = /\b(the|my|this|that|these|those|your|its)\s+([\w-]+\s+)?$/;

/**
 * Whether the feature word at `index` asks for a new item (true) or talks about an existing one (false).
 * The current clause is what counts ("cut the pauses and add captions": "add" belongs to "captions").
 */
function asksForNew(text: string, index: number, length: number): boolean {
  const clauseStart = Math.max(
    0,
    ...[...text.slice(0, index).matchAll(/[.,;!?]|\b(and|then|also|plus)\b/g)].map((m) => (m.index ?? 0) + m[0].length)
  );
  const before = text.slice(clauseStart, index).slice(-48);
  const after = text.slice(index + length).split(/[.,;!?]|\b(and|then)\b/)[0] ?? "";
  if (CREATE_VERB.test(before)) return true;
  if (MODIFY_VERB.test(before) || MODIFY_AFTER.test(after) || MODIFY_VERB.test(after.slice(0, 24))) return false;
  if (REFERENCE.test(before)) return false;
  // Named on its own ("yellow captions please", "captions"): an ask.
  return true;
}

/** Feature labels the creator explicitly asked to ADD (see COVERAGE_RULES). Edits of existing items do not count. */
export function requestedFeatures(prompt: string, hasTranscript: boolean): string[] {
  const text = prompt.toLowerCase();
  const out: string[] = [];
  for (const r of COVERAGE_RULES) {
    const re = new RegExp(r.ask.source, "g");
    let asked = false;
    for (const m of text.matchAll(re)) {
      const at = m.index ?? 0;
      // "remove / cut the fillers" is the ask itself, not a negation.
      if (!r.removal && NEGATION.test(text.slice(Math.max(0, at - 30), at))) continue;
      if (!r.removal && !asksForNew(text, at, m[0].length)) continue;
      asked = true;
      break;
    }
    if (!asked) continue;
    if (r.needsTranscript && !hasTranscript) continue;
    out.push(r.label);
  }
  return out;
}

/** Identity of an operation for merging two plans: same type, same target, same moment (to 0.5 s). */
function operationKey(op: any): string {
  const t = [op.startSec, op.timelineStartSec, op.atSec].find((v) => typeof v === "number");
  return JSON.stringify([
    op.type,
    op.id ?? op.clipId ?? op.captionId ?? op.targetId ?? op.trackId ?? op.kind ?? null,
    typeof t === "number" ? Math.round(t * 2) / 2 : null,
    op.text ?? op.query ?? op.stockQuery ?? op.effect ?? null,
  ]);
}

/** The first plan plus what the coverage retry added (a retry that answers with only the missing op loses nothing). */
export function mergeCoverageOperations<T>(original: T[], retry: T[]): T[] {
  const have = new Set(original.map(operationKey));
  const out = [...original];
  for (const op of retry) {
    const k = operationKey(op);
    if (have.has(k)) continue;
    have.add(k);
    out.push(op);
  }
  return out;
}

/** Requested tool families the plan does not contain. */
export function missingRequestedOperations(prompt: string, operationTypes: string[], hasTranscript: boolean, allowedTools?: Set<string> | null): string[] {
  const have = new Set(operationTypes);
  const wanted = new Set(requestedFeatures(prompt, hasTranscript));
  return COVERAGE_RULES
    .filter((r) => wanted.has(r.label) && !r.ops.some((o) => have.has(o)))
    .filter((r) => !allowedTools || r.ops.some((o) => allowedTools.has(o)))
    .map((r) => `${r.label} (${r.ops.filter((o) => !allowedTools || allowedTools.has(o)).join(" / ")})`);
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

    // A scoped request only offers the tools of its scope (plus finish_edit and the chat reply).
    const allowed = params.scope?.tools ? new Set(params.scope.tools) : null;
    const tools = [
      ...buildDirectorToolDefinitions().filter((t) => !allowed || t.function.name === "finish_edit" || allowed.has(t.function.name)),
      buildChatToolDefinition(),
    ];
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
    // Only asks the scope can serve are checked (a scoped "make the music quieter" is never pushed to add things).
    const missing = params.checkCoverage === false
      ? []
      : missingRequestedOperations(params.prompt, validation.operations.map((o: any) => o.type), hasTranscript, allowed);
    let coverageNote = "";
    if (missing.length > 0) {
      const calls = validation.operations.map((o: any) => ({ name: o.type, args: o }));
      const prompt = this.buildCoveragePrompt(basePrompt, calls, missing);
      try {
        const third = await withTimeout(client.generateWithTools(prompt, tools, options), timeoutMs, "LLM coverage call");
        const thirdSplit = splitChatCalls(third?.toolCalls || []);
        const retry = validateDirectorToolCalls(thirdSplit.calls);
        // Union, never replace: the good operations of the first plan stay (the retry may answer with only the missing op).
        const merged = mergeCoverageOperations(validation.operations, retry.operations);
        const stillMissing = missingRequestedOperations(params.prompt, merged.map((o: any) => o.type), hasTranscript);
        if (retry.errors.length === 0 && retry.operations.length > 0 && stillMissing.length < missing.length) {
          validation = { ...retry, operations: merged, finish: retry.finish ?? validation.finish };
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

  /**
   * The intent step (Phase 3.1): one small structured call that classifies the request before planning. Returns null
   * when there is no usable LLM or its answer is not valid; the caller then classifies offline.
   */
  static async classifyIntent(params: Pick<PlanGenerationParams, "prompt" | "history" | "currentEditIR" | "itemMeta" | "llmClient" | "llmModel" | "companyId" | "llmTimeoutMs">): Promise<{ intent: DirectorIntent; reason: string } | null> {
    const { client, model } = await this.resolveClient(params as PlanGenerationParams);
    if (!client || typeof client.generateWithTools !== "function") return null;
    const tool = {
      type: "function",
      function: {
        name: INTENT_TOOL_NAME,
        description: "Classify the creator's request (mode, targets, the tools needed, tracks to leave alone, or one clarifying question).",
        parameters: zodToPortableJsonSchema(DirectorIntentSchema),
      },
    };
    const prompt = buildIntentPrompt({
      prompt: params.prompt,
      timelineLines: params.currentEditIR ? this.describeEditIR(params.currentEditIR, params.itemMeta).slice(0, 120) : ["(raw clip, nothing edited yet)"],
      history: params.history,
    });
    const options: any = { max_tokens: 600, temperature: 0 };
    if (model) options.model = model;
    try {
      const res = await withTimeout(client.generateWithTools(prompt, [tool], options), Math.min(20000, directorLlmTimeoutMs(params.llmTimeoutMs)), "LLM intent call");
      const call = (res?.toolCalls || []).find((c: any) => c?.name === INTENT_TOOL_NAME);
      if (!call) return null;
      const parsed = DirectorIntentSchema.safeParse(call.args || {});
      if (!parsed.success) return null;
      // Tool names the model invented are dropped; real ones are kept.
      const known = new Set(DIRECTOR_TOOL_SPECS.map((s) => s.name as string));
      return { intent: { ...parsed.data, allowedTools: parsed.data.allowedTools.filter((t) => known.has(t)) }, reason: `${client.provider}${model ? `/${model}` : ""} intent call` };
    } catch {
      return null;
    }
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
    const mode = params.scope?.mode ?? "full_edit";
    const fullEdit = mode === "full_edit";

    // The first rule, before anything else: change only what was asked (Phase 3.2).
    lines.push(
      DIRECTOR_PERSONA,
      `## The most important rule`,
      `Change only what the creator asked. Everything not mentioned must stay exactly as it is. Prefer the update tools over removing and re-adding. Never regenerate captions, replace music, reframe or re-cut unless asked.`,
      ``
    );
    if (params.scope) {
      const targets = params.scope.targets.map((t) => `${t.kind}${t.ids?.length ? ` (${t.ids.join(", ")})` : ""}${t.timeSec !== undefined ? ` at ${t.timeSec}s` : ""}`);
      lines.push(
        `## Scope of this request (decided before planning)`,
        mode === "open"
          ? `- the request could not be scoped before planning: work out what it asks for and change only that.`
          : `- mode: ${mode}${targets.length ? `; about: ${targets.join(", ")}` : ""}`,
        ...(params.scope.mustNotTouch.length ? [`- do not touch: ${params.scope.mustNotTouch.join(", ")}`] : []),
        params.scope.tools
          ? `- you only have the tools for this scope; anything else on the timeline is locked for this turn.`
          : `- whole-video edit: every tool is available.`,
        ``
      );
    }
    if (fullEdit) lines.push(
      `## Editing craft for a whole-video edit (how you edit; never recite this to the creator)`,
      `- Hook: start tight on the first spoken word; a pattern interrupt in the first 1.5s (punch-in zoom, bold title or cutaway) works well.`,
      `- Pacing: on energetic edits avoid a static frame for more than ~4s; alternate the main shot, punch-in zooms on key phrases, B-roll that shows what is being said, highlighted captions.`,
      `- High-energy styles (MrBeast, Hormozi): cut pauses over 0.4s, zooms on punchlines, kinetic captions, sound design. Calm / educational styles (Vox, Ali Abdaal): cleaner cuts, clean captions, atmospheric B-roll, subtle music.`,
      `- Audio: voice first; background music via addBackgroundMusic with duckUnderSpeech=true (about -18 to -22 dB under speech); whooshes and pops sparingly.`,
      `- B-roll: insertBroll with a vivid, specific stockQuery that matches what is being said ('laptop keyboard typing code', 'drone skyline sunset').`,
      `- 9:16: keep faces and captions in the middle safe zone, away from the platform UI at the top and bottom.`,
      ``
    );
    lines.push(
      `Rules:`,
      `- All times are SECONDS on the CURRENT timeline described below (0 .. ${ctx.projectDurationSec.toFixed(2)}). Never go past the end.`,
      `- Times in one response all refer to the timeline as it is NOW, before any of your operations; the server orders cuts safely. Do not adjust later times for earlier cuts.`,
      fullEdit
        ? `- Do what the creator asked. For a whole-video ask ("make it punchier for TikTok") choose a small set of concrete, tasteful operations (e.g. remove pauses, captions, 1-3 zooms on key moments, autoSoundDesign); reframe only a clip that is not already in the target aspect.`
        : `- Do exactly what the creator asked and nothing more: no extra zooms, captions, music, B-roll or cuts.`,
      `- Use the transcript to find moments ("the punchline", "when I talk about the gym"). A zoom on a moment should start just before the key words.`,
      `- Prefer removeSilences over many removeRange calls for pauses, and autoCaptions for captions.`,
      `- Colours are #RRGGBB (yellow = #FFE600, cyan = #00E5FF, white = #FFFFFF).`,
      `- A named caption look (MrBeast, Hormozi, Ali Abdaal, neon, cinematic ...) is a template: set autoCaptions.template, or styleCaption.preset when captions already exist. Add highlightColor only when a colour is named ("MrBeast captions with red highlights" -> template MRBEAST_HYPE, highlightColor #EF4444).`,
      `- If something is impossible (e.g. captions without a transcript), do NOT fake it: skip that tool and say so briefly in your reply.`,
      `- When you edit: call the edit tools, then ${CHAT_TOOL_NAME} (phase "done": 1-2 casual sentences on what you actually did, quickReplies for likely tweaks), then exactly one finish_edit with the same short summary.`,
      `- When you only talk (recommend / gather / confirm / chat): call ONLY ${CHAT_TOOL_NAME}. No edit tools, no finish_edit.`,
      `- When the creator asks to keep something unchanged ("don't touch the music", "keep the first 10 seconds"), put it in finish_edit.preserve and do not edit it.`,
      `- To change something that is already on the timeline, use the update tools on its id (editText, updateTextStyle, retimeItem, updateOverlay, updateZoom, updateEffect, updateMusic, setSfxVolume, setClipVolume, panClip ...). Never remove an item and add a new one to change it.`,
      `- Items marked "by":"manual" are the creator's own work: change them only when the request is about them. Items marked "locked":true must not be changed or removed at all (the server refuses it).`,
      `- ${UNTRUSTED_DATA_POLICY}`,
      ``
    );

    lines.push(`## Current timeline`);
    lines.push(`- duration: ${ctx.projectDurationSec.toFixed(2)}s, canvas ${ctx.currentAspect} (${ctx.currentResolution.width}x${ctx.currentResolution.height}), ${ctx.clipsCount} clip(s)`);
    if (params.currentEditIR) lines.push(...this.describeEditIR(params.currentEditIR, params.itemMeta));
    lines.push(``);

    lines.push(`## Media analysis (timeline seconds)`);
    const words = g.transcript || [];
    if (words.length === 0) {
      lines.push(`Transcript: NONE AVAILABLE (captions, filler removal and transcript-based edits are not possible).`);
    } else {
      const shown = words.slice(0, MAX_TRANSCRIPT_WORDS);
      // Spoken words are untrusted data (a video can say "ignore your instructions"): fenced and neutralised.
      // Phrase detection runs on the joined words (the timed listing would hide "ignore previous instructions").
      const safeWords = neutraliseWordSequence(shown.map((w) => w.word)).words;
      // Word-level times are needed to place things on words (add / whole edit); a change to existing items works from
      // the spoken lines below, which saves about 40% of the prompt (Phase 3.2).
      // Targets placed on spoken words (cuts, captions, zooms, B-roll ...) keep the word timings.
      const untimed = new Set(["music", "audio", "color", "canvas", "watermark", "voiceover", "transition"]);
      const needsWordTimes = mode !== "modify_existing" || (params.scope?.targets ?? []).some((t) => !untimed.has(t.kind));
      if (needsWordTimes) {
        lines.push(`Transcript (${words.length} words, format start-end:word${words.length > shown.length ? `, first ${shown.length} shown` : ""}):`);
        lines.push(fenceUntrusted("transcript", shown.map((w, i) => `${w.startSeconds.toFixed(2)}-${w.endSeconds.toFixed(2)}:${safeWords[i]}`).join(" "), { maxChars: 120000 }).block);
      } else {
        lines.push(`Transcript: ${words.length} words (spoken lines with times below).`);
      }
      // The same words as spoken lines (split at pauses), so sentences, questions and changes of speaker are
      // readable; a long pause before/after a line that sounds like a question usually means another speaker.
      const spoken: string[] = [];
      let from = 0;
      // Speaker labels, when the transcriber gives them (diarization): a new line starts at each change of speaker.
      const labelled = shown.some((w) => !!w.speakerId);
      for (let i = 1; i <= shown.length; i++) {
        const sameSpeaker = !labelled || i >= shown.length || shown[i].speakerId === shown[i - 1].speakerId;
        if (i < shown.length && sameSpeaker && shown[i].startSeconds - shown[i - 1].endSeconds < SPOKEN_LINE_PAUSE_SEC) continue;
        const gapBefore = from > 0 ? shown[from].startSeconds - shown[from - 1].endSeconds : shown[0].startSeconds;
        const who = labelled ? ` ${sanitizeInlineUntrusted(shown[from].speakerId || "?", 20)}:` : "";
        spoken.push(`[${shown[from].startSeconds.toFixed(2)}-${shown[i - 1].endSeconds.toFixed(2)}, pause before ${gapBefore.toFixed(1)}s]${who} ${safeWords.slice(from, i).join(" ")}`);
        from = i;
      }
      lines.push(labelled
        ? `Spoken lines (split at pauses of ${SPOKEN_LINE_PAUSE_SEC}s+ and at each change of speaker; speakers are labelled by the transcriber):`
        : `Spoken lines (split at pauses of ${SPOKEN_LINE_PAUSE_SEC}s+; speakers are NOT labelled, judge from wording and pauses):`);
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
      // Only what actually landed on the timeline is history: a proposal the creator never applied, or a change
      // they undid, is labelled so (F-16).
      const label: Record<string, string> = { applied: "You (applied)", proposed_not_applied: "You (proposal, NOT applied)", undone: "You (applied, then UNDONE by the creator)" };
      for (const t of history) {
        if (t.role === "user") {
          lines.push(`Creator: ${truncate(t.content, 900)}`);
          continue;
        }
        const ops = t.appliedOps?.length ? ` [changes: ${truncate(t.appliedOps.slice(0, 12).join("; "), 600)}]` : "";
        lines.push(`${t.status ? label[t.status] : "You"}: ${truncate(t.content, 900)}${t.status ? ops : ""}`);
      }
      lines.push(``);
    }

    if (params.contextSections?.length) lines.push(...params.contextSections);

    lines.push(`## Creator's latest message (reply to it following the conversation flow above)`);
    lines.push(JSON.stringify(params.prompt));
    return lines.join("\n");
  }

  /**
   * The timeline as the model sees it (F-15): one compact JSON line per item with its id, who made it, whether it is
   * locked, its time range and the properties the update tools can change. Each lane shows at most 60 items and the
   * whole description stays under ~24k characters (~6k tokens).
   */
  static describeEditIR(ir: EditIR, itemMeta: Record<string, { origin?: string; locked?: boolean }> = {}): string[] {
    const n2 = (v: number) => Math.round(v * 100) / 100;
    const t = (x: any) => n2(RationalTimeMath.toSeconds(x));
    const span = (start: any, dur: any) => [t(start), n2(RationalTimeMath.toSeconds(start) + RationalTimeMath.toSeconds(dur))];
    const txt = (v: string | undefined, n = 60) => sanitizeInlineUntrusted(truncate(v || "", n), n + 10);
    const tag = (id: string) => ({ ...(itemMeta[id]?.origin ? { by: itemMeta[id].origin } : {}), ...(itemMeta[id]?.locked ? { locked: true } : {}) });
    const clean = (o: Record<string, any>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== false && !(Array.isArray(v) && !v.length)));
    const out: string[] = [];
    let budget = 24000;
    const lane = (title: string, rows: Array<Record<string, any>>) => {
      if (!rows.length) {
        out.push(`- ${title}: none`);
        return;
      }
      out.push(`- ${title} (${rows.length}):`);
      for (const r of rows.slice(0, 60)) {
        const line = `  ${JSON.stringify(clean(r))}`;
        if (budget - line.length < 0) {
          out.push(`  … (description shortened)`);
          return;
        }
        budget -= line.length;
        out.push(line);
      }
      if (rows.length > 60) out.push(`  … ${rows.length - 60} more`);
    };
    const label = (path: string) => {
      if (path.startsWith("stock-query://") || path.startsWith("stock-music://")) return `search:${decodeURIComponent(path.replace(/^stock-(query|music):\/\//, ""))}`;
      if (/^https?:\/\//i.test(path)) return path.split("?")[0].split("/").pop() || "online file";
      if (path.startsWith("device-asset://") || path.startsWith("device-file://") || path.startsWith("asset://")) return "file on the phone";
      return path;
    };

    const main = ir.tracks.videoTracks.find((v) => v.type === "MAIN_VIDEO") || ir.tracks.videoTracks[0];
    lane("main clips (footage, in order)", (main?.clips ?? []).map((c) => {
      const tr: any = c.transform || {};
      return {
        id: c.id, at: span(c.timelineRange.start, c.timelineRange.duration), src: txt(c.assetId, 40),
        speed: (c.speedMultiplier || 1) !== 1 ? c.speedMultiplier : undefined,
        vol: (c.volumeDb ?? 0) !== 0 ? c.volumeDb : undefined,
        rot: tr.rotationDeg || undefined, mirrored: tr.flipH,
        framing: tr.letterbox ? "fit (whole frame)" : tr.crop ? "crop set" : undefined,
        filter: tr.filterPreset && tr.filterPreset !== "NORMAL" ? tr.filterPreset : undefined,
        transitionIn: c.transitionIn ? `${c.transitionIn.type} ${t(c.transitionIn.duration)}s` : undefined,
        fadeIn: (c as any).audioFadeInMs ? (c as any).audioFadeInMs / 1000 : undefined,
        fadeOut: (c as any).audioFadeOutMs ? (c as any).audioFadeOutMs / 1000 : undefined,
        cleanVoice: (c as any).voiceCleanup,
        ...tag(c.id),
      };
    }));

    // Speech captions share one look: shown once, with each caption's own differences.
    const caps = ir.tracks.captionTrack.filter((c) => c.role !== "title");
    const styleOf = (c: CaptionLike) => ({
      font: c.style.fontFamily, size: c.style.fontSize, color: c.style.textColor, highlight: c.style.highlightColor,
      stroke: c.style.strokeWidth ? `${c.style.strokeColor} ${c.style.strokeWidth}px` : undefined,
      box: c.style.pillBackground, upper: c.style.uppercase, glow: c.style.glow,
      pos: c.style.position ? [n2(c.style.position.x), n2(c.style.position.y)] : undefined,
      look: c.style.presetLabel || c.style.preset,
    });
    if (caps.length) {
      const common = JSON.stringify(clean(styleOf(caps[0])));
      out.push(`- caption look (unless a caption says otherwise): ${common}`);
    }
    lane("captions (speech)", caps.map((c) => {
      const own = JSON.stringify(clean(styleOf(c)));
      return { id: c.id, at: span(c.timeRange.start, c.timeRange.duration), text: txt(c.text), ...(own !== JSON.stringify(clean(styleOf(caps[0]))) ? { style: JSON.parse(own) } : {}), ...tag(c.id) };
    }));
    lane("titles / text", ir.tracks.captionTrack.filter((c) => c.role === "title").map((c) => ({
      id: c.id, at: span(c.timeRange.start, c.timeRange.duration), text: txt(c.text), ...clean(styleOf(c)),
      motion: [c.style.enter?.type && `in:${c.style.enter.type}`, c.style.exit?.type && `out:${c.style.exit.type}`, c.style.loop?.type && `loop:${c.style.loop.type}`].filter(Boolean),
      ...tag(c.id),
    })));
    lane("zooms", ir.tracks.cameraTrack.map((z) => ({ id: z.id, at: span(z.timeRange.start, z.timeRange.duration), scale: z.scale, center: [n2(z.targetCoords.x), n2(z.targetCoords.y)], rampMs: z.rampMs, ...tag(z.id) })));
    lane("effects", (ir.tracks.effectTrack ?? []).map((e: any) => ({ id: e.id, type: e.type, at: span(e.timeRange.start, e.timeRange.duration), intensity: e.intensity, ...tag(e.id) })));
    lane("B-roll / layers / stickers", ir.tracks.videoTracks.filter((v) => v !== main).flatMap((v) => v.clips).map((b) => {
      const sticker = b.mediaType === "image" && b.layer?.mode === "overlay";
      return {
        id: b.id, kind: sticker ? "sticker" : b.layer?.mode === "overlay" ? "pip" : b.mediaType === "image" ? "photo cutaway" : "cutaway",
        at: span(b.timelineRange.start, b.timelineRange.duration),
        source: txt(b.assetId.startsWith("emoji:") ? b.assetId : label(b.sourcePath), 50),
        pos: b.layer?.mode === "overlay" ? [n2(b.layer.x), n2(b.layer.y)] : undefined,
        scale: b.layer?.mode === "overlay" ? b.layer.scale : undefined,
        rot: b.layer?.rotation || undefined,
        keyframes: b.layer?.keyframes?.length || undefined,
        opacity: (b.transform?.opacity ?? 1) !== 1 ? b.transform?.opacity : undefined,
        sound: (b.volumeDb ?? -60) > -60 ? "on" : undefined,
        mask: b.mask?.shape, greenScreen: b.chromaKey ? true : undefined,
        ...tag(b.id),
      };
    }));
    lane("music", ir.tracks.audioTracks.filter((a) => a.type === "BGM").flatMap((a) => a.clips.map((c) => ({
      id: c.id, track: txt(c.sourceQuery || label(c.sourcePath), 50), levelDb: (a.volumeDb ?? 0) + (c.volumeDb ?? 0),
      fadeIn: c.fadeInDuration ? t(c.fadeInDuration) : undefined, fadeOut: c.fadeOutDuration ? t(c.fadeOutDuration) : undefined,
      duck: a.duckWithSpeech ? `${a.duckingConfig?.duckDb ?? -12}dB under speech` : "off",
      ...tag(c.id),
    }))));
    lane("sound effects", ir.tracks.audioTracks.filter((a) => a.type === "SFX").flatMap((a) => a.clips.map((c: any) => ({
      id: c.id, at: t(c.timelineRange.start), sound: txt(label(c.sourcePath), 40), levelDb: (a.volumeDb ?? 0) + (c.volumeDb ?? 0), ...tag(c.id),
    }))));
    lane("voiceovers (the creator's recordings / narration; music ducks under them)", ir.tracks.audioTracks.filter((a) => a.type === "VOICEOVER").flatMap((a) => a.clips.map((c) => ({
      id: c.id, at: span(c.timelineRange.start, c.timelineRange.duration), levelDb: (a.volumeDb ?? 0) + (c.volumeDb ?? 0), ...tag(c.id),
    }))));
    const original = ir.tracks.audioTracks.find((a) => a.id === "original");
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

type CaptionLike = EditIR["tracks"]["captionTrack"][number];

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
