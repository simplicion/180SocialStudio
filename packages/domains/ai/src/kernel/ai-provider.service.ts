import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import {
    clampMaxTokens,
    GENERAL_DEFAULTS,
    isOpenAIReasoningModel,
    ModelPurpose,
    resolveModel,
    supportsClaudeEffort,
    supportsClaudeFallbacks,
    supportsTemperature,
    VaultModels,
} from './model-config';

export interface AISettings {
    aiProvider: 'gemini' | 'openai' | 'claude' | 'groq' | 'cartesia' | 'custom' | string;
    geminiKey?: string;
    openaiKey?: string;
    claudeKey?: string;
    groqKey?: string;
    cartesiaKey?: string;
    customAiKey?: string;
    customAiUrl?: string;
    customAiModel?: string;
    /** Per-provider model saved in the Super Admin vault (explicit choices only). */
    models?: VaultModels;
}

export interface ToolCall {
    id?: string;
    name: string;
    args: Record<string, any>;
}

export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'other';

export interface ToolCallResponse {
    text: string;
    toolCalls?: ToolCall[];
    /** Why the model stopped (absent from older/mocked clients). `max_tokens` = the answer may be cut off. */
    stopReason?: StopReason;
    /** The model that answered. */
    model?: string;
}

export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** Options every client method understands. Unknown or unsupported fields are dropped per model, never sent blind. */
export interface GenerateOptions {
    model?: string;
    max_tokens?: number;
    /** Sent only to models that accept it (see model-config `supportsTemperature`). */
    temperature?: number;
    /** System prompt (persona + rules), kept apart from the user content and cached where the provider supports it. */
    system?: string;
    /** Thinking / reasoning depth on models that support it (Claude effort, OpenAI reasoning.effort). */
    effort?: ReasoningEffort;
    /** Request timeout in ms (the SDK's own; callers may also race their own timer). */
    timeoutMs?: number;
    [k: string]: any;
}

// ─── Agent turns (multi-turn tool use with images) ───────────────────────────────────────────────

export type AgentContentPart =
    | { type: 'text'; text: string }
    | { type: 'image'; mediaType: 'image/jpeg' | 'image/png' | 'image/webp'; data: string };

export type AgentMessage =
    | { role: 'user'; content: string | AgentContentPart[] }
    | {
          role: 'assistant';
          text?: string;
          toolCalls?: ToolCall[];
          /**
           * The provider's own copy of this turn (Claude content blocks with thinking, OpenAI output items with reasoning,
           * Gemini content with thought signatures). Replayed verbatim to the same provider, as each one requires.
           */
          raw?: { provider: string; data: unknown };
      }
    | { role: 'tool'; results: Array<{ callId: string; name: string; content: string | AgentContentPart[]; isError?: boolean }> };

export interface AgentTurnResponse extends ToolCallResponse {
    stopReason: StopReason;
    /** Append this to the message list before the tool results of the next turn. */
    assistantMessage: Extract<AgentMessage, { role: 'assistant' }>;
    usage?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number };
}

export interface AIClient {
    provider: string;
    /** The model this client uses when a call does not name one. */
    model?: string;
    generate: (prompt: string, options?: GenerateOptions) => Promise<string>;
    generateStream: (prompt: string, options?: GenerateOptions, onChunk?: (chunk: string) => void) => Promise<string>;
    generateWithTools?: (prompt: string, tools: any[], options?: GenerateOptions) => Promise<ToolCallResponse>;
    /** One model turn over a full conversation (system, user, assistant tool calls, tool results, images). */
    generateAgentTurn?: (system: string, messages: AgentMessage[], tools: any[], options?: GenerateOptions) => Promise<AgentTurnResponse>;
}

// ─── Errors ──────────────────────────────────────────────────────────────────────────────────────

export type ProviderErrorCode =
    | 'auth'
    | 'permission'
    | 'not_found'
    | 'rate_limit'
    | 'bad_request'
    | 'overloaded'
    | 'timeout'
    | 'network'
    | 'refusal'
    | 'unknown';

/** Every provider failure, with provider, model and the provider's own message. Never swallowed into an empty reply. */
export class ProviderError extends Error {
    readonly provider: string;
    readonly model: string;
    readonly code: ProviderErrorCode;
    readonly status?: number;
    constructor(params: { provider: string; model: string; code: ProviderErrorCode; message: string; status?: number; cause?: unknown }) {
        super(`${params.provider}/${params.model}: ${params.code}${params.status ? ` ${params.status}` : ''}: ${params.message}`);
        this.name = 'ProviderError';
        this.provider = params.provider;
        this.model = params.model;
        this.code = params.code;
        this.status = params.status;
        if (params.cause !== undefined) (this as any).cause = params.cause;
    }
}

function codeForStatus(status?: number): ProviderErrorCode {
    if (!status) return 'unknown';
    if (status === 400 || status === 413 || status === 422) return 'bad_request';
    if (status === 401) return 'auth';
    if (status === 403) return 'permission';
    if (status === 404) return 'not_found';
    if (status === 408) return 'timeout';
    if (status === 429) return 'rate_limit';
    if (status >= 500) return 'overloaded';
    return 'unknown';
}

/** Wraps any SDK error into a ProviderError (status from the SDK's typed error, never from message text). */
export function toProviderError(provider: string, model: string, err: any): ProviderError {
    if (err instanceof ProviderError) return err;
    const status: number | undefined = typeof err?.status === 'number' ? err.status : typeof err?.response?.status === 'number' ? err.response.status : undefined;
    let code = codeForStatus(status);
    if (!status) {
        if (err?.name === 'APIConnectionTimeoutError' || err?.name === 'AbortError' || err?.code === 'ETIMEDOUT') code = 'timeout';
        else if (err?.name === 'APIConnectionError' || ['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN'].includes(err?.code) || err?.cause?.code) code = 'network';
    }
    const message = String(err?.error?.error?.message || err?.error?.message || err?.message || err).slice(0, 500);
    return new ProviderError({ provider, model, code, status, message, cause: err });
}

// ─── Shared helpers ──────────────────────────────────────────────────────────────────────────────

type ToolDef = { name: string; description?: string; parameters: any };

/** Accepts OpenAI-style `{type:'function', function:{...}}` or plain `{name, description, parameters}`. */
function normalizeTools(tools: any[] = []): ToolDef[] {
    return (tools || []).map((t: any) => ({
        name: t.function?.name || t.name,
        description: t.function?.description || t.description,
        parameters: t.function?.parameters || t.parameters || t.input_schema || { type: 'object', properties: {} },
    }));
}

function safeJson(s: unknown): Record<string, any> {
    if (s && typeof s === 'object') return s as Record<string, any>;
    if (typeof s !== 'string' || !s.trim()) return {};
    try {
        const v = JSON.parse(s);
        return v && typeof v === 'object' ? v : {};
    } catch {
        return {};
    }
}

const partsOf = (c: string | AgentContentPart[]): AgentContentPart[] => (typeof c === 'string' ? [{ type: 'text', text: c }] : c);
const textOf = (c: string | AgentContentPart[]): string =>
    partsOf(c)
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join('\n');

const GEMINI_SCHEMA_KEYS = new Set([
    'type', 'format', 'description', 'nullable', 'enum', 'maxItems', 'minItems', 'properties', 'required', 'items',
    'anyOf', 'minimum', 'maximum', 'minLength', 'maxLength', 'pattern', 'title', 'propertyOrdering',
]);

/** JSON Schema → the OpenAPI subset Gemini function declarations accept (unknown keys are a 400 there). */
export function toGeminiSchema(schema: any): any {
    if (!schema || typeof schema !== 'object') return schema;
    if (Array.isArray(schema)) return schema.map(toGeminiSchema);
    const out: any = {};
    let type = schema.type;
    if (Array.isArray(type)) {
        const nonNull = type.filter((t: string) => t !== 'null');
        if (nonNull.length < type.length) out.nullable = true;
        type = nonNull[0];
    }
    if (type) out.type = type;
    if (schema.const !== undefined) {
        out.enum = [String(schema.const)];
        if (!out.type) out.type = 'string';
    }
    for (const [k, v] of Object.entries(schema)) {
        if (k === 'type' || k === 'const' || !GEMINI_SCHEMA_KEYS.has(k)) continue;
        if (k === 'properties' && v && typeof v === 'object') {
            out.properties = Object.fromEntries(Object.entries(v as any).map(([pk, pv]) => [pk, toGeminiSchema(pv)]));
        } else if (k === 'items') out.items = toGeminiSchema(v);
        else if (k === 'anyOf' && Array.isArray(v)) {
            const opts = v.filter((x: any) => x?.type !== 'null');
            if (opts.length < v.length) out.nullable = true;
            if (opts.length === 1) Object.assign(out, toGeminiSchema(opts[0]));
            else out.anyOf = opts.map(toGeminiSchema);
        } else if (k === 'enum' && Array.isArray(v)) out.enum = v.filter((x) => x !== null).map(String);
        else out[k] = v;
    }
    if (out.type === 'object' && !out.properties) out.properties = {};
    return out;
}

// ─── Claude ──────────────────────────────────────────────────────────────────────────────────────

function claudeContent(parts: AgentContentPart[]): any[] {
    // Images first, then the text (Anthropic's recommended order).
    const images = parts.filter((p) => p.type === 'image').map((p: any) => ({ type: 'image', source: { type: 'base64', media_type: p.mediaType, data: p.data } }));
    const texts = parts.filter((p) => p.type === 'text').map((p: any) => ({ type: 'text', text: p.text }));
    return [...images, ...texts];
}

export function toClaudeMessages(messages: AgentMessage[]): any[] {
    const out: any[] = [];
    for (const m of messages) {
        if (m.role === 'user') out.push({ role: 'user', content: claudeContent(partsOf(m.content)) });
        else if (m.role === 'assistant') {
            if (m.raw?.provider === 'claude' && Array.isArray(m.raw.data)) out.push({ role: 'assistant', content: m.raw.data });
            else {
                const content: any[] = [];
                if (m.text) content.push({ type: 'text', text: m.text });
                for (const tc of m.toolCalls || []) content.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.args || {} });
                out.push({ role: 'assistant', content });
            }
        } else {
            // All results of one turn go back in ONE user message (splitting them teaches the model to stop calling in parallel).
            out.push({
                role: 'user',
                content: m.results.map((r) => ({
                    type: 'tool_result',
                    tool_use_id: r.callId,
                    content: claudeContent(partsOf(r.content)),
                    ...(r.isError ? { is_error: true } : {}),
                })),
            });
        }
    }
    return out;
}

/** Claude client. `sdk` is injectable for tests. */
export function makeClaudeClient(key: string, defaultModel: string, sdk?: Pick<Anthropic, 'messages'>): AIClient {
    const anthropic = sdk ?? new Anthropic({ apiKey: key });

    const request = async (messages: any[], tools: ToolDef[], options: GenerateOptions) => {
        const model = options.model || defaultModel;
        const body: any = {
            model,
            max_tokens: clampMaxTokens('claude', model, options.max_tokens, 4096),
            messages,
        };
        // System prompt as a cached block: tools + system render first, so this breakpoint caches both.
        if (options.system) body.system = [{ type: 'text', text: options.system, cache_control: { type: 'ephemeral' } }];
        if (tools.length) body.tools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
        if (options.temperature !== undefined && supportsTemperature('claude', model)) body.temperature = options.temperature;
        if (options.effort && supportsClaudeEffort(model)) body.output_config = { effort: options.effort };
        const headers: Record<string, string> = {};
        // Server-side refusal fallback: a declined request is re-run on a fallback model inside the same call.
        if (supportsClaudeFallbacks(model) && process.env.AI_CLAUDE_FALLBACKS !== '0') {
            body.fallbacks = 'default';
            headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
        }
        let msg: any;
        try {
            msg = await anthropic.messages.create(body, { headers, timeout: options.timeoutMs ?? 10 * 60 * 1000 });
        } catch (err) {
            throw toProviderError('claude', model, err);
        }
        if (msg?.stop_reason === 'refusal') {
            const d = msg.stop_details;
            throw new ProviderError({ provider: 'claude', model, code: 'refusal', message: `declined${d?.category ? ` (${d.category})` : ''}${d?.explanation ? `: ${d.explanation}` : ''}` });
        }
        return { msg, model: msg?.model || model };
    };

    const parse = (msg: any, model: string): AgentTurnResponse => {
        const content: any[] = Array.isArray(msg?.content) ? msg.content : [];
        const text = content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
        const toolCalls: ToolCall[] = content.filter((c) => c.type === 'tool_use').map((c) => ({ id: c.id, name: c.name, args: c.input || {} }));
        const stopReason: StopReason = msg?.stop_reason === 'tool_use' ? 'tool_use' : msg?.stop_reason === 'max_tokens' ? 'max_tokens' : msg?.stop_reason === 'end_turn' ? 'end_turn' : 'other';
        return {
            text,
            toolCalls: toolCalls.length ? toolCalls : undefined,
            stopReason,
            model,
            assistantMessage: { role: 'assistant', text, toolCalls, raw: { provider: 'claude', data: content } },
            usage: { inputTokens: msg?.usage?.input_tokens, outputTokens: msg?.usage?.output_tokens, cacheReadTokens: msg?.usage?.cache_read_input_tokens },
        };
    };

    const single = (prompt: string) => [{ role: 'user', content: prompt }];

    return {
        provider: 'claude',
        model: defaultModel,
        generate: async (prompt, options = {}) => {
            const { msg, model } = await request(single(prompt), [], options);
            return parse(msg, model).text;
        },
        // The SDK in use predates thinking-block streaming; one call, then the text is handed over.
        generateStream: async (prompt, options = {}, onChunk) => {
            const { msg, model } = await request(single(prompt), [], options);
            const text = parse(msg, model).text;
            if (onChunk && text) onChunk(text);
            return text;
        },
        generateWithTools: async (prompt, tools = [], options = {}) => {
            const { msg, model } = await request(single(prompt), normalizeTools(tools), options);
            const r = parse(msg, model);
            return { text: r.text, toolCalls: r.toolCalls, stopReason: r.stopReason, model };
        },
        generateAgentTurn: async (system, messages, tools = [], options = {}) => {
            const { msg, model } = await request(toClaudeMessages(messages), normalizeTools(tools), { ...options, system: system || options.system });
            return parse(msg, model);
        },
    };
}

// ─── OpenAI (Responses API for tools; chat completions for plain text) ───────────────────────────

const dataUrl = (p: { mediaType: string; data: string }) => `data:${p.mediaType};base64,${p.data}`;

export function toOpenAIResponsesInput(messages: AgentMessage[]): any[] {
    const out: any[] = [];
    for (const m of messages) {
        if (m.role === 'user') {
            out.push({
                role: 'user',
                content: partsOf(m.content).map((p) => (p.type === 'text' ? { type: 'input_text', text: p.text } : { type: 'input_image', image_url: dataUrl(p) })),
            });
        } else if (m.role === 'assistant') {
            // Reasoning items must go back with the function calls they produced: replay the output items verbatim.
            if (m.raw?.provider === 'openai' && Array.isArray(m.raw.data)) out.push(...(m.raw.data as any[]));
            else {
                if (m.text) out.push({ role: 'assistant', content: m.text });
                for (const tc of m.toolCalls || []) out.push({ type: 'function_call', call_id: tc.id, name: tc.name, arguments: JSON.stringify(tc.args || {}) });
            }
        } else {
            for (const r of m.results) {
                const parts = partsOf(r.content);
                const hasImage = parts.some((p) => p.type === 'image');
                out.push({
                    type: 'function_call_output',
                    call_id: r.callId,
                    output: hasImage
                        ? parts.map((p) => (p.type === 'text' ? { type: 'input_text', text: p.text } : { type: 'input_image', image_url: dataUrl(p) }))
                        : `${r.isError ? 'ERROR: ' : ''}${textOf(r.content)}`,
                });
            }
        }
    }
    return out;
}

/** OpenAI client. `sdk` is injectable for tests. */
export function makeOpenAIClient(key: string, defaultModel: string, sdk?: any): AIClient {
    const openai: OpenAI = sdk ?? new OpenAI({ apiKey: key });

    const chatBody = (prompt: string, options: GenerateOptions, model: string) => {
        const body: any = { model, messages: [...(options.system ? [{ role: 'system', content: options.system }] : []), { role: 'user', content: prompt }] };
        const reasoning = isOpenAIReasoningModel(model);
        if (options.max_tokens) body[reasoning ? 'max_completion_tokens' : 'max_tokens'] = clampMaxTokens('openai', model, options.max_tokens);
        if (supportsTemperature('openai', model)) body.temperature = options.temperature ?? 0.7;
        if (reasoning && options.effort) body.reasoning_effort = options.effort;
        return body;
    };

    const responses = async (input: any[], tools: ToolDef[], options: GenerateOptions): Promise<AgentTurnResponse> => {
        const model = options.model || defaultModel;
        const body: any = { model, input, max_output_tokens: clampMaxTokens('openai', model, options.max_tokens, 4096) };
        if (options.system) body.instructions = options.system;
        if (tools.length) body.tools = tools.map((t) => ({ type: 'function', name: t.name, description: t.description, parameters: t.parameters, strict: false }));
        if (options.temperature !== undefined && supportsTemperature('openai', model)) body.temperature = options.temperature;
        if (options.effort && isOpenAIReasoningModel(model)) body.reasoning = { effort: options.effort };
        let r: any;
        try {
            r = await (openai as any).responses.create(body, { timeout: options.timeoutMs ?? 10 * 60 * 1000 });
        } catch (err) {
            throw toProviderError('openai', model, err);
        }
        const output: any[] = Array.isArray(r?.output) ? r.output : [];
        const messages = output.filter((o) => o.type === 'message');
        const refusal = messages.flatMap((o) => o.content || []).find((c: any) => c.type === 'refusal');
        if (refusal) throw new ProviderError({ provider: 'openai', model, code: 'refusal', message: `declined: ${String(refusal.refusal || '').slice(0, 300)}` });
        const text = messages.flatMap((o) => o.content || []).filter((c: any) => c.type === 'output_text').map((c: any) => c.text).join('\n');
        const toolCalls: ToolCall[] = output.filter((o) => o.type === 'function_call').map((o) => ({ id: o.call_id, name: o.name, args: safeJson(o.arguments) }));
        const stopReason: StopReason =
            r?.status === 'incomplete' && r?.incomplete_details?.reason === 'max_output_tokens' ? 'max_tokens' : toolCalls.length ? 'tool_use' : 'end_turn';
        return {
            text,
            toolCalls: toolCalls.length ? toolCalls : undefined,
            stopReason,
            model: r?.model || model,
            assistantMessage: { role: 'assistant', text, toolCalls, raw: { provider: 'openai', data: output } },
            usage: { inputTokens: r?.usage?.input_tokens, outputTokens: r?.usage?.output_tokens, cacheReadTokens: r?.usage?.input_tokens_details?.cached_tokens },
        };
    };

    return {
        provider: 'openai',
        model: defaultModel,
        generate: async (prompt, options = {}) => {
            const model = options.model || defaultModel;
            try {
                const completion = await openai.chat.completions.create(chatBody(prompt, options, model));
                return completion.choices[0]?.message?.content || '';
            } catch (err) {
                throw toProviderError('openai', model, err);
            }
        },
        generateStream: async (prompt, options = {}, onChunk) => {
            const model = options.model || defaultModel;
            try {
                const stream = await openai.chat.completions.create({ ...chatBody(prompt, options, model), stream: true });
                let text = '';
                for await (const chunk of stream as any) {
                    const content = chunk.choices[0]?.delta?.content || '';
                    text += content;
                    if (onChunk && content) onChunk(content);
                }
                return text;
            } catch (err) {
                throw toProviderError('openai', model, err);
            }
        },
        generateWithTools: async (prompt, tools = [], options = {}) => {
            const r = await responses([{ role: 'user', content: prompt }], normalizeTools(tools), options);
            return { text: r.text, toolCalls: r.toolCalls, stopReason: r.stopReason, model: r.model };
        },
        generateAgentTurn: async (system, messages, tools = [], options = {}) =>
            responses(toOpenAIResponsesInput(messages), normalizeTools(tools), { ...options, system: system || options.system }),
    };
}

// ─── Gemini ──────────────────────────────────────────────────────────────────────────────────────

export function toGeminiContents(messages: AgentMessage[]): any[] {
    const out: any[] = [];
    const partOf = (p: AgentContentPart) => (p.type === 'text' ? { text: p.text } : { inlineData: { mimeType: p.mediaType, data: p.data } });
    for (const m of messages) {
        if (m.role === 'user') out.push({ role: 'user', parts: partsOf(m.content).map(partOf) });
        else if (m.role === 'assistant') {
            // Gemini 3 requires the thought signatures on its function-call parts back: replay the content verbatim.
            if (m.raw?.provider === 'gemini' && m.raw.data && typeof m.raw.data === 'object') out.push(m.raw.data);
            else {
                const parts: any[] = [];
                if (m.text) parts.push({ text: m.text });
                for (const tc of m.toolCalls || []) parts.push({ functionCall: { name: tc.name, args: tc.args || {} } });
                out.push({ role: 'model', parts });
            }
        } else {
            const parts: any[] = [];
            const images: any[] = [];
            for (const r of m.results) {
                parts.push({ functionResponse: { name: r.name, response: { [r.isError ? 'error' : 'content']: textOf(r.content) } } });
                for (const p of partsOf(r.content)) if (p.type === 'image') images.push(partOf(p));
            }
            out.push({ role: 'user', parts: [...parts, ...images] });
        }
    }
    return out;
}

/** Gemini client. `sdk` (a GoogleGenerativeAI-like object) is injectable for tests. */
export function makeGeminiClient(key: string, defaultModel: string, sdk?: Pick<GoogleGenerativeAI, 'getGenerativeModel'>): AIClient {
    const genAI = sdk ?? new GoogleGenerativeAI(key);

    const call = async (contents: any[], tools: ToolDef[], options: GenerateOptions): Promise<AgentTurnResponse> => {
        const model = options.model || defaultModel;
        const generationConfig: any = { maxOutputTokens: clampMaxTokens('gemini', model, options.max_tokens, 8192) };
        if (options.temperature !== undefined && supportsTemperature('gemini', model)) generationConfig.temperature = options.temperature;
        const functionDeclarations = tools.map((t) => ({ name: t.name, description: t.description, parameters: toGeminiSchema(t.parameters) }));
        let response: any;
        try {
            const m = genAI.getGenerativeModel(
                {
                    model,
                    ...(options.system ? { systemInstruction: options.system } : {}),
                    ...(functionDeclarations.length ? { tools: [{ functionDeclarations }] as any } : {}),
                    generationConfig,
                },
                options.timeoutMs ? { timeout: options.timeoutMs } : undefined
            );
            response = (await m.generateContent({ contents })).response;
        } catch (err) {
            throw toProviderError('gemini', model, err);
        }
        const block = response?.promptFeedback?.blockReason;
        const cand = response?.candidates?.[0];
        if (block || cand?.finishReason === 'SAFETY' || cand?.finishReason === 'PROHIBITED_CONTENT') {
            throw new ProviderError({ provider: 'gemini', model, code: 'refusal', message: `declined (${block || cand?.finishReason})` });
        }
        const parts: any[] = cand?.content?.parts || [];
        const text = parts.filter((p) => typeof p.text === 'string' && !p.thought).map((p) => p.text).join('');
        const toolCalls: ToolCall[] = parts
            .filter((p) => p.functionCall)
            .map((p, i) => ({ id: p.functionCall.id || `gemini_${Date.now()}_${i}`, name: p.functionCall.name, args: p.functionCall.args || {} }));
        const stopReason: StopReason = cand?.finishReason === 'MAX_TOKENS' ? 'max_tokens' : toolCalls.length ? 'tool_use' : 'end_turn';
        return {
            text,
            toolCalls: toolCalls.length ? toolCalls : undefined,
            stopReason,
            model,
            assistantMessage: { role: 'assistant', text, toolCalls, raw: { provider: 'gemini', data: cand?.content ?? { role: 'model', parts } } },
            usage: { inputTokens: response?.usageMetadata?.promptTokenCount, outputTokens: response?.usageMetadata?.candidatesTokenCount, cacheReadTokens: response?.usageMetadata?.cachedContentTokenCount },
        };
    };

    const single = (prompt: string) => [{ role: 'user', parts: [{ text: prompt }] }];

    return {
        provider: 'gemini',
        model: defaultModel,
        generate: async (prompt, options = {}) => (await call(single(prompt), [], options)).text,
        generateStream: async (prompt, options = {}, onChunk) => {
            const model = options.model || defaultModel;
            const generationConfig: any = { maxOutputTokens: clampMaxTokens('gemini', model, options.max_tokens, 8192) };
            if (options.temperature !== undefined && supportsTemperature('gemini', model)) generationConfig.temperature = options.temperature;
            try {
                const m = genAI.getGenerativeModel({ model, ...(options.system ? { systemInstruction: options.system } : {}), generationConfig });
                const result = await m.generateContentStream(prompt);
                let text = '';
                for await (const chunk of result.stream) {
                    const t = chunk.text();
                    text += t;
                    if (onChunk && t) onChunk(t);
                }
                return text;
            } catch (err) {
                throw toProviderError('gemini', model, err);
            }
        },
        generateWithTools: async (prompt, tools = [], options = {}) => {
            const r = await call(single(prompt), normalizeTools(tools), options);
            return { text: r.text, toolCalls: r.toolCalls, stopReason: r.stopReason, model: r.model };
        },
        generateAgentTurn: async (system, messages, tools = [], options = {}) =>
            call(toGeminiContents(messages), normalizeTools(tools), { ...options, system: system || options.system }),
    };
}

// ─── OpenAI-compatible chat completions (Groq, custom endpoints) ─────────────────────────────────

export function toChatMessages(system: string | undefined, messages: AgentMessage[]): any[] {
    const out: any[] = system ? [{ role: 'system', content: system }] : [];
    const chatParts = (c: string | AgentContentPart[]) =>
        typeof c === 'string' ? c : c.map((p) => (p.type === 'text' ? { type: 'text', text: p.text } : { type: 'image_url', image_url: { url: dataUrl(p) } }));
    for (const m of messages) {
        if (m.role === 'user') out.push({ role: 'user', content: chatParts(m.content) });
        else if (m.role === 'assistant') {
            out.push({
                role: 'assistant',
                content: m.text || null,
                ...(m.toolCalls?.length ? { tool_calls: m.toolCalls.map((tc) => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.args || {}) } })) } : {}),
            });
        } else {
            const images: AgentContentPart[] = [];
            for (const r of m.results) {
                out.push({ role: 'tool', tool_call_id: r.callId, content: `${r.isError ? 'ERROR: ' : ''}${textOf(r.content)}` });
                images.push(...partsOf(r.content).filter((p) => p.type === 'image'));
            }
            // Tool messages carry text only: images follow as a user message.
            if (images.length) out.push({ role: 'user', content: chatParts(images) });
        }
    }
    return out;
}

export function makeChatCompletionsClient(provider: 'groq' | 'custom', sdk: OpenAI, defaultModel: string, pinnedModel?: string): AIClient {
    const modelFor = (options: GenerateOptions) => pinnedModel || options.model || defaultModel;
    const base = (options: GenerateOptions, model: string) => {
        const body: any = { model };
        if (options.max_tokens) body.max_tokens = clampMaxTokens(provider, model, options.max_tokens);
        if (supportsTemperature(provider, model)) body.temperature = options.temperature ?? 0.7;
        return body;
    };
    const run = async (system: string | undefined, messages: AgentMessage[], tools: ToolDef[], options: GenerateOptions): Promise<AgentTurnResponse> => {
        const model = modelFor(options);
        const body: any = { ...base(options, model), messages: toChatMessages(system, messages) };
        if (tools.length) body.tools = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
        let completion: any;
        try {
            completion = await sdk.chat.completions.create(body);
        } catch (err) {
            throw toProviderError(provider, model, err);
        }
        const choice = completion.choices?.[0];
        const msg = choice?.message;
        const toolCalls: ToolCall[] = (msg?.tool_calls || []).map((tc: any) => ({ id: tc.id, name: tc.function?.name, args: safeJson(tc.function?.arguments) }));
        const stopReason: StopReason = choice?.finish_reason === 'length' ? 'max_tokens' : toolCalls.length ? 'tool_use' : 'end_turn';
        const text = msg?.content || '';
        return { text, toolCalls: toolCalls.length ? toolCalls : undefined, stopReason, model, assistantMessage: { role: 'assistant', text, toolCalls } };
    };
    return {
        provider,
        model: pinnedModel || defaultModel,
        generate: async (prompt, options = {}) => (await run(options.system, [{ role: 'user', content: prompt }], [], options)).text,
        generateStream: async (prompt, options = {}, onChunk) => {
            const model = modelFor(options);
            try {
                const stream = await sdk.chat.completions.create({ ...base(options, model), messages: toChatMessages(options.system, [{ role: 'user', content: prompt }]), stream: true });
                let text = '';
                for await (const chunk of stream as any) {
                    const content = chunk.choices[0]?.delta?.content || '';
                    text += content;
                    if (onChunk && content) onChunk(content);
                }
                return text;
            } catch (err) {
                throw toProviderError(provider, model, err);
            }
        },
        generateWithTools: async (prompt, tools = [], options = {}) => {
            const r = await run(options.system, [{ role: 'user', content: prompt }], normalizeTools(tools), options);
            return { text: r.text, toolCalls: r.toolCalls, stopReason: r.stopReason, model: r.model };
        },
        generateAgentTurn: async (system, messages, tools = [], options = {}) => run(system || options.system, messages, normalizeTools(tools), options),
    };
}

// ─── Service ─────────────────────────────────────────────────────────────────────────────────────

/** Fallback order when the requested provider has no key (Gemini is no longer first). */
const PROVIDER_FALLBACK_ORDER = ['claude', 'openai', 'gemini', 'groq', 'custom'];

export class AIProviderService {
    private static instance: AIProviderService;

    public static getInstance(): AIProviderService {
        if (!AIProviderService.instance) {
            AIProviderService.instance = new AIProviderService();
        }
        return AIProviderService.instance;
    }

    /**
     * An LLM client for the requested provider, or, when that provider has no key, the first provider that has one
     * (logged). `purpose` picks the default model (see model-config.ts); a call's `options.model` still wins.
     */
    async getClient(settings: AISettings, opts: { purpose?: ModelPurpose } = {}): Promise<AIClient | null> {
        if (!settings) return null;
        const requested = settings.aiProvider || 'openai';

        let client = this.instantiateProvider(requested, settings, opts.purpose);
        if (client) return client;

        for (const prov of PROVIDER_FALLBACK_ORDER) {
            if (prov === requested) continue;
            client = this.instantiateProvider(prov, settings, opts.purpose);
            if (client) {
                if (requested !== 'none' && requested !== 'builtin') {
                    console.warn(`[AIProviderService] provider "${requested}" has no key configured; using "${prov}" (${client.model}) instead`);
                }
                return client;
            }
        }
        return null;
    }

    private instantiateProvider(provider: string, settings: AISettings, purpose: ModelPurpose = 'general'): AIClient | null {
        if (!provider || provider === 'none' || provider === 'builtin') return null;
        const model = (p: string) => resolveModel(p, purpose, { vaultModels: settings.models });
        try {
            if (provider === 'gemini') {
                const key = (settings.geminiKey || '').trim();
                return key ? makeGeminiClient(key, model('gemini')) : null;
            }
            if (provider === 'openai') {
                const key = (settings.openaiKey || '').trim();
                return key ? makeOpenAIClient(key, model('openai')) : null;
            }
            if (provider === 'claude') {
                const key = (settings.claudeKey || '').trim();
                return key ? makeClaudeClient(key, model('claude')) : null;
            }
            if (provider === 'groq') {
                const key = (settings.groqKey || '').trim();
                return key ? makeChatCompletionsClient('groq', new OpenAI({ apiKey: key, baseURL: 'https://api.groq.com/openai/v1' }), model('groq')) : null;
            }
            if (provider === 'custom') {
                const key = (settings.customAiKey || '').trim();
                const baseURL = (settings.customAiUrl || '').trim();
                if (!key || !baseURL) return null;
                // The custom endpoint serves exactly the model configured for it.
                return makeChatCompletionsClient('custom', new OpenAI({ apiKey: key, baseURL }), model('custom'), settings.customAiModel || undefined);
            }
        } catch (error) {
            console.error(`[AIProviderService] could not initialise the ${provider} client:`, (error as any)?.message || error);
            return null;
        }
        return null;
    }

    /**
     * Convenience method: Generate insights using the company's AI provider.
     * Direct port of old `aiService.getInsights()`.
     */
    async getInsights(prompt: string, settings: AISettings, options: any = {}): Promise<string> {
        const client = await this.getClient(settings);
        if (!client) {
            return 'AI Insights currently unavailable. Please configure your AI provider in Settings.';
        }

        try {
            return await client.generate(prompt, options);
        } catch (err: any) {
            console.error(`[AIProviderService] Insight generation failed (${client.provider}):`, err.message);
            return 'Failed to generate AI insights. Please check your API key and connection settings.';
        }
    }

    /**
     * Convenience method: Stream insights using the company's AI provider.
     * Direct port of old `aiService.getInsightsStream()`.
     */
    async getInsightsStream(prompt: string, settings: AISettings, options: any = {}, onChunk?: (chunk: string) => void): Promise<string> {
        const client = await this.getClient(settings);
        if (!client) {
            const msg = 'AI Insights currently unavailable. Please configure your AI provider in Settings.';
            if (onChunk) onChunk(msg);
            return msg;
        }

        try {
            if (!client.generateStream) {
                const res = await client.generate(prompt, options);
                if (onChunk) onChunk(res);
                return res;
            }
            return await client.generateStream(prompt, options, onChunk);
        } catch (err: any) {
            console.error(`[AIProviderService] Insight streaming failed (${client.provider}):`, err.message);
            const errMsg = 'Failed to generate AI insights. Please check your API key and connection settings.';
            if (onChunk) onChunk(errMsg);
            return errMsg;
        }
    }

    /**
     * Live test connection for any provider (current default models; one model, errors reported as they are).
     */
    async testConnection(provider: string, apiKey: string, customUrl?: string, customModel?: string): Promise<{ success: boolean; message: string; text?: string }> {
        const trimmedKey = (apiKey || '').trim();
        if (!trimmedKey) {
            throw new Error('API Key is required.');
        }
        const ping = "Say '180 Workspace AI Connection Successful'";

        if (provider === 'gemini') {
            if (trimmedKey.startsWith('AQ.') || trimmedKey.startsWith('ya29.')) {
                throw new Error('The key entered appears to be an OAuth Access Token. The Gemini API expects an API Key generated from Google AI Studio (https://aistudio.google.com/app/apikey), which typically starts with "AIzaSy...". If using Vertex/Cloud, select the "Custom (Unified)" provider.');
            }
            const model = resolveModel('gemini');
            try {
                const text = await makeGeminiClient(trimmedKey, model).generate(ping, { max_tokens: 256 });
                return { success: true, message: `Connected to Google Gemini (${model})`, text };
            } catch (err: any) {
                const pe = toProviderError('gemini', model, err);
                if (pe.code === 'auth' || pe.code === 'bad_request' && /API key/i.test(pe.message)) {
                    throw new Error('Invalid Gemini API Key. Please verify key from Google AI Studio (https://aistudio.google.com/app/apikey).');
                }
                if (pe.code === 'rate_limit') throw new Error('Gemini API Quota Exceeded. Please check your project billing or rate limits.');
                throw new Error(`Gemini connection error: ${pe.message}`);
            }
        }

        if (provider === 'openai') {
            const model = resolveModel('openai');
            const text = await makeOpenAIClient(trimmedKey, model).generate(ping, { max_tokens: 64 });
            return { success: true, message: `Connected to OpenAI (${model})`, text };
        }

        if (provider === 'claude') {
            const model = resolveModel('claude');
            const text = await makeClaudeClient(trimmedKey, model).generate(ping, { max_tokens: 256, effort: 'low' });
            return { success: true, message: `Connected to Anthropic Claude (${model})`, text };
        }

        if (provider === 'groq') {
            const model = resolveModel('groq');
            const text = await makeChatCompletionsClient('groq', new OpenAI({ apiKey: trimmedKey, baseURL: 'https://api.groq.com/openai/v1' }), model).generate(ping, { max_tokens: 20 });
            return { success: true, message: `Connected to Groq Cloud (${model})`, text };
        }

        if (provider === 'custom') {
            if (!customUrl) throw new Error('Custom Base URL is required.');
            const model = customModel || GENERAL_DEFAULTS.custom;
            const text = await makeChatCompletionsClient('custom', new OpenAI({ apiKey: trimmedKey, baseURL: customUrl.trim() }), model, model).generate(ping, { max_tokens: 20 });
            return { success: true, message: 'Connected to Custom AI Endpoint', text };
        }

        throw new Error(`Unsupported AI provider: ${provider}`);
    }
}

export const aiProviderService = AIProviderService.getInstance();
export const AiService = AIProviderService;
export const aiService = aiProviderService;
