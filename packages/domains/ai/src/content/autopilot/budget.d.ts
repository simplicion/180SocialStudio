import type { AutopilotPlatform, ContentMixConfig } from './schemas';
/** Same numbers the pipeline uses for max_tokens. Kept here so the estimate and the run cannot drift apart. */
export declare const AGENT_TOKEN_CAPS: {
    readonly research: 1500;
    readonly strategistBase: 1500;
    readonly strategistPerSlot: 110;
    readonly strategistMax: 9000;
    readonly hookBase: 800;
    readonly hookPerSlot: 650;
    readonly hookMax: 8000;
    readonly hookChunk: 4;
    readonly hookLabBase: 500;
    readonly hookLabPerHook: 220;
    readonly hookLabMax: 4000;
    readonly copyBase: 500;
    readonly copyPerPlatformCopy: 260;
    readonly copyMax: 8000;
    readonly copyChunk: 5;
    readonly craftBase: 500;
    readonly craftPerFix: 420;
    readonly craftMax: 8000;
    readonly craftChunk: 12;
    readonly criticBase: 400;
    readonly criticPerPiece: 350;
    readonly criticMax: 6000;
};
export interface OptionalAgentLimits {
    /** false = Hook Lab and Platform Craft only score; they never call the model. */
    rewritesEnabled: boolean;
    /** Most Platform Craft fix calls in one run (each fixes up to 12 captions). */
    craftMaxFixCalls: number;
}
export declare function optionalAgentLimits(env?: NodeJS.ProcessEnv): OptionalAgentLimits;
export interface AgentBudget {
    agent: 'research' | 'strategist' | 'hook_script' | 'hook_lab' | 'copy' | 'craft' | 'critic';
    /** Calls when every reply is valid first time. */
    calls: number;
    /** Sum of max_tokens over those calls. */
    maxOutputTokens: number;
    /** true = runs only when a check fails; 0 calls is common. */
    conditional: boolean;
}
export interface AutopilotBudget {
    days: number;
    pieces: number;
    platforms: number;
    agents: AgentBudget[];
    calls: number;
    maxOutputTokens: number;
    /** Every agent may retry once with the validation errors, so the hard ceiling is double. */
    worstCaseCalls: number;
    worstCaseOutputTokens: number;
}
export declare function estimateAutopilotBudget(input: {
    days: number;
    platforms: AutopilotPlatform[];
    contentMix?: ContentMixConfig;
    researchEnabled?: boolean;
}, limits?: OptionalAgentLimits): AutopilotBudget;
export interface UsageCost {
    inputUsd: number;
    outputUsd: number;
    totalUsd: number;
    /** Prices used, per million tokens, as configured by the operator. */
    pricePerMTok: {
        input: number;
        output: number;
    };
    /** true when token counts were estimated from text length rather than reported by the provider. */
    estimatedTokens: boolean;
}
/** Cost of a run from its token usage, or null when no prices are configured. */
export declare function priceUsage(usage: {
    inputTokens: number;
    outputTokens: number;
    estimated?: boolean;
}, env?: NodeJS.ProcessEnv): UsageCost | null;
