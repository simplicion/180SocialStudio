/**
 * AI Director quality-fix plan, Phase 0: one structured turn log per Director turn, and the fallback report.
 * Run: npx tsx --test packages/domains/ai/tests/director-turn-log.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { MobileAIDirectRequestSchema } from "@workspace/video-contracts";
import { VideoAIDirectorService } from "../src/builders/video-ai-director.service";
import {
  DirectorDropRecorder,
  classifyPlannerFallback,
  droppedByType,
  formatTurnLogLine,
  summarizeDirectorTurns,
} from "../src/builders/director-turn-log";
import type { AIClient } from "../src/kernel/ai-provider.service";
import { createLocalEmitter } from "../src/agent-runs/agent-events";

const director = VideoAIDirectorService.getInstance();
const tc = (name: string, args: Record<string, any>) => ({ id: `t_${name}_${Math.random().toString(36).slice(2, 7)}`, name, args });
const client = (calls: any[] | (() => never), provider = "claude"): AIClient => ({
  provider,
  generate: async () => { throw new Error("unused"); },
  generateStream: async () => { throw new Error("unused"); },
  generateWithTools: async () => {
    if (typeof calls === "function") calls();
    return { text: "", toolCalls: calls as any[] };
  },
});
const words = "so today I want to show you how we grew our audience in thirty days".split(" ").map((text, i) => ({ text, startMs: 300 + i * 400, endMs: 600 + i * 400 }));
const media = { durationMs: 8000, width: 1080, height: 1920, transcript: { words } };

/** Captures console.info lines while `fn` runs. */
async function captureInfo<T>(fn: () => Promise<T>): Promise<{ out: T; lines: string[] }> {
  const lines: string[] = [];
  const orig = console.info;
  console.info = (...a: any[]) => { lines.push(a.map(String).join(" ")); };
  try {
    return { out: await fn(), lines };
  } finally {
    console.info = orig;
  }
}

test("droppedByType counts only removed operation types", () => {
  assert.deepEqual(droppedByType([{ type: "a" }, { type: "a" }, { type: "b" }], [{ type: "a" }, { type: "b" }]), [{ op: "a", count: 1 }]);
  assert.deepEqual(droppedByType([{ type: "a" }], [{ type: "a" }]), []);
});

test("DirectorDropRecorder attributes drops and compiler refusals", () => {
  const r = new DirectorDropRecorder();
  r.record("scope", [{ type: "addZoom" }, { type: "insertBroll" }], [{ type: "addZoom" }], "not asked");
  r.recordRejected(["insertBroll: no stock query given"]);
  assert.equal(r.total, 2);
  assert.deepEqual(r.drops.map((d) => [d.filter, d.op]), [["scope", "insertBroll"], ["compiler", "insertBroll"]]);
  assert.equal(r.drops[0].reason, "not asked");
});

test("classifyPlannerFallback separates real fallbacks from deterministic-by-design turns", () => {
  assert.equal(classifyPlannerFallback("llm", "claude/x tool-calling plan", "edit"), null);
  assert.equal(classifyPlannerFallback("deterministic", "opening proposal built from the brand profile", "greet"), null);
  assert.equal(classifyPlannerFallback("deterministic", "clarifying question before editing (vague)", "edit"), null);
  assert.equal(classifyPlannerFallback("deterministic", 'no AI API key configured in server environment (provider "none")', "edit")?.code, "no_key");
  assert.equal(classifyPlannerFallback("deterministic", "LLM (gemini) returned an empty response", "edit")?.code, "empty_response");
  assert.equal(classifyPlannerFallback("deterministic", "LLM_TIMEOUT: LLM call (claude/m) after 60000 ms", "edit")?.code, "timeout");
  assert.equal(classifyPlannerFallback("deterministic", "LLM call failed (claude/m): 404 model not found", "edit")?.code, "llm_error");
  assert.equal(classifyPlannerFallback("deterministic", "LLM output (claude/m) failed validation after 1 repair attempt: x", "edit")?.code, "invalid_output");
});

test("an LLM turn logs provider, model, op counts and one [AI Director][turn] line", async () => {
  const { out, lines } = await captureInfo(() =>
    director.directMobile(
      MobileAIDirectRequestSchema.parse({ prompt: "edit this for reels", media }),
      { llmClient: client([tc("addZoom", { startSec: 2, durationSec: 1, scale: 1.3, targetCoords: { x: 0.5, y: 0.4 } }), tc("finish_edit", { summary: "ok" })]), llmModel: "claude-test-model" }
    )
  );
  const log = out.turnLog;
  assert.equal(log.plannerSource, "llm");
  assert.equal(log.provider, "claude");
  assert.equal(log.model, "claude-test-model");
  assert.equal(log.fallback, null);
  assert.equal(out.plannerFallback, undefined);
  assert.ok(log.llmCalls >= 1);
  assert.equal(log.ops.planned, 1);
  assert.ok(log.ops.applied >= 1);
  assert.ok(log.latencyMs >= 0);
  const line = lines.find((l) => l.startsWith("[AI Director][turn] "));
  assert.ok(line, "one structured log line per turn");
  assert.equal(JSON.parse(line!.slice("[AI Director][turn] ".length)).runId, out.runId);
});

test("a provider error falls back loudly: plannerFallback + turnLog name the provider and the reason", async () => {
  const { out } = await captureInfo(() =>
    director.directMobile(
      MobileAIDirectRequestSchema.parse({ prompt: "cut the pauses and add captions", media }),
      { llmClient: client(() => { throw new Error("404 model not found"); }, "gemini"), llmModel: "gemini-x" }
    )
  );
  assert.equal(out.plannerSource, "deterministic");
  assert.equal(out.plannerFallback?.code, "llm_error");
  assert.match(out.plannerFallback!.reason, /404 model not found/);
  assert.equal(out.turnLog.provider, "gemini");
  assert.equal(out.turnLog.model, "gemini-x");
});

test("ops removed by the scope filter are attributed to it", async () => {
  // A scoped captions request: an over-eager model also adds B-roll, which the scope filter removes.
  const { out } = await captureInfo(() =>
    director.directMobile(
      MobileAIDirectRequestSchema.parse({ prompt: "add captions", media }),
      { llmClient: client([tc("autoCaptions", {}), tc("insertBroll", { stockQuery: "city", timelineStartSec: 1, durationSec: 2 }), tc("finish_edit", { summary: "ok" })]) }
    )
  );
  const scopeDrops = out.turnLog.drops.filter((d) => d.filter === "scope");
  assert.ok(scopeDrops.some((d) => d.op === "insertBroll"), JSON.stringify(out.turnLog.drops));
  assert.ok(out.turnLog.ops.dropped >= 1);
});

test("the final TimelineChanged event carries the turn log (for the stored report)", async () => {
  const events = createLocalEmitter();
  const { out } = await captureInfo(() =>
    director.directMobile(MobileAIDirectRequestSchema.parse({ prompt: "edit this", media }), { llmClient: null, events })
  );
  assert.equal(out.turnLog.fallback?.code, "llm_disabled");
  const final = events.events.find((e) => e.type === "TimelineChanged" && (e.payload as any).final);
  assert.equal((final?.payload as any)?.turnLog?.fallback?.code, "llm_disabled");
  assert.ok(formatTurnLogLine(out.turnLog).includes('"plannerSource":"deterministic"'));
});

test("summarizeDirectorTurns: % of edit turns that fell back, by code, provider/model and filter", () => {
  const r = summarizeDirectorTurns(
    [
      { intent: "edit", plannerSource: "llm", provider: "claude", model: "m1", drops: [{ filter: "scope", op: "x", count: 2 }], latencyMs: 100, ops: { planned: 4, afterFilters: 2, applied: 3, rejected: 0, dropped: 2 } },
      { intent: "edit", plannerSource: "deterministic", fallback: { code: "llm_error", reason: "LLM call failed (gemini): 404" }, latencyMs: 300, ops: { planned: 2, afterFilters: 2, applied: 2, rejected: 0, dropped: 0 } },
      { intent: "greet", plannerSource: "deterministic", fallback: null },
      { plannerSource: "deterministic", plannerReason: "older record, no turn log" },
    ],
    7
  );
  assert.equal(r.turns, 4);
  assert.equal(r.editTurns, 3);
  assert.equal(r.fallbackTurns, 2);
  assert.equal(r.fallbackPct, 66.7);
  assert.deepEqual(r.fallbackByCode, { llm_error: 1, unknown: 1 });
  assert.deepEqual(r.byProviderModel, [{ provider: "claude", model: "m1", turns: 1 }]);
  assert.deepEqual(r.dropsByFilter, { scope: 2 });
  assert.equal(r.avgLatencyMs, 200);
  assert.deepEqual(r.avgOps, { planned: 3, applied: 2.5, dropped: 1 });
});
