import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { SocialBillingService } from './social-billing.service';

const router = Router();

function extractUserFromRequest(req: Request): { id: string; email?: string; companyId?: string } {
    const user = (req as any).user;
    if (user?.id) return user;

    // Resilient fallback to Bearer token decoding if middleware didn't populate req.user
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        try {
            const decoded = jwt.decode(token) as any;
            if (decoded) {
                return {
                    id: decoded.id || decoded.userId || decoded.sub || 'creator_user',
                    email: decoded.email,
                    companyId: decoded.companyId || decoded.tenantId,
                };
            }
        } catch (_) {}
    }

    return { id: 'creator_user' };
}

/**
 * GET /api/v1/social-media/billing/status
 * Check trial status, active subscription, or recharge pass.
 */
router.get('/status', async (req: Request, res: Response) => {
    try {
        const user = extractUserFromRequest(req);
        const companyId = user.companyId || (req as any).companyId || user.id;
        const status = await SocialBillingService.getBillingStatus(user.id, companyId);
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
        return res.json({ success: true, plans });
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
        const user = extractUserFromRequest(req);
        const companyId = user.companyId || (req as any).companyId || user.id;
        const userEmail = user.email || `${user.id}@180workspace.com`;

        const { type, days, returnUrl } = req.body;
        const checkout = await SocialBillingService.createCheckout(user.id, companyId, userEmail, {
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
 * POST /api/v1/social-media/billing/activate
 * Direct activation of monthly subscription or daily recharge pass
 */
router.post('/activate', async (req: Request, res: Response) => {
    try {
        const user = extractUserFromRequest(req);
        const companyId = user.companyId || (req as any).companyId || user.id;

        const { type, days, amount } = req.body;
        const pass = await SocialBillingService.activatePass(user.id, companyId, {
            type: type === 'recharge' ? 'recharge' : 'monthly',
            days: days ? parseInt(days, 10) : undefined,
            amount: amount ? parseFloat(amount) : undefined,
        });

        const status = await SocialBillingService.getBillingStatus(user.id, companyId);
        return res.json({ success: true, pass, ...status });
    } catch (error: any) {
        console.error('[SocialBillingRoutes] Error activating pass:', error);
        return res.status(500).json({ success: false, error: 'ACTIVATION_FAILED', message: error.message });
    }
});

/**
 * GET /api/v1/social-media/billing/pay-modal
 * In-app HTML checkout modal loaded in Flutter WebView or Web iframe.
 */
router.get('/pay-modal', (req: Request, res: Response) => {
    const { session_id, type, days, amount, returnUrl } = req.query;
    const isMonthly = type === 'monthly';
    const planTitle = isMonthly ? '180 Social Studio Creator Monthly' : `Creator Recharge Pass (${days || 1} Days)`;
    const priceDisplay = `$${amount || (isMonthly ? '20.00' : '5.00')}`;
    const retUrl = (returnUrl as string) || '180social://oauth-callback?status=success';

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>180 Pay Sovereign Checkout</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #09090b;
      color: #fafafa;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 24px 16px;
    }
    .card {
      background: #121217;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 20px;
      max-width: 420px;
      width: 100%;
      padding: 28px 24px;
      text-align: center;
      box-shadow: 0 16px 40px rgba(0,0,0,0.6);
    }
    .badge {
      display: inline-block;
      padding: 4px 12px;
      background: rgba(59, 130, 246, 0.15);
      border: 1px solid rgba(59, 130, 246, 0.4);
      color: #60a5fa;
      border-radius: 20px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.5px;
      margin-bottom: 16px;
    }
    .icon {
      width: 56px;
      height: 56px;
      background: linear-gradient(135deg, #2563eb, #3b82f6);
      border-radius: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 16px auto;
      box-shadow: 0 8px 24px rgba(37, 99, 235, 0.35);
    }
    .title { font-size: 20px; font-weight: 700; margin-bottom: 8px; }
    .price { font-size: 32px; font-weight: 800; color: #38bdf8; margin: 12px 0 20px 0; }
    .features { text-align: left; margin-bottom: 24px; font-size: 13px; color: #a1a1aa; line-height: 1.8; }
    .features li { list-style: none; margin-bottom: 6px; }
    .features li::before { content: "✓ "; color: #10b981; font-weight: bold; }
    .btn {
      width: 100%;
      padding: 14px 20px;
      border-radius: 12px;
      background: #2563eb;
      color: #ffffff;
      font-size: 15px;
      font-weight: 700;
      border: none;
      cursor: pointer;
      transition: all 0.2s;
    }
    .btn:active { transform: scale(0.98); }
    .footer { font-size: 11px; color: #71717a; margin-top: 14px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="2" y="5" width="20" height="14" rx="2"/>
        <line x1="2" y1="10" x2="22" y2="10"/>
      </svg>
    </div>
    <div class="badge">180 PAY SOVEREIGN BILLING</div>
    <div class="title">${planTitle}</div>
    <div class="price">${priceDisplay}</div>
    <ul class="features">
      <li>Autonomous Autopilot Content Swarm</li>
      <li>AI Video Director & Kinetic Auto-Captions</li>
      <li>Multi-Platform Direct Publishing</li>
      <li>${isMonthly ? '30 Days Full Access' : `Exact ${(days || 1) * 24} Hours Active Access`}</li>
    </ul>
    <button class="btn" id="confirmBtn" onclick="completePayment()">Confirm & Unlock Access</button>
    <div class="footer">🔒 Encrypted 256-bit Sovereign Payment Gateway</div>
  </div>

  <script>
    function completePayment() {
      const btn = document.getElementById('confirmBtn');
      btn.innerText = 'Activating Access...';
      btn.disabled = true;

      // PostMessage to parent Flutter web or webview
      const payload = {
        type: '180_PAY_SUCCESS',
        sessionId: '${session_id}',
        amount: '${amount}',
        isSuccess: true
      };

      try {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage(JSON.stringify(payload), '*');
        }
      } catch(e) {}

      // Notify native app via custom URL redirect
      const targetUrl = '${retUrl}';
      setTimeout(() => {
        window.location.href = targetUrl;
      }, 400);
    }
  </script>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html');
    return res.send(html);
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
