"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HOOK_PASS_SCORE = void 0;
exports.scriptToLines = scriptToLines;
exports.reviewPieceCraft = reviewPieceCraft;
exports.buildTimedBeats = buildTimedBeats;
exports.inventedFigures = inventedFigures;
/**
 * One deterministic quality report per calendar piece, combining the craft linters:
 * spoken hook score, on-screen hook length, timed beat sheet (video), per-platform copy lint, and AI-voice
 * detection. The autopilot "craft" agents use `blocking` to decide what to send back for a rewrite; the UI shows
 * the whole report next to the script.
 */
const beat_sheet_1 = require("./beat-sheet");
const copy_linter_1 = require("./copy-linter");
const hook_scorer_1 = require("./hook-scorer");
const platform_specs_1 = require("./platform-specs");
const text_humanizer_1 = require("./text-humanizer");
exports.HOOK_PASS_SCORE = 55;
const VIDEO_FORMATS = new Set(['reel', 'video', 'short', 'shorts']);
/** Joins a structured script into the lines the beat sheet times (one line per beat). */
function scriptToLines(script, spokenHook) {
    return [script.hook || spokenHook || '', ...script.body.map((b) => b.beat), script.retentionLoop || '', script.cta || '']
        .map((l) => l.trim()).filter(Boolean).join('\n');
}
function reviewPieceCraft(input) {
    const blocking = [];
    const advice = [];
    const parts = [];
    const isVideo = VIDEO_FORMATS.has(input.format.toLowerCase());
    const platforms = input.platforms.map(platform_specs_1.toCraftPlatform).filter((p) => !!p);
    let hook;
    if (input.spokenHook?.trim()) {
        hook = hook_scorer_1.HookScorer.score(input.spokenHook, isVideo ? {} : { spoken: false, maxWords: platform_specs_1.PLATFORM_CRAFT[platforms[0] || 'instagram'].openingLineMaxWords });
        parts.push(hook.totalScore);
        if (hook.dealbreaker)
            blocking.push(`Hook: ${hook.dealbreaker}`);
        else if (hook.totalScore < exports.HOOK_PASS_SCORE)
            blocking.push(`Hook scores ${hook.totalScore}/100 (${hook.grade}). ${hook.recommendations.join(' ')}`);
        else
            advice.push(...hook.recommendations.map((r) => `Hook: ${r}`));
    }
    let onScreenHook;
    if (input.onScreenHook?.trim()) {
        const words = input.onScreenHook.trim().split(/\s+/).length;
        onScreenHook = { text: input.onScreenHook.trim(), words, ok: words <= 8 };
        if (!onScreenHook.ok)
            advice.push(`On-screen hook is ${words} words; keep it to 6 or fewer so it reads in one second.`);
        if (input.spokenHook && input.onScreenHook.trim().toLowerCase() === input.spokenHook.trim().toLowerCase()) {
            advice.push('On-screen hook repeats the spoken hook word for word; make it the shorter, blunter version.');
        }
    }
    let beatSheet;
    if (isVideo && input.script?.body?.length) {
        const spec = platform_specs_1.PLATFORM_CRAFT[platforms[0] || 'instagram'];
        beatSheet = beat_sheet_1.BeatSheetLinter.analyze(scriptToLines(input.script, input.spokenHook), {
            wpm: spec.video.wpm,
            targetSeconds: input.targetDurationSec || input.script.estimatedDurationSec,
        });
        const statuses = Object.values(beatSheet.summary);
        parts.push(Math.round((statuses.filter((s) => s === 'PASS').length / statuses.length) * 100));
        if (beatSheet.summary.hookStatus === 'FAIL')
            blocking.push(`Script: spoken hook runs ${beatSheet.hookDurationSec}s; it must land in under ${spec.video.hookWindowSec}s.`);
        advice.push(...beatSheet.flags.filter((f) => !f.startsWith('Hook runs')).map((f) => `Script: ${f}`));
    }
    const copy = {};
    let allCopy = '';
    for (const p of platforms) {
        const c = input.captions?.[p] ?? (p === 'x' ? input.captions?.twitter : undefined);
        if (!c?.caption)
            continue;
        const tags = (c.hashtags || []).filter((t) => !c.caption.includes(t));
        const text = tags.length ? `${c.caption.trim()}\n\n${tags.join(' ')}` : c.caption.trim();
        const result = copy_linter_1.PlatformCopyLinter.analyze(p, text, { targetKeywords: input.keywords });
        copy[p] = result;
        parts.push(result.score);
        allCopy += `\n${c.caption}`;
        for (const check of result.checks) {
            if (check.status === 'FAIL')
                blocking.push(`${platform_specs_1.PLATFORM_CRAFT[p].label} copy: ${check.detail}`);
            else if (check.status === 'WARN')
                advice.push(`${platform_specs_1.PLATFORM_CRAFT[p].label} copy: ${check.detail}`);
        }
    }
    let voice;
    const voiceText = [input.script ? scriptToLines(input.script, input.spokenHook) : '', allCopy].join('\n').trim();
    if (voiceText.split(/\s+/).length >= 25) {
        voice = text_humanizer_1.TextHumanizer.detect(voiceText);
        parts.push(voice.overallScore);
        if (voice.verdict === 'HEAVY_AI_SLOP')
            blocking.push(`Voice: reads machine-written (${voice.overallScore}/100 human). ${voice.recommendations.slice(0, 2).join(' ')}`);
        else
            advice.push(...voice.recommendations.map((r) => `Voice: ${r}`));
    }
    const score = parts.length ? Math.round(parts.reduce((a, b) => a + b, 0) / parts.length) : 0;
    return { score, hook, onScreenHook, beatSheet, copy, voice, blocking, advice: Array.from(new Set(advice)) };
}
const CONCRETE_BEAT_RE = /(?:\$\s?\d|\b\d[\d,.]*\b|(?<!^)\b[A-Z][a-z]{2,}\b)/;
function timecodeOf(seconds) {
    const m = Math.floor(seconds / 60);
    return `${m}:${(seconds % 60).toFixed(1).padStart(4, '0')}`;
}
/**
 * Times the script exactly as written: one row per part (hook, each body beat, loop, CTA) at the platform's
 * speaking pace. Nothing is added: rows only carry text and retention devices the writer produced.
 */
function buildTimedBeats(script, options = {}) {
    const spec = platform_specs_1.PLATFORM_CRAFT[options.platform || 'instagram'];
    const wps = spec.video.wpm / 60;
    const parts = [
        { text: script.hook || options.spokenHook || '', role: 'hook' },
        ...script.body.map((b) => ({ text: b.beat, role: 'body', retentionDevice: b.retentionDevice })),
        { text: script.retentionLoop || '', role: 'loop' },
        { text: script.cta || '', role: 'cta' },
    ].filter((p) => p.text.trim());
    const beats = [];
    let clock = 0;
    for (const part of parts) {
        const words = part.text.trim().split(/\s+/).filter(Boolean).length;
        const dur = Math.round((words / wps) * 10) / 10;
        const flags = [];
        if (part.role === 'hook' && dur > spec.video.hookWindowSec)
            flags.push(`Hook takes ${dur}s; ${spec.label} gives you ${spec.video.hookWindowSec}s.`);
        if (part.role !== 'hook' && dur > 4)
            flags.push(`${dur}s on one line: plan a cut, B-roll or text pop inside it.`);
        beats.push({
            index: beats.length + 1,
            timecode: timecodeOf(clock),
            startSec: Math.round(clock * 10) / 10,
            durationSec: dur,
            wordCount: words,
            spokenWords: part.text.trim(),
            role: part.role,
            ...(part.role === 'hook' && options.onScreenHook ? { screenText: options.onScreenHook } : {}),
            ...(part.retentionDevice ? { retentionDevice: part.retentionDevice } : {}),
            isConcrete: CONCRETE_BEAT_RE.test(part.text),
            flags,
        });
        clock += dur;
    }
    return {
        beats,
        totalSeconds: Math.round(clock * 10) / 10,
        wpm: spec.video.wpm,
        teleprompterText: beats.map((b) => b.spokenWords).join('\n\n'),
    };
}
/**
 * Numbers, money amounts and percentages in `candidate` that do not appear anywhere in `context`.
 * Rewrite agents use it to reject hooks/captions that invent results ("$18,000", "42%") the brand never stated.
 */
function inventedFigures(candidate, context) {
    const norm = (s) => s.toLowerCase().replace(/[,\s]/g, '');
    const ctx = norm(context);
    const figures = candidate.match(/\$\s?\d[\d,.]*\s?[km]?|\b\d[\d,.]*\s?(?:%|x\b|k\b|m\b)?/gi) || [];
    return Array.from(new Set(figures.map((f) => f.trim()).filter((f) => !ctx.includes(norm(f)))));
}
