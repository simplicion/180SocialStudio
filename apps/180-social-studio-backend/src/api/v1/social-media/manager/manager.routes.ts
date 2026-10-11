import { Router, Request, Response } from 'express';
import {
    ManagerOrchestratorService,
    CalendarSubagent,
    InboxSubagent,
    AnalyticsSubagent,
    DirectorSubagent,
    VideoIntelligenceService,
    SocialDomainError,
} from '@workspace/social-media';
import { sendRouteError } from '../route-errors';
import { requestContext } from '@workspace/db';

const router = Router();

function getCompanyId(req: Request): string {
    const fromContext = requestContext.getStore()?.companyId;
    if (fromContext) return String(fromContext);
    const fromUser = (req as any).user?.companyId;
    if (fromUser) return String(fromUser);
    throw new SocialDomainError('UNAUTHENTICATED', 401, 'Authentication / Company context required');
}

/**
 * POST /api/v1/social-media/manager/chat
 * Primary conversational endpoint for 180 Manager Agent.
 */
router.post('/chat', async (req: Request, res: Response) => {
    try {
        const companyId = getCompanyId(req);
        const { message, projectId, conversationId, attachedAssetUrl } = req.body;
        if (!message || typeof message !== 'string') {
            return res.status(400).json({ success: false, error: 'message is required' });
        }
        const outcome = await ManagerOrchestratorService.handleUserChat(companyId, {
            message,
            projectId,
            conversationId,
            attachedAssetUrl,
        });
        res.json({ success: true, ...outcome });
    } catch (error: any) {
        sendRouteError(res, error, 'manager');
    }
});

/**
 * GET /api/v1/social-media/manager/conversations?projectId=
 * The caller's 180 Manager conversations, newest first.
 */
router.get('/conversations', async (req: Request, res: Response) => {
    try {
        const companyId = getCompanyId(req);
        const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
        res.json({ success: true, conversations: await ManagerOrchestratorService.listConversations(companyId, projectId) });
    } catch (error: any) {
        sendRouteError(res, error, 'manager');
    }
});

/**
 * GET /api/v1/social-media/manager/conversations/:id/messages
 * Transcript of one conversation (404 for another workspace's conversation).
 */
router.get('/conversations/:id/messages', async (req: Request, res: Response) => {
    try {
        const companyId = getCompanyId(req);
        res.json({ success: true, messages: await ManagerOrchestratorService.getMessages(companyId, String(req.params.id)) });
    } catch (error: any) {
        sendRouteError(res, error, 'manager');
    }
});

/**
 * POST /api/v1/social-media/manager/actions/execute
 * Executes an actionable suggestion proposed by 180 Manager (e.g. calendar pivot, director rule).
 */
router.post('/actions/execute', async (req: Request, res: Response) => {
    try {
        const companyId = getCompanyId(req);
        const { action } = req.body;
        if (!action || !action.type) {
            return res.status(400).json({ success: false, error: 'Valid action payload required' });
        }
        const outcome = await ManagerOrchestratorService.executeAction(companyId, action);
        res.json({ success: true, result: outcome });
    } catch (error: any) {
        sendRouteError(res, error, 'manager');
    }
});

/**
 * GET /api/v1/social-media/manager/calendar-status
 * Date-aware calendar status inspection (past vs upcoming days).
 */
router.get('/calendar-status', async (req: Request, res: Response) => {
    try {
        const companyId = getCompanyId(req);
        const { projectId } = req.query;
        if (!projectId || typeof projectId !== 'string') {
            return res.status(400).json({ success: false, error: 'projectId is required' });
        }
        const status = await CalendarSubagent.getCalendarStatus(companyId, projectId);
        res.json({ success: true, status });
    } catch (error: any) {
        sendRouteError(res, error, 'manager');
    }
});

/**
 * GET /api/v1/social-media/manager/inbox-opportunities
 * Discovers high-intent deals and leads across all connected social DMs.
 */
router.get('/inbox-opportunities', async (req: Request, res: Response) => {
    try {
        const companyId = getCompanyId(req);
        const { projectId, platform, limit } = req.query;
        const opportunities = await InboxSubagent.findOpportunities(companyId, {
            projectId: projectId as string,
            platform: platform as string,
            limit: limit ? Number(limit) : 10,
        });
        res.json({ success: true, opportunities });
    } catch (error: any) {
        sendRouteError(res, error, 'manager');
    }
});

/**
 * GET /api/v1/social-media/manager/analytics-summary
 * Aggregates cross-account performance and winning video formats.
 */
router.get('/analytics-summary', async (req: Request, res: Response) => {
    try {
        const companyId = getCompanyId(req);
        const { projectId } = req.query;
        const summary = await AnalyticsSubagent.getCrossAccountSummary(companyId, projectId as string);
        res.json({ success: true, summary });
    } catch (error: any) {
        sendRouteError(res, error, 'manager');
    }
});

/**
 * POST /api/v1/social-media/manager/video-intel
 * Evaluates video traits (hook score, visual hook, speech transcript, pacing) with multimodal AI.
 */
router.post('/video-intel', async (req: Request, res: Response) => {
    try {
        const companyId = getCompanyId(req);
        const { projectId, postId, assetUrl, captionOrTitle, speechTranscript, durationSec, cutsPerMinute } = req.body;
        if (!projectId) {
            return res.status(400).json({ success: false, error: 'projectId is required' });
        }
        const traits = await VideoIntelligenceService.analyzeVideoTraits(companyId, projectId, {
            postId,
            assetUrl,
            captionOrTitle,
            speechTranscript,
            durationSec,
            cutsPerMinute,
        });
        res.json({ success: true, traits });
    } catch (error: any) {
        sendRouteError(res, error, 'manager');
    }
});

export default router;
