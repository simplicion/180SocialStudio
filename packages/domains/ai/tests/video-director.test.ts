/**
 * AI Director: LLM tool-calling planner, repair retry, labelled deterministic fallback, and
 * realistic director commands compiled to MobileEditIR.
 *
 * Run: npx tsx --test packages/domains/ai/tests/video-director.test.ts
 * (requires `packages/video-contracts` to be built: `pnpm --filter @workspace/video-contracts build`)
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  MobileEditIRSchema,
  MobileAIDirectRequestSchema,
  MobileAIDirectRequest,
  MobileEditIR,
  buildDirectorToolDefinitions,
  MobileClipSchema,
  MUSIC_CATALOG,
  moodToMusicGenre,
  searchMusicCatalog,
  DirectorContext,
  alignScriptToTranscript,
  brandStyleDefaults,
  parsePieceScript,
  extractBrollQueries,
  MobileWatermarkSchema,
} from "@workspace/video-contracts";
import { VideoAIDirectorService } from "../src/builders/video-ai-director.service";
import { missingRequestedOperations } from "../src/builders/creative-planner";
import type { AIClient, ToolCallResponse } from "../src/kernel/ai-provider.service";

// ---------------------------------------------------------------------------------------------
// Fixture: a 1080p talking-head clip, ~23s, with a leading silence, real pauses, fillers and a
// punchline. Word timings are generated like a real STT would return them.
// ---------------------------------------------------------------------------------------------
type W = { text: string; startMs: number; endMs: number };
const SCRIPT: Array<string | number> = [
  1200, // leading silence (ms)
  "So here's the thing about the gym.",
  1100,
  "Um, most people quit in the first month",
  800,
  "because they go way too hard.",
  1400,
  "Uh, you don't need two hours a day.",
  900,
  "You need twenty minutes and consistency.",
  1000,
  "And the punchline? Consistency beats intensity every single time.",
  1300, // trailing silence
];

function buildFixture() {
  const words: W[] = [];
  let t = 0;
  for (const part of SCRIPT) {
    if (typeof part === "number") {
      t += part;
      continue;
    }
    for (const token of part.split(" ")) {
      const dur = token.replace(/[^A-Za-z]/g, "").length >= 9 ? 520 : 260;
      words.push({ text: token, startMs: t, endMs: t + dur });
      t += dur + 40;
    }
    t -= 40;
  }
  return { words, durationMs: t };
}

const FIX = buildFixture();
const PUNCH = FIX.words.find((w) => w.text === "Consistency")!;

function mobileRequest(prompt: string, extra: Partial<MobileAIDirectRequest> = {}): MobileAIDirectRequest {
  return MobileAIDirectRequestSchema.parse({
    prompt,
    media: { durationMs: FIX.durationMs, width: 1920, height: 1080, fps: 30, transcript: { words: FIX.words } },
    ...extra,
  });
}

/** Scripted LLM: returns the queued responses in order and records every call. */
function mockClient(responses: Array<ToolCallResponse | Error>, provider = "claude") {
  const calls: Array<{ prompt: string; tools: any[]; options: any }> = [];
  const client: AIClient = {
    provider,
    generate: async () => {
      throw new Error("generate() must not be used by the director");
    },
    generateStream: async () => {
      throw new Error("generateStream() must not be used by the director");
    },
    generateWithTools: async (prompt, tools, options) => {
      calls.push({ prompt, tools, options });
      const next = responses.shift();
      if (!next) throw new Error("mock LLM: no more scripted responses");
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return { client, calls };
}

const tc = (name: string, args: Record<string, any>) => ({ id: `t_${name}_${Math.random().toString(36).slice(2, 7)}`, name, args });
const finish = (summary: string) => tc("finish_edit", { summary });

const director = VideoAIDirectorService.getInstance();

async function runLLM(prompt: string, toolCalls: any[], extra: Partial<MobileAIDirectRequest> = {}, resolveStockVideo?: any) {
  const { client, calls } = mockClient([{ text: "", toolCalls }]);
  const res = await director.directMobile(mobileRequest(prompt, extra), { llmClient: client, resolveStockVideo });
  return { res, calls };
}

/** Invariants every MobileEditIR must satisfy (the renderer relies on them). */
function assertInvariants(ir: MobileEditIR) {
  MobileEditIRSchema.parse(ir);
  assert.equal(ir.clips[0].timelineStartMs, 0, "first clip starts at 0");
  for (let i = 0; i < ir.clips.length; i++) {
    const c = ir.clips[i];
    if (i > 0) assert.equal(c.timelineStartMs, ir.clips[i - 1].timelineEndMs, "clips are contiguous");
    const expected = Math.round((c.sourceEndMs - c.sourceStartMs) / c.speed);
    assert.ok(Math.abs(c.timelineEndMs - c.timelineStartMs - expected) <= 1, "duration == source/speed");
    assert.ok(c.sourceEndMs <= FIX.durationMs + 1 && c.sourceStartMs >= 0, "source range within media");
  }
  assert.equal(ir.durationMs, ir.clips[ir.clips.length - 1].timelineEndMs);
  for (const cap of ir.captions) {
    assert.ok(cap.startMs < cap.endMs && cap.endMs <= ir.durationMs);
    for (const w of cap.words) assert.ok(w.startMs >= cap.startMs && w.endMs <= cap.endMs, "words inside caption");
  }
  for (const z of ir.zooms) assert.ok(z.startMs < z.endMs && z.endMs <= ir.durationMs);
  for (const o of ir.overlays) assert.ok(o.timelineStartMs < o.timelineEndMs && o.timelineEndMs <= ir.durationMs);
}

/** Maps a source ms to timeline ms through the clips (null when cut). */
function srcToTimeline(ir: MobileEditIR, srcMs: number): number | null {
  for (const c of ir.clips) {
    if (srcMs >= c.sourceStartMs && srcMs <= c.sourceEndMs) return c.timelineStartMs + (srcMs - c.sourceStartMs) / c.speed;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Planner mechanics
// ---------------------------------------------------------------------------------------------

test("LLM path: tool calls become validated operations and the result is labelled llm", async () => {
  const { res, calls } = await runLLM("remove the pauses", [tc("removeSilences", { minDurationSec: 0.5 }), finish("Removed 6 pauses.")]);
  assert.equal(res.plannerSource, "llm");
  assert.match(res.plannerReason, /claude\/claude-sonnet-5/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.model, "claude-sonnet-5");
  assert.ok(calls[0].prompt.includes('"remove the pauses"'), "user request in prompt");
  assert.ok(calls[0].prompt.includes(`${(PUNCH.startMs / 1000).toFixed(2)}-`), "word timings in prompt");
  assert.ok(calls[0].prompt.includes("Silences (start+duration)"), "silences in prompt");
  const toolNames = calls[0].tools.map((t: any) => t.function.name);
  for (const n of ["removeRange", "removeSilences", "autoCaptions", "addZoom", "reframeSubject", "insertBroll", "addBackgroundMusic", "changeSpeed", "finish_edit"]) {
    assert.ok(toolNames.includes(n), `tool ${n} offered`);
  }
  assert.equal(res.operations[0].type, "removeSilences");
  assert.equal(res.summary, "Removed 6 pauses.");
  assertInvariants(res.editIR);
});

test("tool JSON schemas are derived from the Zod creative-plan schema (portable subset)", () => {
  const tools = buildDirectorToolDefinitions();
  const auto = tools.find((t) => t.function.name === "autoCaptions")!.function.parameters;
  assert.equal(auto.type, "object");
  assert.deepEqual(auto.properties.stylePreset.enum, ["HORMOZI_BOUNCE", "ALI_ABDAAL_CLEAN", "MINIMAL_SUBTITLE", "BOLD_CENTER"]);
  assert.equal(auto.properties.wordsPerCaption.type, "integer");
  assert.equal(auto.properties.wordsPerCaption.maximum, 8);
  assert.ok(!("type" in auto.properties), "discriminator is the tool name, not a parameter");
  const zoom = tools.find((t) => t.function.name === "addZoom")!.function.parameters;
  assert.deepEqual(zoom.required.sort(), ["durationSec", "startSec", "targetCoords"]);
  const json = JSON.stringify(tools);
  assert.ok(!json.includes("additionalProperties") && !json.includes('"default"'), "portable across Claude/OpenAI/Gemini");
});

test("repair retry: invalid tool args are sent back with errors and the corrected plan is used", async () => {
  const { client, calls } = mockClient([
    { text: "", toolCalls: [tc("autoCaptions", { highlightColor: "yellow" }), tc("addZoom", { startSec: 2, durationSec: 1, scale: 9, targetCoords: { x: 0.5, y: 0.4 } })] },
    { text: "", toolCalls: [tc("autoCaptions", { highlightColor: "#FFE600" }), tc("addZoom", { startSec: 2, durationSec: 1, scale: 1.3, targetCoords: { x: 0.5, y: 0.4 } }), finish("Added captions and a zoom.")] },
  ]);
  const res = await director.directMobile(mobileRequest("add yellow captions and a zoom"), { llmClient: client });
  assert.equal(calls.length, 2);
  assert.match(calls[1].prompt, /previous attempt was rejected/);
  assert.match(calls[1].prompt, /highlightColor/);
  assert.match(calls[1].prompt, /scale/);
  assert.equal(res.plannerSource, "llm");
  assert.match(res.plannerReason, /2 attempts, repaired/);
  // The fixture has no transcript: captions are not required (and are skipped honestly).
  assert.equal(res.editIR.zooms[0].scale, 1.3);
});

test("repair retry exhausted: falls back to deterministic and says why", async () => {
  const bad = { text: "", toolCalls: [tc("autoCaptions", { highlightColor: "yellow" })] };
  const { client, calls } = mockClient([bad, { ...bad }]);
  const res = await director.directMobile(mobileRequest("add yellow captions"), { llmClient: client });
  assert.equal(calls.length, 2);
  assert.equal(res.plannerSource, "deterministic");
  assert.match(res.plannerReason, /failed validation after 1 repair attempt/);
  assert.match(res.summary, /offline rule-based director/);
});

test("unknown tool names are rejected by validation (not executed)", async () => {
  const { client } = mockClient([
    { text: "", toolCalls: [tc("deleteEverything", {})] },
    { text: "", toolCalls: [tc("deleteEverything", {})] },
  ]);
  const res = await director.directMobile(mobileRequest("do something"), { llmClient: client });
  assert.equal(res.plannerSource, "deterministic");
  assert.match(res.plannerReason, /unknown tool "deleteEverything"/);
});

test("no LLM available: deterministic fallback is labelled with the reason (never silent)", async () => {
  const res = await director.directMobile(mobileRequest("cut the first 3 seconds"), { llmClient: null });
  assert.equal(res.plannerSource, "deterministic");
  assert.equal(res.plannerReason, "LLM disabled for this request");
  assert.ok(Math.abs(res.editIR.durationMs - (FIX.durationMs - 3000)) <= 2, "deterministic planner still honoured the cut");
  assertInvariants(res.editIR);

  const noCompany = await director.directMobile(mobileRequest("remove the pauses"), {});
  assert.equal(noCompany.plannerSource, "deterministic");
  assert.match(noCompany.plannerReason, /no workspace/);
  assert.ok(noCompany.editIR.durationMs < FIX.durationMs - 5000, "deterministic removed the pauses");
});

test("LLM error (e.g. 401/timeout): deterministic fallback with the provider error in the reason", async () => {
  const { client } = mockClient([new Error("401 invalid x-api-key")]);
  const res = await director.directMobile(mobileRequest("remove the pauses"), { llmClient: client });
  assert.equal(res.plannerSource, "deterministic");
  assert.match(res.plannerReason, /LLM call failed \(claude\/claude-sonnet-5\): 401 invalid x-api-key/);
});

test("text-only LLM reply is a conversational turn: no edits, timeline unchanged", async () => {
  const { client } = mockClient([{ text: "Hey! Want me to tighten the pauses or add captions?" }]);
  const res = await director.directMobile(mobileRequest("hi"), { llmClient: client });
  assert.equal(res.plannerSource, "llm");
  assert.equal(res.operations.length, 0);
  assert.equal(res.editIR.durationMs, FIX.durationMs);
  assert.equal(res.summary, "Hey! Want me to tighten the pauses or add captions?");
});

test("conversation history is included in the prompt", async () => {
  const { calls } = await runLLM("now make the captions bigger", [finish("ok")], {
    history: [
      { role: "user", content: "add yellow captions" },
      { role: "assistant", content: "Added yellow word-by-word captions." },
    ],
  });
  assert.match(calls[0].prompt, /Creator: add yellow captions/);
  assert.match(calls[0].prompt, /Director: Added yellow word-by-word captions\./);
});

// ---------------------------------------------------------------------------------------------
// Realistic director commands (scripted like a competent model would call the tools)
// ---------------------------------------------------------------------------------------------

test('cmd: "remove the pauses" -> ripple cuts at every pause, no word lost', async () => {
  const { res } = await runLLM("remove the pauses", [tc("removeSilences", { minDurationSec: 0.5, paddingSec: 0.1 }), finish("Removed pauses.")]);
  const ir = res.editIR;
  assertInvariants(ir);
  // 7 silences (lead, 5 pauses, tail). Lead/tail are cut to the clip edge but keep 0.1s of air next
  // to the first/last word; inner pauses keep 0.1s padding on each side.
  const inner = [1100, 800, 1400, 900, 1000].reduce((a, b) => a + b - 200, 0);
  assert.ok(Math.abs(FIX.durationMs - ir.durationMs - (1100 + 1200 + inner)) <= 5, `removed ${FIX.durationMs - ir.durationMs}ms`);
  assert.equal(ir.clips.length, 6, "six spoken segments remain");
  assert.equal(ir.clips[0].sourceStartMs, 1100);
  for (const w of FIX.words) assert.notEqual(srcToTimeline(ir, (w.startMs + w.endMs) / 2), null, `word "${w.text}" kept`);
});

test('cmd: "add yellow captions" -> word-synced kinetic captions in #FFE600', async () => {
  const { res } = await runLLM("add yellow captions", [tc("autoCaptions", { highlightColor: "#FFE600", wordsPerCaption: 3 }), finish("Added yellow captions.")]);
  const ir = res.editIR;
  assertInvariants(ir);
  const allWords = ir.captions.flatMap((c) => c.words);
  assert.equal(allWords.length, FIX.words.length, "every spoken word captioned");
  assert.ok(ir.captions.every((c) => c.kind === "caption" && c.style.highlightColor === "#FFE600" && c.style.animation === "word_pop"));
  assert.ok(ir.captions.every((c) => c.words.length <= 3));
  assert.equal(allWords[0].startMs, FIX.words[0].startMs, "timings preserved (no cuts)");
  assert.equal(ir.durationMs, FIX.durationMs, "captions do not change the cut");
});

test('cmd: "cut the first 3 seconds" -> head trimmed, captions/words rippled', async () => {
  const { res } = await runLLM("add captions and cut the first 3 seconds", [
    tc("autoCaptions", { highlightColor: "#FFFFFF" }),
    tc("removeRange", { startSec: 0, durationSec: 3, reason: "creator asked" }),
    finish("Trimmed 3s."),
  ]);
  const ir = res.editIR;
  assertInvariants(ir);
  assert.ok(Math.abs(ir.durationMs - (FIX.durationMs - 3000)) <= 2);
  assert.equal(ir.clips[0].sourceStartMs, 3000);
  const first = ir.captions[0].words[0];
  const srcWord = FIX.words.find((w) => w.startMs >= 3000)!;
  assert.ok(Math.abs(first.startMs - (srcWord.startMs - 3000)) <= 2, "first caption word shifted by -3000ms");
  assert.ok(!ir.captions.some((c) => c.words.some((w) => w.text === "So")), "words inside the cut are gone");
});

test('cmd: "make it punchier for TikTok" -> 9:16 crop, tighter cut, captions, zoom', async () => {
  const { res } = await runLLM("make it punchier for TikTok", [
    tc("reframeSubject", { targetAspect: "9:16" }),
    tc("removeSilences", { minDurationSec: 0.4 }),
    tc("autoCaptions", { highlightColor: "#FFE600", uppercase: true, wordsPerCaption: 2 }),
    tc("addZoom", { startSec: PUNCH.startMs / 1000 - 0.1, durationSec: 1.5, scale: 1.3, targetCoords: { x: 0.5, y: 0.38 } }),
    finish("Vertical, tighter, captioned, with a punch-in on the punchline."),
  ]);
  const ir = res.editIR;
  assertInvariants(ir);
  assert.deepEqual([ir.canvas.aspect, ir.canvas.width, ir.canvas.height], ["9:16", 1080, 1920]);
  const crop = ir.clips[0].crop!;
  assert.ok(crop && Math.abs(crop.width - (9 / 16) / (16 / 9)) < 0.001 && crop.height === 1, "center crop 16:9 -> 9:16");
  assert.ok(ir.durationMs < FIX.durationMs - 6000);
  assert.ok(ir.captions.length > 0 && ir.captions[0].text === ir.captions[0].text.toUpperCase());
  assert.equal(ir.zooms.length, 1);
  const punchOnTimeline = srcToTimeline(ir, PUNCH.startMs)!;
  assert.ok(Math.abs(ir.zooms[0].startMs - (punchOnTimeline - 100)) <= 60, "zoom stays on the punchline after the cuts");
});

test('cmd: "add upbeat music and duck under speech" -> music bed with ducking + speech ranges', async () => {
  const { res } = await runLLM("add upbeat music and duck under speech", [
    tc("addBackgroundMusic", { query: "upbeat energetic", volumeDb: -16, duckUnderSpeech: true, duckDb: -12 }),
    finish("Added upbeat music ducked under your voice."),
  ]);
  const ir = res.editIR;
  assertInvariants(ir);
  const m = ir.audio.music[0];
  assert.ok(m, "music present");
  // Resolved server-side from the built-in royalty-free catalogue (no resolver injected).
  assert.equal(m.source.kind, "url");
  assert.match((m.source as any).url, /^https:\/\/upload\.wikimedia\.org\/.+\.mp3$/);
  assert.equal((m.source as any).query, "upbeat energetic");
  assert.ok(res.warnings.some((w) => /Credit required when publishing: .*Kevin MacLeod/.test(w)), "CC BY credit surfaced");
  assert.equal(m.timelineStartMs, 0);
  assert.equal(m.timelineEndMs, ir.durationMs);
  assert.deepEqual(m.duck, { enabled: true, duckDb: -12, attackMs: 120, releaseMs: 350 });
  assert.equal(ir.audio.speechRangesMs.length, 6, "one speech range per spoken phrase");
  assert.equal(ir.audio.speechRangesMs[0][0], 1200);
});

test('cmd: "put b-roll of a gym at 5s" -> overlay from a resolved stock URL', async () => {
  const queries: string[] = [];
  const { res } = await runLLM(
    "put b-roll of a gym at 5s",
    [tc("insertBroll", { stockQuery: "gym workout", timelineStartSec: 5, durationSec: 3 }), finish("Added gym b-roll at 5s.")],
    {},
    async (q: string, aspect: string) => {
      queries.push(`${q}|${aspect}`);
      return "https://videos.pexels.com/video-files/123/gym.mp4";
    }
  );
  const ir = res.editIR;
  assertInvariants(ir);
  assert.deepEqual(queries, ["gym workout|16:9"]);
  assert.equal(ir.overlays.length, 1);
  assert.deepEqual([ir.overlays[0].timelineStartMs, ir.overlays[0].timelineEndMs], [5000, 8000]);
  assert.deepEqual(ir.overlays[0].source, { kind: "url", url: "https://videos.pexels.com/video-files/123/gym.mp4", query: "gym workout" });
  assert.equal(ir.overlays[0].muted, true);
});

test("b-roll without a stock resolver stays a stock_query and is reported in warnings", async () => {
  const { res } = await runLLM("put b-roll of a gym at 5s", [tc("insertBroll", { stockQuery: "gym", timelineStartSec: 5, durationSec: 3 })]);
  assert.deepEqual(res.editIR.overlays[0].source, { kind: "stock_query", query: "gym", url: null });
  assert.ok(res.warnings.some((w) => /needs a stock URL/.test(w)));
});

test('cmd: "zoom on the punchline" -> zoom where the punchline is spoken', async () => {
  const { res } = await runLLM("zoom on the punchline", [
    tc("addZoom", { startSec: PUNCH.startMs / 1000, durationSec: 2, scale: 1.35, targetCoords: { x: 0.5, y: 0.38 } }),
    finish("Punched in on 'Consistency beats intensity'."),
  ]);
  const z = res.editIR.zooms[0];
  assert.equal(z.startMs, PUNCH.startMs);
  assert.equal(z.endMs, PUNCH.startMs + 2000);
  assert.equal(z.scale, 1.35);
  assert.equal(z.rampMs, 250);
});

test('cmd: "reframe to vertical" -> 1080x1920 canvas with a centred crop', async () => {
  const { res } = await runLLM("reframe to vertical", [tc("reframeSubject", { targetAspect: "9:16" })]);
  const ir = res.editIR;
  assertInvariants(ir);
  assert.equal(ir.canvas.aspect, "9:16");
  const c = ir.clips[0].crop!;
  assert.ok(Math.abs(c.x + c.width / 2 - 0.5) < 0.001, "centred");
  assert.equal(ir.durationMs, FIX.durationMs);
});

test('cmd: "speed it up to 1.5x" -> speed 1.5 and timeline shortened by 1/1.5', async () => {
  const { res } = await runLLM("speed it up to 1.5x", [tc("autoCaptions", {}), tc("changeSpeed", { clipId: "all", speedMultiplier: 1.5 })]);
  const ir = res.editIR;
  assertInvariants(ir);
  assert.equal(ir.clips[0].speed, 1.5);
  assert.ok(Math.abs(ir.durationMs - Math.round(FIX.durationMs / 1.5)) <= 2);
  const lastWord = ir.captions[ir.captions.length - 1].words.slice(-1)[0];
  const src = FIX.words[FIX.words.length - 1];
  assert.ok(Math.abs(lastWord.endMs - src.endMs / 1.5) <= 3, "captions rescaled with speed");
});

test('cmd: "remove the ums and add captions" -> fillers cut and absent from captions', async () => {
  const { res } = await runLLM("remove the ums and add captions", [tc("cleanFillers", {}), tc("autoCaptions", {})]);
  const ir = res.editIR;
  assertInvariants(ir);
  const words = ir.captions.flatMap((c) => c.words.map((w) => w.text.toLowerCase().replace(/[^a-z]/g, "")));
  assert.ok(!words.includes("um") && !words.includes("uh"), "no fillers in captions");
  assert.equal(words.length, FIX.words.length - 2);
  assert.ok(ir.durationMs < FIX.durationMs - 500);
  assert.equal(res.rejectedOperations.length, 0);
});

test('cmd: "add a title Gym Truth at the start" -> styled text overlay', async () => {
  const { res } = await runLLM("add a title 'Gym Truth' at the start", [
    tc("addText", { text: "Gym Truth", timelineStartSec: 0, durationSec: 2.5, position: { x: 0, y: -0.6 }, style: { fontSize: 80, color: "#FFFFFF", backgroundColor: "#000000B3" } }),
  ]);
  const t = res.editIR.captions.find((c) => c.kind === "text")!;
  assert.equal(t.text, "Gym Truth");
  assert.deepEqual([t.startMs, t.endMs], [0, 2500]);
  assert.equal(t.style.fontSizePx, 80);
  assert.equal(t.style.animation, "none");
  assert.ok(Math.abs(t.style.positionY - 0.2) < 1e-9);
  assert.deepEqual(t.style.background, { color: "#000000B3", paddingPx: 16, radiusPx: 16 });
});

test("cmd: \"black and white look with crossfades\" -> filter + transitions at cuts", async () => {
  const { res } = await runLLM("remove pauses, black and white, crossfade between cuts", [
    tc("removeSilences", {}),
    tc("applyFilter", { preset: "NOIR_BW", saturation: 0, contrast: 1.3 }),
    tc("addTransition", { transitionType: "CROSSFADE", durationSec: 0.25 }),
  ]);
  const ir = res.editIR;
  assertInvariants(ir);
  assert.ok(ir.clips.every((c) => c.filter?.preset === "NOIR_BW" && c.filter.saturation === 0));
  assert.equal(ir.clips[0].transitionIn, null);
  assert.ok(ir.clips.slice(1).every((c) => c.transitionIn?.type === "CROSSFADE" && c.transitionIn.durationMs === 250));
});

test("captions: translateCaptions converts the final captions through the translator, keeping ranges and style", async () => {
  const { client } = mockClient([{ text: "", toolCalls: [tc("autoCaptions", { template: "VARUN_MAYYA_BOX" }), tc("translateCaptions", { targetLanguage: "hi", script: "roman" })] }]);
  let asked: any;
  const res = await director.directMobile(mobileRequest("add Varun Mayya captions in Hinglish"), {
    llmClient: client,
    translateCaptionLines: async (lines, targetLanguage, script) => {
      asked = { lines, targetLanguage, script };
      return lines.map((_, i) => `yeh line ${i} hai`);
    },
  });
  assertInvariants(res.editIR);
  const caps = res.editIR.captions.filter((c) => c.kind === "caption");
  assert.ok(caps.length > 0);
  assert.equal(asked.lines.length, caps.length);
  assert.deepEqual([asked.targetLanguage, asked.script], ["hi", "roman"]);
  caps.forEach((c, i) => {
    assert.equal(c.text, `yeh line ${i} hai`);
    assert.deepEqual(c.words.map((w) => w.text), ["yeh", "line", String(i), "hai"]);
    assert.equal(c.style.animation, "word_box");
    assert.equal(c.style.preset, "VARUN_MAYYA_BOX");
  });
  assert.ok(res.appliedOperations.some((a) => /Converted \d+ caption\(s\) to Hindi in Roman letters/.test(a)));
});

test("captions: a failed translation is rejected and the captions stay as spoken", async () => {
  const { client } = mockClient([{ text: "", toolCalls: [tc("autoCaptions", {}), tc("translateCaptions", { targetLanguage: "es" })] }]);
  const res = await director.directMobile(mobileRequest("add captions and translate the captions to Spanish"), {
    llmClient: client,
    translateCaptionLines: async () => { throw new Error("upstream down"); },
  });
  assert.ok(res.rejectedOperations.some((r) => r.startsWith("translateCaptions: the translation failed")));
  assert.ok(!res.appliedOperations.some((a) => a.startsWith("Converted")));
  assert.ok(res.editIR.captions.filter((c) => c.kind === "caption").length > 0);
});

test("honesty: ops that cannot apply are rejected, not reported as done", async () => {
  const { res } = await runLLM("duck the music", [tc("duckAudio", {}), tc("styleCaption", { preset: "BOLD_CENTER" })]);
  assert.equal(res.appliedOperations.length, 0);
  assert.equal(res.rejectedOperations.length, 2);
  assert.match(res.summary, /2 requested change\(s\) could not be applied/);
});

test("captions: a named creator template with a named colour reaches the phone as that template", async () => {
  const { res } = await runLLM("apply the Mr Beast type captioning with red highlights", [tc("autoCaptions", { template: "MRBEAST_HYPE", highlightColor: "#FF0000" })]);
  assertInvariants(res.editIR);
  const caps = res.editIR.captions.filter((c) => c.kind === "caption");
  assert.ok(caps.length > 0);
  for (const c of caps) {
    assert.equal(c.style.preset, "MRBEAST_HYPE");
    assert.equal(c.style.fontFamily, "Montserrat");
    assert.equal(c.style.highlightColor, "#FF0000");
    assert.equal(c.style.textColor, "#FFFFFF");
    assert.equal(c.style.uppercase, true);
  }
});

test("captions without a transcript are skipped with a warning (no fake captions)", async () => {
  const { client } = mockClient([{ text: "", toolCalls: [tc("autoCaptions", {})] }]);
  const req = MobileAIDirectRequestSchema.parse({ prompt: "add captions", media: { durationMs: 10000, width: 1080, height: 1920 } });
  const res = await director.directMobile(req, { llmClient: client });
  assert.equal(res.editIR.captions.length, 0);
  assert.ok(res.warnings.some((w) => /no transcript/.test(w)));
});

// ---------------------------------------------------------------------------------------------
// Multi-turn: currentEditIR round-trips and source analysis is mapped onto the cut timeline
// ---------------------------------------------------------------------------------------------

test("multi-turn: captions added after a cut land on the cut timeline", async () => {
  const t1 = await runLLM("remove the pauses", [tc("removeSilences", {})]);
  const t2 = await runLLM("add captions", [tc("autoCaptions", { highlightColor: "#00FF88" })], { currentEditIR: t1.res.editIR });
  const ir = t2.res.editIR;
  assertInvariants(ir);
  assert.equal(ir.projectId, t1.res.editIR.projectId, "projectId preserved");
  assert.deepEqual(ir.clips.map((c) => [c.sourceStartMs, c.sourceEndMs]), t1.res.editIR.clips.map((c) => [c.sourceStartMs, c.sourceEndMs]), "turn-1 cuts preserved");
  const words = ir.captions.flatMap((c) => c.words);
  FIX.words.forEach((src, i) => {
    const expected = srcToTimeline(ir, src.startMs)!;
    assert.ok(Math.abs(words[i].startMs - expected) <= 2, `word ${i} "${src.text}" at ${words[i].startMs} vs ${expected}`);
  });
  // The prompt for turn 2 described the already-cut timeline, not the raw clip.
  assert.match(t2.calls[0].prompt, new RegExp(`duration: ${(t1.res.editIR.durationMs / 1000).toFixed(2)}s`));
});

test("request schema accepts the documented mobile payload and rejects bad input", () => {
  const ok = MobileAIDirectRequestSchema.safeParse({
    prompt: "remove the pauses and add yellow captions",
    history: [{ role: "user", content: "make it punchier for TikTok" }],
    projectId: "p_1",
    media: { durationMs: 21480, width: 1920, height: 1080, fps: 30, transcript: { words: [{ text: "so", startMs: 320, endMs: 480 }] }, silences: [{ startMs: 0, endMs: 320 }] },
    currentEditIR: null,
  });
  assert.ok(ok.success);
  assert.equal(MobileAIDirectRequestSchema.safeParse({ prompt: "", media: { durationMs: 1, width: 1, height: 1 } }).success, false);
  assert.equal(MobileAIDirectRequestSchema.safeParse({ prompt: "x", media: { durationMs: -5, width: 1, height: 1 } }).success, false);
});

test("deterministic fallback keeps every intent of a compound prompt (pauses + captions)", async () => {
  const res = await director.directMobile(mobileRequest("remove the pauses and add yellow captions"), { llmClient: null });
  assert.equal(res.plannerSource, "deterministic");
  assert.ok(res.editIR.durationMs < FIX.durationMs - 5000, "pauses removed");
  assert.ok(res.editIR.captions.length > 0, "captions added");
  assert.equal(res.editIR.captions.flatMap((c) => c.words).length, FIX.words.length);
  assertInvariants(res.editIR);
});

// ---------------------------------------------------------------------------------------------
// Manual editor round trip: every field the client sent survives a director turn
// ---------------------------------------------------------------------------------------------

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** Like runLLM, but with every resolver/option exposed. A string = text-only reply. */
async function turn(prompt: string, toolCalls: any[] | string, extra: Partial<MobileAIDirectRequest> = {}, opts: Record<string, any> = {}) {
  const response = typeof toolCalls === "string" ? { text: toolCalls } : { text: "", toolCalls };
  const { client, calls } = mockClient([response]);
  const res = await director.directMobile(mobileRequest(prompt, extra), { llmClient: client, ...opts });
  return { res, calls };
}

async function manuallyEditedTimeline(): Promise<MobileEditIR> {
  const t1 = await turn(
    "tighten, captions, zoom, b-roll",
    [
      tc("removeSilences", {}),
      tc("autoCaptions", {}),
      tc("addZoom", { startSec: 2, durationSec: 1.5, scale: 1.3, targetCoords: { x: 0.5, y: 0.38 } }),
      tc("insertBroll", { stockQuery: "gym workout", timelineStartSec: 4, durationSec: 2 }),
      tc("addBackgroundMusic", { query: "upbeat" }),
    ],
    {},
    { resolveStockVideo: async () => "https://videos.pexels.com/video-files/1/gym.mp4" }
  );
  // What the phone's manual editor might do before the next director turn.
  const ir = clone(t1.res.editIR);
  ir.canvas.background = "#112233";
  ir.canvas.fps = 29.97;
  ir.clips[0].crop = { x: 0.1, y: 0.05, width: 0.5, height: 0.9 };
  ir.clips[1].rotationDeg = 90;
  ir.clips[1].flipH = true;
  ir.clips[1].crop = { x: 0, y: 0.25, width: 1, height: 0.3164 };
  ir.clips[2].volumeDb = -4;
  ir.audio.originalTrack.volumeDb = -6;
  ir.captions[0].style.fontFamily = "Montserrat";
  ir.captions[0].style.maxWidthFraction = 0.7;
  ir.captions[0].style.preset = "NEON_POP";
  ir.zooms[0].rampMs = 100;
  ir.audio.music[0].source = { kind: "url", url: "https://cdn.example.com/music/pick.mp3", query: "my pick" };
  ir.audio.music[0].duck = { enabled: false, duckDb: -20, attackMs: 200, releaseMs: 500 };
  return MobileEditIRSchema.parse(ir);
}

test("round trip: a conversational turn returns the client's manually edited timeline unchanged", async () => {
  const edited = await manuallyEditedTimeline();
  const { res } = await turn("thanks!", "You're welcome!", { currentEditIR: edited });
  assert.deepEqual(res.editIR, edited);
});

test("round trip: crop, rotation/flip, originalTrack, background, caption font, zoom ramp and music survive an edit", async () => {
  const edited = await manuallyEditedTimeline();
  const lastSec = edited.durationMs / 1000;
  const { res } = await turn("add a zoom at the end", [tc("addZoom", { startSec: lastSec - 2, durationSec: 1.2, scale: 1.2, targetCoords: { x: 0.5, y: 0.4 } })], { currentEditIR: edited });
  const ir = res.editIR;
  assertInvariants(ir);
  assert.equal(ir.canvas.background, "#112233");
  assert.equal(ir.canvas.fps, 29.97);
  assert.deepEqual(ir.clips[0].crop, { x: 0.1, y: 0.05, width: 0.5, height: 0.9 });
  assert.equal(ir.clips[1].rotationDeg, 90);
  assert.equal(ir.clips[1].flipH, true);
  assert.deepEqual(ir.clips[1].crop, { x: 0, y: 0.25, width: 1, height: 0.3164 });
  assert.equal(ir.clips[0].rotationDeg, undefined, "default rotation omitted");
  assert.equal(ir.clips[0].flipH, undefined, "default flip omitted");
  assert.equal(ir.clips[2].volumeDb, -4);
  assert.equal(ir.audio.originalTrack.volumeDb, -6);
  assert.equal(ir.captions[0].style.fontFamily, "Montserrat");
  assert.equal(ir.captions[0].style.maxWidthFraction, 0.7);
  assert.equal(ir.captions[0].style.preset, "NEON_POP");
  assert.equal(ir.zooms[0].rampMs, 100);
  assert.equal(ir.zooms.length, 2);
  assert.deepEqual(ir.audio.music[0].source, { kind: "url", url: "https://cdn.example.com/music/pick.mp3", query: "my pick" });
  assert.deepEqual(ir.audio.music[0].duck, { enabled: false, duckDb: -20, attackMs: 200, releaseMs: 500 });
  assert.deepEqual(ir.overlays[0].source, edited.overlays[0].source);
  assert.deepEqual(ir.sources, edited.sources);
});

test("round trip: crop:null ('fit') is kept, and an explicit reframe recomputes a fill crop", async () => {
  const fit = await turn("vertical, letterboxed", [tc("changeAspectRatio", { targetAspect: "9:16", mode: "fit", background: "#202020" })]);
  assertInvariants(fit.res.editIR);
  assert.deepEqual([fit.res.editIR.canvas.width, fit.res.editIR.canvas.height], [1080, 1920]);
  assert.equal(fit.res.editIR.clips[0].crop, null, "whole frame fitted");
  assert.equal(fit.res.editIR.canvas.background, "#202020");

  const kept = await turn("add captions", [tc("autoCaptions", {})], { currentEditIR: fit.res.editIR });
  assert.equal(kept.res.editIR.clips[0].crop, null, "fit survives an unrelated turn");
  assert.equal(kept.res.editIR.canvas.background, "#202020");

  const refr = await turn("fill the frame", [tc("reframeSubject", { targetAspect: "9:16" })], { currentEditIR: kept.res.editIR });
  const c = refr.res.editIR.clips[0].crop!;
  assert.ok(c && c.height === 1 && Math.abs(c.width - (9 / 16) / (16 / 9)) < 0.001, "reframe recomputed a fill crop");
});

test("round trip: a manual crop is replaced only by an operation that changes the canvas", async () => {
  const base = await turn("vertical", [tc("reframeSubject", { targetAspect: "9:16" })]);
  const edited = clone(base.res.editIR);
  edited.clips[0].crop = { x: 0.05, y: 0, width: 0.3164, height: 1 };
  const t2 = await turn("add a zoom", [tc("addZoom", { startSec: 1, durationSec: 1, scale: 1.2, targetCoords: { x: 0.5, y: 0.4 } })], { currentEditIR: edited });
  assert.deepEqual(t2.res.editIR.clips[0].crop, { x: 0.05, y: 0, width: 0.3164, height: 1 });
  const t3 = await turn("square please", [tc("changeAspectRatio", { targetAspect: "1:1" })], { currentEditIR: t2.res.editIR });
  const c = t3.res.editIR.clips[0].crop!;
  assert.deepEqual([t3.res.editIR.canvas.width, t3.res.editIR.canvas.height], [1080, 1080]);
  assert.ok(Math.abs(c.width - 1080 / 1920) < 0.001 && c.height === 1, "new canvas -> new fill crop");
});

test("speechRangesMs follow the edited timeline (reorder) and are empty when the original audio is muted", async () => {
  const t1 = await turn("remove pauses", [tc("removeSilences", {})]);
  const clips = t1.res.editIR.clips;
  const moved = await turn("put the last part first", [tc("moveClip", { clipId: clips[clips.length - 1].id, targetTimelineStartSec: 0 })], { currentEditIR: t1.res.editIR });
  const ir = moved.res.editIR;
  assertInvariants(ir);
  const ranges = ir.audio.speechRangesMs;
  for (let i = 1; i < ranges.length; i++) assert.ok(ranges[i][0] > ranges[i - 1][1], "sorted, non-overlapping");
  for (const w of FIX.words) {
    const t = srcToTimeline(ir, (w.startMs + w.endMs) / 2)!;
    assert.ok(ranges.some(([s, e]) => t >= s && t <= e), `word "${w.text}" at ${t}ms is inside a speech range`);
  }
  const muted = await turn("mute my voice", [tc("adjustVolume", { trackId: "original", volumeDb: -60 })], { currentEditIR: ir });
  assert.deepEqual(muted.res.editIR.audio.speechRangesMs, []);
});

test("MobileClipSchema: speed range matches the renderers (0.25..4), rotation is quarter turns only", () => {
  const clip = { id: "c", assetId: "a", sourceStartMs: 0, sourceEndMs: 1000, timelineStartMs: 0, timelineEndMs: 1000, speed: 1, volumeDb: 0, crop: null, filter: null, transitionIn: null };
  assert.ok(MobileClipSchema.safeParse(clip).success);
  assert.ok(MobileClipSchema.safeParse({ ...clip, speed: 0.25, rotationDeg: 270, flipH: true }).success);
  assert.equal(MobileClipSchema.safeParse({ ...clip, speed: 0.2 }).success, false);
  assert.equal(MobileClipSchema.safeParse({ ...clip, rotationDeg: 45 }).success, false);
});

// ---------------------------------------------------------------------------------------------
// Music: resolved server-side like b-roll
// ---------------------------------------------------------------------------------------------

test("music: stock_query is resolved to a URL through the injected resolver", async () => {
  const seen: Array<[string, number]> = [];
  const { res } = await turn("add chill music", [tc("addBackgroundMusic", { query: "chill lofi" })], {}, {
    resolveStockMusic: async (q: string, durationSec: number) => {
      seen.push([q, durationSec]);
      return { url: "https://cdn.example.com/lofi.mp3", title: "Lofi Test", license: "CC0-1.0" };
    },
  });
  assertInvariants(res.editIR);
  assert.deepEqual(seen.map((s) => s[0]), ["chill lofi"]);
  assert.ok(Math.abs(seen[0][1] - FIX.durationMs / 1000) < 0.01, "resolver told the timeline length");
  assert.deepEqual(res.editIR.audio.music[0].source, { kind: "url", url: "https://cdn.example.com/lofi.mp3", query: "chill lofi" });
  assert.ok(res.warnings.some((w) => /"Lofi Test"/.test(w)));
});

test("music: no match keeps stock_query and says so", async () => {
  const viaResolver = await turn("add music", [tc("addBackgroundMusic", { query: "upbeat" })], {}, { resolveStockMusic: async () => null });
  assert.deepEqual(viaResolver.res.editIR.audio.music[0].source, { kind: "stock_query", query: "upbeat", url: null });
  assert.ok(viaResolver.res.warnings.some((w) => /music "upbeat" needs a track URL/.test(w)));

  const viaCatalog = await turn("add heavy metal", [tc("addBackgroundMusic", { query: "heavy metal" })]);
  assert.deepEqual(viaCatalog.res.editIR.audio.music[0].source, { kind: "stock_query", query: "heavy metal", url: null });
  assert.ok(viaCatalog.res.warnings.some((w) => /needs a track URL/.test(w)));

  const failing = await turn("add music", [tc("addBackgroundMusic", { query: "upbeat" })], {}, {
    resolveStockMusic: async () => {
      throw new Error("provider down");
    },
  });
  assert.equal(failing.res.editIR.audio.music[0].source.kind, "stock_query");
  assert.ok(failing.res.warnings.some((w) => /music lookup failed \(provider down\)/.test(w)));
});

test("music catalogue: mood keywords map to genres; every entry is an HTTPS mp3 with a licence", () => {
  assert.deepEqual(moodToMusicGenre("upbeat energetic pop"), { genre: "ELECTRONIC_UPBEAT", matched: true });
  assert.deepEqual(moodToMusicGenre("Chill LoFi beats"), { genre: "LOFI_STUDY", matched: true });
  assert.deepEqual(moodToMusicGenre("epic cinematic"), { genre: "CINEMATIC_DRAMATIC", matched: true });
  assert.equal(moodToMusicGenre("background music").matched, true);
  assert.equal(moodToMusicGenre("heavy metal").matched, false);
  for (const t of MUSIC_CATALOG) {
    assert.match(t.url, /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/.+\.mp3$/);
    assert.match(t.license, /^CC-BY-\d\.0$/);
    assert.ok(t.durationSec > 30 && t.attribution.includes(t.title));
  }
  const long = searchMusicCatalog("calm", { minDurationSec: 200 }).tracks[0];
  assert.ok(long.durationSec >= 200, "prefers a track long enough for the video");
});

// ---------------------------------------------------------------------------------------------
// Editing tools: split / ripple delete / trim / move / reorder / aspect / volume / rotate
// ---------------------------------------------------------------------------------------------

test("tools: the new editing tools are offered with portable schemas", () => {
  const tools = buildDirectorToolDefinitions();
  const byName = new Map(tools.map((t) => [t.function.name, t.function.parameters]));
  for (const n of ["splitClip", "rippleDelete", "trimClip", "moveClip", "reorderSegment", "changeAspectRatio", "adjustVolume", "rotateClip"]) assert.ok(byName.has(n), `tool ${n} offered`);
  assert.equal(byName.get("rotateClip").properties.rotationDeg.type, "integer");
  assert.equal(byName.get("adjustVolume").properties.volumeDb.minimum, -60);
  assert.deepEqual(byName.get("changeAspectRatio").required, ["targetAspect"]);
  assert.ok(!JSON.stringify(tools).includes('"default"'));
});

test("tool: splitClip is invisible, speed-aware, and names the parts <id>_1/<id>_2", async () => {
  const fast = await turn("2x", [tc("changeSpeed", { clipId: "all", speedMultiplier: 2 })]);
  const id = fast.res.editIR.clips[0].id;
  const { res } = await turn("split at 3s", [tc("splitClip", { clipId: id, splitTimeSec: 3 })], { currentEditIR: fast.res.editIR });
  const ir = res.editIR;
  assertInvariants(ir);
  assert.deepEqual(ir.clips.map((c) => c.id), [`${id}_1`, `${id}_2`]);
  assert.deepEqual(ir.clips.map((c) => [c.sourceStartMs, c.sourceEndMs]), [[0, 6000], [6000, FIX.durationMs]], "source split at 3s x 2");
  assert.equal(ir.durationMs, fast.res.editIR.durationMs);
  assert.equal(ir.clips[1].transitionIn, null);
});

test("tool: rippleDelete removes one clip and closes the gap", async () => {
  const t1 = await turn("remove pauses", [tc("removeSilences", {})]);
  const victim = t1.res.editIR.clips[2];
  const { res } = await turn("delete the third part", [tc("rippleDelete", { clipId: victim.id })], { currentEditIR: t1.res.editIR });
  assertInvariants(res.editIR);
  assert.equal(res.editIR.clips.length, t1.res.editIR.clips.length - 1);
  assert.ok(!res.editIR.clips.some((c) => c.sourceStartMs === victim.sourceStartMs));
  assert.ok(Math.abs(res.editIR.durationMs - (t1.res.editIR.durationMs - (victim.timelineEndMs - victim.timelineStartMs))) <= 2);
});

test("tool: trimClip removes head/tail seconds (ripple) and rejects impossible trims", async () => {
  const { res } = await turn("trim", [tc("trimClip", { clipId: "c1", startTrimSec: 1, endTrimSec: 2 })]);
  assertInvariants(res.editIR);
  assert.deepEqual([res.editIR.clips[0].sourceStartMs, res.editIR.clips[0].sourceEndMs], [1000, FIX.durationMs - 2000]);
  assert.ok(Math.abs(res.editIR.durationMs - (FIX.durationMs - 3000)) <= 2);
  const bad = await turn("trim", [tc("trimClip", { clipId: "c1", startTrimSec: 20, endTrimSec: 5 }), tc("trimClip", { clipId: "nope", endTrimSec: 1 })]);
  assert.equal(bad.res.rejectedOperations.length, 2);
  assert.equal(bad.res.editIR.durationMs, FIX.durationMs);
});

test("tool: moveClip reorders whole clips; captions travel with their footage", async () => {
  const t1 = await turn("pauses + captions", [tc("removeSilences", {}), tc("autoCaptions", {})]);
  const before = t1.res.editIR;
  const last = before.clips[before.clips.length - 1];
  const { res } = await turn("last part first", [tc("moveClip", { clipId: last.id, targetTimelineStartSec: 0 })], { currentEditIR: before });
  const ir = res.editIR;
  assertInvariants(ir);
  assert.equal(ir.durationMs, before.durationMs, "duration unchanged");
  assert.deepEqual([ir.clips[0].sourceStartMs, ir.clips[0].sourceEndMs], [last.sourceStartMs, last.sourceEndMs]);
  assert.equal(ir.clips.length, before.clips.length);
  assert.equal(ir.captions.flatMap((c) => c.words).length, FIX.words.length, "no caption word lost");
  for (const cap of ir.captions) {
    for (const w of cap.words) {
      const ok = FIX.words.some((f) => f.text === w.text && Math.abs(srcToTimeline(ir, f.startMs)! - w.startMs) <= 2);
      assert.ok(ok, `caption word "${w.text}" at ${w.startMs}ms is on the footage that speaks it`);
    }
  }
  const noop = await turn("move", [tc("moveClip", { clipId: ir.clips[0].id, targetTimelineStartSec: 0 })], { currentEditIR: ir });
  assert.equal(noop.res.rejectedOperations.length, 1, "moving to where it already is is reported, not faked");
});

test("tool: reorderSegment moves an arbitrary range (clips split at its edges)", async () => {
  const { res } = await turn("put 10-14s first", [tc("reorderSegment", { segmentStartSec: 10, segmentDurationSec: 4, newStartSec: 0 })]);
  const ir = res.editIR;
  assertInvariants(ir);
  assert.deepEqual(ir.clips.map((c) => [c.sourceStartMs, c.sourceEndMs]), [[10000, 14000], [0, 10000], [14000, FIX.durationMs]]);
  assert.equal(ir.durationMs, FIX.durationMs);
});

test("tool: reorder combined with a cut in the same turn uses pre-cut times", async () => {
  const { res } = await turn("cut first 2s and put 10-14s first", [
    tc("removeRange", { startSec: 0, durationSec: 2, reason: "x" }),
    tc("reorderSegment", { segmentStartSec: 10, segmentDurationSec: 4, newStartSec: 2 }),
  ]);
  assertInvariants(res.editIR);
  assert.deepEqual(res.editIR.clips.map((c) => [c.sourceStartMs, c.sourceEndMs]), [[10000, 14000], [2000, 10000], [14000, FIX.durationMs]]);
});

test("tool: adjustVolume targets audio.originalTrack on mobile and rejects unknown tracks", async () => {
  const ok = await turn("voice a bit quieter", [tc("adjustVolume", { trackId: "original", volumeDb: -8 })]);
  assert.equal(ok.res.editIR.audio.originalTrack.volumeDb, -8);
  assert.equal(ok.res.appliedOperations.length, 1);
  assert.equal(ok.res.rejectedOperations.length, 0);
  assert.ok(ok.res.editIR.clips.every((c) => c.volumeDb === 0), "clip gains untouched");

  const bad = await turn("louder narrator", [tc("adjustVolume", { trackId: "narrator", volumeDb: 3 }), tc("adjustVolume", { trackId: "music", volumeDb: -20 })]);
  assert.equal(bad.res.appliedOperations.length, 0);
  assert.equal(bad.res.rejectedOperations.length, 2, "unknown track and missing music are rejected, not reported as done");
  assert.equal(bad.res.editIR.audio.originalTrack.volumeDb, 0);

  const music = await turn("music quieter", [tc("addBackgroundMusic", { query: "calm" }), tc("adjustVolume", { trackId: "music", volumeDb: -24 })]);
  assert.equal(music.res.editIR.audio.music[0].volumeDb, -24);
});

test("tool: rotateClip sets rotation/flip and refits the crop for the rotated frame", async () => {
  const { res } = await turn("rotate it", [tc("rotateClip", { clipId: "all", rotationDeg: 90 })]);
  const c = res.editIR.clips[0];
  assertInvariants(res.editIR);
  assert.equal(c.rotationDeg, 90);
  assert.equal(c.flipH, undefined);
  // 1920x1080 turned sideways is 1080x1920; filling a 16:9 canvas crops it vertically.
  assert.ok(c.crop && c.crop.width === 1 && Math.abs(c.crop.height - (1080 / 1920) / (1920 / 1080)) < 0.001);
  const flip = await turn("mirror it", [tc("rotateClip", { flipH: true })], { currentEditIR: res.editIR });
  assert.equal(flip.res.editIR.clips[0].flipH, true);
  assert.equal(flip.res.editIR.clips[0].rotationDeg, 90);
  const none = await turn("rotate", [tc("rotateClip", {})]);
  assert.equal(none.res.rejectedOperations.length, 1);
});

test("unicode: filler words are matched in non-Latin transcripts", async () => {
  const words = [
    { text: "Эээ,", startMs: 0, endMs: 400 },
    { text: "привет", startMs: 450, endMs: 800 },
    { text: "всем", startMs: 850, endMs: 1100 },
  ];
  const req = MobileAIDirectRequestSchema.parse({ prompt: "убери эээ", media: { durationMs: 2000, width: 1080, height: 1920, transcript: { words } } });
  const { client } = mockClient([{ text: "", toolCalls: [tc("cleanFillers", { fillerTypes: ["эээ"] })] }]);
  const res = await director.directMobile(req, { llmClient: client });
  assert.equal(res.rejectedOperations.length, 0);
  assert.equal(res.editIR.clips[0].sourceStartMs, 450, "the Cyrillic filler was cut");
});

// ---------------------------------------------------------------------------------------------
// WS5: brand- and script-conscious director
// ---------------------------------------------------------------------------------------------

/** A take with warm-up talk, the hook said twice (the second, complete take is best), then the body. */
function buildScriptFixture() {
  const parts: Array<string | number> = [
    400, "Okay is this recording, let me start again.", 700,
    "Stop doing cardio before", 600, // fluffed first take of the hook
    "Stop doing cardio before breakfast if you want muscle.", 500,
    "Most people burn their energy and skip the weights.", 450,
    "Lift first, then walk for twenty minutes.", 500,
    "Follow for the full plan.", 600,
  ];
  const words: W[] = [];
  let t = 0;
  for (const part of parts) {
    if (typeof part === "number") { t += part; continue; }
    for (const token of part.split(" ")) {
      words.push({ text: token, startMs: t, endMs: t + 280 });
      t += 320;
    }
    t -= 40;
  }
  return { words, durationMs: t };
}
const SFIX = buildScriptFixture();

const BRAND_CTX: DirectorContext = {
  warnings: [],
  brand: {
    projectId: "proj_1",
    name: "LiftLab",
    colors: { primary: "#111111", accent: "#FFC400", text: "#FFFFFF", background: "#000000" },
    logoUrl: "https://cdn.example.com/liftlab-logo.png",
    font: "Montserrat",
    captionStylePreset: "ALI_ABDAAL_CLEAN",
    watermarkEnabled: true,
    tone: "Energetic and bold",
    targetPlatforms: ["instagram"],
  },
  piece: {
    calendarPieceId: "piece_1",
    headline: "Stop doing cardio first",
    dayLabel: "Day 3",
    platform: "instagram",
    contentType: "reel",
    targetDurationSec: 30,
    ...parsePieceScript(JSON.stringify({
      teleprompterScript: {
        hook: "Stop doing cardio before breakfast if you want muscle.",
        problem: "Most people burn their energy and skip the weights.",
        solution: "Lift first, then walk for twenty minutes.",
        callToAction: "Follow for the full plan.",
        retentionLoop: "And the last step surprises everyone.",
      },
    })),
  },
};

function scriptRequest(extra: Record<string, any> = {}) {
  return MobileAIDirectRequestSchema.parse({
    media: { durationMs: SFIX.durationMs, width: 1920, height: 1080, fps: 30, transcript: { words: SFIX.words } },
    ...extra,
  });
}

function assertInvariantsLoose(ir: MobileEditIR) {
  MobileEditIRSchema.parse(ir);
  assert.equal(ir.clips[0].timelineStartMs, 0);
  for (let i = 1; i < ir.clips.length; i++) assert.equal(ir.clips[i].timelineStartMs, ir.clips[i - 1].timelineEndMs);
  assert.equal(ir.durationMs, ir.clips[ir.clips.length - 1].timelineEndMs);
}

test("brand: style defaults map brand colours, preset, pacing and warn on an unbundled font", () => {
  const s = brandStyleDefaults(BRAND_CTX.brand);
  assert.equal(s.highlightColor, "#FFC400");
  assert.equal(s.textColor, "#FFFFFF");
  assert.equal(s.captionPreset, "ALI_ABDAAL_CLEAN");
  assert.equal(s.fontFamily, "Inter");
  assert.equal(s.pacing, "fast");
  assert.match(s.warnings.join(" "), /Montserrat.*Inter/);
  // Dark text is unreadable on footage: it stays white. A near-black accent falls back to primary.
  const dark = brandStyleDefaults({ projectId: "p", colors: { primary: "#22CCFF", accent: "#050505", text: "#101010" } });
  assert.equal(dark.textColor, "#FFFFFF");
  assert.equal(dark.highlightColor, "#22CCFF");
});

test("brand: captions the creator did not colour get the brand colours (LLM and deterministic paths)", async () => {
  const { client, calls } = mockClient([{ text: "", toolCalls: [tc("autoCaptions", {}), finish("Added captions.")] }]);
  const res = await director.directMobile(scriptRequest({ prompt: "add captions", projectId: "proj_1" }), { llmClient: client, context: BRAND_CTX });
  assert.equal(res.intent, "edit");
  assert.ok(calls[0].prompt.includes("## Brand"), "brand section in the planner prompt");
  assert.ok(calls[0].prompt.includes("#FFC400"), "brand colour in the planner prompt");
  assert.ok(calls[0].prompt.includes("## Calendar piece"), "piece section in the planner prompt");
  // The fixture has no transcript: captions are not required (and are skipped honestly).
  for (const c of res.editIR.captions) {
    assert.equal(c.style.highlightColor, "#FFC400");
    assert.equal(c.style.preset, "ALI_ABDAAL_CLEAN");
    assert.equal(c.style.fontFamily, "Inter");
  }
  assert.ok(res.warnings.some((w) => /Montserrat/.test(w)));
  // An explicit colour wins over the brand.
  const red = await director.directMobile(scriptRequest({ prompt: "add red captions" }), { llmClient: null, context: BRAND_CTX });
  assert.equal(red.plannerSource, "deterministic");
  assert.notEqual(red.editIR.captions[0].style.highlightColor, "#FFC400");
  const det = await director.directMobile(scriptRequest({ prompt: "add captions" }), { llmClient: null, context: BRAND_CTX });
  assert.equal(det.editIR.captions[0].style.highlightColor, "#FFC400");
  assertInvariantsLoose(det.editIR);
});

test("script alignment: finds where the spoken hook starts, the repeated take and missing sections", () => {
  const a = alignScriptToTranscript(BRAND_CTX.piece!.sections, SFIX.words);
  const hookFirstWord = SFIX.words.findIndex((w, i) => w.text === "Stop" && SFIX.words[i + 4]?.text === "breakfast");
  assert.ok(hookFirstWord > 0);
  assert.equal(a.hookStartMs, SFIX.words[hookFirstWord].startMs, "hook = the complete take, not the fluffed one");
  assert.ok(a.preHookSpeechMs > 2000, "warm-up talk before the hook");
  const rep = a.repeatedTakes.find((r) => r.kind === "hook");
  assert.ok(rep && rep.takes.length === 2, "the hook was recorded twice");
  assert.equal(rep!.bestIndex, 1, "the complete second take is best");
  assert.deepEqual(a.missingSections, ["retention"]);
  assert.ok(a.sections.find((s) => s.kind === "cta")!.found);
  assert.ok(a.extraRanges.some((r) => /recording/i.test(r.text)), "warm-up is off-script");
});

test("greet: brand-aware proposal that requires confirmation, opens on the hook, logo watermark", async () => {
  const res = await director.directMobile(scriptRequest({ intent: "greet", calendarPieceId: "piece_1" }), { llmClient: null, context: BRAND_CTX });
  assert.equal(res.intent, "greet");
  assert.equal(res.requiresConfirmation, true);
  assert.equal(res.llmCalls, 0);
  assert.equal(res.plannerSource, "deterministic");
  assert.match(res.reply, /^Day 3 "Stop doing cardio first": I can /);
  assert.match(res.reply, /open on your hook/);
  assert.match(res.reply, /#FFC400/);
  assert.match(res.reply, /logo watermark/);
  assert.match(res.reply, /Apply\?/);
  assert.match(res.reply, /retention/, "missing script part is flagged");
  assert.ok(res.proposal && res.proposal.steps.length >= 4);
  assertInvariantsLoose(res.editIR);
  const a = res.scriptAlignment!;
  assert.ok(Math.abs(res.editIR.clips[0].sourceStartMs - a.hookStartMs!) <= 200, `first clip starts at the hook (${res.editIR.clips[0].sourceStartMs} vs ${a.hookStartMs})`);
  const fluff = a.repeatedTakes[0].takes[0];
  assert.ok(!res.editIR.clips.some((c) => c.sourceStartMs <= fluff.startMs + 10 && c.sourceEndMs >= fluff.endMs - 10), "fluffed take removed");
  assert.equal(res.editIR.canvas.aspect, "9:16", "reframed for Reels");
  assert.equal(res.editIR.captions[0].style.highlightColor, "#FFC400");
  assert.deepEqual(res.editIR.watermark, { imageUrl: "https://cdn.example.com/liftlab-logo.png", position: "top_right", opacityPct: 85, widthFraction: 0.14 });
  assert.equal(res.context?.brand?.highlightColor, "#FFC400");
  // An empty prompt with context is a greeting too; an empty prompt without context is invalid.
  assert.equal(MobileAIDirectRequestSchema.safeParse({ prompt: "", projectId: "p", media: { durationMs: 1000, width: 2, height: 2 } }).success, true);
  assert.equal(MobileAIDirectRequestSchema.safeParse({ prompt: "", media: { durationMs: 1000, width: 2, height: 2 } }).success, false);
});

test("watermark: round-trips, is removed on request, never invented without a logo", async () => {
  const g = await director.directMobile(scriptRequest({ intent: "greet" }), { llmClient: null, context: BRAND_CTX });
  assert.ok(g.editIR.watermark);
  MobileEditIRSchema.parse(g.editIR);
  const keep = await director.directMobile(scriptRequest({ prompt: "remove the pauses", currentEditIR: g.editIR }), { llmClient: null, context: BRAND_CTX });
  assert.deepEqual(keep.editIR.watermark, g.editIR.watermark, "kept across an unrelated edit");
  const rm = await director.directMobile(scriptRequest({ prompt: "remove the logo watermark", currentEditIR: g.editIR }), { llmClient: null, context: BRAND_CTX });
  assert.equal(rm.editIR.watermark, undefined);
  // finish_edit brandWatermark "add" from the LLM.
  const { client } = mockClient([{ text: "", toolCalls: [tc("removeSilences", {}), tc("finish_edit", { summary: "Tightened and added your logo.", brandWatermark: "add" })] }]);
  const add = await director.directMobile(scriptRequest({ prompt: "tighten it and brand it" }), { llmClient: client, context: BRAND_CTX });
  assert.ok(add.editIR.watermark, "LLM asked for the watermark");
  const noLogo = await director.directMobile(scriptRequest({ prompt: "add my logo" }), { llmClient: null, context: { ...BRAND_CTX, brand: { ...BRAND_CTX.brand!, logoUrl: null } } });
  assert.equal(noLogo.editIR.watermark, undefined);
  assert.ok(noLogo.warnings.some((w) => /no brand logo/.test(w)));
  assert.equal(MobileWatermarkSchema.safeParse({ imageUrl: "http://x.com/a.png", position: "top_left", opacityPct: 50, widthFraction: 0.1 }).success, false, "https only");
});

test("sub-agents: b-roll queries come from transcript entities and stock lookups respect the turn timeout", async () => {
  const q = extractBrollQueries(SFIX.words);
  assert.ok(q.length >= 1 && q.length <= 3);
  assert.ok(q.every((x) => x.atMs >= 3000), "never over the opening");
  const slow = (_q: string) => new Promise<string | null>((r) => setTimeout(() => r("https://videos.example.com/late.mp4"), 2000));
  const t0 = Date.now();
  const res = await director.directMobile(scriptRequest({ intent: "greet" }), { llmClient: null, context: BRAND_CTX, resolveStockVideo: slow, stockTimeoutMs: 150 });
  assert.ok(Date.now() - t0 < 1500, "the director did not wait for the slow stock provider");
  assert.ok(res.editIR.overlays.length >= 1);
  for (const o of res.editIR.overlays) assert.equal(o.source.kind, "stock_query");
  assert.ok(res.warnings.some((w) => /timed out|budget/.test(w)), res.warnings.join(" | "));
  // Music from the sound agent resolves from the catalogue to an HTTPS track.
  assert.equal(res.editIR.audio.music[0]?.source.kind, "url");
});

test("budget: the director never makes more than llmCallBudget LLM calls in a turn", async () => {
  const bad = tc("removeRange", { startSec: -5 }); // invalid -> would trigger a repair call
  const { client, calls } = mockClient([{ text: "", toolCalls: [bad] }, { text: "", toolCalls: [bad] }]);
  const res = await director.directMobile(scriptRequest({ prompt: "cut it" }), { llmClient: client, context: BRAND_CTX, llmCallBudget: 1 });
  assert.equal(calls.length, 1, "repair call blocked by the budget");
  assert.equal(res.llmCalls, 1);
  assert.equal(res.plannerSource, "deterministic");
  assert.match(res.plannerReason, /budget/);
});

test("face track: reframe crop and FACE zoom follow the dominant face, not the frame centre", async () => {
  // Speaker sits on the right third of a 16:9 frame; one outlier sample is ignored by the median.
  const faces = Array.from({ length: 20 }, (_, i) => ({ tMs: i * 500, x: i === 3 ? 0.2 : 0.72, y: 0.35, w: 0.12, h: 0.2 }));
  const { res } = await runLLM("reframe to vertical and zoom on me", [
    tc("reframeSubject", { targetAspect: "9:16" }),
    tc("addZoom", { startSec: 2, durationSec: 1.5, targetCoords: { x: 0.5, y: 0.38 }, scale: 1.3 }),
  ], { media: { durationMs: FIX.durationMs, width: 1920, height: 1080, fps: 30, transcript: { words: FIX.words }, faces } } as any);
  const ir = res.editIR;
  assertInvariants(ir);
  const crop = ir.clips[0].crop!;
  const cropCentre = crop.x + crop.width / 2;
  assert.ok(Math.abs(cropCentre - 0.72) < 0.01, `crop centred on the face (centre ${cropCentre})`);
  // The face is at the crop centre, so the FACE zoom lands near canvas x = 0.5 (not the source 0.72).
  const z = ir.zooms[0];
  assert.ok(z && Math.abs(z.centerX - 0.5) < 0.02 && Math.abs(z.centerY - 0.35) < 0.02, `zoom on the face (${z?.centerX}, ${z?.centerY})`);

  // Without faces the crop stays centred.
  const plain = await runLLM("reframe to vertical", [tc("reframeSubject", { targetAspect: "9:16" })]);
  const c2 = plain.res.editIR.clips[0].crop!;
  assert.ok(Math.abs(c2.x + c2.width / 2 - 0.5) < 0.01);
});

test("stock credits: b-roll resolver credit flows into warnings and result.credits", async () => {
  const { res } = await runLLM("add b-roll of the ocean at 2s", [tc("insertBroll", { stockQuery: "ocean waves", timelineStartSec: 2, durationSec: 2 })], {}, async () => ({
    url: "https://upload.wikimedia.org/x/Ocean.webm", title: "Ocean", license: "CC-BY-4.0", creditRequired: true,
    attribution: '"Ocean" by A (Wikimedia Commons), CC BY 4.0', sourcePage: "https://commons.wikimedia.org/wiki/File:Ocean.webm", provider: "wikimedia",
  }));
  assert.equal(res.editIR.overlays[0].source.url, "https://upload.wikimedia.org/x/Ocean.webm");
  assert.ok(res.warnings.some((w) => /Credit required when publishing: "Ocean" by A/.test(w)));
  assert.deepEqual(res.credits?.map((c) => [c.kind, c.url]), [["broll", "https://upload.wikimedia.org/x/Ocean.webm"]]);
});

// ---------------------------------------------------------------------------------------------
// Phase 1 (server): LLM timeout, brand rendering, SFX lane
// ---------------------------------------------------------------------------------------------

test("LLM timeout: a hung planner call becomes a labelled deterministic fallback", async () => {
  const hung: AIClient = {
    provider: "claude",
    generate: async () => { throw new Error("unused"); },
    generateStream: async () => { throw new Error("unused"); },
    generateWithTools: () => new Promise<ToolCallResponse>(() => {}),
  };
  const t0 = Date.now();
  const res = await director.directMobile(scriptRequest({ prompt: "remove the pauses" }), { llmClient: hung, llmTimeoutMs: 50 });
  assert.ok(Date.now() - t0 < 2000, "does not wait for the hung call");
  assert.equal(res.plannerSource, "deterministic");
  assert.match(res.plannerReason, /^LLM_TIMEOUT: LLM call \(claude/);
  assert.ok(res.warnings.some((w) => /AI planner timed out/.test(w)));
  assert.match(res.reply, /offline rule-based director/);
});

test("brand rendering: the style agent uses resolveBrandRendering values and names the defaults", async () => {
  const ctx: DirectorContext = {
    warnings: [],
    brand: {
      projectId: "proj_2",
      name: "Plain",
      colors: { primary: "#22CCFF" },
      logoUrl: "https://cdn.example.com/plain.png",
      rendering: {
        colors: { primary: "#22CCFF", accent: "#666666", background: "#FFFFFF", text: "#111111" },
        font: "Inter",
        captionStylePreset: "MINIMAL_SUBTITLE",
        watermarkEnabled: false,
        logoUrl: "https://cdn.example.com/plain.png",
        usedDefaults: ["colors.accent", "colors.background", "colors.text", "font", "captionStylePreset", "watermarkEnabled"],
      },
    },
  };
  const s = brandStyleDefaults(ctx.brand);
  assert.equal(s.highlightColor, "#22CCFF", "brand primary wins over the neutral accent default");
  assert.equal(s.captionPreset, "MINIMAL_SUBTITLE");
  assert.equal(s.watermark, false, "watermark default (off) comes from the rendering");
  const res = await director.directMobile(scriptRequest({ intent: "greet" }), { llmClient: null, context: ctx });
  assert.equal(res.editIR.watermark, undefined);
  assert.doesNotMatch(res.reply, /logo watermark/);
  assert.equal(res.context?.brand?.captionPreset, "MINIMAL_SUBTITLE");
  assert.ok(res.warnings.some((w) => /neutral render defaults.*not saved/.test(w)), "defaults are explicit");
  assert.equal(ctx.brand!.colors.accent, undefined, "the brand context is not modified");
});

test("sfx: the greet proposal places sound effects on an sfx lane with credits; omitted when none", async () => {
  const resolveSfx = async (q: string) => [
    { title: "Whoosh", url: "https://cdn.freesound.org/previews/1/whoosh.mp3", durationSec: 0.8, license: "CC BY 4.0", attribution: '"Whoosh" by A (CC BY 4.0)', query: q },
  ];
  const g = await director.directMobile(scriptRequest({ intent: "greet" }), { llmClient: null, context: BRAND_CTX, resolveSfx });
  MobileEditIRSchema.parse(g.editIR);
  const fx = g.editIR.audio.sfx!;
  assert.ok(fx && fx.length >= 1, "at least one effect placed");
  assert.equal(fx[0].source.url, "https://cdn.freesound.org/previews/1/whoosh.mp3");
  assert.equal(fx[0].credit, '"Whoosh" by A (CC BY 4.0)');
  assert.ok(fx.every((f) => f.timelineStartMs < g.editIR.durationMs && f.volumeDb === -12));
  assert.ok(g.credits?.some((c) => c.kind === "sfx"));
  assert.ok(g.proposal!.steps.some((s) => /sound effect/.test(s)));
  // Carried (with credit) through the next edit turn.
  const next = await director.directMobile(scriptRequest({ prompt: "make it black and white", currentEditIR: g.editIR }), { llmClient: null, context: BRAND_CTX });
  assert.equal(next.editIR.audio.sfx?.length, fx.length);
  assert.equal(next.editIR.audio.sfx![0].credit, fx[0].credit);
  // No SFX resolver: the field is omitted, so older clients see the same shape as before.
  const plain = await director.directMobile(scriptRequest({ intent: "greet" }), { llmClient: null, context: BRAND_CTX });
  assert.equal("sfx" in plain.editIR.audio, false);
});

test("coverage: requested features missing from a plan are detected (negations and impossible asks excluded)", () => {
  const ask = "Cut the pauses and filler words, add bold captions, a punch-in zoom, space B-roll, a sticker and calm music";
  assert.deepEqual(
    missingRequestedOperations(ask, ["removeSilences", "autoCaptions"], true).map((m) => m.split(" (")[0]),
    ["zoom / punch-in", "B-roll", "sticker", "background music", "filler-word removal"]
  );
  assert.deepEqual(missingRequestedOperations("add captions but no music please", ["autoCaptions"], true), []);
  assert.deepEqual(missingRequestedOperations("add captions", [], false), [], "captions without a transcript are not required");
  assert.deepEqual(missingRequestedOperations("remove the filler words", [], true).length, 1, "'remove fillers' is the ask itself");
});

test("coverage: a plan that stops after the cuts is sent back once and the completed plan is used", async () => {
  const { client, calls } = mockClient([
    { text: "", toolCalls: [tc("removeSilences", { minDurationSec: 0.5 }), finish("Removed pauses.")] },
    {
      text: "",
      toolCalls: [
        tc("removeSilences", { minDurationSec: 0.5 }),
        tc("autoCaptions", { highlightColor: "#FFE600" }),
        tc("addZoom", { startSec: 2, durationSec: 1, scale: 1.3, targetCoords: { x: 0.5, y: 0.4 } }),
        finish("Removed pauses, added captions and a zoom."),
      ],
    },
  ]);
  const res = await director.directMobile(mobileRequest("remove the pauses, add captions and a zoom"), { llmClient: client });
  assert.equal(calls.length, 2);
  assert.match(calls[1].prompt, /skipped part of the creator's request/);
  assert.ok(calls[1].prompt.includes("- zoom / punch-in"));
  assert.match(res.plannerReason, /completed 1 skipped request/);
  // The fixture has no transcript: captions are not required (and are skipped honestly).
  assert.equal(res.editIR.zooms.length, 1);
  assertInvariants(res.editIR);
});

test("cuts: two cuts that leave a 160 ms sliver between them cut the sliver too (no flash frame)", async () => {
  const { res } = await runLLM("cut the question and the pause", [
    tc("removeRange", { startSec: 2.0, durationSec: 2.0, ripple: true, reason: "question" }),
    tc("removeRange", { startSec: 4.16, durationSec: 1.84, ripple: true, reason: "off-topic tangent" }),
    finish("Cut the question and the pause."),
  ]);
  assertInvariants(res.editIR);
  const shortest = Math.min(...res.editIR.clips.map((c) => c.timelineEndMs - c.timelineStartMs));
  assert.ok(shortest >= 250, `no clip shorter than 250 ms (got ${shortest} ms)`);
  assert.equal(res.editIR.durationMs, FIX.durationMs - 4000);
});

test("captions: a word a cut pushed to the clip boundary is dropped, not drawn with zero length", async () => {
  const w = FIX.words[3];
  // Cut from just before word 3 to the middle of it: its tail survives as a sliver at the cut point.
  const cutStart = w.startMs / 1000 - 0.3;
  const { res } = await runLLM("captions and cut that", [
    tc("autoCaptions", { highlightColor: "#FFE600" }),
    tc("removeRange", { startSec: cutStart, durationSec: (w.startMs + (w.endMs - w.startMs) * 0.6) / 1000 - cutStart, ripple: true, reason: "cut" }),
    finish("Captions and a cut."),
  ]);
  assertInvariants(res.editIR);
  for (const c of res.editIR.captions) {
    for (const x of c.words) assert.ok(x.endMs > x.startMs, `word "${x.text}" has a real duration`);
    if (c.kind === "caption") assert.equal(c.text, c.words.map((x) => x.text).join(" "));
  }
});

test("stock budget starts at the first lookup: slow planning does not skip the B-roll search", async () => {
  // A real run: 10–55 s of LLM planning used up the 8 s stock budget, so every B-roll was left unresolved.
  const { client } = mockClient([{ text: "", toolCalls: [tc("insertBroll", { stockQuery: "gym", timelineStartSec: 5, durationSec: 3 }), finish("B-roll.")] }]);
  const slow: AIClient = { ...client, generateWithTools: async (p, t, o) => { await new Promise((r) => setTimeout(r, 120)); return client.generateWithTools!(p, t, o); } };
  const res = await director.directMobile(mobileRequest("put gym b-roll at 5s"), {
    llmClient: slow,
    stockTimeoutMs: 60,
    resolveStockVideo: async () => "https://videos.pexels.com/video-files/1/gym.mp4",
  });
  assert.ok(res.editIR.overlays.some((o) => (o.source as any).url === "https://videos.pexels.com/video-files/1/gym.mp4"), JSON.stringify(res.warnings));
});

test("a cut the model calls 'dead air' never removes spoken words (only the silence around them)", async () => {
  // A real run trimmed the speaker's first line as "dead air".
  const w = FIX.words;
  const start = Math.max(0, w[0].startMs / 1000 - 0.4);
  const end = w[5].endMs / 1000 + 0.3;
  const { res } = await runLLM("tighten the start", [tc("removeRange", { startSec: start, durationSec: end - start, ripple: true, reason: "initial dead air" }), finish("Removed dead air.")]);
  assertInvariants(res.editIR);
  for (const word of w.slice(0, 6)) {
    const mid = (word.startMs + word.endMs) / 2;
    assert.ok(res.editIR.clips.some((c) => c.sourceStartMs <= mid && mid < c.sourceEndMs), `word "${word.text}" is still in the edit`);
  }
  assert.ok(res.warnings.some((x) => /spoken word\(s\); only the silence/.test(x)));
});

test("a cut inside a title's time moves the title but keeps its length", async () => {
  // A real run: the opening cuts shrank a 2.5 s title to 0.6 s.
  const { res } = await runLLM("title and tighten", [
    tc("addText", { text: "Gym Truth", timelineStartSec: 0, durationSec: 2.5, position: { x: 0, y: -0.6 } }),
    tc("removeRange", { startSec: 0.5, durationSec: 1.2, ripple: true, reason: "off-topic tangent" }),
    finish("Title and a cut."),
  ]);
  const title = res.editIR.captions.find((c) => c.kind === "text")!;
  assert.equal(title.endMs - title.startMs, 2500);
  assertInvariants(res.editIR);
});

test("cleanFillers also cuts phrase fillers ('you know') next to um / uh", async () => {
  // A real run: the model called cleanFillers with the default list and four "you know"s stayed in.
  const words = [
    { text: "You", startMs: 500, endMs: 700 }, { text: "know,", startMs: 700, endMs: 900 },
    { text: "this", startMs: 1000, endMs: 1300 }, { text: "works", startMs: 1300, endMs: 1700 },
    ...FIX.words.filter((w) => w.startMs > 2500),
  ];
  const { res } = await runLLM("remove the filler words", [tc("cleanFillers", {}), finish("Cleaned fillers.")], {
    media: { durationMs: FIX.durationMs, width: 1920, height: 1080, fps: 30, transcript: { words } },
  } as any);
  assert.ok(res.appliedOperations.some((a) => /filler word "you know"/.test(a)), JSON.stringify(res.appliedOperations));
  assertInvariants(res.editIR);
});
