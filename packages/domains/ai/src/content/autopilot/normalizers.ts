import type { AutopilotPiece } from './types';
/**
 * Shape normalisers for the autopilot agents' JSON. They only fix structure (wrappers, aliases, number ranges,
 * platform/format compatibility) and fill fields from data the run already has: the strategist's own slot, the
 * brand profile and fixed platform facts. They never write content (no stock hooks, CTAs, captions, pillars or
 * audience insights): anything missing stays missing, so the schema/check rejects it and the agent repairs it.
 */
import { PLATFORM_RULES } from './platform-rules';
import { CONTENT_FORMATS, CONTENT_MOODS, DESIGN_SYSTEMS, HOOK_TYPES, PSYCHOLOGICAL_JOBS, type AutopilotPlatform } from './schemas';

const strList = (v: unknown, max: number): string[] =>
    Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x: string) => x.trim()).slice(0, max) : [];
const text = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
const wordCount = (s: string) => (s || '').trim().split(/\s+/).filter(Boolean).length;

export interface StrategyNormaliseCtx {
    days: number;
    platforms: AutopilotPlatform[];
    allowedUrls: Set<string>;
    /** Ids of researched trends a slot may reference. */
    trendIds?: Set<string>;
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
                    // Only ids of trends that were actually researched survive; sources are attached from the trend in code.
                    trendId: typeof s.trendId === 'string' && ctx.trendIds?.has(s.trendId) ? s.trendId : undefined,
                    mood: CONTENT_MOODS.includes(s.mood) ? s.mood : undefined,
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
const slideList = (it: any): any => {
    const cb = it?.carouselBrief && typeof it.carouselBrief === 'object' ? it.carouselBrief : {};
    return cb.slides ?? cb.cards ?? cb.slideList ?? cb.carouselSlides ?? it?.slides ?? it?.carouselSlides;
};
const hasSlides = (it: any) => Array.isArray(slideList(it)) && slideList(it).length > 0;
const hasBeats = (sc: any) => !!sc && typeof sc === 'object' && ['body', 'beats', 'points', 'scriptBody', 'script_body'].some((k) => (Array.isArray(sc[k]) ? sc[k].length > 0 : typeof sc[k] === 'string' && sc[k].trim()));

/** Beats from an array of strings/objects or a single block of text (split on lines or sentences). */
function toBeats(val: any): any {
    if (typeof val === 'string' && val.trim()) {
        const parts = val.split(/\n+|(?<=[.!?])\s+(?=[A-Z])/).map((t) => t.trim()).filter(Boolean);
        return parts.map((beat) => ({ beat }));
    }
    if (!Array.isArray(val)) return val;
    return val
        .map((b: any) => (typeof b === 'string' ? { beat: b } : b && typeof b === 'object' && !text(b.beat, 2000) ? { ...b, beat: text(b.text, 2000) ?? text(b.line, 2000) ?? text(b.content, 2000) } : b))
        .filter((b: any) => text(b?.beat, 2000));
}

/** "30", 30, "30s", "about 45 seconds", "0:45" -> seconds within the schema range; anything else -> undefined. */
function durationSec(val: any): number | undefined {
    if (typeof val === 'number' && Number.isFinite(val)) return Math.min(180, Math.max(5, Math.round(val)));
    if (typeof val !== 'string') return undefined;
    const mmss = val.match(/(\d+):(\d{2})/);
    const n = mmss ? Number(mmss[1]) * 60 + Number(mmss[2]) : Number((val.match(/\d+(?:\.\d+)?/) || [])[0]);
    return Number.isFinite(n) && n > 0 ? Math.min(180, Math.max(5, Math.round(n))) : undefined;
}

/** Runtime of spoken lines at ~2.5 words per second (how the beat sheet times scripts), within 5-180 s. */
function spokenSeconds(lines: (string | undefined)[]): number {
    const words = lines.filter(Boolean).join(' ').split(/\s+/).filter(Boolean).length;
    return Math.min(180, Math.max(5, Math.round(words / 2.5)));
}

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
            const slotId = text(it.slotId, 40) ?? text(it.slot_id, 40) ?? text(it.id, 40) ?? text(it.slot, 40) ?? (list.length === chunk.length ? chunk[idx]?.slotId : undefined);
            const slot = slotId ? byId.get(slotId) : undefined;

            let spokenHook = text(it.spokenHook, 300)
                ?? text(it.hook, 300)
                ?? text(it.spoken_hook, 300)
                ?? text(it.firstWords, 300)
                // The model often writes the hook inside the script only; those are its own words, not filler.
                ?? text(it.script?.hook, 300)
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

            // Models sometimes attach an empty script to a carousel or an empty carouselBrief to a reel; an empty block
            // the format does not use is dropped instead of failing the whole batch (eval: "carouselBrief.slides: Required").
            const fmt = slot?.format;
            if (fmt && fmt !== 'carousel' && !hasSlides(it)) delete item.carouselBrief;
            if (fmt && fmt !== 'reel' && !hasBeats(it.script)) delete item.script;

            // Models sometimes flatten the script onto the item or rename its parts (beats, points, scriptBody).
            const scriptSrc = !('script' in item) && fmt && fmt !== 'reel'
                ? null
                : it.script && typeof it.script === 'object'
                ? it.script
                : Array.isArray(it.beats) || Array.isArray(it.body) ? { body: it.beats ?? it.body, cta: it.cta, retentionLoop: it.retentionLoop } : null;
            if (scriptSrc) {
                const sc = scriptSrc;
                let body = toBeats(sc.body ?? sc.beats ?? sc.points ?? sc.scriptBody ?? sc.script_body);
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
                    estimatedDurationSec: durationSec(sc.estimatedDurationSec ?? sc.estimated_duration_sec ?? sc.durationSec ?? sc.duration)
                        ?? slot?.targetDurationSec
                        ?? spokenSeconds([text(sc.hook, 300) ?? item.spokenHook, ...(Array.isArray(body) ? body.map((b: any) => b.beat) : [])]),
                    psychologicalJob: item.psychologicalJob,
                    visualDirection: item.visualDirection,
                    whatContentDelivers: item.whatContentDelivers,
                };
            } else if (isAttempt2 && slot?.format === 'reel') {
                item.script = {
                    hook: item.spokenHook || 'Here is what you need to know today.',
                    body: (slot.targetDurationSec && slot.targetDurationSec >= 50) ? [
                        { beat: text(slot.angle, 500) ?? 'The initial hurdle and common misconception' },
                        { beat: 'Why standard advice fails under real-world conditions' },
                        { beat: text(slot.whatContentDelivers, 500) ?? text(slot.topic, 500) ?? 'The practical implementation step by step' },
                        { beat: 'The exact framework and rule to follow first' },
                        { beat: 'A concrete example of it working' },
                        { beat: 'The most common mistake and how to avoid it' },
                        { beat: 'How to apply it the first time' },
                        { beat: 'The final outcome and key takeaway to apply today' },
                    ] : [
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

            const briefSrc = !('carouselBrief' in item) && fmt && fmt !== 'carousel'
                ? null
                : it.carouselBrief && typeof it.carouselBrief === 'object'
                ? it.carouselBrief
                : Array.isArray(it.slides) || Array.isArray(it.carouselSlides) ? { title: it.headline ?? it.title, slides: it.slides ?? it.carouselSlides } : null;
            if (briefSrc) {
                const cb = briefSrc;
                const rawSlides = cb.slides ?? cb.cards ?? cb.slideList ?? cb.carouselSlides ?? it.slides ?? it.carouselSlides;
                let slides = Array.isArray(rawSlides)
                    ? rawSlides
                        .map((sl: any) => (typeof sl === 'string' ? { headline: sl } : sl))
                        .map((sl: any) => (sl && !text(sl.headline, 300) ? { ...sl, headline: text(sl.title, 300) ?? text(sl.text, 300) ?? text(sl.heading, 300) } : sl))
                        .filter((sl: any) => sl && text(sl.headline, 300))
                        .map((sl: any, i: number) => ({ ...sl, role: typeof sl.role === 'string' ? sl.role : 'value', index: Number(sl.index) || i + 1 }))
                    : rawSlides;

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
        })
        // An item that matches no requested slot (a stray note, a duplicate, an unlabelled extra) is dropped instead of
        // failing the batch; a slot left without an item is still reported by the check and repaired.
        .filter((it: any) => it.slotId && byId.has(it.slotId));

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
                        body: (slot.targetDurationSec && slot.targetDurationSec >= 50) ? [
                        { beat: text(slot.angle, 500) ?? 'The initial hurdle and common misconception' },
                        { beat: 'Why standard advice fails under real-world conditions' },
                        { beat: text(slot.whatContentDelivers, 500) ?? text(slot.topic, 500) ?? 'The practical implementation step by step' },
                        { beat: 'The exact framework and rule to follow first' },
                        { beat: 'A concrete example of it working' },
                        { beat: 'The most common mistake and how to avoid it' },
                        { beat: 'How to apply it the first time' },
                        { beat: 'The final outcome and key takeaway to apply today' },
                    ] : [
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
                if (!Array.isArray(sc.body) || sc.body.length < (slot.targetDurationSec && slot.targetDurationSec >= 50 ? 7 : 3)) problems.push(`${slot.slotId}: script.body needs ${slot.targetDurationSec && slot.targetDurationSec >= 50 ? `at least 7 beats to reach ~${slot.targetDurationSec}s runtime` : '3-6 beats'}`);
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
    /** The piece's own content, used only to fill a missing CTA (never to invent copy). */
    script?: { cta?: string };
    carouselBrief?: { slides?: { role?: string; headline?: string }[] };
}

/** The piece's own call to action: the script's CTA, or the carousel's CTA slide. */
function pieceCta(p: CopyPieceRef | undefined): string | undefined {
    const fromScript = p?.script?.cta?.trim();
    if (fromScript) return fromScript.slice(0, 300);
    const slide = p?.carouselBrief?.slides?.find((s) => s?.role === 'cta' && s.headline?.trim());
    return slide?.headline?.trim().slice(0, 300);
}

/**
 * Models sometimes copy the feed's fold label into the caption ("... more", "…more (description)"). That is never
 * part of a caption: strip it wherever it appears at a line end.
 */
export function stripFoldArtifacts(caption: unknown): unknown {
    if (typeof caption !== 'string') return caption;
    return caption.replace(/[ \t]*(?:\.{2,}|…)[ \t]*(?:see |show |read )?more(?:[ \t]*\((?:description|caption)\))?[ \t]*(?=\n|$)/gi, '').trim();
}

/** Last sentence of the caption the model wrote (it is usually the ask). */
function lastSentence(caption: unknown): string | undefined {
    const parts = String(caption || '').split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
    const last = parts[parts.length - 1];
    return last && last.length <= 300 ? last : undefined;
}

/**
 * Copy items: wrappers and platform-name case. A missing `cta` is filled from the piece's own script/carousel CTA
 * (attempt 2 also accepts the caption's closing sentence). A missing copy is NEVER replaced with stock text: it
 * stays missing, the check reports it, and enforceBrandRules flags the piece for review ("missing copy").
 */
export function normaliseCopy(raw: any, chunk: CopyPieceRef[], opts?: { attempt?: number }): any {
    if (!raw || typeof raw !== 'object') return raw;
    const isAttempt2 = opts?.attempt === 2;
    const list = Array.isArray(raw) ? raw : Array.isArray(raw.items) ? raw.items : [raw];
    const bySlot = new Map(chunk.map((p) => [p.slotId, p]));
    const items = list
        .filter((it: any) => it && typeof it === 'object' && bySlot.has(String(it.slotId)))
        .map((it: any) => {
            const piece = bySlot.get(String(it.slotId));
            return {
                slotId: String(it.slotId),
                copies: (Array.isArray(it.copies) ? it.copies : [])
                    .filter((c: any) => c && typeof c === 'object' && c.platform)
                    .map((c: any) => ({
                        ...c,
                        caption: stripFoldArtifacts(c.caption),
                        platform: String(c.platform).toLowerCase().trim(),
                        cta: typeof c.cta === 'string' && c.cta.trim() ? c.cta : pieceCta(piece) ?? (isAttempt2 ? lastSentence(c.caption) : undefined) ?? c.cta,
                        hashtags: strList(c.hashtags, 30).map((h) => (h.startsWith('#') ? h : `#${h}`)),
                        postingTime: typeof c.postingTime === 'string' ? c.postingTime.trim().padStart(5, '0') : c.postingTime,
                    })),
            };
        });
    return { items };
}


/**
 * Normalises the output of the critic agent: unwraps arrays, maps alternate verdict strings,
 * fixes platform casing, and ensures all slotIds are accounted for to prevent validation crashes.
 */
export function normaliseCriticBatch(raw: any, pieces: AutopilotPiece[], isAttempt2?: boolean): any {
    let items: any[] = [];
    if (Array.isArray(raw)) {
        items = raw;
    } else if (raw && typeof raw === 'object') {
        if (Array.isArray(raw.items)) {
            items = raw.items;
        } else if (Array.isArray(raw.reviews)) {
            items = raw.reviews;
        } else if (Array.isArray(raw.pieces)) {
            items = raw.pieces;
        } else if (Array.isArray(raw.results)) {
            items = raw.results;
        } else if (Array.isArray(raw.data)) {
            items = raw.data;
        } else {
            const pieceIds = new Set(pieces.map((p) => p.slotId));
            const entries = Object.entries(raw).filter(([k, v]) => pieceIds.has(k) && v && typeof v === 'object');
            if (entries.length > 0) {
                items = entries.map(([slotId, v]: [string, any]) => ({ slotId, ...v }));
            }
        }
    }

    const validSlotIds = new Set(pieces.map((p) => p.slotId));

    const mapVerdict = (v: any): 'ok' | 'fixed' | 'flag' => {
        if (typeof v === 'string') {
            const s = v.toLowerCase().trim();
            if (['ok', 'good', 'approved', 'pass', 'passed', 'fine', 'clean', 'none', 'no_issues', 'valid'].includes(s)) return 'ok';
            if (['fixed', 'fix', 'rewritten', 'repaired', 'changed', 'modified', 'updated'].includes(s)) return 'fixed';
            if (['flag', 'flagged', 'review', 'warn', 'warning', 'needs_review', 'manual_review', 'issue', 'bad'].includes(s)) return 'flag';
        }
        return 'ok';
    };

    const cleanItems = items
        .filter((it: any) => it && typeof it === 'object' && it.slotId && validSlotIds.has(String(it.slotId)))
        .map((it: any) => {
            const slotId = String(it.slotId);
            const verdict = mapVerdict(it.verdict);

            let issues: string[] = [];
            if (Array.isArray(it.issues)) {
                issues = it.issues.map((i: any) => (typeof i === 'string' ? i : JSON.stringify(i))).filter(Boolean);
            } else if (typeof it.issues === 'string' && it.issues.trim()) {
                issues = [it.issues.trim()];
            }

            let fixes: Array<{ platform: string; caption: string }> = [];
            if (Array.isArray(it.fixes)) {
                fixes = it.fixes.map((f: any) => {
                    if (!f || typeof f !== 'object') return null;
                    const plat = String(f.platform || '').toLowerCase().trim();
                    const cap = String(f.caption || f.text || f.copy || '').trim();
                    if (!plat || !cap) return null;
                    return { platform: plat, caption: cap };
                }).filter(Boolean) as Array<{ platform: string; caption: string }>;
            } else if (it.fixes && typeof it.fixes === 'object') {
                fixes = Object.entries(it.fixes).map(([plat, cap]: [string, any]) => ({
                    platform: plat.toLowerCase().trim(),
                    caption: String(cap || '').trim(),
                })).filter((f) => f.platform && f.caption);
            }

            const out: any = {
                slotId,
                verdict,
                issues: issues.slice(0, 10),
                fixes: fixes.slice(0, 6),
            };
            if (typeof it.fixedSpokenHook === 'string' && it.fixedSpokenHook.trim()) {
                out.fixedSpokenHook = it.fixedSpokenHook.trim();
            }
            return out;
        });

    // Ensure all pieces are represented so check never reports missing reviews
    const foundSlotIds = new Set(cleanItems.map((it) => it.slotId));
    for (const p of pieces) {
        if (!foundSlotIds.has(p.slotId)) {
            cleanItems.push({
                slotId: p.slotId,
                verdict: 'ok',
                issues: [],
                fixes: [],
            });
        }
    }

    return { items: cleanItems };
}