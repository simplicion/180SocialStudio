/** Colour maths for the compiler: WCAG 2.x relative luminance, contrast ratio and automatic fixes. */

export type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
    let h = String(hex || '').replace('#', '').trim();
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    if (!/^[0-9a-f]{6}$/i.test(h)) return [0, 0, 0];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function rgbToHex([r, g, b]: RGB): string {
    const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
    return `#${c(r)}${c(g)}${c(b)}`.toUpperCase();
}

const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};

export function luminance(rgb: RGB): number {
    return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

export function contrastRatio(a: RGB | string, b: RGB | string): number {
    const la = luminance(typeof a === 'string' ? hexToRgb(a) : a);
    const lb = luminance(typeof b === 'string' ? hexToRgb(b) : b);
    const [hi, lo] = la > lb ? [la, lb] : [lb, la];
    return (hi + 0.05) / (lo + 0.05);
}

/** WCAG AA: 4.5 for body text, 3.0 for large text (>= 24px regular / 18.66px bold). We use 4.5 everywhere. */
export const AA_NORMAL = 4.5;
export const AA_LARGE = 3;

export function mix(a: RGB, b: RGB, t: number): RGB {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/**
 * Returns a text colour that passes `min` against `bg`. Keeps the preferred colour when it passes, otherwise moves it
 * towards white or black (whichever reaches the target with the smallest change), so the brand hue survives when possible.
 */
export function ensureContrast(preferredHex: string, bgHex: string, min = AA_NORMAL): { color: string; ratio: number; adjusted: boolean } {
    const bg = hexToRgb(bgHex);
    const pref = hexToRgb(preferredHex);
    const start = contrastRatio(pref, bg);
    if (start >= min) return { color: rgbToHex(pref), ratio: start, adjusted: false };
    let best: { color: string; ratio: number; step: number } | null = null;
    for (const target of [[255, 255, 255], [0, 0, 0]] as RGB[]) {
        for (let step = 1; step <= 20; step++) {
            const c = mix(pref, target, step / 20);
            const r = contrastRatio(c, bg);
            if (r >= min) {
                if (!best || step < best.step) best = { color: rgbToHex(c), ratio: r, step };
                break;
            }
        }
    }
    if (best) return { color: best.color, ratio: best.ratio, adjusted: true };
    // Mid-grey backgrounds may not reach 4.5 with either; pick the better pole.
    const w = contrastRatio([255, 255, 255], bg);
    const k = contrastRatio([0, 0, 0], bg);
    return w >= k ? { color: '#FFFFFF', ratio: w, adjusted: true } : { color: '#000000', ratio: k, adjusted: true };
}

/**
 * For text drawn over a photo region: the smallest overlay alpha (of `overlayHex`) that makes `textHex` pass `min`
 * against (almost) every pixel of the region. `pixels` is RGBA data; the 95th-percentile worst pixel is used so a few
 * specular highlights do not force a fully opaque panel.
 */
export function overlayAlphaForContrast(
    pixels: Uint8ClampedArray | Uint8Array,
    textHex: string,
    overlayHex: string,
    min = AA_NORMAL,
): { alpha: number; ratio: number } {
    const text = hexToRgb(textHex);
    const overlay = hexToRgb(overlayHex);
    const samples: RGB[] = [];
    const stride = Math.max(4, Math.floor(pixels.length / 4 / 4000) * 4);
    for (let i = 0; i + 3 < pixels.length; i += stride) samples.push([pixels[i], pixels[i + 1], pixels[i + 2]]);
    if (!samples.length) return { alpha: 0, ratio: 21 };
    const worstRatio = (alpha: number) => {
        const ratios = samples.map((p) => contrastRatio(text, mix(p, overlay, alpha))).sort((a, b) => a - b);
        return ratios[Math.floor(ratios.length * 0.05)];
    };
    for (let a = 0; a <= 1.0001; a += 0.05) {
        const r = worstRatio(a);
        if (r >= min) return { alpha: Math.min(1, Number(a.toFixed(2))), ratio: r };
    }
    return { alpha: 1, ratio: contrastRatio(text, overlay) };
}
