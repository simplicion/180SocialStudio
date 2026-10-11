export interface HookScoreBreakdown {
    lengthScore: number;
    lengthDetail: string;
    concretenessScore: number;
    concretenessDetail: string;
    stakesScore: number;
    stakesDetail: string;
    frontLoadScore: number;
    frontLoadDetail: string;
    audienceScore: number;
    audienceDetail: string;
}
export interface HookEvaluation {
    hook: string;
    totalScore: number;
    grade: 'EXCELLENT' | 'STRONG' | 'MEDIOCRE' | 'WEAK' | 'FAIL';
    dealbreaker?: string;
    formulaId?: number;
    formulaName?: string;
    breakdown: HookScoreBreakdown;
    recommendations: string[];
}
export declare class HookScorer {
    private static formulas;
    static classifyFormula(hook: string): {
        id: number;
        name: string;
    } | undefined;
    /**
     * Scores a hook 0-100. `spoken` (default) is a line said on camera: hashtags/emoji are dealbreakers and the
     * 3-second window caps it at 15 words. Text posts (LinkedIn/X/Facebook opening lines) pass spoken: false and
     * the platform's opening-line word budget as maxWords.
     */
    static score(hook: string, options?: {
        spoken?: boolean;
        maxWords?: number;
    }): HookEvaluation;
    static rank(hooks: string[], options?: {
        spoken?: boolean;
        maxWords?: number;
    }): HookEvaluation[];
}
