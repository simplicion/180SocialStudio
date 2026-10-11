import { CreativeError } from './creative-errors';
import {
    CarouselDesignSchema,
    MAX_SLIDES,
    MIN_SLIDES,
    SLIDE_LAYOUTS,
    SlideSchema,
    StaticDesignSchema,
    normalizeSlides,
    type Slide,
} from './carousel-schema';

/**
 * Carousel design agent: the LLM writes slide copy and art direction as typed JSON; it never draws.
 * Output is validated with zod; one repair round-trip is attempted with the validation errors, then it fails with
 * AI_BAD_RESPONSE (no canned slides).
 */

export interface CreativeLlm {
    generate: (prompt: string, options?: any) => Promise<string>;
}

export interface DesignInput {
    brandContext: string;
    headline?: string;
    brief?: string;
    caption?: string;
    platform?: string;
    /** Existing slide ideas (e.g. `carouselSlides` from the calendar agent) to restructure. */
    existingSlides?: any[];
    slideCount?: number;
    useImages: boolean;
    forbiddenWords?: string[];
    ctas?: string[];
}

function extractJson(text: string): unknown {
    const t = String(text || '').trim();
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
    const body = fenced ? fenced[1] : t;
    const start = body.search(/[[{]/);
    if (start < 0) throw new Error('no JSON object in response');
    const open = body[start];
    const close = open === '{' ? '}' : ']';
    const end = body.lastIndexOf(close);
    const parsed = JSON.parse(body.slice(start, end + 1));
    return Array.isArray(parsed) ? { slides: parsed } : parsed;
}

const SLIDE_SHAPE = `{"layout": one of ${SLIDE_LAYOUTS.map((l) => `"${l}"`).join('|')}, "title": string (max 90 chars, punchy), "body": string (max 220 chars, may be "" ; for "list" put 3-5 items separated by \\n), "imagePrompt": string | null, "emphasis": string | null (1-3 words copied exactly from the title)}`;

function rules(input: DesignInput): string {
    return [
        '- Write like a sharp human strategist for this brand. No emojis, no hashtags on slides, no filler like "In today\'s world".',
        '- Titles are short and scannable on a phone. Bodies are one or two short sentences.',
        input.useImages
            ? '- "imagePrompt": describe a REAL photograph (who/what, where, action, mood) that supports the slide. Never ask for text, logos, charts or UI in the photo. Use null for slides that work better as pure typography (stat, quote and list slides usually do).'
            : '- Set "imagePrompt" to null on every slide (typographic design).',
        input.forbiddenWords?.length ? `- Never use these words: ${input.forbiddenWords.join(', ')}.` : '',
        input.ctas?.length ? `- The CTA slide should use or adapt one of: ${input.ctas.join(' | ')}.` : '',
    ]
        .filter(Boolean)
        .join('\n');
}

export function buildCarouselPrompt(input: DesignInput): string {
    const n = Math.min(MAX_SLIDES, Math.max(MIN_SLIDES, input.slideCount || 7));
    return [
        'You are the carousel design agent for a social media studio. Plan an Instagram/LinkedIn carousel.',
        '',
        'BRAND CONSCIOUSNESS:',
        input.brandContext || '(none provided)',
        '',
        'CONTENT:',
        input.headline ? `Headline: ${input.headline}` : '',
        input.brief ? `Brief: ${input.brief}` : '',
        input.caption ? `Caption (for context): ${input.caption.slice(0, 1200)}` : '',
        input.platform ? `Platform: ${input.platform}` : '',
        input.existingSlides?.length ? `Draft slide ideas to improve and restructure: ${JSON.stringify(input.existingSlides).slice(0, 3000)}` : '',
        '',
        `Produce exactly ${n} slides. Slide 1 must be "cover" (the hook). The last slide must be "cta". Between them use a varied mix of "point", "quote", "stat" and "list" that fits the content.`,
        rules(input),
        '',
        `Return ONLY JSON: {"slides": [${SLIDE_SHAPE}, ...]}`,
    ]
        .filter((l) => l !== '')
        .join('\n');
}

export function buildStaticPrompt(input: DesignInput): string {
    return [
        'You are the design agent for a social media studio. Plan ONE static image post.',
        '',
        'BRAND CONSCIOUSNESS:',
        input.brandContext || '(none provided)',
        '',
        input.headline ? `Headline: ${input.headline}` : '',
        input.brief ? `Brief: ${input.brief}` : '',
        input.caption ? `Caption (for context): ${input.caption.slice(0, 1200)}` : '',
        '',
        'Produce exactly 1 slide with layout "cover" (or "quote"/"stat" if clearly better).',
        rules(input),
        '',
        `Return ONLY JSON: {"slides": [${SLIDE_SHAPE}]}`,
    ]
        .filter((l) => l !== '')
        .join('\n');
}

function issues(err: any): string {
    const list = err?.issues || err?.errors;
    if (Array.isArray(list)) return list.slice(0, 12).map((i: any) => `${(i.path || []).join('.')}: ${i.message}`).join('; ');
    return String(err?.message || err);
}

async function callLlm(llm: CreativeLlm, prompt: string): Promise<string> {
    try {
        return await llm.generate(prompt, { max_tokens: 2500, temperature: 0.7 });
    } catch (e: any) {
        throw new CreativeError(502, 'AI_PROVIDER_ERROR', `The AI provider failed: ${String(e?.message || e).slice(0, 200)}`);
    }
}

async function generateValidated<T>(llm: CreativeLlm, prompt: string, schema: { parse: (v: unknown) => T }): Promise<T> {
    const first = await callLlm(llm, prompt);
    let problem: string;
    try {
        return schema.parse(extractJson(first));
    } catch (e) {
        problem = issues(e);
    }
    const repairPrompt = [
        prompt,
        '',
        'Your previous answer was invalid:',
        first.slice(0, 4000),
        '',
        `Validation errors: ${problem}`,
        'Return corrected JSON only, matching the schema exactly.',
    ].join('\n');
    const second = await callLlm(llm, repairPrompt);
    try {
        return schema.parse(extractJson(second));
    } catch (e) {
        throw new CreativeError(502, 'AI_BAD_RESPONSE', `The AI returned an invalid carousel design twice (${issues(e).slice(0, 300)}).`);
    }
}

function applyImagePolicy(slides: Slide[], useImages: boolean): Slide[] {
    return normalizeSlides(slides).map((s) => (useImages ? s : { ...s, imagePrompt: null }));
}

export async function designCarousel(llm: CreativeLlm, input: DesignInput): Promise<Slide[]> {
    if (!input.headline && !input.brief && !input.caption && !input.existingSlides?.length) {
        throw new CreativeError(400, 'INVALID_INPUT', 'A headline, brief, caption or existing slides are required to design a carousel.');
    }
    const out = await generateValidated(llm, buildCarouselPrompt(input), CarouselDesignSchema);
    return applyImagePolicy(out.slides, input.useImages);
}

export async function designStaticPost(llm: CreativeLlm, input: DesignInput): Promise<Slide[]> {
    if (!input.headline && !input.brief && !input.caption) throw new CreativeError(400, 'INVALID_INPUT', 'A headline, brief or caption is required to design a post.');
    const out = await generateValidated(llm, buildStaticPrompt(input), StaticDesignSchema);
    return applyImagePolicy(out.slides, input.useImages);
}

/** Rewrites one slide from a user instruction (regenerate-slide endpoint). */
export async function redesignSlide(
    llm: CreativeLlm,
    input: { brandContext: string; slides: Slide[]; index: number; instruction: string; useImages: boolean },
): Promise<Slide> {
    const prompt = [
        'You are the carousel design agent. Rewrite ONE slide of an existing carousel.',
        '',
        'BRAND CONSCIOUSNESS:',
        input.brandContext,
        '',
        `Full carousel: ${JSON.stringify(input.slides)}`,
        `Rewrite slide index ${input.index} (0-based, currently layout "${input.slides[input.index].layout}").`,
        `Instruction from the user: ${input.instruction}`,
        input.index === 0 ? 'It must stay a "cover" slide.' : input.index === input.slides.length - 1 && input.slides.length > 1 ? 'It must stay a "cta" slide.' : '',
        rules({ brandContext: input.brandContext, useImages: input.useImages }),
        '',
        `Return ONLY JSON: ${SLIDE_SHAPE}`,
    ]
        .filter(Boolean)
        .join('\n');
    const slide = await generateValidated(llm, prompt, {
        parse: (v: any) => SlideSchema.parse(v && typeof v === 'object' && Array.isArray(v.slides) ? v.slides[0] : v),
    });
    return applyImagePolicy([slide], input.useImages)[0];
}
