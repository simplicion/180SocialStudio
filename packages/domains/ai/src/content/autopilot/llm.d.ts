import { AIClient } from '../../kernel/ai-provider.service';
export type AutopilotErrorCode = 'AI_NOT_CONFIGURED' | 'AI_PROVIDER_ERROR' | 'AI_INVALID_OUTPUT' | 'INVALID_INPUT' | 'NOT_FOUND' | 'JOB_STALLED' | 'CONFLICT';
export declare class AutopilotError extends Error {
    readonly code: AutopilotErrorCode;
    readonly statusCode: number;
    readonly details?: unknown;
    constructor(code: AutopilotErrorCode, message: string, details?: unknown);
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
export declare function resolveAutopilotModels(provider: string, env?: NodeJS.ProcessEnv): AutopilotModelConfig;
export declare const estimateTokens: (text: string) => number;
/** Wraps an existing platform AIClient in the autopilot interface. */
export declare function wrapAiClient(client: AIClient, models: AutopilotModelConfig): AutopilotLLM;
/**
 * Resolves the company's AI provider. Throws AI_NOT_CONFIGURED when there is no usable key.
 */
export declare function createCompanyAutopilotLLM(companyId: string): Promise<AutopilotLLM>;
/** Accumulates token usage across the agents of one job. */
export declare class UsageMeter {
    readonly byRole: Record<string, {
        calls: number;
        inputTokens: number;
        outputTokens: number;
    }>;
    estimated: boolean;
    record(role: AgentRole, usage: LlmUsage): void;
    totals(): {
        calls: number;
        inputTokens: number;
        outputTokens: number;
        estimated: boolean;
        byRole: Record<string, {
            calls: number;
            inputTokens: number;
            outputTokens: number;
        }>;
    };
}
