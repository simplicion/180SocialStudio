import { AutopilotLLM, UsageMeter } from '../llm';
import { HookScriptItem, PlatformCopy, Strategy, StrategySlot } from '../schemas';
import type { AutopilotBrandContext } from '../types';
export interface WorkingSlot extends StrategySlot {
    slotId: string;
    weekNumber: number;
}
export interface RunCreativeBriefParams {
    llm: AutopilotLLM;
    brand: AutopilotBrandContext;
    slots: WorkingSlot[];
    strategy: Strategy;
    meter?: UsageMeter;
    log?: (event: string, data: Record<string, unknown>) => void;
    instruction?: string;
}
export declare function runCreativeBriefAgent(params: RunCreativeBriefParams): Promise<Map<string, HookScriptItem>>;
export interface RunCopyParams {
    llm: AutopilotLLM;
    brand: AutopilotBrandContext;
    slots: WorkingSlot[];
    briefs: Map<string, HookScriptItem>;
    meter?: UsageMeter;
    log?: (event: string, data: Record<string, unknown>) => void;
}
export declare function runCopyAgent(params: RunCopyParams): Promise<Map<string, PlatformCopy[]>>;
