import { z } from 'zod';
import type { CreativeBrand } from './brand';
import type { CreativeLlm } from './carousel-design-agent';
import { CreativeError } from './creative-errors';
import { THUMB_FONTS, THUMB_LAYOUTS, ThumbnailSpecSchema, type ThumbFormat, type ThumbnailSpec, type ThumbQaReport } from './thumbnail-compiler';

/**
 * Thumbnail design team (agentic, three roles + measured QA):
 *   1. Copywriter    – 2–5 word hooks from what the video actually says (no clickbait lies, brand words respected).
 *   2. Art Director  – three distinct designs: which real frame, layout, type, colours, punch-in, one accent.
 *   3. Compiler      – renders each design from the real frame and MEASURES it (contrast, size, face, safe zones).
 *   4. QA Critic     – reviews designs + measurements against a professional, non-AI-looking rubric; failed
 *                      designs get its fixes and are rendered again once.
 * The AI only decides; every pixel comes from the video frame and real type. Invalid AI output is repaired once,
 * then fails with AI_BAD_RESPONSE (never a canned thumbnail).
 */

export interface ThumbFrameInfo {
    index: number;
    tMs: number;
    faces: Array<{ x: number; y: number; w: number; h: number; smile?: number | null; eyesOpen?: number | null }>;
    sharpness?: number | null;
    brightness?: number | null;
}

export interface ThumbnailBrief {
    format: ThumbFormat;
    platform?: string;
    title?: string;
    caption?: string;
    transcript?: string;
    frames: ThumbFrameInfo[];
    brand: CreativeBrand;
}

export interface ThumbnailVariant {
    spec: ThumbnailSpec;
    png: Buffer;
    qa: ThumbQaReport;
    score: number;
    notes: string;
    revised: boolean;
}

const HooksSchema = z.object({
    hooks: z.array(z.object({ text: z.string().trim().min(1).max(36), emphasis: z.string().trim().max(20).nullable().default(null), angle: z.string().max(80).default('') })).min(3).max(6),
});
const DesignsSchema = z.object({ designs: z.array(z.unknown()).min(1).max(4), rationale: z.string().max(600).default('') });
const ReviewSchema = z.object({
    reviews: z.array(z.object({
        index: z.number().int().min(0),
        pass: z.boolean(),
        score: z.number().min(0).max(10),
        note: z.string().max(300).default(''),
        fixes: z.record(z.string(), z.unknown()).default({}),
    })),
});

function extractJson(text: string): unknown {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const raw = fenced ? fenced[1] : text;
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('no JSON object in the answer');
    return JSON.parse(raw.slice(start, end + 1));
}

async function ask<T>(llm: CreativeLlm, role: string, prompt: string, schema: z.ZodType<T>, maxTokens = 1800): Promise<T> {
    const call = async (p: string) => {
        try {
            return await llm.generate(p, { max_tokens: maxTokens, temperature: 0.6 });
        } catch (e: any) {
            throw new CreativeError(502, 'AI_PROVIDER_ERROR', `The AI provider failed (${role}): ${String(e?.message || e).slice(0, 200)}`);
        }
    };
    const first = await call(prompt);
    let problem = '';
    try {
        return schema.parse(extractJson(first));
    } catch (e: any) {
        problem = String(e?.issues ? JSON.stringify(e.issues).slice(0, 600) : e?.message || e);
    }
    const second = await call(`${prompt}\n\nYour previous answer was invalid (${problem}). Return corrected JSON only.`);
    try {
        return schema.parse(extractJson(second));
    } catch (e: any) {
        throw new CreativeError(502, 'AI_BAD_RESPONSE', `The AI ${role} returned invalid output twice.`);
    }
}

const NON_AI_RUBRIC = [
    'Looks made by a human designer for a real creator, NOT AI-generated:',
    '- one real photo frame of the person, sharp, eyes open, a genuine expression; no fake backgrounds, no glowing sci-fi effects;',
    '- ONE short hook (2–5 words), big and bold, readable at 120 px wide; never the whole title; no hashtags or emoji;',
    '- at most 2 text colours (one emphasis word), brand colours first; strong contrast; one accent at most;',
    '- text never covers the face, stays out of the platform UI (Reels buttons/caption, YouTube timestamp);',
    '- consistent with the brand voice; no claims the video does not make; no forbidden words.',
].join('\n');

function framesTable(frames: ThumbFrameInfo[]): string {
    return frames
        .map((f) => {
            const face = f.faces.slice().sort((a, b) => b.w * b.h - a.w * a.h)[0];
            const faceTxt = face
                ? `face at x${face.x.toFixed(2)} y${face.y.toFixed(2)} size ${(face.w * face.h * 100).toFixed(0)}%${face.smile != null ? ` smile ${face.smile.toFixed(2)}` : ''}${face.eyesOpen != null ? ` eyesOpen ${face.eyesOpen.toFixed(2)}` : ''}`
                : 'no face';
            return `#${f.index} @${(f.tMs / 1000).toFixed(1)}s: ${faceTxt}${f.sharpness != null ? `, sharpness ${f.sharpness.toFixed(2)}` : ''}${f.brightness != null ? `, brightness ${f.brightness.toFixed(2)}` : ''}`;
        })
        .join('\n');
}

function brandLines(b: CreativeBrand): string {
    return [
        `Brand: ${b.name}${b.tagline ? ` — ${b.tagline}` : ''}`,
        `Colours: primary ${b.colors.primary}, accent ${b.colors.accent}, text ${b.colors.text}, background ${b.colors.background}`,
        b.forbiddenWords.length ? `Never use: ${b.forbiddenWords.join(', ')}` : '',
        b.promptContext ? `Voice: ${b.promptContext.slice(0, 600)}` : '',
    ].filter(Boolean).join('\n');
}

function clampSpec(raw: unknown, frames: number, brand: CreativeBrand): ThumbnailSpec | null {
    const parsed = ThumbnailSpecSchema.safeParse(raw);
    if (!parsed.success) return null;
    const s = parsed.data;
    const banned = brand.forbiddenWords.map((w) => w.toLowerCase());
    if (banned.some((w) => w && s.headline.toLowerCase().includes(w))) return null;
    return { ...s, frameIndex: Math.min(Math.max(0, s.frameIndex), frames - 1) };
}

/**
 * Runs the team. [render] draws + measures a spec (thumbnail-compiler.renderThumbnail with the decoded frames).
 * Returns up to three variants, best first.
 */
export async function designThumbnails(
    llm: CreativeLlm,
    brief: ThumbnailBrief,
    render: (spec: ThumbnailSpec) => Promise<{ png: Buffer; qa: ThumbQaReport; spec: ThumbnailSpec }>,
): Promise<{ variants: ThumbnailVariant[]; hooks: string[]; rationale: string }> {
    if (brief.frames.length === 0) throw new CreativeError(400, 'INVALID_INPUT', 'Send at least one frame of the video.');
    const what = [brief.title && `Title: ${brief.title}`, brief.caption && `Caption: ${brief.caption.slice(0, 500)}`, brief.transcript && `What is said (excerpt): ${brief.transcript.slice(0, 2500)}`]
        .filter(Boolean)
        .join('\n');

    // 1. Copywriter.
    const hooks = await ask(llm, 'copywriter', [
        `You are a senior YouTube / Reels thumbnail copywriter. Write 5 different hooks for this ${brief.format === '9:16' ? 'vertical Reel / Short cover' : 'YouTube thumbnail'}.`,
        'Each hook: 2–5 words, curiosity or a bold claim the video really supports, plain words a viewer reads in half a second. Pick one emphasis word per hook.',
        NON_AI_RUBRIC,
        brandLines(brief.brand),
        what,
        'Return JSON: {"hooks":[{"text":"...","emphasis":"WORD or null","angle":"curiosity|result|contrarian|number|emotion"}]}',
    ].join('\n\n'), HooksSchema, 900);

    // 2. Art Director.
    const designs = await ask(llm, 'art director', [
        `You are the art director of a top creator agency. Design 3 clearly DIFFERENT ${brief.format} thumbnails (different frame or layout or hook).`,
        NON_AI_RUBRIC,
        brandLines(brief.brand),
        `Hooks from the copywriter:\n${hooks.hooks.map((h, i) => `${i + 1}. "${h.text}" (emphasis ${h.emphasis ?? 'none'}; ${h.angle})`).join('\n')}`,
        `Frames from the video (pick the most expressive, sharp, eyes-open face):\n${framesTable(brief.frames)}`,
        `Layouts: ${THUMB_LAYOUTS.join(', ')} (face_left_text_right puts text on the side away from a face on the left; boxed_tag is a lower tag).`,
        `Fonts: ${THUMB_FONTS.join(', ')}. Colours as #RRGGBB (brand first; white/near-black text is fine). textStyle outline|shadow|box. accent none|circle|arrow|underline. zoom 1–1.6 (punch-in on the face).`,
        'Return JSON: {"designs":[{"frameIndex":0,"layout":"...","headline":"...","emphasis":"...","font":"Anton","uppercase":true,"textColor":"#FFFFFF","emphasisColor":"#FFD400","textStyle":"outline","boxColor":null,"zoom":1.2,"accent":"none","accentColor":null}],"rationale":"one paragraph"}',
    ].join('\n\n'), DesignsSchema, 1800);

    let specs = designs.designs.map((d) => clampSpec(d, brief.frames.length, brief.brand)).filter((s): s is ThumbnailSpec => !!s).slice(0, 3);
    if (specs.length === 0) throw new CreativeError(502, 'AI_BAD_RESPONSE', 'The AI art director did not return a usable design.');

    // 3. Render + measure.
    let rendered = await Promise.all(specs.map((s) => render(s)));

    // 4. QA Critic (sees the measurements, not just the plan).
    const review = await ask(llm, 'QA critic', [
        'You are the QA lead of a thumbnail design team. Review each design against the rubric AND the measured report. Be strict: a pass must look professional and human-made.',
        NON_AI_RUBRIC,
        brandLines(brief.brand),
        rendered
            .map((r, i) => `Design ${i}: ${JSON.stringify(r.spec)}\nMeasured: contrast ${r.qa.contrast}:1, text ${r.qa.textHeightPct}% of height, face covered ${r.qa.faceOverlapPct}%, safe zone ${r.qa.inSafeZone ? 'ok' : 'NO'}, problems: ${r.qa.problems.join('; ') || 'none'}; auto-fixes: ${r.qa.autoFixes.join('; ') || 'none'}`)
            .join('\n\n'),
        'For each design return pass, a score 0–10, a short note, and fixes (only fields of the design to change, e.g. {"layout":"text_top","headline":"..."}) when it does not pass.',
        'Return JSON: {"reviews":[{"index":0,"pass":true,"score":8.5,"note":"...","fixes":{}}]}',
    ].join('\n\n'), ReviewSchema, 1200);

    // 5. One revision round for anything that failed QA (measured or critic).
    const variants: ThumbnailVariant[] = [];
    for (let i = 0; i < rendered.length; i++) {
        const r = review.reviews.find((x) => x.index === i);
        let out = rendered[i];
        let revised = false;
        const hasFixes = !!r && Object.keys(r.fixes ?? {}).length > 0;
        if ((!out.qa.passed || (r && !r.pass)) && hasFixes) {
            const fixed = clampSpec({ ...out.spec, ...(r?.fixes ?? {}) }, brief.frames.length, brief.brand);
            if (fixed) {
                out = await render(fixed);
                revised = true;
            }
        }
        const score = Math.max(0, Math.min(10, (r?.score ?? 6) - out.qa.problems.length * 1.5));
        variants.push({ spec: out.spec, png: out.png, qa: out.qa, score: Number(score.toFixed(1)), notes: r?.note ?? '', revised });
    }
    variants.sort((a, b) => Number(b.qa.passed) - Number(a.qa.passed) || b.score - a.score);
    return { variants, hooks: hooks.hooks.map((h) => h.text), rationale: designs.rationale };
}
