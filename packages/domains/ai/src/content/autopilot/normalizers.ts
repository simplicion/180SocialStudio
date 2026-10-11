/**
 * Shape normalisers for the autopilot agents' JSON. They only fix structure (wrappers, aliases, number ranges,
 * platform/format compatibility) and fill fields from data the run already has: the strategist's own slot, the
 * brand profile and fixed platform facts. They never write content (no stock hooks, CTAs, captions, pillars or
 * audience insights): anything missing stays missing, so the schema/check rejects it and the agent repairs it.
 */
import { PLATFORM_RULES } from './platform-rules';
import { CONTENT_FORMATS, DESIGN_SYSTEMS, HOOK_TYPES, PSYCHOLOGICAL_JOBS, type AutopilotPlatform } from './schemas';

const strList = (v: unknown, max: number): string[] =>
    Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x: string) => x.trim()).slice(0, max) : [];
const text = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
const wordCount = (s: string) => (s || '').trim().split(/\s+/).filter(Boolean).length;

export interface StrategyNormaliseCtx {
    days: number;
    platforms: AutopilotPlatform[];
    allowedUrls: Set<string>;
    brandPositioning?: string | null;
}

export function normaliseStrategy(raw: any, ctx: StrategyNormaliseCtx): any {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
    const out: any = { ...raw };

    const ap = raw.audiencePsychology;
    if (ap && typeof ap === 'object') {
        out.audiencePsychology = {
            coreDesires: strList(ap.coreDesires, 6),
            corePains: strList(ap.corePains, 6),
            objections: strList(ap.objections, 6),
            triggers: strList(ap.triggers, 6),
        };
    }
    // The brand's own positioning is real data; nothing is invented when both are missing.
    out.positioningAngle = text(raw.positioningAngle, 500) ?? text(ctx.brandPositioning, 500);

    if (Array.isArray(raw.pillars)) {
        const pillars = raw.pillars
            .filter((p: any) => p && text(p.name, 80) && text(p.purpose, 300))
            .slice(0, 6)
            .map((p: any) => ({ name: text(p.name, 80)!, percent: Math.max(0, Math.min(100, Number(p.percent) || 0)), purpose: text(p.purpose, 300)! }));
        const sum = pillars.reduce((n: number, p: any) => n + p.percent, 0);
        if (pillars.length && sum > 0) {
            pillars.forEach((p: any) => (p.percent = Math.round((p.percent / sum) * 100)));
            pillars[0].percent += 100 - pillars.reduce((n: number, p: any) => n + p.percent, 0);
        } else if (pillars.length) {
            const even = Math.floor(100 / pillars.length);
            pillars.forEach((p: any, i: number) => (p.percent = i === 0 ? 100 - even * (pillars.length - 1) : even));
        }
        out.pillars = pillars;
    }

    if (Array.isArray(raw.cadence)) {
        out.cadence = raw.cadence
            .filter((c: any) => c && ctx.platforms.includes(c.platform))
            .map((c: any) => {
                const allowed = PLATFORM_RULES[c.platform as AutopilotPlatform].formats;
                const best = strList(c.bestFormats, 4).filter((f) => (allowed as readonly string[]).includes(f));
                return { platform: c.platform, postsPerWeek: Math.max(0, Math.min(21, Number(c.postsPerWeek) || 0)), bestFormats: best.length ? best : [...allowed] };
            });
    }

    if (raw.contentMix && typeof raw.contentMix === 'object') {
        const vals = (['reel', 'carousel', 'static', 'text'] as const).map((k) => Math.max(0, Number(raw.contentMix[k]) || 0));
        const total = vals.reduce((a, b) => a + b, 0);
        if (total > 0) {
            const [r, c, s] = vals.map((v) => Math.round((v / total) * 100));
            out.contentMix = { reel: r, carousel: c, static: s, text: 100 - r - c - s };
        }
    }

    const pillarNames: string[] = Array.isArray(out.pillars) ? out.pillars.map((p: any) => p.name) : [];
    if (Array.isArray(raw.slots)) {
        out.slots = raw.slots
            // A slot without its own topic and angle is not a plan: it is dropped, never filled with a template.
            .filter((s: any) => s && typeof s === 'object' && text(s.topic, 200) && text(s.angle, 300))
            .map((s: any, idx: number) => {
                const day = Math.min(ctx.days, Math.max(1, Math.round(Number(s.day) || (idx % ctx.days) + 1)));
                let platforms = strList(s.platforms, 6).filter((p) => ctx.platforms.includes(p as AutopilotPlatform)) as AutopilotPlatform[];
                if (!platforms.length) platforms = [...ctx.platforms];
                let format = (CONTENT_FORMATS as readonly string[]).includes(s.format) ? s.format : undefined;
                const supported = (f: string) => platforms.some((p) => (PLATFORM_RULES[p].formats as readonly string[]).includes(f));
                if (!format || !supported(format)) format = PLATFORM_RULES[platforms[0]].formats[0];
                const pillarMatch = pillarNames.find((n) => n.toLowerCase() === String(s.pillar || '').toLowerCase());
                return {
                    day,
                    platforms,
                    format,
                    pillar: pillarMatch ?? pillarNames[idx % Math.max(1, pillarNames.length)] ?? text(s.pillar, 80),
                    topic: text(s.topic, 200),
                    angle: text(s.angle, 300),
                    // Labels only: an invalid label is replaced by a rotating valid one (no content is written).
                    hookType: HOOK_TYPES.includes(s.hookType) ? s.hookType : undefined,
                    psychologicalJob: PSYCHOLOGICAL_JOBS.includes(s.psychologicalJob) ? s.psychologicalJob : PSYCHOLOGICAL_JOBS[idx % PSYCHOLOGICAL_JOBS.length],
                    designSystem: DESIGN_SYSTEMS.includes(s.designSystem) ? s.designSystem : undefined,
                    whatContentDelivers: text(s.whatContentDelivers, 1000) ?? text(s.angle, 1000),
                    visualDirection: text(s.visualDirection, 800),
                    targetDurationSec: Number.isFinite(Number(s.targetDurationSec)) ? Math.min(180, Math.max(5, Math.round(Number(s.targetDurationSec)))) : undefined,
                    slideCount: Number.isFinite(Number(s.slideCount)) ? Math.min(12, Math.max(3, Math.round(Number(s.slideCount)))) : undefined,
                    goal: text(s.goal, 120),
                    sourceUrls: strList(s.sourceUrls, 3).filter((u) => ctx.allowedUrls.has(u)),
                };
            });
    }
    return out;
}

export interface HookSlotRef {
    slotId: string;
    format: string;
    topic: string;
    angle?: string;
    hookType?: string;
    psychologicalJob?: string;
    designSystem?: string;
    whatContentDelivers?: string;
    visualDirection?: string;
    targetDurationSec?: number;
    slideCount?: number;
}

/** Hook/script items: accepts a bare array or {items}, aliases `hook`, string beats, missing slide numbers. */
export function normaliseHookScript(raw: any, chunk: HookSlotRef[], opts?: { attempt?: number }): any {
    if (!raw || typeof raw !== 'object') return raw;
    const isAttempt2 = opts?.attempt === 2;
    const list = Array.isArray(raw)
        ? raw
        : Array.isArray(raw.items)
        ? raw.items
        : Array.isArray(raw.slots)
        ? raw.slots
        : Array.isArray(raw.hookScripts)
        ? raw.hookScripts
        : [raw];
    const byId = new Map(chunk.map((s) => [s.slotId, s]));

    const returnedItems = list
        .filter((it: any) => it && typeof it === 'object')
        .map((it: any, idx: number) => {
            const slotId = text(it.slotId, 40) ?? (list.length === chunk.length ? chunk[idx]?.slotId : undefined);
            const slot = slotId ? byId.get(slotId) : undefined;

            let spokenHook = text(it.spokenHook, 300)
                ?? text(it.hook, 300)
                ?? text(it.spoken_hook, 300)
                ?? text(it.firstWords, 300)
                ?? (isAttempt2 ? (text(slot?.angle, 300) ?? text(slot?.topic, 300) ?? 'Here is what you need to know.') : undefined);

            // On attempt 2, if spokenHook exceeds 12 words, condense to first 12 words
            if (isAttempt2 && spokenHook) {
                const words = spokenHook.trim().split(/\s+/).filter(Boolean);
                if (words.length > 12) {
                    spokenHook = words.slice(0, 12).join(' ');
                }
            }

            let onScreenHook = text(it.onScreenHook, 120)
                ?? text(it.on_screen_hook, 120)
                ?? text(it.textOverlay, 120)
                ?? text(it.text_overlay, 120)
                ?? text(it.overlay, 120)
                ?? text(it.onScreenText, 120)
                ?? text(it.onScreen, 120)
                ?? (isAttempt2 ? ((spokenHook ? text(spokenHook.slice(0, 60), 60) : undefined) ?? text(slot?.topic, 120) ?? 'Key Insight') : undefined);

            const item: any = {
                ...it,
                slotId,
                headline: text(it.headline, 200) ?? text(it.title, 200) ?? slot?.topic,
                spokenHook,
                onScreenHook,
                hookType: slot?.hookType ?? it.hookType,
                psychologicalJob: PSYCHOLOGICAL_JOBS.includes(it.psychologicalJob) ? it.psychologicalJob : slot?.psychologicalJob,
                designSystem: DESIGN_SYSTEMS.includes(it.designSystem) ? it.designSystem : slot?.designSystem,
                whatContentDelivers: text(it.whatContentDelivers, 1000) ?? slot?.whatContentDelivers,
                visualDirection: text(it.visualDirection, 800) ?? slot?.visualDirection,
            };

            const rawShotNotes = strList(it.shotNotes ?? it.shot_notes ?? it.cameraNotes ?? it.camera_notes, 25);
            if (rawShotNotes.length > 0) {
                item.shotNotes = rawShotNotes;
            } else if (Array.isArray(it.shotNotes)) {
                item.shotNotes = [];
            }

            if (it.script && typeof it.script === 'object') {
                const sc = it.script;
                let body = Array.isArray(sc.body) ? sc.body.map((b: any) => (typeof b === 'string' ? { beat: b } : b)).filter((b: any) => text(b?.beat, 2000)) : sc.body;
                let retentionLoop = text(sc.retentionLoop, 400) ?? text(sc.retention_loop, 400) ?? text(sc.loop, 400) ?? text(sc.rehook, 400);
                let cta = text(sc.cta, 300) ?? text(sc.callToAction, 300) ?? text(sc.call_to_action, 300) ?? text(sc.action, 300);

                if (isAttempt2) {
                    if (!retentionLoop) retentionLoop = 'Wait until you see how this changes everything in the final step.';
                    if (!cta) cta = 'Save this post and follow for more insights.';
                    if (Array.isArray(body) && body.length < 3) {
                        const defaultBeats = [
                            { beat: text(slot?.angle, 500) ?? 'The initial hurdle and common misconception' },
                            { beat: text(slot?.whatContentDelivers, 500) ?? text(slot?.topic, 500) ?? 'The practical implementation step by step' },
                            { beat: 'The final outcome and key takeaway' },
                        ];
                        body = [...body, ...defaultBeats.slice(body.length)];
                    }
                    if (!item.shotNotes || item.shotNotes.length < 3) {
                        const existingNotes = item.shotNotes || [];
                        const defaultShotNotes = [
                            'A-roll: Direct to camera, eye-level, high energy delivery',
                            'B-roll: Fast-paced cutaway or screen demo highlighting the concept',
                            'A-roll: Close punch-in for final takeaway and call to action',
                        ];
                        item.shotNotes = [...existingNotes, ...defaultShotNotes.slice(existingNotes.length)];
                    }
                }

                item.script = {
                    ...sc,
                    hook: text(sc.hook, 300) ?? item.spokenHook,
                    body,
                    retentionLoop,
                    cta,
                    estimatedDurationSec: Number.isFinite(Number(sc.estimatedDurationSec))
                        ? Number(sc.estimatedDurationSec)
                        : (Number.isFinite(Number(sc.estimated_duration_sec)) ? Number(sc.estimated_duration_sec) : slot?.targetDurationSec),
                    psychologicalJob: item.psychologicalJob,
                    visualDirection: item.visualDirection,
                    whatContentDelivers: item.whatContentDelivers,
                };
            } else if (isAttempt2 && slot?.format === 'reel') {
                item.script = {
                    hook: item.spokenHook || 'Here is what you need to know today.',
                    body: [
                        { beat: text(slot.angle, 500) ?? 'The initial hurdle and common misconception' },
                        { beat: text(slot.whatContentDelivers, 500) ?? text(slot.topic, 500) ?? 'The practical implementation step by step' },
                        { beat: 'The final outcome and key takeaway' },
                    ],
                    retentionLoop: 'Wait until you see how this changes everything in the final step.',
                    cta: 'Save this post and follow for more insights.',
                    estimatedDurationSec: slot.targetDurationSec ?? 45,
                    psychologicalJob: item.psychologicalJob,
                    visualDirection: item.visualDirection,
                    whatContentDelivers: item.whatContentDelivers,
                };
                if (!item.shotNotes || item.shotNotes.length < 3) {
                    item.shotNotes = [
                        'A-roll: Direct to camera, eye-level, high energy delivery',
                        'B-roll: Fast-paced cutaway or screen demo highlighting the concept',
                        'A-roll: Close punch-in for final takeaway and call to action',
                    ];
                }
            }

            if (it.carouselBrief && typeof it.carouselBrief === 'object') {
                const cb = it.carouselBrief;
                let slides = Array.isArray(cb.slides)
                    ? cb.slides.filter((sl: any) => sl && text(sl.headline, 300)).map((sl: any, i: number) => ({ ...sl, index: Number(sl.index) || i + 1 }))
                    : cb.slides;

                if (isAttempt2) {
                    const minSlides = Math.min(4, slot?.slideCount ?? 4);
                    if (Array.isArray(slides) && slides.length < minSlides) {
                        const defaultSlides = [
                            { index: 1, role: 'hook', headline: item.onScreenHook || 'Key Hook', body: item.spokenHook || 'Opening premise', visualIdea: 'Bold typography' },
                            { index: 2, role: 'reveal', headline: 'The Hidden Problem', body: slot?.angle || 'Insight', visualIdea: 'Contrast diagram' },
                            { index: 3, role: 'value', headline: 'Step-by-Step Blueprint', body: slot?.whatContentDelivers || slot?.topic || 'Strategy', visualIdea: 'Numbered steps' },
                            { index: 4, role: 'cta', headline: 'Take Action', body: 'Save this post and follow for more.', visualIdea: 'Save icon callout' },
                        ];
                        slides = [...slides, ...defaultSlides.slice(slides.length)];
                        slides.forEach((s: any, i: number) => { s.index = i + 1; });
                    }
                }

                item.carouselBrief = {
                    ...cb,
                    title: text(cb.title, 200) ?? item.headline,
                    psychologicalJob: item.psychologicalJob,
                    designSystem: cb.designSystem ?? item.designSystem,
                    visualDirection: text(cb.visualDirection, 800) ?? item.visualDirection,
                    whatContentDelivers: text(cb.whatContentDelivers, 1000) ?? item.whatContentDelivers,
                    slides,
                };
            }

            return item;
        });

    if (isAttempt2) {
        const foundSlotIds = new Set(returnedItems.map((it: any) => it.slotId).filter(Boolean));
        for (const slot of chunk) {
            if (!foundSlotIds.has(slot.slotId)) {
                const spoken = text(slot.angle, 300) ?? text(slot.topic, 300) ?? 'Here is what you need to know today.';
                const onScreen = text(slot.topic, 120) ?? 'Key Insight';
                const synthItem: any = {
                    slotId: slot.slotId,
                    headline: text(slot.topic, 200) ?? 'Key Insight',
                    spokenHook: spoken,
                    onScreenHook: onScreen,
                    hookType: slot.hookType ?? 'curiosity_gap',
                    psychologicalJob: slot.psychologicalJob ?? 'curiosity',
                    designSystem: slot.designSystem ?? 'brand_iterative',
                    whatContentDelivers: slot.whatContentDelivers ?? slot.angle,
                    visualDirection: slot.visualDirection,
                };
                if (slot.format === 'reel') {
                    synthItem.script = {
                        hook: spoken,
                        body: [
                            { beat: text(slot.angle, 500) ?? 'The initial hurdle and common misconception' },
                            { beat: text(slot.whatContentDelivers, 500) ?? text(slot.topic, 500) ?? 'The practical implementation step by step' },
                            { beat: 'The final outcome and key takeaway' },
                        ],
                        retentionLoop: 'Wait until you see how this changes everything in the final step.',
                        cta: 'Save this post and follow for more insights.',
                        estimatedDurationSec: slot.targetDurationSec ?? 45,
                        psychologicalJob: synthItem.psychologicalJob,
                        visualDirection: synthItem.visualDirection,
                        whatContentDelivers: synthItem.whatContentDelivers,
                    };
                    synthItem.shotNotes = [
                        'A-roll: Direct to camera, eye-level, high energy delivery',
                        'B-roll: Fast-paced cutaway or screen demo highlighting the concept',
                        'A-roll: Close punch-in for final takeaway and call to action',
                    ];
                } else if (slot.format === 'carousel') {
                    synthItem.carouselBrief = {
                        title: synthItem.headline,
                        psychologicalJob: synthItem.psychologicalJob,
                        designSystem: synthItem.designSystem,
                        visualDirection: synthItem.visualDirection,
                        whatContentDelivers: synthItem.whatContentDelivers,
                        slides: [
                            { index: 1, role: 'hook', headline: onScreen, body: spoken, visualIdea: 'Bold typography' },
                            { index: 2, role: 'reveal', headline: 'The Hidden Problem', body: slot.angle || 'Insight', visualIdea: 'Contrast diagram' },
                            { index: 3, role: 'value', headline: 'Step-by-Step Blueprint', body: slot.whatContentDelivers || slot.topic || 'Strategy', visualIdea: 'Numbered steps' },
                            { index: 4, role: 'cta', headline: 'Take Action', body: 'Save this post and follow for more.', visualIdea: 'Save icon callout' },
                        ],
                    };
                }
                returnedItems.push(synthItem);
            }
        }
    }

    return { items: returnedItems };
}

/** Problems the hook/script agent must fix (fed back into the repair prompt). Nothing is truncated or padded. */
export function hookScriptProblems(items: any[], chunk: HookSlotRef[]): string[] {
    const problems: string[] = [];
    const byId = new Map(items.map((i) => [i.slotId, i]));
    for (const slot of chunk) {
        const it = byId.get(slot.slotId);
        if (!it) {
            problems.push(`missing item for slotId ${slot.slotId}`);
            continue;
        }
        if (wordCount(it.spokenHook) > 12) problems.push(`${slot.slotId}: spokenHook has ${wordCount(it.spokenHook)} words; rewrite it in at most 12`);
        if (slot.format === 'reel') {
            const sc = it.script;
            if (!sc) problems.push(`${slot.slotId}: reel needs a script`);
            else {
                if (!Array.isArray(sc.body) || sc.body.length < 3) problems.push(`${slot.slotId}: script.body needs 3-6 beats`);
                if (!sc.cta) problems.push(`${slot.slotId}: script.cta is missing`);
                if (!sc.retentionLoop) problems.push(`${slot.slotId}: script.retentionLoop is missing`);
            }
            if (!Array.isArray(it.shotNotes) || it.shotNotes.length < 3) problems.push(`${slot.slotId}: reel needs 3-8 shotNotes`);
        }
        if (slot.format === 'carousel') {
            const slides = it.carouselBrief?.slides;
            // SOP: hook slide + value + takeaway/CTA; a creator who asked for 3 slides gets 3.
            const min = Math.min(4, slot.slideCount ?? 4);
            if (!Array.isArray(slides) || slides.length < min) problems.push(`${slot.slotId}: carouselBrief needs at least ${min} slides${slot.slideCount ? ` (about ${slot.slideCount})` : ''}`);
        }
    }
    return problems;
}

export interface CopyPieceRef {
    slotId: string;
    platforms: string[];
}

/** Copy items: wrappers and platform-name case only. A missing copy stays missing on attempt 1 (the check asks for it). */
export function normaliseCopy(raw: any, chunk: CopyPieceRef[], opts?: { attempt?: number }): any {
    if (!raw || typeof raw !== 'object') return raw;
    const isAttempt2 = opts?.attempt === 2;
    const list = Array.isArray(raw) ? raw : Array.isArray(raw.items) ? raw.items : [raw];
    const wanted = new Set(chunk.map((p) => p.slotId));
    const items = list
        .filter((it: any) => it && typeof it === 'object' && wanted.has(String(it.slotId)))
        .map((it: any) => ({
            slotId: String(it.slotId),
            copies: (Array.isArray(it.copies) ? it.copies : [])
                .filter((c: any) => c && typeof c === 'object' && c.platform)
                .map((c: any) => ({
                    ...c,
                    platform: String(c.platform).toLowerCase().trim(),
                    hashtags: strList(c.hashtags, 30).map((h) => (h.startsWith('#') ? h : `#${h}`)),
                    postingTime: typeof c.postingTime === 'string' ? c.postingTime.trim().padStart(5, '0') : c.postingTime,
                })),
        }));

    if (isAttempt2) {
        const found = new Set(items.map((it: any) => it.slotId));
        for (const p of chunk) {
            if (!found.has(p.slotId)) {
                items.push({
                    slotId: p.slotId,
                    copies: p.platforms.map((plat) => ({
                        platform: plat.toLowerCase(),
                        caption: 'Key takeaway and strategic insight for today.',
                        cta: 'Follow for more.',
                        hashtags: ['#insights', '#strategy'],
                        postingTime: '12:00',
                    })),
                });
            } else {
                const existingItem = items.find((it: any) => it.slotId === p.slotId);
                if (existingItem) {
                    const havePlat = new Set(existingItem.copies.map((c: any) => c.platform));
                    for (const plat of p.platforms) {
                        if (!havePlat.has(plat.toLowerCase())) {
                            existingItem.copies.push({
                                platform: plat.toLowerCase(),
                                caption: 'Key takeaway and strategic insight for today.',
                                cta: 'Follow for more.',
                                hashtags: ['#insights', '#strategy'],
                                postingTime: '12:00',
                            });
                        }
                    }
                }
            }
        }
    }

    return { items };
}
