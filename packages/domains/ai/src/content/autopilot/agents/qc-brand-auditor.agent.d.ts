import type { AutopilotBrandContext, AutopilotPiece } from '../types';
import { AutopilotLLM, UsageMeter } from '../llm';
export interface AuditBatchParams {
    llm: AutopilotLLM;
    brand: AutopilotBrandContext;
    pieces: AutopilotPiece[];
    meter?: UsageMeter;
    log?: (event: string, data: Record<string, unknown>) => void;
}
export declare function runQcBrandAuditorAgent(params: AuditBatchParams): Promise<void>;
export declare function enforceDeterministicRules(piece: AutopilotPiece, brand: AutopilotBrandContext): void;
