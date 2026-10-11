/**
 * Creative engine endpoints (WS3). Mounted at /api/v1/social-media/projects/:id/creative.
 *
 *   GET  /status                                   which AI / image model / stock sources are configured
 *   POST /carousels                                start a carousel job            -> 202 {job}
 *   POST /static-posts                             start a single-image post job   -> 202 {job}
 *   GET  /jobs/:jobId                              job status + result             -> 200 {job}
 *   POST /jobs/:jobId/slides/:index/regenerate     redo one slide                  -> 202 {job}
 *   POST /thumbnails                               AI thumbnail team (real frames) -> 200 {variants, hooks}
 *
 * Tenant = the authenticated user's company; every lookup is scoped to (companyId, projectId).
 * See docs/social-studio-mobile/CREATIVE_ENGINE.md.
 */
import { Router, Request, Response } from 'express';
import type { AssetStore, CreativeService } from '@workspace/social-media';

class StorageNotConfiguredError extends Error {}

/** R2 via @workspace/integrations. No fallbacks: missing credentials fail loudly (503 STORAGE_UNAVAILABLE). */
function assertR2Configured() {
    const env = process.env;
    const configured =
        (env.CLOUDFLARE_R2_ENDPOINT || env.R2_ENDPOINT) &&
        (env.CLOUDFLARE_R2_ACCESS_KEY_ID || env.R2_ACCESS_KEY) &&
        (env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || env.R2_SECRET_KEY) &&
        (env.CLOUDFLARE_R2_BUCKET_NAME || env.R2_BUCKET_NAME);
    if (!configured) throw new StorageNotConfiguredError('File storage is not configured on the server (R2_ENDPOINT, R2_ACCESS_KEY, R2_SECRET_KEY, R2_BUCKET_NAME).');
}

export const r2AssetStore: AssetStore = {
    assertConfigured: assertR2Configured,
    put: async (key, body, contentType) => {
        assertR2Configured();
        const out = await require('@workspace/integrations').uploadBufferToR2(body, key, contentType);
        return out.url as string;
    },
};

let singleton: CreativeService | null = null;
const defaultService = (): CreativeService => {
    if (!singleton) singleton = require('@workspace/social-media').createDefaultCreativeService({ store: r2AssetStore });
    return singleton!;
};

function sendError(res: Response, err: any) {
    if (err?.name === 'CreativeError' && err.status) {
        return res.status(err.status).json({ success: false, code: err.code, error: err.message, ...(err.details ? { details: err.details } : {}) });
    }
    // WS1 brand errors (e.g. project not found) carry status + code too.
    if (err?.status && err?.code && typeof err.status === 'number') {
        return res.status(err.status).json({ success: false, code: err.code, error: err.message });
    }
    console.error('[creative.routes] unexpected error', err);
    return res.status(500).json({ success: false, code: 'INTERNAL', error: 'Unexpected error' });
}

const ctxOf = (req: Request) => ({
    companyId: (req as any).user?.companyId || (req as any).companyId,
    projectId: String(req.params.id),
    userId: (req as any).user?.id || null,
});

export function createCreativeRouter(getService: () => CreativeService = defaultService) {
    const router = Router({ mergeParams: true });

    const guard = (fn: (req: Request, res: Response, ctx: ReturnType<typeof ctxOf>) => Promise<any>) => async (req: Request, res: Response) => {
        try {
            const ctx = ctxOf(req);
            if (!ctx.companyId) return res.status(401).json({ success: false, code: 'UNAUTHORIZED', error: 'Company context required' });
            await fn(req, res, ctx);
        } catch (err) {
            sendError(res, err);
        }
    };

    // AI thumbnail design team: frames in, three QA'd thumbnails out (synchronous).
    router.post('/thumbnails', guard(async (req, res, ctx) => {
        res.json({ success: true, ...(await getService().designThumbnails(ctx, req.body || {})) });
    }));

    // Manual thumbnail (no AI): one frame + the creator's text through the same compositor and QA.
    router.post('/thumbnails/render', guard(async (req, res, ctx) => {
        res.json({ success: true, ...(await getService().renderThumbnailManual(ctx, req.body || {})) });
    }));

    router.get('/status', guard(async (_req, res, ctx) => {
        res.json({ success: true, ...(await getService().getStatus(ctx)) });
    }));

    router.post('/carousels', guard(async (req, res, ctx) => {
        const job = await getService().startCarousel(ctx, req.body || {});
        res.status(202).json({ success: true, job });
    }));

    router.post('/static-posts', guard(async (req, res, ctx) => {
        const job = await getService().startStaticPost(ctx, req.body || {});
        res.status(202).json({ success: true, job });
    }));

    router.get('/jobs/:jobId', guard(async (req, res, ctx) => {
        const job = await getService().getJob(ctx, String(req.params.jobId));
        res.json({ success: true, job });
    }));

    router.post('/jobs/:jobId/slides/:index/regenerate', guard(async (req, res, ctx) => {
        const index = Number(req.params.index);
        const job = await getService().regenerateSlide(ctx, String(req.params.jobId), index, req.body || {});
        res.status(202).json({ success: true, job });
    }));

    return router;
}

export default createCreativeRouter();
