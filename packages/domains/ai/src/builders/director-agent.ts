/**
 * Agentic enhancement loop (AI Director quality-fix plan, Phase 4).
 *
 * Instead of one call that must emit the whole edit, the model works in short stages on a WORKING timeline:
 * every edit call is validated, filtered (renderer gate, destructive guard, scope, item locks, locked ranges) and
 * compiled right away, and the model gets a tool_result per call (applied + what changed, or rejected + the reason)
 * so it can adapt. Read-only tools let it look up words, shots, the timeline, B-roll and music before it acts.
 *
 * Bounded: at most `maxTurns` model turns and `budgetMs` overall; what was applied before a stop is kept.
 * The module is generic: the Director supplies the per-turn `apply` pipeline and the read-only tool implementations.
 */
import { buildDirectorToolDefinitions, DIRECTOR_TOOL_SPECS, validateDirectorToolCalls, type CreativeOperation } from "@workspace/video-contracts";
import type { AgentContentPart, AgentMessage, AIClient, ReasoningEffort, ToolCall } from "../kernel/ai-provider.service";
import { buildChatToolDefinition, CHAT_TOOL_NAME, parseConversation, type DirectorConversation } from "./director-conversation";

export type AgentEditResult = { status: "applied"; changes: string[]; note?: string } | { status: "rejected"; reason: string };

export interface AgentApplyOutcome<IR> {
  ir: IR;
  /** One result per op, same order. */
  results: AgentEditResult[];
  /** Compiler change lines of this batch. */
  applied: string[];
  rejected: string[];
  /** The ops as they reached the compiler (after expansion), for the record. */
  compiled: CreativeOperation[];
}

export interface AgentReadTools<IR> {
  getWords(ir: IR, startSec: number, endSec: number): string;
  getShots(ir: IR, startSec: number, endSec: number): string;
  getTimelineSummary(ir: IR): string;
  searchBroll?(query: string, aspect: string): Promise<{ text: string; images?: AgentContentPart[] }>;
  searchMusic?(mood: string, durationSec: number): Promise<string>;
}

export interface AgentStage {
  id: string;
  label: string;
  /** Edit tools offered in this stage. */
  tools: string[];
  /** One line on what good work in this stage looks like. */
  brief: string;
}

export interface DirectorAgentParams<IR> {
  client: AIClient;
  model?: string;
  effort?: ReasoningEffort;
  system: string;
  /** The first user message: request, timeline, media analysis, context. */
  firstMessage: string;
  stages: AgentStage[];
  initialIR: IR;
  apply(ops: CreativeOperation[], ir: IR): AgentApplyOutcome<IR>;
  read: AgentReadTools<IR>;
  /** Labels of explicitly requested features still missing after the stages (coverage), given the applied op types. */
  missingRequested?(appliedTypes: string[]): string[];
  maxTurns?: number;
  budgetMs?: number;
  perCallTimeoutMs?: number;
  now?: () => number;
  /** Called after every model turn (telemetry). */
  onTurn?(info: { turn: number; stage: string; calls: string[]; applied: number; rejected: number }): void;
}

export interface DirectorAgentOutcome<IR> {
  kind: "edited" | "conversation";
  ir: IR;
  /** Validated ops the model asked for that were applied (before expansion). */
  operations: CreativeOperation[];
  /** Ops as compiled (after expansion). */
  compiled: CreativeOperation[];
  applied: string[];
  rejected: string[];
  /** translateCaptions ops: applied by the Director after the loop (they need the final captions). */
  translateOps: CreativeOperation[];
  conversation?: DirectorConversation;
  finish?: { summary?: string; requiresConfirmation?: boolean; brandWatermark?: "add" | "remove" | "keep"; preserve?: any };
  turns: number;
  stagesDone: string[];
  stopped: "finished" | "stages_done" | "turns" | "budget" | "error" | "conversation";
  coverageRetry: boolean;
  /** Rejections and validation errors returned to the model (the model could retry). */
  feedback: number;
  error?: string;
}

const PROPOSAL_PHASES = new Set(["recommend", "gather", "confirm"]);
const READ_TOOLS = ["get_words", "get_shots", "get_timeline_summary", "search_broll", "search_music"] as const;
const STAGE_DONE = "stage_done";

/** Tools for each stage of a whole edit. Edit tools not listed in an earlier stage land in the last one. */
export function wholeEditStages(allowed?: Set<string> | null, briefs: Record<string, string> = {}): AgentStage[] {
  const all = DIRECTOR_TOOL_SPECS.map((s) => s.name as string).filter((n) => n !== "finish_edit" && (!allowed || allowed.has(n)));
  const taken = new Set<string>();
  const pick = (re: RegExp) => all.filter((n) => !taken.has(n) && re.test(n)).map((n) => (taken.add(n), n));
  const stages: AgentStage[] = [
    { id: "cleanup", label: "pauses, fillers and pacing", tools: pick(/^(removeSilences|cleanFillers|removeRange|rippleDelete|trimClip|splitClip|changeSpeed|jlCut|freezeFrame)$/), brief: "Tighten the pacing: cut pauses and fillers the style calls for. Do not cut spoken lines the story kept." },
    { id: "captions", label: "captions", tools: pick(/caption|Caption|^editText$|^updateTextStyle$/), brief: "Readable captions in a style that fits; keep them clear of faces and of the platform UI." },
    { id: "framing", label: "framing and zooms", tools: pick(/zoom|Zoom|reframe|Reframe|AspectRatio|crop|Crop|rotate|Rotate|pan|Pan|keyframe|Keyframe/), brief: "Frame for the platform; 1-3 punch-in zooms on key words, centred on the subject." },
    { id: "overlays", label: "B-roll, stickers and titles", tools: pick(/[Bb]roll|[Ss]ticker|^addText$|[Oo]verlay|[Tt]itle|[Ii]mage|[Ee]moji|[Mm]otion/), brief: "B-roll that shows what is said, only over shots that can be covered; a hook title; stickers sparingly." },
    { id: "audio", label: "music and sound", tools: pick(/[Mm]usic|[Ss]fx|[Ss]ound|[Vv]olume|[Aa]udio|[Dd]uck|[Vv]oice/), brief: "A music bed that fits the mood, ducked under speech; sound effects on transitions and punchlines, sparingly." },
  ];
  stages.push({ id: "finish", label: "transitions, colour and the rest", tools: all.filter((n) => !taken.has(n)), brief: "Transitions only where they help; a colour grade if the footage needs it. Then call finish_edit." });
  // A style playbook's numbers replace the generic briefs (Phase 6).
  return stages.filter((s) => s.tools.length > 0).map((s) => (briefs[s.id] ? { ...s, brief: briefs[s.id] } : s));
}

function readToolDefinitions() {
  const range = { startSec: { type: "number" }, endSec: { type: "number" } };
  return [
    { type: "function", function: { name: "get_words", description: "The spoken words with times between startSec and endSec on the CURRENT working timeline.", parameters: { type: "object", properties: range, required: ["startSec", "endSec"] } } },
    { type: "function", function: { name: "get_shots", description: "What the picture shows between startSec and endSec on the current timeline (from the vision pass): subjects with positions, framing, b-roll suitability.", parameters: { type: "object", properties: range, required: ["startSec", "endSec"] } } },
    { type: "function", function: { name: "get_timeline_summary", description: "The current working timeline: clips, captions, zooms, overlays, music, with ids and times (after your edits so far).", parameters: { type: "object", properties: {} } } },
    { type: "function", function: { name: "search_broll", description: "Search stock B-roll. Returns the top results (title, licence, url, and a thumbnail when available). Pass a result's url as insertBroll.sourceUrl to use exactly that clip.", parameters: { type: "object", properties: { query: { type: "string" }, aspect: { type: "string", enum: ["9:16", "16:9", "1:1", "4:5"] } }, required: ["query"] } } },
    { type: "function", function: { name: "search_music", description: "Search the royalty-free music catalogue by mood. Returns track titles and lengths.", parameters: { type: "object", properties: { mood: { type: "string" }, durationSec: { type: "number" } }, required: ["mood"] } } },
    { type: "function", function: { name: STAGE_DONE, description: "This stage is finished (or nothing in it is needed); move on to the next stage.", parameters: { type: "object", properties: { note: { type: "string" } } } } },
  ];
}

export const AGENT_PROTOCOL = [
  `## How this edit works (several short turns)`,
  `You edit in stages on a working timeline. Each turn you may call read-only tools (get_words, get_shots, get_timeline_summary, search_broll, search_music) and the edit tools of the current stage.`,
  `Every edit call is applied immediately; you get a result per call: "applied" with what changed, or "rejected" with the reason (fix it and try again, or skip it).`,
  `Times in an edit call refer to the timeline as it is at the START of that turn (the results of earlier turns are already applied; call get_timeline_summary or get_words when unsure).`,
  `Call ${STAGE_DONE} when a stage is done or not needed. Call finish_edit (and ${CHAT_TOOL_NAME} with phase "done") when the whole edit is finished; you may finish early.`,
  `Do only what the stage and the creator's request need: a skipped stage is fine, a cluttered edit is not.`,
].join("\n");

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function stageIntro(stage: AgentStage, index: number, total: number): string {
  return `## Stage ${index + 1}/${total}: ${stage.label}\n${stage.brief}\nEdit tools now: ${stage.tools.join(", ")}.`;
}

/** Runs the loop. Throws only when the very first model call fails (the caller falls back to the one-shot planner). */
export async function runDirectorAgent<IR>(p: DirectorAgentParams<IR>): Promise<DirectorAgentOutcome<IR>> {
  if (typeof p.client.generateAgentTurn !== "function") throw new Error(`provider "${p.client.provider}" has no multi-turn agent support`);
  const now = p.now ?? Date.now;
  const started = now();
  const maxTurns = p.maxTurns ?? 8;
  const budgetMs = p.budgetMs ?? 90000;
  const chatTool = buildChatToolDefinition();
  const editDefs = new Map(buildDirectorToolDefinitions().map((t) => [t.function.name, t]));
  const readDefs = readToolDefinitions();

  let ir = p.initialIR;
  let stageIdx = 0;
  let stages = p.stages;
  const out: DirectorAgentOutcome<IR> = {
    kind: "edited", ir, operations: [], compiled: [], applied: [], rejected: [], translateOps: [],
    turns: 0, stagesDone: [], stopped: "stages_done", coverageRetry: false, feedback: 0,
  };
  const messages: AgentMessage[] = [{ role: "user", content: `${p.firstMessage}\n\n${stageIntro(stages[0], 0, stages.length)}` }];
  const toolsFor = (stage: AgentStage) => [
    ...stage.tools.map((n) => editDefs.get(n)).filter(Boolean),
    editDefs.get("finish_edit"),
    chatTool,
    ...readDefs,
  ].filter(Boolean) as any[];

  const advance = (): boolean => {
    out.stagesDone.push(stages[stageIdx].id);
    stageIdx++;
    if (stageIdx >= stages.length) {
      // Coverage: one extra stage for anything the creator asked for that the stages left out.
      const missing = p.missingRequested?.([...out.operations, ...out.translateOps].map((o) => o.type)) ?? [];
      if (missing.length && !out.coverageRetry) {
        out.coverageRetry = true;
        const tools = [...new Set(p.stages.flatMap((s) => s.tools))];
        stages = [...stages, { id: "coverage", label: "what the creator asked for that is still missing", tools, brief: `The creator explicitly asked for: ${missing.join("; ")}. Add it now (or say in ${CHAT_TOOL_NAME} why it cannot be done).` }];
        messages.push({ role: "user", content: stageIntro(stages[stageIdx], stageIdx, stages.length) });
        return true;
      }
      return false;
    }
    messages.push({ role: "user", content: stageIntro(stages[stageIdx], stageIdx, stages.length) });
    return true;
  };

  while (true) {
    if (out.turns >= maxTurns) { out.stopped = "turns"; break; }
    const left = budgetMs - (now() - started);
    if (left <= 1000) { out.stopped = "budget"; break; }
    const stage = stages[stageIdx];
    let res;
    try {
      res = await p.client.generateAgentTurn(p.system, messages, toolsFor(stage), {
        max_tokens: 16000,
        ...(p.effort ? { effort: p.effort } : {}),
        ...(p.model ? { model: p.model } : {}),
        timeoutMs: Math.min(left, p.perCallTimeoutMs ?? 60000),
      });
    } catch (err: any) {
      if (out.turns === 0) throw err;
      out.stopped = "error";
      out.error = clip(String(err?.message || err), 300);
      break;
    }
    out.turns++;
    messages.push(res.assistantMessage);
    const calls: ToolCall[] = res.toolCalls ?? [];
    const results: Array<{ callId: string; name: string; content: string | AgentContentPart[]; isError?: boolean }> = [];
    const reply = (c: ToolCall, content: string | AgentContentPart[], isError = false) => results.push({ callId: c.id || `${c.name}_${results.length}`, name: c.name, content, ...(isError ? { isError: true } : {}) });

    // A proposal (recommend / gather / confirm) means the creator decides first: nothing in this turn is applied.
    const chat = calls.filter((c) => c.name === CHAT_TOOL_NAME).map((c) => parseConversation(c.args)).filter(Boolean).pop() as DirectorConversation | undefined;
    if (chat) out.conversation = chat;
    const proposing = !!chat && PROPOSAL_PHASES.has(chat.phase);

    let stageDone = false;
    let finished = false;
    const edits: Array<{ call: ToolCall; op: CreativeOperation }> = [];
    for (const c of calls) {
      if (c.name === CHAT_TOOL_NAME) { reply(c, "noted"); continue; }
      if (c.name === STAGE_DONE) { stageDone = true; reply(c, "ok"); continue; }
      if ((READ_TOOLS as readonly string[]).includes(c.name)) {
        try {
          const a = c.args || {};
          const num = (v: any, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
          if (c.name === "get_words") reply(c, p.read.getWords(ir, num(a.startSec, 0), num(a.endSec, 1e9)));
          else if (c.name === "get_shots") reply(c, p.read.getShots(ir, num(a.startSec, 0), num(a.endSec, 1e9)));
          else if (c.name === "get_timeline_summary") reply(c, p.read.getTimelineSummary(ir));
          else if (c.name === "search_broll") {
            if (!p.read.searchBroll) reply(c, "B-roll search is not available; use insertBroll with a stockQuery.", true);
            else {
              const r = await p.read.searchBroll(String(a.query || "").slice(0, 120), String(a.aspect || ""));
              reply(c, r.images?.length ? [{ type: "text", text: r.text }, ...r.images] : r.text);
            }
          } else if (c.name === "search_music") {
            if (!p.read.searchMusic) reply(c, "Music search is not available; use addBackgroundMusic with a mood query.", true);
            else reply(c, await p.read.searchMusic(String(a.mood || "").slice(0, 80), num(a.durationSec, 30)));
          }
        } catch (err: any) {
          reply(c, `failed: ${clip(String(err?.message || err), 200)}`, true);
        }
        continue;
      }
      if (c.name === "finish_edit") {
        const v = validateDirectorToolCalls([{ name: c.name, args: c.args }]);
        if (v.finish) { out.finish = v.finish as any; finished = true; reply(c, "ok"); }
        else { out.feedback++; reply(c, `rejected: ${v.errors.join("; ")}`, true); }
        continue;
      }
      if (proposing) { reply(c, "not applied: you proposed a plan, so the creator decides first", true); continue; }
      if (!stage.tools.includes(c.name)) {
        out.feedback++;
        reply(c, `rejected: ${c.name} is not available in the "${stage.label}" stage (now: ${stage.tools.join(", ")}). Call ${STAGE_DONE} to move on.`, true);
        continue;
      }
      const v = validateDirectorToolCalls([{ name: c.name, args: c.args }]);
      if (v.errors.length || !v.operations.length) {
        out.feedback++;
        reply(c, `rejected (invalid arguments, fix and call again): ${v.errors.join("; ").replace(/^call #0 /, "")}`, true);
        continue;
      }
      const op = v.operations[0];
      if (op.type === "translateCaptions") {
        out.translateOps.push(op);
        reply(c, "accepted: the captions are converted once the edit is finished");
        continue;
      }
      edits.push({ call: c, op });
    }

    let appliedNow = 0;
    let rejectedNow = 0;
    if (edits.length) {
      const r = p.apply(edits.map((e) => e.op), ir);
      ir = r.ir;
      out.applied.push(...r.applied);
      out.rejected.push(...r.rejected);
      out.compiled.push(...r.compiled);
      edits.forEach((e, i) => {
        const res = r.results[i] ?? { status: "rejected", reason: "no result" };
        if (res.status === "applied") {
          appliedNow++;
          out.operations.push(e.op);
          reply(e.call, `applied${res.changes.length ? `: ${res.changes.slice(0, 6).join("; ")}` : ""}${res.note ? ` (${res.note})` : ""}`);
        } else {
          rejectedNow++;
          out.feedback++;
          reply(e.call, `rejected: ${res.reason}`, true);
        }
      });
    }
    p.onTurn?.({ turn: out.turns, stage: stage.id, calls: calls.map((c) => c.name), applied: appliedNow, rejected: rejectedNow });

    if (proposing && out.operations.length === 0) { out.kind = "conversation"; out.stopped = "conversation"; break; }
    if (results.length) messages.push({ role: "tool", results });
    if (finished) {
      // finish_edit on a turn that only talked, with nothing applied: a conversational turn.
      if (out.operations.length === 0 && out.translateOps.length === 0 && chat && chat.phase !== "done") out.kind = "conversation";
      out.stagesDone.push(stage.id);
      const missing = p.missingRequested?.([...out.operations, ...out.translateOps].map((o) => o.type)) ?? [];
      if (missing.length && !out.coverageRetry && out.kind === "edited") {
        out.coverageRetry = true;
        const tools = [...new Set(p.stages.flatMap((s) => s.tools))];
        stages = [...stages.slice(0, stageIdx + 1), { id: "coverage", label: "what the creator asked for that is still missing", tools, brief: `Before finishing: the creator explicitly asked for ${missing.join("; ")}. Add it now (or say in ${CHAT_TOOL_NAME} why it cannot be done), then call finish_edit.` }];
        stageIdx = stages.length - 1;
        messages.push({ role: "user", content: stageIntro(stages[stageIdx], stageIdx, stages.length) });
        finished = false;
        continue;
      }
      out.stopped = "finished";
      break;
    }
    // A turn with no calls at all, or stage_done: next stage.
    if (stageDone || calls.length === 0) {
      if (!advance()) { out.stopped = "stages_done"; break; }
      continue;
    }
    // Only reads or edits this turn: the results are the next message; stay in the stage.
  }
  out.ir = ir;
  return out;
}
