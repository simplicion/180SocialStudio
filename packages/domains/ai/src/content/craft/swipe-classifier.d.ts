import { HookEvaluation } from './hook-scorer';
export interface CompetitorPostRecord {
    account: string;
    followers?: number;
    medianViews?: number;
    views: number;
    hook: string;
    url?: string;
}
export interface ClassifiedOutlier {
    account: string;
    views: number;
    baseline: number;
    baselineType: 'median' | 'followers';
    outlierMultiple: number;
    isOutlier: boolean;
    hook: string;
    formulaId?: number;
    formulaName: string;
    hookScore?: HookEvaluation;
    insight: string;
}
export declare class SwipeClassifier {
    static analyzePost(record: CompetitorPostRecord): ClassifiedOutlier;
    static rankBatch(records: CompetitorPostRecord[]): ClassifiedOutlier[];
}
