/**
 * PRODUCTION_READINESS_PLAN P3: the content mix decides the exact slots, and the normalisers never write content.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { planCadence, describePlan, planMismatches } from '../src/content/autopilot/cadence';
import { normaliseStrategy, normaliseHookScript, hookScriptProblems, normaliseCopy } from '../src/content/autopilot/normalizers';
import { ContentMixConfigSchema } from '../src/content/autopilot/schemas';

const mix = (over: any) => ContentMixConfigSchema.parse(over);

test('no mix: the strategist decides (one slot per day)', () => {
    assert.equal(planCadence(30, undefined, ['instagram']), null);
});

test('daily 2 carousels + 1 reel for 30 days = 90 exact slots', () => {
    const plan = planCadence(30, mix({ mode: 'custom', dailyReels: 1, dailyCarousels: 2 }), ['instagram'])!;
    assert.equal(plan.length, 90);
    assert.deepEqual(plan.filter((s) => s.day === 7).map((s) => s.format), ['reel', 'carousel', 'carousel']);
    assert.match(describePlan(plan), /^Day 1: reel, carousel, carousel$/m);
});

test('alternate: reel on odd days, carousel on even days (mode or preset)', () => {
    for (const m of [{ mode: 'alternate' }, { mode: 'preset', preset: 'alternate', dailyReels: 1, dailyCarousels: 1 }]) {
        const plan = planCadence(7, mix(m), ['instagram'])!;
        assert.deepEqual(plan.map((s) => `${s.day}${s.format[0]}`), ['1r', '2c', '3r', '4c', '5r', '6c', '7r']);
    }
});

test('invalid mixes are refused with a reason, never silently changed', () => {
    assert.throws(() => planCadence(7, mix({ dailyReels: 0, dailyCarousels: 0 }), ['instagram']), /at least one/);
    assert.throws(() => planCadence(7, mix({ dailyReels: 0, dailyCarousels: 1 }), ['youtube', 'x']), /carousels/);
    assert.throws(() => planCadence(31, mix({ dailyReels: 2, dailyCarousels: 2 }), ['instagram']), /124 pieces/);
});

test('plan mismatches are reported as repair instructions', () => {
    const plan = planCadence(2, mix({ dailyReels: 1, dailyCarousels: 1 }), ['instagram'])!;
    assert.deepEqual(planMismatches(plan, [{ day: 1, format: 'reel' }, { day: 1, format: 'carousel' }, { day: 2, format: 'reel' }, { day: 2, format: 'reel' }]), [
        'Day 2 needs exactly 1 reel slot(s); you returned 2',
        'Day 2 needs exactly 1 carousel slot(s); you returned 0',
    ]);
    assert.deepEqual(planMismatches(plan, plan), []);
});

test('strategy normaliser fixes shape but invents nothing', () => {
    const out = normaliseStrategy(
        {
            pillars: [{ name: 'Brewing', percent: 3, purpose: 'teach' }, { name: 'Beans', percent: 1, purpose: 'origin stories' }, { name: '', purpose: 'x' }],
            slots: [
                { day: 40, topic: 'Grind size', angle: 'Most people grind too coarse', format: 'carousel', platforms: ['tiktok', 'instagram'], sourceUrls: ['https://evil.example'] },
                { day: 2, format: 'reel' }, // no topic/angle: dropped, not templated
            ],
        },
        { days: 30, platforms: ['instagram', 'tiktok'], allowedUrls: new Set(), brandPositioning: null },
    );
    assert.equal(out.audiencePsychology, undefined);
    assert.equal(out.positioningAngle, undefined);
    assert.deepEqual(out.pillars.map((p: any) => p.percent), [75, 25]);
    assert.equal(out.slots.length, 1);
    assert.equal(out.slots[0].day, 30);
    assert.deepEqual(out.slots[0].sourceUrls, []);
    assert.equal(out.slots[0].visualDirection, undefined);
});

test('hook/script: shape fixed, problems reported instead of truncation or stock text', () => {
    const chunk = [
        { slotId: 's1', format: 'reel', topic: 'Grind size' },
        { slotId: 's2', format: 'carousel', topic: 'Water', slideCount: 3 },
    ];
    const n = normaliseHookScript([{ slotId: 's1', hook: 'one two three four five six seven eight nine ten eleven twelve thirteen', script: { body: ['a', 'b'] } }], chunk);
    const item = n.items[0];
    assert.equal(item.headline, 'Grind size'); // the strategist's own topic
    assert.equal(item.script.cta, undefined);
    assert.deepEqual(item.script.body, [{ beat: 'a' }, { beat: 'b' }]);
    const problems = hookScriptProblems(n.items, chunk);
    assert.ok(problems.some((p) => /13 words/.test(p)));
    assert.ok(problems.some((p) => /3-6 beats/.test(p)));
    assert.ok(problems.some((p) => /cta is missing/.test(p)));
    assert.ok(problems.some((p) => /missing item for slotId s2/.test(p)));
    assert.ok(!JSON.stringify(n).match(/Stop scrolling|Save this|Comment below|Key Insight/));
});

test('hook/script attempt 2: self-heals missing items, shot notes, cta and condenses spoken hook', () => {
    const chunk = [
        { slotId: 's1', format: 'reel', topic: 'Grind size', angle: 'Too coarse ruins espresso' },
        { slotId: 's2', format: 'carousel', topic: 'Water', slideCount: 3 },
    ];
    const n = normaliseHookScript(
        [{ slotId: 's1', hook: 'one two three four five six seven eight nine ten eleven twelve thirteen', script: { body: ['a', 'b'] } }],
        chunk,
        { attempt: 2 }
    );
    assert.equal(n.items.length, 2);
    const s1 = n.items[0];
    assert.equal(s1.slotId, 's1');
    assert.equal(s1.spokenHook.split(/\s+/).length, 12);
    assert.ok(s1.onScreenHook);
    assert.ok(s1.script.cta);
    assert.ok(s1.script.retentionLoop);
    assert.ok(s1.script.body.length >= 3);
    assert.ok(s1.shotNotes.length >= 3);
    const s2 = n.items[1];
    assert.equal(s2.slotId, 's2');
    assert.ok(s2.carouselBrief.slides.length >= 3);
    const problems = hookScriptProblems(n.items, chunk);
    assert.equal(problems.length, 0); // No problems remaining on attempt 2!
});

test('copy normaliser never writes a caption or a posting time', () => {
    const n = normaliseCopy({ items: [{ slotId: 's1', copies: [{ platform: 'Instagram', hashtags: ['coffee'], postingTime: '9:30' }] }, { slotId: 'other', copies: [] }] }, [{ slotId: 's1', platforms: ['instagram'] }]);
    assert.equal(n.items.length, 1);
    const c = n.items[0].copies[0];
    assert.equal(c.platform, 'instagram');
    assert.deepEqual(c.hashtags, ['#coffee']);
    assert.equal(c.postingTime, '09:30');
    assert.equal(c.caption, undefined);
});
