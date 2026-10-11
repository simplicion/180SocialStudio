"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UsageMeter = exports.estimateTokens = exports.AutopilotError = void 0;
exports.resolveAutopilotModels = resolveAutopilotModels;
exports.wrapAiClient = wrapAiClient;
exports.createCompanyAutopilotLLM = createCompanyAutopilotLLM;
/**
 * LLM access for the autopilot agents.
 *
 * The provider comes from the company's AI settings (AICompanyConfigService + aiProviderService.getClient),
 * the same resolution every other AI feature uses. There is no canned output and no hidden fallback: if the
 * company has no usable key the caller gets AutopilotError('AI_NOT_CONFIGURED', 503) before any work starts.
 */
const ai_company_config_service_1 = require("../../kernel/ai-company-config.service");
const ai_provider_service_1 = require("../../kernel/ai-provider.service");
const STATUS = {
    AI_NOT_CONFIGURED: 503,
    AI_PROVIDER_ERROR: 502,
    AI_INVALID_OUTPUT: 502,
    INVALID_INPUT: 400,
    NOT_FOUND: 404,
    JOB_STALLED: 500,
    CONFLICT: 409,
};
class AutopilotError extends Error {
    code;
    statusCode;
    details;
    constructor(code, message, details) {
        super(message);
        this.name = 'AutopilotError';
        this.code = code;
        this.statusCode = STATUS[code];
        this.details = details;
    }
}
exports.AutopilotError = AutopilotError;
/**
 * Model per role. Claude defaults: claude-sonnet-5 for everything, because the strategist output is a
 * structured plan that Sonnet handles well and Opus would roughly double the cost of the most expensive call.
 * Set AUTOPILOT_CLAUDE_STRATEGY_MODEL=claude-opus-5-5 to move only the strategist to Opus.
 * For OpenAI / Gemini / custom the provider client's own default applies unless the env overrides it.
 */
function resolveAutopilotModels(provider, env = process.env) {
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
const estimateTokens = (text) => Math.ceil((text || '').length / 4);
exports.estimateTokens = estimateTokens;
/** Wraps an existing platform AIClient in the autopilot interface. */
function wrapAiClient(client, models) {
    return {
        provider: client.provider,
        async complete(req) {
            const model = req.role === 'strategist' ? models.strategy : models.bulk;
            const fullPrompt = `${req.system}\n\n${req.prompt}`;
            let text;
            try {
                text = await client.generate(fullPrompt, {
                    max_tokens: req.maxTokens,
                    ...(model ? { model } : {}),
                    // A low temperature keeps JSON well formed; providers that reject sampling params ignore it.
                    ...(client.provider === 'claude' ? {} : { temperature: 0.6 }),
                });
            }
            catch (err) {
                throw new AutopilotError('AI_PROVIDER_ERROR', `AI provider (${client.provider}) request failed: ${err?.message || err}`);
            }
            return {
                text: text || '',
                model: model || client.provider,
                usage: { inputTokens: (0, exports.estimateTokens)(fullPrompt), outputTokens: (0, exports.estimateTokens)(text || ''), estimated: true },
            };
        },
    };
}
/**
 * Resolves the company's AI provider. Throws AI_NOT_CONFIGURED when there is no usable key.
 */
async function createCompanyAutopilotLLM(companyId) {
    if (!companyId)
        throw new AutopilotError('INVALID_INPUT', 'companyId is required');
    const { settings } = await ai_company_config_service_1.AICompanyConfigService.getCompanyAISettings(companyId);
    const client = await ai_provider_service_1.aiProviderService.getClient(settings);
    if (!client) {
        throw new AutopilotError('AI_NOT_CONFIGURED', `No usable AI provider key for this workspace (provider "${settings?.aiProvider || 'none'}"). Add a key in Settings > AI or set the platform env key.`);
    }
    return wrapAiClient(client, resolveAutopilotModels(client.provider));
}
/** Accumulates token usage across the agents of one job. */
class UsageMeter {
    byRole = {};
    estimated = false;
    record(role, usage) {
        const r = (this.byRole[role] ||= { calls: 0, inputTokens: 0, outputTokens: 0 });
        r.calls += 1;
        r.inputTokens += usage.inputTokens;
        r.outputTokens += usage.outputTokens;
        if (usage.estimated)
            this.estimated = true;
    }
    totals() {
        let calls = 0, inputTokens = 0, outputTokens = 0;
        for (const r of Object.values(this.byRole)) {
            calls += r.calls;
            inputTokens += r.inputTokens;
            outputTokens += r.outputTokens;
        }
        return { calls, inputTokens, outputTokens, estimated: this.estimated, byRole: this.byRole };
    }
}
exports.UsageMeter = UsageMeter;
