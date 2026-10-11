export interface BeatRow {
    index: number;
    timecode: string;
    startSec: number;
    durationSec: number;
    wordCount: number;
    text: string;
    isConcrete: boolean;
    flags: string[];
}
export interface BeatSheetAnalysis {
    beats: BeatRow[];
    totalSeconds: number;
    totalWords: number;
    estimatedWpm: number;
    hookDurationSec: number;
    flags: string[];
    passed: boolean;
    loopDetected: boolean;
    loopWord?: string;
    summary: {
        hookStatus: 'PASS' | 'WARN' | 'FAIL';
        pacingStatus: 'PASS' | 'WARN' | 'FAIL';
        concretenessStatus: 'PASS' | 'WARN' | 'FAIL';
    };
}
export declare class BeatSheetLinter {
    static splitBeats(raw: string, wps: number): string[];
    static analyze(raw: string, options?: {
        wpm?: number;
        targetSeconds?: number;
    }): BeatSheetAnalysis;
}
