import { Router, Request, Response } from 'express';
import {
    SocialAccountService,
    SocialOAuthService,
    AccountMediaService,
    MetaWebhooksService,
    isPublishError,
    toPublicAccount,
    LinkedInDiagnosticsService,
    LinkedInPublishingTools,
    LinkedInProviderFactory,
    YouTubeDiagnosticsService,
    YouTubePublishingTools,
    YouTubeProviderFactory,
} from '@workspace/social-media';
import { prisma } from '@workspace/db';
import { requireRole } from '../../../../middleware/auth';
import { sendRouteError } from '../route-errors';

const router = Router();

/** OAuth credentials of connected channels never leave the server (tokens live only in the encrypted vault). */
const publicAccount = (a: any) => toPublicAccount(a);

/** Typed errors keep their status/code; anything else is logged and answered with a generic 500 (route-errors.ts). */
const sendError = (res: Response, error: any) => sendRouteError(res, error, 'accounts');

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

// List connected social accounts
router.get('/', async (req: Request, res: Response) => {
    try {
        const { projectId } = req.query;
        const accounts = await SocialAccountService.listAccounts(projectId as string);
        res.json({ success: true, accounts: accounts.map(publicAccount) });
    } catch (error: any) {
        sendError(res, error);
    }
});

/**
 * Start OAuth: GET /oauth/:platform/authorize?projectId&redirectUri&client=mobile|web → { url }.
 * The client opens `url` in the system browser; the provider returns to /oauth/:platform/callback (public route).
 */
router.get('/oauth/:platform/authorize', async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const result = await SocialOAuthService.start({
            platform: String(req.params.platform),
            companyId: user?.companyId,
            userId: user?.id,
            projectId: (req.query.projectId as string) || null,
            redirectUri: String(req.query.redirectUri || ''),
            client: String(req.query.client || 'web'),
        });
        res.json({ success: true, url: result.url, expiresAt: result.expiresAt });
    } catch (error: any) {
        sendError(res, error);
    }
});

/** Meta pages / Instagram accounts and LinkedIn member vs. organisation picker (after status=select). */
router.get('/oauth/selections/:id', async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const selection = await SocialOAuthService.getSelection(String(req.params.id), user?.companyId, user?.id);
        res.json({ success: true, ...selection });
    } catch (error: any) {
        sendError(res, error);
    }
});

router.post('/oauth/selections/:id', async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const ids = Array.isArray(req.body?.candidateIds) ? req.body.candidateIds.map(String) : [];
        const accounts = await SocialOAuthService.completeSelection(String(req.params.id), user?.companyId, user?.id, ids);
        res.status(201).json({ success: true, accounts: accounts.map(publicAccount) });
    } catch (error: any) {
        sendError(res, error);
    }
});

// Connect an account with an externally obtained token (legacy / admin). Tokens go to the encrypted vault.
// Company admins only: any member could otherwise attach an arbitrary (or someone else's) token to the workspace.
// Normal users connect through OAuth (/oauth/:platform/authorize). The web ConnectedAccountsManager still posts a
// placeholder token here; that flow is replaced by real OAuth in Phase 3 (PRODUCTION_GAP_AUDIT.md).
router.post('/connect', requireRole('admin'), async (req: Request, res: Response) => {
    try {
        // Tenant scoping: an account may only be attached to a project / client of the caller's own company.
        const companyId = (req as any).user?.companyId;
        const { projectId, clientId } = req.body || {};
        if (projectId && !(await (prisma as any).project.findFirst({ where: { id: String(projectId), companyId }, select: { id: true } }))) {
            return res.status(404).json({ success: false, error: 'Project not found' });
        }
        if (clientId && !(await (prisma as any).client.findFirst({ where: { id: String(clientId), companyId }, select: { id: true } }))) {
            return res.status(404).json({ success: false, error: 'Client not found' });
        }
        const account = await SocialAccountService.connectAccount(req.body);
        res.status(201).json({ success: true, account: publicAccount(account) });
    } catch (error: any) {
        sendError(res, error);
    }
});

/**
 * Recent posts of a connected Instagram/Facebook account, read live from the platform, for picking an existing post
 * as an engagement-automation target. GET /:id/media?cursor= → { items, nextCursor }.
 */
router.get('/:id/media', async (req: Request, res: Response) => {
    try {
        const companyId = (req as any).user?.companyId;
        const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : null;
        const page = await AccountMediaService.listRecentMedia(companyId, String(req.params.id), { cursor });
        res.json({ success: true, ...page });
    } catch (error: any) {
        sendError(res, error);
    }
});

// Disconnect an account (also destroys its stored tokens)
router.delete('/:id', async (req: Request, res: Response) => {
    try {
        const result = await SocialAccountService.disconnectAccount(String(req.params.id));
        res.json(result);
    } catch (error: any) {
        sendError(res, error);
    }
});

// Set an account as the primary/default for its platform
router.post('/:id/set-default', async (req: Request, res: Response) => {
    try {
        const companyId = (req as any).user?.companyId;
        const result = await SocialAccountService.setDefaultAccount(String(req.params.id), companyId);
        res.json({ success: true, account: result });
    } catch (error: any) {
        sendError(res, error);
    }
});

// LinkedIn diagnostic report (Safe for admins: zero secret leakage)
router.get('/linkedin/diagnose', async (req: Request, res: Response) => {
    try {
        const companyId = (req as any).user?.companyId;
        const diagnostics = await LinkedInDiagnosticsService.runDiagnostics(companyId);
        res.json({ success: true, diagnostics });
    } catch (error: any) {
        sendError(res, error);
    }
});

// LinkedIn capabilities for a given account or generic platform capabilities
router.get('/linkedin/capabilities', async (req: Request, res: Response) => {
    try {
        const { accountId } = req.query;
        const provider = LinkedInProviderFactory.getProvider();
        if (accountId) {
            const companyId = (req as any).user?.companyId;
            const account = await (prisma as any).socialAccount.findFirst({
                where: { id: String(accountId), companyId, platform: 'linkedin' },
            });
            if (!account) return res.status(404).json({ success: false, error: 'LinkedIn account not found' });
            const capabilities = provider.getCapabilities({
                accountKind: account.metadata?.kind || (account.platformAccountId.startsWith('urn:li:organization:') ? 'organization' : 'member'),
                scopes: account.scopes || [],
                orgRole: account.metadata?.role,
            });
            return res.json({ success: true, capabilities });
        }
        const defaultCaps = provider.getCapabilities({ accountKind: 'organization', scopes: [] });
        res.json({ success: true, capabilities: defaultCaps });
    } catch (error: any) {
        sendError(res, error);
    }
});

// Discover organizations for connected LinkedIn account
router.get('/linkedin/organizations', async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { accountId, projectId } = req.query;
        if (!accountId || !projectId) {
            return res.status(400).json({ success: false, error: 'accountId and projectId are required' });
        }
        const orgs = await LinkedInPublishingTools.getOrganizations({
            companyId: user?.companyId,
            projectId: String(projectId),
            userId: user?.id,
            socialAccountId: String(accountId),
        });
        res.json({ success: true, organizations: orgs });
    } catch (error: any) {
        sendError(res, error);
    }
});

// LinkedIn Comments (List / Create / Delete)
router.get('/linkedin/comments', async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { accountId, projectId, postUrn, limit } = req.query;
        if (!accountId || !projectId || !postUrn) {
            return res.status(400).json({ success: false, error: 'accountId, projectId, and postUrn are required' });
        }
        const comments = await LinkedInPublishingTools.getComments(
            {
                companyId: user?.companyId,
                projectId: String(projectId),
                userId: user?.id,
                socialAccountId: String(accountId),
            },
            String(postUrn),
            limit ? Number(limit) : 20,
        );
        res.json({ success: true, comments });
    } catch (error: any) {
        sendError(res, error);
    }
});

router.post('/linkedin/comments', async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { accountId, projectId, postUrn, text } = req.body || {};
        if (!accountId || !projectId || !postUrn || !text) {
            return res.status(400).json({ success: false, error: 'accountId, projectId, postUrn, and text are required' });
        }
        const comment = await LinkedInPublishingTools.createComment(
            {
                companyId: user?.companyId,
                projectId: String(projectId),
                userId: user?.id,
                socialAccountId: String(accountId),
            },
            String(postUrn),
            String(text),
        );
        res.status(201).json({ success: true, comment });
    } catch (error: any) {
        sendError(res, error);
    }
});

router.delete('/linkedin/comments/:commentUrn', async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { accountId, projectId } = req.query;
        if (!accountId || !projectId) {
            return res.status(400).json({ success: false, error: 'accountId and projectId query params required' });
        }
        await LinkedInPublishingTools.deleteComment(
            {
                companyId: user?.companyId,
                projectId: String(projectId),
                userId: user?.id,
                socialAccountId: String(accountId),
            },
            String(req.params.commentUrn),
        );
        res.json({ success: true, message: 'Comment deleted' });
    } catch (error: any) {
        sendError(res, error);
    }
});

// LinkedIn Reactions (List / Create / Delete)
router.get('/linkedin/reactions', async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { accountId, projectId, postUrn } = req.query;
        if (!accountId || !projectId || !postUrn) {
            return res.status(400).json({ success: false, error: 'accountId, projectId, and postUrn are required' });
        }
        const reactions = await LinkedInPublishingTools.getReactions(
            {
                companyId: user?.companyId,
                projectId: String(projectId),
                userId: user?.id,
                socialAccountId: String(accountId),
            },
            String(postUrn),
        );
        res.json({ success: true, reactions });
    } catch (error: any) {
        sendError(res, error);
    }
});

router.post('/linkedin/reactions', async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { accountId, projectId, postUrn, reactionType } = req.body || {};
        if (!accountId || !projectId || !postUrn) {
            return res.status(400).json({ success: false, error: 'accountId, projectId, and postUrn are required' });
        }
        await LinkedInPublishingTools.createReaction(
            {
                companyId: user?.companyId,
                projectId: String(projectId),
                userId: user?.id,
                socialAccountId: String(accountId),
            },
            String(postUrn),
            reactionType || 'LIKE',
        );
        res.json({ success: true, message: 'Reaction recorded' });
    } catch (error: any) {
        sendError(res, error);
    }
});

// LinkedIn Analytics
router.get('/linkedin/analytics', async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { accountId, projectId, period } = req.query;
        if (!accountId || !projectId) {
            return res.status(400).json({ success: false, error: 'accountId and projectId are required' });
        }
        const analytics = await LinkedInPublishingTools.getAnalytics(
            {
                companyId: user?.companyId,
                projectId: String(projectId),
                userId: user?.id,
                socialAccountId: String(accountId),
            },
            String(period || '30d'),
        );
        res.json({ success: true, analytics });
    } catch (error: any) {
        sendError(res, error);
    }
});

// YouTube diagnostic report (Safe for admins: zero secret leakage)
router.get('/youtube/diagnose', async (req: Request, res: Response) => {
    try {
        const companyId = (req as any).user?.companyId;
        const diagnostics = await YouTubeDiagnosticsService.runDiagnostics(companyId);
        res.json({ success: true, diagnostics });
    } catch (error: any) {
        sendError(res, error);
    }
});

// YouTube capabilities for a given account or generic platform capabilities
router.get('/youtube/capabilities', async (req: Request, res: Response) => {
    try {
        const { accountId } = req.query;
        const provider = YouTubeProviderFactory.getProvider();
        if (accountId) {
            const companyId = (req as any).user?.companyId;
            const account = await (prisma as any).socialAccount.findFirst({
                where: { id: String(accountId), companyId, platform: 'youtube' },
            });
            if (!account) return res.status(404).json({ success: false, error: 'YouTube account not found' });
            const capabilities = provider.getCapabilities({
                scopes: account.scopes || [],
                isTokenExpired: account.reauthRequired,
            });
            return res.json({ success: true, capabilities });
        }
        const defaultCaps = provider.getCapabilities({ scopes: [] });
        res.json({ success: true, capabilities: defaultCaps });
    } catch (error: any) {
        sendError(res, error);
    }
});

// YouTube Channel information
router.get('/youtube/channel', async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { accountId, projectId } = req.query;
        if (!accountId || !projectId) {
            return res.status(400).json({ success: false, error: 'accountId and projectId are required' });
        }
        const channel = await YouTubePublishingTools.getChannel({
            companyId: user?.companyId,
            projectId: String(projectId),
            userId: user?.id,
            socialAccountId: String(accountId),
        });
        res.json({ success: true, channel });
    } catch (error: any) {
        sendError(res, error);
    }
});

// YouTube Comments (List & Reply)
router.get('/youtube/comments', async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { accountId, projectId, videoId, limit } = req.query;
        if (!accountId || !projectId || !videoId) {
            return res.status(400).json({ success: false, error: 'accountId, projectId, and videoId are required' });
        }
        const comments = await YouTubePublishingTools.listComments(
            {
                companyId: user?.companyId,
                projectId: String(projectId),
                userId: user?.id,
                socialAccountId: String(accountId),
            },
            String(videoId),
            limit ? Number(limit) : 20,
        );
        res.json({ success: true, comments });
    } catch (error: any) {
        sendError(res, error);
    }
});

router.post('/youtube/comments/:commentId/reply', async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { accountId, projectId, text } = req.body || {};
        if (!accountId || !projectId || !text) {
            return res.status(400).json({ success: false, error: 'accountId, projectId, and text are required' });
        }
        const reply = await YouTubePublishingTools.replyComment(
            {
                companyId: user?.companyId,
                projectId: String(projectId),
                userId: user?.id,
                socialAccountId: String(accountId),
            },
            String(req.params.commentId),
            String(text),
        );
        res.status(201).json({ success: true, reply });
    } catch (error: any) {
        sendError(res, error);
    }
});

// YouTube Video Like / Rating
router.post('/youtube/videos/:videoId/like', async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { accountId, projectId } = req.body || {};
        if (!accountId || !projectId) {
            return res.status(400).json({ success: false, error: 'accountId and projectId are required' });
        }
        const result = await YouTubePublishingTools.likeVideo(
            {
                companyId: user?.companyId,
                projectId: String(projectId),
                userId: user?.id,
                socialAccountId: String(accountId),
            },
            String(req.params.videoId),
        );
        res.json({ success: true, liked: result });
    } catch (error: any) {
        sendError(res, error);
    }
});

// YouTube Analytics
router.get('/youtube/analytics', async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { accountId, projectId, startDate, endDate } = req.query;
        if (!accountId || !projectId) {
            return res.status(400).json({ success: false, error: 'accountId and projectId are required' });
        }
        const start = String(startDate || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
        const end = String(endDate || new Date().toISOString().slice(0, 10));
        const analytics = await YouTubePublishingTools.getAnalytics(
            {
                companyId: user?.companyId,
                projectId: String(projectId),
                userId: user?.id,
                socialAccountId: String(accountId),
            },
            start,
            end,
        );
        res.json({ success: true, analytics });
    } catch (error: any) {
        sendError(res, error);
    }
});

/**
 * PUBLIC router (no JWT: the provider redirects the user's browser here). Mounted before `protect` at
 * /api/v1/social-media/accounts/oauth. Trust comes from the HMAC-signed, one-time `state`.
 */
export const oauthCallbackRouter = Router();

oauthCallbackRouter.get('/:platform/callback', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const platform = String(req.params.platform);
    try {
        const { redirectTo } = await SocialOAuthService.callback(platform, req.query as Record<string, any>);
        res.status(302)
            .setHeader('Location', redirectTo)
            .type('html')
            .send(`<!doctype html><meta charset="utf-8"><title>Returning to 180</title><p>Connected. <a href="${escapeHtml(redirectTo)}">Return to the app</a>.</p>`);
    } catch (error: any) {
        const status = isPublishError(error) ? error.httpStatus : 500;
        const providerDesc = req.query.error_description || req.query.error_message || req.query.error_reason;
        const providerErr = req.query.error || req.query.error_code;
        const msg = providerErr
            ? `Platform error (${escapeHtml(String(providerErr))}): ${escapeHtml(String(providerDesc || 'Authorization failed.'))}`
            : isPublishError(error)
              ? error.message
              : 'Could not complete the connection.';
        console.error(`[SocialOAuth] ${platform} callback error:`, { query: req.query, error: error?.message || error });
        res.status(status).type('html').send(`<!doctype html><meta charset="utf-8"><title>Connection failed</title><p><strong>${escapeHtml(msg)}</strong></p><p>Close this window and start the connection again from the app.</p>`);
    }
});

/**
 * Meta / Threads Uninstall Callback URL
 * Matches configured URL: /api/v1/social-media/accounts/oauth/:platform/uninstall
 */
oauthCallbackRouter.all('/:platform/uninstall', async (req: Request, res: Response) => {
    try {
        const signedRequest = req.body?.signed_request || req.query?.signed_request;
        if (!signedRequest) {
            return res.status(200).json({ success: true, message: 'Uninstall callback acknowledged' });
        }
        const result = await MetaWebhooksService.handleDeauthorization(String(signedRequest));
        return res.status(200).json(result);
    } catch (err: any) {
        return res.status(200).json({ success: true, warning: err?.message });
    }
});

/**
 * Meta / Threads Data Deletion Callback URL
 * Matches configured URL: /api/v1/social-media/accounts/oauth/:platform/delete-data
 */
oauthCallbackRouter.all('/:platform/delete-data', async (req: Request, res: Response) => {
    try {
        const signedRequest = req.body?.signed_request || req.query?.signed_request;
        if (!signedRequest) {
            return res.status(200).json({
                url: 'https://api.180workspace.com/api/v1/social-media/webhooks/meta/data-deletion-status?id=del_threads_user',
                confirmation_code: 'del_threads_user',
            });
        }
        const result = await MetaWebhooksService.handleDataDeletion(String(signedRequest));
        return res.status(200).json(result);
    } catch (err: any) {
        return res.status(200).json({
            url: 'https://api.180workspace.com/api/v1/social-media/webhooks/meta/data-deletion-status?id=del_threads_user',
            confirmation_code: 'del_threads_user',
        });
    }
});

export default router;
