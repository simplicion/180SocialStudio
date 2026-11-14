/**
 * AI Director quality-fix plan, Phase 4: the agent loop (stages, per-call tool results, retries, bounds).
 * Run: npx tsx --test packages/domains/ai/tests/director-agent.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { MobileAIDirectRequestSchema, ShotLogSchema } from "@workspace/video-contracts";
import { runDirectorAgent, wholeEditStages, type AgentApplyOutcome } from "../src/builders/director-agent";
import { VideoAIDirectorService } from "../src/builders/video-ai-director.service";
import type { AgentMessage, AgentTurnResponse, AIClient, ToolCall } from "../src/kernel/ai-provider.service";

let n = 0;
const call = (name: string, args: Record<string, any> = {}): ToolCall => ({ id: `c${++n}`, name, args });

/** A fake multi-turn model: each turn is a list of calls, or a function of the conversation so far. */
function scripted(turns: Array<ToolCall[] | ((messages: AgentMessage[]) => ToolCall[]) | Error>) {
  const seen: Array<{ messages: AgentMessage[]; tools: string[]; system: string }> = [];
  const client: AIClient = {
    provider: "claude",
    generate: async () => "",
    generateStream: async () => "",
    // The story pass (one-shot) gets no story in these tests unless they script it.
    generateWithTools: async () => ({ text: "", toolCalls: [] }),
    generateAgentTurn: async (system, messages, tools) => {
      seen.push({ messages: JSON.parse(JSON.stringify(messages)), tools: tools.map((t: any) => t.function?.name ?? t.name), system });
      const next = turns.shift();
      if (!next) throw new Error("script ran out");
      if (next instanceof Error) throw next;
      const calls = typeof next === "function" ? next(messages) : next;
      return { text: "", toolCalls: calls, stopReason: "tool_use", assistantMessage: { role: "assistant", toolCalls: calls } } as AgentTurnResponse;
    },
  };
  return { client, seen };
}

/** Tool results the model received for a call id. */
function resultFor(messages: AgentMessage[], id: string): string {
  for (const m of messages) if (m.role === "tool") for (const r of m.results) if (r.callId === id) return typeof r.content === "string" ? r.content : JSON.stringify(r.content);
  return "";
}

// ── The loop with a fake apply ───────────────────────────────────────────────────────────────────

type FakeIR = { ops: string[] };
const fakeApply = (rejectTypes: string[] = []) => (ops: any[], ir: FakeIR): AgentApplyOutcome<FakeIR> => ({
  ir: { ops: [...ir.ops, ...ops.filter((o) => !rejectTypes.includes(o.type)).map((o) => o.type)] },
  results: ops.map((o) => (rejectTypes.includes(o.type) ? { status: "rejected" as const, reason: `${o.type} refused by a filter` } : { status: "applied" as const, changes: [`did ${o.type}`] })),
  applied: ops.filter((o) => !rejectTypes.includes(o.type)).map((o) => `did ${o.type}`),
  rejected: ops.filter((o) => rejectTypes.includes(o.type)).map((o) => `${o.type}: refused`),
  compiled: ops,
});
const read = { getWords: () => "words", getShots: () => "shots", getTimelineSummary: () => "summary" };
const base = (client: AIClient, extra: Record<string, any> = {}) => ({
  client, system: "sys", firstMessage: "edit this", stages: wholeEditStages(), initialIR: { ops: [] } as FakeIR, apply: fakeApply(), read, ...extra,
});

test("stages: each turn offers only the stage's edit tools; stage_done moves on; finish_edit ends", async () => {
  const { client, seen } = scripted([
    [call("removeSilences", { minDurationSec: 0.4 }), call("stage_done")],
    [call("autoCaptions", {}), call("stage_done")],
    [call("finish_edit", { summary: "done" }), call("reply_to_creator", { reply: "Done!", phase: "done" })],
  ]);
  const out = await runDirectorAgent(base(client));
  assert.equal(out.kind, "edited");
  assert.equal(out.stopped, "finished");
  assert.deepEqual(out.ir.ops, ["removeSilences", "autoCaptions"]);
  assert.ok(seen[0].tools.includes("removeSilences") && !seen[0].tools.includes("autoCaptions"), "cleanup stage tools only");
  assert.ok(seen[1].tools.includes("autoCaptions") && !seen[1].tools.includes("removeSilences"));
  assert.ok(seen.every((s) => s.tools.includes("get_words") && s.tools.includes("finish_edit")));
  assert.deepEqual(out.stagesDone.slice(0, 2), ["cleanup", "captions"]);
});

test("feedback: a refused or invalid call gets its reason back, and the model's retry is applied", async () => {
  const bad = call("autoCaptions", { highlightColor: "red" });
  const refused = call("removeSilences", { minDurationSec: 0.4 });
  let retrySawReason = "";
  const { client } = scripted([
    [refused, call("stage_done")],
    [bad],
    (messages) => {
      retrySawReason = resultFor(messages, bad.id!);
      return [call("autoCaptions", { highlightColor: "#EF4444" }), call("finish_edit", { summary: "ok" })];
    },
  ]);
  const out = await runDirectorAgent(base(client, { apply: fakeApply(["removeSilences"]) }));
  assert.match(retrySawReason, /rejected \(invalid arguments.*highlightColor/);
  assert.deepEqual(out.ir.ops, ["autoCaptions"]);
  assert.equal(out.feedback, 2);
  assert.deepEqual(out.rejected, ["removeSilences: refused"]);
});

test("a tool from another stage is rejected with the tools that are available", async () => {
  const early = call("addZoom", { startSec: 1, durationSec: 1, targetCoords: { x: 0.5, y: 0.5 } });
  let seenReason = "";
  const { client } = scripted([[early], (m) => ((seenReason = resultFor(m, early.id!)), [call("finish_edit", { summary: "ok" })])]);
  await runDirectorAgent(base(client));
  assert.match(seenReason, /not available in the "pauses, fillers and pacing" stage.*stage_done/);
});

test("read tools answer without editing, and the model stays in the stage", async () => {
  const q = call("get_words", { startSec: 0, endSec: 5 });
  const b = call("search_broll", { query: "city" });
  let words = "", broll = "";
  const { client } = scripted([
    [q, b],
    (m) => ((words = resultFor(m, q.id!)), (broll = resultFor(m, b.id!)), [call("finish_edit", { summary: "ok" })]),
  ]);
  const out = await runDirectorAgent(base(client, { read: { ...read, searchBroll: async () => ({ text: "1. skyline", images: [{ type: "image", mediaType: "image/jpeg", data: "AAA" }] }) } }));
  assert.equal(words, "words");
  assert.match(broll, /skyline/);
  assert.match(broll, /"image"/, "thumbnails reach the model as images");
  assert.deepEqual(out.ir.ops, []);
});

test("a proposal applies nothing (the creator decides first) and ends the loop as a conversation", async () => {
  const { client } = scripted([[call("removeSilences", {}), call("reply_to_creator", { reply: "Fast or calm?", phase: "recommend" })]]);
  const out = await runDirectorAgent(base(client));
  assert.equal(out.kind, "conversation");
  assert.deepEqual(out.ir.ops, []);
});

test("bounds: max turns and the time budget stop the loop and keep what was applied", async () => {
  const loop = () => [call("removeSilences", { minDurationSec: 0.4 })];
  const t = await runDirectorAgent(base(scripted([loop, loop, loop, loop]).client, { maxTurns: 2 }));
  assert.equal(t.stopped, "turns");
  assert.equal(t.ir.ops.length, 2);
  let clock = 0;
  const b = await runDirectorAgent(base(scripted([() => ((clock += 59500), loop()), loop]).client, { budgetMs: 60000, now: () => clock }));
  assert.equal(b.stopped, "budget");
  assert.equal(b.ir.ops.length, 1);
});

test("errors: the first call failing throws (the caller plans in one pass); a later failure keeps the work", async () => {
  await assert.rejects(runDirectorAgent(base(scripted([new Error("401")]).client)), /401/);
  const later = await runDirectorAgent(base(scripted([[call("removeSilences", { minDurationSec: 0.4 })], new Error("overloaded")]).client));
  assert.equal(later.stopped, "error");
  assert.deepEqual(later.ir.ops, ["removeSilences"]);
});

test("coverage: a requested feature still missing at finish gets one more stage", async () => {
  const { client, seen } = scripted([
    [call("finish_edit", { summary: "ok" })],
    [call("addBackgroundMusic", { query: "upbeat" }), call("finish_edit", { summary: "ok" })],
  ]);
  const out = await runDirectorAgent(base(client, { missingRequested: (types: string[]) => (types.includes("addBackgroundMusic") ? [] : ["background music"]) }));
  assert.equal(out.coverageRetry, true);
  assert.deepEqual(out.ir.ops, ["addBackgroundMusic"]);
  const last = seen[1].messages[seen[1].messages.length - 1] as any;
  assert.match(String(last.content), /explicitly asked for background music/);
});

// ── Through a Director turn (real guards and compiler) ───────────────────────────────────────────

const words = "today I want to show you the three apps I open every single morning and why they matter so much to me".split(" ").map((text, i) => ({ text, startMs: 300 + i * 400, endMs: 600 + i * 400 }));
const durationMs = 300 + words.length * 400 + 1500;
const req = (prompt: string, extra: Record<string, any> = {}) => MobileAIDirectRequestSchema.parse({ prompt, media: { durationMs, width: 1080, height: 1920, transcript: { words }, ...extra } });

async function quiet<T>(f: () => Promise<T>): Promise<T> {
  const [info, warn] = [console.info, console.warn];
  console.info = () => {};
  console.warn = () => {};
  try {
    return await f();
  } finally {
    console.info = info;
    console.warn = warn;
  }
}

test("a whole edit through the loop: guards reject with reasons, the model retries, the result is compiled once", async () => {
  const jl = call("jlCut", { clipId: "c1", leadMs: 300 });
  const badCaps = call("autoCaptions", { highlightColor: "yellow" });
  const shots = call("get_shots", { startSec: 0, endSec: 5 });
  const results: Record<string, string> = {};
  const shotLog = ShotLogSchema.parse({
    version: "shotlog/1", assetId: "primary", sourceHash: "hash-abcdef", durationMs, model: "m", frameCount: 3,
    shots: [{ startMs: 0, endMs: durationMs, description: "a person at a desk", framing: "medium", cameraMotion: "static", quality: [], brollSuitability: 0.2, energy: "medium", subjects: [{ label: "person", box: { x: 0.35, y: 0.1, w: 0.3, h: 0.5 }, primary: true }] }],
  });
  const { client, seen } = scripted([
    [jl, call("removeSilences", { minDurationSec: 0.4 })],
    (m) => ((results.jl = resultFor(m, jl.id!)), [call("stage_done")]),
    [badCaps],
    (m) => ((results.caps = resultFor(m, badCaps.id!)), [call("autoCaptions", { highlightColor: "#FFE600" }), call("stage_done")]),
    [shots],
    (m) => ((results.shots = resultFor(m, shots.id!)), [call("addZoom", { startSec: 2, durationSec: 1.2, targetType: "FACE", targetCoords: { x: 0.5, y: 0.35 }, scale: 1.4 }), call("stage_done")]),
    [call("finish_edit", { summary: "Captions and a zoom." }), call("reply_to_creator", { reply: "Tightened it, added captions and a zoom.", phase: "done" })],
  ]);
  const res = await quiet(() => VideoAIDirectorService.getInstance().directMobile(req("edit this for reels", { shotLog }), { llmClient: client }));
  assert.match(results.jl, /rejected: .*J\/L|rejected: .*jlCut|rejected: .*(cut|renderer|phone)/i, `renderer gate reason fed back: ${results.jl}`);
  assert.match(results.caps, /rejected \(invalid arguments/);
  assert.match(results.shots, /a person at a desk/);
  assert.match(seen[0].system, /How this edit works/);
  assert.ok(res.editIR.captions.length > 0, "captions applied after the retry");
  assert.equal(res.editIR.zooms.length, 1);
  assert.match(res.plannerReason, /agent loop \(7 turns/);
  assert.equal(res.plannerSource, "llm");
  assert.ok((res.turnLog.agent as any)?.feedback >= 2);
  assert.ok(res.turnLog.drops.some((d) => d.filter === "renderer_gate" && d.op === "jlCut"));
  assert.equal(res.reply, "Tightened it, added captions and a zoom.");
});

test("a scoped request runs a short loop with only its tools", async () => {
  const zoom = call("addZoom", { startSec: 1, durationSec: 1, targetCoords: { x: 0.5, y: 0.5 } });
  let zoomResult = "";
  const { client, seen } = scripted([
    [call("autoCaptions", {}), zoom],
    (m) => ((zoomResult = resultFor(m, zoom.id!)), [call("finish_edit", { summary: "Captions on." })]),
  ]);
  const res = await quiet(() => VideoAIDirectorService.getInstance().directMobile(req("add captions"), { llmClient: client }));
  assert.ok(!seen[0].tools.includes("addZoom"));
  assert.match(zoomResult, /not available/);
  assert.ok(res.editIR.captions.length > 0);
  assert.equal(res.editIR.zooms.length, 0);
});

test("the loop failing on its first turn falls back to the one-shot planner", async () => {
  const client: AIClient = {
    provider: "claude",
    generate: async () => "",
    generateStream: async () => "",
    generateAgentTurn: async () => { throw new Error("agent endpoint down"); },
    generateWithTools: async (_p, tools) =>
      tools.some((t: any) => (t.function?.name ?? t.name) === "plan_story")
        ? { text: "", toolCalls: [] }
        : { text: "", toolCalls: [{ id: "1", name: "autoCaptions", args: {} }, { id: "2", name: "finish_edit", args: { summary: "ok" } }] },
  };
  const res = await quiet(() => VideoAIDirectorService.getInstance().directMobile(req("add captions"), { llmClient: client }));
  assert.ok(res.warnings.some((w) => /step-by-step editing unavailable \(agent endpoint down\)/.test(w)));
  assert.match(res.plannerReason, /tool-calling plan/);
  assert.ok(res.editIR.captions.length > 0);
});

test("a clip picked from search_broll by URL keeps its licence and credit line", async () => {
  const search = call("search_broll", { query: "city skyline" });
  const url = "https://media.example.org/skyline.mp4";
  const turns: any[] = [
    [call("stage_done")], [call("stage_done")], [call("stage_done")],
    [search],
    () => [call("insertBroll", { sourceUrl: url, timelineStartSec: 2, durationSec: 2 }), call("finish_edit", { summary: "B-roll in." })],
  ];
  const { client } = scripted(turns);
  const res = await quiet(() =>
    VideoAIDirectorService.getInstance().directMobile(req("edit this for reels"), {
      llmClient: client,
      searchBroll: async () => [{ url, title: "Skyline at dusk", license: "CC BY 4.0", provider: "wikimedia", attribution: "Skyline by Jane Doe, CC BY 4.0", creditRequired: true, thumbnailUrl: "https://media.example.org/skyline.jpg" }],
      fetchImage: async () => ({ mediaType: "image/jpeg", data: "AAA" }),
    })
  );
  assert.equal(res.editIR.overlays.length, 1);
  assert.ok(res.credits?.some((c) => c.url === url && /Jane Doe/.test(c.attribution)), JSON.stringify(res.credits));
  assert.ok(res.warnings.some((w) => /Credit required when publishing: Skyline by Jane Doe/.test(w)));
});
