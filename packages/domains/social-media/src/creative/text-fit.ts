/**
 * Deterministic text wrapping + auto-fit. The guarantee the compiler relies on: every returned line is at most
 * `maxWidth` wide and the block is at most `maxHeight` tall. When even `minSize` cannot hold the copy, the text is
 * truncated with an ellipsis and `truncated` is set (the job reports it as a warning) — it never overflows.
 */

export type Measure = (text: string, fontSize: number) => number;

export interface FitOptions {
    maxWidth: number;
    maxHeight: number;
    maxSize: number;
    minSize: number;
    lineHeight?: number; // multiple of font size
    maxLines?: number;
}

export interface FitResult {
    fontSize: number;
    lines: string[];
    lineHeightPx: number;
    height: number;
    width: number;
    truncated: boolean;
}

const ELLIPSIS = '…';

/** Splits a word that is wider than maxWidth into chunks that fit (with a trailing hyphen). */
function breakWord(word: string, size: number, maxWidth: number, measure: Measure): string[] {
    const parts: string[] = [];
    let cur = '';
    for (const ch of Array.from(word)) {
        const next = cur + ch;
        if (cur && measure(next + '-', size) > maxWidth) {
            parts.push(cur + '-');
            cur = ch;
        } else cur = next;
    }
    if (cur) parts.push(cur);
    return parts;
}

export function wrapText(text: string, size: number, maxWidth: number, measure: Measure): string[] {
    const lines: string[] = [];
    for (const paragraph of String(text || '').replace(/\r/g, '').split('\n')) {
        const words = paragraph.split(/\s+/).filter(Boolean);
        if (!words.length) {
            lines.push('');
            continue;
        }
        let cur = '';
        for (const w of words) {
            const pieces = measure(w, size) > maxWidth ? breakWord(w, size, maxWidth, measure) : [w];
            for (const piece of pieces) {
                const candidate = cur ? `${cur} ${piece}` : piece;
                if (measure(candidate, size) <= maxWidth) cur = candidate;
                else {
                    if (cur) lines.push(cur);
                    cur = piece;
                }
            }
        }
        if (cur) lines.push(cur);
    }
    // Drop leading/trailing blank lines but keep intentional paragraph breaks inside.
    while (lines.length && !lines[0]) lines.shift();
    while (lines.length && !lines[lines.length - 1]) lines.pop();
    return lines;
}

function ellipsize(line: string, size: number, maxWidth: number, measure: Measure): string {
    let s = line.trimEnd();
    while (s && measure(s + ELLIPSIS, size) > maxWidth) s = s.slice(0, -1).trimEnd();
    return s + ELLIPSIS;
}

export function fitText(text: string, opts: FitOptions, measure: Measure): FitResult {
    const lh = opts.lineHeight ?? 1.15;
    const minSize = Math.max(6, Math.floor(Math.min(opts.minSize, opts.maxSize)));
    const maxSize = Math.max(minSize, Math.floor(opts.maxSize));
    const fits = (size: number, lines: string[]) =>
        lines.length * size * lh <= opts.maxHeight + 0.01 && (!opts.maxLines || lines.length <= opts.maxLines);

    // Largest size that fits (binary search on integers; wrapping is monotonic enough in practice, verified below).
    let lo = minSize;
    let hi = maxSize;
    let best: { size: number; lines: string[] } | null = null;
    while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        const lines = wrapText(text, mid, opts.maxWidth, measure);
        if (fits(mid, lines)) {
            best = { size: mid, lines };
            lo = mid + 1;
        } else hi = mid - 1;
    }
    // Monotonicity guard: step up linearly in case wrapping allowed a slightly larger size.
    if (best) {
        for (let s = best.size + 1; s <= Math.min(maxSize, best.size + 4); s++) {
            const lines = wrapText(text, s, opts.maxWidth, measure);
            if (fits(s, lines)) best = { size: s, lines };
        }
        return finalize(best.size, best.lines, false);
    }

    // Does not fit even at minSize: truncate.
    const size = minSize;
    const all = wrapText(text, size, opts.maxWidth, measure);
    const capacity = Math.max(1, Math.min(opts.maxLines ?? Infinity, Math.floor((opts.maxHeight + 0.01) / (size * lh))));
    const kept = all.slice(0, capacity);
    kept[kept.length - 1] = ellipsize(kept[kept.length - 1] || '', size, opts.maxWidth, measure);
    return finalize(size, kept, true);

    function finalize(fontSize: number, lines: string[], truncated: boolean): FitResult {
        const width = lines.reduce((m, l) => Math.max(m, measure(l, fontSize)), 0);
        return { fontSize, lines, lineHeightPx: fontSize * lh, height: lines.length * fontSize * lh, width, truncated };
    }
}
