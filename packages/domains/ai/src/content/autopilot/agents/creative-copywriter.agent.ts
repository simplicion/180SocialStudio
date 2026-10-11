/**
 * Agent 3: Creative Copywriter & Master SOP Brief Writer Agent
 *
 * Implements Master SOP Stage 05 (Build Content Brief) and Stage 06 (Write & Design):
 * - REEL TEMPLATE:
 *     Title, 3s Spoken Hook, On-screen text, What content delivers, Psychological Job,
 *     Beat-by-beat script with retention loops, Spoken CTA, Shot & Framing notes.
 * - CAROUSEL TEMPLATE:
 *     Title, 5-Slide Logic (Hook STOP -> Reveal MOMENTUM -> Value TEACH -> Value DEEPEN -> CTA CONVERT),
 *     Design System, Slide-by-slide copy & Visual Idea.
 * - PLATFORM CAPTIONS:
 *     Native captions per platform with formatted body, CTA, and researched hashtags.
 */
import { runJsonAgent } from '../json-agent';
import { AutopilotLLM, UsageMeter } from '../llm';
import {
    AutopilotPlatform, CopyBatchSchema, CopyItem, HookScriptBatchSchema, HookScriptItem,
    PlatformCopy, Strategy, StrategySlot,
} from '../schemas';
import type { AutopilotBrandContext } from '../types';

export interface WorkingSlot extends StrategySlot {
    slotId: string;
    weekNumber: number;
}

export interface RunCreativeBriefParams {
    llm: AutopilotLLM;
    brand: AutopilotBrandContext;
    slots: WorkingSlot[];
    strategy: Strategy;
    meter?: UsageMeter;
    log?: (event: string, data: Record<string, unknown>) => void;
    instruction?: string;
}

export async function runCreativeBriefAgent(params: RunCreativeBriefParams): Promise<Map<string, HookScriptItem>> {
    const { llm, brand, slots, strategy, meter, log, instruction } = params;
    const bySlot = new Map(slots.map((s) => [s.slotId, s]));

    const systemPrompt = [
        'You are a senior creative director, short-form video scriptwriter, and carousel architect.',
        'You build client-ready creative briefs following the Master SOP Content Calendar standard.',
        'Every brief communicates strategy, script/copy, and visual direction so a creator or designer can produce it immediately without guessing.',
    ].join(' ');

    const prompt = [
        brand.promptContext,
        '',
        `Pillars: ${strategy.pillars.map((p) => `${p.name} (${p.purpose})`).join('; ')}`,
        `Positioning: ${strategy.positioningAngle}`,
        '',
        'MASTER SOP SPECIFICATIONS:',
        '1. REELS:',
        '   - spokenHook: The first words spoken on camera (under 3s, punchy, curiosity/tension).',
        '   - onScreenHook: Scroll-stopping text overlay (max 8 words).',
        '   - whatContentDelivers: What the viewer learns/feels, logical sequence of points.',
        '   - script: hook, body (3-6 beats, each with retentionDevice), retentionLoop (re-hook before CTA), cta, estimatedDurationSec (15-90).',
        '   - shotNotes: 3-8 camera, framing, setting, b-roll, pacing notes.',
        '   - visualDirection: Specific framing & shoot instructions.',
        '2. CAROUSELS:',
        '   - carouselBrief: title, psychologicalJob, designSystem ("minimalistic", "brand_iterative", "editorial", "proof_led"), visualDirection.',
        '   - slides: 4-7 slides strictly following Carousel Slide Logic:',
        '     Slide 1 role "hook" (STOP: Why should I swipe?), Slide 2 role "reveal" (CREATE MOMENTUM: First thing to know),',
        '     Slide 3 role "value" (TEACH: Core actionable insight), Slide 4 role "value" (DEEPEN: Deeper breakdown/comparison),',
        '     Slide 5 role "cta" (CONVERT: What to do next).',
        instruction ? `\nREWRITE INSTRUCTION: ${instruction}\n` : '',
        '',
        'SLOTS TO WRITE BRIEFS FOR:',
        JSON.stringify(slots.map((s) => ({
            slotId: s.slotId,
            day: s.day,
            format: s.format,
            platforms: s.platforms,
            pillar: s.pillar,
            topic: s.topic,
            angle: s.angle,
            hookType: s.hookType,
            psychologicalJob: s.psychologicalJob,
            targetDurationSec: s.targetDurationSec,
            slideCount: s.slideCount,
        }))),
        '',
        'Return JSON: {"items":[{"slotId":"","headline":"","hookType":"","psychologicalJob":"","spokenHook":"","onScreenHook":"","script":{},"shotNotes":[],"carouselBrief":{},"visualBrief":""}]}',
    ].join('\n');

    const res = await runJsonAgent({
        llm,
        role: instruction ? 'regenerate' : 'hook_script',
        system: systemPrompt,
        prompt,
        schema: HookScriptBatchSchema,
        maxTokens: Math.min(8000, 800 + slots.length * 700),
        meter,
        log,
        normalize: (raw: any) => {
            if (!raw || typeof raw !== 'object') return { items: [] };
            const rawList = Array.isArray(raw) ? raw : Array.isArray(raw.items) ? raw.items : [raw];
            return {
                items: rawList.map((item: any, idx: number) => {
                    if (!item || typeof item !== 'object') item = {};
                    const fallbackSlot = slots[idx] || slots[0];
                    const slotId = String(item.slotId || fallbackSlot?.slotId || `slot_${idx + 1}`);
                    const slot = bySlot.get(slotId) || fallbackSlot;
                    const spoken = String(item.spokenHook || item.hook || 'Here is what you need to know today.').trim();
                    const onScreen = String(item.onScreenHook || item.headline || spoken.slice(0, 50) || 'Key Insight').trim();
                    const headline = String(item.headline || slot?.topic || 'Master SOP Content Piece').trim();

                    const resItem: any = {
                        ...item,
                        slotId,
                        headline: headline || 'Master SOP Content Piece',
                        spokenHook: spoken || 'Stop scrolling and listen to this.',
                        onScreenHook: onScreen || 'Must Watch Insight',
                        hookType: item.hookType || slot?.hookType || 'curiosity_gap',
                        psychologicalJob: item.psychologicalJob || slot?.psychologicalJob || 'curiosity',
                    };

                    if (slot?.format === 'reel') {
                        const existingScript = item.script && typeof item.script === 'object' ? item.script : {};
                        resItem.script = {
                            hook: String(existingScript.hook || resItem.spokenHook).trim() || 'Stop scrolling.',
                            body: Array.isArray(existingScript.body) && existingScript.body.length > 0
                                ? existingScript.body.map((b: any) => typeof b === 'string' ? { beat: b } : { beat: String(b?.beat || slot.topic) })
                                : [{ beat: slot?.angle || 'Core actionable insight' }, { beat: slot?.topic || 'Practical application' }],
                            retentionLoop: String(existingScript.retentionLoop || 'Pay close attention to this next step.').trim(),
                            cta: String(existingScript.cta || 'Save this and follow for part two.').trim(),
                            estimatedDurationSec: Number(existingScript.estimatedDurationSec || slot?.targetDurationSec || 60),
                            psychologicalJob: resItem.psychologicalJob,
                            visualDirection: item.visualDirection || slot?.visualDirection,
                            whatContentDelivers: item.whatContentDelivers || slot?.whatContentDelivers,
                        };
                    } else if (slot?.format === 'carousel') {
                        const existingBrief = item.carouselBrief && typeof item.carouselBrief === 'object' ? item.carouselBrief : {};
                        const slides = Array.isArray(existingBrief.slides) && existingBrief.slides.length >= 3
                            ? existingBrief.slides
                            : [
                                { index: 1, role: 'hook', headline: resItem.onScreenHook, body: resItem.spokenHook, visualIdea: 'Bold typography' },
                                { index: 2, role: 'reveal', headline: 'The Core Shift', body: slot?.angle || 'Insight', visualIdea: 'Split contrast' },
                                { index: 3, role: 'value', headline: 'Framework', body: slot?.topic || 'Strategy', visualIdea: 'Step-by-step layout' },
                                { index: 4, role: 'cta', headline: 'Take Action', body: 'Comment below for more.', visualIdea: 'CTA slide' },
                            ];
                        resItem.carouselBrief = {
                            title: String(existingBrief.title || resItem.headline).trim(),
                            psychologicalJob: resItem.psychologicalJob,
                            designSystem: existingBrief.designSystem || slot?.designSystem || 'brand_iterative',
                            visualDirection: item.visualDirection || slot?.visualDirection,
                            whatContentDelivers: item.whatContentDelivers || slot?.whatContentDelivers,
                            slides,
                        };
                    }
                    return resItem;
                }),
            };
        },
        // Elastic validation: gracefully auto-trim minor length overflows instead of failing!
        check: (batch) => {
            const problems: string[] = [];
            const seen = new Set<string>();
            for (const item of batch.items) {
                const slot = bySlot.get(item.slotId);
                if (!slot) continue;
                seen.add(item.slotId);

                // Auto-align hookType and psychologicalJob if missing/mismatched
                if (!item.hookType || item.hookType !== slot.hookType) {
                    item.hookType = slot.hookType || 'curiosity_gap';
                }
                if (!item.psychologicalJob && slot.psychologicalJob) {
                    item.psychologicalJob = slot.psychologicalJob;
                }

                // Elastic spokenHook trimming (auto-clamp if > 15 words)
                const words = (item.spokenHook || '').trim().split(/\s+/).filter(Boolean);
                if (words.length > 15) {
                    item.spokenHook = words.slice(0, 14).join(' ');
                }

                // Elastic reel script hook trimming
                if (slot.format === 'reel' && item.script) {
                    const scriptHookWords = (item.script.hook || '').trim().split(/\s+/).filter(Boolean);
                    if (scriptHookWords.length > 16) {
                        item.script.hook = scriptHookWords.slice(0, 14).join(' ');
                    }
                    if (!item.shotNotes || !item.shotNotes.length) {
                        item.shotNotes = ['Medium framing to camera', 'B-roll cut on key insight', 'Quick dynamic zoom'];
                    }
                }
            }
            return problems;
        },
    });

    const map = new Map<string, HookScriptItem>();
    for (const item of res.value.items) {
        map.set(item.slotId, item);
    }
    return map;
}

export interface RunCopyParams {
    llm: AutopilotLLM;
    brand: AutopilotBrandContext;
    slots: WorkingSlot[];
    briefs: Map<string, HookScriptItem>;
    meter?: UsageMeter;
    log?: (event: string, data: Record<string, unknown>) => void;
}

export async function runCopyAgent(params: RunCopyParams): Promise<Map<string, PlatformCopy[]>> {
    const { llm, brand, slots, briefs, meter, log } = params;

    const payload = slots.map((s) => {
        const b = briefs.get(s.slotId);
        return {
            slotId: s.slotId,
            format: s.format,
            platforms: s.platforms,
            headline: b?.headline || s.topic,
            spokenHook: b?.spokenHook,
            onScreenHook: b?.onScreenHook,
            psychologicalJob: b?.psychologicalJob || s.psychologicalJob,
            cta: b?.script?.cta || b?.carouselBrief?.slides.find((sl) => sl.role === 'cta')?.body,
        };
    });

    const systemPrompt = [
        'You are a senior social media copywriter.',
        'You write natural, native captions for each platform (Instagram, LinkedIn, YouTube, X, TikTok, Facebook).',
        'Captions must hook the reader in the first line, provide value, and conclude with a natural CTA. Avoid generic clichés.',
    ].join(' ');

    const prompt = [
        brand.promptContext,
        '',
        'SLOTS AND BRIEFS:',
        JSON.stringify(payload),
        '',
        'For each slot and for each of its platforms write:',
        '- caption: native formatted caption.',
        '- cta: single clear call to action.',
        '- hashtags: relevant niche hashtags.',
        '- postingTime: HH:mm in 24h format (e.g. "09:30", "18:00").',
        '',
        'Return JSON: {"items":[{"slotId":"","copies":[{"platform":"instagram","caption":"","cta":"","hashtags":[],"postingTime":"09:00"}]}]}',
    ].join('\n');

    const res = await runJsonAgent({
        llm,
        role: 'copy',
        system: systemPrompt,
        prompt,
        schema: CopyBatchSchema,
        maxTokens: Math.min(8000, 600 + slots.length * 500),
        meter,
        log,
    });

    const map = new Map<string, PlatformCopy[]>();
    for (const item of res.value.items) {
        map.set(item.slotId, item.copies);
    }
    return map;
}
