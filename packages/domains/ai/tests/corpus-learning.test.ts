/**
 * Outcome model + corpus analysis. Run: npx tsx --test --test-force-exit packages/domains/ai/tests/corpus-learning.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    auc, buildFeatureSpace, crossValidatedAuc, labelAgainstOwnBaseline, liftTable, OutcomeSample,
} from '../src/content/learning/outcome-model';
import { analyze, winningPatterns, MIN_LABELLED } from '../scripts/corpus/analyze-corpus';
import { auditQuality, outcomeSamples } from '../scripts/corpus/corpus-features';
import { hashId, parsePayload, CorpusRow } from '../scripts/corpus/export-corpus';

/** Deterministic pseudo-random generator so tests never flake. */
function rng(seed: number) {
    return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
}

test('auc: perfect, inverted and random rankings', () => {
    assert.equal(auc([0.9, 0.8, 0.2, 0.1], [1, 1, 0, 0]), 1);
    assert.equal(auc([0.1, 0.2, 0.8, 0.9], [1, 1, 0, 0]), 0);
    assert.equal(auc([0.5, 0.5], [1, 0]), 0.5);
    assert.equal(auc([0.3], [1]), 0.5);
});

test('labels are relative to each group\'s own median; small groups are dropped', () => {
    const s = (group: string, value: number): OutcomeSample => ({ group, value, categorical: {}, numeric: {} });
    const big = [100, 200, 300, 400, 5000, 6000, 7000, 8000].map((v) => s('big', v));
    const small = [1, 2, 3, 400, 500].map((v) => s('small', v));
    const tiny = [1, 2].map((v) => s('tiny', v));
    const out = labelAgainstOwnBaseline([...big, ...small, ...tiny]);
    assert.equal(out.length, 13);
    assert.ok(out.find((x) => x.group === 'big' && x.value === 8000)!.top);
    // 400 is top in the small account but not in the big one: never compared across accounts.
    assert.ok(out.find((x) => x.group === 'small' && x.value === 400)!.top);
    assert.ok(!out.find((x) => x.group === 'big' && x.value === 400)!.top);
});

test('logistic model recovers a planted signal and ignores noise', () => {
    const r = rng(7);
    const make = (signal: boolean): OutcomeSample[] => Array.from({ length: 240 }, (_, i) => {
        const story = r() < 0.5;
        const noise = r();
        const base = 100 + r() * 50;
        const value = signal && story ? base * 3 : base;
        return { group: `p${i % 6}`, value, categorical: { hookType: story ? 'story' : 'contrarian' }, numeric: { noise } };
    });
    const planted = labelAgainstOwnBaseline(make(true));
    assert.ok(crossValidatedAuc(planted, buildFeatureSpace(planted)) > 0.8);
    const lift = liftTable(planted);
    assert.ok(lift.find((x) => x.value === 'story')!.lift > 1.5);

    const noisy = labelAgainstOwnBaseline(make(false));
    const noiseAuc = crossValidatedAuc(noisy, buildFeatureSpace(noisy));
    assert.ok(noiseAuc < 0.65, `noise AUC should be near 0.5, got ${noiseAuc}`);
});

function row(i: number, over: Partial<CorpusRow> = {}, views?: number): CorpusRow {
    const hook = i % 2 ? 'Your gums bleed because you floss too little, not too much' : 'So today I want to talk about flossing';
    return {
        pieceId: `p${i}`, company: 'c', project: `proj${i % 3}`, calendar: `cal${i % 4}`, createdAt: '2026-10-01T00:00:00Z', autopilot: true,
        platform: 'instagram', contentType: 'Reel', pillar: 'Edu', headline: 'h', status: i % 5 ? 'ready' : 'needs_review', caption: '', postingTime: '18:30 UTC',
        payload: {
            schema: 'autopilot.v1', format: 'reel', hookType: i % 2 ? 'contrarian' : 'story', psychologicalJob: 'curiosity', spokenHook: hook,
            script: { hook, body: [{ beat: 'one two three' }, { beat: 'four five six' }], retentionLoop: i % 3 ? 'loop' : '', cta: 'Save this', estimatedDurationSec: 20 },
            captions: { instagram: { caption: 'In today\'s fast-paced world, unlock the power of flossing. Here is the fix.', hashtags: ['#love'] } }, sources: [], critic: { verdict: 'ok' },
        },
        post: views === undefined ? null : { status: 'published', publishedAt: '2026-10-02T00:00:00Z', variants: [{ platform: 'instagram', publishStatus: 'published', metrics: { views, likes: null, comments: null } }] },
        ...over,
    };
}

test('quality audit finds duplicates, missing loops, slop and filler hashtags', () => {
    const rows = Array.from({ length: 12 }, (_, i) => row(i));
    const q = auditQuality(rows);
    assert.equal(q.autopilotPieces, 12);
    assert.ok(q.duplicateHooksWithinCalendarPct > 0);
    assert.ok(q.reels.missingLoopPct > 0);
    assert.ok(q.fillerHashtagPct > 0);
    assert.ok(q.topSlop.length > 0);
    assert.ok(q.needsReviewPct > 0);
});

test('outcome samples use views, group by project+platform+basis, and skip unpublished', () => {
    const rows = [row(1, {}, 500), row(2), row(3, { post: { status: 'published', publishedAt: null, variants: [{ platform: 'instagram', publishStatus: 'failed', metrics: { views: 9 } }] } })];
    const s = outcomeSamples(rows);
    assert.equal(s.length, 1);
    assert.equal(s[0].value, 500);
    assert.equal(s[0].group, 'proj1:instagram:views');
    assert.equal(s[0].categorical.hookType, 'contrarian');
});

test('analysis refuses to model with too little data, and the shareable file has no customer text', () => {
    const few = analyze(Array.from({ length: 10 }, (_, i) => row(i, {}, 100 + i)));
    assert.equal(few.outcome.enough, false);
    const shared = JSON.stringify(winningPatterns(few));
    assert.ok(!shared.includes('fast-paced'));
    assert.ok(!('topOpeners' in winningPatterns(few).quality));

    const many = analyze(Array.from({ length: MIN_LABELLED + 30 }, (_, i) => row(i, {}, i % 2 ? 900 : 100)));
    assert.equal(many.outcome.enough, true);
    assert.ok(typeof many.outcome.modelAuc === 'number');
});

test('export helpers: payload detection and stable salted hashes', () => {
    assert.equal(parsePayload('{"schema":"autopilot.v1","x":1}')!.x, 1);
    assert.equal(parsePayload('{"schema":"other"}'), null);
    assert.equal(parsePayload('not json'), null);
    assert.equal(hashId('abc', 'salt-123456789'), hashId('abc', 'salt-123456789'));
    assert.notEqual(hashId('abc', 'salt-123456789'), hashId('abc', 'other-salt-9999'));
    assert.equal(hashId(null, 's'), '');
});
