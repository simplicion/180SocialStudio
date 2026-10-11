"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SwipeClassifier = void 0;
const hook_scorer_1 = require("./hook-scorer");
class SwipeClassifier {
    static analyzePost(record) {
        const baseline = record.medianViews && record.medianViews > 0
            ? record.medianViews
            : (record.followers && record.followers > 0 ? record.followers : 1000);
        const baselineType = record.medianViews && record.medianViews > 0 ? 'median' : 'followers';
        const multiple = Math.round((record.views / baseline) * 10) / 10;
        const isOutlier = multiple >= 3.0;
        const classified = hook_scorer_1.HookScorer.classifyFormula(record.hook);
        const formulaName = classified ? classified.name : 'Custom / Unclassified';
        const hookScore = hook_scorer_1.HookScorer.score(record.hook);
        let insight = '';
        if (multiple >= 5.0) {
            insight = `Breakout hit (${multiple}x baseline). Strong viral pattern to model.`;
        }
        else if (multiple >= 3.0) {
            insight = `Solid outlier (${multiple}x baseline). Outperformed regular content.`;
        }
        else if (multiple >= 1.0) {
            insight = `Average performance (${multiple}x baseline).`;
        }
        else {
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
    static rankBatch(records) {
        return records
            .map(r => this.analyzePost(r))
            .sort((a, b) => b.outlierMultiple - a.outlierMultiple);
    }
}
exports.SwipeClassifier = SwipeClassifier;
