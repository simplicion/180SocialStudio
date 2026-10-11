import type { AutopilotPlatform, ContentFormat, ContentMixConfig } from './schemas';
export interface PlannedSlot {
    day: number;
    format: ContentFormat;
}
/** Upper bound of the strategy schema; a plan above it cannot be produced in one run. */
export declare const MAX_PLANNED_SLOTS = 120;
/**
 * Slots for [days] days from [mix], or null when no mix was given (then the strategist plans one slot per day and
 * picks each format). Formats none of the [platforms] support are refused instead of being silently swapped.
 */
export declare function planCadence(days: number, mix: ContentMixConfig | undefined, platforms: AutopilotPlatform[]): PlannedSlot[] | null;
/** Compact prompt text: "Day 1: reel, carousel, carousel" per posting day. */
export declare function describePlan(plan: PlannedSlot[]): string;
/** Differences between the plan and the strategist's slots, as repair instructions. Empty = exact match. */
export declare function planMismatches(plan: PlannedSlot[], slots: Array<{
    day: number;
    format: string;
}>): string[];
