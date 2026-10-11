import type { CreativeBrand } from './brand';

/**
 * Prompt builder for the image agent. The goal is a photo that reads as a real photograph, not "AI art":
 * concrete camera/lens/light language, natural imperfections, no text in the frame (all typography is added by the
 * deterministic compiler), a colour grade that sits with the brand palette, and negative guidance against the usual
 * tells (plastic skin, HDR glow, over-saturation, extra fingers, garbled lettering).
 */

export interface PhotoPromptInput {
    subject: string;
    brand?: Pick<CreativeBrand, 'colors' | 'name'>;
    aspect: 'portrait' | 'square' | 'landscape';
    /** Where the compiler will put text; the photo keeps that area calm. */
    textArea?: 'bottom' | 'top' | 'none';
}

export interface PhotoPrompt {
    prompt: string;
    negativePrompt: string;
    /** Short keyword query for stock photo search. */
    stockQuery: string;
}

const NEGATIVE = [
    'text', 'letters', 'words', 'captions', 'watermark', 'logo', 'signature', 'typography', 'signage with readable text',
    'plastic skin', 'waxy skin', 'airbrushed', 'over-smoothed', 'doll-like faces', 'uncanny eyes',
    'over-saturated colours', 'HDR glow', 'neon oversharpening', 'excessive bokeh balls', 'lens flare overload',
    'illustration', '3d render', 'CGI', 'cartoon', 'digital painting', 'concept art',
    'extra fingers', 'deformed hands', 'distorted anatomy', 'duplicate people', 'warped geometry', 'melted objects',
    'fake studio perfection', 'stock-photo cliché poses', 'thumbs up',
];

function describeColour(hex: string): string {
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 510;
    if (max - min < 24) return l > 0.8 ? 'clean white' : l < 0.2 ? 'deep charcoal' : 'neutral grey';
    let hue = 0;
    const d = max - min;
    if (max === r) hue = ((g - b) / d) % 6;
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue = (hue * 60 + 360) % 360;
    const names: [number, string][] = [[15, 'red'], [40, 'warm orange'], [65, 'golden yellow'], [150, 'green'], [190, 'teal'], [250, 'blue'], [290, 'violet'], [335, 'magenta'], [360, 'red']];
    const name = names.find(([edge]) => hue < edge)?.[1] || 'red';
    return `${l < 0.35 ? 'deep ' : l > 0.7 ? 'soft ' : ''}${name}`;
}

const STOP = new Set('a an the of in on at to for with and or but from by as is are be into over under this that these those their your our its it very more most photo photograph image shot picture realistic'.split(' '));

export function stockQueryFrom(subject: string): string {
    return subject
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 2 && !STOP.has(w))
        .slice(0, 5)
        .join(' ');
}

export function buildPhotoPrompt(input: PhotoPromptInput): PhotoPrompt {
    const subject = input.subject.replace(/\s+/g, ' ').trim().replace(/[.;]+$/, '');
    const framing =
        input.aspect === 'portrait' ? 'vertical 4:5 composition' : input.aspect === 'square' ? 'square 1:1 composition' : 'horizontal composition';
    const negativeSpace =
        input.textArea === 'bottom'
            ? 'keep the lower third calm and uncluttered (soft, low-detail background) for overlaid copy'
            : input.textArea === 'top'
              ? 'keep the upper third calm and uncluttered for overlaid copy'
              : 'balanced composition with breathing room';
    const grade = input.brand
        ? `subtle colour grade with ${describeColour(input.brand.colors.primary)} and ${describeColour(input.brand.colors.accent)} accents in the environment, true-to-life skin tones`
        : 'natural, true-to-life colour grade';

    const prompt = [
        `Candid, unposed documentary-style photograph: ${subject}.`,
        `Shot on a full-frame mirrorless camera with a 35mm f/1.8 prime lens, natural available light (window light or soft overcast daylight), ${framing}.`,
        `Real-world textures: visible skin pores and fine hair, fabric weave, slight film grain, gentle natural shadows, realistic depth of field.`,
        `${grade}; moderate contrast, no heavy saturation.`,
        `${negativeSpace}.`,
        'No text, letters, signs, logos or watermarks anywhere in the frame.',
    ].join(' ');

    return { prompt, negativePrompt: NEGATIVE.join(', '), stockQuery: stockQueryFrom(subject) || subject.slice(0, 60) };
}

/** For providers without a negative-prompt field, fold the guidance into the prompt. */
export function withInlineNegative(p: PhotoPrompt): string {
    return `${p.prompt} Avoid: ${p.negativePrompt}.`;
}
