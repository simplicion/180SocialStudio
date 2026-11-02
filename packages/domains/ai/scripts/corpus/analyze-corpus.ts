/**
 * Analyses an exported corpus and writes:
 *   corpus-report.md       internal report (contains short text fragments such as common openers; do not share)
 *   winning-patterns.json  aggregates only (no customer text) — safe to commit and to feed global prompt rules
 *
 *   npx tsx packages/domains/ai/scripts/corpus/analyze-corpus.ts <corpus.jsonl> [--out-dir <dir>]
 *
 * Outcome modelling only runs with enough labelled data (MIN_LABELLED); below that the report says so instead of
 * presenting noise as a pattern. A learned model is reported as usable only when its cross-validated AUC beats the
 * HookScorer-alone baseline by a margin.
 */
import * as fs from 'fs';
import * as path from 'path';
import { auditQuality, outcomeSamples } from './corpus-features';
import type { CorpusRow } from './export-corpus';
import {
    buildFeatureSpace, crossValidatedAuc, featureNames, labelAgainstOwnBaseline, liftTable, singleFeatureAuc, trainLogistic, vectorize,
} from '../../src/content/learning/outcome-model';

export const MIN_LABELLED = 60;
export const MIN_AUC_GAIN = 0.03;

export function analyze(rows: CorpusRow[]) {
    const quality = auditQuality(rows);
    const labelled = labelAgainstOwnBaseline(outcomeSamples(rows));
    const groups = new Set(labelled.map((s) => s.group)).size;
    let outcome: any = { labelled: labelled.length, groups, enough: labelled.length >= MIN_LABELLED };
    if (outcome.enough) {
        const space = buildFeatureSpace(labelled);
        const modelAuc = crossValidatedAuc(labelled, space);
        const hookAuc = singleFeatureAuc(labelled, 'hookScore');
        const names = featureNames(space);
        const model = trainLogistic(labelled.map((s) => vectorize(s, space)), labelled.map((s) => (s.top ? 1 : 0)), names);
        const coefficients = names.map((n, i) => ({ feature: n, weight: Math.round(model.weights[i] * 1000) / 1000 }))
            .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)).slice(0, 20);
        outcome = {
            ...outcome,
            lift: liftTable(labelled),
            modelAuc,
            hookScorerAuc: hookAuc,
            modelUsable: modelAuc >= hookAuc + MIN_AUC_GAIN && modelAuc >= 0.6,
            coefficients,
        };
    }
    return { generatedAt: new Date().toISOString(), rows: rows.length, quality, outcome };
}

export function reportMarkdown(a: ReturnType<typeof analyze>): string {
    const q = a.quality, o = a.outcome;
    const L: string[] = [
        '# Content corpus report', '', `${a.generatedAt} · ${a.rows} pieces (${q.autopilotPieces} from the autopilot pipeline)`, '',
        '## Quality audit (all generated pieces)', '',
        '| Check | Value |', '|---|---|',
        `| Formats | ${Object.entries(q.byFormat).map(([k, v]) => `${k} ${v}`).join(', ')} |`,
        `| Hook score mean | ${q.hook.mean} |`,
        `| Hooks STRONG or better | ${q.hook.strongPct}% |`,
        `| Hooks with a dealbreaker | ${q.hook.dealbreakerPct}% |`,
        `| Exact duplicate hooks within a calendar | ${q.duplicateHooksWithinCalendarPct}% |`,
        `| Placeholder leaks | ${q.placeholderLeakPct}% |`,
        `| Reels missing a retention loop | ${q.reels.missingLoopPct}% of ${q.reels.n} |`,
        `| Reels whose script length misses the target duration by >30% | ${q.reels.lengthMismatchPct}% |`,
        `| Captions with filler hashtags | ${q.fillerHashtagPct}% |`,
        `| Pieces needing review | ${q.needsReviewPct}% |`,
        `| Critic flags | ${q.criticFlagPct}% |`,
        '', '### Most repeated hook openers (template-y writing)', '',
        ...q.topOpeners.map((x) => `- "${x.opener}" × ${x.count}`),
        '', '### Most frequent stock-AI phrases in captions', '',
        ...q.topSlop.map((x) => `- "${x.phrase}" × ${x.count}`),
        '', '### Most repeated CTAs', '',
        ...q.topCtas.map((x) => `- "${x.cta}" × ${x.count}`),
        '', '### Hook type share', '', ...Object.entries(q.hookTypeShare).map(([k, v]) => `- ${k}: ${v}%`),
        '', '### Psychological job share', '', ...Object.entries(q.psychJobShare).map(([k, v]) => `- ${k}: ${v}%`),
        '', '## Outcome analysis (published posts with metrics)', '',
        `Labelled posts: ${o.labelled} across ${o.groups} project/platform groups (each post compared with its own project's median).`, '',
    ];
    if (!o.enough) {
        L.push(`**Insufficient data**: at least ${MIN_LABELLED} labelled posts are needed before patterns are trustworthy. Re-run when more published posts have metrics.`);
    } else {
        L.push(`Cross-validated AUC: model ${o.modelAuc} vs HookScorer alone ${o.hookScorerAuc} → ${o.modelUsable ? '**model usable for calibration**' : 'model NOT better than the heuristic; keep the heuristic'}.`, '',
            '### What over- and under-performs (lift vs overall top-quartile rate; n ≥ 8)', '',
            '| Feature | Value | n | Top-quartile rate | Mean × own median | Lift |', '|---|---|---|---|---|---|',
            ...o.lift.map((r: any) => `| ${r.feature} | ${r.value} | ${r.n} | ${Math.round(r.topRate * 100)}% | ${r.meanMultiple} | ${r.lift} |`),
            '', '### Strongest model coefficients (standardised)', '', ...o.coefficients.map((c: any) => `- ${c.feature}: ${c.weight}`));
    }
    return L.join('\n') + '\n';
}

/** Aggregates only: no openers, CTAs or slop phrases (those are customer text). */
export function winningPatterns(a: ReturnType<typeof analyze>) {
    const { topOpeners, topSlop, topCtas, ...quality } = a.quality;
    return { generatedAt: a.generatedAt, rows: a.rows, quality, outcome: a.outcome };
}

function main() {
    const input = process.argv[2];
    if (!input) throw new Error('usage: analyze-corpus.ts <corpus.jsonl> [--out-dir <dir>]');
    const i = process.argv.indexOf('--out-dir');
    const outDir = i > -1 ? process.argv[i + 1] : path.dirname(input);
    const rows: CorpusRow[] = fs.readFileSync(input, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const result = analyze(rows);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'corpus-report.md'), reportMarkdown(result));
    fs.writeFileSync(path.join(outDir, 'winning-patterns.json'), JSON.stringify(winningPatterns(result), null, 2));
    console.log(reportMarkdown(result));
    console.log(`[corpus] wrote ${outDir}/corpus-report.md and winning-patterns.json`);
}

if (require.main === module) main();
