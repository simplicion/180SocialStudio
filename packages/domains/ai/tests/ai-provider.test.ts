/**
 * AI Director quality-fix plan, Phase 1: the provider layer with mocked SDKs (no network).
 * Run: npx tsx --test packages/domains/ai/tests/ai-provider.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  AgentMessage,
  AIProviderService,
  makeChatCompletionsClient,
  makeClaudeClient,
  makeGeminiClient,
  makeOpenAIClient,
  ProviderError,
  toGeminiSchema,
} from "../src/kernel/ai-provider.service";
import { clampMaxTokens, DIRECTOR_DEFAULTS, GENERAL_DEFAULTS, isRetiredModel, resolveModel, supportsTemperature } from "../src/kernel/model-config";
import { chooseAiProvider } from "../src/kernel/ai-company-config.service";

const TOOL = {
  type: "function",
  function: {
    name: "addZoom",
    description: "zoom",
    parameters: { type: "object", properties: { startSec: { type: "number" }, label: { type: ["string", "null"] }, kind: { const: "FACE" } }, required: ["startSec"], additionalProperties: false, $schema: "x" },
  },
};
const IMG = { type: "image" as const, mediaType: "image/jpeg" as const, data: "AAAA" };

class FakeStatusError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// ── model config ─────────────────────────────────────────────────────────────────────────────────

test("model resolution: director env > vault > default; general env > vault > default", () => {
  assert.equal(resolveModel("claude", "director", { env: {} }), DIRECTOR_DEFAULTS.claude);
  assert.equal(resolveModel("claude", "general", { env: {} }), GENERAL_DEFAULTS.claude);
  assert.equal(resolveModel("claude", "director", { env: { AI_DIRECTOR_MODEL_CLAUDE: "claude-x" } }), "claude-x");
  assert.equal(resolveModel("claude", "director", { env: { AI_DIRECTOR_CLAUDE_MODEL: "legacy-x" } }), "legacy-x", "legacy env name still works");
  assert.equal(resolveModel("openai", "general", { env: { AI_MODEL_OPENAI: "gpt-6-luna" } }), "gpt-6-luna");
  assert.equal(resolveModel("gemini", "director", { env: {}, vaultModels: { gemini: "gemini-3.6-flash" } }), "gemini-3.6-flash");
  assert.equal(resolveModel("anthropic", "director", { env: {} }), DIRECTOR_DEFAULTS.claude, "provider aliases");
});

test("retired IDs saved in the vault are ignored", () => {
  for (const m of ["claude-3-5-sonnet-20240620", "gemini-1.5-flash", "gemini-2.0-flash", "gemini-pro", "gpt-3.5-turbo", "gpt-4-turbo"]) {
    assert.ok(isRetiredModel(m), m);
  }
  for (const m of ["claude-opus-5-5", "gpt-4o", "gpt-6-astra", "gemini-3.8-flash"]) assert.ok(!isRetiredModel(m), m);
  assert.equal(resolveModel("claude", "general", { env: {}, vaultModels: { claude: "claude-3-5-sonnet-20241022" } }), GENERAL_DEFAULTS.claude);
  assert.ok(Object.values({ ...DIRECTOR_DEFAULTS, ...GENERAL_DEFAULTS }).every((m) => !isRetiredModel(m)), "no default is retired");
});

test("per-model request rules: temperature and output ceilings", () => {
  assert.equal(supportsTemperature("claude", "claude-opus-5-5"), false);
  assert.equal(supportsTemperature("claude", "claude-sonnet-5-5"), false);
  assert.equal(supportsTemperature("openai", "gpt-6-astra"), false);
  assert.equal(supportsTemperature("openai", "gpt-4o"), true);
  assert.equal(supportsTemperature("gemini", "gemini-3.8-flash"), false);
  assert.equal(clampMaxTokens("gemini", "gemini-3.8-flash", 999999), 65536);
  assert.equal(clampMaxTokens("claude", "claude-opus-5-5", 16000), 16000);
});

test("Director provider precedence: AI_DIRECTOR_PROVIDER, then the default, then Claude/OpenAI/Gemini", () => {
  const keys = (...p: string[]) => (x: string) => p.includes(x);
  assert.equal(chooseAiProvider({ purpose: "director", configured: "", director: "openai", hasKeyFor: keys("openai", "gemini") }), "openai");
  assert.equal(chooseAiProvider({ purpose: "director", configured: "gemini", director: "", hasKeyFor: keys("claude", "gemini") }), "gemini");
  assert.equal(chooseAiProvider({ purpose: "director", configured: "", director: "", hasKeyFor: keys("claude", "gemini") }), "claude", "Gemini is no longer first");
  assert.equal(chooseAiProvider({ purpose: "director", configured: "", director: "claude", hasKeyFor: keys("openai") }), "openai", "a director provider without a key falls through");
  // Everything else keeps its old order.
  assert.equal(chooseAiProvider({ configured: "", hasKeyFor: keys("claude", "gemini") }), "gemini");
  assert.equal(chooseAiProvider({ configured: "claude", hasKeyFor: keys("claude", "gemini") }), "claude");
});

test("getClient: the requested provider, else the first with a key (logged); purpose picks the model", async () => {
  const svc = AIProviderService.getInstance();
  const warn = console.warn;
  const logged: string[] = [];
  console.warn = (m: string) => logged.push(m);
  try {
    const c = await svc.getClient({ aiProvider: "gemini", claudeKey: "k" }, { purpose: "director" });
    assert.equal(c?.provider, "claude");
    assert.equal(c?.model, DIRECTOR_DEFAULTS.claude);
    assert.ok(logged.some((l) => /provider "gemini" has no key/.test(l)));
    const g = await svc.getClient({ aiProvider: "claude", claudeKey: "k" });
    assert.equal(g?.model, GENERAL_DEFAULTS.claude);
    assert.equal(await svc.getClient({ aiProvider: "claude" }), null);
  } finally {
    console.warn = warn;
  }
});

// ── Claude ───────────────────────────────────────────────────────────────────────────────────────

function fakeAnthropic(responses: any[]) {
  const calls: Array<{ body: any; opts: any }> = [];
  return {
    calls,
    sdk: {
      messages: {
        create: async (body: any, opts: any) => {
          calls.push({ body, opts });
          const r = responses.shift();
          if (r instanceof Error) throw r;
          return r;
        },
      },
    } as any,
  };
}

test("Claude: model, cached system prompt, effort and fallbacks are sent; temperature is not (Opus 5.5)", async () => {
  const { sdk, calls } = fakeAnthropic([
    { model: "claude-opus-5-5", stop_reason: "tool_use", content: [{ type: "thinking", thinking: "", signature: "s" }, { type: "text", text: "ok" }, { type: "tool_use", id: "tu1", name: "addZoom", input: { startSec: 2 } }] },
  ]);
  const c = makeClaudeClient("k", "claude-opus-5-5", sdk);
  const r = await c.generateWithTools!("plan this", [TOOL], { max_tokens: 16000, temperature: 0.2, effort: "medium", system: "persona" });
  const { body, opts } = calls[0];
  assert.equal(body.model, "claude-opus-5-5");
  assert.equal(body.temperature, undefined);
  assert.deepEqual(body.output_config, { effort: "medium" });
  assert.deepEqual(body.system, [{ type: "text", text: "persona", cache_control: { type: "ephemeral" } }]);
  assert.equal(body.tools[0].name, "addZoom");
  assert.ok(body.tools[0].input_schema.properties.startSec);
  assert.equal(body.tool_choice, undefined, "forced tool choice is a 400 on current models");
  assert.equal(body.fallbacks, "default");
  assert.equal(opts.headers["anthropic-beta"], "server-side-fallback-2026-07-01");
  assert.deepEqual(r.toolCalls, [{ id: "tu1", name: "addZoom", args: { startSec: 2 } }]);
  assert.equal(r.stopReason, "tool_use");
});

test("Claude: an explicit options.model wins over the client default", async () => {
  const { sdk, calls } = fakeAnthropic([{ model: "claude-sonnet-5-5", stop_reason: "end_turn", content: [{ type: "text", text: "hi" }] }]);
  await makeClaudeClient("k", "claude-opus-5-5", sdk).generate("hi", { model: "claude-sonnet-5-5" });
  assert.equal(calls[0].body.model, "claude-sonnet-5-5");
});

test("Claude: SDK errors and refusals throw a ProviderError (never an empty reply)", async () => {
  const { sdk } = fakeAnthropic([new FakeStatusError(404, "model: claude-x not found"), { stop_reason: "refusal", stop_details: { category: "cyber" }, content: [] }]);
  const c = makeClaudeClient("k", "claude-x", sdk);
  await assert.rejects(c.generateWithTools!("x", [TOOL]), (e: any) => e instanceof ProviderError && e.code === "not_found" && e.status === 404 && e.model === "claude-x" && /not found/.test(e.message));
  await assert.rejects(c.generate("x"), (e: any) => e instanceof ProviderError && e.code === "refusal" && /cyber/.test(e.message));
});

test("Claude agent turn: thinking blocks replayed verbatim, all tool results (with images) in one user message", async () => {
  const first = { model: "m", stop_reason: "tool_use", content: [{ type: "thinking", thinking: "", signature: "sig" }, { type: "tool_use", id: "a", name: "get_shots", input: {} }, { type: "tool_use", id: "b", name: "get_words", input: {} }] };
  const { sdk, calls } = fakeAnthropic([first, { model: "m", stop_reason: "end_turn", content: [{ type: "text", text: "done" }] }]);
  const c = makeClaudeClient("k", "claude-opus-5-5", sdk);
  const messages: AgentMessage[] = [{ role: "user", content: [{ type: "text", text: "look" }, IMG] }];
  const t1 = await c.generateAgentTurn!("sys", messages, [TOOL]);
  assert.equal(t1.toolCalls?.length, 2);
  messages.push(t1.assistantMessage, { role: "tool", results: [{ callId: "a", name: "get_shots", content: [{ type: "text", text: "shot 1" }, IMG] }, { callId: "b", name: "get_words", content: "nothing", isError: true }] });
  const t2 = await c.generateAgentTurn!("sys", messages, [TOOL]);
  assert.equal(t2.text, "done");
  const sent = calls[1].body.messages;
  assert.equal(sent[0].content[0].type, "image", "images before text");
  assert.deepEqual(sent[1].content, first.content, "assistant turn replayed exactly (thinking signature kept)");
  assert.equal(sent[2].role, "user");
  assert.equal(sent[2].content.length, 2, "both results in ONE message");
  assert.equal(sent[2].content[0].type, "tool_result");
  assert.equal(sent[2].content[0].tool_use_id, "a");
  assert.ok(sent[2].content[0].content.some((b: any) => b.type === "image" && b.source.data === "AAAA"));
  assert.equal(sent[2].content[1].is_error, true);
  assert.deepEqual(calls[1].body.system[0].text, "sys");
});

// ── OpenAI ───────────────────────────────────────────────────────────────────────────────────────

function fakeOpenAI(responses: any[]) {
  const calls: any[] = [];
  const next = (body: any) => {
    calls.push(body);
    const r = responses.shift();
    if (r instanceof Error) throw r;
    return r;
  };
  return { calls, sdk: { responses: { create: async (b: any) => next(b) }, chat: { completions: { create: async (b: any) => next(b) } } } };
}

test("OpenAI tools go through the Responses API: model, instructions, reasoning effort, no temperature", async () => {
  const { sdk, calls } = fakeOpenAI([
    { model: "gpt-6-astra", status: "completed", output: [{ type: "reasoning", id: "rs1", summary: [] }, { type: "function_call", call_id: "c1", name: "addZoom", arguments: '{"startSec":2}' }] },
  ]);
  const c = makeOpenAIClient("k", "gpt-6-astra", sdk);
  const r = await c.generateWithTools!("plan", [TOOL], { max_tokens: 16000, temperature: 0.2, effort: "high", system: "persona" });
  const body = calls[0];
  assert.equal(body.model, "gpt-6-astra");
  assert.equal(body.instructions, "persona");
  assert.deepEqual(body.reasoning, { effort: "high" });
  assert.equal(body.temperature, undefined);
  assert.equal(body.max_output_tokens, 16000);
  assert.equal(body.tools[0].type, "function");
  assert.equal(body.tools[0].name, "addZoom");
  assert.deepEqual(r.toolCalls, [{ id: "c1", name: "addZoom", args: { startSec: 2 } }]);
});

test("OpenAI: plain text on a reasoning model uses max_completion_tokens; errors keep their status", async () => {
  const { sdk, calls } = fakeOpenAI([{ choices: [{ message: { content: "hi" } }] }, new FakeStatusError(429, "Rate limit reached")]);
  const c = makeOpenAIClient("k", "gpt-6-astra", sdk);
  assert.equal(await c.generate("hi", { max_tokens: 100, system: "be brief" }), "hi");
  assert.equal(calls[0].max_completion_tokens, 100);
  assert.equal(calls[0].max_tokens, undefined);
  assert.equal(calls[0].messages[0].role, "system");
  await assert.rejects(c.generateWithTools!("x", [TOOL]), (e: any) => e instanceof ProviderError && e.code === "rate_limit" && e.provider === "openai");
});

test("OpenAI agent turn: output items (reasoning) replayed, function_call_output returned, images as data URLs", async () => {
  const out1 = [{ type: "reasoning", id: "rs1", summary: [] }, { type: "function_call", id: "fc1", call_id: "c1", name: "get_shots", arguments: "{}" }];
  const { sdk, calls } = fakeOpenAI([
    { model: "gpt-6-astra", output: out1 },
    { model: "gpt-6-astra", output: [{ type: "message", content: [{ type: "output_text", text: "done" }] }] },
  ]);
  const c = makeOpenAIClient("k", "gpt-6-astra", sdk);
  const messages: AgentMessage[] = [{ role: "user", content: [{ type: "text", text: "look" }, IMG] }];
  const t1 = await c.generateAgentTurn!("sys", messages, [TOOL]);
  messages.push(t1.assistantMessage, { role: "tool", results: [{ callId: "c1", name: "get_shots", content: "shot list" }] });
  const t2 = await c.generateAgentTurn!("sys", messages, [TOOL]);
  assert.equal(t2.text, "done");
  const input = calls[1].input;
  assert.deepEqual(input[0].content[1], { type: "input_image", image_url: "data:image/jpeg;base64,AAAA" });
  assert.deepEqual(input.slice(1, 3), out1, "reasoning + call replayed");
  assert.deepEqual(input[3], { type: "function_call_output", call_id: "c1", output: "shot list" });
});

test("OpenAI: a refusal is a ProviderError", async () => {
  const { sdk } = fakeOpenAI([{ output: [{ type: "message", content: [{ type: "refusal", refusal: "can't help" }] }] }]);
  await assert.rejects(makeOpenAIClient("k", "gpt-6-astra", sdk).generateWithTools!("x", [TOOL]), (e: any) => e.code === "refusal");
});

// ── Gemini ───────────────────────────────────────────────────────────────────────────────────────

function fakeGemini(responses: any[]) {
  const models: any[] = [];
  const requests: any[] = [];
  return {
    models,
    requests,
    sdk: {
      getGenerativeModel: (params: any) => {
        models.push(params);
        return {
          generateContent: async (req: any) => {
            requests.push(req);
            const r = responses.shift();
            if (r instanceof Error) throw r;
            return { response: r };
          },
        };
      },
    } as any,
  };
}

test("Gemini schema: unsupported JSON-Schema keys are removed, nullable / const translated", () => {
  const g = toGeminiSchema(TOOL.function.parameters);
  assert.equal(g.additionalProperties, undefined);
  assert.equal(g.$schema, undefined);
  assert.deepEqual(g.properties.label, { type: "string", nullable: true });
  assert.deepEqual(g.properties.kind, { type: "string", enum: ["FACE"] });
  assert.deepEqual(g.required, ["startSec"]);
});

test("Gemini: the configured model, system instruction, clamped tokens; errors are thrown, not {text:''}", async () => {
  const { sdk, models } = fakeGemini([
    { candidates: [{ finishReason: "STOP", content: { role: "model", parts: [{ functionCall: { name: "addZoom", args: { startSec: 2 } }, thoughtSignature: "ts" }] } }] },
    new FakeStatusError(400, "Invalid JSON payload"),
  ]);
  const c = makeGeminiClient("k", "gemini-3.8-flash", sdk);
  const r = await c.generateWithTools!("plan", [TOOL], { max_tokens: 999999, temperature: 0.2, system: "persona", model: "gemini-3.6-flash" });
  assert.equal(models[0].model, "gemini-3.6-flash", "options.model honoured");
  assert.equal(models[0].systemInstruction, "persona");
  assert.equal(models[0].generationConfig.maxOutputTokens, 65536);
  assert.equal(models[0].generationConfig.temperature, undefined, "Gemini 3 keeps its default temperature");
  assert.equal(models[0].tools[0].functionDeclarations[0].parameters.additionalProperties, undefined);
  assert.equal(r.toolCalls?.[0].name, "addZoom");
  await assert.rejects(c.generateWithTools!("x", [TOOL]), (e: any) => e instanceof ProviderError && e.code === "bad_request" && e.provider === "gemini");
});

test("Gemini agent turn: content with thought signatures replayed, functionResponse + inline images", async () => {
  const content1 = { role: "model", parts: [{ functionCall: { name: "get_shots", args: {} }, thoughtSignature: "ts1" }] };
  const { sdk, requests } = fakeGemini([
    { candidates: [{ finishReason: "STOP", content: content1 }] },
    { candidates: [{ finishReason: "STOP", content: { role: "model", parts: [{ text: "done" }] } }] },
  ]);
  const c = makeGeminiClient("k", "gemini-3.8-flash", sdk);
  const messages: AgentMessage[] = [{ role: "user", content: "look" }];
  const t1 = await c.generateAgentTurn!("sys", messages, [TOOL]);
  messages.push(t1.assistantMessage, { role: "tool", results: [{ callId: t1.toolCalls![0].id!, name: "get_shots", content: [{ type: "text", text: "shot 1" }, IMG] }] });
  const t2 = await c.generateAgentTurn!("sys", messages, [TOOL]);
  assert.equal(t2.text, "done");
  const contents = requests[1].contents;
  assert.deepEqual(contents[1], content1, "model turn replayed with its thought signature");
  assert.deepEqual(contents[2].parts[0], { functionResponse: { name: "get_shots", response: { content: "shot 1" } } });
  assert.deepEqual(contents[2].parts[1], { inlineData: { mimeType: "image/jpeg", data: "AAAA" } });
});

test("Gemini: a safety block is a refusal", async () => {
  const { sdk } = fakeGemini([{ promptFeedback: { blockReason: "SAFETY" }, candidates: [] }]);
  await assert.rejects(makeGeminiClient("k", "gemini-3.8-flash", sdk).generate("x"), (e: any) => e.code === "refusal");
});

// ── OpenAI-compatible (Groq / custom) ────────────────────────────────────────────────────────────

test("chat-completions agent turn: system message, tool messages, images follow as a user message", async () => {
  const calls: any[] = [];
  const responses = [
    { choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: "t1", function: { name: "get_shots", arguments: "{}" } }] } }] },
    { choices: [{ finish_reason: "stop", message: { content: "done" } }] },
  ];
  const sdk: any = { chat: { completions: { create: async (b: any) => (calls.push(b), responses.shift()) } } };
  const c = makeChatCompletionsClient("groq", sdk, "llama-3.3-70b-versatile");
  const messages: AgentMessage[] = [{ role: "user", content: "look" }];
  const t1 = await c.generateAgentTurn!("sys", messages, [TOOL]);
  messages.push(t1.assistantMessage, { role: "tool", results: [{ callId: "t1", name: "get_shots", content: [{ type: "text", text: "s" }, IMG] }] });
  await c.generateAgentTurn!("sys", messages, [TOOL]);
  const m = calls[1].messages;
  assert.equal(m[0].role, "system");
  assert.equal(m[2].tool_calls[0].function.name, "get_shots");
  assert.deepEqual(m[3], { role: "tool", tool_call_id: "t1", content: "s" });
  assert.equal(m[4].role, "user");
  assert.equal(m[4].content[0].type, "image_url");
});

// ── Director wiring ──────────────────────────────────────────────────────────────────────────────

test("the Director sends persona + rules as the system prompt, with effort and the Director model", async () => {
  const { VideoAIDirectorService } = await import("../src/builders/video-ai-director.service");
  const { MobileAIDirectRequestSchema } = await import("@workspace/video-contracts");
  const seen: any[] = [];
  const client: any = {
    provider: "claude",
    generate: async () => "",
    generateStream: async () => "",
    generateWithTools: async (prompt: string, _tools: any[], options: any) => {
      seen.push({ prompt, options });
      return { text: "", toolCalls: [{ id: "1", name: "removeSilences", args: { minDurationSec: 0.5 } }, { id: "2", name: "finish_edit", args: { summary: "ok" } }] };
    },
  };
  const info = console.info;
  console.info = () => {};
  try {
    const words = "hello there this is a test".split(" ").map((text, i) => ({ text, startMs: 200 + i * 400, endMs: 500 + i * 400 }));
    await VideoAIDirectorService.getInstance().directMobile(
      MobileAIDirectRequestSchema.parse({ prompt: "remove the pauses", media: { durationMs: 5000, width: 1080, height: 1920, transcript: { words } } }),
      { llmClient: client }
    );
  } finally {
    console.info = info;
  }
  const plan = seen.find((s) => s.options?.system);
  assert.ok(plan, "a planning call with a system prompt");
  assert.match(plan.options.system, /You do not see the video's frames/);
  assert.match(plan.options.system, /The most important rule/);
  assert.ok(!plan.prompt.includes("The most important rule"), "rules are not repeated in the user message");
  assert.match(plan.prompt, /remove the pauses/);
  assert.equal(plan.options.effort, "medium");
  assert.equal(plan.options.model, DIRECTOR_DEFAULTS.claude);
});
