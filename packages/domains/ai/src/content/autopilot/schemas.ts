/**
 * Typed contracts for every agent in the autopilot calendar pipeline.
 * Each agent must return JSON that validates against one of these schemas; the runner gives it one
 * repair attempt with the validation errors before the stage fails.
 */
import { z } from 'zod';

export const HOOK_TYPES = ['pattern_interrupt', 'curiosity_gap', 'contrarian', 'relatable_pain', 'story'] as const;
export type HookType = (typeof HOOK_TYPES)[number];

export const CONTENT_FORMATS = ['reel', 'carousel', 'static', 'text'] as const;
export type ContentFormat = (typeof CONTENT_FORMATS)[number];

export const AUTOPILOT_PLATFORMS = ['instagram', 'facebook', 'tiktok', 'youtube', 'linkedin', 'x'] as const;
export type AutopilotPlatform = (typeof AUTOPILOT_PLATFORMS)[number];

export const PSYCHOLOGICAL_JOBS = [
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
] as const;
export type PsychologicalJob = (typeof PSYCHOLOGICAL_JOBS)[number];

export const DESIGN_SYSTEMS = [
    'minimalistic',
    'brand_iterative',
    'editorial',
    'proof_led',
] as const;
export type DesignSystem = (typeof DESIGN_SYSTEMS)[number];

const platformSchema = z.enum(AUTOPILOT_PLATFORMS);
const hookTypeSchema = z.enum(HOOK_TYPES);
const psychologicalJobSchema = z.enum(PSYCHOLOGICAL_JOBS);
const designSystemSchema = z.enum(DESIGN_SYSTEMS);
const nonEmpty = (max: number) => z.string().trim().min(1).max(max);

// ---------------------------------------------------------------- content mix & cadence

export const ContentMixConfigSchema = z.object({
    mode: z.enum(['preset', 'daily', 'alternate', 'custom']).default('preset'),
    preset: z.string().optional(),
    dailyReels: z.number().int().min(0).max(10).default(1),
    dailyCarousels: z.number().int().min(0).max(10).default(0),
    targetReelDurationSec: z.number().int().min(15).max(180).default(60),
    carouselSlideCount: z.number().int().min(3).max(12).default(5),
});
export type ContentMixConfig = z.infer<typeof ContentMixConfigSchema>;

// ---------------------------------------------------------------- strategist

export const StrategySlotSchema = z.object({
    day: z.number().int().min(1).max(31),
    platforms: z.array(platformSchema).min(1).max(6),
    format: z.enum(CONTENT_FORMATS),
    pillar: nonEmpty(80),
    topic: nonEmpty(200),
    angle: nonEmpty(300),
    hookType: hookTypeSchema.optional(),
    psychologicalJob: psychologicalJobSchema.optional(),
    designSystem: designSystemSchema.optional(),
    whatContentDelivers: z.string().max(1000).optional(),
    visualDirection: z.string().max(800).optional(),
    targetDurationSec: z.number().int().min(5).max(180).optional(),
    slideCount: z.number().int().min(3).max(12).optional(),
    goal: z.string().max(120).optional(),
    /** Research URLs this slot is grounded in (must come from the research digest). */
    sourceUrls: z.array(z.string().url()).max(3).optional(),
});
export type StrategySlot = z.infer<typeof StrategySlotSchema>;

export const StrategySchema = z.object({
    audiencePsychology: z.object({
        coreDesires: z.array(nonEmpty(200)).min(1).max(6),
        corePains: z.array(nonEmpty(200)).min(1).max(6),
        objections: z.array(nonEmpty(200)).max(6).default([]),
        triggers: z.array(nonEmpty(200)).max(6).default([]),
    }),
    positioningAngle: nonEmpty(500),
    pillars: z.array(z.object({
        name: nonEmpty(80),
        percent: z.number().min(0).max(100),
        purpose: nonEmpty(300),
    })).min(2).max(6),
    cadence: z.array(z.object({
        platform: platformSchema,
        postsPerWeek: z.number().min(0).max(21),
        bestFormats: z.array(z.enum(CONTENT_FORMATS)).min(1),
    })).min(1),
    contentMix: z.object({
        reel: z.number().min(0).max(100),
        carousel: z.number().min(0).max(100),
        static: z.number().min(0).max(100),
        text: z.number().min(0).max(100),
    }),
    slots: z.array(StrategySlotSchema).min(1).max(120),
});
export type Strategy = z.infer<typeof StrategySchema>;

// ---------------------------------------------------------------- hook & script

export const ScriptSchema = z.object({
    hook: z.string().min(1),
    body: z.preprocess((val) => {
        if (Array.isArray(val)) {
            return val.map((b) => typeof b === 'string' ? { beat: b } : b);
        }
        return val;
    }, z.array(z.object({
        beat: z.string().min(1),
        retentionDevice: z.string().max(400).optional(),
    })).min(1).max(20)),
    retentionLoop: z.string().min(1),
    cta: z.string().min(1),
    estimatedDurationSec: z.preprocess((val) => {
        if (typeof val === 'string') {
            const num = parseInt(val.replace(/\D/g, ''), 10);
            return isNaN(num) ? undefined : num;
        }
        return val;
    }, z.coerce.number().int().min(5).max(180)),
    psychologicalJob: psychologicalJobSchema.optional(),
    visualDirection: z.string().max(800).optional(),
    whatContentDelivers: z.string().max(1000).optional(),
});
export type Script = z.infer<typeof ScriptSchema>;

export const CarouselBriefSchema = z.object({
    title: z.string().min(1),
    psychologicalJob: psychologicalJobSchema.optional(),
    designSystem: designSystemSchema.optional(),
    visualDirection: z.string().max(800).optional(),
    whatContentDelivers: z.string().max(1000).optional(),
    slides: z.array(z.object({
        index: z.coerce.number().int().min(1).max(20).default(1),
        role: z.string().transform((r) => {
            const low = (r || '').toLowerCase().trim();
            if (['hook', 'intro', 'start', 'headline', 'stop'].includes(low)) return 'hook';
            if (['reveal', 'problem', 'insight', 'shift', 'truth'].includes(low)) return 'reveal';
            if (['proof', 'example', 'case', 'stats', 'evidence', 'results'].includes(low)) return 'proof';
            if (['cta', 'action', 'conclusion', 'outro', 'follow', 'save'].includes(low)) return 'cta';
            return 'value';
        }),
        headline: z.string().min(1),
        body: z.string().max(800).default(''),
        visualIdea: z.string().max(600).default(''),
    })).min(1).max(20),
});
export type CarouselBrief = z.infer<typeof CarouselBriefSchema>;

export const HookScriptItemSchema = z.object({
    slotId: z.string().min(1),
    headline: z.string().min(1),
    hookType: z.string().transform((h) => {
        const low = (h || '').toLowerCase().trim();
        if (HOOK_TYPES.includes(low as any)) return low as HookType;
        if (low.includes('pattern') || low.includes('interrupt')) return 'pattern_interrupt';
        if (low.includes('contrarian') || low.includes('truth')) return 'contrarian';
        if (low.includes('pain') || low.includes('relat')) return 'relatable_pain';
        if (low.includes('story')) return 'story';
        return 'curiosity_gap';
    }),
    psychologicalJob: psychologicalJobSchema.optional(),
    designSystem: designSystemSchema.optional(),
    whatContentDelivers: z.string().max(1000).optional(),
    visualDirection: z.string().max(800).optional(),
    spokenHook: z.string().min(1),
    onScreenHook: z.string().min(1).transform((s) => s.slice(0, 120)),
    script: ScriptSchema.optional(),
    shotNotes: z.array(z.string().min(1)).max(25).optional(),
    carouselBrief: CarouselBriefSchema.optional(),
    visualBrief: z.string().max(1000).optional(),
});
export type HookScriptItem = z.infer<typeof HookScriptItemSchema>;

export const HookScriptBatchSchema = z.object({ items: z.array(HookScriptItemSchema).min(1) });

// ---------------------------------------------------------------- copy

export const PlatformCopySchema = z.object({
    platform: platformSchema,
    caption: nonEmpty(5000),
    cta: nonEmpty(300),
    hashtags: z.array(z.string().trim().min(2).max(60)).max(30),
    postingTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'postingTime must be HH:mm (24h)'),
});
export type PlatformCopy = z.infer<typeof PlatformCopySchema>;

export const CopyItemSchema = z.object({
    slotId: nonEmpty(40),
    copies: z.array(PlatformCopySchema).min(1),
});
export type CopyItem = z.infer<typeof CopyItemSchema>;
export const CopyBatchSchema = z.object({ items: z.array(CopyItemSchema).min(1) });

// ---------------------------------------------------------------- critic

export const CriticReviewSchema = z.object({
    items: z.array(z.object({
        slotId: nonEmpty(40),
        verdict: z.enum(['ok', 'fixed', 'flag']),
        issues: z.array(z.string().max(300)).max(10).default([]),
        fixes: z.array(z.object({
            platform: platformSchema,
            caption: nonEmpty(5000),
        })).max(6).default([]),
        fixedSpokenHook: z.string().max(300).optional(),
    })),
});
export type CriticReview = z.infer<typeof CriticReviewSchema>;

// ---------------------------------------------------------------- research

export const ResearchDigestSchema = z.object({
    trends: z.array(z.object({
        topic: nonEmpty(200),
        whyNow: nonEmpty(400),
        sourceUrls: z.array(z.string().url()).min(1).max(5),
    })).max(10),
});
export type ResearchDigest = z.infer<typeof ResearchDigestSchema>;
