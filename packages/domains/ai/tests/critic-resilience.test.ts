import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseCriticBatch } from '../src/content/autopilot/normalizers';
import { runCriticAgent } from '../src/content/autopilot/critic';
import { CriticReviewSchema } from '../src/content/autopilot/schemas';
import type { AutopilotLLM } from '../src/content/autopilot/llm';
import type { AutopilotBrandContext, AutopilotPiece } from '../src/content/autopilot/types';

const brand: AutopilotBrandContext = {
    brandName: 'Test Brand',
    industry: 'Technology',
    positioning: 'AI Tools',
    tone: 'Expert',
    audience: 'Founders',
    forbiddenWords: ['forbidden_test_word'],
    defaultHashtags: ['#test'],
    standardCtas: ['Try it'],
    promptContext: 'Brand: Test Brand',
};

function createSamplePiece(slotId: string): AutopilotPiece {
    return {
        slotId,
        day: 1,
        date: '2026-11-03',
        weekNumber: 1,
        platforms: ['instagram', 'linkedin'],
        primaryPlatform: 'instagram',
        format: 'reel',
        pillar: 'Authority',
        topic: 'Growth Strategies',
        angle: 'Framework',
        headline: 'Scale fast',
        hookType: 'curiosity_gap',
        spokenHook: 'Here is how to scale',
        onScreenHook: 'SCALE FAST',
        shotNotes: ['Camera at eye level'],
        captions: {
            instagram: { caption: 'Great caption for IG', cta: 'Follow', hashtags: ['#growth'], postingTime: '12:00' },
            linkedin: { caption: 'Great copy for LI', cta: 'Connect', hashtags: ['#business'], postingTime: '09:00' },
        },
        timezone: 'UTC',
        sources: [],
        critic: { verdict: 'ok', issues: [] },
        status: 'ready',
    };
}

test('normaliseCriticBatch: normalizes bare arrays, alternate verdicts and missing slotIds', () => {
    const pieces = [createSamplePiece('d1-1'), createSamplePiece('d1-2')];
    
    // LLM returned bare array with uppercase 'OK' and missing d1-2
    const raw = [
        {
            slotId: 'd1-1',
            verdict: 'Approved',
            issues: 'Minor wording issue',
            fixes: { instagram: 'Updated IG caption' },
        },
    ];

    const normalized = normaliseCriticBatch(raw, pieces);
    assert.ok(Array.isArray(normalized.items));
    assert.equal(normalized.items.length, 2);

    const item1 = normalized.items.find((i: any) => i.slotId === 'd1-1');
    assert.ok(item1);
    assert.equal(item1.verdict, 'ok');
    assert.deepEqual(item1.issues, ['Minor wording issue']);
    assert.deepEqual(item1.fixes, [{ platform: 'instagram', caption: 'Updated IG caption' }]);

    const item2 = normalized.items.find((i: any) => i.slotId === 'd1-2');
    assert.ok(item2);
    assert.equal(item2.verdict, 'ok');
    assert.deepEqual(item2.issues, []);
    assert.deepEqual(item2.fixes, []);

    // Verify it passes CriticReviewSchema cleanly
    const parsed = CriticReviewSchema.safeParse(normalized);
    assert.ok(parsed.success);
});

test('normaliseCriticBatch: handles wrapped objects like { reviews: [...] }', () => {
    const pieces = [createSamplePiece('d1-1')];
    const raw = {
        reviews: [
            {
                slotId: 'd1-1',
                verdict: 'FIXED',
                issues: ['Removed typo'],
                fixes: [{ platform: 'INSTAGRAM', caption: 'Cleaned up' }],
            },
        ],
    };

    const normalized = normaliseCriticBatch(raw, pieces);
    const parsed = CriticReviewSchema.safeParse(normalized);
    assert.ok(parsed.success);
    assert.equal(parsed.data.items[0].verdict, 'fixed');
    assert.equal(parsed.data.items[0].fixes[0].platform, 'instagram');
});

test('runCriticAgent: gracefully handles LLM failures without throwing', async () => {
    const pieces = [createSamplePiece('d1-1')];

    // LLM returns totally broken output twice
    const failingLlm: AutopilotLLM = {
        provider: 'mock-failing',
        async complete() {
            return {
                text: 'This is invalid non-JSON output from an erratic LLM model.',
                model: 'mock',
                usage: { inputTokens: 10, outputTokens: 10, estimated: true },
            };
        },
    };

    // Must NOT throw
    await assert.doesNotReject(async () => {
        await runCriticAgent({
            llm: failingLlm,
            brand,
            pieces,
        });
    });

    assert.equal(pieces[0].critic.verdict, 'ok');
});
