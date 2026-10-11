import { HookEvaluation } from '../../craft/hook-scorer';
import { AutopilotLLM, UsageMeter } from '../llm';
import type { AutopilotBrandContext, AutopilotPiece } from '../types';
export interface HookLabOutcome {
    scored: number;
    weak: number;
    rewritten: number;
    error?: string;
}
export declare function scorePieceHook(piece: AutopilotPiece, hook?: string): HookEvaluation;
export declare function runHookLabAgent(params: {
    llm: AutopilotLLM;
    brand: AutopilotBrandContext;
    pieces: AutopilotPiece[];
    meter?: UsageMeter;
    log?: (event: string, data: Record<string, unknown>) => void;
}): Promise<HookLabOutcome>;
