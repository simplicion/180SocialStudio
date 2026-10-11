import { AutopilotLLM, UsageMeter } from '../llm';
import { AutopilotPlatform, ContentMixConfig, Strategy } from '../schemas';
import type { AutopilotBrandContext } from '../types';
import type { NeuromarketingOutcome } from './neuromarketing-research.agent';
export interface RunCadenceFlowParams {
    llm: AutopilotLLM;
    brand: AutopilotBrandContext;
    days: 7 | 14 | 30;
    platforms: AutopilotPlatform[];
    goals: string[];
    neuromarketing: NeuromarketingOutcome;
    contentMix?: ContentMixConfig;
    structureDirectives?: string;
    meter?: UsageMeter;
    log?: (event: string, data: Record<string, unknown>) => void;
}
export declare function calculateSlotAllocations(days: number, mix?: ContentMixConfig): {
    reelSlots: number;
    carouselSlots: number;
    pattern: Array<'reel' | 'carousel'>;
};
export declare function runCadenceFlowAgent(params: RunCadenceFlowParams): Promise<Strategy>;
