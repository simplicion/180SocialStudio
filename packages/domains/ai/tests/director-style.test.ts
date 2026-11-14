/**
 * AI Director quality-fix plan, Phase 6: one style playbook per whole edit, in the prompt and the stage briefs,
 * measured in the critic and reported.
 * Run: npx tsx --test packages/domains/ai/tests/director-style.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { MobileAIDirectRequestSchema, STYLE_PLAYBOOKS } from "@workspace/video-contracts";
import { VideoAIDirectorService } from "../src/builders/video-ai-director.service";
import type { AIClient, ToolCall } from "../src/kernel/ai-provider.service";

const words = "today I want to show you the three apps I open every single morning and why they matter so much to me and my team".split(" ").map((text, i) => ({ text, startMs: 300 + i * 400, endMs: 600 + i * 400 }));
const durationMs = 300 + words.length * 400 + 1500;

function client(turns: ToolCall[][], seen: any[]): AIClient {
  return {
    provider: "claude",
    generate: async () => "",
    generateStream: async () => "",
    generateWithTools: async () => ({ text: "", toolCalls: [] }), // the story pass gets no story
    generateAgentTurn: async (system, _messages, tools) => {
      const intro = String((_messages[_messages.length - 1] as any).content ?? "");
      seen.push({ system, intro, tools: tools.map((t: any) => t.function?.name ?? t.name) });
      const calls = turns.shift() ?? [{ id: "f", name: "finish_edit", args: { summary: "ok" } }];
      return { text: "", toolCalls: calls, stopReason: "tool_use", assistantMessage: { role: "assistant", toolCalls: calls } } as any;
    },
  };
}

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

const req = (prompt: string) => MobileAIDirectRequestSchema.parse({ prompt, media: { durationMs, width: 1080, height: 1920, transcript: { words } } });

test("a whole edit: only the chosen playbook is in the system prompt, its numbers drive the stage briefs, the result is measured", async () => {
  const seen: any[] = [];
  const res = await quiet(() =>
    VideoAIDirectorService.getInstance().directMobile(req("make it punchy for reels"), {
      llmClient: client([
        [{ id: "1", name: "removeSilences", args: { minDurationSec: 0.35 } }, { id: "2", name: "stage_done", args: {} }],
        [{ id: "3", name: "autoCaptions", args: { template: "HORMOZI_BOUNCE" } }, { id: "4", name: "finish_edit", args: { summary: "Punchy." } }],
      ], seen),
    })
  );
  const system = seen[0].system as string;
  assert.match(system, /Style for this edit: fast and punchy/);
  for (const other of STYLE_PLAYBOOKS.filter((p) => p.id !== "fast_hype")) assert.ok(!system.includes(other.label), `no ${other.id} in the prompt`);
  assert.ok(!system.includes("Editing craft for a whole-video edit"), "the generic craft block is replaced");
  assert.match(seen[0].intro, /Cut pauses of 0\.35 s or more/, "cleanup brief from the playbook");
  assert.equal(res.style?.playbookId, "fast_hype");
  assert.match(res.style!.reason, /"punchy"/);
  assert.ok(res.style!.total > 0 && res.style!.checks.some((c) => c.metric === "caption template"));
  assert.equal((res.turnLog.style as any)?.playbookId, "fast_hype");
  // Missed targets are in the critic's report (style issues), never auto-repaired.
  assert.ok(res.critique.issues.some((i) => i.id.startsWith("style:")) || res.style!.met === res.style!.total);
});

test("a scoped request has no playbook (style targets judge whole edits only)", async () => {
  const seen: any[] = [];
  const res = await quiet(() =>
    VideoAIDirectorService.getInstance().directMobile(req("add captions"), {
      llmClient: client([[{ id: "1", name: "autoCaptions", args: {} }, { id: "2", name: "finish_edit", args: { summary: "ok" } }]], seen),
    })
  );
  assert.ok(!String(seen[0].system).includes("Style for this edit"));
  assert.equal(res.style, undefined);
  assert.ok(!res.critique.issues.some((i) => i.id.startsWith("style:")));
});

test("the one-shot planner gets the playbook too", async () => {
  const prompts: any[] = [];
  const oneShot: AIClient = {
    provider: "claude",
    generate: async () => "",
    generateStream: async () => "",
    generateWithTools: async (_p, tools, options) => {
      if (tools.some((t: any) => (t.function?.name ?? t.name) === "plan_story")) return { text: "", toolCalls: [] };
      if (tools.some((t: any) => (t.function?.name ?? t.name) === "classify_request")) return { text: "", toolCalls: [] };
      prompts.push(options);
      return { text: "", toolCalls: [{ id: "1", name: "autoCaptions", args: {} }, { id: "2", name: "finish_edit", args: { summary: "ok" } }] };
    },
  };
  const res = await quiet(() => VideoAIDirectorService.getInstance().directMobile(req("edit this video, keep it calm and clear"), { llmClient: oneShot }));
  const plan = prompts.find((o) => o?.system);
  assert.ok(plan, JSON.stringify(res.scope));
  assert.match(plan.system, /Style for this edit: calm and clear/);
  assert.equal(res.style?.playbookId, "calm_educational");
});
