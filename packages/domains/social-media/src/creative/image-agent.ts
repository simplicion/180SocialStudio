import { CreativeError } from './creative-errors';
import type { ImageProvider, ImageProviderChain, ImageRequest, ImageResult } from './image-providers';

/**
 * The image agent: picks where each slide's photograph comes from and walks the provider chain on failure.
 * It never fabricates an image: when nothing is configured the slide is typographic (stock-only mode) or the request
 * fails with IMAGE_MODEL_NOT_CONFIGURED (image-model mode), depending on what the caller allowed.
 */

export type ImageSourceMode = 'generative' | 'stock' | 'none';

export interface ImagePlan {
    mode: ImageSourceMode;
    providers: ImageProvider[];
    warnings: string[];
}

export function planImageSource(chain: ImageProviderChain, opts: { useImageModel: boolean; allowStockFallback: boolean }): ImagePlan {
    if (opts.useImageModel) {
        if (chain.generative.length) {
            return { mode: 'generative', providers: [...chain.generative, ...(opts.allowStockFallback ? chain.stock : [])], warnings: [] };
        }
        if (opts.allowStockFallback && chain.stock.length) {
            return { mode: 'stock', providers: chain.stock, warnings: ['No image model is configured; used stock photos instead.'] };
        }
        throw new CreativeError(
            503,
            'IMAGE_MODEL_NOT_CONFIGURED',
            'No image model is configured. Add BFL_API_KEY (FLUX), a Google AI key or an OpenAI key in Settings > AI or the server env, or retry with allowStockFallback=true.',
        );
    }
    if (chain.stock.length) return { mode: 'stock', providers: chain.stock, warnings: [] };
    return { mode: 'none', providers: [], warnings: ['No stock photo provider is configured (PEXELS_API_KEY / PIXABAY_API_KEY); slides were rendered without photos.'] };
}

export async function fetchImage(plan: ImagePlan, req: ImageRequest): Promise<{ image: ImageResult | null; errors: string[] }> {
    const errors: string[] = [];
    for (const p of plan.providers) {
        try {
            return { image: await p.generate(req), errors };
        } catch (e: any) {
            errors.push(e?.message || String(e));
        }
    }
    return { image: null, errors };
}
