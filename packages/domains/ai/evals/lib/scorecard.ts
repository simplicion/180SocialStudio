/**
 * Deterministic scorecard for autopilot runs. Every number here is computed from the pipeline output with the
 * platform craft kit, so two runs can be compared without a model in the loop. (The pairwise LLM judge lives in
 * judge-pairwise.ts and is reported separately.)
 */
import { HookScorer, PlatformCopyLinter, TextHumanizer, toCraftPlatform } from '../../src/content/craft';
import type { AutopilotPiece, AutopilotRunResult } from '../../src/content/autopilot/types';
import { HOOK_TYPES } from '../../src/content/autopilot/schemas';

export interface FixtureRun {
    fixtureId: string;
    ok: boolean;
    error?: string;
    durationMs: number;
    result?: AutopilotRunResult;
    /** URLs the research provider returned; any citation outside this set is invented. */
    allowedUrls: string[];
    /** Counts of json-agent log events (agent_repair, agent_repaired_with_warnings, agent_fallback_v1_schema_data). */
    agentEvents: Record<string, number>;
}

export interface FixtureScore {
    fixtureId: string;
    ok: boolean;
    error?: string;
    pieces: number;
    hookMean: number;
    hookMin: number;
    hookStrongPct: number;
    craftMean: number;
    blockingPerPiece: number;
    humanMean: number;
    lintFailsPerCopy: number;
    dupHookPct: number;
    repeatedOpenerPct: number;
    hookTypeCoverage: number;
    maxJobShare: number;
    trendCitedPct: number;
    invalidCitations: number;
    needsReviewPct: number;
    placeholderLeaks: number;
    repairs: number;
    calls: number;
    outputTokens: number;
    durationMs: number;
}

export interface Scorecard {
    createdAt: string;
    label: string;
    provider: string;
    models: string[];
    suite: string;
    days: number;
    aggregate: Omit<FixtureScore, 'fixtureId' | 'ok' | 'error'> & { reliability: number; runs: number };
    fixtures: FixtureScore[];
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const round = (x: number, d = 1) => Math.round(x * 10 ** d) / 10 ** d;
const pct = (n: number, d: number) => (d ? (n / d) * 100 : 0);

export function normaliseText(s: string): string {
    return (s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function trigrams(s: string): Set<string> {
    const w = normaliseText(s).split(' ').filter(Boolean);
    const out = new Set<string>();
    for (let i = 0; i + 2 < w.length; i++) out.add(`${w[i]} ${w[i + 1]} ${w[i + 2]}`);
    if (!out.size && w.length) out.add(w.join(' '));
    return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
    if (!a.size && !b.size) return 1;
    let inter = 0;
    for (const x of a) if (b.has(x)) inter++;
    return inter / (a.size + b.size - inter);
}

/** % of hooks that duplicate (or nearly duplicate, trigram Jaccard >= 0.6) an earlier hook in the same run. */
export function duplicateHookPct(hooks: string[]): number {
    const seen: Set<string>[] = [];
    let dup = 0;
    for (const h of hooks) {
        const t = trigrams(h);
        if (seen.some((s) => jaccard(s, t) >= 0.6)) dup++;
        seen.push(t);
    }
    return pct(dup, hooks.length);
}

/** % of hooks whose first three words were already used to open another hook. */
export function repeatedOpenerPct(hooks: string[]): number {
    const counts = new Map<string, number>();
    for (const h of hooks) {
        const k = normaliseText(h).split(' ').slice(0, 3).join(' ');
        if (k) counts.set(k, (counts.get(k) || 0) + 1);
    }
    let repeated = 0;
    for (const n of counts.values()) if (n > 1) repeated += n - 1;
    return pct(repeated, hooks.length);
}

const isVideo = (p: AutopilotPiece) => p.format === 'reel';
const PLACEHOLDER_RE = /<[a-z][a-z ,'/-]{2,80}>/i;

export function scoreFixture(run: FixtureRun): FixtureScore {
    const base: FixtureScore = {
        fixtureId: run.fixtureId, ok: run.ok, error: run.error, pieces: 0, hookMean: 0, hookMin: 0, hookStrongPct: 0, craftMean: 0,
        blockingPerPiece: 0, humanMean: 0, lintFailsPerCopy: 0, dupHookPct: 0, repeatedOpenerPct: 0, hookTypeCoverage: 0, maxJobShare: 0,
        trendCitedPct: 0, invalidCitations: 0, needsReviewPct: 0, placeholderLeaks: 0,
        repairs: (run.agentEvents.agent_repair || 0) + (run.agentEvents.agent_fallback_v1_schema_data || 0),
        calls: run.result?.usage.calls || 0, outputTokens: run.result?.usage.outputTokens || 0, durationMs: run.durationMs,
    };
    const pieces = run.result?.pieces || [];
    if (!run.ok || !pieces.length) return base;

    const hooks = pieces.map((p) => p.spokenHook || '');
    const evals = pieces.map((p) => HookScorer.score(p.spokenHook || '', isVideo(p) ? {} : { spoken: false }));
    const hookScores = evals.map((e) => e.totalScore);

    let copies = 0, lintFails = 0;
    const human: number[] = [];
    for (const p of pieces) {
        for (const [platform, c] of Object.entries(p.captions)) {
            if (!c) continue;
            const cp = toCraftPlatform(platform);
            const text = `${c.caption}${c.hashtags.length ? `\n\n${c.hashtags.join(' ')}` : ''}`;
            copies++;
            if (cp) lintFails += PlatformCopyLinter.analyze(cp, text).checks.filter((k) => k.status === 'FAIL').length;
            human.push(TextHumanizer.detect(c.caption).overallScore);
        }
    }

    const allowed = new Set(run.allowedUrls);
    const jobCounts = new Map<string, number>();
    for (const p of pieces) if (p.psychologicalJob) jobCounts.set(p.psychologicalJob, (jobCounts.get(p.psychologicalJob) || 0) + 1);

    return {
        ...base,
        pieces: pieces.length,
        hookMean: round(mean(hookScores)),
        hookMin: Math.min(...hookScores),
        hookStrongPct: round(pct(evals.filter((e) => e.grade === 'EXCELLENT' || e.grade === 'STRONG').length, evals.length)),
        craftMean: round(mean(pieces.map((p) => p.craft?.score ?? 0))),
        blockingPerPiece: round(mean(pieces.map((p) => p.craft?.blocking.length ?? 0)), 2),
        humanMean: round(mean(human)),
        lintFailsPerCopy: round(copies ? lintFails / copies : 0, 2),
        dupHookPct: round(duplicateHookPct(hooks)),
        repeatedOpenerPct: round(repeatedOpenerPct(hooks)),
        hookTypeCoverage: round(pct(new Set(pieces.map((p) => p.hookType)).size, Math.min(HOOK_TYPES.length, pieces.length))),
        maxJobShare: round(pct(Math.max(0, ...jobCounts.values()), pieces.length)),
        trendCitedPct: round(pct(pieces.filter((p) => p.sources.length > 0).length, pieces.length)),
        invalidCitations: pieces.reduce((n, p) => n + p.sources.filter((u) => !allowed.has(u)).length, 0),
        needsReviewPct: round(pct(pieces.filter((p) => p.status === 'needs_review').length, pieces.length)),
        placeholderLeaks: pieces.filter((p) => PLACEHOLDER_RE.test(JSON.stringify(p))).length,
    };
}

export function buildScorecard(runs: FixtureRun[], meta: { label: string; provider: string; models: string[]; suite: string; days: number }): Scorecard {
    const fixtures = runs.map(scoreFixture);
    const ok = fixtures.filter((f) => f.ok && f.pieces > 0);
    const avg = (k: keyof FixtureScore) => round(mean(ok.map((f) => Number(f[k]) || 0)), 2);
    const sum = (k: keyof FixtureScore) => fixtures.reduce((n, f) => n + (Number(f[k]) || 0), 0);
    return {
        createdAt: new Date().toISOString(),
        ...meta,
        aggregate: {
            runs: fixtures.length,
            reliability: round(pct(ok.length, fixtures.length)),
            pieces: sum('pieces'),
            hookMean: avg('hookMean'), hookMin: ok.length ? Math.min(...ok.map((f) => f.hookMin)) : 0, hookStrongPct: avg('hookStrongPct'),
            craftMean: avg('craftMean'), blockingPerPiece: avg('blockingPerPiece'), humanMean: avg('humanMean'), lintFailsPerCopy: avg('lintFailsPerCopy'),
            dupHookPct: avg('dupHookPct'), repeatedOpenerPct: avg('repeatedOpenerPct'), hookTypeCoverage: avg('hookTypeCoverage'), maxJobShare: avg('maxJobShare'),
            trendCitedPct: avg('trendCitedPct'), invalidCitations: sum('invalidCitations'), needsReviewPct: avg('needsReviewPct'),
            placeholderLeaks: sum('placeholderLeaks'), repairs: sum('repairs'), calls: sum('calls'), outputTokens: sum('outputTokens'),
            durationMs: Math.round(mean(fixtures.map((f) => f.durationMs))),
        },
        fixtures,
    };
}

/** Regression rules for merging an agent change. Higher-is-better and lower-is-better metrics with tolerances. */
const RULES: { key: keyof Scorecard['aggregate']; better: 'higher' | 'lower'; tolerance: number; hard?: boolean }[] = [
    { key: 'reliability', better: 'higher', tolerance: 0, hard: true },
    { key: 'invalidCitations', better: 'lower', tolerance: 0, hard: true },
    { key: 'placeholderLeaks', better: 'lower', tolerance: 0, hard: true },
    { key: 'trendCitedPct', better: 'higher', tolerance: 5 },
    { key: 'hookMean', better: 'higher', tolerance: 3 },
    { key: 'hookStrongPct', better: 'higher', tolerance: 5 },
    { key: 'craftMean', better: 'higher', tolerance: 3 },
    { key: 'humanMean', better: 'higher', tolerance: 3 },
    { key: 'lintFailsPerCopy', better: 'lower', tolerance: 0.1 },
    { key: 'dupHookPct', better: 'lower', tolerance: 5 },
    { key: 'repeatedOpenerPct', better: 'lower', tolerance: 5 },
    { key: 'needsReviewPct', better: 'lower', tolerance: 5 },
];

export interface Comparison { key: string; baseline: number; current: number; delta: number; status: 'better' | 'same' | 'worse'; hard: boolean }

export function compareScorecards(current: Scorecard, baseline: Scorecard): { rows: Comparison[]; regressions: Comparison[] } {
    const rows = RULES.map(({ key, better, tolerance, hard }) => {
        const b = Number(baseline.aggregate[key]) || 0;
        const c = Number(current.aggregate[key]) || 0;
        const delta = round(c - b, 2);
        const worse = better === 'higher' ? c < b - tolerance : c > b + tolerance;
        const improved = better === 'higher' ? c > b : c < b;
        return { key, baseline: b, current: c, delta, status: worse ? 'worse' : improved ? 'better' : 'same', hard: !!hard } as Comparison;
    });
    return { rows, regressions: rows.filter((r) => r.status === 'worse') };
}

export function scorecardMarkdown(card: Scorecard, cmp?: ReturnType<typeof compareScorecards>): string {
    const a = card.aggregate;
    const lines = [
        `# Autopilot eval — ${card.label}`,
        '',
        `${card.createdAt} · provider ${card.provider} · models ${card.models.join(', ')} · suite ${card.suite} · ${card.days} days`,
        '',
        '| Metric | Value |', '|---|---|',
        `| Reliability (runs that produced pieces) | ${a.reliability}% of ${a.runs} |`,
        `| Pieces | ${a.pieces} |`,
        `| Hook score mean / min | ${a.hookMean} / ${a.hookMin} |`,
        `| Hooks STRONG or better | ${a.hookStrongPct}% |`,
        `| Craft score mean | ${a.craftMean} |`,
        `| Blocking craft issues per piece | ${a.blockingPerPiece} |`,
        `| Caption human score | ${a.humanMean} |`,
        `| Lint FAILs per caption | ${a.lintFailsPerCopy} |`,
        `| Duplicate hooks | ${a.dupHookPct}% |`,
        `| Repeated openers | ${a.repeatedOpenerPct}% |`,
        `| Hook-type coverage | ${a.hookTypeCoverage}% |`,
        `| Largest psychological-job share | ${a.maxJobShare}% |`,
        `| Pieces citing research | ${a.trendCitedPct}% |`,
        `| Invented citations | ${a.invalidCitations} |`,
        `| Needs review | ${a.needsReviewPct}% |`,
        `| Placeholder leaks | ${a.placeholderLeaks} |`,
        `| Agent repairs | ${a.repairs} |`,
        `| AI calls / output tokens | ${a.calls} / ${a.outputTokens} |`,
        `| Mean run time | ${(a.durationMs / 1000).toFixed(1)} s |`,
        '',
        '## Per fixture',
        '',
        '| Fixture | OK | Pieces | Hook | Strong% | Human | Dup% | Cited% | Review% | Error |', '|---|---|---|---|---|---|---|---|---|---|',
        ...card.fixtures.map((f) => `| ${f.fixtureId} | ${f.ok ? 'yes' : 'NO'} | ${f.pieces} | ${f.hookMean} | ${f.hookStrongPct} | ${f.humanMean} | ${f.dupHookPct} | ${f.trendCitedPct} | ${f.needsReviewPct} | ${(f.error || '').slice(0, 80).replace(/\|/g, '/')} |`),
    ];
    if (cmp) {
        lines.push('', '## vs baseline', '', '| Metric | Baseline | Current | Δ | Status |', '|---|---|---|---|---|',
            ...cmp.rows.map((r) => `| ${r.key}${r.hard ? ' (hard)' : ''} | ${r.baseline} | ${r.current} | ${r.delta > 0 ? '+' : ''}${r.delta} | ${r.status === 'worse' ? '**WORSE**' : r.status} |`),
            '', cmp.regressions.length ? `**${cmp.regressions.length} regression(s).** Do not merge until fixed.` : 'No regressions.');
    }
    return lines.join('\n') + '\n';
}
