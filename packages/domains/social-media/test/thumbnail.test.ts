/**
 * AI thumbnail team: a scripted LLM plays copywriter / art director / QA critic; frames are real images drawn here.
 * Checks the agent flow (3 calls, revision when QA fails), the deterministic renderer's measurements, and the
 * service's input / AI / storage rules.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { designThumbnails, renderThumbnail, textRegion, safeBox, ThumbnailSpecSchema, type ThumbnailSpec } from '../src/creative';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createCanvas } = require('@napi-rs/canvas');

/** A "talking head" frame: bright busy background, skin-tone face ellipse on the left third. */
function frame(w = 1280, h = 720) {
    const c = createCanvas(w, h);
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#f2f2f2');
    g.addColorStop(1, '#d9d4c7');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#d7a27a';
    ctx.beginPath();
    ctx.ellipse(w * 0.3, h * 0.42, w * 0.09, h * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
    return c;
}
const face = { x: 0.3, y: 0.42, w: 0.18, h: 0.44 };
const brand = {
    name: 'Acme', colors: { primary: '#FF3B30', accent: '#FFD400', background: '#111111', text: '#FFFFFF' }, font: 'Inter',
    promptContext: 'Direct, practical.', forbiddenWords: ['guaranteed'], standardCtas: [],
};

const spec = (o: Partial<ThumbnailSpec> = {}): ThumbnailSpec => ThumbnailSpecSchema.parse({
    frameIndex: 0, layout: 'face_left_text_right', headline: 'Stop Wasting Money', emphasis: 'Money', font: 'Inter',
    textColor: '#FFFFFF', emphasisColor: '#FFD400', textStyle: 'outline', zoom: 1.1, ...o,
});

test('renderer keeps text off the face, inside the safe zone, readable (adds a box on a bright frame)', async () => {
    const r = await renderThumbnail(spec(), { image: frame(), faces: [face] }, '16:9', 'sans-serif');
    assert.equal(r.qa.inSafeZone, true);
    assert.ok(r.qa.faceOverlapPct < 12, `face covered ${r.qa.faceOverlapPct}%`);
    // White text on a light frame cannot pass on its own: the compiler must darken behind it or back it.
    assert.ok(r.qa.autoFixes.some((f) => /backing box|darkened behind/.test(f)), r.qa.autoFixes.join('; '));
    assert.ok(r.qa.contrast >= 4.5, `contrast ${r.qa.contrast}`);
    assert.equal(r.png.subarray(1, 4).toString(), 'PNG');
});

test('vertical (Reels) text stays out of the top bar, the right-hand buttons and the bottom caption area', () => {
    const s = safeBox('9:16');
    for (const layout of ['face_left_text_right', 'text_top', 'text_bottom', 'boxed_tag', 'center_punch'] as const) {
        const box = textRegion(layout, '9:16', null);
        assert.ok(box.y >= s.y - 1 && box.y + box.h <= s.y + s.h + 1 && box.x + box.w <= s.x + s.w + 1, layout);
    }
});

test('the team: copywriter → art director → render → QA critic → one revision of the failed design', async () => {
    const calls: string[] = [];
    const llm = {
        generate: async (prompt: string) => {
            if (prompt.includes('thumbnail copywriter')) {
                calls.push('copy');
                return JSON.stringify({ hooks: [
                    { text: 'Stop Wasting Money', emphasis: 'Money', angle: 'result' },
                    { text: 'The 3 Minute Fix', emphasis: '3', angle: 'number' },
                    { text: 'Nobody Tells You This', emphasis: 'Nobody', angle: 'curiosity' },
                ] });
            }
            if (prompt.includes('art director')) {
                calls.push('art');
                return '```json\n' + JSON.stringify({ rationale: 'Face-led, high contrast.', designs: [
                    spec({ textStyle: 'shadow', layout: 'face_left_text_right' }),
                    spec({ headline: 'Nobody Tells You This', emphasis: 'Nobody', layout: 'text_top', textStyle: 'box', boxColor: '#FF3B30' }),
                    spec({ headline: 'Guaranteed Results', layout: 'center_punch' }), // forbidden word: dropped
                ] }) + '\n```';
            }
            calls.push('qa');
            assert.match(prompt, /Measured: contrast/);
            return JSON.stringify({ reviews: [
                { index: 0, pass: true, score: 8.6, note: 'Strong.', fixes: {} },
                { index: 1, pass: false, score: 5, note: 'Too wordy for a tag.', fixes: { headline: 'Nobody Says This', layout: 'text_bottom' } },
            ] });
        },
    };
    let renders = 0;
    const out = await designThumbnails(
        llm,
        { format: '16:9', brand: brand as any, title: 'Budget tips', transcript: 'stop wasting money on subscriptions', frames: [{ index: 0, tMs: 1200, faces: [face] }] },
        async (s) => {
            renders++;
            return renderThumbnail(s, { image: frame(), faces: [face] }, '16:9', 'sans-serif');
        },
    );
    assert.deepEqual(calls, ['copy', 'art', 'qa']);
    assert.equal(out.variants.length, 2, 'the design with a forbidden word is dropped');
    assert.equal(renders, 3, 'two renders + one revision');
    const revised = out.variants.find((v) => v.revised)!;
    assert.equal(revised.spec.headline, 'Nobody Says This');
    assert.equal(revised.spec.layout, 'text_bottom');
    assert.ok(out.variants[0].score >= out.variants[1].score);
    assert.ok(out.variants.every((v) => v.qa.contrast >= 4.5));
});

test('a nonsense AI answer is repaired once, then fails with AI_BAD_RESPONSE (no canned thumbnail)', async () => {
    const llm = { generate: async () => 'I cannot do that.' };
    await assert.rejects(
        designThumbnails(llm, { format: '9:16', brand: brand as any, frames: [{ index: 0, tMs: 0, faces: [] }] }, async () => { throw new Error('unused'); }),
        (e: any) => e.code === 'AI_BAD_RESPONSE',
    );
});
