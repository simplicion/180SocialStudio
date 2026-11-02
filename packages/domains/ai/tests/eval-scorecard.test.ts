/**
 * Eval scorecard math. Run: npx tsx --test --test-force-exit packages/domains/ai/tests/eval-scorecard.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScorecard, compareScorecards, duplicateHookPct, repeatedOpenerPct, scoreFixture, FixtureRun } from '../evals/lib/scorecard';
import type { AutopilotPiece } from '../src/content/autopilot/types';

function piece(over: Partial<AutopilotPiece>): AutopilotPiece {
    return {
        slotId: 'd1-1', day: 1, date: '2026-11-10', weekNumber: 1, platforms: ['instagram'], primaryPlatform: 'instagram', format: 'reel',
        pillar: 'Education', topic: 't', angle: 'a', headline: 'h', hookType: 'contrarian', psychologicalJob: 'curiosity',
        spokenHook: 'Your gums bleed because you floss too little, not too much',
        onScreenHook: 'BLEEDING GUMS?', captions: { instagram: { caption: 'Bleeding gums? Keep flossing for a week. Here is why it stops.', cta: 'Save', hashtags: ['#dentalcare'], postingTime: '18:00' } },
        timezone: 'UTC', sources: [], critic: { verdict: 'ok', issues: [] }, status: 'ready', ...over,
    };
}

const run = (pieces: AutopilotPiece[], over: Partial<FixtureRun> = {}): FixtureRun => ({
    fixtureId: 'x', ok: true, durationMs: 10, allowedUrls: ['https://ok.example/a'], agentEvents: {},
    result: { strategy: {} as any, pieces, research: { researchUsed: true }, usage: { calls: 5, inputTokens: 1, outputTokens: 100, estimated: false, byRole: {} }, provider: 'fake' },
    ...over,
});

test('duplicate and repeated-opener detection', () => {
    assert.equal(Math.round(duplicateHookPct(['Stop flossing like this today', 'Stop flossing like this today!', 'A totally different line here'])), 33);
    assert.equal(duplicateHookPct(['one two three four', 'five six seven eight']), 0);
    assert.equal(Math.round(repeatedOpenerPct(['Here is why gums bleed', 'Here is why teeth stain', 'Nobody tells you this'])), 33);
});

test('grounding: citations outside the research list are counted as invented', () => {
    const s = scoreFixture(run([piece({ sources: ['https://ok.example/a'] }), piece({ slotId: 'd2-1', sources: ['https://made-up.example/x'] }), piece({ slotId: 'd3-1' })]));
    assert.equal(s.invalidCitations, 1);
    assert.equal(Math.round(s.trendCitedPct), 67);
});

test('placeholders and needs_review are detected', () => {
    const s = scoreFixture(run([piece({ topic: '<specific topic>' }), piece({ slotId: 'd2-1', status: 'needs_review' })]));
    assert.equal(s.placeholderLeaks, 1);
    assert.equal(s.needsReviewPct, 50);
});

test('failed runs lower reliability and are excluded from quality means', () => {
    const card = buildScorecard([run([piece({})]), run([], { fixtureId: 'y', ok: false, error: 'boom', result: undefined })], { label: 't', provider: 'fake', models: [], suite: 'quick', days: 7 });
    assert.equal(card.aggregate.reliability, 50);
    assert.ok(card.aggregate.hookMean > 0);
});

test('comparison flags regressions beyond tolerance and hard rules', () => {
    const meta = { label: 't', provider: 'fake', models: [], suite: 'quick', days: 7 };
    const good = buildScorecard([run([piece({ sources: ['https://ok.example/a'] })])], meta);
    const bad = buildScorecard([run([piece({ sources: ['https://nope.example/'] })])], meta);
    const cmp = compareScorecards(bad, good);
    assert.ok(cmp.regressions.some((r) => r.key === 'invalidCitations' && r.hard));
    assert.equal(compareScorecards(good, good).regressions.length, 0);
});
