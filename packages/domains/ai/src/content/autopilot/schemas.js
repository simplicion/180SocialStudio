"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ResearchDigestSchema = exports.CriticReviewSchema = exports.CopyBatchSchema = exports.CopyItemSchema = exports.PlatformCopySchema = exports.HookScriptBatchSchema = exports.HookScriptItemSchema = exports.CarouselBriefSchema = exports.ScriptSchema = exports.StrategySchema = exports.StrategySlotSchema = exports.ContentMixConfigSchema = exports.DESIGN_SYSTEMS = exports.PSYCHOLOGICAL_JOBS = exports.AUTOPILOT_PLATFORMS = exports.CONTENT_FORMATS = exports.HOOK_TYPES = void 0;
/**
 * Typed contracts for every agent in the autopilot calendar pipeline.
 * Each agent must return JSON that validates against one of these schemas; the runner gives it one
 * repair attempt with the validation errors before the stage fails.
 */
const zod_1 = require("zod");
exports.HOOK_TYPES = ['pattern_interrupt', 'curiosity_gap', 'contrarian', 'relatable_pain', 'story'];
exports.CONTENT_FORMATS = ['reel', 'carousel', 'static', 'text'];
exports.AUTOPILOT_PLATFORMS = ['instagram', 'facebook', 'tiktok', 'youtube', 'linkedin', 'x'];
exports.PSYCHOLOGICAL_JOBS = [
    'curiosity',
    'belief_reversal',
    'fear_reduction',
    'insider_knowledge',
    'saveability',
    'relatability',
    'urgency',
    'authority_trust',
    'identity',
    'aspiration',
];
exports.DESIGN_SYSTEMS = [
    'minimalistic',
    'brand_iterative',
    'editorial',
    'proof_led',
];
const platformSchema = zod_1.z.enum(exports.AUTOPILOT_PLATFORMS);
const hookTypeSchema = zod_1.z.enum(exports.HOOK_TYPES);
const psychologicalJobSchema = zod_1.z.enum(exports.PSYCHOLOGICAL_JOBS);
const designSystemSchema = zod_1.z.enum(exports.DESIGN_SYSTEMS);
const nonEmpty = (max) => zod_1.z.string().trim().min(1).max(max);
// ---------------------------------------------------------------- content mix & cadence
exports.ContentMixConfigSchema = zod_1.z.object({
    mode: zod_1.z.enum(['preset', 'daily', 'alternate', 'custom']).default('preset'),
    preset: zod_1.z.string().optional(),
    dailyReels: zod_1.z.number().int().min(0).max(10).default(1),
    dailyCarousels: zod_1.z.number().int().min(0).max(10).default(0),
    targetReelDurationSec: zod_1.z.number().int().min(15).max(180).default(60),
    carouselSlideCount: zod_1.z.number().int().min(3).max(12).default(5),
});
// ---------------------------------------------------------------- strategist
exports.StrategySlotSchema = zod_1.z.object({
    day: zod_1.z.number().int().min(1).max(31),
    platforms: zod_1.z.array(platformSchema).min(1).max(6),
    format: zod_1.z.enum(exports.CONTENT_FORMATS),
    pillar: nonEmpty(80),
    topic: nonEmpty(200),
    angle: nonEmpty(300),
    hookType: hookTypeSchema.optional(),
    psychologicalJob: psychologicalJobSchema.optional(),
    designSystem: designSystemSchema.optional(),
    whatContentDelivers: zod_1.z.string().max(1000).optional(),
    visualDirection: zod_1.z.string().max(800).optional(),
    targetDurationSec: zod_1.z.number().int().min(5).max(180).optional(),
    slideCount: zod_1.z.number().int().min(3).max(12).optional(),
    goal: zod_1.z.string().max(120).optional(),
    /** Research URLs this slot is grounded in (must come from the research digest). */
    sourceUrls: zod_1.z.array(zod_1.z.string().url()).max(3).optional(),
});
exports.StrategySchema = zod_1.z.object({
    audiencePsychology: zod_1.z.object({
        coreDesires: zod_1.z.array(nonEmpty(200)).min(1).max(6),
        corePains: zod_1.z.array(nonEmpty(200)).min(1).max(6),
        objections: zod_1.z.array(nonEmpty(200)).max(6).default([]),
        triggers: zod_1.z.array(nonEmpty(200)).max(6).default([]),
    }),
    positioningAngle: nonEmpty(500),
    pillars: zod_1.z.array(zod_1.z.object({
        name: nonEmpty(80),
        percent: zod_1.z.number().min(0).max(100),
        purpose: nonEmpty(300),
    })).min(2).max(6),
    cadence: zod_1.z.array(zod_1.z.object({
        platform: platformSchema,
        postsPerWeek: zod_1.z.number().min(0).max(21),
        bestFormats: zod_1.z.array(zod_1.z.enum(exports.CONTENT_FORMATS)).min(1),
    })).min(1),
    contentMix: zod_1.z.object({
        reel: zod_1.z.number().min(0).max(100),
        carousel: zod_1.z.number().min(0).max(100),
        static: zod_1.z.number().min(0).max(100),
        text: zod_1.z.number().min(0).max(100),
    }),
    slots: zod_1.z.array(exports.StrategySlotSchema).min(1).max(120),
});
// ---------------------------------------------------------------- hook & script
exports.ScriptSchema = zod_1.z.object({
    hook: zod_1.z.string().min(1),
    body: zod_1.z.preprocess((val) => {
        if (Array.isArray(val)) {
            return val.map((b) => typeof b === 'string' ? { beat: b } : b);
        }
        return val;
    }, zod_1.z.array(zod_1.z.object({
        beat: zod_1.z.string().min(1),
        retentionDevice: zod_1.z.string().max(400).optional(),
    })).min(1).max(20)),
    retentionLoop: zod_1.z.string().min(1),
    cta: zod_1.z.string().min(1),
    estimatedDurationSec: zod_1.z.preprocess((val) => {
        if (typeof val === 'string') {
            const num = parseInt(val.replace(/\D/g, ''), 10);
            return isNaN(num) ? undefined : num;
        }
        return val;
    }, zod_1.z.coerce.number().int().min(5).max(180)),
    psychologicalJob: psychologicalJobSchema.optional(),
    visualDirection: zod_1.z.string().max(800).optional(),
    whatContentDelivers: zod_1.z.string().max(1000).optional(),
});
exports.CarouselBriefSchema = zod_1.z.object({
    title: zod_1.z.string().min(1),
    psychologicalJob: psychologicalJobSchema.optional(),
    designSystem: designSystemSchema.optional(),
    visualDirection: zod_1.z.string().max(800).optional(),
    whatContentDelivers: zod_1.z.string().max(1000).optional(),
    slides: zod_1.z.array(zod_1.z.object({
        index: zod_1.z.coerce.number().int().min(1).max(20).default(1),
        role: zod_1.z.string().transform((r) => {
            const low = (r || '').toLowerCase().trim();
            if (['hook', 'intro', 'start', 'headline', 'stop'].includes(low))
                return 'hook';
            if (['reveal', 'problem', 'insight', 'shift', 'truth'].includes(low))
                return 'reveal';
            if (['proof', 'example', 'case', 'stats', 'evidence', 'results'].includes(low))
                return 'proof';
            if (['cta', 'action', 'conclusion', 'outro', 'follow', 'save'].includes(low))
                return 'cta';
            return 'value';
        }),
        headline: zod_1.z.string().min(1),
        body: zod_1.z.string().max(800).default(''),
        visualIdea: zod_1.z.string().max(600).default(''),
    })).min(1).max(20),
});
exports.HookScriptItemSchema = zod_1.z.object({
    slotId: zod_1.z.string().min(1),
    headline: zod_1.z.string().min(1),
    hookType: zod_1.z.string().transform((h) => {
        const low = (h || '').toLowerCase().trim();
        if (exports.HOOK_TYPES.includes(low))
            return low;
        if (low.includes('pattern') || low.includes('interrupt'))
            return 'pattern_interrupt';
        if (low.includes('contrarian') || low.includes('truth'))
            return 'contrarian';
        if (low.includes('pain') || low.includes('relat'))
            return 'relatable_pain';
        if (low.includes('story'))
            return 'story';
        return 'curiosity_gap';
    }),
    psychologicalJob: psychologicalJobSchema.optional(),
    designSystem: designSystemSchema.optional(),
    whatContentDelivers: zod_1.z.string().max(1000).optional(),
    visualDirection: zod_1.z.string().max(800).optional(),
    spokenHook: zod_1.z.string().min(1),
    onScreenHook: zod_1.z.string().min(1).transform((s) => s.slice(0, 120)),
    script: exports.ScriptSchema.optional(),
    shotNotes: zod_1.z.array(zod_1.z.string().min(1)).max(25).optional(),
    carouselBrief: exports.CarouselBriefSchema.optional(),
    visualBrief: zod_1.z.string().max(1000).optional(),
});
exports.HookScriptBatchSchema = zod_1.z.object({ items: zod_1.z.array(exports.HookScriptItemSchema).min(1) });
// ---------------------------------------------------------------- copy
exports.PlatformCopySchema = zod_1.z.object({
    platform: platformSchema,
    caption: nonEmpty(5000),
    cta: nonEmpty(300),
    hashtags: zod_1.z.array(zod_1.z.string().trim().min(2).max(60)).max(30),
    postingTime: zod_1.z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'postingTime must be HH:mm (24h)'),
});
exports.CopyItemSchema = zod_1.z.object({
    slotId: nonEmpty(40),
    copies: zod_1.z.array(exports.PlatformCopySchema).min(1),
});
exports.CopyBatchSchema = zod_1.z.object({ items: zod_1.z.array(exports.CopyItemSchema).min(1) });
// ---------------------------------------------------------------- critic
exports.CriticReviewSchema = zod_1.z.object({
    items: zod_1.z.array(zod_1.z.object({
        slotId: nonEmpty(40),
        verdict: zod_1.z.enum(['ok', 'fixed', 'flag']),
        issues: zod_1.z.array(zod_1.z.string().max(300)).max(10).default([]),
        fixes: zod_1.z.array(zod_1.z.object({
            platform: platformSchema,
            caption: nonEmpty(5000),
        })).max(6).default([]),
        fixedSpokenHook: zod_1.z.string().max(300).optional(),
    })),
});
// ---------------------------------------------------------------- research
exports.ResearchDigestSchema = zod_1.z.object({
    trends: zod_1.z.array(zod_1.z.object({
        topic: nonEmpty(200),
        whyNow: nonEmpty(400),
        sourceUrls: zod_1.z.array(zod_1.z.string().url()).min(1).max(5),
    })).max(10),
});
