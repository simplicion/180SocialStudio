/**
 * AI Director quality-fix plan, Phase 3: the story pass (hook, keepers, retakes / false starts / repeats cut).
 * Run: npx tsx --test packages/domains/ai/tests/director-story.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { MobileAIDirectRequestSchema } from "@workspace/video-contracts";
import { spokenLines, storyCuts, storySignals, StoryPlanner, StoryPlanSchema, type StoryWord } from "../src/builders/story-planner";
import { VideoAIDirectorService } from "../src/builders/video-ai-director.service";
import type { AIClient } from "../src/kernel/ai-provider.service";

/** Words of a script: ~380 ms per word, `pause` ms after each line. */
function speak(lines: Array<{ text: string; pause?: number }>, startMs = 400) {
  const words: Array<{ text: string; startMs: number; endMs: number }> = [];
  const starts: number[] = [];
  let t = startMs;
  for (const l of lines) {
    starts.push(t);
    for (const w of l.text.split(" ")) {
      words.push({ text: w, startMs: t, endMs: t + 320 });
      t += 380;
    }
    t += l.pause ?? 900;
  }
  return { words, starts, endMs: t };
}

const SCRIPT = [
  { text: "So the biggest mistake people make with their first business is" }, // L1 false start
  { text: "sorry let me start that again" }, // L2 restart cue
  { text: "The biggest mistake people make with their first business is waiting until the product is perfect" }, // L3 hook
  { text: "I waited eight months and lost my first three customers because of it" }, // L4
  { text: "Basically waiting for perfect is the biggest mistake you can make with a business" }, // L5 repeated point
  { text: "Here is what I do now instead I ship something small every week" }, // L6
  { text: "Follow for more lessons from building in public" }, // L7 cta
];
const S = speak(SCRIPT);
const toStory = (ws: typeof S.words): StoryWord[] => ws.map((w) => ({ word: w.text, startSeconds: w.startMs / 1000, endSeconds: w.endMs / 1000 }));
const words = toStory(S.words);
const durationSec = (S.endMs + 400) / 1000;

test("spoken lines split at pauses and speaker changes", () => {
  const lines = spokenLines(words);
  assert.equal(lines.length, 7);
  assert.equal(lines[0].id, "L1");
  assert.equal(lines[2].text, SCRIPT[2].text);
  const two = spokenLines([
    { word: "hi", startSeconds: 0, endSeconds: 0.2, speakerId: "A" },
    { word: "there", startSeconds: 0.25, endSeconds: 0.4, speakerId: "B" },
  ]);
  assert.equal(two.length, 2, "a new line at each change of speaker");
});

test("signals: the false start, the restart cue, the repeat and hook-like lines are flagged (hints only)", () => {
  const sig = storySignals(spokenLines(words));
  assert.ok(sig.some((s) => s.kind === "near_duplicate" && s.lineIds.join() === "L1,L3"), JSON.stringify(sig));
  assert.ok(sig.some((s) => s.kind === "restart_cue" && s.lineIds[0] === "L2"));
  assert.ok(sig.some((s) => s.kind === "hook_like" && s.lineIds[0] === "L3"));
});

test("cuts land on word boundaries: no kept word is touched, removed runs merge, the hook is never cut", () => {
  const lines = spokenLines(words);
  const plan = StoryPlanSchema.parse({
    hookLineId: "L3",
    remove: [{ lineId: "L1", reason: "false_start" }, { lineId: "L2", reason: "false_start" }, { lineId: "L5", reason: "repeated_point" }, { lineId: "L3", reason: "retake" }],
    roles: [],
  });
  const { ops, dropped } = storyCuts(lines, plan, durationSec);
  assert.equal(ops.length, 2, "L1+L2 are one cut, L5 another");
  assert.ok(dropped.some((d) => /hook is never removed/.test(d)));
  const kept = new Set(["L3", "L4", "L6", "L7"]);
  for (const op of ops as any[]) {
    const a = op.startSec, b = op.startSec + op.durationSec;
    assert.match(op.reason, /^story: /);
    for (const l of lines) {
      for (const w of words.slice(l.from, l.to)) {
        const overlaps = w.endSeconds > a && w.startSeconds < b;
        if (kept.has(l.id)) assert.ok(!overlaps, `kept word "${w.word}" (${l.id}) inside a cut`);
      }
    }
  }
  // Every removed word is fully inside a cut (nothing half-cut).
  for (const id of ["L1", "L2", "L5"]) {
    const l = lines.find((x) => x.id === id)!;
    for (const w of words.slice(l.from, l.to)) {
      assert.ok((ops as any[]).some((op) => w.startSeconds >= op.startSec && w.endSeconds <= op.startSec + op.durationSec), `"${w.word}" fully cut`);
    }
  }
});

function storyClient(story: Record<string, unknown> | "throw" | "garbage", calls: any[] = []): AIClient {
  return {
    provider: "claude",
    generate: async () => "",
    generateStream: async () => "",
    generateWithTools: async (prompt, tools, options) => {
      calls.push({ prompt, tools: tools.map((t: any) => t.function?.name ?? t.name), options });
      if (story === "throw") throw new Error("overloaded");
      return { text: "", toolCalls: [{ id: "s", name: "plan_story", args: story === "garbage" ? { hookLineId: 5 } : story }] };
    },
  };
}

test("StoryPlanner: the model picks lines by id; a plan that removes most of the speech is refused", async () => {
  const calls: any[] = [];
  const o = await StoryPlanner.plan({ words, durationSec, request: "edit this for reels", client: storyClient({ hookLineId: "L3", remove: [{ lineId: "L1", reason: "false_start" }], roles: [{ lineId: "L3", role: "hook" }] }, calls) });
  assert.equal(o.cutOps.length, 1);
  assert.match(calls[0].prompt, /L2 \[/);
  assert.match(calls[0].prompt, /restart_cue L2/);
  assert.match(calls[0].options.system, /When in doubt, KEEP/);
  await assert.rejects(
    StoryPlanner.plan({ words, durationSec, request: "x", client: storyClient({ hookLineId: "L7", remove: ["L1", "L2", "L3", "L4", "L5", "L6"].map((lineId) => ({ lineId, reason: "rambling" })), roles: [] }) }),
    /would remove \d+% of the speech/
  );
  await assert.rejects(StoryPlanner.plan({ words, durationSec, request: "x", client: storyClient("garbage") }), /invalid story/);
  await assert.rejects(StoryPlanner.plan({ words: words.slice(0, 10), durationSec, request: "x", client: storyClient("garbage") }), /too little speech/);
});

// ── Through a Director turn ──────────────────────────────────────────────────────────────────────

const STORY = { hookLineId: "L3", remove: [{ lineId: "L1", reason: "false_start" }, { lineId: "L2", reason: "false_start" }, { lineId: "L5", reason: "repeated_point" }], roles: [{ lineId: "L3", role: "hook" }, { lineId: "L7", role: "cta" }], summary: "Cut the false start and a repeat." };

function directorClient(story: any, enhancement: any[] | "recommend", calls: any[]): AIClient {
  return {
    provider: "claude",
    generate: async () => "",
    generateStream: async () => "",
    generateWithTools: async (prompt, tools, options) => {
      const names = tools.map((t: any) => t.function?.name ?? t.name);
      calls.push({ prompt, names, options });
      if (names.includes("plan_story")) {
        if (story === "throw") throw new Error("story model down");
        return { text: "", toolCalls: [{ id: "s", name: "plan_story", args: story }] };
      }
      if (enhancement === "recommend") {
        return { text: "", toolCalls: [{ id: "r", name: "reply_to_creator", args: { reply: "Want fast cuts or calm?", phase: "recommend", quickReplies: ["Fast", "Calm"] } }] };
      }
      return { text: "", toolCalls: enhancement };
    },
  };
}

const request = (prompt = "edit this for reels") =>
  MobileAIDirectRequestSchema.parse({ prompt, media: { durationMs: Math.round(durationSec * 1000), width: 1080, height: 1920, transcript: { words: S.words } } });

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

/** Source ms of the primary file still on the timeline. */
const keptMs = (ir: any, a: number, b: number) => ir.clips.reduce((n: number, c: any) => n + Math.max(0, Math.min(b, c.sourceEndMs) - Math.max(a, c.sourceStartMs)), 0);

test("a whole edit: the story cut runs first, the video opens on the hook, then the cut timeline is decorated", async () => {
  const calls: any[] = [];
  const res = await quiet(() =>
    VideoAIDirectorService.getInstance().directMobile(request(), {
      llmClient: directorClient(STORY, [{ id: "1", name: "autoCaptions", args: {} }, { id: "2", name: "finish_edit", args: { summary: "Captions on." } }], calls),
    })
  );
  const storyCall = calls.findIndex((c) => c.names.includes("plan_story"));
  const planCall = calls.findIndex((c) => c.options?.system && !c.names.includes("plan_story"));
  assert.ok(storyCall >= 0 && planCall > storyCall, "story before the enhancement planner");
  assert.match(calls[planCall].prompt, /Story edit already made this turn/);
  assert.ok(!calls[planCall].prompt.includes(`0.40-`), "the enhancement planner sees the cut transcript");
  // The false start (L1+L2) and the repeat (L5) are gone; the hook and the CTA stay.
  const ir = res.editIR;
  assert.ok(keptMs(ir, S.starts[0], S.starts[2] - 100) < 100, "false start cut");
  assert.ok(keptMs(ir, S.starts[4], S.starts[5] - 100) < 100, "repeated point cut");
  assert.ok(keptMs(ir, S.starts[2], S.starts[3] - 600) > 3000, "hook kept");
  assert.ok(keptMs(ir, S.starts[6], S.starts[6] + 2000) > 1500, "CTA kept");
  // The hook starts the video (within its first spoken word).
  const first = [...ir.clips].sort((a: any, b: any) => a.timelineStartMs - b.timelineStartMs)[0];
  assert.ok(Math.abs(first.sourceStartMs - S.starts[2]) <= 100, `opens on the hook (${first.sourceStartMs} vs ${S.starts[2]})`);
  // No word is clipped: every word is either fully on the timeline or fully gone.
  for (const w of S.words) {
    const k = keptMs(ir, w.startMs, w.endMs);
    assert.ok(k === 0 || k >= w.endMs - w.startMs - 5, `"${w.text}" at ${w.startMs} is half-cut (${k} ms kept)`);
  }
  assert.ok(res.appliedOperations.some((a) => a.startsWith("story: ")));
  assert.ok(ir.captions.length > 0, "decorated after the cut");
  assert.equal((res.turnLog.story as any)?.applied, true);
  assert.equal((res.turnLog.story as any)?.removedLines, 3);
});

test("a reply without edits (recommendation) applies no story cut", async () => {
  const res = await quiet(() =>
    VideoAIDirectorService.getInstance().directMobile(request(), { llmClient: directorClient(STORY, "recommend", []) })
  );
  assert.equal(res.editIR.durationMs, Math.round(durationSec * 1000));
  assert.equal((res.turnLog.story as any)?.applied, false);
});

test("a failed story pass is reported and the edit goes on without it", async () => {
  const res = await quiet(() =>
    VideoAIDirectorService.getInstance().directMobile(request(), {
      llmClient: directorClient("throw", [{ id: "1", name: "autoCaptions", args: {} }, { id: "2", name: "finish_edit", args: { summary: "ok" } }], []),
    })
  );
  assert.ok(res.warnings.some((w) => /story pass skipped: .*story model down/.test(w)));
  assert.equal(res.plannerSource, "llm");
  assert.ok(res.editIR.captions.length > 0);
});

test("a scoped request (captions only) never runs the story pass", async () => {
  const calls: any[] = [];
  await quiet(() =>
    VideoAIDirectorService.getInstance().directMobile(request("add captions"), {
      llmClient: directorClient(STORY, [{ id: "1", name: "autoCaptions", args: {} }, { id: "2", name: "finish_edit", args: { summary: "ok" } }], calls),
    })
  );
  assert.ok(!calls.some((c) => c.names.includes("plan_story")));
});

test("locked ranges survive the story cut", async () => {
  const lockStart = S.starts[0], lockEnd = S.starts[1] + 1000;
  const res = await quiet(() =>
    VideoAIDirectorService.getInstance().directMobile(
      MobileAIDirectRequestSchema.parse({ ...request(), constraints: { lockedRanges: [[lockStart, lockEnd]] } }),
      { llmClient: directorClient(STORY, [{ id: "2", name: "finish_edit", args: { summary: "ok" } }], []) }
    )
  );
  assert.ok(keptMs(res.editIR, lockStart, lockEnd) >= lockEnd - lockStart - 50, "the locked false start stays");
  assert.ok(keptMs(res.editIR, S.starts[4], S.starts[5] - 100) < 100, "the unlocked repeat is still cut");
});

test("moveHookToStart: the hook line is moved to 0 on the cut timeline, whole words only", async () => {
  const story = { ...STORY, hookLineId: "L4", moveHookToStart: true, remove: [{ lineId: "L1", reason: "false_start" }, { lineId: "L2", reason: "false_start" }] };
  const res = await quiet(() =>
    VideoAIDirectorService.getInstance().directMobile(request(), { llmClient: directorClient(story, [{ id: "2", name: "finish_edit", args: { summary: "ok" } }], []) })
  );
  const first = [...res.editIR.clips].sort((a: any, b: any) => a.timelineStartMs - b.timelineStartMs)[0];
  assert.ok(Math.abs(first.sourceStartMs - S.starts[3]) <= 100, `opens on L4 (${first.sourceStartMs} vs ${S.starts[3]})`);
  assert.equal((res.turnLog.story as any)?.hookMoved, true);
  for (const w of S.words) {
    const k = keptMs(res.editIR, w.startMs, w.endMs);
    assert.ok(k === 0 || k >= w.endMs - w.startMs - 5, `"${w.text}" half-cut`);
  }
  assert.ok(keptMs(res.editIR, S.starts[2], S.starts[3] - 600) > 3000, "the line before the hook is still there, after it");
});
