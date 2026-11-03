/**
 * Trend Lab endpoints. Mounted at /api/v1/social-media/projects/:id/trend-lab.
 *
 *   GET  /lanes                         which research lanes are live (UI shows what is missing)
 *   POST /reports        {topic}        start research                         -> 202 {reportId, status}
 *   GET  /reports                       recent reports (20)                    -> 200 {reports}
 *   GET  /reports/:reportId             status, stage, report when done        -> 200 {...}
 *   POST /reports/:reportId/scripts     {clusterId, angleId, platforms, format, durationSec?, mood?, notes?}
 *                                                                              -> 202 {pieceId, calendarId, status}
 *   GET  /scripts/:pieceId              script job status + expanded piece     -> 200 {...}
 *
 * Tenant = the authenticated user's company; every lookup is scoped to (companyId, projectId).
 */
import { Router, Request, Response } from 'express';
import type { TrendLabService } from '@workspace/social-media';

const defaultService = (): TrendLabService => require('@workspace/social-media').getTrendLabService();

function sendError(res: Response, err: any) {
    if (err?.code && err?.statusCode) {
        return res.status(err.statusCode).json({ success: false, code: err.code, error: err.message });
    }
    console.error('[trend-lab.routes] unexpected error', err);
    return res.status(500).json({ success: false, code: 'INTERNAL', error: 'Unexpected error' });
}

const companyOf = (req: Request) => (req as any).user?.companyId || (req as any).companyId;

export function createTrendLabRouter(getService: () => TrendLabService = defaultService) {
    const router = Router({ mergeParams: true });
    const handle = (fn: (ctx: { svc: TrendLabService; companyId: string; projectId: string; req: Request }) => Promise<any>, status = 200) =>
        async (req: Request, res: Response) => {
            try {
                const companyId = companyOf(req);
                if (!companyId) return res.status(401).json({ success: false, code: 'UNAUTHORIZED', error: 'Company context required' });
                const result = await fn({ svc: getService(), companyId, projectId: String(req.params.id), req });
                res.status(status).json({ success: true, ...result });
            } catch (err) {
                sendError(res, err);
            }
        };

    router.get('/lanes', handle(async ({ svc, companyId, projectId }) => svc.lanes({ companyId, projectId })));
    router.post('/reports', handle(({ svc, companyId, projectId, req }) => svc.start({ companyId, projectId, userId: (req as any).user?.id || '', body: req.body || {} }), 202));
    router.get('/reports', handle(({ svc, companyId, projectId }) => svc.list({ companyId, projectId })));
    router.get('/reports/:reportId', handle(({ svc, companyId, projectId, req }) => svc.get({ companyId, projectId, reportId: String(req.params.reportId) })));
    router.post('/reports/:reportId/scripts', handle(({ svc, companyId, projectId, req }) =>
        svc.createScript({ companyId, projectId, userId: (req as any).user?.id || '', reportId: String(req.params.reportId), body: req.body || {} }), 202));
    router.get('/scripts/:pieceId', handle(({ svc, companyId, projectId, req }) => svc.getScript({ companyId, projectId, pieceId: String(req.params.pieceId) })));
    return router;
}

export default createTrendLabRouter();
