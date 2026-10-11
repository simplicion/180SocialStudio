import { Router, Request, Response } from 'express';
import * as SocialMediaModule from '@workspace/social-media';
import { getProjectAnalytics, fetchLivePlatformMetrics, SocialInsightsError } from '@workspace/social-media';
import { brandLogoHandler, brandLogoMultipart, defaultBrandLogoDeps } from './brand-logo-upload';
import { sendRouteError } from '../route-errors';

const router = Router();

/** Maps BrandConsciousnessError (validation 400, not found 404, ...) to a JSON error; anything else is a 500. */
function sendBrandError(res: Response, error: any, label: string) {
    if (error?.name === 'BrandConsciousnessError') {
        return res.status(error.status).json({ success: false, error: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) });
    }
    console.error(`[SocialProjects] ${label} failed:`, error?.message);
    return res.status(500).json({ success: false, error: 'BRAND_CONSCIOUSNESS_FAILED', message: 'Could not process the brand profile.' });
}

const companyOf = (req: Request): string | undefined => (req as any).user?.companyId || (req as any).companyId;

function getService(): typeof SocialMediaModule.SocialProjectService {
    return SocialMediaModule.SocialProjectService || 
           (SocialMediaModule as any).default?.SocialProjectService || 
           require('@workspace/social-media').SocialProjectService;
}

// List social media projects
router.get('/', async (req: Request, res: Response) => {
    try {
        const { search, status, clientId, limit, offset } = req.query;
        const companyId = (req as any).user?.companyId || (req as any).companyId;
        const service = getService();
        const result = await service.listProjects({
            search: search as string,
            status: status as string,
            clientId: clientId as string,
            limit: limit ? parseInt(limit as string) : 50,
            offset: offset ? parseInt(offset as string) : 0,
            companyId
        });
        res.json({ success: true, ...result });
    } catch (error: any) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// Create social media project
router.post('/', async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const companyId = user?.companyId || (req as any).companyId;
        const service = getService();
        const project = await service.createProject(req.body, user?.id || 'system_user', companyId);
        res.status(201).json({ success: true, project });
    } catch (error: any) {
        if (error?.name === 'BrandConsciousnessError') return sendBrandError(res, error, 'create project');
        res.status(400).json({ success: false, error: error.message });
    }
});

// Get project details
router.get('/:id', async (req: Request, res: Response) => {
    try {
        const companyId = (req as any).user?.companyId || (req as any).companyId;
        const service = getService();
        const project = await service.getProjectById(String(req.params.id), companyId);
        res.json({ success: true, project });
    } catch (error: any) {
        res.status(404).json({ success: false, error: error.message });
    }
});

// Update project settings & metadata
router.put('/:id', async (req: Request, res: Response) => {
    try {
        const companyId = (req as any).user?.companyId || (req as any).companyId;
        const service = getService();
        const project = await service.updateProjectSettings(String(req.params.id), req.body, companyId);
        res.json({ success: true, project });
    } catch (error: any) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// Brand consciousness: the user's brand profile + completeness (no invented values). See docs/social-studio-mobile/BRAND_CONSCIOUSNESS_API.md
router.get('/:id/brand-consciousness', async (req: Request, res: Response) => {
    try {
        const companyId = companyOf(req);
        const brand = await SocialMediaModule.getProjectBrandConsciousness(String(req.params.id), companyId as string);
        res.json({ success: true, brand });
    } catch (error: any) {
        sendBrandError(res, error, 'get brand consciousness');
    }
});

// Partial update (absent = unchanged, null/""/[] = clear). Zod-validated; unknown fields are rejected.
router.put('/:id/brand-consciousness', async (req: Request, res: Response) => {
    try {
        const companyId = companyOf(req);
        const brand = await SocialMediaModule.updateProjectBrandConsciousness(String(req.params.id), companyId as string, req.body);
        res.json({ success: true, brand });
    } catch (error: any) {
        sendBrandError(res, error, 'update brand consciousness');
    }
});

// Logo upload (multipart field "logo": PNG/JPEG/WebP/SVG, max 2 MB). Returns { logoUrl, brand }.
router.post('/:id/brand-consciousness/logo', brandLogoMultipart, (req: Request, res: Response) => brandLogoHandler(defaultBrandLogoDeps())(req, res));

// Get project dashboard metrics & attention items
router.get('/:id/dashboard', async (req: Request, res: Response) => {
    try {
        const companyId = (req as any).user?.companyId || (req as any).companyId;
        const service = getService();
        const dashboard = await service.getProjectDashboardMetrics(String(req.params.id), companyId);
        res.json({ success: true, dashboard });
    } catch (error: any) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// Project analytics over a range (7d | 30d | 90d), computed from this workspace's own records only
router.get('/:id/analytics', async (req: Request, res: Response) => {
    try {
        const companyId = (req as any).user?.companyId || (req as any).companyId;
        const range = typeof req.query.range === 'string' ? req.query.range : undefined;
        const analytics = await getProjectAnalytics({ projectId: String(req.params.id), companyId, range });
        res.json({ success: true, analytics });
    } catch (error: any) {
        if (error instanceof SocialInsightsError) {
            return res.status(error.status).json({ success: false, error: error.code, message: error.message });
        }
        console.error('[SocialProjects] analytics failed:', error?.message);
        res.status(500).json({ success: false, error: 'ANALYTICS_FAILED', message: 'Could not compute analytics.' });
    }
});

// Account metrics per connected network: `source` live | stored | unavailable (never estimated)
router.get('/:id/platform-metrics', async (req: Request, res: Response) => {
    try {
        const companyId = (req as any).user?.companyId;
        const metrics = await fetchLivePlatformMetrics({ projectId: String(req.params.id), companyId });
        res.json({ success: true, metrics });
    } catch (error: any) {
        if (error instanceof SocialInsightsError) {
            return res.status(error.status).json({ success: false, error: error.code, message: error.message });
        }
        console.error('[SocialProjects] platform metrics failed:', error?.message);
        res.status(500).json({ success: false, error: 'METRICS_FAILED', message: 'Could not load platform metrics.' });
    }
});

// Get project chronological activity feed
router.get('/:id/activity', async (req: Request, res: Response) => {
    try {
        const limit = req.query.limit ? parseInt(req.query.limit as string) : 25;
        const companyId = (req as any).user?.companyId || (req as any).companyId;
        const service = getService();
        const activity = await service.getProjectActivityFeed(String(req.params.id), limit, companyId);
        res.json({ success: true, activity });
    } catch (error: any) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// Link social account to project
router.post('/:id/accounts', async (req: Request, res: Response) => {
    try {
        const { accountId } = req.body;
        if (!accountId) return res.status(400).json({ success: false, error: 'accountId is required' });
        const companyId = (req as any).user?.companyId || (req as any).companyId;
        const service = getService();
        const result = await service.linkSocialAccount(String(req.params.id), String(accountId), companyId);
        res.json({ success: true, result });
    } catch (error: any) {
        sendRouteError(res, error, 'projects.link-account');
    }
});

// Unlink social account from project
router.delete('/:id/accounts/:accId', async (req: Request, res: Response) => {
    try {
        const companyId = (req as any).user?.companyId || (req as any).companyId;
        const service = getService();
        const result = await service.unlinkSocialAccount(String(req.params.id), String(req.params.accId), companyId);
        res.json({ success: true, result });
    } catch (error: any) {
        sendRouteError(res, error, 'projects.unlink-account');
    }
});

// Delete social media project
router.delete('/:id', async (req: Request, res: Response) => {
    try {
        const companyId = (req as any).user?.companyId || (req as any).companyId;
        const service = getService();
        const result = await service.deleteProject(String(req.params.id), companyId);
        res.json({ success: true, result });
    } catch (error: any) {
        res.status(400).json({ success: false, error: error.message });
    }
});

export default router;

