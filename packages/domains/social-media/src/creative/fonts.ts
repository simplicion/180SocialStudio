import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Font resolution for the carousel compiler.
 *
 * Order: 1) `CREATIVE_FONTS_DIR` (ops can drop brand TTF/OTF files there, named `<Family>-<weight>.ttf`),
 * 2) the fonts bundled with this package (`assets/fonts`, Inter under the SIL OFL), 3) a Google Fonts download cached in
 * the OS temp dir (only when `CREATIVE_FETCH_GOOGLE_FONTS` is not `false`), 4) Inter. A fallback is reported back as a
 * warning on the job, never silently.
 */

export type FontWeight = 400 | 600 | 800;
export const FONT_WEIGHTS: FontWeight[] = [400, 600, 800];

export interface ResolvedFont {
    /** Family name registered with the canvas (unique per resolved family). */
    family: string;
    requested: string;
    fallback: boolean;
    source: 'fonts-dir' | 'bundled' | 'google-fonts' | 'inter-fallback';
}

// Same depth from src/creative and dist/creative.
export const BUNDLED_FONTS_DIR = path.resolve(__dirname, '..', '..', 'assets', 'fonts');
/** Where `npm run fonts:fetch` puts WS1's curated brand fonts by default. */
export const PREFETCHED_FONTS_DIR = path.resolve(__dirname, '..', '..', 'assets', 'brand-fonts');
const CACHE_DIR = path.join(os.tmpdir(), '180ws-creative-fonts');

const registered = new Map<string, ResolvedFont>();
/** Families that could not be fetched recently (avoid a network round trip per render). */
const failedAt = new Map<string, number>();
const RETRY_MS = 60 * 60 * 1000;

function canvas(): any {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('@napi-rs/canvas');
}

const slug = (family: string) => family.replace(/[^a-z0-9]+/gi, '');

function filesIn(dir: string | undefined, family: string): Partial<Record<FontWeight, string>> {
    const out: Partial<Record<FontWeight, string>> = {};
    if (!dir || !fs.existsSync(dir)) return out;
    const want = slug(family).toLowerCase();
    for (const f of fs.readdirSync(dir)) {
        const m = /^(.+?)[-_ ](\d{3})\.(ttf|otf|woff2?)$/i.exec(f);
        if (!m || slug(m[1]).toLowerCase() !== want) continue;
        const w = Number(m[2]);
        // Map to the three weights the compiler uses: nearest available.
        for (const target of FONT_WEIGHTS) {
            const cur = out[target];
            const curW = cur ? Number(/(\d{3})\.\w+$/.exec(cur)![1]) : Infinity;
            if (Math.abs(w - target) < Math.abs(curW - target)) out[target] = path.join(dir, f);
        }
    }
    return out;
}

function register(files: Partial<Record<FontWeight, string>>, alias: string): boolean {
    const { GlobalFonts } = canvas();
    let ok = false;
    for (const w of FONT_WEIGHTS) {
        const p = files[w];
        if (p && GlobalFonts.registerFromPath(p, alias)) ok = true;
    }
    return ok;
}

/**
 * Downloads a Google Fonts family (400/600/800, or its only weight for single-weight display faces such as Anton)
 * as TrueType files into `dir`. Used at runtime (cached in the OS temp dir) and by `downloadBrandFonts()` at build time.
 */
export async function fetchGoogleFont(family: string, fetchImpl: typeof fetch = fetch, dir = path.join(CACHE_DIR, slug(family))): Promise<Partial<Record<FontWeight, string>>> {
    const cached = filesIn(dir, family);
    if (Object.keys(cached).length) return cached;
    const fam = encodeURIComponent(family).replace(/%20/g, '+');
    // Without a modern browser UA, the CSS API serves TrueType URLs, which Skia loads directly.
    const headers = { 'User-Agent': 'Mozilla/4.0' };
    let css = await fetchImpl(`https://fonts.googleapis.com/css2?family=${fam}:wght@400;600;800&display=swap`, { headers });
    if (!css.ok) css = await fetchImpl(`https://fonts.googleapis.com/css2?family=${fam}&display=swap`, { headers });
    if (!css.ok) return {};
    const text = await css.text();
    const out: Partial<Record<FontWeight, string>> = {};
    const blocks = text.split('@font-face').slice(1);
    fs.mkdirSync(dir, { recursive: true });
    for (const b of blocks) {
        const w = Number(/font-weight:\s*(\d{3})/.exec(b)?.[1] || 400);
        const src = /url\((https:[^)]+)\)/.exec(b)?.[1];
        if (!src || !FONT_WEIGHTS.includes(w as FontWeight) || out[w as FontWeight]) continue;
        const res = await fetchImpl(src);
        if (!res.ok) continue;
        const ext = /\.(ttf|otf|woff2?)(\?|$)/.exec(src)?.[1] || 'ttf';
        const file = path.join(dir, `${slug(family)}-${w}.${ext}`);
        fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
        out[w as FontWeight] = file;
    }
    return out;
}

export async function resolveFont(requested: string, opts: { fetchImpl?: typeof fetch; allowNetwork?: boolean } = {}): Promise<ResolvedFont> {
    const family = (requested || 'Inter').trim() || 'Inter';
    const key = family.toLowerCase();
    const hit = registered.get(key);
    if (hit) return hit;

    const alias = `Brand_${slug(family) || 'Inter'}`;
    let result: ResolvedFont | null = null;

    if (register(filesIn(process.env.CREATIVE_FONTS_DIR, family), alias) || register(filesIn(PREFETCHED_FONTS_DIR, family), alias)) {
        result = { family: alias, requested: family, fallback: false, source: 'fonts-dir' };
    } else if (register(filesIn(BUNDLED_FONTS_DIR, family), alias)) {
        result = { family: alias, requested: family, fallback: false, source: 'bundled' };
    } else {
        const allowNetwork = opts.allowNetwork ?? process.env.CREATIVE_FETCH_GOOGLE_FONTS !== 'false';
        if (allowNetwork && Date.now() - (failedAt.get(key) || 0) > RETRY_MS) {
            try {
                const files = await fetchGoogleFont(family, opts.fetchImpl || fetch);
                if (register(files, alias)) result = { family: alias, requested: family, fallback: false, source: 'google-fonts' };
                else failedAt.set(key, Date.now());
            } catch {
                failedAt.set(key, Date.now());
                /* network failure: fall back to Inter below and report it */
            }
        }
    }

    if (!result) {
        const inter = registered.get('inter') || (register(filesIn(BUNDLED_FONTS_DIR, 'Inter'), 'Brand_Inter') ? { family: 'Brand_Inter', requested: 'Inter', fallback: false, source: 'bundled' as const } : null);
        if (!inter) throw new Error(`Bundled Inter fonts are missing from ${BUNDLED_FONTS_DIR}; the carousel compiler cannot render text.`);
        registered.set('inter', inter);
        result = { family: inter.family, requested: family, fallback: key !== 'inter', source: key === 'inter' ? 'bundled' : 'inter-fallback' };
    }
    // A fallback is not cached so a later render can pick the brand font up once it becomes available.
    if (!result.fallback) registered.set(key, result);
    return result;
}

/** Build/deploy helper: pre-downloads fonts (e.g. WS1's BRAND_FONTS) into `dir` (point CREATIVE_FONTS_DIR at it). */
export async function downloadBrandFonts(families: readonly string[], dir: string, fetchImpl: typeof fetch = fetch): Promise<{ family: string; ok: boolean }[]> {
    fs.mkdirSync(dir, { recursive: true });
    const out: { family: string; ok: boolean }[] = [];
    for (const family of families) {
        const files = await fetchGoogleFont(family, fetchImpl, dir).catch(() => ({}));
        out.push({ family, ok: Object.keys(files).length > 0 });
    }
    return out;
}
