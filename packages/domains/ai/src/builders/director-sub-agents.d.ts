/**
 * Sub-agents under the AI Director (WS5). Each is a deterministic "tool" the director calls: it
 * reads the brand/script context and the transcript, and returns CreativeOperations (never pixels)
 * plus warnings. None of them calls an LLM, so a director turn stays within its LLM budget
 * (planner: 1 call + at most 1 repair). Stock/SFX lookups are injected and run under a deadline.
 */
import { CreativeOperation, DirectorContext, BrandStyleDefaults, ScriptAlignment, EditIR } from "@workspace/video-contracts";
type Word = {
    text: string;
    startMs: number;
    endMs: number;
};
/**
 * Style agent: brand → caption colours/font/preset, zoom, transition and watermark choices.
 * When the server resolved WS1 `resolveBrandRendering()` (`ctx.brand.rendering`), its values are
 * used and every neutral default is named in the warnings (never saved to the brand).
 */
export declare function styleAgent(ctx: DirectorContext): BrandStyleDefaults;
/** B-roll research agent: visual queries from transcript entities, placed on the current timeline. */
export declare function brollResearchAgent(args: {
    words: Word[];
    baseIR: EditIR;
    assetId: string;
    max?: number;
}): CreativeOperation[];
export interface SfxSuggestion {
    title: string;
    url: string;
    durationSec?: number;
    license?: string | null;
    attribution?: string;
    query: string;
}
/** Sound agent: brand mood → music bed from the catalogue; optional Freesound SFX suggestions. */
export declare function soundAgent(args: {
    ctx: DirectorContext;
    resolveSfx?: (query: string) => Promise<SfxSuggestion[]>;
    timeoutMs: number;
    warnings: string[];
}): Promise<{
    music: CreativeOperation;
    sfx: SfxSuggestion[];
}>;
/**
 * SFX placement: puts the sound agent's HTTPS effects on an SFX audio lane at the timeline's
 * transitions (B-roll cutaway starts, then joins between main clips), slightly early so the
 * whoosh lands on the cut. Returns credit lines per placed clip id. Mutates `ir`.
 */
export declare function placeSfxOnTimeline(ir: EditIR, sfx: SfxSuggestion[], opts?: {
    max?: number;
    volumeDb?: number;
}): {
    placed: number;
    credits: Record<string, string>;
    used: SfxSuggestion[];
};
export interface GreetingProposal {
    operations: CreativeOperation[];
    /** Short bullet list of what the proposal does, in the order applied. */
    steps: string[];
    watermark: boolean;
    /** "Day 3 \"Stop doing X\"" or the brand name. */
    name: string;
    notes: string[];
    targetSec: number | null;
    platformLabel: string;
}
/** Final greeting text, once the proposal is compiled and its real length is known. */
export declare function greetingReply(p: GreetingProposal, finalSec: number): string;
/**
 * The opening proposal: open on the hook, cut pauses, drop weaker repeated takes, captions in
 * brand colours, platform aspect, one hook zoom, brand-mood music, B-roll, logo watermark.
 * Everything is expressed as CreativeOperations on the CURRENT timeline.
 */
export declare function buildGreetingProposal(args: {
    ctx: DirectorContext;
    style: BrandStyleDefaults;
    alignment: ScriptAlignment | null;
    baseIR: EditIR;
    assetId: string;
    words: Word[];
    hasSilences: boolean;
    broll: CreativeOperation[];
    music: CreativeOperation | null;
}): GreetingProposal;
/**
 * Brand defaults on planned operations: captions the creator did not colour/style explicitly
 * get the brand colours and caption preset. Returns human notes of what was applied.
 */
export declare function applyBrandDefaults(ops: CreativeOperation[], prompt: string, style: BrandStyleDefaults): string[];
/** Watermark intent from the prompt (deterministic path) or finish_edit (LLM). */
export declare function watermarkIntent(prompt: string, llm?: "add" | "remove" | "keep"): "add" | "remove" | "keep";
export {};
