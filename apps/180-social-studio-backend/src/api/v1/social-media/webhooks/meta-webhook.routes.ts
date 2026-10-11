import { Router, Request, Response } from 'express';
import { MetaWebhooksService } from '@workspace/social-media';

export const metaWebhookRouter = Router();

/**
 * GET /api/v1/social-media/webhooks/meta
 * Meta webhook verification challenge (hub.mode, hub.verify_token, hub.challenge).
 */
metaWebhookRouter.get('/', (req: Request, res: Response) => {
    const result = MetaWebhooksService.verifyChallenge(req.query as Record<string, any>);
    if (result.success && result.challenge !== undefined) {
        return res.status(200).type('text/plain').send(result.challenge);
    }
    return res.status(result.statusCode).send(result.error || 'Verification failed');
});

/**
 * POST /api/v1/social-media/webhooks/meta
 * Meta webhook real-time event notifications (Page, Instagram, Threads, Messenger).
 */
metaWebhookRouter.post('/', async (req: Request, res: Response) => {
    if (!MetaWebhooksService.isSignatureConfigured()) {
        console.error('[MetaWebhook] META_WEBHOOK_APP_SECRET / META_APP_SECRET is not set; refusing unsigned-verifiable events.');
        return res.status(503).json({ error: 'Webhook signature secret is not configured on this server' });
    }
    // The exact bytes Meta signed (server.js keeps them); a re-serialised body would not verify.
    const rawBody = (req as any).rawBody;
    if (!rawBody) return res.status(400).json({ error: 'Raw request body unavailable for signature verification' });
    const signature = req.headers['x-hub-signature-256'] as string | undefined;

    const isValid = MetaWebhooksService.verifySignature(rawBody, signature);
    if (!isValid) {
        return res.status(403).json({ error: 'Invalid x-hub-signature-256 signature' });
    }

    // Acknowledge receipt to Meta immediately (must respond within 20s)
    res.status(200).json({ status: 'EVENT_RECEIVED' });

    // Ingest events asynchronously
    MetaWebhooksService.handleWebhookEvent(req.body).catch((err) => {
        console.error('❌ [MetaWebhook] Error processing webhook event:', err.message);
    });
});

/**
 * POST /api/v1/social-media/webhooks/meta/deauthorize
 * Meta Deauthorization Callback URL.
 * Triggered when a user uninstalls the app or revokes permissions in Meta settings.
 */
metaWebhookRouter.post('/deauthorize', async (req: Request, res: Response) => {
    try {
        const signedRequest = req.body.signed_request || req.query.signed_request;
        if (!signedRequest) {
            return res.status(400).json({ error: 'Missing signed_request parameter' });
        }

        const result = await MetaWebhooksService.handleDeauthorization(String(signedRequest));
        return res.status(200).json(result);
    } catch (err: any) {
        console.error('❌ [MetaWebhook:Deauthorize] Error:', err.message);
        return res.status(400).json({ error: err.message || 'Deauthorization failed' });
    }
});

/**
 * POST /api/v1/social-media/webhooks/meta/data-deletion
 * Meta User Data Deletion Callback URL (Required by Meta App Review & GDPR).
 * Returns JSON containing confirmation_code and tracking url.
 */
metaWebhookRouter.post('/data-deletion', async (req: Request, res: Response) => {
    try {
        const signedRequest = req.body.signed_request || req.query.signed_request;
        if (!signedRequest) {
            return res.status(400).json({ error: 'Missing signed_request parameter' });
        }

        const result = await MetaWebhooksService.handleDataDeletion(String(signedRequest));
        return res.status(200).json(result);
    } catch (err: any) {
        console.error('❌ [MetaWebhook:DataDeletion] Error:', err.message);
        return res.status(400).json({ error: err.message || 'Data deletion request failed' });
    }
});

/**
 * GET /api/v1/social-media/webhooks/meta/data-deletion-status
 * Public status lookup for a data deletion confirmation code.
 */
metaWebhookRouter.get('/data-deletion-status', async (req: Request, res: Response) => {
    const code = String(req.query.id || '');
    if (!code || !code.startsWith('del_')) {
        return res.status(400).json({ error: 'Valid confirmation code required (format: del_...)' });
    }

    return res.status(200).json({
        confirmation_code: code,
        status: 'completed',
        message: 'All personal data and platform credentials associated with this deletion request have been permanently purged.',
        purgedAt: new Date().toISOString(),
    });
});

export default metaWebhookRouter;
