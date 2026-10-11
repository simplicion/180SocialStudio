import { Router, Request, Response } from 'express';
import { SocialPostService, PublishDispatcher } from '@workspace/social-media';
import { companyOfUser, sendRouteError } from '../route-errors';

const router = Router();

// List posts
router.get('/', async (req: Request, res: Response) => {
    try {
        const { projectId, clientId, status, calendarId, isEvergreen, limit, offset } = req.query;
        const posts = await SocialPostService.listPosts({
            projectId: projectId as string,
            clientId: clientId as string,
            status: status as string,
            calendarId: calendarId as string,
            isEvergreen: isEvergreen === 'true' ? true : isEvergreen === 'false' ? false : undefined,
            limit: limit ? parseInt(limit as string) : 50,
            offset: offset ? parseInt(offset as string) : 0
        });
        res.json({ success: true, posts });
    } catch (error: any) {
        sendRouteError(res, error, 'posts');
    }
});

// Get post by ID
router.get('/:id', async (req: Request, res: Response) => {
    try {
        const post = await SocialPostService.getPost(String(req.params.id));
        res.json({ success: true, post });
    } catch (error: any) {
        sendRouteError(res, error, 'posts');
    }
});

// Create post
router.post('/', async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const post = await SocialPostService.createPost(req.body, user?.id);
        res.status(201).json({ success: true, post });
    } catch (error: any) {
        sendRouteError(res, error, 'posts');
    }
});

// Update post
router.put('/:id', async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const post = await SocialPostService.updatePost(String(req.params.id), req.body, user?.id);
        res.json({ success: true, post });
    } catch (error: any) {
        sendRouteError(res, error, 'posts');
    }
});

// Submit source footage / external drive links
router.post('/:id/footage', async (req: Request, res: Response) => {
    try {
        const result = await SocialPostService.submitFootage(String(req.params.id), req.body);
        res.json(result);
    } catch (error: any) {
        sendRouteError(res, error, 'posts');
    }
});

// Get 180 Media Studio launch context
router.get('/:id/studio-launch-context', async (req: Request, res: Response) => {
    try {
        const context = await SocialPostService.buildMediaStudioLaunchContext(undefined, String(req.params.id));
        res.json({ success: true, context });
    } catch (error: any) {
        sendRouteError(res, error, 'posts');
    }
});

// Validate publishing readiness
router.get('/:id/validate-publish', async (req: Request, res: Response) => {
    try {
        const validation = await SocialPostService.validatePublishingReadiness(String(req.params.id));
        res.json({ success: true, ...validation });
    } catch (error: any) {
        sendRouteError(res, error, 'posts');
    }
});

// Assign a social account to a specific variant
router.patch('/:id/variants/:variantId/account', async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { socialAccountId } = req.body || {};
        const variant = await SocialPostService.assignVariantAccount(
            String(req.params.id),
            String(req.params.variantId),
            socialAccountId ? String(socialAccountId) : null,
            user?.companyId
        );
        res.json({ success: true, variant });
    } catch (error: any) {
        sendRouteError(res, error, 'posts.variant.account');
    }
});

// Sync video rendered from 180 Media Studio (web or native desktop)
router.post('/sync-studio-render', async (req: Request, res: Response) => {
    try {
        // Tenant = the caller's JWT company only: another company's piece id is a 404 and nothing is written.
        const companyId = companyOfUser(req);
        if (!companyId) return res.status(401).json({ success: false, error: 'Authentication required' });
        const { calendarPieceId, finalVideoUrl, thumbnailUrl } = req.body || {};
        if (!calendarPieceId || !finalVideoUrl) {
            return res.status(400).json({ success: false, error: 'calendarPieceId and finalVideoUrl are required' });
        }
        const result = await SocialPostService.syncVideoFromStudio(String(calendarPieceId), String(finalVideoUrl), thumbnailUrl ? String(thumbnailUrl) : undefined, companyId);
        res.json(result);
    } catch (error: any) {
        sendRouteError(res, error, 'posts');
    }
});

/** Typed publishing errors keep their HTTP status and code (e.g. 503 PUBLISH_NOT_CONFIGURED, 409 APPROVAL_REQUIRED). */
const sendPublishError = (res: Response, error: any) => sendRouteError(res, error, 'posts.publish');

// Publish now: every unpublished variant; per-platform status, honest partial failure, never re-posts a published variant.
router.post('/:id/publish', async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const result = await PublishDispatcher.publishPost(String(req.params.id), { companyId: user?.companyId, userId: user?.id, trigger: 'manual' });
        res.json(result);
    } catch (error: any) {
        sendPublishError(res, error);
    }
});

// Retry single failed platform variant (idempotent: an already published variant is not re-sent)
router.post('/:id/retry-variant', async (req: Request, res: Response) => {
    try {
        const { platform } = req.body || {};
        if (!platform) return res.status(400).json({ success: false, error: 'platform is required' });
        const user = (req as any).user;
        const result = await PublishDispatcher.publishPost(String(req.params.id), { companyId: user?.companyId, userId: user?.id, trigger: 'retry', platform: String(platform) });
        const v = result.variants.find((x) => x.platform === platform) || result.variants.find((x) => x.publishStatus === 'failed');
        const ok = Boolean(v && (v.publishStatus === 'published' || v.publishStatus === 'processing'));
        res.json({ ...result, success: ok, message: ok ? `Published to ${platform}.` : `Retry failed for ${platform}: ${v?.error || 'unknown error'}` });
    } catch (error: any) {
        sendPublishError(res, error);
    }
});

// Publish history: one row per platform attempt
router.get('/:id/publish-attempts', async (req: Request, res: Response) => {
    try {
        const attempts = await SocialPostService.listPublishAttempts(String(req.params.id), req.query.limit ? parseInt(req.query.limit as string) : 50);
        res.json({ success: true, attempts });
    } catch (error: any) {
        sendPublishError(res, error);
    }
});

// Repurpose post
router.post('/:id/repurpose', async (req: Request, res: Response) => {
    try {
        const result = await SocialPostService.repurposePost(String(req.params.id), req.body);
        res.status(201).json({ success: true, post: result });
    } catch (error: any) {
        sendRouteError(res, error, 'posts');
    }
});

// Update user-assisted publishing status for a platform variant (e.g. X or Reddit handoff/confirmation)
router.post('/:id/assisted-status', async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const companyId = user?.companyId || companyOfUser(req);
        if (!companyId) return res.status(401).json({ success: false, error: 'Authentication required' });
        const { platform, status, platformMeta, externalUrl } = req.body || {};
        if (!platform || !status) {
            return res.status(400).json({ success: false, error: 'platform and status are required' });
        }
        const result = await SocialPostService.updateAssistedPublishStatus(
            String(req.params.id),
            {
                platform: String(platform),
                status: String(status),
                platformMeta: platformMeta || {},
                externalUrl: externalUrl ? String(externalUrl) : undefined,
                userId: user?.id,
            },
            companyId
        );
        res.json({ success: true, ...result });
    } catch (error: any) {
        sendRouteError(res, error, 'posts.assisted-status');
    }
});

export default router;
