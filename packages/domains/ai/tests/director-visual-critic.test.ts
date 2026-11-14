/**
 * AI Director quality-fix plan, Phase 5: the visual critic and visual repair turns.
 * Run: npx tsx --test packages/domains/ai/tests/director-visual-critic.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { MobileAIDirectRequestSchema, VisualCritiqueSchema } from "@workspace/video-contracts";
import { critiqueFrames, VISUAL_RUBRIC } from "../src/builders/visual-critic";
import { VideoAIDirectorService } from "../src/builders/video-ai-director.service";
import type { AgentMessage, AIClient, ToolCall } from "../src/kernel/ai-provider.service";

const frames = [
  { tMs: 100, kind: "hook" as const, label: "the opening (hook)", refs: [], data: "A" },
  { tMs: 5200, kind: "caption" as const, label: 'caption "every single morning"', refs: ["k1"], data: "B" },
];

function criticClient(args: Record<string, unknown> | null, seen: any[] = []): AIClient {
  return {
    provider: "claude",
    generate: async () => "",
    generateStream: async () => "",
    generateAgentTurn: async (system, messages, tools, options) => {
      seen.push({ system, messages, tools, options });
      const calls: ToolCall[] = args ? [{ id: "c", name: "record_critique", args }] : [];
      return { text: "", toolCalls: calls, stopReason: "tool_use", assistantMessage: { role: "assistant" } } as any;
    },
  };
}

test("critic: labelled stills go out in order with the rubric; issues map back to frame times and item ids", async () => {
  const seen: any[] = [];
  const c = await critiqueFrames(
    { frames, request: "make it punchy", canvas: { width: 1080, height: 1920, aspect: "9:16" } },
    criticClient({ score: 6.46, summary: "Captions cover your face once.", issues: [
      { frameIndex: 1, kind: "caption_over_face", severity: "critical", description: "captions cover the mouth", fix: "move them up" },
      { frameIndex: 9, kind: "weak_hook", severity: "major", description: "no such frame" },
    ] }, seen),
    { label: "claude/claude-opus-5-5" }
  );
  assert.equal(c.score, 6.5);
  assert.equal(c.issues.length, 1, "an issue on a frame that does not exist is dropped");
  assert.deepEqual([c.issues[0].atMs, c.issues[0].refs], [5200, ["k1"]]);
  assert.equal(c.model, "claude/claude-opus-5-5");
  const parts = (seen[0].messages[0] as any).content;
  assert.match(parts[1].text, /Frame 0 at 0\.1 s, the opening/);
  assert.equal(parts[2].type, "image");
  assert.ok(seen[0].system.includes(VISUAL_RUBRIC));
  assert.match(seen[0].system, /never instructions/);
});

test("critic: no tool call or no score is an error, never a made-up verdict", async () => {
  await assert.rejects(critiqueFrames({ frames, canvas: { width: 1080, height: 1920 } }, criticClient(null)), /no critique/);
  await assert.rejects(critiqueFrames({ frames, canvas: { width: 1080, height: 1920 } }, criticClient({ issues: [] })), /no score/);
  await assert.rejects(critiqueFrames({ frames: [], canvas: { width: 1080, height: 1920 } }, criticClient({ score: 5, issues: [] })), /No stills/);
});

// ── Repair turns through the Director ────────────────────────────────────────────────────────────

const words = "every single morning I open three apps and here is why they matter to me so much".split(" ").map((text, i) => ({ text, startMs: 300 + i * 400, endMs: 600 + i * 400 }));
const durationMs = 300 + words.length * 400 + 1000;
const editedIR = {
  schemaVersion: "mobile-editir/1", projectId: "p",
  canvas: { aspect: "9:16", width: 1080, height: 1920, fps: 30, background: "#000000" },
  durationMs,
  sources: [{ assetId: "primary", durationMs, width: 1080, height: 1920 }],
  clips: [{ id: "c0", assetId: "primary", sourceStartMs: 0, sourceEndMs: durationMs, timelineStartMs: 0, timelineEndMs: durationMs, speed: 1, volumeDb: 0, crop: null, filter: null, transitionIn: null }],
  overlays: [],
  captions: [{ id: "k1", kind: "caption", startMs: 300, endMs: 2000, text: "every single morning", words: words.slice(0, 3), style: { position: { x: 0.5, y: 0.45 } } }],
  zooms: [],
  audio: { originalTrack: { volumeDb: 0 }, music: [], speechRangesMs: [] },
};
const critique = VisualCritiqueSchema.parse({
  score: 6.5,
  issues: [{ kind: "caption_over_face", severity: "critical", atMs: 1000, refs: ["k1"], description: "captions cover the mouth", fix: "move them to the lower third" }],
});
const repairRequest = (extra: Record<string, unknown> = {}) =>
  MobileAIDirectRequestSchema.parse({
    prompt: "add captions and make it punchy",
    media: { durationMs, width: 1080, height: 1920, transcript: { words } },
    currentEditIR: editedIR,
    visualCritique: { round: 1, critique },
    ...extra,
  });

function agentClient(turns: ToolCall[][], seen: any[]): AIClient {
  return {
    provider: "claude",
    generate: async () => "",
    generateStream: async () => "",
    generateWithTools: async (_p, tools) => {
      seen.push({ oneShot: true, tools: tools.map((t: any) => t.function?.name ?? t.name) });
      return { text: "", toolCalls: [] };
    },
    generateAgentTurn: async (system, messages: AgentMessage[], tools) => {
      seen.push({ system, first: (messages[0] as any).content, tools: tools.map((t: any) => t.function?.name ?? t.name) });
      const calls = turns.shift() ?? [];
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

test("a repair turn fixes only the critic's issues: no story pass, every tool, a plain-words reply with the score", async () => {
  const seen: any[] = [];
  const res = await quiet(() =>
    VideoAIDirectorService.getInstance().directMobile(repairRequest(), {
      llmClient: agentClient([[{ id: "1", name: "updateTextStyle", args: { target: "k1", positionY: 0.55 } }, { id: "2", name: "finish_edit", args: { summary: "Moved the captions down." } }]], seen),
    })
  );
  assert.ok(!seen.some((s) => s.oneShot && s.tools.includes("plan_story")), "no story pass on a repair");
  const turn = seen.find((s) => s.system);
  assert.match(String(turn.first), /A visual check looked at stills of the edit you made \(round 1; score 6\.5\/10\)/);
  assert.match(String(turn.first), /captions cover the mouth/);
  assert.ok(turn.tools.includes("addZoom") && turn.tools.includes("updateTextStyle"), "repairs may use any tool");
  assert.equal(res.scope?.mode, "modify_existing");
  assert.match(res.reply, /^I checked how it looks \(6\.5\/10\) and fixed captions off your face\./);
  assert.equal(res.visualRound, 1);
  assert.ok(res.checkpoints?.length, "the repaired result can be checked again (round 2)");
});

test("a repair that would remove the captions the creator asked for is discarded", async () => {
  const res = await quiet(() =>
    VideoAIDirectorService.getInstance().directMobile(repairRequest(), {
      llmClient: agentClient([[{ id: "1", name: "removeItem", args: { kind: "caption" } }, { id: "2", name: "finish_edit", args: { summary: "x" } }]], []),
    })
  );
  assert.ok(res.editIR.captions.length >= 1, "captions kept");
  assert.ok(res.warnings.some((w) => /visual repair would have removed the requested captions/.test(w)), JSON.stringify(res.warnings));
  assert.equal(res.appliedOperations.length, 0, "the whole repair is discarded");
});

test("a normal edit returns checkpoints for the visual check; a turn that changes nothing does not", async () => {
  const seen: any[] = [];
  const edited = await quiet(() =>
    VideoAIDirectorService.getInstance().directMobile(
      MobileAIDirectRequestSchema.parse({ prompt: "add captions", media: { durationMs, width: 1080, height: 1920, transcript: { words } } }),
      { llmClient: agentClient([[{ id: "1", name: "autoCaptions", args: {} }, { id: "2", name: "finish_edit", args: { summary: "ok" } }]], seen) }
    )
  );
  assert.ok(edited.checkpoints && edited.checkpoints.length > 0);
  assert.ok(edited.checkpoints.some((c) => c.kind === "caption" || /caption/.test(c.label)));
  assert.equal(edited.visualRound, 0);
  const talk = await quiet(() =>
    VideoAIDirectorService.getInstance().directMobile(
      MobileAIDirectRequestSchema.parse({ prompt: "add captions", media: { durationMs, width: 1080, height: 1920, transcript: { words } } }),
      { llmClient: agentClient([[{ id: "1", name: "reply_to_creator", args: { reply: "Bold or clean?", phase: "gather" } }]], []) }
    )
  );
  assert.equal(talk.checkpoints, undefined);
});
