/**
 * One deterministic quality report per calendar piece, combining the craft linters:
 * spoken hook score, on-screen hook length, timed beat sheet (video), per-platform copy lint, and AI-voice
 * detection. The autopilot "craft" agents use `blocking` to decide what to send back for a rewrite; the UI shows
 * the whole report next to the script.
 */
import { BeatSheetAnalysis, BeatSheetLinter } from './beat-sheet';
import { CopyLintResult, PlatformCopyLinter } from './copy-linter';
import { HookEvaluation, HookScorer } from './hook-scorer';
import { CraftPlatform, PLATFORM_CRAFT, toCraftPlatform } from './platform-specs';
import { AiDetectionReport, TextHumanizer } from './text-humanizer';

export interface CraftPieceInput {
    format: string;
    platforms: string[];
    spokenHook?: string;
    onScreenHook?: string;
    script?: { hook?: string; body: { beat: string }[]; retentionLoop?: string; cta?: string; estimatedDurationSec?: number };
    captions?: Partial<Record<string, { caption: string; hashtags?: string[] }>>;
    targetDurationSec?: number;
    keywords?: string[];
}

export interface CraftReport {
    /** 0-100 average of the parts that apply. */
    score: number;
    hook?: HookEvaluation;
    onScreenHook?: { text: string; words: number; ok: boolean };
    beatSheet?: BeatSheetAnalysis;
    copy: Partial<Record<CraftPlatform, CopyLintResult>>;
    voice?: AiDetectionReport;
    /** Problems a writer must fix (sent back to the LLM); warnings stay as advice. */
    blocking: string[];
    advice: string[];
}

export const HOOK_PASS_SCORE = 55;
const VIDEO_FORMATS = new Set(['reel', 'video', 'short', 'shorts']);

/** Joins a structured script into the lines the beat sheet times (one line per beat). */
export function scriptToLines(script: NonNullable<CraftPieceInput['script']>, spokenHook?: string): string {
    return [script.hook || spokenHook || '', ...script.body.map((b) => b.beat), script.retentionLoop || '', script.cta || '']
        .map((l) => l.trim()).filter(Boolean).join('\n');
}

export function reviewPieceCraft(input: CraftPieceInput): CraftReport {
    const blocking: string[] = [];
    const advice: string[] = [];
    const parts: number[] = [];
    const isVideo = VIDEO_FORMATS.has(input.format.toLowerCase());
    const platforms = input.platforms.map(toCraftPlatform).filter((p): p is CraftPlatform => !!p);

    let hook: HookEvaluation | undefined;
    if (input.spokenHook?.trim()) {
        hook = HookScorer.score(input.spokenHook, isVideo ? {} : { spoken: false, maxWords: PLATFORM_CRAFT[platforms[0] || 'instagram'].openingLineMaxWords });
        parts.push(hook.totalScore);
        if (hook.dealbreaker) blocking.push(`Hook: ${hook.dealbreaker}`);
        else if (hook.totalScore < HOOK_PASS_SCORE) blocking.push(`Hook scores ${hook.totalScore}/100 (${hook.grade}). ${hook.recommendations.join(' ')}`);
        else advice.push(...hook.recommendations.map((r) => `Hook: ${r}`));
    }

    let onScreenHook: CraftReport['onScreenHook'];
    if (input.onScreenHook?.trim()) {
        const words = input.onScreenHook.trim().split(/\s+/).length;
        onScreenHook = { text: input.onScreenHook.trim(), words, ok: words <= 8 };
        if (!onScreenHook.ok) advice.push(`On-screen hook is ${words} words; keep it to 6 or fewer so it reads in one second.`);
        if (input.spokenHook && input.onScreenHook.trim().toLowerCase() === input.spokenHook.trim().toLowerCase()) {
            advice.push('On-screen hook repeats the spoken hook word for word; make it the shorter, blunter version.');
        }
    }

    let beatSheet: BeatSheetAnalysis | undefined;
    if (isVideo && input.script?.body?.length) {
        const spec = PLATFORM_CRAFT[platforms[0] || 'instagram'];
        beatSheet = BeatSheetLinter.analyze(scriptToLines(input.script, input.spokenHook), {
            wpm: spec.video.wpm,
            targetSeconds: input.targetDurationSec || input.script.estimatedDurationSec,
        });
        const statuses = Object.values(beatSheet.summary);
        parts.push(Math.round((statuses.filter((s) => s === 'PASS').length / statuses.length) * 100));
        if (beatSheet.summary.hookStatus === 'FAIL') blocking.push(`Script: spoken hook runs ${beatSheet.hookDurationSec}s; it must land in under ${spec.video.hookWindowSec}s.`);
        advice.push(...beatSheet.flags.filter((f) => !f.startsWith('Hook runs')).map((f) => `Script: ${f}`));
    }

    const copy: CraftReport['copy'] = {};
    let allCopy = '';
    for (const p of platforms) {
        const c = input.captions?.[p] ?? (p === 'x' ? input.captions?.twitter : undefined);
        if (!c?.caption) continue;
        const tags = (c.hashtags || []).filter((t) => !c.caption.includes(t));
        const text = tags.length ? `${c.caption.trim()}\n\n${tags.join(' ')}` : c.caption.trim();
        const result = PlatformCopyLinter.analyze(p, text, { targetKeywords: input.keywords });
        copy[p] = result;
        parts.push(result.score);
        allCopy += `\n${c.caption}`;
        for (const check of result.checks) {
            if (check.status === 'FAIL') blocking.push(`${PLATFORM_CRAFT[p].label} copy: ${check.detail}`);
            else if (check.status === 'WARN') advice.push(`${PLATFORM_CRAFT[p].label} copy: ${check.detail}`);
        }
    }

    let voice: AiDetectionReport | undefined;
    const voiceText = [input.script ? scriptToLines(input.script, input.spokenHook) : '', allCopy].join('\n').trim();
    if (voiceText.split(/\s+/).length >= 25) {
        voice = TextHumanizer.detect(voiceText);
        parts.push(voice.overallScore);
        if (voice.verdict === 'HEAVY_AI_SLOP') blocking.push(`Voice: reads machine-written (${voice.overallScore}/100 human). ${voice.recommendations.slice(0, 2).join(' ')}`);
        else advice.push(...voice.recommendations.map((r) => `Voice: ${r}`));
    }

    const score = parts.length ? Math.round(parts.reduce((a, b) => a + b, 0) / parts.length) : 0;
    return { score, hook, onScreenHook, beatSheet, copy, voice, blocking, advice: Array.from(new Set(advice)) };
}

export interface TimedBeat {
    index: number;
    timecode: string;
    startSec: number;
    durationSec: number;
    wordCount: number;
    spokenWords: string;
    role: 'hook' | 'body' | 'loop' | 'cta';
    screenText?: string;
    retentionDevice?: string;
    isConcrete: boolean;
    flags: string[];
}

const CONCRETE_BEAT_RE = /(?:\$\s?\d|\b\d[\d,.]*\b|(?<!^)\b[A-Z][a-z]{2,}\b)/;

function timecodeOf(seconds: number): string {
    const m = Math.floor(seconds / 60);
    return `${m}:${(seconds % 60).toFixed(1).padStart(4, '0')}`;
}

/**
 * Times the script exactly as written: one row per part (hook, each body beat, loop, CTA) at the platform's
 * speaking pace. Nothing is added: rows only carry text and retention devices the writer produced.
 */
export function buildTimedBeats(
    script: NonNullable<CraftPieceInput['script']>,
    options: { spokenHook?: string; onScreenHook?: string; platform?: CraftPlatform } = {},
): { beats: TimedBeat[]; totalSeconds: number; wpm: number; teleprompterText: string } {
    const spec = PLATFORM_CRAFT[options.platform || 'instagram'];
    const wps = spec.video.wpm / 60;
    const parts: { text: string; role: TimedBeat['role']; retentionDevice?: string }[] = [
        { text: script.hook || options.spokenHook || '', role: 'hook' as const },
        ...script.body.map((b) => ({ text: b.beat, role: 'body' as const, retentionDevice: (b as { retentionDevice?: string }).retentionDevice })),
        { text: script.retentionLoop || '', role: 'loop' as const },
        { text: script.cta || '', role: 'cta' as const },
    ].filter((p) => p.text.trim());
    const beats: TimedBeat[] = [];
    let clock = 0;
    for (const part of parts) {
        const words = part.text.trim().split(/\s+/).filter(Boolean).length;
        const dur = Math.round((words / wps) * 10) / 10;
        const flags: string[] = [];
        if (part.role === 'hook' && dur > spec.video.hookWindowSec) flags.push(`Hook takes ${dur}s; ${spec.label} gives you ${spec.video.hookWindowSec}s.`);
        if (part.role !== 'hook' && dur > 4) flags.push(`${dur}s on one line: plan a cut, B-roll or text pop inside it.`);
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
export function inventedFigures(candidate: string, context: string): string[] {
    const norm = (s: string) => s.toLowerCase().replace(/[,\s]/g, '');
    const ctx = norm(context);
    const figures = candidate.match(/\$\s?\d[\d,.]*\s?[km]?|\b\d[\d,.]*\s?(?:%|x\b|k\b|m\b)?/gi) || [];
    return Array.from(new Set(figures.map((f) => f.trim()).filter((f) => !ctx.includes(norm(f)))));
}
