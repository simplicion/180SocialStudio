import { z } from 'zod';

/** The typed slide contract shared by the design agent, the compiler, the job API and the mobile/web clients. */

export const SLIDE_LAYOUTS = ['cover', 'point', 'quote', 'stat', 'list', 'cta'] as const;
export type SlideLayout = (typeof SLIDE_LAYOUTS)[number];

export const MIN_SLIDES = 5;
export const MAX_SLIDES = 10;

export const SlideSchema = z.object({
    layout: z.enum(SLIDE_LAYOUTS),
    title: z.string().trim().min(1).max(160),
    body: z.string().trim().max(600).default(''),
    /** Art direction for a real photograph behind/inside the slide, or null for a typographic slide. */
    imagePrompt: z.string().trim().min(3).max(600).nullable().default(null),
    /** A word or short phrase from the title to set in the accent colour (must appear in the title), or null. */
    emphasis: z.string().trim().max(80).nullable().default(null),
});
export type Slide = z.infer<typeof SlideSchema>;

export const CarouselDesignSchema = z.object({
    slides: z.array(SlideSchema).min(MIN_SLIDES).max(MAX_SLIDES),
});
export type CarouselDesign = z.infer<typeof CarouselDesignSchema>;

export const StaticDesignSchema = z.object({
    slides: z.array(SlideSchema).length(1),
});

export const CAROUSEL_FORMATS = {
    portrait: { width: 1080, height: 1350 },
    square: { width: 1080, height: 1080 },
} as const;
export type CarouselFormat = keyof typeof CAROUSEL_FORMATS;

/** Normalises what the model returns into the contract (emphasis must be a substring of the title). */
export function normalizeSlides(slides: Slide[]): Slide[] {
    return slides.map((s) => ({
        ...s,
        emphasis: s.emphasis && s.title.toLowerCase().includes(s.emphasis.toLowerCase()) ? s.emphasis : null,
    }));
}
