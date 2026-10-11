import { Router, Request, Response } from 'express';
import { SocialBillingService } from './social-billing.service';

const router = Router();

/**
 * GET /api/v1/social-media/billing/status
 * Check trial status, active subscription, or recharge pass.
 */
router.get('/status', async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, error: 'UNAUTHORIZED', message: 'User authentication required.' });
        }
        const companyId = (req as any).user?.companyId || (req as any).companyId || userId;
        const status = await SocialBillingService.getBillingStatus(userId, companyId);
        return res.json({ success: true, ...status });
    } catch (error: any) {
        console.error('[SocialBillingRoutes] Error getting status:', error);
        return res.status(500).json({ success: false, error: 'BILLING_STATUS_FAILED', message: error.message });
    }
});

/**
 * GET /api/v1/social-media/billing/plans
 * Get available creator plans (Monthly & Daily Recharge Pass)
 */
router.get('/plans', async (req: Request, res: Response) => {
    try {
        const plans = await SocialBillingService.getPlans();
        return res.json({ success: true, ...plans });
    } catch (error: any) {
        console.error('[SocialBillingRoutes] Error getting plans:', error);
        return res.status(500).json({ success: false, error: 'BILLING_PLANS_FAILED', message: error.message });
    }
});

/**
 * POST /api/v1/social-media/billing/checkout
 * Initiate checkout for either monthly subscription ($20/mo) or daily recharge pass ($0.71/day)
 */
router.post('/checkout', async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, error: 'UNAUTHORIZED', message: 'User authentication required.' });
        }
        const companyId = (req as any).user?.companyId || (req as any).companyId || userId;
        const userEmail = (req as any).user?.email || 'creator@180workspace.com';

        const { type, days, returnUrl } = req.body;
        const checkout = await SocialBillingService.createCheckout(userId, companyId, userEmail, {
            type: type === 'recharge' ? 'recharge' : 'monthly',
            days: days ? parseInt(days, 10) : undefined,
            returnUrl,
        });

        return res.json({ success: true, ...checkout });
    } catch (error: any) {
        console.error('[SocialBillingRoutes] Error creating checkout:', error);
        return res.status(500).json({ success: false, error: 'CHECKOUT_FAILED', message: error.message });
    }
});

/**
 * Public Webhook Handler for 180 Pay
 */
export async function socialBillingWebhookHandler(req: Request, res: Response) {
    try {
        const rawBody = (req as any).rawBody || req.body;
        const result = await SocialBillingService.handleWebhook(rawBody, req.headers);
        return res.status(200).json(result);
    } catch (error: any) {
        console.error('[SocialBillingRoutes] Webhook error:', error);
        return res.status(400).json({ success: false, error: error.message });
    }
}

// Mount webhook on the router as well for consistency
router.post('/webhook', socialBillingWebhookHandler);

export default router;
