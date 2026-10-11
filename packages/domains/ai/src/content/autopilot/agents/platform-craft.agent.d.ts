import { AutopilotLLM, UsageMeter } from '../llm';
import type { AutopilotBrandContext, AutopilotPiece } from '../types';
export interface PlatformCraftOutcome {
    linted: number;
    failing: number;
    rewritten: number;
    /** Failing copies left for the reviewer because the run's fix-call limit was reached. */
    skipped: number;
    error?: string;
}
export declare function runPlatformCraftAgent(params: {
    llm: AutopilotLLM;
    brand: AutopilotBrandContext;
    pieces: AutopilotPiece[];
    meter?: UsageMeter;
    log?: (event: string, data: Record<string, unknown>) => void;
}): Promise<PlatformCraftOutcome>;
