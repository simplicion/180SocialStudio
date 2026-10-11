/**
 * Platform Studio agents (on demand, used by the Platform Command Center):
 *
 *  - runPlatformDraftAgent: one idea -> a native post for one platform (ranked hook candidates, script for video,
 *    caption, hashtags, one ask), then scored and linted with the deterministic craft kit.
 *  - runRepurposeAgent: long-form source text -> standalone assets, each tied to a verbatim quote from the source
 *    so nothing can be attributed to the creator that they did not say.
 *
 * Both return real model output validated with zod; there is no canned fallback.
 */
import { z } from 'zod';
import { CopyLintResult, PlatformCopyLinter, splitIntoThread } from '../../craft/copy-linter';
import { buildTimedBeats, inventedFigures, TimedBeat } from '../../craft/craft-review';
import { HOOKS_DATA } from '../../craft/data/hooks.data';
import { HookEvaluation, HookScorer } from '../../craft/hook-scorer';
import { CraftPlatform, PLATFORM_CRAFT } from '../../craft/platform-specs';
import { AiDetectionReport, TextHumanizer } from '../../craft/text-humanizer';
import { runJsonAgent } from '../json-agent';
import { AutopilotError, AutopilotLLM, UsageMeter } from '../llm';

export const DRAFT_FORMATS = ['video', 'carousel', 'text'] as const;
export type DraftFormat = (typeof DRAFT_FORMATS)[number];

const DraftSchema = z.object({
    hooks: z.array(z.string().trim().min(3).max(220)).min(2).max(5),
    onScreenHook: z.string().trim().max(120).default(''),
    /** YouTube only. */
    title: z.string().trim().max(120).default(''),
    scriptBeats: z.array(z.string().trim().min(1).max(500)).max(14).default([]),
    loopLine: z.string().trim().max(300).default(''),
    slides: z.array(z.object({ headline: z.string().trim().min(1).max(120), body: z.string().trim().max(400).default('') })).max(14).default([]),
    caption: z.string().trim().min(1).max(5000),
    cta: z.string().trim().min(1).max(300),
    hashtags: z.array(z.string().trim().min(2).max(60)).max(10).default([]),
});

export interface PlatformDraft {
    platform: CraftPlatform;
    format: DraftFormat;
    hooks: HookEvaluation[];
    winningHook: string;
    onScreenHook: string;
    title?: string;
    titleLint?: ReturnType<typeof PlatformCopyLinter.lintYoutubeTitle>;
    script?: { beats: TimedBeat[]; totalSeconds: number; wpm: number; teleprompterText: string };
    slides: { headline: string; body: string }[];
    caption: string;
    cta: string;
    hashtags: string[];
    copyLint: CopyLintResult;
    voice: AiDetectionReport;
    thread?: string[];
    /** Figures in the output that are not in the idea or brand context; shown to the user to verify before posting. */
    unverifiedFigures: string[];
}

const formulaCatalogue = () => (HOOKS_DATA.hooks as { id: number; name: string; template: string }[]).map((h) => `${h.id}. ${h.name}: ${h.template}`).join('\n');
const tidy = (t: string) => TextHumanizer.humanize(t, { typographic: 'dashes', lexical: false }).cleanedText;

export async function runPlatformDraftAgent(params: {
    llm: AutopilotLLM;
    platform: CraftPlatform;
    format: DraftFormat;
    idea: string;
    brandContext: string;
    forbiddenWords?: string[];
    targetSeconds?: number;
    keywords?: string[];
    meter?: UsageMeter;
}): Promise<PlatformDraft> {
    const idea = (params.idea || '').trim();
    if (idea.length < 8) throw new AutopilotError('INVALID_INPUT', 'Describe the idea in at least a few words');
    if (idea.length > 4000) throw new AutopilotError('INVALID_INPUT', 'Idea must be at most 4000 characters');
    const spec = PLATFORM_CRAFT[params.platform];
    const format = params.format;
    if (format === 'carousel' && !spec.carousel) throw new AutopilotError('INVALID_INPUT', `${spec.label} has no carousel format`);
    const video = format === 'video';
    const target = Math.min(spec.video.maxSec, Math.max(10, params.targetSeconds || spec.video.idealSec[0] + 10));

    const { value } = await runJsonAgent({
        llm: params.llm,
        role: 'platform_draft',
        meter: params.meter,
        maxTokens: 3200,
        schema: DraftSchema,
        system: `You are a ${spec.label} content specialist who writes like the creator talks. You write platform-native posts that earn reach, and you never invent facts.`,
        prompt: [
            params.brandContext || '(no brand profile yet: write in a plain, direct voice)',
            '',
            `${spec.label} rules:`,
            ...spec.playbook.map((r) => `- ${r}`),
            `Signals ${spec.label} rewards: ${spec.rewardedSignals.join(', ')}.`,
            '',
            `Format: ${format}.`,
            video ? `- hooks: 3 different spoken hooks (5-11 words, under ${spec.video.hookWindowSec} seconds). scriptBeats: the rest of the script, one sentence or short pair per beat, about ${target} seconds at ${spec.video.wpm} words per minute in total. loopLine: a closing line that echoes the hook. onScreenHook: 6 words or fewer.` : '',
            format === 'carousel' ? `- hooks: 3 cover headlines. slides: ${spec.carousel!.idealSlides[0]}-${spec.carousel!.idealSlides[1]} slides AFTER the cover, one idea each, the last one a single ask. ${spec.carousel!.note}` : '',
            format === 'text' ? '- hooks: 3 different opening lines. caption: the full post starting with your best opening line.' : '',
            params.platform === 'youtube' ? '- title: under 60 characters, keyword first.' : '',
            `- caption: the ${video || format === 'carousel' ? 'caption/description that goes with it' : 'post'}, no hashtags inside. cta: the one ask. hashtags: at most ${spec.hashtagMax}, niche-specific.`,
            params.keywords?.length ? `Search keywords to work in early: ${params.keywords.join(', ')}` : '',
            params.forbiddenWords?.length ? `Never use: ${params.forbiddenWords.join(', ')}` : '',
            'NEVER invent numbers, money amounts, percentages, client results or personal stories. Use only facts in the idea or the brand context.',
            '',
            'Proven hook shapes (use the shape, not example wording):',
            formulaCatalogue(),
            '',
            `Idea: ${idea}`,
            '',
            'Return JSON only: {"hooks":[],"onScreenHook":"","title":"","scriptBeats":[],"loopLine":"","slides":[{"headline":"","body":""}],"caption":"","cta":"","hashtags":[]}',
        ].filter((l) => l !== '').join('\n'),
        check: (d) => {
            const problems: string[] = [];
            if (video && d.scriptBeats.length < 3) problems.push('video format needs at least 3 scriptBeats');
            if (format === 'carousel' && d.slides.length < 3) problems.push('carousel format needs at least 3 slides');
            return problems;
        },
    });

    const hookOptions = video ? {} : { spoken: false, maxWords: spec.openingLineMaxWords };
    const hooks = HookScorer.rank(value.hooks.map(tidy), hookOptions);
    const winningHook = hooks[0].hook;
    const caption = tidy(value.caption);
    const hashtags = value.hashtags.map((t) => (t.startsWith('#') ? t : `#${t}`)).slice(0, spec.hashtagMax);
    const copyLint = PlatformCopyLinter.analyze(params.platform, hashtags.length ? `${caption}\n\n${hashtags.join(' ')}` : caption, { targetKeywords: params.keywords });
    const script = video
        ? buildTimedBeats({ hook: winningHook, body: value.scriptBeats.map((b) => ({ beat: tidy(b) })), retentionLoop: tidy(value.loopLine), cta: tidy(value.cta) }, { onScreenHook: value.onScreenHook, platform: params.platform })
        : undefined;
    const allText = [winningHook, ...value.scriptBeats, value.loopLine, ...value.slides.map((s) => `${s.headline} ${s.body}`), caption, value.cta].join('\n');
    return {
        platform: params.platform,
        format,
        hooks,
        winningHook,
        onScreenHook: tidy(value.onScreenHook),
        ...(params.platform === 'youtube' && value.title ? { title: value.title, titleLint: PlatformCopyLinter.lintYoutubeTitle(value.title, params.keywords?.[0]) } : {}),
        ...(script ? { script } : {}),
        slides: value.slides.map((s) => ({ headline: tidy(s.headline), body: tidy(s.body) })),
        caption,
        cta: tidy(value.cta),
        hashtags,
        copyLint,
        voice: TextHumanizer.detect(allText),
        ...(params.platform === 'x' && copyLint.weightedLength > 280 ? { thread: splitIntoThread(caption) } : {}),
        unverifiedFigures: inventedFigures(allText, `${idea}\n${params.brandContext}`),
    };
}

// ---------------------------------------------------------------- repurpose

export const ASSET_TYPES = ['claim', 'number', 'story', 'mechanism', 'mistake', 'quotable_line'] as const;

const RepurposeSchema = z.object({
    assets: z.array(z.object({
        type: z.enum(ASSET_TYPES),
        /** Verbatim sentence(s) from the source this asset is built on. */
        sourceQuote: z.string().trim().min(8).max(600),
        angle: z.string().trim().min(1).max(300),
        format: z.enum(DRAFT_FORMATS),
        hook: z.string().trim().min(3).max(220),
    })).min(1).max(12),
});

export interface RepurposedAsset {
    type: (typeof ASSET_TYPES)[number];
    sourceQuote: string;
    angle: string;
    format: DraftFormat;
    hook: HookEvaluation;
}

const squash = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export async function runRepurposeAgent(params: {
    llm: AutopilotLLM;
    platform: CraftPlatform;
    sourceText: string;
    brandContext: string;
    meter?: UsageMeter;
}): Promise<{ assets: RepurposedAsset[]; dropped: number }> {
    const source = (params.sourceText || '').trim();
    if (source.split(/\s+/).length < 60) throw new AutopilotError('INVALID_INPUT', 'Paste at least a few paragraphs (60+ words) to repurpose');
    if (source.length > 30000) throw new AutopilotError('INVALID_INPUT', 'Source text must be at most 30,000 characters');
    const spec = PLATFORM_CRAFT[params.platform];
    const { value } = await runJsonAgent({
        llm: params.llm,
        role: 'repurpose',
        meter: params.meter,
        maxTokens: 3500,
        schema: RepurposeSchema,
        system: 'You are a content strategist who mines long-form material for standalone short posts. You only use what the source actually says.',
        prompt: [
            params.brandContext,
            '',
            `Find up to 10 standalone ${spec.label} post ideas in the source below.`,
            `- type: one of ${ASSET_TYPES.join(', ')}.`,
            '- sourceQuote: copy the exact sentence(s) from the source the idea rests on, character for character.',
            '- angle: one sentence on what the post argues or shows.',
            `- format: one of ${DRAFT_FORMATS.join(', ')}${spec.carousel ? '' : ' (this platform has no carousel; do not use it)'}.`,
            '- hook: the opening line for that post. Use only facts from the sourceQuote.',
            'Skip anything that needs facts the source does not contain.',
            '',
            'SOURCE:',
            source,
            '',
            'Return JSON only: {"assets":[{"type":"claim","sourceQuote":"","angle":"","format":"video","hook":""}]}',
        ].join('\n'),
    });
    const haystack = squash(source);
    const assets: RepurposedAsset[] = [];
    let dropped = 0;
    for (const a of value.assets) {
        // Keep only assets whose quote is really in the source and whose hook adds no new figures.
        if (!haystack.includes(squash(a.sourceQuote)) || inventedFigures(a.hook, source).length || (a.format === 'carousel' && !spec.carousel)) { dropped += 1; continue; }
        assets.push({
            type: a.type, sourceQuote: a.sourceQuote, angle: a.angle, format: a.format,
            hook: HookScorer.score(a.hook, a.format === 'video' ? {} : { spoken: false, maxWords: spec.openingLineMaxWords }),
        });
    }
    return { assets, dropped };
}
