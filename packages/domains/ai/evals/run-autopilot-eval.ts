/**
 * Autopilot eval runner.
 *
 *   pnpm eval:autopilot --suite quick                       # 3 brands x 7 days, real model (ANTHROPIC_API_KEY)
 *   pnpm eval:autopilot --suite full --label after-a6       # 12 brands x 14 days
 *   pnpm eval:autopilot --suite quick --provider builtin    # harness smoke test, no API calls (scores meaningless)
 *   pnpm eval:autopilot --suite quick --save-baseline       # store as evals/baselines/<suite>.json
 *
 * Flags: --suite quick|full, --provider claude|builtin, --label <name>, --only <id,id>, --concurrency <n>,
 *        --baseline <path> (default evals/baselines/<suite>.json if present), --save-baseline.
 * Env:   EVAL_MODEL / EVAL_STRATEGY_MODEL override the production model resolution.
 *
 * Writes evals/results/<label>-<stamp>.{json,md,raw.json}. Exits 1 when a baseline comparison finds a regression.
 */
import * as fs from 'fs';
import * as path from 'path';
import { runAutopilotPipeline, mapLimit } from '../src/content/autopilot/pipeline';
import type { WebSearchProvider } from '../src/content/autopilot/research';
import type { AutopilotRunInput } from '../src/content/autopilot/types';
import { EVAL_FIXTURES, QUICK_SUITE, EvalFixture } from './fixtures/brands';
import { createGeneratorFromEnv } from './lib/llm-from-env';
import { FixtureRun, buildScorecard, compareScorecards, scorecardMarkdown, Scorecard } from './lib/scorecard';

const EVAL_DIR = path.resolve(process.cwd(), 'packages/domains/ai/evals');

function arg(name: string, fallback?: string): string | undefined {
    const i = process.argv.indexOf(`--${name}`);
    if (i === -1) return fallback;
    const v = process.argv[i + 1];
    return v && !v.startsWith('--') ? v : 'true';
}

/** Returns the fixture's frozen results for every query, so research is identical across runs. */
export function fixtureSearch(fixture: EvalFixture): WebSearchProvider {
    return {
        name: 'fixture',
        async search(_q, opts) { return fixture.research.slice(0, opts?.maxResults ?? 5); },
    };
}

export function fixtureInput(fixture: EvalFixture, days: 7 | 14 | 30): AutopilotRunInput {
    return {
        days,
        startDate: '2026-11-10',
        timezone: 'UTC',
        platforms: fixture.platforms,
        goals: fixture.goals,
        brand: fixture.brand,
        campaignName: fixture.campaignName,
        referenceInspirations: fixture.referenceInspirations,
        memoryContext: [],
    };
}

async function runFixture(fixture: EvalFixture, days: 7 | 14 | 30, provider: string): Promise<{ run: FixtureRun; models: string[] }> {
    const llm = createGeneratorFromEnv(provider);
    const agentEvents: Record<string, number> = {};
    const started = Date.now();
    try {
        const result = await runAutopilotPipeline(fixtureInput(fixture, days), {
            llm,
            search: fixtureSearch(fixture),
            concurrency: 2,
            log: (event) => { agentEvents[event] = (agentEvents[event] || 0) + 1; },
        });
        return { run: { fixtureId: fixture.id, ok: true, durationMs: Date.now() - started, result, allowedUrls: fixture.research.map((r) => r.url), agentEvents }, models: [...llm.stats.models] };
    } catch (err: any) {
        return { run: { fixtureId: fixture.id, ok: false, error: `${err?.code || ''} ${err?.message || err}`.trim(), durationMs: Date.now() - started, allowedUrls: [], agentEvents }, models: [...llm.stats.models] };
    }
}

async function main() {
    const suite = arg('suite', 'quick')!;
    if (suite !== 'quick' && suite !== 'full') throw new Error('--suite must be quick or full');
    const provider = arg('provider', 'claude')!;
    const label = arg('label', suite)!;
    const days: 7 | 14 = suite === 'quick' ? 7 : 14;
    const only = arg('only')?.split(',').map((s) => s.trim()).filter(Boolean);
    const ids = only?.length ? only : suite === 'quick' ? QUICK_SUITE : EVAL_FIXTURES.map((f) => f.id);
    const fixtures = ids.map((id) => {
        const f = EVAL_FIXTURES.find((x) => x.id === id);
        if (!f) throw new Error(`unknown fixture "${id}"`);
        return f;
    });
    const concurrency = Math.max(1, Number(arg('concurrency', '2')) || 2);

    console.log(`[eval] suite=${suite} provider=${provider} fixtures=${ids.join(',')} days=${days}`);
    const outs = await mapLimit(fixtures, concurrency, async (f) => {
        const o = await runFixture(f, days, provider);
        console.log(`[eval] ${f.id}: ${o.run.ok ? `${o.run.result!.pieces.length} pieces` : `FAILED ${o.run.error}`} (${(o.run.durationMs / 1000).toFixed(1)}s)`);
        return o;
    });
    const runs = outs.map((o) => o.run);
    const models = [...new Set(outs.flatMap((o) => o.models))];
    const card = buildScorecard(runs, { label, provider, models, suite, days });

    const baselinePath = arg('baseline') ?? path.join(EVAL_DIR, 'baselines', `${suite}.json`);
    let cmp: ReturnType<typeof compareScorecards> | undefined;
    if (baselinePath && fs.existsSync(baselinePath) && arg('save-baseline') !== 'true') {
        const baseline: Scorecard = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
        cmp = compareScorecards(card, baseline);
    }

    const stamp = card.createdAt.replace(/[:.]/g, '-');
    const resultsDir = path.join(EVAL_DIR, 'results');
    fs.mkdirSync(resultsDir, { recursive: true });
    const base = path.join(resultsDir, `${label}-${stamp}`);
    const md = scorecardMarkdown(card, cmp);
    fs.writeFileSync(`${base}.json`, JSON.stringify(card, null, 2));
    fs.writeFileSync(`${base}.md`, md);
    fs.writeFileSync(`${base}.raw.json`, JSON.stringify(runs.map((r) => ({ fixtureId: r.fixtureId, ok: r.ok, pieces: r.result?.pieces || [] })), null, 2));
    if (arg('save-baseline') === 'true') {
        fs.mkdirSync(path.join(EVAL_DIR, 'baselines'), { recursive: true });
        fs.writeFileSync(path.join(EVAL_DIR, 'baselines', `${suite}.json`), JSON.stringify(card, null, 2));
        console.log(`[eval] baseline saved: evals/baselines/${suite}.json`);
    }
    console.log('\n' + md);
    console.log(`[eval] wrote ${base}.{json,md,raw.json}`);
    if (cmp?.regressions.length) process.exitCode = 1;
}

if (require.main === module) {
    main().catch((e) => { console.error(e); process.exit(2); });
}
