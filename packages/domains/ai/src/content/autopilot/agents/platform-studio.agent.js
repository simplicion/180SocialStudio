"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ASSET_TYPES = exports.DRAFT_FORMATS = void 0;
exports.runPlatformDraftAgent = runPlatformDraftAgent;
exports.runRepurposeAgent = runRepurposeAgent;
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
const zod_1 = require("zod");
const copy_linter_1 = require("../../craft/copy-linter");
const craft_review_1 = require("../../craft/craft-review");
const hooks_data_1 = require("../../craft/data/hooks.data");
const hook_scorer_1 = require("../../craft/hook-scorer");
const platform_specs_1 = require("../../craft/platform-specs");
const text_humanizer_1 = require("../../craft/text-humanizer");
const json_agent_1 = require("../json-agent");
const llm_1 = require("../llm");
exports.DRAFT_FORMATS = ['video', 'carousel', 'text'];
const DraftSchema = zod_1.z.object({
    hooks: zod_1.z.array(zod_1.z.string().trim().min(3).max(220)).min(2).max(5),
    onScreenHook: zod_1.z.string().trim().max(120).default(''),
    /** YouTube only. */
    title: zod_1.z.string().trim().max(120).default(''),
    scriptBeats: zod_1.z.array(zod_1.z.string().trim().min(1).max(500)).max(14).default([]),
    loopLine: zod_1.z.string().trim().max(300).default(''),
    slides: zod_1.z.array(zod_1.z.object({ headline: zod_1.z.string().trim().min(1).max(120), body: zod_1.z.string().trim().max(400).default('') })).max(14).default([]),
    caption: zod_1.z.string().trim().min(1).max(5000),
    cta: zod_1.z.string().trim().min(1).max(300),
    hashtags: zod_1.z.array(zod_1.z.string().trim().min(2).max(60)).max(10).default([]),
});
const formulaCatalogue = () => hooks_data_1.HOOKS_DATA.hooks.map((h) => `${h.id}. ${h.name}: ${h.template}`).join('\n');
const tidy = (t) => text_humanizer_1.TextHumanizer.humanize(t, { typographic: 'dashes', lexical: false }).cleanedText;
async function runPlatformDraftAgent(params) {
    const idea = (params.idea || '').trim();
    if (idea.length < 8)
        throw new llm_1.AutopilotError('INVALID_INPUT', 'Describe the idea in at least a few words');
    if (idea.length > 4000)
        throw new llm_1.AutopilotError('INVALID_INPUT', 'Idea must be at most 4000 characters');
    const spec = platform_specs_1.PLATFORM_CRAFT[params.platform];
    const format = params.format;
    if (format === 'carousel' && !spec.carousel)
        throw new llm_1.AutopilotError('INVALID_INPUT', `${spec.label} has no carousel format`);
    const video = format === 'video';
    const target = Math.min(spec.video.maxSec, Math.max(10, params.targetSeconds || spec.video.idealSec[0] + 10));
    const { value } = await (0, json_agent_1.runJsonAgent)({
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
            format === 'carousel' ? `- hooks: 3 cover headlines. slides: ${spec.carousel.idealSlides[0]}-${spec.carousel.idealSlides[1]} slides AFTER the cover, one idea each, the last one a single ask. ${spec.carousel.note}` : '',
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
            const problems = [];
            if (video && d.scriptBeats.length < 3)
                problems.push('video format needs at least 3 scriptBeats');
            if (format === 'carousel' && d.slides.length < 3)
                problems.push('carousel format needs at least 3 slides');
            return problems;
        },
    });
    const hookOptions = video ? {} : { spoken: false, maxWords: spec.openingLineMaxWords };
    const hooks = hook_scorer_1.HookScorer.rank(value.hooks.map(tidy), hookOptions);
    const winningHook = hooks[0].hook;
    const caption = tidy(value.caption);
    const hashtags = value.hashtags.map((t) => (t.startsWith('#') ? t : `#${t}`)).slice(0, spec.hashtagMax);
    const copyLint = copy_linter_1.PlatformCopyLinter.analyze(params.platform, hashtags.length ? `${caption}\n\n${hashtags.join(' ')}` : caption, { targetKeywords: params.keywords });
    const script = video
        ? (0, craft_review_1.buildTimedBeats)({ hook: winningHook, body: value.scriptBeats.map((b) => ({ beat: tidy(b) })), retentionLoop: tidy(value.loopLine), cta: tidy(value.cta) }, { onScreenHook: value.onScreenHook, platform: params.platform })
        : undefined;
    const allText = [winningHook, ...value.scriptBeats, value.loopLine, ...value.slides.map((s) => `${s.headline} ${s.body}`), caption, value.cta].join('\n');
    return {
        platform: params.platform,
        format,
        hooks,
        winningHook,
        onScreenHook: tidy(value.onScreenHook),
        ...(params.platform === 'youtube' && value.title ? { title: value.title, titleLint: copy_linter_1.PlatformCopyLinter.lintYoutubeTitle(value.title, params.keywords?.[0]) } : {}),
        ...(script ? { script } : {}),
        slides: value.slides.map((s) => ({ headline: tidy(s.headline), body: tidy(s.body) })),
        caption,
        cta: tidy(value.cta),
        hashtags,
        copyLint,
        voice: text_humanizer_1.TextHumanizer.detect(allText),
        ...(params.platform === 'x' && copyLint.weightedLength > 280 ? { thread: (0, copy_linter_1.splitIntoThread)(caption) } : {}),
        unverifiedFigures: (0, craft_review_1.inventedFigures)(allText, `${idea}\n${params.brandContext}`),
    };
}
// ---------------------------------------------------------------- repurpose
exports.ASSET_TYPES = ['claim', 'number', 'story', 'mechanism', 'mistake', 'quotable_line'];
const RepurposeSchema = zod_1.z.object({
    assets: zod_1.z.array(zod_1.z.object({
        type: zod_1.z.enum(exports.ASSET_TYPES),
        /** Verbatim sentence(s) from the source this asset is built on. */
        sourceQuote: zod_1.z.string().trim().min(8).max(600),
        angle: zod_1.z.string().trim().min(1).max(300),
        format: zod_1.z.enum(exports.DRAFT_FORMATS),
        hook: zod_1.z.string().trim().min(3).max(220),
    })).min(1).max(12),
});
const squash = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
async function runRepurposeAgent(params) {
    const source = (params.sourceText || '').trim();
    if (source.split(/\s+/).length < 60)
        throw new llm_1.AutopilotError('INVALID_INPUT', 'Paste at least a few paragraphs (60+ words) to repurpose');
    if (source.length > 30000)
        throw new llm_1.AutopilotError('INVALID_INPUT', 'Source text must be at most 30,000 characters');
    const spec = platform_specs_1.PLATFORM_CRAFT[params.platform];
    const { value } = await (0, json_agent_1.runJsonAgent)({
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
            `- type: one of ${exports.ASSET_TYPES.join(', ')}.`,
            '- sourceQuote: copy the exact sentence(s) from the source the idea rests on, character for character.',
            '- angle: one sentence on what the post argues or shows.',
            `- format: one of ${exports.DRAFT_FORMATS.join(', ')}${spec.carousel ? '' : ' (this platform has no carousel; do not use it)'}.`,
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
    const assets = [];
    let dropped = 0;
    for (const a of value.assets) {
        // Keep only assets whose quote is really in the source and whose hook adds no new figures.
        if (!haystack.includes(squash(a.sourceQuote)) || (0, craft_review_1.inventedFigures)(a.hook, source).length || (a.format === 'carousel' && !spec.carousel)) {
            dropped += 1;
            continue;
        }
        assets.push({
            type: a.type, sourceQuote: a.sourceQuote, angle: a.angle, format: a.format,
            hook: hook_scorer_1.HookScorer.score(a.hook, a.format === 'video' ? {} : { spoken: false, maxWords: spec.openingLineMaxWords }),
        });
    }
    return { assets, dropped };
}
