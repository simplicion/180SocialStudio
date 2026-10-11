/**
 * Critic agent.
 *
 * 1. An LLM pass reviews each piece for brand tone and forbidden words and may rewrite captions/hooks.
 * 2. A deterministic pass then enforces the hard rules no matter what the LLM returned: forbidden words are
 *    removed, hashtags are normalised/deduplicated/capped per platform, captions are fitted to platform
 *    limits, and duplicate pieces are flagged. Anything changed or unresolved is recorded on the piece.
 */
import { AutopilotLLM, UsageMeter } from './llm';
import type { AutopilotBrandContext, AutopilotPiece } from './types';
export declare function forbiddenRegex(words: string[]): RegExp | null;
export declare function findForbidden(text: string, re: RegExp | null): string[];
export declare function stripForbidden(text: string, re: RegExp | null): string;
export declare function normalizeHashtag(tag: string): string | null;
/** Deterministic enforcement. Mutates and returns the pieces. */
export declare function enforceBrandRules(pieces: AutopilotPiece[], brand: AutopilotBrandContext): AutopilotPiece[];
/** LLM tone review for one batch of pieces; applies the returned fixes in place. */
export declare function runCriticAgent(params: {
    llm: AutopilotLLM;
    brand: AutopilotBrandContext;
    pieces: AutopilotPiece[];
    meter?: UsageMeter;
}): Promise<void>;
