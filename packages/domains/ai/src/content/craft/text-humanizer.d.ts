export interface HumanizerHit {
    type: 'invisible' | 'typographic' | 'lexical' | 'structural';
    name: string;
    count: number;
    replacement?: string;
}
export interface HumanizerResult {
    originalText: string;
    cleanedText: string;
    hits: HumanizerHit[];
    totalCleaned: number;
}
export interface DetectionCheck {
    name: string;
    humanScore: number;
    detail: string;
    status: 'PASS' | 'WARN' | 'FAIL';
}
export interface AiDetectionReport {
    overallScore: number;
    verdict: 'HUMAN' | 'SLIGHT_AI_PATTERNS' | 'HEAVY_AI_SLOP';
    checks: DetectionCheck[];
    recommendations: string[];
}
export interface HumanizeOptions {
    /** 'all' (default) normalises every typographic tell; 'dashes' only em/en dashes, keeping quotes, bullets and arrows. */
    typographic?: 'all' | 'dashes' | 'none';
    /** Replace stock AI words/phrases (default true). Turn off when the caller only wants to flag them. */
    lexical?: boolean;
}
export declare class TextHumanizer {
    /**
     * Run 3 passes of cleansing: Invisible -> Typographic -> Lexical
     */
    static humanize(rawText: string, options?: HumanizeOptions): HumanizerResult;
    /** Stock AI words/phrases present in the text, without changing it (for "rewrite this line" feedback). */
    static findSlop(text: string): string[];
    /**
     * 5-factor AI detector panel
     */
    static detect(text: string): AiDetectionReport;
}
