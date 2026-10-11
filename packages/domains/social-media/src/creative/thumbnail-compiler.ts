import { z } from 'zod';
import { contrastRatio, hexToRgb, overlayAlphaForContrast, rgbToHex, type RGB } from './color';
import { fitText } from './text-fit';

/**
 * Video thumbnail compositor (deterministic): a REAL frame of the edited video, a designer layout and real type.
 * Nothing is AI-painted: the agents only choose among these options (thumbnail-agent.ts), and every result is
 * measured here (contrast under the text, text size, face kept clear, platform safe zones).
 */

export const THUMB_FORMATS = {
    /** Reels / Shorts / TikTok cover. */
    '9:16': { width: 1080, height: 1920 },
    /** YouTube / long-form. */
    '16:9': { width: 1280, height: 720 },
} as const;
export type ThumbFormat = keyof typeof THUMB_FORMATS;

export const THUMB_LAYOUTS = ['face_left_text_right', 'face_right_text_left', 'text_top', 'text_bottom', 'center_punch', 'boxed_tag'] as const;
export const THUMB_FONTS = ['Anton', 'Bebas Neue', 'Montserrat', 'Poppins', 'Inter'] as const;
const HEX = /^#[0-9A-Fa-f]{6}$/;

export const ThumbnailSpecSchema = z.object({
    frameIndex: z.number().int().min(0),
    layout: z.enum(THUMB_LAYOUTS),
    /** 1–5 words, the hook (not the video title). */
    headline: z.string().trim().min(1).max(36).refine((s) => s.split(/\s+/).filter(Boolean).length <= 5, 'at most 5 words'),
    /** One word of the headline drawn in the emphasis colour (or null). */
    emphasis: z.string().trim().max(20).nullable().default(null),
    font: z.enum(THUMB_FONTS),
    uppercase: z.boolean().default(true),
    textColor: z.string().regex(HEX),
    emphasisColor: z.string().regex(HEX),
    textStyle: z.enum(['outline', 'shadow', 'box']),
    boxColor: z.string().regex(HEX).nullable().default(null),
    /** Punch-in on the face (1 = whole frame). */
    zoom: z.number().min(1).max(1.6).default(1.15),
    accent: z.enum(['none', 'circle', 'arrow', 'underline']).default('none'),
    accentColor: z.string().regex(HEX).nullable().default(null),
});
export type ThumbnailSpec = z.infer<typeof ThumbnailSpecSchema>;

export interface ThumbFrame {
    /** Decoded image (@napi-rs/canvas Image). */
    image: any;
    /** Faces as 0..1 fractions of the frame (centre x/y, width, height). */
    faces: Array<{ x: number; y: number; w: number; h: number }>;
}

export interface ThumbQaReport {
    contrast: number;
    textHeightPct: number;
    faceOverlapPct: number;
    inSafeZone: boolean;
    wordCount: number;
    /** Deterministic fixes the compiler applied (e.g. added a backing box for contrast). */
    autoFixes: string[];
    passed: boolean;
    problems: string[];
}

interface Box { x: number; y: number; w: number; h: number }

function canvasLib(): any {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('@napi-rs/canvas');
}

/** Where platform UI covers the picture (buttons, captions, timestamp). Text must stay inside the safe box. */
export function safeBox(format: ThumbFormat): Box {
    const { width: W, height: H } = THUMB_FORMATS[format];
    return format === '9:16'
        ? { x: W * 0.06, y: H * 0.14, w: W * 0.8, h: H * 0.58 } // Reels: top bar, right-hand buttons, bottom caption
        : { x: W * 0.04, y: H * 0.06, w: W * 0.92, h: H * 0.76 }; // YouTube: bottom-right timestamp strip
}

/** Frame crop (cover) centred on the main face, punched in by [zoom]. Returns source rect. */
export function cropFor(imgW: number, imgH: number, W: number, H: number, face: { x: number; y: number } | null, zoom: number): Box {
    const scale = Math.max(W / imgW, H / imgH) * zoom;
    const sw = W / scale;
    const sh = H / scale;
    const cx = (face?.x ?? 0.5) * imgW;
    const cy = (face?.y ?? 0.45) * imgH;
    return {
        x: Math.min(Math.max(0, cx - sw / 2), imgW - sw),
        y: Math.min(Math.max(0, cy - sh * 0.42), imgH - sh),
        w: sw,
        h: sh,
    };
}

/** Text region for a layout, kept inside the safe box and on the side away from the face. */
export function textRegion(layout: ThumbnailSpec['layout'], format: ThumbFormat, faceBox: Box | null): Box {
    const s = safeBox(format);
    const tall = format === '9:16';
    switch (layout) {
        case 'face_left_text_right':
            return tall ? { x: s.x, y: s.y + s.h * 0.55, w: s.w, h: s.h * 0.45 } : { x: s.x + s.w * 0.48, y: s.y, w: s.w * 0.52, h: s.h };
        case 'face_right_text_left':
            return tall ? { x: s.x, y: s.y, w: s.w, h: s.h * 0.45 } : { x: s.x, y: s.y, w: s.w * 0.52, h: s.h };
        case 'text_top':
            return { x: s.x, y: s.y, w: s.w, h: s.h * (tall ? 0.36 : 0.42) };
        case 'text_bottom':
            return { x: s.x, y: s.y + s.h * (tall ? 0.62 : 0.56), w: s.w, h: s.h * (tall ? 0.38 : 0.44) };
        case 'boxed_tag':
            return { x: s.x, y: s.y + s.h * (tall ? 0.7 : 0.66), w: s.w * (tall ? 1 : 0.62), h: s.h * (tall ? 0.3 : 0.34) };
        case 'center_punch':
        default: {
            // Centre, but slide off the face when they would collide.
            const mid = { x: s.x, y: s.y + s.h * 0.32, w: s.w, h: s.h * 0.36 };
            if (faceBox && overlap(mid, faceBox) > 0.25 * faceBox.w * faceBox.h) return textRegion('text_bottom', format, faceBox);
            return mid;
        }
    }
}

function overlap(a: Box, b: Box): number {
    const w = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    const h = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    return w * h;
}

/**
 * Renders one thumbnail and measures it. Readability is enforced, not hoped for: when the text colour does not reach
 * 4.5:1 against what is actually under it, a backing box (or a darker one) is added and reported.
 */
export async function renderThumbnail(
    spec: ThumbnailSpec,
    frame: ThumbFrame,
    format: ThumbFormat,
    family: string,
): Promise<{ png: Buffer; qa: ThumbQaReport; spec: ThumbnailSpec }> {
    const { createCanvas } = canvasLib();
    const { width: W, height: H } = THUMB_FORMATS[format];
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const autoFixes: string[] = [];
    let s = { ...spec };

    // 1. The real frame: face-centred crop, a gentle photographic grade (contrast / saturation), soft vignette.
    const face = frame.faces.slice().sort((a, b) => b.w * b.h - a.w * a.h)[0] ?? null;
    const src = cropFor(frame.image.width, frame.image.height, W, H, face, s.zoom);
    ctx.filter = 'contrast(1.08) saturate(1.12)';
    ctx.drawImage(frame.image, src.x, src.y, src.w, src.h, 0, 0, W, H);
    ctx.filter = 'none';
    const vig = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) / 2);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, W, H);

    // Face box on the canvas (for keeping text off it).
    const scale = W / src.w;
    const faceBox: Box | null = face
        ? {
              x: (face.x * frame.image.width - face.w * frame.image.width / 2 - src.x) * scale,
              y: (face.y * frame.image.height - face.h * frame.image.height / 2 - src.y) * scale,
              w: face.w * frame.image.width * scale,
              h: face.h * frame.image.height * scale,
          }
        : null;

    // 2. Type: fitted into the layout region.
    let region = textRegion(s.layout, format, faceBox);
    const text = s.uppercase ? s.headline.toUpperCase() : s.headline;
    const weight = s.font === 'Anton' || s.font === 'Bebas Neue' ? 400 : 800;
    const measure = (t: string, size: number) => {
        ctx.font = `${weight} ${size}px ${family}`;
        return ctx.measureText(t).width;
    };
    const pad = s.textStyle === 'box' ? Math.round(H * 0.018) : 0;
    const fit = fitText(text, { maxWidth: region.w - pad * 2, maxHeight: region.h - pad * 2, maxSize: Math.round(H * (format === '9:16' ? 0.085 : 0.16)), minSize: Math.round(H * 0.045), lineHeight: 1.04, maxLines: 3 }, measure);
    const block: Box = {
        x: region.x,
        y: s.layout === 'text_bottom' || s.layout === 'boxed_tag' ? region.y + region.h - fit.height - pad * 2 : region.y,
        w: Math.min(region.w, fit.width + pad * 2),
        h: fit.height + pad * 2,
    };
    if (s.layout === 'center_punch' || s.layout === 'text_top' || s.layout === 'text_bottom') block.x = region.x + (region.w - block.w) / 2;

    // 3. Contrast against the real pixels under the text; add / darken a backing box until it reads.
    const under = ctx.getImageData(Math.max(0, Math.floor(block.x)), Math.max(0, Math.floor(block.y)), Math.max(1, Math.floor(block.w)), Math.max(1, Math.floor(block.h))).data as Uint8ClampedArray;
    const avg = averageRgb(under);
    let contrast = contrastRatio(s.textColor, avg);
    let boxColor = s.textStyle === 'box' ? s.boxColor ?? '#111111' : null;
    if (s.textStyle !== 'box' && contrast < 4.5) {
        // Outline / shadow alone is not enough on this frame. A light darkening reads as natural photo grading
        // (soft scrim); when it would need to be heavy, a solid backing box looks intentional instead.
        const need = overlayAlphaForContrast(under, s.textColor, '#000000');
        if (need.alpha > 0.55) {
            s = { ...s, textStyle: 'box', boxColor: '#111111' };
            boxColor = '#111111';
            autoFixes.push(`added a backing box (text contrast was ${contrast.toFixed(1)}:1)`);
        } else {
            const a = Math.min(0.55, need.alpha + 0.05);
            const grow = H * 0.03;
            const scrim = ctx.createLinearGradient(0, block.y - grow, 0, block.y + block.h + grow);
            scrim.addColorStop(0, 'rgba(0,0,0,0)');
            scrim.addColorStop(0.18, `rgba(0,0,0,${a})`);
            scrim.addColorStop(0.82, `rgba(0,0,0,${a})`);
            scrim.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = scrim;
            ctx.fillRect(block.x - grow, block.y - grow, block.w + grow * 2, block.h + grow * 2);
            const after = ctx.getImageData(Math.max(0, Math.floor(block.x)), Math.max(0, Math.floor(block.y)), Math.max(1, Math.floor(block.w)), Math.max(1, Math.floor(block.h))).data as Uint8ClampedArray;
            contrast = contrastRatio(s.textColor, averageRgb(after));
            autoFixes.push(`darkened behind the text (contrast was ${contrastRatio(s.textColor, avg).toFixed(1)}:1)`);
        }
    }
    if (boxColor) {
        contrast = contrastRatio(s.textColor, boxColor);
        if (contrast < 4.5) {
            boxColor = contrastRatio(s.textColor, '#111111') >= 4.5 ? '#111111' : '#FFFFFF';
            autoFixes.push('changed the box colour for contrast');
            contrast = contrastRatio(s.textColor, boxColor);
        }
        ctx.fillStyle = boxColor;
        roundRect(ctx, block.x, block.y, block.w, block.h, Math.round(H * 0.012));
        ctx.fill();
    }

    // 4. Draw the lines, emphasis word in its colour, with outline or shadow for punch.
    const lineH = fit.lineHeightPx;
    ctx.textBaseline = 'top';
    const emphasis = (s.emphasis || '').toUpperCase();
    fit.lines.forEach((line, i) => {
        const y = block.y + pad + i * lineH;
        let x = block.x + pad + (s.layout === 'center_punch' || s.layout === 'text_top' || s.layout === 'text_bottom' ? (block.w - pad * 2 - measure(line, fit.fontSize)) / 2 : 0);
        ctx.font = `${weight} ${fit.fontSize}px ${family}`;
        for (const word of line.split(' ')) {
            const isEmph = emphasis && word.toUpperCase().replace(/[^A-Z0-9]/g, '') === emphasis.replace(/[^A-Z0-9]/g, '');
            const color = isEmph ? s.emphasisColor : s.textColor;
            if (s.textStyle === 'shadow' && !boxColor) {
                ctx.shadowColor = 'rgba(0,0,0,0.75)';
                ctx.shadowBlur = fit.fontSize * 0.18;
                ctx.shadowOffsetY = fit.fontSize * 0.05;
            }
            if (s.textStyle === 'outline' && !boxColor) {
                ctx.lineJoin = 'round';
                ctx.lineWidth = Math.max(4, fit.fontSize * 0.12);
                ctx.strokeStyle = '#000000';
                ctx.strokeText(word, x, y);
            }
            ctx.fillStyle = color;
            ctx.fillText(word, x, y);
            ctx.shadowColor = 'transparent';
            x += measure(word + ' ', fit.fontSize);
        }
    });

    // 5. One accent, hand-drawn style, pointing at the face (never covering it).
    const accent = s.accentColor ?? s.emphasisColor;
    if (s.accent === 'underline') {
        ctx.strokeStyle = accent;
        ctx.lineWidth = Math.max(6, H * 0.008);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(block.x + pad, block.y + block.h + H * 0.01);
        ctx.lineTo(block.x + Math.min(block.w, measure(fit.lines[fit.lines.length - 1] ?? '', fit.fontSize) + pad), block.y + block.h + H * 0.012);
        ctx.stroke();
    } else if ((s.accent === 'circle' || s.accent === 'arrow') && faceBox) {
        ctx.strokeStyle = accent;
        ctx.lineWidth = Math.max(6, H * 0.008);
        ctx.lineCap = 'round';
        if (s.accent === 'circle') {
            ctx.beginPath();
            ctx.ellipse(faceBox.x + faceBox.w / 2, faceBox.y + faceBox.h / 2, faceBox.w * 0.68, faceBox.h * 0.72, -0.08, 0.15, Math.PI * 2 - 0.05);
            ctx.stroke();
        } else {
            const from = { x: block.x + block.w / 2, y: block.y + (block.y > faceBox.y ? 0 : block.h) };
            const to = { x: faceBox.x + faceBox.w / 2, y: faceBox.y + (block.y > faceBox.y ? faceBox.h * 1.05 : -faceBox.h * 0.05) };
            const t = { x: from.x + (to.x - from.x) * 0.82, y: from.y + (to.y - from.y) * 0.82 };
            ctx.beginPath();
            ctx.moveTo(from.x, from.y);
            ctx.quadraticCurveTo((from.x + t.x) / 2 + (t.y - from.y) * 0.2, (from.y + t.y) / 2, t.x, t.y);
            ctx.stroke();
            const ang = Math.atan2(t.y - from.y, t.x - from.x);
            const head = H * 0.03;
            ctx.beginPath();
            ctx.moveTo(t.x, t.y);
            ctx.lineTo(t.x - head * Math.cos(ang - 0.5), t.y - head * Math.sin(ang - 0.5));
            ctx.moveTo(t.x, t.y);
            ctx.lineTo(t.x - head * Math.cos(ang + 0.5), t.y - head * Math.sin(ang + 0.5));
            ctx.stroke();
        }
    }

    // 6. Measured QA.
    const safe = safeBox(format);
    const inSafeZone = block.x >= safe.x - 1 && block.y >= safe.y - 1 && block.x + block.w <= safe.x + safe.w + 1 && block.y + block.h <= safe.y + safe.h + 1;
    const faceOverlapPct = faceBox ? (overlap(block, faceBox) / Math.max(1, faceBox.w * faceBox.h)) * 100 : 0;
    const textHeightPct = (fit.fontSize / H) * 100;
    const wordCount = s.headline.split(/\s+/).filter(Boolean).length;
    const problems: string[] = [];
    if (contrast < 4.5) problems.push(`text contrast ${contrast.toFixed(1)}:1 is below 4.5:1`);
    if (textHeightPct < (format === '9:16' ? 3.2 : 6)) problems.push(`text is small (${textHeightPct.toFixed(1)}% of the height); unreadable as a small preview`);
    if (faceOverlapPct > 12) problems.push(`text covers ${faceOverlapPct.toFixed(0)}% of the face`);
    if (!inSafeZone) problems.push('text leaves the platform safe zone (covered by app buttons / timestamp)');
    if (fit.truncated) problems.push('headline did not fit and was cut');
    return {
        png: canvas.toBuffer('image/png'),
        spec: { ...s, boxColor: boxColor ?? s.boxColor },
        qa: { contrast: Number(contrast.toFixed(2)), textHeightPct: Number(textHeightPct.toFixed(1)), faceOverlapPct: Number(faceOverlapPct.toFixed(1)), inSafeZone, wordCount, autoFixes, passed: problems.length === 0, problems },
    };
}

function averageRgb(px: Uint8ClampedArray): string {
    let r = 0, g = 0, b = 0, n = 0;
    const stride = Math.max(4, Math.floor(px.length / 4 / 3000) * 4);
    for (let i = 0; i + 3 < px.length; i += stride) {
        r += px[i]; g += px[i + 1]; b += px[i + 2]; n++;
    }
    const rgb: RGB = n ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)] : [0, 0, 0];
    return rgbToHex(rgb);
}

function roundRect(ctx: any, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

/** Readable text colour for a brand colour (exported for the agent's defaults). */
export function readableOn(bgHex: string): string {
    return contrastRatio('#FFFFFF', bgHex) >= contrastRatio('#111111', bgHex) ? '#FFFFFF' : '#111111';
}

export const _internals = { hexToRgb };
