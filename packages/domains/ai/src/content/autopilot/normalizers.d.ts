import { type AutopilotPlatform } from './schemas';
export interface StrategyNormaliseCtx {
    days: number;
    platforms: AutopilotPlatform[];
    allowedUrls: Set<string>;
    brandPositioning?: string | null;
}
export declare function normaliseStrategy(raw: any, ctx: StrategyNormaliseCtx): any;
export interface HookSlotRef {
    slotId: string;
    format: string;
    topic: string;
    angle?: string;
    hookType?: string;
    psychologicalJob?: string;
    designSystem?: string;
    whatContentDelivers?: string;
    visualDirection?: string;
    targetDurationSec?: number;
    slideCount?: number;
}
/** Hook/script items: accepts a bare array or {items}, aliases `hook`, string beats, missing slide numbers. */
export declare function normaliseHookScript(raw: any, chunk: HookSlotRef[], opts?: {
    attempt?: number;
}): any;
/** Problems the hook/script agent must fix (fed back into the repair prompt). Nothing is truncated or padded. */
export declare function hookScriptProblems(items: any[], chunk: HookSlotRef[]): string[];
export interface CopyPieceRef {
    slotId: string;
    platforms: string[];
}
/** Copy items: wrappers and platform-name case only. A missing copy stays missing on attempt 1 (the check asks for it). */
export declare function normaliseCopy(raw: any, chunk: CopyPieceRef[], opts?: {
    attempt?: number;
}): any;
