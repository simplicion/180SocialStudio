/**
 * Craft kit + the agents built on it. Run: npx tsx --test --test-force-exit packages/domains/ai/tests/craft-agents.test.ts
 * The LLM is a fake that returns what each test hands it, so these check our guards, not a model.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    HookScorer, PLATFORM_CRAFT, PlatformCopyLinter, TextHumanizer, auditPlatformProfile, buildTimedBeats,
    inventedFigures, platformPlaybookPrompt, reviewPieceCraft, splitIntoThread, toCraftPlatform, weightedLength,
} from '../src/content/craft';
import { runHookLabAgent } from '../src/content/autopilot/agents/hook-lab.agent';
import { runPlatformCraftAgent } from '../src/content/autopilot/agents/platform-craft.agent';
import { attachCraftReport, runVoiceGuard } from '../src/content/autopilot/agents/voice-guard.agent';
import { runProductionScriptAgent } from '../src/content/autopilot/agents/production-script.agent';
import { runPlatformDraftAgent, runRepurposeAgent } from '../src/content/autopilot/agents/platform-studio.agent';
import type { AutopilotLLM } from '../src/content/autopilot/llm';
import type { AutopilotBrandContext, AutopilotPiece } from '../src/content/autopilot/types';

const brand: AutopilotBrandContext = {
    brandName: 'Northwind Dental', industry: 'dental clinic', positioning: 'gentle dentistry', tone: 'warm', audience: 'nervous patients',
    forbiddenWords: [], defaultHashtags: [], standardCtas: [], promptContext: 'Brand: Northwind Dental. A gentle dental clinic for nervous patients.',
};

function fakeLLM(replies: Record<string, unknown | (() => unknown)>, calls: string[] = []): AutopilotLLM {
    return {
        provider: 'fake',
        async complete(req) {
            calls.push(req.role);
            const r = replies[req.role];
            if (r === undefined) throw new Error(`no fake reply for ${req.role}`);
            const value = typeof r === 'function' ? (r as () => unknown)() : r;
            return { text: JSON.stringify(value), model: 'fake', usage: { inputTokens: 1, outputTokens: 1, estimated: true } };
        },
    };
}

function reel(over: Partial<AutopilotPiece> = {}): AutopilotPiece {
    return {
        slotId: 'd1-1', day: 1, date: '2026-10-08', weekNumber: 1, platforms: ['instagram'], primaryPlatform: 'instagram', format: 'reel',
        pillar: 'Education', topic: 'why gums bleed when you floss', angle: 'bleeding is a sign to floss more, not less', headline: 'Bleeding gums',
        hookType: 'contrarian', spokenHook: 'So today I wanted to talk a little bit about flossing and gums', onScreenHook: 'BLEEDING GUMS?',
        script: {
            hook: 'So today I wanted to talk a little bit about flossing and gums',
            body: [{ beat: 'Bleeding means the gum is inflamed.' }, { beat: 'Flossing daily for one week usually stops it.' }, { beat: 'If it does not, book a cleaning.' }],
            retentionLoop: 'So bleeding gums are a reason to floss.', cta: 'Save this for your next brush.', estimatedDurationSec: 20,
        } as any,
        shotNotes: ['close-up at the sink'],
        captions: { instagram: { caption: 'Bleeding when you floss is a sign to keep going. Here is what it means and when to book a visit. Save this.', cta: 'Save this', hashtags: ['#dentalcare'], postingTime: '18:00' } },
        timezone: 'UTC', sources: [], critic: { verdict: 'ok', issues: [] }, status: 'ready',
        ...over,
    };
}

// ------------------------------------------------------------------ craft kit

test('platform specs: every platform has a fold, hashtag cap and playbook; aliases resolve', () => {
    for (const p of ['instagram', 'linkedin', 'youtube', 'x', 'facebook', 'tiktok'] as const) {
        const s = PLATFORM_CRAFT[p];
        assert.ok(s.foldChars > 0 && s.hashtagMax > 0 && s.playbook.length >= 3, p);
    }
    assert.equal(toCraftPlatform('Twitter'), 'x');
    assert.equal(toCraftPlatform('YouTube Shorts'), 'youtube');
    assert.equal(toCraftPlatform('myspace'), null);
    assert.match(platformPlaybookPrompt(['linkedin', 'x']), /LinkedIn playbook[\s\S]*X \(Twitter\) playbook/);
});

test('copy linter applies each platform\'s own rules', () => {
    const withLink = 'Three things I learned running a clinic for ten years.\n\nRead more at https://example.com/post\n\nWhat would you add?';
    const ig = PlatformCopyLinter.analyze('instagram', withLink);
    const li = PlatformCopyLinter.analyze('linkedin', withLink);
    const yt = PlatformCopyLinter.analyze('youtube', withLink);
    assert.equal(ig.checks.find((c) => c.check === 'LINKS')!.status, 'FAIL');
    assert.equal(li.checks.find((c) => c.check === 'LINKS')!.status, 'WARN');
    assert.equal(yt.checks.find((c) => c.check === 'LINKS')!.status, 'PASS');
    assert.equal(ig.foldChars, 125);
    assert.equal(li.foldChars, 140);

    const tags = 'A post about gums.\n\n#a1 #b2 #c3 #d4';
    assert.equal(PlatformCopyLinter.analyze('instagram', tags).checks.find((c) => c.check === 'HASHTAG_COUNT')!.status, 'PASS');
    assert.equal(PlatformCopyLinter.analyze('linkedin', tags).checks.find((c) => c.check === 'HASHTAG_COUNT')!.status, 'FAIL');
    assert.equal(PlatformCopyLinter.analyze('linkedin', 'Hello everyone, I am excited to share some news about our clinic today.').checks.find((c) => c.check === 'FOLD_HOOK')!.status, 'WARN');
});

test('X: URLs weigh 23, long posts split into numbered posts that each fit 280', () => {
    const url = 'https://example.com/a/very/long/path/that/is/much/longer/than/twenty-three/characters';
    assert.equal(weightedLength(`see ${url}`, 'x'), 4 + 23);
    const long = Array.from({ length: 12 }, (_, i) => `Point ${i + 1}: flossing every single day changes how your gums respond within a week.`).join('\n\n');
    const lint = PlatformCopyLinter.analyze('x', long);
    assert.equal(lint.checks.find((c) => c.check === 'LENGTH')!.status, 'FAIL');
    assert.ok(lint.thread && lint.thread.length > 1);
    for (const post of splitIntoThread(long)) assert.ok(weightedLength(post, 'x') <= 280, post);
    assert.match(splitIntoThread(long)[0], / 1\/\d+$/);
});

test('YouTube title lint: length and front-loaded keyword', () => {
    const ok = PlatformCopyLinter.lintYoutubeTitle('Bleeding gums: what it means and how to stop it', 'bleeding gums');
    assert.ok(ok.passed && ok.checks.every((c) => c.status === 'PASS'));
    assert.equal(PlatformCopyLinter.lintYoutubeTitle('x'.repeat(101)).passed, false);
});

test('hook scorer: dealbreakers, and text openers get a longer word budget than spoken hooks', () => {
    assert.ok(HookScorer.score('Stop scrolling, this is important').dealbreaker);
    const line = 'I ran a dental clinic for ten years and almost every nervous patient told me the same thing';
    assert.ok(HookScorer.score(line).dealbreaker, 'too long to say in 3 seconds');
    assert.equal(HookScorer.score(line, { spoken: false, maxWords: 18 }).dealbreaker, undefined);
    assert.ok(HookScorer.score('Stop flossing like this, your gums are bleeding').totalScore > HookScorer.score('Some thoughts about dental health').totalScore);
});

test('humanizer: dashes mode only touches dashes and invisible characters', () => {
    const src = 'We delve into gums — and “plaque” • daily​.';
    const safe = TextHumanizer.humanize(src, { typographic: 'dashes', lexical: false }).cleanedText;
    assert.equal(safe, 'We delve into gums, and “plaque” • daily.');
    assert.ok(!TextHumanizer.humanize(src).cleanedText.includes('delve'));
    assert.ok(TextHumanizer.findSlop('We delve into this.').includes('delve'));
});

test('inventedFigures flags numbers that are not in the context', () => {
    assert.deepEqual(inventedFigures('$18,000 is what this cost me', 'a post about flossing'), ['$18,000']);
    assert.deepEqual(inventedFigures('Floss for 7 days', 'floss daily for 7 days'), []);
    assert.deepEqual(inventedFigures('No numbers here', ''), []);
});

test('profile audit scores only supplied fields; an empty import is not credited', () => {
    const empty = auditPlatformProfile('linkedin', { handle: 'x' });
    assert.equal(empty.scoredFields, 0);
    assert.equal(empty.totalScore, 0);
    const good = auditPlatformProfile('linkedin', { handle: 'x', bio: 'I help nervous patients get dental care without fear | 4,000 treated', hasProfilePhoto: true, linkUrl: 'https://northwind.example' });
    assert.equal(good.totalScore, 100);
    const weak = auditPlatformProfile('linkedin', { handle: 'x', bio: 'Founder', hasProfilePhoto: false });
    assert.ok(weak.totalScore < 30 && weak.prioritizedActionPlan.length === 2);
    const ig = auditPlatformProfile('instagram', { handle: 'x', displayName: 'Ana | Gentle Dentist', bio: 'Helping nervous patients' });
    assert.ok(!ig.items.some((i) => i.id === 'professional_setup'), 'unknown account type is not scored');
});

test('timed beats: timing comes from the words, nothing is added', () => {
    const p = reel();
    const timed = buildTimedBeats(p.script as any, { onScreenHook: p.onScreenHook, platform: 'instagram' });
    assert.equal(timed.beats.length, 6);
    assert.deepEqual(timed.beats.map((b) => b.role), ['hook', 'body', 'body', 'body', 'loop', 'cta']);
    assert.equal(timed.beats[0].screenText, 'BLEEDING GUMS?');
    assert.ok(timed.beats.slice(1).every((b) => b.screenText === undefined));
    assert.ok(timed.beats[0].flags.length === 1, 'a 12-word hook overruns the 3s window');
    assert.equal(timed.teleprompterText.split('\n\n').length, 6);
    const noLoop = buildTimedBeats({ hook: 'A', body: [{ beat: 'B c d' }] });
    assert.deepEqual(noLoop.beats.map((b) => b.role), ['hook', 'body'], 'no invented loop or CTA');
});

// ------------------------------------------------------------------ agents

test('hook lab: rewrites a weak hook, rejects candidates with invented figures', async () => {
    const p = reel();
    const calls: string[] = [];
    const out = await runHookLabAgent({
        llm: fakeLLM({ hook_lab: { items: [{ slotId: 'd1-1', candidates: ['$18,000 is what bleeding gums cost me', 'Stop flossing less when your gums bleed'] }] } }, calls),
        brand, pieces: [p],
    });
    assert.deepEqual(calls, ['hook_lab']);
    assert.equal(out.rewritten, 1);
    assert.equal(p.spokenHook, 'Stop flossing less when your gums bleed');
    assert.equal(p.script!.hook, p.spokenHook);
    assert.ok(p.hookScore! >= 55);
});

test('hook lab: a failed rewrite keeps the writer\'s hook and flags it (no stock replacement)', async () => {
    const p = reel();
    const original = p.spokenHook;
    const out = await runHookLabAgent({ llm: fakeLLM({}), brand, pieces: [p] });
    assert.ok(out.error);
    assert.equal(p.spokenHook, original);
    assert.ok(p.critic.issues.some((i) => i.startsWith('weak hook')));
});

test('hook lab: strong hooks never call the model', async () => {
    const p = reel({ spokenHook: 'Stop flossing less when your gums bleed' });
    const calls: string[] = [];
    await runHookLabAgent({ llm: fakeLLM({}, calls), brand, pieces: [p] });
    assert.deepEqual(calls, []);
    assert.deepEqual(p.critic.issues, []);
});

test('platform craft: fixes a caption that breaks the platform rules, only if it lints better', async () => {
    const p = reel({ captions: { instagram: { caption: 'Hey guys! Read the full guide at https://example.com/gums and tell me what you think.', cta: 'Save this', hashtags: ['#dentalcare'], postingTime: '18:00' } } });
    const fixed = 'Bleeding when you floss means inflamed gums, not damage. Keep going for a week and it usually stops. Comment GUIDE for the full routine.';
    const out = await runPlatformCraftAgent({ llm: fakeLLM({ craft: { items: [{ slotId: 'd1-1', platform: 'instagram', caption: fixed }] } }), brand, pieces: [p] });
    assert.equal(out.failing, 1);
    assert.equal(out.rewritten, 1);
    assert.equal(p.captions.instagram!.caption, fixed);

    const q = reel({ captions: { instagram: { caption: 'Hey guys! Read the full guide at https://example.com/gums and tell me what you think.', cta: 'Save this', hashtags: [], postingTime: '18:00' } } });
    const before = q.captions.instagram!.caption;
    await runPlatformCraftAgent({ llm: fakeLLM({ craft: { items: [{ slotId: 'd1-1', platform: 'instagram', caption: 'We helped 4,200 patients. Comment GUIDE for the routine that works for bleeding gums.' }] } }), brand, pieces: [q] });
    assert.equal(q.captions.instagram!.caption, before, 'rewrite with an invented figure is rejected');
});

test('voice guard + craft report: dashes cleaned, scores and timed beats attached', () => {
    const p = reel({ spokenHook: 'Stop flossing less — your gums bleed' });
    assert.equal(runVoiceGuard([p]).cleaned, 1);
    assert.equal(p.spokenHook, 'Stop flossing less, your gums bleed');
    attachCraftReport([p]);
    assert.ok(typeof p.hookScore === 'number' && p.craft && p.timedBeats!.length === 6 && p.teleprompterScript);
    const report = reviewPieceCraft({ format: 'text', platforms: ['linkedin'], spokenHook: 'Hello', captions: { linkedin: { caption: '#one #two #three #four tags first' } } });
    assert.ok(report.blocking.some((b) => b.startsWith('LinkedIn copy')));
});

test('shooting script: spoken lines must match the script word for word; timecodes are computed', async () => {
    const p = reel({ spokenHook: 'Stop flossing less when your gums bleed' });
    p.script!.hook = p.spokenHook;
    const lines = [p.script!.hook, ...p.script!.body.map((b) => b.beat), p.script!.retentionLoop, p.script!.cta];
    const scene = (spokenLine: string, i: number) => ({ purpose: i === 0 ? 'hook' : 'value', spokenLine, onScreenText: i === 0 ? 'BLEEDING GUMS?' : '', shot: 'talking_head_close', framing: 'eye level', action: 'hold floss', bRoll: '', editCue: 'cut', audioCue: '', delivery: 'calm' });
    const draft = { logline: 'Why bleeding gums mean floss more', setup: { location: 'bathroom', lighting: 'window', wardrobe: 'scrubs', props: ['floss'] }, scenes: lines.map(scene), captionStyle: 'bold', musicMood: 'calm', checklist: ['clean lens'] };
    const good = await runProductionScriptAgent({ llm: fakeLLM({ production_script: draft }), brand, piece: p });
    assert.equal(good.scenes.length, lines.length);
    assert.equal(good.scenes[0].timecode, '0:00.0');
    assert.ok(good.scenes[1].startSec > 0 && good.totalSeconds > 5);

    const reworded = { ...draft, scenes: draft.scenes.map((s, i) => (i === 1 ? { ...s, spokenLine: 'Bleeding always means serious disease.' } : s)) };
    await assert.rejects(runProductionScriptAgent({ llm: fakeLLM({ production_script: reworded }), brand, piece: p }), (e: any) => e.code === 'AI_INVALID_OUTPUT');
    await assert.rejects(runProductionScriptAgent({ llm: fakeLLM({}), brand, piece: reel({ format: 'carousel', script: undefined }) }), (e: any) => e.code === 'INVALID_INPUT');
});

test('platform draft: ranks real model hooks, lints the caption, reports unverified figures', async () => {
    const reply = {
        hooks: ['Some thoughts on gum health for you', 'Stop flossing less when your gums bleed'], onScreenHook: 'BLEEDING GUMS?', title: '',
        scriptBeats: ['Bleeding means the gum is inflamed.', 'Floss daily for a week.', 'We treated 900 patients this way.'], loopLine: 'So bleeding gums mean floss more.', slides: [],
        caption: 'Bleeding when you floss means inflamed gums. Keep going for a week. Save this for later.', cta: 'Save this.', hashtags: ['dentalcare', '#gums'],
    };
    const draft = await runPlatformDraftAgent({ llm: fakeLLM({ platform_draft: reply }), platform: 'instagram', format: 'video', idea: 'why gums bleed when you floss', brandContext: brand.promptContext });
    assert.equal(draft.winningHook, 'Stop flossing less when your gums bleed');
    assert.deepEqual(draft.hashtags, ['#dentalcare', '#gums']);
    assert.ok(draft.script && draft.script.beats.length === 6);
    assert.deepEqual(draft.unverifiedFigures, ['900']);
    await assert.rejects(runPlatformDraftAgent({ llm: fakeLLM({}), platform: 'x', format: 'carousel', idea: 'a real idea here', brandContext: '' }), (e: any) => e.code === 'INVALID_INPUT');
});

test('repurpose: drops assets whose quote is not in the source', async () => {
    const source = Array.from({ length: 12 }, () => 'Most patients stop flossing the moment they see blood, which is the opposite of what helps.').join(' ') + ' We open at eight every weekday.';
    const out = await runRepurposeAgent({
        llm: fakeLLM({ repurpose: { assets: [
            { type: 'mistake', sourceQuote: 'Most patients stop flossing the moment they see blood, which is the opposite of what helps.', angle: 'keep flossing', format: 'video', hook: 'Stop quitting floss when you see blood' },
            { type: 'number', sourceQuote: 'We spent $14,000 on custom development before launch.', angle: 'made up', format: 'video', hook: 'We lost $14,000' },
        ] } }),
        platform: 'instagram', sourceText: source, brandContext: brand.promptContext,
    });
    assert.equal(out.assets.length, 1);
    assert.equal(out.dropped, 1);
});
