/**
 * LLM access for the autopilot agents.
 *
 * The provider comes from the company's AI settings (AICompanyConfigService + aiProviderService.getClient),
 * the same resolution every other AI feature uses. There is no canned output and no hidden fallback: if the
 * company has no usable key the caller gets AutopilotError('AI_NOT_CONFIGURED', 503) before any work starts.
 */
import { AICompanyConfigService } from '../../kernel/ai-company-config.service';
import { aiProviderService, AIClient } from '../../kernel/ai-provider.service';

export type AutopilotErrorCode =
    | 'AI_NOT_CONFIGURED'
    | 'AI_PROVIDER_ERROR'
    | 'AI_INVALID_OUTPUT'
    | 'INVALID_INPUT'
    | 'NOT_FOUND'
    | 'JOB_STALLED'
    | 'CONFLICT';

const STATUS: Record<AutopilotErrorCode, number> = {
    AI_NOT_CONFIGURED: 503,
    AI_PROVIDER_ERROR: 502,
    AI_INVALID_OUTPUT: 502,
    INVALID_INPUT: 400,
    NOT_FOUND: 404,
    JOB_STALLED: 500,
    CONFLICT: 409,
};

export class AutopilotError extends Error {
    readonly code: AutopilotErrorCode;
    readonly statusCode: number;
    readonly details?: unknown;
    constructor(code: AutopilotErrorCode, message: string, details?: unknown) {
        super(message);
        this.name = 'AutopilotError';
        this.code = code;
        this.statusCode = STATUS[code];
        this.details = details;
    }
}

/** Which agent is calling; used to pick a model and to attribute token usage. */
export type AgentRole = 'research' | 'strategist' | 'hook_script' | 'hook_lab' | 'copy' | 'craft' | 'critic' | 'regenerate' | 'production_script' | 'platform_draft' | 'repurpose';

export interface LlmUsage {
    inputTokens: number;
    outputTokens: number;
    /** true when the provider client did not report usage and the counts are estimated from characters. */
    estimated: boolean;
}

export interface LlmRequest {
    role: AgentRole;
    system: string;
    prompt: string;
    maxTokens: number;
}

export interface LlmResponse {
    text: string;
    usage: LlmUsage;
    model: string;
}

/** Minimal interface the agents depend on; tests pass a fake. */
export interface AutopilotLLM {
    provider: string;
    complete(req: LlmRequest): Promise<LlmResponse>;
}

export interface AutopilotModelConfig {
    bulk: string;
    strategy: string;
}

/**
 * Model per role. Claude defaults: claude-sonnet-5 for everything, because the strategist output is a
 * structured plan that Sonnet handles well and Opus would roughly double the cost of the most expensive call.
 * Set AUTOPILOT_CLAUDE_STRATEGY_MODEL=claude-opus-5-5 to move only the strategist to Opus.
 * For OpenAI / Gemini / custom the provider client's own default applies unless the env overrides it.
 */
export function resolveAutopilotModels(provider: string, env: NodeJS.ProcessEnv = process.env): AutopilotModelConfig {
    if (provider === 'claude') {
        const bulk = env.AUTOPILOT_CLAUDE_BULK_MODEL || 'claude-sonnet-5';
        return { bulk, strategy: env.AUTOPILOT_CLAUDE_STRATEGY_MODEL || bulk };
    }
    if (provider === 'openai') {
        const bulk = env.AUTOPILOT_OPENAI_BULK_MODEL || 'gpt-4o';
        return { bulk, strategy: env.AUTOPILOT_OPENAI_STRATEGY_MODEL || bulk };
    }
    const bulk = env.AUTOPILOT_BULK_MODEL || '';
    return { bulk, strategy: env.AUTOPILOT_STRATEGY_MODEL || bulk };
}

export const estimateTokens = (text: string) => Math.ceil((text || '').length / 4);

/** Wraps an existing platform AIClient in the autopilot interface. */
export function wrapAiClient(client: AIClient, models: AutopilotModelConfig): AutopilotLLM {
    return {
        provider: client.provider,
        async complete(req: LlmRequest): Promise<LlmResponse> {
            const model = req.role === 'strategist' ? models.strategy : models.bulk;
            const fullPrompt = `${req.system}\n\n${req.prompt}`;
            let text: string;
            try {
                text = await client.generate(fullPrompt, {
                    max_tokens: req.maxTokens,
                    ...(model ? { model } : {}),
                    // A low temperature keeps JSON well formed; providers that reject sampling params ignore it.
                    ...(client.provider === 'claude' ? {} : { temperature: 0.6 }),
                });
            } catch (err: any) {
                throw new AutopilotError('AI_PROVIDER_ERROR', `AI provider (${client.provider}) request failed: ${err?.message || err}`);
            }
            return {
                text: text || '',
                model: model || client.provider,
                usage: { inputTokens: estimateTokens(fullPrompt), outputTokens: estimateTokens(text || ''), estimated: true },
            };
        },
    };
}

/**
 * Resolves the company's AI provider. Throws AI_NOT_CONFIGURED when there is no usable key.
 */
export async function createCompanyAutopilotLLM(companyId: string): Promise<AutopilotLLM> {
    if (!companyId) throw new AutopilotError('INVALID_INPUT', 'companyId is required');
    const { settings } = await AICompanyConfigService.getCompanyAISettings(companyId);
    const client = await aiProviderService.getClient(settings);
    if (!client) {
        throw new AutopilotError(
            'AI_NOT_CONFIGURED',
            `No usable AI provider key for this workspace (provider "${settings?.aiProvider || 'none'}"). Add a key in Settings > AI or set the platform env key.`,
        );
    }
    return wrapAiClient(client, resolveAutopilotModels(client.provider));
}

/** Accumulates token usage across the agents of one job. */
export class UsageMeter {
    readonly byRole: Record<string, { calls: number; inputTokens: number; outputTokens: number }> = {};
    estimated = false;

    record(role: AgentRole, usage: LlmUsage) {
        const r = (this.byRole[role] ||= { calls: 0, inputTokens: 0, outputTokens: 0 });
        r.calls += 1;
        r.inputTokens += usage.inputTokens;
        r.outputTokens += usage.outputTokens;
        if (usage.estimated) this.estimated = true;
    }

    totals() {
        let calls = 0, inputTokens = 0, outputTokens = 0;
        for (const r of Object.values(this.byRole)) {
            calls += r.calls; inputTokens += r.inputTokens; outputTokens += r.outputTokens;
        }
        return { calls, inputTokens, outputTokens, estimated: this.estimated, byRole: this.byRole };
    }
}
