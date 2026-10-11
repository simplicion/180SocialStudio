/**
 * Agent 8: Shooting Script Director (on demand, one video piece at a time)
 *
 * Expands a reel's script into a scene-by-scene production plan a creator can shoot without an agency: for each
 * scene the exact spoken line, on-screen text, shot type and framing, what to do on camera, B-roll, the edit cue
 * and delivery note, plus setup, props and a pre-shoot checklist.
 *
 * The LLM plans the visuals; it is not allowed to change what is said. `check` verifies that the scenes' spoken
 * lines add up to the stored script word for word, and timecodes are then computed from word counts at the
 * platform's speaking pace (never taken from the model).
 */
import { z } from 'zod';
import { CraftPlatform } from '../../craft/platform-specs';
import { AutopilotLLM, UsageMeter } from '../llm';
import type { AutopilotBrandContext, AutopilotPiece } from '../types';
export declare const SCENE_PURPOSES: readonly ["hook", "setup", "value", "proof", "loop", "cta"];
export declare const SHOT_TYPES: readonly ["talking_head_close", "talking_head_medium", "wide", "over_shoulder", "screen_recording", "product_close", "hands_demo", "b_roll", "text_card"];
declare const SceneSchema: any;
export declare const ProductionScriptDraftSchema: any;
export type ProductionScriptDraft = z.infer<typeof ProductionScriptDraftSchema>;
export interface ProductionScene extends z.infer<typeof SceneSchema> {
    index: number;
    timecode: string;
    startSec: number;
    durationSec: number;
    wordCount: number;
    flags: string[];
}
export interface ProductionScript {
    schema: 'production-script.v1';
    platform: CraftPlatform;
    aspect: string;
    wpm: number;
    totalSeconds: number;
    logline: string;
    setup: ProductionScriptDraft['setup'];
    scenes: ProductionScene[];
    captionStyle: string;
    musicMood: string;
    checklist: string[];
    flags: string[];
    generatedAt: string;
}
/** Deterministic timing + pacing flags for a validated draft. */
export declare function timeProductionScript(draft: ProductionScriptDraft, platform: CraftPlatform, now?: Date): ProductionScript;
export declare function runProductionScriptAgent(params: {
    llm: AutopilotLLM;
    brand: AutopilotBrandContext;
    piece: AutopilotPiece;
    meter?: UsageMeter;
    log?: (event: string, data: Record<string, unknown>) => void;
}): Promise<ProductionScript>;
export {};
