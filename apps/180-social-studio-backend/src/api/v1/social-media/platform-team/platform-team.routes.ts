/**
 * Platform Team endpoints. Mounted at /api/v1/social-media/platform-team/:platform
 * (platform = instagram | linkedin | youtube | x | twitter | facebook | tiktok).
 *
 *   GET  /spec              craft rules for the platform (fold, hashtag cap, playbook)
 *   GET  /overview?projectId=   monitoring: accounts, pipeline, queue craft scores, triaged inbox, live metrics
 *   POST /hooks/score       {hook | hooks[], spoken?}                 deterministic
 *   POST /beat-sheet        {script, targetSeconds?}                  deterministic
 *   POST /copy/lint         {caption, keywords?, title?}              deterministic
 *   POST /thread            {text}                                    deterministic (X thread split)
 *   POST /humanize          {text}                                    deterministic
 *   POST /profile/audit     {handle, displayName?, bio?, ...}         deterministic
 *   POST /outliers          {records[]}                               deterministic
 *   POST /comments/triage   {comments[], keywords?}                   deterministic
 *   POST /posts/audit       {views, medianViews?, reach?, ...}        deterministic
 *   GET  /posts/outliers?projectId=      own posts ranked by multiple of the account median (stored metrics)
 *   POST /posts/refresh-metrics {projectId, force?}   read fresh numbers from the platform, re-rank, update memory
 *   GET  /radar?projectId=  PUT /radar {projectId, handles[]}  POST /radar/scan {projectId}   competitor radar
 *   POST /replies/draft     {projectId, conversationId}               AI reply drafts for a triaged conversation
 *   POST /draft             {idea, format?, projectId?, ...}          AI (503 AI_NOT_CONFIGURED without a key)
 *   POST /repurpose         {text, projectId?}                        AI
 *
 * Tenant = the authenticated user's company (req.user); it is never read from headers, body or query.
 */
import { Router, Request, Response } from 'express';
import type { PlatformTeamService } from '@workspace/social-media';

const defaultService = (): PlatformTeamService => require('@workspace/social-media').getPlatformTeamService();
const parsePlatform = (raw: unknown) => require('@workspace/social-media').parsePlatform(raw);

function sendError(res: Response, err: any) {
    // SocialDomainError / AutopilotError carry statusCode; PublishError (provider, token vault) carries httpStatus.
    const status = err?.statusCode ?? err?.httpStatus;
    if (err?.code && status) {
        return res.status(status).json({ success: false, code: err.code, error: err.message, ...(err.details ? { details: err.details } : {}) });
    }
    console.error('[platform-team.routes] unexpected error', err);
    return res.status(500).json({ success: false, code: 'INTERNAL', error: 'Unexpected error' });
}

const companyOf = (req: Request) => (req as any).user?.companyId;

export function createPlatformTeamRouter(getService: () => PlatformTeamService = defaultService) {
    const router = Router({ mergeParams: true });

    const handle = (fn: (ctx: { req: Request; platform: any; companyId: string; svc: PlatformTeamService }) => unknown | Promise<unknown>) =>
        async (req: Request, res: Response) => {
            try {
                const companyId = companyOf(req);
                if (!companyId) return res.status(401).json({ success: false, code: 'UNAUTHORIZED', error: 'Company context required' });
                const data = await fn({ req, platform: parsePlatform(req.params.platform), companyId, svc: getService() });
                res.json({ success: true, data });
            } catch (err) {
                sendError(res, err);
            }
        };

    router.get('/spec', handle(({ svc, platform }) => svc.spec(platform)));
    router.get('/overview', handle(({ svc, platform, companyId, req }) => svc.overview(platform, { companyId, projectId: String(req.query.projectId || '') })));

    router.post('/hooks/score', handle(({ svc, platform, req }) => svc.scoreHooks(platform, req.body)));
    router.post('/beat-sheet', handle(({ svc, platform, req }) => svc.beatSheet(platform, req.body)));
    router.post('/copy/lint', handle(({ svc, platform, req }) => svc.lintCopy(platform, req.body)));
    router.post('/thread', handle(({ svc, req }) => svc.thread(req.body)));
    router.post('/humanize', handle(({ svc, req }) => svc.humanize(req.body)));
    router.post('/profile/audit', handle(({ svc, platform, req }) => svc.auditProfile(platform, req.body)));
    router.post('/outliers', handle(({ svc, req }) => svc.outliers(req.body)));
    router.post('/comments/triage', handle(({ svc, req }) => svc.triage(req.body)));
    router.post('/posts/audit', handle(({ svc, platform, req }) => svc.auditPost(platform, req.body)));

    // Own post metrics: stored numbers from each platform's API, ranked against the account's own median.
    router.get('/posts/outliers', handle(({ svc, platform, companyId, req }) => svc.ownOutliers(platform, { companyId, projectId: String(req.query.projectId || '') })));
    router.post('/posts/refresh-metrics', handle(({ svc, platform, companyId, req }) => svc.refreshMetrics(platform, { companyId, projectId: String(req.body?.projectId || ''), force: req.body?.force === true })));

    // Competitor radar through official APIs (Instagram business discovery, YouTube Data API, X API).
    router.get('/radar', handle(({ svc, platform, companyId, req }) => svc.radar(platform, { companyId, projectId: String(req.query.projectId || '') })));
    router.put('/radar', handle(({ svc, platform, companyId, req }) => svc.setRadar(platform, { companyId, projectId: String(req.body?.projectId || ''), handles: req.body?.handles })));
    router.post('/radar/scan', handle(({ svc, platform, companyId, req }) => svc.scanRadar(platform, { companyId, projectId: String(req.body?.projectId || '') })));

    // AI reply drafts for one triaged inbox conversation (drafts only; sending stays in the inbox).
    router.post('/replies/draft', handle(({ svc, platform, companyId, req }) => svc.draftReplies(platform, { companyId, projectId: String(req.body?.projectId || ''), conversationId: String(req.body?.conversationId || '') })));

    router.post('/draft', handle(({ svc, platform, companyId, req }) => svc.draft(platform, { companyId, projectId: req.body?.projectId ? String(req.body.projectId) : undefined, body: req.body })));
    router.post('/repurpose', handle(({ svc, platform, companyId, req }) => svc.repurpose(platform, { companyId, projectId: req.body?.projectId ? String(req.body.projectId) : undefined, body: req.body })));

    return router;
}

export default createPlatformTeamRouter();
