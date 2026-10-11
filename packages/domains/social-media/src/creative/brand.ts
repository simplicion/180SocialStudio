import { BRAND_RENDER_DEFAULTS, resolveBrandRendering, toBrandPromptContext, type BrandConsciousness } from '../brand-consciousness';

/**
 * The slice of the project's brand consciousness (WS1 `getProjectBrandConsciousness`) the creative engine needs.
 * Visual values (colours, font, logo) go to the deterministic compiler; the prompt context goes to the agents.
 * Unset colours/font get WS1's neutral render defaults (`resolveBrandRendering`), which are reported as warnings.
 */
export interface CreativeBrand {
    name: string;
    handle?: string;
    tagline?: string;
    colors: { primary: string; accent: string; background: string; text: string };
    font: string;
    logoUrl?: string | null;
    promptContext: string;
    forbiddenWords: string[];
    standardCtas: string[];
    /** Visual fields the brand has not set (filled with neutral render defaults). */
    usedDefaults?: string[];
}

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;
export function normalizeHex(value: string | undefined | null, fallback: string): string {
    const v = String(value || '').trim();
    if (!HEX.test(v)) return fallback;
    let h = v.replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    return `#${h.toUpperCase()}`;
}

export function toCreativeBrand(b: BrandConsciousness & { toPromptContext?: (o?: any) => string }, extra: { handle?: string } = {}): CreativeBrand {
    const r = resolveBrandRendering(b);
    const promptContext = typeof b.toPromptContext === 'function' ? b.toPromptContext({ includeVisual: false }) : toBrandPromptContext(b, { includeVisual: false });
    return {
        name: b.brandName || b.projectName || '',
        handle: extra.handle,
        tagline: b.tagline || undefined,
        colors: {
            primary: normalizeHex(r.colors.primary, BRAND_RENDER_DEFAULTS.colors.primary),
            accent: normalizeHex(r.colors.accent, BRAND_RENDER_DEFAULTS.colors.accent),
            background: normalizeHex(r.colors.background, BRAND_RENDER_DEFAULTS.colors.background),
            text: normalizeHex(r.colors.text, BRAND_RENDER_DEFAULTS.colors.text),
        },
        font: r.font,
        logoUrl: r.logoUrl || null,
        promptContext,
        forbiddenWords: b.forbiddenWords || [],
        standardCtas: b.ctas || [],
        usedDefaults: r.usedDefaults.filter((f) => f.startsWith('colors.') || f === 'font'),
    };
}
