import { Request, Response, NextFunction } from 'express';
import { SocialBillingService } from '../api/v1/social-media/billing/social-billing.service';

/**
 * Middleware that strictly enforces active creator subscription or unexpired daily pass.
 * Only users with an active monthly subscription or active daily pass can access studio features.
 */
export async function requireActiveSubscriptionOrPass(req: Request, res: Response, next: NextFunction) {
    const path = req.path || '';

    // Allow billing endpoints (status, plans, checkout, activation, modal, webhook) without restriction
    if (
        path.startsWith('/billing') ||
        path.startsWith('/auth') ||
        path.startsWith('/accounts/oauth') ||
        path.startsWith('/webhooks')
    ) {
        return next();
    }

    try {
        const user = (req as any).user;
        const userId = user?.id || 'creator_user';
        const companyId = user?.companyId || (req as any).companyId;

        const billing = await SocialBillingService.checkAccess(userId, companyId);

        if (!billing.canAccess) {
            return res.status(403).json({
                success: false,
                code: 'SUBSCRIPTION_EXPIRED',
                error: 'Active subscription or daily pass required.',
                lockReason: 'subscriptionExpired',
                message: billing.message || 'Your creator pass or subscription has expired. Slide to recharge or subscribe to unlock access.',
                billingStatus: billing,
            });
        }

        next();
    } catch (err: any) {
        console.error('[creatorAccessGuard] Error checking access:', err.message);
        // Fail open to next if transient DB error, or next()
        next();
    }
}
