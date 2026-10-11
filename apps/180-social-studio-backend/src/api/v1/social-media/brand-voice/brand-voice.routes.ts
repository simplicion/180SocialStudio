import { Router, Request, Response } from 'express';
import { BrandVoiceService, generateContentIdeas, SocialInsightsError } from '@workspace/social-media';

const router = Router();

// Get Brand Voice Profile for a Project
router.get('/:projectId', async (req: Request, res: Response) => {
    try {
        const profile = await BrandVoiceService.getBrandVoice(String(req.params.projectId));
        res.json({ success: true, profile });
    } catch (error: any) {
        res.status(error?.message === 'Project not found' ? 404 : 400).json({ success: false, error: error.message });
    }
});

// Upsert Brand Voice Profile for a Project
router.post('/:projectId', async (req: Request, res: Response) => {
    try {
        const profile = await BrandVoiceService.upsertBrandVoice(String(req.params.projectId), req.body);
        res.json({ success: true, profile });
    } catch (error: any) {
        res.status(error?.message === 'Project not found' ? 404 : 400).json({ success: false, error: error.message });
    }
});

// Content ideas grounded in the project's saved brand voice, from the workspace's configured AI provider
router.post('/:projectId/ideas', async (req: Request, res: Response) => {
    try {
        const companyId = (req as any).user?.companyId || (req as any).companyId;
        const ideas = await generateContentIdeas({ projectId: String(req.params.projectId), companyId, count: req.body?.count });
        res.json({ success: true, ideas });
    } catch (error: any) {
        if (error instanceof SocialInsightsError) {
            return res.status(error.status).json({ success: false, error: error.code, message: error.message });
        }
        console.error('[BrandVoice] idea generation failed:', error?.message);
        res.status(500).json({ success: false, error: 'IDEAS_FAILED', message: 'Could not generate ideas.' });
    }
});

export default router;
