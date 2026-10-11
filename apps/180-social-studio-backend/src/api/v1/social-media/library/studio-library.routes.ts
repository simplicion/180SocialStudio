import { Router, Request, Response } from 'express';
import { StudioLibraryService, SocialDomainError } from '@workspace/social-media';
import { requestContext } from '@workspace/db';
import { sendRouteError } from '../route-errors';

/**
 * Studio library metadata (media stays on the device).
 *   GET /library/sync?projectId=&since=  → { folders, items, serverTime } (soft-deleted rows included)
 *   PUT /library/sync { projectId?, deviceId?, folders[], items[], deletedFolderIds[], deletedItemIds[] }
 */
const router = Router();

function getCompanyId(req: Request): string {
    const id = requestContext.getStore()?.companyId || (req as any).user?.companyId;
    if (!id) throw new SocialDomainError('UNAUTHENTICATED', 401, 'Company context required');
    return String(id);
}

router.get('/sync', async (req: Request, res: Response) => {
    try {
        const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : null;
        const since = typeof req.query.since === 'string' ? req.query.since : null;
        res.json({ success: true, ...(await StudioLibraryService.pull(getCompanyId(req), { projectId, since })) });
    } catch (error: any) {
        sendRouteError(res, error, 'library');
    }
});

router.put('/sync', async (req: Request, res: Response) => {
    try {
        res.json({ success: true, ...(await StudioLibraryService.push(getCompanyId(req), req.body || {})) });
    } catch (error: any) {
        sendRouteError(res, error, 'library');
    }
});

export default router;
