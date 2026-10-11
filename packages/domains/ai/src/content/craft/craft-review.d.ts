/**
 * One deterministic quality report per calendar piece, combining the craft linters:
 * spoken hook score, on-screen hook length, timed beat sheet (video), per-platform copy lint, and AI-voice
 * detection. The autopilot "craft" agents use `blocking` to decide what to send back for a rewrite; the UI shows
 * the whole report next to the script.
 */
import { BeatSheetAnalysis } from './beat-sheet';
import { CopyLintResult } from './copy-linter';
import { HookEvaluation } from './hook-scorer';
import { CraftPlatform } from './platform-specs';
import { AiDetectionReport } from './text-humanizer';
export interface CraftPieceInput {
    format: string;
    platforms: string[];
    spokenHook?: string;
    onScreenHook?: string;
    script?: {
        hook?: string;
        body: {
            beat: string;
        }[];
        retentionLoop?: string;
        cta?: string;
        estimatedDurationSec?: number;
    };
    captions?: Partial<Record<string, {
        caption: string;
        hashtags?: string[];
    }>>;
    targetDurationSec?: number;
    keywords?: string[];
}
export interface CraftReport {
    /** 0-100 average of the parts that apply. */
    score: number;
    hook?: HookEvaluation;
    onScreenHook?: {
        text: string;
        words: number;
        ok: boolean;
    };
    beatSheet?: BeatSheetAnalysis;
    copy: Partial<Record<CraftPlatform, CopyLintResult>>;
    voice?: AiDetectionReport;
    /** Problems a writer must fix (sent back to the LLM); warnings stay as advice. */
    blocking: string[];
    advice: string[];
}
export declare const HOOK_PASS_SCORE = 55;
/** Joins a structured script into the lines the beat sheet times (one line per beat). */
export declare function scriptToLines(script: NonNullable<CraftPieceInput['script']>, spokenHook?: string): string;
export declare function reviewPieceCraft(input: CraftPieceInput): CraftReport;
export interface TimedBeat {
    index: number;
    timecode: string;
    startSec: number;
    durationSec: number;
    wordCount: number;
    spokenWords: string;
    role: 'hook' | 'body' | 'loop' | 'cta';
    screenText?: string;
    retentionDevice?: string;
    isConcrete: boolean;
    flags: string[];
}
/**
 * Times the script exactly as written: one row per part (hook, each body beat, loop, CTA) at the platform's
 * speaking pace. Nothing is added: rows only carry text and retention devices the writer produced.
 */
export declare function buildTimedBeats(script: NonNullable<CraftPieceInput['script']>, options?: {
    spokenHook?: string;
    onScreenHook?: string;
    platform?: CraftPlatform;
}): {
    beats: TimedBeat[];
    totalSeconds: number;
    wpm: number;
    teleprompterText: string;
};
/**
 * Numbers, money amounts and percentages in `candidate` that do not appear anywhere in `context`.
 * Rewrite agents use it to reject hooks/captions that invent results ("$18,000", "42%") the brand never stated.
 */
export declare function inventedFigures(candidate: string, context: string): string[];
