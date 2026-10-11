import type { CreativeBrand } from './brand';
import { CAROUSEL_FORMATS, type CarouselFormat, type Slide } from './carousel-schema';
import { AA_LARGE, AA_NORMAL, contrastRatio, ensureContrast, hexToRgb, mix, overlayAlphaForContrast, rgbToHex } from './color';
import { resolveFont, type ResolvedFont } from './fonts';
import { fitText, wrapText, type FitResult } from './text-fit';

/**
 * Deterministic carousel compiler. Layout, typography, colour and logo placement are pure code: the same slides +
 * brand + photos always produce the same PNG. No AI touches these pixels; photographs (from the image agent) are only
 * placed and cropped.
 *
 * Guarantees checked by tests: exact output size, brand colours used, text auto-fitted inside its box (never
 * overflowing; truncation with an ellipsis is reported), and WCAG AA contrast for every text element (colours are
 * nudged and photo overlays are made as opaque as needed).
 */

export interface CompileInput {
    slides: Slide[];
    brand: CreativeBrand;
    format: CarouselFormat;
    /** Photos aligned with `slides` (null = typographic slide). */
    images?: (Buffer | null | undefined)[];
    logo?: Buffer | null;
    /** 'static' renders a single post: no slide numbers or progress bar. */
    mode?: 'carousel' | 'static';
    font?: { allowNetwork?: boolean; fetchImpl?: typeof fetch };
}

export interface TextBoxReport {
    role: string;
    x: number;
    y: number;
    width: number;
    height: number;
    maxWidth: number;
    maxHeight: number;
    fontSize: number;
    truncated: boolean;
    contrast: number;
    /** WCAG AA requirement for this element (4.5 normal text, 3 large display text). */
    required: number;
    color: string;
}

export interface RenderedSlide {
    index: number;
    layout: Slide['layout'];
    width: number;
    height: number;
    png: Buffer;
    truncated: boolean;
    /** Lowest contrast among normal-size text elements. */
    minContrast: number;
    /** Every text element meets its WCAG AA requirement. */
    contrastOk: boolean;
    overlayAlpha: number;
    colorAdjusted: boolean;
    textBoxes: TextBoxReport[];
    warnings: string[];
}

export interface CompileResult {
    slides: RenderedSlide[];
    font: ResolvedFont;
    warnings: string[];
}

function canvasLib(): any {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('@napi-rs/canvas');
}

interface Box {
    x: number;
    y: number;
    w: number;
    h: number;
}

interface Env {
    ctx: any;
    W: number;
    H: number;
    M: number;
    family: string;
    reports: TextBoxReport[];
    warnings: string[];
    colorAdjusted: boolean;
    overlayAlpha: number;
}

const font = (env: Env, weight: number, size: number) => `${weight} ${size}px ${env.family}`;

function measurer(env: Env, weight: number) {
    return (text: string, size: number) => {
        env.ctx.font = font(env, weight, size);
        return env.ctx.measureText(text).width;
    };
}

function roundRect(ctx: any, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

/** Draws `img` to fill the box (centre crop, like CSS object-fit: cover). */
function drawCover(ctx: any, img: any, box: Box) {
    const scale = Math.max(box.w / img.width, box.h / img.height);
    const sw = box.w / scale;
    const sh = box.h / scale;
    const sx = (img.width - sw) / 2;
    const sy = (img.height - sh) / 2;
    ctx.drawImage(img, sx, sy, sw, sh, box.x, box.y, box.w, box.h);
}

const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}%$€£]+/gu, '');

interface TextElement {
    role: string;
    text: string;
    weight: number;
    maxSize: number;
    minSize: number;
    lineHeight: number;
    color: string;
    contrast: number;
    required?: number;
    /** Max share of the stack height this element may take (the last element takes the rest). */
    share?: number;
    gapAfter?: number;
    emphasis?: string | null;
    emphasisColor?: string;
    maxLines?: number;
}

/**
 * Fits and draws a vertical stack of text elements inside `box`. Every element gets an explicit max box, so the
 * stack can never exceed the box.
 */
function drawStack(env: Env, box: Box, elements: TextElement[], opts: { align?: 'left' | 'center'; valign?: 'top' | 'center' | 'bottom' } = {}) {
    const align = opts.align || 'left';
    const fitted: { el: TextElement; fit: FitResult }[] = [];
    let remaining = box.h;
    elements.forEach((el, i) => {
        if (!el.text.trim()) return;
        const isLast = i === elements.length - 1 || elements.slice(i + 1).every((e) => !e.text.trim());
        const reservedForRest = isLast ? 0 : elements.slice(i + 1).filter((e) => e.text.trim()).reduce((s, e) => s + e.minSize * e.lineHeight + (e.gapAfter || 0), 0);
        const gap = isLast ? 0 : el.gapAfter || 0;
        const allowed = Math.max(el.minSize * el.lineHeight, Math.min(el.share ? box.h * el.share : remaining, remaining - reservedForRest - gap));
        const fit = fitText(el.text, { maxWidth: box.w, maxHeight: allowed, maxSize: el.maxSize, minSize: el.minSize, lineHeight: el.lineHeight, maxLines: el.maxLines }, measurer(env, el.weight));
        fitted.push({ el, fit });
        remaining -= fit.height + gap;
        env.reports.push({
            role: el.role,
            x: box.x,
            y: 0,
            width: fit.width,
            height: fit.height,
            maxWidth: box.w,
            maxHeight: allowed,
            fontSize: fit.fontSize,
            truncated: fit.truncated,
            contrast: el.contrast,
            required: el.required ?? AA_NORMAL,
            color: el.color,
        });
    });
    const total = fitted.reduce((s, f, i) => s + f.fit.height + (i < fitted.length - 1 ? f.el.gapAfter || 0 : 0), 0);
    let y = opts.valign === 'bottom' ? box.y + box.h - total : opts.valign === 'center' ? box.y + (box.h - total) / 2 : box.y;
    const reportsStart = env.reports.length - fitted.length;
    fitted.forEach(({ el, fit }, k) => {
        env.reports[reportsStart + k].y = y;
        drawLines(env, fit, el, box, y, align);
        y += fit.height + (el.gapAfter || 0);
    });
    return { height: total };
}

function drawLines(env: Env, fit: FitResult, el: TextElement, box: Box, top: number, align: 'left' | 'center') {
    const { ctx } = env;
    ctx.font = font(env, el.weight, fit.fontSize);
    ctx.textBaseline = 'top';
    const emph = new Set(String(el.emphasis || '').split(/\s+/).map(norm).filter(Boolean));
    fit.lines.forEach((line, i) => {
        const lineW = ctx.measureText(line).width;
        const x0 = align === 'center' ? box.x + (box.w - lineW) / 2 : box.x;
        const y = top + i * fit.lineHeightPx + (fit.lineHeightPx - fit.fontSize) / 2;
        if (!emph.size) {
            ctx.fillStyle = el.color;
            ctx.fillText(line, x0, y);
            return;
        }
        // Word-by-word with prefix-measured positions, so the line is exactly as wide as when it was fitted.
        const re = /\S+/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(line))) {
            ctx.fillStyle = emph.has(norm(m[0])) ? el.emphasisColor || el.color : el.color;
            ctx.fillText(m[0], x0 + ctx.measureText(line.slice(0, m.index)).width, y);
        }
    });
}

/**
 * Makes a region of the (photo) canvas readable: samples the pixels, finds the smallest overlay alpha that gives every
 * requirement AA contrast, and paints the overlay with a soft feather on `featherSide`.
 */
function ensureRegionReadable(env: Env, region: Box, overlayHex: string, reqs: { color: string; min: number }[], featherSide: 'top' | 'bottom' | 'none' = 'top'): number[] {
    const { ctx } = env;
    const x = Math.max(0, Math.floor(region.x));
    const y = Math.max(0, Math.floor(region.y));
    const w = Math.min(env.W - x, Math.ceil(region.w));
    const h = Math.min(env.H - y, Math.ceil(region.h));
    const data = ctx.getImageData(x, y, w, h).data as Uint8ClampedArray;
    let alpha = 0;
    for (const r of reqs) {
        const res = overlayAlphaForContrast(data, r.color, overlayHex, r.min);
        alpha = Math.max(alpha, res.alpha);
    }
    // Contrast actually achieved per requirement at the chosen alpha (95% of the region's pixels).
    const achieved = reqs.map((r) => overlayAlphaForContrastAt(data, r.color, overlayHex, alpha));
    if (alpha > 0) {
        const [R, G, B] = hexToRgb(overlayHex);
        ctx.fillStyle = `rgba(${R},${G},${B},${alpha})`;
        ctx.fillRect(x, y, w, h);
        const feather = Math.round(env.H * 0.12);
        if (featherSide !== 'none') {
            const gy0 = featherSide === 'top' ? y - feather : y + h;
            const g = ctx.createLinearGradient(0, gy0, 0, gy0 + feather);
            const solid = `rgba(${R},${G},${B},${alpha})`;
            const clear = `rgba(${R},${G},${B},0)`;
            g.addColorStop(0, featherSide === 'top' ? clear : solid);
            g.addColorStop(1, featherSide === 'top' ? solid : clear);
            ctx.fillStyle = g;
            ctx.fillRect(x, gy0, w, feather);
        }
    }
    env.overlayAlpha = Math.max(env.overlayAlpha, alpha);
    return achieved;
}

function overlayAlphaForContrastAt(pixels: Uint8ClampedArray, textHex: string, overlayHex: string, alpha: number): number {
    const text = hexToRgb(textHex);
    const overlay = hexToRgb(overlayHex);
    const stride = Math.max(4, Math.floor(pixels.length / 4 / 4000) * 4);
    const ratios: number[] = [];
    for (let i = 0; i + 3 < pixels.length; i += stride) ratios.push(contrastRatio(text, mix([pixels[i], pixels[i + 1], pixels[i + 2]], overlay, alpha)));
    ratios.sort((a, b) => a - b);
    return ratios.length ? ratios[Math.floor(ratios.length * 0.05)] : 21;
}

interface Palette {
    bg: string;
    text: { color: string; ratio: number };
    accent: { color: string; ratio: number };
}

function palette(env: Env, bg: string, brand: CreativeBrand): Palette {
    const text = ensureContrast(brand.colors.text, bg, AA_NORMAL);
    const accent = ensureContrast(brand.colors.accent, bg, AA_LARGE);
    if (text.adjusted || accent.adjusted) env.colorAdjusted = true;
    return { bg, text: { color: text.color, ratio: text.ratio }, accent: { color: accent.color, ratio: accent.ratio } };
}

function drawHeader(env: Env, brand: CreativeBrand, logo: any | null, p: Palette) {
    const { ctx, M } = env;
    const h = Math.round(env.W * 0.06);
    if (logo) {
        const scale = Math.min(h / logo.height, (env.W * 0.3) / logo.width);
        ctx.drawImage(logo, M, M, logo.width * scale, logo.height * scale);
        return;
    }
    drawStack(env, { x: M, y: M, w: env.W * 0.6, h }, [
        { role: 'brand', text: brand.name, weight: 800, maxSize: 30, minSize: 22, lineHeight: 1.2, color: p.text.color, contrast: p.text.ratio, maxLines: 1 },
    ], { valign: 'center' });
}

function drawFooter(env: Env, brand: CreativeBrand, p: Palette, index: number, total: number, mode: 'carousel' | 'static') {
    const { ctx, M, W, H } = env;
    const rowH = 40;
    const y = H - M - rowH;
    const label = brand.handle ? (brand.handle.startsWith('@') ? brand.handle : `@${brand.handle}`) : brand.name;
    const numberW = mode === 'carousel' ? 140 : 0;
    drawStack(env, { x: M, y, w: W - 2 * M - numberW - 20, h: rowH }, [
        { role: 'footer', text: label, weight: 600, maxSize: 26, minSize: 20, lineHeight: 1.3, color: p.text.color, contrast: p.text.ratio, maxLines: 1 },
    ], { valign: 'center' });
    if (mode !== 'carousel') return;
    const num = `${index + 1} / ${total}`;
    ctx.font = font(env, 600, 26);
    ctx.textBaseline = 'top';
    ctx.fillStyle = p.text.color;
    const nw = ctx.measureText(num).width;
    ctx.fillText(num, W - M - nw, y + (rowH - 26) / 2);
    env.reports.push({ role: 'number', x: W - M - nw, y, width: nw, height: 26, maxWidth: numberW, maxHeight: rowH, fontSize: 26, truncated: false, contrast: p.text.ratio, required: AA_NORMAL, color: p.text.color });
    // Progress bar in the bottom margin.
    const barY = H - Math.round(M * 0.45);
    const trackColor = rgbToHex(mix(hexToRgb(p.text.color), hexToRgb(p.bg), 0.72));
    ctx.fillStyle = trackColor;
    roundRect(ctx, M, barY, W - 2 * M, 6, 3);
    ctx.fill();
    ctx.fillStyle = p.accent.color;
    roundRect(ctx, M, barY, Math.max(12, ((W - 2 * M) * (index + 1)) / total), 6, 3);
    ctx.fill();
}

function listItems(body: string): string[] {
    return String(body || '')
        .split(/\n|•|;(?=\s)/)
        .map((s) => s.replace(/^\s*(?:[-*–]|\d+[.)])\s*/, '').trim())
        .filter(Boolean)
        .slice(0, 6);
}

interface ListPlan {
    size: number;
    wrapped: string[][];
    truncated: boolean;
    height: number;
    lh: number;
}

const LIST_INDENT = 52;

/** Fits bullet items into w x h: one shared font size; drops trailing items (reported) only if 26px cannot hold them. */
function planList(env: Env, w: number, h: number, items: string[]): ListPlan {
    const measure = measurer(env, 400);
    const lh = 1.3;
    const heightOf = (size: number, wrapped: string[][]) => wrapped.reduce((s, l) => s + l.length * size * lh, 0) + (wrapped.length - 1) * size * 0.7;
    for (let size = 48; size >= 26; size -= 2) {
        const wrapped = items.map((it) => wrapText(it, size, w - LIST_INDENT, measure));
        const height = heightOf(size, wrapped);
        if (height <= h) return { size, wrapped, truncated: false, height, lh };
    }
    const size = 26;
    for (let n = items.length; n >= 1; n--) {
        let wrapped = items.slice(0, n).map((it) => wrapText(it, size, w - LIST_INDENT, measure));
        if (n === 1 && heightOf(size, wrapped) > h) {
            wrapped = [fitText(items[0], { maxWidth: w - LIST_INDENT, maxHeight: h, maxSize: size, minSize: size, lineHeight: lh }, measure).lines];
        }
        const height = heightOf(size, wrapped);
        if (height <= h + 0.01 || n === 1) return { size, wrapped, truncated: true, height, lh };
    }
    return { size, wrapped: [], truncated: true, height: 0, lh };
}

function paintList(env: Env, x: number, y0: number, w: number, maxH: number, plan: ListPlan, p: Palette) {
    const { ctx } = env;
    const { size, lh } = plan;
    let y = y0;
    let maxW = 0;
    ctx.textBaseline = 'top';
    plan.wrapped.forEach((lines) => {
        ctx.fillStyle = p.accent.color;
        roundRect(ctx, x, y + (size * lh) / 2 - 8, 16, 16, 4);
        ctx.fill();
        ctx.font = font(env, 400, size);
        ctx.fillStyle = p.text.color;
        lines.forEach((line, i) => {
            maxW = Math.max(maxW, ctx.measureText(line).width);
            ctx.fillText(line, x + LIST_INDENT, y + i * size * lh + (size * lh - size) / 2);
        });
        y += lines.length * size * lh + size * 0.7;
    });
    env.reports.push({ role: 'list', x: x + LIST_INDENT, y: y0, width: maxW, height: plan.height, maxWidth: w - LIST_INDENT, maxHeight: maxH, fontSize: size, truncated: plan.truncated, contrast: p.text.ratio, required: AA_NORMAL, color: p.text.color });
}

async function renderOne(
    base: { brand: CreativeBrand; format: CarouselFormat; family: string; mode: 'carousel' | 'static'; logo: any | null },
    slide: Slide,
    index: number,
    total: number,
    photoBuf: Buffer | null | undefined,
): Promise<RenderedSlide> {
    const { createCanvas, loadImage } = canvasLib();
    const { width: W, height: H } = CAROUSEL_FORMATS[base.format];
    const c = createCanvas(W, H);
    const ctx = c.getContext('2d');
    const env: Env = { ctx, W, H, M: Math.round(W * 0.075), family: base.family, reports: [], warnings: [], colorAdjusted: false, overlayAlpha: 0 };
    const { brand } = base;
    const M = env.M;
    const headerBottom = M + Math.round(W * 0.06);
    const footerTop = H - M - 40;
    const content: Box = { x: M, y: headerBottom + 36, w: W - 2 * M, h: footerTop - 28 - (headerBottom + 36) };

    let photo: any = null;
    if (photoBuf) {
        try {
            photo = await loadImage(photoBuf);
        } catch {
            env.warnings.push(`Slide ${index + 1}: the photo could not be decoded; rendered without it.`);
        }
    }

    const layout = slide.layout;
    const solidBg = layout === 'quote' || layout === 'cta' ? brand.colors.primary : brand.colors.background;
    const inset = !!photo && layout === 'point';
    const fullPhoto = !!photo && !inset;

    ctx.fillStyle = solidBg;
    ctx.fillRect(0, 0, W, H);
    let p = palette(env, solidBg, brand);

    if (fullPhoto) {
        drawCover(ctx, photo, { x: 0, y: 0, w: W, h: H });
        // Text sits on the overlay colour; pick text/accent that pass on the pure overlay, then size the overlay.
        const overlay = solidBg;
        p = palette(env, overlay, brand);
        const textRegion: Box =
            layout === 'cover'
                ? { x: 0, y: content.y + content.h * 0.38, w: W, h: H - (content.y + content.h * 0.38) }
                : { x: 0, y: content.y - 20, w: W, h: H - (content.y - 20) };
        const reqs = [{ color: p.text.color, min: AA_NORMAL }, { color: p.accent.color, min: AA_LARGE }];
        const r1 = ensureRegionReadable(env, textRegion, overlay, reqs, 'top');
        const r2 = ensureRegionReadable(env, { x: 0, y: 0, w: W, h: headerBottom + 12 }, overlay, reqs, 'bottom');
        // What the text actually gets is the weaker of: pure overlay colour, and the photo seen through the overlay.
        p = { ...p, text: { ...p.text, ratio: Math.min(p.text.ratio, r1[0], r2[0]) }, accent: { ...p.accent, ratio: Math.min(p.accent.ratio, r1[1], r2[1]) } };
    }

    drawHeader(env, brand, base.logo, p);

    const T = { color: p.text.color, contrast: p.text.ratio };
    const A = { color: p.accent.color, contrast: p.accent.ratio, required: AA_LARGE };
    const num = String(index + 1).padStart(2, '0');

    switch (layout) {
        case 'cover': {
            const box = fullPhoto ? { ...content, y: content.y + content.h * 0.42, h: content.h * 0.58 } : content;
            if (!fullPhoto) {
                ctx.fillStyle = A.color;
                ctx.fillRect(M, content.y + content.h * 0.3 - 40, 120, 10);
            }
            const inner = fullPhoto ? box : { ...box, y: content.y + content.h * 0.3, h: content.h * 0.7 };
            drawStack(env, inner, [
                { role: 'title', text: slide.title, weight: 800, maxSize: 112, minSize: 52, lineHeight: 1.05, ...T, share: 0.72, gapAfter: 28, emphasis: slide.emphasis, emphasisColor: A.color },
                { role: 'body', text: slide.body, weight: 400, maxSize: 40, minSize: 28, lineHeight: 1.3, ...T },
            ], { valign: fullPhoto ? 'bottom' : 'top' });
            break;
        }
        case 'point': {
            let box = content;
            if (inset) {
                const ph = Math.round(content.h * 0.46);
                ctx.save();
                roundRect(ctx, content.x, content.y, content.w, ph, 28);
                ctx.clip();
                drawCover(ctx, photo, { x: content.x, y: content.y, w: content.w, h: ph });
                ctx.restore();
                box = { ...content, y: content.y + ph + 40, h: content.h - ph - 40 };
            }
            drawStack(env, box, [
                { role: 'number', text: num, weight: 800, maxSize: 44, minSize: 30, lineHeight: 1.1, ...A, gapAfter: 20, maxLines: 1 },
                { role: 'title', text: slide.title, weight: 800, maxSize: inset ? 72 : 88, minSize: 40, lineHeight: 1.08, ...T, share: 0.55, gapAfter: 24, emphasis: slide.emphasis, emphasisColor: A.color },
                { role: 'body', text: slide.body, weight: 400, maxSize: 40, minSize: 26, lineHeight: 1.35, ...T },
            ], { valign: inset ? 'top' : 'center' });
            break;
        }
        case 'quote': {
            const markSize = Math.round(W * 0.2);
            ctx.font = font(env, 800, markSize);
            ctx.textBaseline = 'top';
            ctx.fillStyle = A.color;
            ctx.fillText('“', M - 6, content.y - markSize * 0.12);
            const box = { ...content, y: content.y + markSize * 0.62, h: content.h - markSize * 0.62 };
            drawStack(env, box, [
                { role: 'title', text: slide.title, weight: 600, maxSize: 76, minSize: 36, lineHeight: 1.2, ...T, share: 0.8, gapAfter: 36, emphasis: slide.emphasis, emphasisColor: A.color },
                { role: 'body', text: slide.body ? (/^[—–-]/.test(slide.body) ? slide.body : `— ${slide.body}`) : '', weight: 400, maxSize: 34, minSize: 26, lineHeight: 1.3, ...T },
            ], { valign: 'center' });
            break;
        }
        case 'stat': {
            drawStack(env, content, [
                { role: 'title', text: slide.title, weight: 800, maxSize: 240, minSize: 64, lineHeight: 1.0, ...A, share: 0.5, gapAfter: 32, maxLines: 3 },
                { role: 'body', text: slide.body, weight: 400, maxSize: 44, minSize: 28, lineHeight: 1.3, ...T },
            ], { valign: 'center' });
            break;
        }
        case 'list': {
            const items = listItems(slide.body);
            const titleFit = fitText(slide.title, { maxWidth: content.w, maxHeight: content.h * 0.34, maxSize: 80, minSize: 40, lineHeight: 1.08 }, measurer(env, 800));
            const gap = 48;
            const listH = content.h - titleFit.height - gap;
            const plan = items.length ? planList(env, content.w, listH, items) : null;
            const total = titleFit.height + (plan ? gap + plan.height : 0);
            const top = content.y + Math.max(0, (content.h - total) / 2);
            drawStack(env, { ...content, y: top, h: titleFit.height + 0.5 }, [
                { role: 'title', text: slide.title, weight: 800, maxSize: 80, minSize: 40, lineHeight: 1.08, ...T, emphasis: slide.emphasis, emphasisColor: A.color },
            ]);
            if (plan) paintList(env, content.x, top + titleFit.height + gap, content.w, listH, plan, p);
            break;
        }
        case 'cta': {
            let box = content;
            if (base.logo && !fullPhoto) {
                const lh = Math.round(content.h * 0.14);
                const scale = Math.min(lh / base.logo.height, (content.w * 0.5) / base.logo.width);
                const lw = base.logo.width * scale;
                ctx.drawImage(base.logo, (W - lw) / 2, content.y + content.h * 0.08, lw, base.logo.height * scale);
                box = { ...content, y: content.y + content.h * 0.08 + lh + 40, h: content.h - (content.h * 0.08 + lh + 40) };
            }
            const pillH = 96;
            const textBox = { ...box, h: box.h - pillH - 56 };
            const r = drawStack(env, textBox, [
                { role: 'title', text: slide.title, weight: 800, maxSize: 92, minSize: 44, lineHeight: 1.08, ...T, share: 0.65, gapAfter: 28, emphasis: slide.emphasis, emphasisColor: A.color },
                { role: 'body', text: slide.body, weight: 400, maxSize: 38, minSize: 26, lineHeight: 1.35, ...T },
            ], { align: 'center', valign: 'center' });
            // Pill button (brand accent) with a label that passes AA on the accent.
            const label = brand.handle ? `Follow ${brand.handle.startsWith('@') ? brand.handle : '@' + brand.handle}` : brand.name ? `Follow ${brand.name}` : '';
            if (!label) break;
            const pillTextColor = ensureContrast(brand.colors.background, brand.colors.accent, AA_NORMAL);
            const pillBg = brand.colors.accent;
            const labelFit = fitText(label, { maxWidth: content.w - 120, maxHeight: 40, maxSize: 34, minSize: 24, lineHeight: 1.1, maxLines: 1 }, measurer(env, 600));
            const pw = Math.min(content.w, labelFit.width + 120);
            const py = textBox.y + (textBox.h + r.height) / 2 + 56;
            ctx.fillStyle = pillBg;
            roundRect(ctx, (W - pw) / 2, py, pw, pillH, pillH / 2);
            ctx.fill();
            ctx.font = font(env, 600, labelFit.fontSize);
            ctx.textBaseline = 'top';
            ctx.fillStyle = pillTextColor.color;
            ctx.fillText(labelFit.lines[0], (W - labelFit.width) / 2, py + (pillH - labelFit.fontSize) / 2);
            env.reports.push({ role: 'cta-button', x: (W - labelFit.width) / 2, y: py, width: labelFit.width, height: labelFit.fontSize, maxWidth: content.w - 120, maxHeight: 40, fontSize: labelFit.fontSize, truncated: labelFit.truncated, contrast: pillTextColor.ratio, required: AA_NORMAL, color: pillTextColor.color });
            if (pillTextColor.adjusted) env.colorAdjusted = true;
            break;
        }
    }

    drawFooter(env, brand, p, index, total, base.mode);

    const truncated = env.reports.some((r) => r.truncated);
    if (truncated) env.warnings.push(`Slide ${index + 1}: copy was too long for the layout and was shortened with an ellipsis.`);
    const normal = env.reports.filter((r) => r.required >= AA_NORMAL);
    const minContrast = normal.length ? Math.min(...normal.map((r) => r.contrast)) : 21;
    const contrastOk = env.reports.every((r) => r.contrast + 1e-6 >= r.required);
    return {
        index,
        layout,
        width: W,
        height: H,
        png: c.toBuffer('image/png'),
        truncated,
        minContrast,
        contrastOk,
        overlayAlpha: env.overlayAlpha,
        colorAdjusted: env.colorAdjusted,
        textBoxes: env.reports,
        warnings: env.warnings,
    };
}

async function loadLogo(logo: Buffer | null | undefined, warnings: string[]): Promise<any | null> {
    if (!logo) return null;
    try {
        return await canvasLib().loadImage(logo);
    } catch {
        warnings.push('The brand logo could not be decoded (use PNG, JPEG, WebP or SVG); slides were rendered with the brand name instead.');
        return null;
    }
}

export async function compileCarousel(input: CompileInput): Promise<CompileResult> {
    if (!CAROUSEL_FORMATS[input.format]) throw new Error(`Unknown format ${input.format}`);
    if (!input.slides.length) throw new Error('No slides to render');
    const warnings: string[] = [];
    const resolved = await resolveFont(input.brand.font, input.font);
    if (resolved.fallback) warnings.push(`Brand font "${resolved.requested}" is not available on the server; used Inter. Add it to CREATIVE_FONTS_DIR to use it.`);
    const logo = await loadLogo(input.logo, warnings);
    const mode = input.mode || 'carousel';
    const base = { brand: input.brand, format: input.format, family: resolved.family, mode, logo };
    const slides: RenderedSlide[] = [];
    for (let i = 0; i < input.slides.length; i++) {
        const r = await renderOne(base, input.slides[i], i, input.slides.length, input.images?.[i]);
        warnings.push(...r.warnings);
        slides.push(r);
    }
    return { slides, font: resolved, warnings };
}

/** Re-renders one slide of an existing carousel (same numbering), for the regenerate-slide endpoint. */
export async function compileSingleSlide(input: CompileInput & { index: number }): Promise<{ slide: RenderedSlide; warnings: string[] }> {
    const warnings: string[] = [];
    const resolved = await resolveFont(input.brand.font, input.font);
    if (resolved.fallback) warnings.push(`Brand font "${resolved.requested}" is not available on the server; used Inter.`);
    const logo = await loadLogo(input.logo, warnings);
    const slide = await renderOne(
        { brand: input.brand, format: input.format, family: resolved.family, mode: input.mode || 'carousel', logo },
        input.slides[input.index],
        input.index,
        input.slides.length,
        input.images?.[input.index],
    );
    return { slide, warnings: [...warnings, ...slide.warnings] };
}

/** A single static post image (1 slide, no slide numbers). */
export async function renderStaticPost(input: Omit<CompileInput, 'mode'>): Promise<CompileResult> {
    return compileCarousel({ ...input, slides: input.slides.slice(0, 1), mode: 'static' });
}
