import type { AutopilotBrandContext } from './types';
/**
 * Builds the agents' brand block from a brand consciousness profile (WS1 BrandConsciousnessProfile shape).
 * When WS1 provides `toPromptContext()`, the caller passes its output as `promptContext` and it is used as-is;
 * otherwise this formats the profile fields itself.
 */
export declare function buildBrandContext(profile: any, extra?: {
    brandName?: string;
    industry?: string;
    promptContext?: string;
}): AutopilotBrandContext;
