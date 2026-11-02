/**
 * LLM adapters for the eval harness, built from env without the DB-backed company config.
 *
 * The generator mirrors production exactly: the same per-role model resolution (resolveAutopilotModels) and the
 * same request shape as wrapAiClient (system + prompt sent as one user message, no sampling params), so a
 * scorecard measures what users actually get. Override the models with EVAL_MODEL / EVAL_STRATEGY_MODEL.
 *
 * The judge is deliberately a different model from the generator (default claude-opus-5-5) so it does not grade
 * its own writing.
 */
import Anthropic from '@anthropic-ai/sdk';
import { AutopilotError, AutopilotLLM, LlmRequest, LlmResponse, resolveAutopilotModels } from '../../src/content/autopilot/llm';
import { createBuiltinViralAutopilotLLM } from '../../src/content/autopilot/builtin-viral-llm';

export interface InstrumentedLLM extends AutopilotLLM {
    stats: { calls: number; failures: number; refusals: number; latencyMs: number[]; models: Set<string> };
}

function textOf(msg: Anthropic.Message): string {
    return msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
}

export function createAnthropicLLM(env: NodeJS.ProcessEnv = process.env): InstrumentedLLM {
    const client = new Anthropic();
    const resolved = resolveAutopilotModels('claude', env);
    const models = { bulk: env.EVAL_MODEL || resolved.bulk, strategy: env.EVAL_STRATEGY_MODEL || env.EVAL_MODEL || resolved.strategy };
    const stats: InstrumentedLLM['stats'] = { calls: 0, failures: 0, refusals: 0, latencyMs: [], models: new Set() };
    return {
        provider: 'claude',
        stats,
        async complete(req: LlmRequest): Promise<LlmResponse> {
            const model = req.role === 'strategist' ? models.strategy : models.bulk;
            stats.calls += 1;
            stats.models.add(model);
            const started = Date.now();
            let msg: Anthropic.Message;
            try {
                msg = await client.messages.create({
                    model,
                    max_tokens: req.maxTokens,
                    messages: [{ role: 'user', content: `${req.system}\n\n${req.prompt}` }],
                });
            } catch (err: any) {
                stats.failures += 1;
                throw new AutopilotError('AI_PROVIDER_ERROR', `eval generator (${model}) failed: ${err?.message || err}`);
            } finally {
                stats.latencyMs.push(Date.now() - started);
            }
            if (msg.stop_reason === ('refusal' as any)) stats.refusals += 1;
            return {
                text: textOf(msg),
                model,
                usage: { inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens, estimated: false },
            };
        },
    };
}

/** The canned offline engine; only useful to smoke-test the harness itself (scores are meaningless). */
export function createBuiltinLLM(): InstrumentedLLM {
    const inner = createBuiltinViralAutopilotLLM();
    const stats: InstrumentedLLM['stats'] = { calls: 0, failures: 0, refusals: 0, latencyMs: [], models: new Set(['builtin']) };
    return {
        provider: 'builtin',
        stats,
        async complete(req) {
            stats.calls += 1;
            const t = Date.now();
            try { return await inner.complete(req); } catch (e) { stats.failures += 1; throw e; } finally { stats.latencyMs.push(Date.now() - t); }
        },
    };
}

export function createGeneratorFromEnv(provider: string, env: NodeJS.ProcessEnv = process.env): InstrumentedLLM {
    if (provider === 'builtin') return createBuiltinLLM();
    if (provider === 'claude' || provider === 'anthropic') return createAnthropicLLM(env);
    throw new Error(`Unknown --provider "${provider}". Use claude or builtin.`);
}

/** Judge call: returns raw text. Uses a different model than the generator. */
export async function judgeComplete(system: string, prompt: string, env: NodeJS.ProcessEnv = process.env): Promise<string> {
    const client = new Anthropic();
    const msg = await client.messages.create({
        model: env.EVAL_JUDGE_MODEL || 'claude-opus-5-5',
        max_tokens: 4000,
        system,
        messages: [{ role: 'user', content: prompt }],
    });
    if (msg.stop_reason === ('refusal' as any)) throw new Error('judge refused');
    return textOf(msg);
}
