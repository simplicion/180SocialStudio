/**
 * Agent 1: Neuromarketing & Audience Psychology Agent
 *
 * Implements Master SOP Stage 01 & Stage 02:
 * - Evaluates client brand consciousness & target audience psychology.
 * - Reference Neutralizer: Analyzes user reference inspirations, neutralizes dry/boring corporate
 *   statements into high-tension emotional triggers, and maps them to the Psychological Job Library.
 */
import { z } from 'zod';
import { AutopilotLLM, UsageMeter } from '../llm';
import { PsychologicalJob } from '../schemas';
import type { AutopilotBrandContext } from '../types';
export declare const PSYCHOLOGICAL_JOB_GUIDE: Record<PsychologicalJob, {
    when: string;
    angle: string;
}>;
export declare const NeuromarketingOutcomeSchema: any;
export type NeuromarketingOutcome = z.infer<typeof NeuromarketingOutcomeSchema>;
export interface RunNeuromarketingParams {
    llm: AutopilotLLM;
    brand: AutopilotBrandContext;
    goals: string[];
    referenceInspirations?: string;
    structureDirectives?: string;
    meter?: UsageMeter;
    log?: (event: string, data: Record<string, unknown>) => void;
}
export declare function runNeuromarketingResearchAgent(params: RunNeuromarketingParams): Promise<NeuromarketingOutcome>;
