import { HookScorer, HookEvaluation } from './hook-scorer';

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
  outlierMultiple: number; // e.g. 3.4x
  isOutlier: boolean; // >= 3.0x is a proven viral outlier
  hook: string;
  formulaId?: number;
  formulaName: string;
  hookScore?: HookEvaluation;
  insight: string;
}

export class SwipeClassifier {
  public static analyzePost(record: CompetitorPostRecord): ClassifiedOutlier {
    const baseline = record.medianViews && record.medianViews > 0
      ? record.medianViews
      : (record.followers && record.followers > 0 ? record.followers : 1000);

    const baselineType = record.medianViews && record.medianViews > 0 ? 'median' : 'followers';
    const multiple = Math.round((record.views / baseline) * 10) / 10;
    const isOutlier = multiple >= 3.0;

    const classified = HookScorer.classifyFormula(record.hook);
    const formulaName = classified ? classified.name : 'Custom / Unclassified';
    const hookScore = HookScorer.score(record.hook);

    let insight = '';
    if (multiple >= 5.0) {
      insight = `Breakout hit (${multiple}x baseline). Strong viral pattern to model.`;
    } else if (multiple >= 3.0) {
      insight = `Solid outlier (${multiple}x baseline). Outperformed regular content.`;
    } else if (multiple >= 1.0) {
      insight = `Average performance (${multiple}x baseline).`;
    } else {
      insight = `Underperformed baseline (${multiple}x baseline). Avoid this angle.`;
    }

    return {
      account: record.account,
      views: record.views,
      baseline,
      baselineType,
      outlierMultiple: multiple,
      isOutlier,
      hook: record.hook,
      formulaId: classified?.id,
      formulaName,
      hookScore,
      insight
    };
  }

  public static rankBatch(records: CompetitorPostRecord[]): ClassifiedOutlier[] {
    return records
      .map(r => this.analyzePost(r))
      .sort((a, b) => b.outlierMultiple - a.outlierMultiple);
  }
}
