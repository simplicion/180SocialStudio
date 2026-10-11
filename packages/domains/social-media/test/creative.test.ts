/**
 * Run: npx tsx --test --test-force-exit packages/domains/social-media/test/creative.test.ts
 *
 * WS3 creative engine: compiler (sizes, brand colours, text fit, contrast), design agent (zod + one repair), image
 * providers (fake fetch), image source planning (missing keys), and the job flow against an in-memory database with
 * tenant isolation. No network, no real keys.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    AA_NORMAL,
    BflFluxProvider,
    CreativeError,
    CreativeService,
    GeminiImageProvider,
    OpenAIImageProvider,
    buildPhotoPrompt,
    compileCarousel,
    contrastRatio,
    designCarousel,
    ensureContrast,
    fitText,
    planImageSource,
    renderStaticPost,
    resolveImageProviders,
    type CreativeBrand,
    type ImageProvider,
    type Slide,
} from '../src/creative';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const FONT = { allowNetwork: false };

const brand = (o: Partial<CreativeBrand> = {}): CreativeBrand => ({
    name: 'Northwind Coffee',
    handle: 'northwindcoffee',
    colors: { primary: '#1F3A5F', accent: '#F2A541', background: '#0F1115', text: '#F5F1E8' },
    font: 'Inter',
    promptContext: 'Brand: Northwind Coffee\nTone: warm, expert',
    forbiddenWords: ['cheap'],
    standardCtas: ['Follow for daily brew tips'],
    ...o,
});

const S = (layout: Slide['layout'], title: string, body = '', imagePrompt: string | null = null, emphasis: string | null = null): Slide => ({ layout, title, body, imagePrompt, emphasis });

const SIX: Slide[] = [
    S('cover', 'Your morning coffee is lying to you', '5 things roasters wish you knew', 'barista pouring milk into a flat white in a sunlit cafe', 'lying'),
    S('point', 'Fresh beans beat expensive beans', 'Coffee peaks 7 to 21 days after roasting.', null, 'Fresh'),
    S('stat', '73%', 'of aroma compounds fade within four weeks.'),
    S('quote', 'Great coffee is mostly water chemistry.', 'Head roaster'),
    S('list', 'Brew better tomorrow', 'Buy whole beans\nGrind right before brewing\nUse filtered water'),
    S('cta', 'Taste the difference', 'Save this and try one change tomorrow.'),
];

function pngSize(buf: Buffer) {
    assert.equal(buf.toString('latin1', 1, 4), 'PNG');
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

async function pixels(png: Buffer) {
    const img = await loadImage(png);
    const c = createCanvas(img.width, img.height);
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, img.width, img.height).data as Uint8ClampedArray;
    return {
        at: (x: number, y: number) => {
            const i = (y * img.width + x) * 4;
            return `#${[data[i], data[i + 1], data[i + 2]].map((n) => n.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
        },
        count: (hex: string, tol = 6) => {
            const t = hex.replace('#', '');
            const r = parseInt(t.slice(0, 2), 16), g = parseInt(t.slice(2, 4), 16), b = parseInt(t.slice(4, 6), 16);
            let n = 0;
            for (let i = 0; i < data.length; i += 4) if (Math.abs(data[i] - r) <= tol && Math.abs(data[i + 1] - g) <= tol && Math.abs(data[i + 2] - b) <= tol) n++;
            return n;
        },
    };
}

function solidPhoto(color: string, w = 1200, h = 1500): Buffer {
    const c = createCanvas(w, h);
    const ctx = c.getContext('2d');
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
    return c.toBuffer('image/jpeg');
}

/* ------------------------------------------------------------------ colour + fit */

test('contrast maths matches WCAG and ensureContrast fixes failing pairs', () => {
    assert.equal(Math.round(contrastRatio('#000000', '#FFFFFF')), 21);
    const kept = ensureContrast('#FFFFFF', '#0F1115');
    assert.equal(kept.adjusted, false);
    const fixed = ensureContrast('#333333', '#222222');
    assert.equal(fixed.adjusted, true);
    assert.ok(fixed.ratio >= AA_NORMAL, `ratio ${fixed.ratio}`);
});

test('fitText never overflows its box, shrinks first, then truncates with an ellipsis', () => {
    const c = createCanvas(10, 10).getContext('2d');
    const { GlobalFonts } = require('@napi-rs/canvas');
    GlobalFonts.registerFromPath(require('path').resolve(__dirname, '../assets/fonts/Inter-800.ttf'), 'FitTest');
    const measure = (t: string, s: number) => ((c.font = `800 ${s}px FitTest`), c.measureText(t).width);
    const opts = { maxWidth: 600, maxHeight: 300, maxSize: 100, minSize: 24, lineHeight: 1.1 };

    const short = fitText('Short title', opts, measure);
    assert.equal(short.fontSize, 100);
    assert.equal(short.truncated, false);

    const medium = fitText('A considerably longer headline that must wrap across several lines to fit', opts, measure);
    assert.ok(medium.fontSize < 100 && medium.fontSize >= 24);
    assert.equal(medium.truncated, false);

    const huge = fitText('word '.repeat(400) + 'Supercalifragilisticexpialidociousantidisestablishmentarianism', opts, measure);
    assert.equal(huge.truncated, true);
    assert.ok(huge.lines[huge.lines.length - 1].endsWith('…'));

    for (const r of [short, medium, huge]) {
        assert.ok(r.height <= opts.maxHeight + 0.01, `height ${r.height}`);
        for (const l of r.lines) assert.ok(measure(l, r.fontSize) <= opts.maxWidth + 0.01, `line "${l}" too wide`);
    }
});

/* ------------------------------------------------------------------ compiler */

test('compiler renders 1080x1350 and 1080x1080 PNGs in brand colours', async () => {
    for (const [format, h] of [['portrait', 1350], ['square', 1080]] as const) {
        const r = await compileCarousel({ slides: SIX, brand: brand(), format, font: FONT });
        assert.equal(r.slides.length, 6);
        for (const s of r.slides) assert.deepEqual(pngSize(s.png), { width: 1080, height: h });

        const point = await pixels(r.slides[1].png);
        assert.equal(point.at(5, 5), '#0F1115', 'point slide background is the brand background');
        assert.ok(point.count('#F2A541') > 500, 'brand accent (number, emphasis, progress bar) is present');
        assert.ok(point.count('#F5F1E8') > 500, 'brand text colour is used');

        const quote = await pixels(r.slides[3].png);
        assert.equal(quote.at(5, 5), '#1F3A5F', 'quote slide uses the brand primary');
        assert.ok(r.slides.every((s) => s.contrastOk && !s.truncated));
    }
});

test('text never overflows: every text box stays inside its limits, even with absurd copy', async () => {
    const long = 'This is an extremely long carousel title that keeps going and going far beyond what any sane layout could hold '.repeat(4);
    const slides = [S('cover', long.slice(0, 160), long), S('point', long.slice(0, 160), long + long), S('list', 'List', Array.from({ length: 6 }, () => long).join('\n')), S('stat', '1234567890123456789', long), S('quote', long.slice(0, 160), long), S('cta', long.slice(0, 160), long)];
    const r = await compileCarousel({ slides, brand: brand(), format: 'square', font: FONT });
    for (const s of r.slides) {
        for (const b of s.textBoxes) {
            assert.ok(b.width <= b.maxWidth + 0.5, `slide ${s.index} ${b.role} width ${b.width} > ${b.maxWidth}`);
            assert.ok(b.height <= b.maxHeight + 0.5, `slide ${s.index} ${b.role} height ${b.height} > ${b.maxHeight}`);
            assert.ok(b.y + b.height <= s.height && b.y >= 0, `slide ${s.index} ${b.role} outside canvas`);
        }
    }
    assert.ok(r.slides.some((s) => s.truncated), 'truncation is reported');
    assert.ok(r.warnings.some((w) => /shortened/.test(w)));
});

test('contrast fix: unreadable brand colours are adjusted, photo overlays are made opaque enough', async () => {
    const bad = brand({ colors: { primary: '#222222', accent: '#262626', background: '#1A1A1A', text: '#2A2A2A' } });
    const r = await compileCarousel({ slides: SIX, brand: bad, format: 'portrait', font: FONT });
    for (const s of r.slides) {
        assert.equal(s.colorAdjusted, true);
        assert.equal(s.contrastOk, true, `slide ${s.index}`);
        assert.ok(s.minContrast >= AA_NORMAL);
    }

    // White text over a white photo: the overlay must kick in.
    const light = brand({ colors: { primary: '#FFFFFF', accent: '#FFD166', background: '#FFFFFF', text: '#FFFFFF' } });
    const white = solidPhoto('#FFFFFF');
    const p = await compileCarousel({ slides: [S('cover', 'Bright', 'photo', 'x')], brand: light, format: 'portrait', images: [white], font: FONT, mode: 'static' });
    const s = p.slides[0];
    assert.ok(s.contrastOk, 'passes AA');
    assert.ok(s.minContrast >= AA_NORMAL);

    // Dark text brand on a dark photo: overlay needed too.
    const darkBrand = brand({ colors: { primary: '#0A0A0A', accent: '#FF5A5F', background: '#FFFFFF', text: '#111111' } });
    const d = await compileCarousel({ slides: [S('cover', 'Dark photo', 'body', 'x')], brand: darkBrand, format: 'portrait', images: [solidPhoto('#050505')], font: FONT, mode: 'static' });
    assert.ok(d.slides[0].overlayAlpha >= 0.4, `overlay ${d.slides[0].overlayAlpha}`);
    assert.ok(d.slides[0].contrastOk);
});

test('static post renders one image without slide numbers; missing brand font falls back to Inter with a warning', async () => {
    const r = await renderStaticPost({ slides: [S('cover', 'One strong idea', 'Single image post')], brand: brand({ font: 'Definitely Not A Font' }), format: 'square', font: FONT });
    assert.equal(r.slides.length, 1);
    assert.deepEqual(pngSize(r.slides[0].png), { width: 1080, height: 1080 });
    assert.ok(!r.slides[0].textBoxes.some((b) => b.role === 'number'));
    assert.equal(r.font.fallback, true);
    assert.ok(r.warnings.some((w) => /Inter/.test(w)));
});

test('rendering is deterministic', async () => {
    const a = await compileCarousel({ slides: SIX.slice(0, 2), brand: brand(), format: 'square', font: FONT });
    const b = await compileCarousel({ slides: SIX.slice(0, 2), brand: brand(), format: 'square', font: FONT });
    assert.ok(a.slides[0].png.equals(b.slides[0].png));
});

/* ------------------------------------------------------------------ design agent */

const slidesJson = (n = 6) => JSON.stringify({ slides: [...SIX, ...SIX].slice(0, n).map((s, i) => ({ ...s, layout: i === 0 ? 'cover' : i === n - 1 ? 'cta' : s.layout === 'cover' || s.layout === 'cta' ? 'point' : s.layout })) });

test('design agent validates with zod and repairs once', async () => {
    const calls: string[] = [];
    const llm = { generate: async (p: string) => (calls.push(p), calls.length === 1 ? '{"slides":[{"layout":"banner"}]}' : '```json\n' + slidesJson(6) + '\n```') };
    const slides = await designCarousel(llm, { brandContext: 'Brand: X', headline: 'Coffee myths', useImages: true });
    assert.equal(slides.length, 6);
    assert.equal(calls.length, 2);
    assert.match(calls[1], /Validation errors/);
    assert.match(calls[0], /Brand: X/);

    const noImages = await designCarousel({ generate: async () => slidesJson(5) }, { brandContext: '', headline: 'x', useImages: false });
    assert.ok(noImages.every((s) => s.imagePrompt === null));

    await assert.rejects(designCarousel({ generate: async () => 'not json' }, { brandContext: '', headline: 'x', useImages: true }), (e: any) => e instanceof CreativeError && e.code === 'AI_BAD_RESPONSE');
    await assert.rejects(designCarousel({ generate: async () => slidesJson(3) }, { brandContext: '', headline: 'x', useImages: true }), (e: any) => e.code === 'AI_BAD_RESPONSE');
    await assert.rejects(designCarousel({ generate: async () => { throw new Error('429'); } }, { brandContext: '', headline: 'x', useImages: true }), (e: any) => e.code === 'AI_PROVIDER_ERROR');
});

/* ------------------------------------------------------------------ providers */

test('photo prompt enforces photographic realism and no text', () => {
    const p = buildPhotoPrompt({ subject: 'a barista pouring latte art', brand: brand(), aspect: 'portrait', textArea: 'bottom' });
    assert.match(p.prompt, /35mm/);
    assert.match(p.prompt, /No text/);
    assert.match(p.prompt, /lower third/);
    assert.match(p.negativePrompt, /plastic skin/);
    assert.match(p.negativePrompt, /over-saturated/);
    assert.equal(p.stockQuery, 'barista pouring latte art');
});

test('provider chain comes only from configured keys (company key first, then env); nothing hardcoded', () => {
    assert.deepEqual(resolveImageProviders({ env: {} }), { generative: [], stock: [] });
    const env = { BFL_API_KEY: 'env-bfl', OPENAI_API_KEY: 'env-oa', PEXELS_API_KEY: 'px' } as any;
    const chain = resolveImageProviders({ env });
    assert.deepEqual(chain.generative.map((p) => p.id), ['bfl', 'openai']);
    assert.deepEqual(chain.stock.map((p) => p.id), ['pexels']);
    const tenant = resolveImageProviders({ env: {}, companyMetadata: { geminiKey: 'tenant-gemini' } });
    assert.deepEqual(tenant.generative.map((p) => p.id), ['gemini']);
    const ordered = resolveImageProviders({ env: { ...env, CREATIVE_IMAGE_PROVIDERS: 'openai,bfl' } });
    assert.deepEqual(ordered.generative.map((p) => p.id), ['openai', 'bfl']);
});

const jpeg = solidPhoto('#AA8866', 64, 80);
function fakeFetch(routes: [RegExp, (url: string, init: any) => any][]) {
    const seen: { url: string; init: any }[] = [];
    const f = async (url: any, init: any = {}) => {
        seen.push({ url: String(url), init });
        const route = routes.find(([re]) => re.test(String(url)));
        if (!route) return new Response('not found', { status: 404 });
        const out = route[1](String(url), init);
        if (out instanceof Response) return out;
        if (Buffer.isBuffer(out)) return new Response(out, { status: 200, headers: { 'content-type': 'image/jpeg' } });
        return new Response(JSON.stringify(out), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    return { f: f as any as typeof fetch, seen };
}

test('BFL FLUX adapter submits, polls and downloads', async () => {
    let polls = 0;
    const { f, seen } = fakeFetch([
        [/\/v1\/flux-2-pro$/, () => ({ id: 't1', polling_url: 'https://api.bfl.ai/v1/get_result?id=t1' })],
        [/get_result/, () => (++polls < 2 ? { status: 'Pending' } : { status: 'Ready', result: { sample: 'https://delivery.bfl.ai/x.jpg' } })],
        [/delivery/, () => jpeg],
    ]);
    const p = new BflFluxProvider('k-bfl', 'flux-2-pro', f, 1);
    const r = await p.generate({ prompt: buildPhotoPrompt({ subject: 'a cafe', aspect: 'portrait' }), width: 1088, height: 1360, aspect: 'portrait' });
    assert.equal(r.provider, 'bfl');
    assert.ok(r.buffer.equals(jpeg));
    const body = JSON.parse(seen[0].init.body);
    assert.equal(body.width % 16, 0);
    assert.equal(seen[0].init.headers['x-key'], 'k-bfl');

    const { f: mod } = fakeFetch([[/flux-2-pro$/, () => ({ id: 't2', polling_url: 'https://api.bfl.ai/p' })], [/\/p$/, () => ({ status: 'Content Moderated' })]]);
    await assert.rejects(new BflFluxProvider('k', 'flux-2-pro', mod, 1).generate({ prompt: buildPhotoPrompt({ subject: 'x', aspect: 'square' }), width: 1024, height: 1024, aspect: 'square' }), (e: any) => e.code === 'IMAGE_PROVIDER_ERROR');
});

test('Gemini and OpenAI adapters parse base64 images and surface upstream errors', async () => {
    const b64 = jpeg.toString('base64');
    const g = fakeFetch([[/generateContent/, () => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/jpeg', data: b64 } }] } }] })]]);
    const gr = await new GeminiImageProvider('k-g', 'gemini-3-pro-image', g.f).generate({ prompt: buildPhotoPrompt({ subject: 'x', aspect: 'portrait' }), width: 1080, height: 1350, aspect: 'portrait' });
    assert.ok(gr.buffer.equals(jpeg));
    assert.equal(JSON.parse(g.seen[0].init.body).generationConfig.imageConfig.aspectRatio, '4:5');

    const o = fakeFetch([[/images\/generations/, () => ({ data: [{ b64_json: b64 }] })]]);
    const or = await new OpenAIImageProvider('k-o', 'gpt-image-2', o.f).generate({ prompt: buildPhotoPrompt({ subject: 'x', aspect: 'square' }), width: 1080, height: 1080, aspect: 'square' });
    assert.ok(or.buffer.equals(jpeg));
    assert.equal(o.seen[0].init.headers.Authorization, 'Bearer k-o');

    const bad = fakeFetch([[/images\/generations/, () => new Response(JSON.stringify({ error: { message: 'billing hard limit' } }), { status: 400 })]]);
    await assert.rejects(new OpenAIImageProvider('k', 'gpt-image-2', bad.f).generate({ prompt: buildPhotoPrompt({ subject: 'x', aspect: 'square' }), width: 1, height: 1, aspect: 'square' }), (e: any) => e.code === 'IMAGE_PROVIDER_ERROR' && /billing/.test(e.message));
});

test('image source planning: missing image model is a typed 503 unless stock fallback is allowed', () => {
    const stock: ImageProvider = { id: 'pexels', kind: 'stock', model: 'm', generate: async () => { throw new Error('unused'); } };
    assert.throws(() => planImageSource({ generative: [], stock: [] }, { useImageModel: true, allowStockFallback: false }), (e: any) => e.status === 503 && e.code === 'IMAGE_MODEL_NOT_CONFIGURED');
    assert.throws(() => planImageSource({ generative: [], stock: [stock] }, { useImageModel: true, allowStockFallback: false }), (e: any) => e.code === 'IMAGE_MODEL_NOT_CONFIGURED');
    assert.equal(planImageSource({ generative: [], stock: [stock] }, { useImageModel: true, allowStockFallback: true }).mode, 'stock');
    assert.equal(planImageSource({ generative: [], stock: [] }, { useImageModel: false, allowStockFallback: false }).mode, 'none');
});

/* ------------------------------------------------------------------ job flow */

function matches(row: any, where: any): boolean {
    return Object.entries(where || {}).every(([k, cond]: [string, any]) => {
        if (k === 'metadata' && cond?.path) {
            let v = row.metadata;
            for (const p of cond.path) v = v?.[p];
            return v === cond.equals;
        }
        const v = row[k];
        if (cond && typeof cond === 'object' && !Array.isArray(cond)) return v && typeof v === 'object' ? matches(v, cond) : false;
        return (v ?? null) === cond;
    });
}

function fakeDb() {
    const calendars = [
        { id: 'cal-1', companyId: 'co-1', projectId: 'p1' },
        { id: 'cal-2', companyId: 'co-2', projectId: 'p2' },
    ];
    const pieces: any[] = [
        { id: 'piece-1', calendarId: 'cal-1', headline: 'Coffee myths', adCopyFull: 'Caption', platform: 'instagram', videoScriptOrHooks: JSON.stringify({ carouselSlides: [{ title: 'Hook' }] }), visualAssetsBrief: 'warm cafe', thumbnailUrl: null },
        { id: 'piece-2', calendarId: 'cal-1', headline: 'No post yet', adCopyFull: 'Caption 2', platform: 'instagram', videoScriptOrHooks: '', visualAssetsBrief: '' },
        { id: 'piece-other', calendarId: 'cal-2', headline: 'Other tenant', adCopyFull: '', videoScriptOrHooks: '' },
    ];
    const withCal = (p: any) => ({ ...p, calendar: calendars.find((c) => c.id === p.calendarId) });
    const posts: any[] = [
        { id: 'post-1', companyId: 'co-1', projectId: 'p1', calendarPieceId: 'piece-1', status: 'draft', mediaUrls: [], mediaType: 'video', metadata: { keep: true }, content: 'Caption' },
        { id: 'post-live', companyId: 'co-1', projectId: 'p1', calendarPieceId: null, status: 'published', mediaUrls: [], metadata: {} },
        { id: 'post-other', companyId: 'co-2', projectId: 'p2', calendarPieceId: null, status: 'draft', mediaUrls: [], metadata: {} },
    ];
    const projects = [
        { id: 'p1', companyId: 'co-1', projectType: 'social_media', deletedAt: null, name: 'Northwind' },
        { id: 'p2', companyId: 'co-2', projectType: 'social_media', deletedAt: null, name: 'Other' },
    ];
    const clean = (r: any) => { const { calendar, ...rest } = r; return rest; };
    return {
        posts,
        pieces,
        db: {
            project: { findFirst: async (a: any) => projects.find((r) => matches(r, a.where)) ?? null },
            calendarContentPiece: {
                findFirst: async (a: any) => { const r = pieces.map(withCal).find((p) => matches(p, a.where)); return r ? clean(r) : null; },
                updateMany: async (a: any) => {
                    const hits = pieces.filter((p) => matches(withCal(p), a.where));
                    hits.forEach((h) => Object.assign(h, a.data));
                    return { count: hits.length };
                },
            },
            socialPost: {
                findFirst: async (a: any) => posts.find((p) => matches(p, a.where)) ?? null,
                updateMany: async (a: any) => {
                    const hits = posts.filter((p) => matches(p, a.where));
                    hits.forEach((h) => Object.assign(h, a.data));
                    return { count: hits.length };
                },
                create: async (a: any) => { const row = { id: `post-new-${posts.length}`, ...a.data }; posts.push(row); return row; },
            },
        },
    };
}

function fakeImageProvider(kind: 'generative' | 'stock' = 'generative', fail = false): ImageProvider & { calls: number } {
    const p: any = {
        id: kind === 'generative' ? 'fake-gen' : 'fake-stock',
        kind,
        model: 'fake-1',
        calls: 0,
        generate: async () => {
            p.calls++;
            if (fail) throw new CreativeError(502, 'IMAGE_PROVIDER_ERROR', 'fake: quota');
            return { buffer: solidPhoto('#7A5C3E', 400, 500), mimeType: 'image/jpeg', provider: p.id, model: 'fake-1', kind, sourceId: `s${p.calls}` };
        },
    };
    return p;
}

function makeService(o: { llm?: any; gen?: ImageProvider[]; stock?: ImageProvider[] } = {}) {
    const { db, posts, pieces } = fakeDb();
    const stored = new Map<string, Buffer>();
    const llmCalls: string[] = [];
    const llm = o.llm === null ? null : o.llm || { generate: async (p: string) => (llmCalls.push(p), slidesJson(6)) };
    const svc = new CreativeService({
        db,
        store: { put: async (key, body) => (stored.set(key, body), `https://cdn.test/${key}`) },
        loadBrand: async () => brand(),
        getLlm: async () => llm,
        getImageProviders: async () => ({ generative: o.gen ?? [fakeImageProvider()], stock: o.stock ?? [] }),
        font: FONT,
    });
    return { svc, posts, pieces, stored, llmCalls };
}

const CTX = { companyId: 'co-1', projectId: 'p1', userId: 'u1' };

test('job flow: piece -> design -> photos -> render -> upload -> attached to post and piece', async () => {
    const { svc, posts, pieces, stored, llmCalls } = makeService();
    const job = await svc.startCarousel(CTX, { pieceId: 'piece-1', format: 'portrait', useImageModel: true });
    assert.equal(job.status, 'queued');
    assert.equal(job.postId, 'post-1');
    await svc.idle();

    const done = await svc.getJob(CTX, job.id);
    assert.equal(done.status, 'completed', JSON.stringify(done.error));
    assert.equal(done.result!.slides.length, 6);
    assert.match(llmCalls[0], /Coffee myths/);
    assert.match(llmCalls[0], /Hook/, 'existing carouselSlides from the calendar are passed to the agent');
    for (const s of done.result!.slides) {
        const png = stored.get(s.url.replace('https://cdn.test/', ''))!;
        assert.deepEqual(pngSize(png), { width: 1080, height: 1350 });
    }
    assert.ok(done.result!.slides[0].imageSource?.provider === 'fake-gen');
    assert.ok([...stored.keys()].every((k) => k.startsWith(`social-media/creative/co-1/p1/${job.id}/`)));

    const post = posts.find((p) => p.id === 'post-1');
    assert.deepEqual(post.mediaUrls, done.result!.mediaUrls);
    assert.equal(post.mediaType, 'carousel');
    assert.equal(post.metadata.keep, true, 'existing metadata kept');
    assert.equal(post.metadata.creative.jobId, job.id);
    const piece = pieces.find((p) => p.id === 'piece-1');
    assert.equal(JSON.parse(piece.videoScriptOrHooks).renderedCarousel.urls.length, 6);
    assert.equal(JSON.parse(piece.videoScriptOrHooks).carouselSlides[0].title, 'Hook', 'calendar data untouched');
    assert.equal(piece.thumbnailUrl, done.result!.coverUrl);
});

test('job flow: a piece without a post gets a draft carousel post; static posts use mediaType image', async () => {
    const { svc, posts } = makeService({ gen: [] });
    const job = await svc.startCarousel(CTX, { pieceId: 'piece-2', useImageModel: false });
    await svc.idle();
    const done = await svc.getJob(CTX, job.id);
    assert.equal(done.status, 'completed', JSON.stringify(done.error));
    assert.ok(done.warnings.some((w) => /without photos/.test(w)), 'no stock configured is reported, not faked');
    const created = posts.find((p) => p.calendarPieceId === 'piece-2');
    assert.equal(created.status, 'draft');
    assert.equal(created.mediaType, 'carousel');
    assert.equal(created.companyId, 'co-1');

    const st = await svc.startStaticPost(CTX, { postId: 'post-1', slides: [S('cover', 'One idea', 'Body')], useImageModel: false, format: 'square' });
    await svc.idle();
    const sd = await svc.getJob(CTX, st.id);
    assert.equal(sd.status, 'completed');
    assert.equal(sd.result!.slides.length, 1);
    assert.equal(posts.find((p) => p.id === 'post-1').mediaType, 'image');
});

test('tenant isolation: other companies cannot start, read or regenerate', async () => {
    const { svc } = makeService();
    const job = await svc.startCarousel(CTX, { pieceId: 'piece-1' });
    await svc.idle();
    await assert.rejects(svc.getJob({ companyId: 'co-2', projectId: 'p2' }, job.id), (e: any) => e.status === 404 && e.code === 'JOB_NOT_FOUND');
    await assert.rejects(svc.getJob({ companyId: 'co-2', projectId: 'p1' }, job.id), (e: any) => e.code === 'PROJECT_NOT_FOUND');
    await assert.rejects(svc.regenerateSlide({ companyId: 'co-2', projectId: 'p2' }, job.id, 0, { regenerateImage: true }), (e: any) => e.code === 'JOB_NOT_FOUND');
    await assert.rejects(svc.startCarousel(CTX, { pieceId: 'piece-other' }), (e: any) => e.code === 'PIECE_NOT_FOUND');
    await assert.rejects(svc.startCarousel(CTX, { postId: 'post-other' }), (e: any) => e.code === 'POST_NOT_FOUND');
    await assert.rejects(svc.startCarousel({ companyId: 'co-2', projectId: 'p1' }, { brief: 'hello there' }), (e: any) => e.code === 'PROJECT_NOT_FOUND');
});

test('missing keys and bad input give typed errors, never fake output', async () => {
    const noGen = makeService({ gen: [] });
    await assert.rejects(noGen.svc.startCarousel(CTX, { brief: 'coffee tips', useImageModel: true }), (e: any) => e.status === 503 && e.code === 'IMAGE_MODEL_NOT_CONFIGURED');
    const stockOk = makeService({ gen: [], stock: [fakeImageProvider('stock')] });
    const j = await stockOk.svc.startCarousel(CTX, { brief: 'coffee tips', useImageModel: true, allowStockFallback: true });
    await stockOk.svc.idle();
    const jd = await stockOk.svc.getJob(CTX, j.id);
    assert.equal(jd.status, 'completed');
    assert.equal(jd.imageMode, 'stock');

    const noLlm = makeService({ llm: null });
    await assert.rejects(noLlm.svc.startCarousel(CTX, { brief: 'coffee tips' }), (e: any) => e.status === 503 && e.code === 'AI_NOT_CONFIGURED');

    const { svc } = makeService();
    await assert.rejects(svc.startCarousel(CTX, {}), (e: any) => e.status === 400 && e.code === 'INVALID_INPUT');
    await assert.rejects(svc.startCarousel(CTX, { brief: 'x y z', format: 'landscape' }), (e: any) => e.code === 'INVALID_INPUT');
    await assert.rejects(svc.startCarousel(CTX, { postId: 'post-live', brief: 'x y z' }), (e: any) => e.status === 409);

    // Every image provider failing in image-model mode fails the job with a clear code.
    const failing = makeService({ gen: [fakeImageProvider('generative', true)] });
    const fj = await failing.svc.startCarousel(CTX, { brief: 'coffee tips' });
    await failing.svc.idle();
    const fd = await failing.svc.getJob(CTX, fj.id);
    assert.equal(fd.status, 'failed');
    assert.equal(fd.error!.code, 'IMAGE_PROVIDER_ERROR');
});

test('regenerate one slide: rewrites copy via the agent, re-renders only that slide and updates the post', async () => {
    let n = 0;
    const llm = {
        generate: async (p: string) => {
            n++;
            if (/Rewrite ONE slide/.test(p)) return JSON.stringify({ layout: 'point', title: 'Freshness wins every time', body: 'New body', imagePrompt: null, emphasis: 'Freshness' });
            return slidesJson(6);
        },
    };
    const { svc, posts } = makeService({ llm });
    const job = await svc.startCarousel(CTX, { postId: 'post-1' });
    await svc.idle();
    const before = (await svc.getJob(CTX, job.id)).result!.mediaUrls;

    const busy = await svc.regenerateSlide(CTX, job.id, 1, { instruction: 'Make it punchier' });
    assert.equal(busy.status, 'designing');
    await assert.rejects(svc.regenerateSlide(CTX, job.id, 1, { instruction: 'again' }), (e: any) => e.code === 'JOB_BUSY');
    await svc.idle();
    const after = await svc.getJob(CTX, job.id);
    assert.equal(after.status, 'completed', JSON.stringify(after.error));
    assert.equal(after.slides![1].title, 'Freshness wins every time');
    assert.match(after.result!.mediaUrls[1], /slide-02-v2\.png$/);
    assert.equal(after.result!.mediaUrls[0], before[0]);
    assert.deepEqual(posts.find((p) => p.id === 'post-1').mediaUrls, after.result!.mediaUrls);
    assert.ok(n >= 2);
    await assert.rejects(svc.regenerateSlide(CTX, job.id, 99, { regenerateImage: true }), (e: any) => e.code === 'INVALID_INPUT');
});

test('a finished job can be re-opened from the post after a restart', async () => {
    const a = makeService();
    const job = await a.svc.startCarousel(CTX, { postId: 'post-1' });
    await a.svc.idle();
    // New service instance (empty job store) over the same data.
    const b = new CreativeService({
        db: {
            project: { findFirst: async () => ({ id: 'p1', name: 'Northwind' }) },
            calendarContentPiece: { findFirst: async () => null, updateMany: async () => ({ count: 0 }) },
            socialPost: { findFirst: async (q: any) => a.posts.find((p) => matches(p, q.where)) ?? null, updateMany: async () => ({ count: 1 }), create: async () => ({}) },
        },
        store: { put: async (k) => k },
        loadBrand: async () => brand(),
        getLlm: async () => null,
        getImageProviders: async () => ({ generative: [], stock: [] }),
    });
    const restored = await b.getJob(CTX, job.id);
    assert.equal(restored.status, 'completed');
    assert.equal(restored.result!.slides.length, 6);
});

test('brand mapping uses WS1 brand consciousness (canonical fields, prompt context, neutral defaults reported)', async () => {
    const { readBrandConsciousness, toCreativeBrand } = await import('../src');
    const empty = readBrandConsciousness({ id: 'p1', name: 'Acme' }, null);
    const b = toCreativeBrand(empty as any, { handle: 'acme' });
    assert.equal(b.name, 'Acme');
    assert.equal(b.font, 'Inter');
    assert.ok(b.usedDefaults!.includes('colors.primary'));
    assert.match(b.colors.background, /^#[0-9A-F]{6}$/);
    assert.equal(b.handle, 'acme');
});
