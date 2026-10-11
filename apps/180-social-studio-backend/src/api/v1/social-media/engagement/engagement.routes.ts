import { Router, Request, Response } from 'express';
import { EngagementRuleService, EngagementMatcher, InboundEngagementEvent, SocialDomainError } from '@workspace/social-media';
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
 * GET /api/v1/social-media/engagement/rules
 * List engagement automation rules for the tenant
 */
router.get('/rules', async (req: Request, res: Response) => {
    try {
        const companyId = getCompanyId(req);
        const { projectId, socialAccountId, status, postId } = req.query;
        const rules = await EngagementRuleService.listRules(companyId, {
            projectId: projectId as string,
            socialAccountId: socialAccountId as string,
            postId: typeof postId === 'string' ? postId : undefined,
            status: status as any,
        });
        res.json({ success: true, rules });
    } catch (error: any) {
        sendRouteError(res, error, 'engagement');
    }
});

/**
 * POST /api/v1/social-media/engagement/rules
 * Create a new engagement rule (e.g. comment-to-DM, auto-like, keyword trigger)
 */
router.post('/rules', async (req: Request, res: Response) => {
    try {
        const companyId = getCompanyId(req);
        const rule = await EngagementRuleService.createRule(companyId, req.body);
        res.status(201).json({ success: true, rule });
    } catch (error: any) {
        sendRouteError(res, error, 'engagement');
    }
});

/**
 * GET /api/v1/social-media/engagement/rules/:id
 * Retrieve a specific engagement rule
 */
router.get('/rules/:id', async (req: Request, res: Response) => {
    try {
        const companyId = getCompanyId(req);
        const rule = await EngagementRuleService.getRule(companyId, String(req.params.id));
        if (!rule) {
            return res.status(404).json({ success: false, error: 'Rule not found' });
        }
        res.json({ success: true, rule });
    } catch (error: any) {
        sendRouteError(res, error, 'engagement');
    }
});

/**
 * PUT /api/v1/social-media/engagement/rules/:id
 * Update an existing engagement rule
 */
router.put('/rules/:id', async (req: Request, res: Response) => {
    try {
        const companyId = getCompanyId(req);
        const rule = await EngagementRuleService.updateRule(companyId, String(req.params.id), req.body);
        res.json({ success: true, rule });
    } catch (error: any) {
        sendRouteError(res, error, 'engagement');
    }
});

/**
 * DELETE /api/v1/social-media/engagement/rules/:id
 * Delete an engagement rule
 */
router.delete('/rules/:id', async (req: Request, res: Response) => {
    try {
        const companyId = getCompanyId(req);
        const result = await EngagementRuleService.deleteRule(companyId, String(req.params.id));
        res.json({ success: true, ...result });
    } catch (error: any) {
        sendRouteError(res, error, 'engagement');
    }
});

/**
 * PATCH /api/v1/social-media/engagement/rules/:id/toggle
 * Toggle rule status between active and paused
 */
router.patch('/rules/:id/toggle', async (req: Request, res: Response) => {
    try {
        const companyId = getCompanyId(req);
        const rule = await EngagementRuleService.toggleRule(companyId, String(req.params.id));
        res.json({ success: true, rule });
    } catch (error: any) {
        sendRouteError(res, error, 'engagement');
    }
});

/**
 * GET /api/v1/social-media/engagement/stats
 * Aggregate engagement telemetry: rules count, triggers, DMs sent, comments liked
 */
router.get('/stats', async (req: Request, res: Response) => {
    try {
        const companyId = getCompanyId(req);
        const stats = await EngagementRuleService.getEngagementStats(
            companyId,
            req.query.projectId as string | undefined
        );
        res.json({ success: true, stats });
    } catch (error: any) {
        sendRouteError(res, error, 'engagement');
    }
});

/**
 * POST /api/v1/social-media/engagement/test-match
 * Simulation utility: test whether a sample comment or DM matches any configured rules
 */
router.post('/test-match', async (req: Request, res: Response) => {
    try {
        const companyId = getCompanyId(req);
        const event: InboundEngagementEvent = {
            ...req.body,
            companyId,
        };
        const matchingRule = await EngagementMatcher.findMatchingRule(event);
        res.json({
            success: true,
            matched: Boolean(matchingRule),
            rule: matchingRule,
        });
    } catch (error: any) {
        sendRouteError(res, error, 'engagement');
    }
});

export default router;
