import { CreativeError } from './creative-errors';
import { withInlineNegative, type PhotoPrompt } from './photo-prompt';

/**
 * Image providers behind one interface. Generative: Black Forest Labs FLUX.2 (primary), Google Gemini image
 * ("Nano Banana Pro"), OpenAI GPT Image. Stock (no generation): Pexels, Pixabay.
 *
 * Keys come from the company's own AI settings (Company.metadata, the same place Settings > AI stores them) or the
 * platform environment. There are no literal fallbacks: a provider without a key is simply not in the chain, and the
 * caller turns an empty chain into IMAGE_MODEL_NOT_CONFIGURED.
 */

export type ImageProviderKind = 'generative' | 'stock';

export interface ImageRequest {
    prompt: PhotoPrompt;
    width: number;
    height: number;
    aspect: 'portrait' | 'square' | 'landscape';
    seed?: number;
    /** Stock only: source ids already used in this carousel (so slides do not repeat a photo). */
    avoidIds?: Set<string>;
}

export interface ImageAttribution {
    author: string;
    url: string;
    license: string;
}

export interface ImageResult {
    buffer: Buffer;
    mimeType: string;
    provider: string;
    model: string;
    kind: ImageProviderKind;
    sourceId?: string;
    attribution?: ImageAttribution;
}

export interface ImageProvider {
    id: string;
    kind: ImageProviderKind;
    model: string;
    generate(req: ImageRequest): Promise<ImageResult>;
}

type FetchLike = typeof fetch;
const TIMEOUT_MS = Number(process.env.CREATIVE_IMAGE_TIMEOUT_MS || 120_000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const round16 = (n: number) => Math.max(256, Math.round(n / 16) * 16);

function providerError(provider: string, message: string, status?: number): CreativeError {
    return new CreativeError(502, 'IMAGE_PROVIDER_ERROR', `${provider}: ${message}`, { provider, upstreamStatus: status });
}

async function readError(res: Response): Promise<string> {
    try {
        const t = await res.text();
        try {
            const j = JSON.parse(t);
            return String(j?.error?.message || j?.detail?.[0]?.msg || j?.detail || j?.message || t).slice(0, 300);
        } catch {
            return t.slice(0, 300);
        }
    } catch {
        return `HTTP ${res.status}`;
    }
}

async function download(fetchImpl: FetchLike, url: string, provider: string, headers?: Record<string, string>): Promise<{ buffer: Buffer; mimeType: string }> {
    const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw providerError(provider, `image download failed (HTTP ${res.status})`, res.status);
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < 512) throw providerError(provider, 'image download returned an empty file');
    return { buffer, mimeType: res.headers.get('content-type') || 'image/jpeg' };
}

/* ------------------------------------------------------------------ BFL FLUX */

export class BflFluxProvider implements ImageProvider {
    id = 'bfl';
    kind: ImageProviderKind = 'generative';
    constructor(private apiKey: string, public model = process.env.BFL_IMAGE_MODEL || 'flux-2-pro', private fetchImpl: FetchLike = fetch, private pollMs = 1500) {
        if (!apiKey) throw new Error('BflFluxProvider requires an API key');
    }

    async generate(req: ImageRequest): Promise<ImageResult> {
        const base = (process.env.BFL_API_BASE || 'https://api.bfl.ai').replace(/\/$/, '');
        // FLUX follows positive descriptions better than negations, so the negative list is not appended here;
        // the positive prompt already asks for no text and natural skin.
        const body: any = {
            prompt: req.prompt.prompt,
            width: round16(req.width),
            height: round16(req.height),
            output_format: 'jpeg',
            safety_tolerance: 2,
            prompt_upsampling: false,
        };
        if (req.seed !== undefined) body.seed = req.seed;
        const submit = await this.fetchImpl(`${base}/v1/${this.model}`, {
            method: 'POST',
            headers: { 'x-key': this.apiKey, 'Content-Type': 'application/json', accept: 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(30_000),
        });
        if (!submit.ok) throw providerError('bfl', await readError(submit), submit.status);
        const task: any = await submit.json();
        const pollUrl: string = task.polling_url || `${base}/v1/get_result?id=${encodeURIComponent(task.id)}`;
        const deadline = Date.now() + TIMEOUT_MS;
        while (Date.now() < deadline) {
            await sleep(this.pollMs);
            const res = await this.fetchImpl(pollUrl, { headers: { 'x-key': this.apiKey, accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
            if (!res.ok) throw providerError('bfl', await readError(res), res.status);
            const r: any = await res.json();
            if (r.status === 'Ready') {
                const sample = r.result?.sample;
                if (!sample) throw providerError('bfl', 'result had no image');
                // Signed delivery URLs expire after ~10 minutes: download immediately.
                const img = await download(this.fetchImpl, sample, 'bfl');
                return { ...img, provider: 'bfl', model: this.model, kind: 'generative', sourceId: String(task.id) };
            }
            if (/moderated|error|failed|not found/i.test(String(r.status))) throw providerError('bfl', `generation ${r.status}`);
        }
        throw providerError('bfl', 'generation timed out');
    }
}

/* ------------------------------------------------------------------ Google Gemini image */

export class GeminiImageProvider implements ImageProvider {
    id = 'gemini';
    kind: ImageProviderKind = 'generative';
    constructor(private apiKey: string, public model = process.env.GEMINI_IMAGE_MODEL || 'gemini-3-pro-image', private fetchImpl: FetchLike = fetch) {
        if (!apiKey) throw new Error('GeminiImageProvider requires an API key');
    }

    async generate(req: ImageRequest): Promise<ImageResult> {
        const aspectRatio = req.aspect === 'portrait' ? '4:5' : req.aspect === 'square' ? '1:1' : '16:9';
        const res = await this.fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`, {
            method: 'POST',
            headers: { 'x-goog-api-key': this.apiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: withInlineNegative(req.prompt) }] }],
                generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio, imageSize: '2K' } },
            }),
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) throw providerError('gemini', await readError(res), res.status);
        const j: any = await res.json();
        const parts: any[] = j?.candidates?.[0]?.content?.parts || [];
        const inline = parts.map((p) => p.inlineData || p.inline_data).find((d) => d?.data);
        if (!inline) {
            const reason = j?.promptFeedback?.blockReason || j?.candidates?.[0]?.finishReason || 'no image in response';
            throw providerError('gemini', String(reason));
        }
        return { buffer: Buffer.from(inline.data, 'base64'), mimeType: inline.mimeType || inline.mime_type || 'image/png', provider: 'gemini', model: this.model, kind: 'generative' };
    }
}

/* ------------------------------------------------------------------ OpenAI GPT Image */

export class OpenAIImageProvider implements ImageProvider {
    id = 'openai';
    kind: ImageProviderKind = 'generative';
    constructor(private apiKey: string, public model = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2', private fetchImpl: FetchLike = fetch) {
        if (!apiKey) throw new Error('OpenAIImageProvider requires an API key');
    }

    async generate(req: ImageRequest): Promise<ImageResult> {
        const size = req.aspect === 'portrait' ? '1024x1536' : req.aspect === 'square' ? '1024x1024' : '1536x1024';
        const res = await this.fetchImpl('https://api.openai.com/v1/images/generations', {
            method: 'POST',
            headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: this.model,
                prompt: withInlineNegative(req.prompt),
                size,
                quality: process.env.OPENAI_IMAGE_QUALITY || 'high',
                output_format: 'jpeg',
                n: 1,
            }),
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) throw providerError('openai', await readError(res), res.status);
        const j: any = await res.json();
        const d = j?.data?.[0];
        if (d?.b64_json) return { buffer: Buffer.from(d.b64_json, 'base64'), mimeType: 'image/jpeg', provider: 'openai', model: this.model, kind: 'generative' };
        if (d?.url) return { ...(await download(this.fetchImpl, d.url, 'openai')), provider: 'openai', model: this.model, kind: 'generative' };
        throw providerError('openai', 'no image in response');
    }
}

/* ------------------------------------------------------------------ Stock: Pexels / Pixabay */

export class PexelsStockProvider implements ImageProvider {
    id = 'pexels';
    kind: ImageProviderKind = 'stock';
    model = 'pexels-search';
    constructor(private apiKey: string, private fetchImpl: FetchLike = fetch) {
        if (!apiKey) throw new Error('PexelsStockProvider requires an API key');
    }

    async generate(req: ImageRequest): Promise<ImageResult> {
        const orientation = req.aspect === 'square' ? 'square' : req.aspect;
        const params = new URLSearchParams({ query: req.prompt.stockQuery, orientation, per_page: '15' });
        const res = await this.fetchImpl(`https://api.pexels.com/v1/search?${params}`, {
            headers: { Authorization: this.apiKey, 'User-Agent': '180SocialStudio/1.0' },
            signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok) throw providerError('pexels', await readError(res), res.status);
        const j: any = await res.json();
        const photos: any[] = (j.photos || []).filter((p: any) => !req.avoidIds?.has(`pexels_${p.id}`));
        const pick = photos[0];
        if (!pick) throw providerError('pexels', `no photos for "${req.prompt.stockQuery}"`);
        const url = pick.src?.large2x || pick.src?.original || pick.src?.large;
        const img = await download(this.fetchImpl, url, 'pexels');
        return {
            ...img,
            provider: 'pexels',
            model: this.model,
            kind: 'stock',
            sourceId: `pexels_${pick.id}`,
            attribution: { author: pick.photographer || 'Pexels', url: pick.url || 'https://www.pexels.com', license: 'Pexels License' },
        };
    }
}

export class PixabayStockProvider implements ImageProvider {
    id = 'pixabay';
    kind: ImageProviderKind = 'stock';
    model = 'pixabay-search';
    constructor(private apiKey: string, private fetchImpl: FetchLike = fetch) {
        if (!apiKey) throw new Error('PixabayStockProvider requires an API key');
    }

    async generate(req: ImageRequest): Promise<ImageResult> {
        const orientation = req.aspect === 'landscape' ? 'horizontal' : req.aspect === 'portrait' ? 'vertical' : 'all';
        const params = new URLSearchParams({ key: this.apiKey, q: req.prompt.stockQuery.slice(0, 100), image_type: 'photo', orientation, per_page: '20', safesearch: 'true' });
        const res = await this.fetchImpl(`https://pixabay.com/api/?${params}`, { signal: AbortSignal.timeout(30_000) });
        if (!res.ok) throw providerError('pixabay', `HTTP ${res.status}`, res.status);
        const j: any = await res.json();
        const hits: any[] = (j.hits || []).filter((h: any) => !req.avoidIds?.has(`pixabay_${h.id}`));
        const pick = hits[0];
        if (!pick) throw providerError('pixabay', `no photos for "${req.prompt.stockQuery}"`);
        const img = await download(this.fetchImpl, pick.largeImageURL || pick.webformatURL, 'pixabay');
        return {
            ...img,
            provider: 'pixabay',
            model: this.model,
            kind: 'stock',
            sourceId: `pixabay_${pick.id}`,
            attribution: { author: pick.user || 'Pixabay', url: pick.pageURL || 'https://pixabay.com', license: 'Pixabay Content License' },
        };
    }
}

/* ------------------------------------------------------------------ Pollinations.ai FLUX (100% Free, No Key) */

export class PollinationsFluxProvider implements ImageProvider {
    id = 'pollinations';
    kind: ImageProviderKind = 'generative';
    model = 'flux-schnell';
    constructor(private fetchImpl: FetchLike = fetch) {}

    async generate(req: ImageRequest): Promise<ImageResult> {
        const width = round16(req.width);
        const height = round16(req.height);
        const promptText = encodeURIComponent(withInlineNegative(req.prompt));
        const seedParam = req.seed !== undefined ? `&seed=${req.seed}` : '';
        const url = `https://image.pollinations.ai/prompt/${promptText}?model=flux&width=${width}&height=${height}&nologo=true${seedParam}`;
        const img = await download(this.fetchImpl, url, 'pollinations');
        return {
            ...img,
            provider: 'pollinations',
            model: this.model,
            kind: 'generative',
        };
    }
}

/* ------------------------------------------------------------------ resolution */

export interface ImageProviderChain {
    generative: ImageProvider[];
    stock: ImageProvider[];
}

export interface ResolveOptions {
    /** Company.metadata (Settings > AI). Keys here win over platform env keys. */
    companyMetadata?: Record<string, any> | null;
    env?: NodeJS.ProcessEnv;
    fetchImpl?: FetchLike;
}

const first = (...vals: any[]) => vals.map((v) => (typeof v === 'string' ? v.trim() : '')).find(Boolean) || '';

/** Builds the provider chain from configured keys. Order is `CREATIVE_IMAGE_PROVIDERS` (default "bfl,gemini,openai"). */
export function resolveImageProviders(opts: ResolveOptions = {}): ImageProviderChain {
    const env = opts.env || process.env;
    const m = opts.companyMetadata || {};
    const f = opts.fetchImpl || fetch;
    const keys: Record<string, string> = {
        bfl: first(m.bflKey, m.bflApiKey, env.BFL_API_KEY),
        gemini: first(m.geminiImageKey, m.geminiKey, env.GOOGLE_AI_API_KEY, env.GEMINI_API_KEY, env.GOOGLE_API_KEY),
        openai: first(m.openaiImageKey, m.openaiKey, env.OPENAI_API_KEY),
    };
    const order = String(env.CREATIVE_IMAGE_PROVIDERS || 'bfl,gemini,openai')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    const generative: ImageProvider[] = [];
    for (const id of order) {
        if (id === 'pollinations' && (env.POLLINATIONS_ALLOW === 'true' || m.allowPollinations === true)) {
            generative.push(new PollinationsFluxProvider(f));
            continue;
        }
        if (!keys[id]) continue;
        if (id === 'bfl') generative.push(new BflFluxProvider(keys.bfl, env.BFL_IMAGE_MODEL || 'flux-2-pro', f));
        if (id === 'gemini') generative.push(new GeminiImageProvider(keys.gemini, env.GEMINI_IMAGE_MODEL || 'gemini-3-pro-image', f));
        if (id === 'openai') generative.push(new OpenAIImageProvider(keys.openai, env.OPENAI_IMAGE_MODEL || 'gpt-image-2', f));
    }
    const stock: ImageProvider[] = [];
    const pexels = first(m.pexelsKey, env.PEXELS_API_KEY);
    const pixabay = first(m.pixabayKey, env.PIXABAY_API_KEY);
    if (pexels) stock.push(new PexelsStockProvider(pexels, f));
    if (pixabay) stock.push(new PixabayStockProvider(pixabay, f));
    return { generative, stock };
}
