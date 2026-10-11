/**
 * Agent 2: Content Cadence & Flow Planner Agent
 *
 * Implements Master SOP Stage 03 & Stage 04:
 * - Format Selection Rule:
 *     Reels: Attention + Explanation + Human Connection (30s, 60s, 90s).
 *     Carousels: Insider Value + Structure + Saveability (4-7 slides).
 * - Schedules content according to user frequency & content mix:
 *     Presets (Daily 1 Reel, Daily 1 Carousel, Daily 2 Carousels + 1 Reel, Alternate) or Custom steppers.
 * - Distributes content themes across days with logical weekly narrative momentum.
 */
import { z } from 'zod';
import { runJsonAgent } from '../json-agent';
import { AutopilotLLM, UsageMeter } from '../llm';
import { PLATFORM_RULES } from '../platform-rules';
import {
    AUTOPILOT_PLATFORMS, AutopilotPlatform, CONTENT_FORMATS, ContentFormat, ContentMixConfig,
    HOOK_TYPES, HookType, PSYCHOLOGICAL_JOBS, PsychologicalJob, Strategy, StrategySchema, StrategySlot,
} from '../schemas';
import type { AutopilotBrandContext } from '../types';
import type { NeuromarketingOutcome } from './neuromarketing-research.agent';

export interface RunCadenceFlowParams {
    llm: AutopilotLLM;
    brand: AutopilotBrandContext;
    days: 7 | 14 | 30;
    platforms: AutopilotPlatform[];
    goals: string[];
    neuromarketing: NeuromarketingOutcome;
    contentMix?: ContentMixConfig;
    structureDirectives?: string;
    meter?: UsageMeter;
    log?: (event: string, data: Record<string, unknown>) => void;
}

export function calculateSlotAllocations(days: number, mix?: ContentMixConfig): { reelSlots: number; carouselSlots: number; pattern: Array<'reel' | 'carousel'> } {
    const mode = mix?.mode || 'preset';
    const preset = mix?.preset;
    const dailyReels = mix?.dailyReels ?? 1;
    const dailyCarousels = mix?.dailyCarousels ?? 0;

    let pattern: Array<'reel' | 'carousel'> = [];

    if (preset === 'daily_1_carousel') {
        pattern = new Array(days).fill('carousel');
    } else if (preset === 'daily_1_reel_1_carousel') {
        for (let d = 0; d < days; d++) { pattern.push('reel', 'carousel'); }
    } else if (preset === 'daily_2_carousels_1_reel') {
        for (let d = 0; d < days; d++) { pattern.push('carousel', 'carousel', 'reel'); }
    } else if (preset === 'alternate' || mode === 'alternate') {
        for (let d = 0; d < days; d++) { pattern.push(d % 2 === 0 ? 'reel' : 'carousel'); }
    } else if (mode === 'custom' || (dailyReels > 0 || dailyCarousels > 0)) {
        for (let d = 0; d < days; d++) {
            for (let r = 0; r < dailyReels; r++) pattern.push('reel');
            for (let c = 0; c < dailyCarousels; c++) pattern.push('carousel');
        }
    } else {
        // Default preset: Daily 1 Reel
        pattern = new Array(days).fill('reel');
    }

    const reelSlots = pattern.filter((p) => p === 'reel').length;
    const carouselSlots = pattern.filter((p) => p === 'carousel').length;
    return { reelSlots, carouselSlots, pattern };
}

export async function runCadenceFlowAgent(params: RunCadenceFlowParams): Promise<Strategy> {
    const { llm, brand, days, platforms, goals, neuromarketing, contentMix, structureDirectives, meter, log } = params;

    const allocation = calculateSlotAllocations(days, contentMix);

    const systemPrompt = [
        'You are a senior social media content strategist and schedule architect.',
        'You build structured content calendars using the Master SOP Format Selection Rule:',
        '- REEL = Attention + Explanation + Human Connection (30-90s video).',
        '- CAROUSEL = Insider Value + Structure + Saveability (4-7 slide visual breakdown).',
        'You plan intentional narrative sequencing across days and weeks, assigning specific pillars, angles, and psychological jobs.',
    ].join(' ');

    const prompt = [
        brand.promptContext,
        '',
        `Schedule Duration: ${days} days`,
        `Target Platforms: ${platforms.join(', ')}`,
        goals.length ? `Campaign Goals: ${goals.join('; ')}` : '',
        structureDirectives ? `User Structure Directives:\n${structureDirectives}\n` : '',
        '',
        'Audience Psychology & Neutralized Themes from Neuromarketing Agent:',
        JSON.stringify(neuromarketing),
        '',
        `Target Content Mix Plan: Total ${allocation.pattern.length} pieces (${allocation.reelSlots} Reels, ${allocation.carouselSlots} Carousels)`,
        contentMix?.targetReelDurationSec ? `Target Reel Duration: ~${contentMix.targetReelDurationSec} seconds` : '',
        contentMix?.carouselSlideCount ? `Target Carousel Slides: ${contentMix.carouselSlideCount} slides` : '',
        '',
        'Psychological Jobs available:',
        ...PSYCHOLOGICAL_JOBS.map((j) => `- ${j}`),
        '',
        'Design Systems available (for carousels/statics):',
        '01 minimalistic, 02 brand_iterative, 03 editorial, 04 proof_led',
        '',
        'Generate the complete strategy containing:',
        '- positioningAngle',
        '- pillars (2 to 6 pillars with percent allocation)',
        '- cadence (postsPerWeek per platform)',
        '- contentMix percentages (reel, carousel, static, text)',
        '- slots: Array of slots for the days. Every slot must have:',
        '  day (1 to 31), platforms, format ("reel" or "carousel"), pillar, topic, angle, hookType, psychologicalJob, goal.',
        '  (If format is reel: targetDurationSec: 30, 60 or 90. If carousel: slideCount: 5 or 7, designSystem: one of the 4).',
    ].join('\n');

    const res = await runJsonAgent({
        llm,
        role: 'strategist',
        system: systemPrompt,
        prompt,
        schema: StrategySchema,
        maxTokens: Math.min(9000, 2000 + allocation.pattern.length * 120),
        meter,
        log,
        check: (strategy) => {
            const problems: string[] = [];
            if (!strategy.slots || !strategy.slots.length) {
                problems.push('strategy must have slots');
                return problems;
            }
            // Auto-filter platforms compatible with format
            for (const slot of strategy.slots) {
                slot.platforms = Array.from(new Set(slot.platforms.filter((p) => PLATFORM_RULES[p]?.formats.includes(slot.format))));
                if (!slot.platforms.length) {
                    slot.platforms = [platforms[0]];
                }
                // Assign hookType if missing
                if (!slot.hookType) {
                    slot.hookType = HOOK_TYPES[slot.day % HOOK_TYPES.length];
                }
                // Assign psychologicalJob if missing
                if (!slot.psychologicalJob) {
                    slot.psychologicalJob = PSYCHOLOGICAL_JOBS[slot.day % PSYCHOLOGICAL_JOBS.length];
                }
            }
            strategy.slots.sort((a, b) => a.day - b.day);
            return problems;
        },
    });

    return res.value;
}
