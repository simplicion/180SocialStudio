import { Router, Request, Response } from 'express';
import { SocialInboxService, AiReplyAllService, AiInboxService } from '@workspace/social-media';
import { prisma, requestContext } from '@workspace/db';
import { sendRouteError } from '../route-errors';

const router = Router();

function getCompanyId(req: Request): string {
    const fromContext = requestContext.getStore()?.companyId;
    if (fromContext) return String(fromContext);
    const fromUser = (req as any).user?.companyId;
    if (fromUser) return String(fromUser);
    throw Object.assign(new Error('Authentication / Company context required'), { code: 'UNAUTHENTICATED', statusCode: 401 });
}

// List conversations
router.get('/conversations', async (req: Request, res: Response) => {
    try {
        const companyId = getCompanyId(req);
        const { projectId, platform, isRead, search } = req.query;
        const conversations = await SocialInboxService.listConversations({
            companyId,
            projectId: projectId as string,
            platform: platform as string,
            isRead: isRead !== undefined ? isRead === 'true' : undefined,
            search: search as string
        });
        res.json({ success: true, conversations });
    } catch (error: any) {
        sendRouteError(res, error, 'inbox');
    }
});

// Get conversation details & messages
router.get('/conversations/:id', async (req: Request, res: Response) => {
    try {
        const conversation = await SocialInboxService.getConversation(String(req.params.id));
        res.json({ success: true, conversation });
    } catch (error: any) {
        sendRouteError(res, error, 'inbox');
    }
});

// Send message / reply
router.post('/conversations/:id/messages', async (req: Request, res: Response) => {
    try {
        const { content, senderType } = req.body;
        const message = await SocialInboxService.sendMessage(String(req.params.id), content, senderType);
        res.status(201).json({ success: true, message });
    } catch (error: any) {
        sendRouteError(res, error, 'inbox');
    }
});

// Generate AI Smart Replies based on Brand Voice
router.get('/conversations/:id/ai-suggestions', async (req: Request, res: Response) => {
    try {
        const suggestions = await SocialInboxService.generateAiSmartReplies(String(req.params.id));
        res.json({ success: true, ...suggestions });
    } catch (error: any) {
        sendRouteError(res, error, 'inbox');
    }
});

// 1-Click "Convert to CRM Lead"
router.post('/conversations/:id/convert-to-lead', async (req: Request, res: Response) => {
    try {
        const result = await SocialInboxService.convertToCrmLead(String(req.params.id), getCompanyId(req));
        res.json(result);
    } catch (error: any) {
        sendRouteError(res, error, 'inbox');
    }
});

/**
 * POST /api/v1/social-media/inbox/ai-reply-all/suggestions
 * Generates brand-voice aligned draft responses for all unread conversations in batch
 */
router.post('/ai-reply-all/suggestions', async (req: Request, res: Response) => {
    try {
        const companyId = getCompanyId(req);
        const { projectId, platform, limit } = req.body || {};
        const suggestions = await AiReplyAllService.generateBatchSuggestions(companyId, {
            projectId,
            platform,
            limit: limit ? parseInt(String(limit), 10) : 20,
        });
        res.json({ success: true, count: suggestions.length, suggestions });
    } catch (error: any) {
        sendRouteError(res, error, 'inbox');
    }
});

/**
 * POST /api/v1/social-media/inbox/ai-reply-all/dispatch
 * Dispatches approved batch AI replies with rate-limiting & telemetry
 */
router.post('/ai-reply-all/dispatch', async (req: Request, res: Response) => {
    try {
        const companyId = getCompanyId(req);
        const { replies } = req.body;
        if (!Array.isArray(replies)) {
            return res.status(400).json({ success: false, error: 'Replies array required' });
        }
        const result = await AiReplyAllService.executeBatchReply(companyId, replies);
        res.json({ success: true, ...result });
    } catch (error: any) {
        sendRouteError(res, error, 'inbox');
    }
});

/**
 * POST /api/v1/social-media/inbox/conversations/:id/toggle-agent
 * Toggles autonomous AI Engagement Agent for this conversation thread
 */
router.post('/conversations/:id/toggle-agent', async (req: Request, res: Response) => {
    try {
        const companyId = getCompanyId(req);
        const conv = await (prisma as any).socialConversation.findFirst({ where: { id: String(req.params.id), companyId } });
        if (!conv) {
            return res.status(404).json({ success: false, error: 'Conversation not found' });
        }
        const on = req.body.active !== undefined ? Boolean(req.body.active) : !(conv.aiAgentActive && !conv.isHumanTakeover);
        // Off means a person handles this thread: it must stay off even when the account's AI inbox mode is on.
        const data = on ? { aiAgentActive: true, isHumanTakeover: false } : { aiAgentActive: false, isHumanTakeover: true };
        await (prisma as any).socialConversation.updateMany({ where: { id: String(req.params.id), companyId }, data });
        const updated = { ...conv, ...data };
        res.json({ success: true, aiAgentActive: updated.aiAgentActive, isHumanTakeover: updated.isHumanTakeover });
    } catch (error: any) {
        sendRouteError(res, error, 'inbox');
    }
});

/**
 * POST /api/v1/social-media/inbox/conversations/:id/takeover
 * Human team member takeover: pauses AI agent for this conversation
 */
router.post('/conversations/:id/takeover', async (req: Request, res: Response) => {
    try {
        const companyId = getCompanyId(req);
        const conv = await (prisma as any).socialConversation.findFirst({ where: { id: String(req.params.id), companyId } });
        if (!conv) {
            return res.status(404).json({ success: false, error: 'Conversation not found' });
        }
        const data = {
            isHumanTakeover: true,
        };
        await (prisma as any).socialConversation.updateMany({ where: { id: String(req.params.id), companyId }, data });
        const updated = { ...conv, ...data };
        res.json({ success: true, isHumanTakeover: updated.isHumanTakeover });
    } catch (error: any) {
        sendRouteError(res, error, 'inbox');
    }
});

/**
 * AI inbox per account. GET /ai-settings?projectId= lists accounts with { aiInboxMode, dmSupported };
 * PUT /ai-settings/accounts/:id { mode: off|reply|qualify, instructions? }; PUT /ai-settings/bulk { mode, platform?, projectId? }.
 */
router.get('/ai-settings', async (req: Request, res: Response) => {
    try {
        const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
        res.json({ success: true, accounts: await AiInboxService.listSettings(getCompanyId(req), projectId) });
    } catch (error: any) {
        sendRouteError(res, error, 'inbox');
    }
});

router.put('/ai-settings/bulk', async (req: Request, res: Response) => {
    try {
        res.json({ success: true, ...(await AiInboxService.setModeBulk(getCompanyId(req), req.body || {})) });
    } catch (error: any) {
        sendRouteError(res, error, 'inbox');
    }
});

router.put('/ai-settings/accounts/:id', async (req: Request, res: Response) => {
    try {
        res.json({ success: true, account: await AiInboxService.setAccountMode(getCompanyId(req), String(req.params.id), req.body || {}) });
    } catch (error: any) {
        sendRouteError(res, error, 'inbox');
    }
});

/**
 * POST /api/v1/social-media/inbox/sync
 * Actively pulls DMs and comments from connected platforms (Meta Graph API)
 */
router.post('/sync', async (req: Request, res: Response) => {
    try {
        const companyId = getCompanyId(req);
        const { projectId, platform, includeSample } = req.body || {};
        const result = await SocialInboxService.syncConversations({
            companyId,
            projectId: projectId ? String(projectId) : undefined,
            platform: platform ? String(platform) : undefined,
            includeSample: Boolean(includeSample),
        });
        res.json({ success: true, ...result });
    } catch (error: any) {
        sendRouteError(res, error, 'inbox');
    }
});

/**
 * POST /api/v1/social-media/inbox/test-conversation
 * Seeds a test inbound conversation for verifying inbox UI locally
 */
router.post('/test-conversation', async (req: Request, res: Response) => {
    try {
        const companyId = getCompanyId(req);
        const { projectId, socialAccountId } = req.body || {};
        const result = await SocialInboxService.seedTestConversation(
            companyId,
            projectId ? String(projectId) : undefined,
            socialAccountId ? String(socialAccountId) : undefined
        );
        res.json({ success: true, ...result });
    } catch (error: any) {
        sendRouteError(res, error, 'inbox');
    }
});

export default router;
