import { Router, Request, Response } from 'express';
import { AICompanyConfigService } from '@workspace/ai';

const router = Router();
const companyOf = (req: Request) => (req as any).user?.companyId || (req as any).companyId;

router.get('/ai', async (req: Request, res: Response) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.status(401).json({ success: false, error: 'Company context required' });
        const summary = await AICompanyConfigService.getCompanyAISummary(companyId);
        res.json({ success: true, ...summary });
    } catch (err: any) {
        console.error('[settings/ai.routes] Error fetching AI summary:', err);
        res.status(500).json({ success: false, error: err.message || 'Failed to fetch AI configuration' });
    }
});

router.put('/ai', async (req: Request, res: Response) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.status(401).json({ success: false, error: 'Company context required' });
        const { aiProvider, openaiKey, geminiKey, claudeKey, groqKey } = req.body || {};
        const updated = await AICompanyConfigService.updateCompanyAISettings(companyId, {
            aiProvider,
            openaiKey,
            geminiKey,
            claudeKey,
            groqKey,
        });
        res.json({ success: true, ...updated });
    } catch (err: any) {
        console.error('[settings/ai.routes] Error updating AI settings:', err);
        res.status(400).json({ success: false, error: err.message || 'Failed to update AI settings' });
    }
});

export default router;
