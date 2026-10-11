/**
 * Autopilot calendar pipeline.
 *
 *   research (optional) -> strategist -> hook & script (per week, parallel) -> copy (per week, parallel)
 *   -> critic (LLM tone review per week + deterministic brand/platform enforcement)
 *
 * Every agent returns zod-validated JSON with one repair retry. Nothing here returns canned content: a failed
 * agent fails the run with a typed AutopilotError.
 */
import { AutopilotLLM, UsageMeter } from './llm';
import { WebSearchProvider } from './research';
import { Strategy, StrategySlot } from './schemas';
import type { AutopilotPiece, AutopilotRunInput, AutopilotRunResult, ProgressFn } from './types';
/** Output caps per call; they bound cost even if a model rambles. */
export declare const TOKEN_CAPS: {
    strategistBase: 1500;
    strategistPerSlot: 110;
    strategistMax: 9000;
    hookPerSlot: 650;
    hookMax: 8000;
    copyPerPlatformCopy: 260;
    copyMax: 8000;
};
export interface PipelineDeps {
    llm: AutopilotLLM;
    search?: WebSearchProvider | null;
    onProgress?: ProgressFn;
    log?: (event: string, data: Record<string, unknown>) => void;
    /** Max agent calls in flight at once for the per-week stages. */
    concurrency?: number;
    /** Agent run event sink (AgentStarted … AgentFailed); must not throw. */
    emit?: (type: import('../../agent-runs/agent-events').AgentEventType, payload?: Record<string, unknown>) => void;
}
export declare function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]>;
export declare function addDays(isoDate: string, days: number): string;
/** Converts a wall-clock date + HH:mm in an IANA timezone to a UTC Date. */
export declare function zonedTimeToUtc(isoDate: string, hhmm: string, timeZone: string): Date;
export declare function isValidTimeZone(tz: string): boolean;
/** Keeps the strategist's hook types if all five are used (when there are 5+ slots); otherwise rotates them. */
export declare function assignHookTypes(slots: StrategySlot[]): void;
export declare function validateRunInput(input: AutopilotRunInput): void;
export declare function runAutopilotPipeline(input: AutopilotRunInput, deps: PipelineDeps): Promise<AutopilotRunResult>;
/**
 * Regenerates one piece (hook/script + copy + critic) with an editor instruction.
 * `strategy` is the stored strategy summary; the piece keeps its slot (day, format, platforms, pillar).
 */
export declare function regenerateAutopilotPiece(params: {
    piece: AutopilotPiece;
    instruction: string;
    input: AutopilotRunInput;
    strategy: Strategy;
    deps: PipelineDeps;
}): Promise<{
    piece: AutopilotPiece;
    usage: ReturnType<UsageMeter['totals']>;
}>;
