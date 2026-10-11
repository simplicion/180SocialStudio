import { Router } from 'express';
import savedBanksRoutes from './saved-banks/saved-banks.routes';
import contentCalendarRoutes from './content-calendar/content-calendar.routes';
import socialPostRoutes from './posts/social-post.routes';
import socialAccountRoutes from './accounts/social-account.routes';
import brandVoiceRoutes from './brand-voice/brand-voice.routes';
import socialInboxRoutes from './inbox/social-inbox.routes';
import evergreenQueueRoutes from './evergreen/evergreen-queue.routes';
import socialAssetsRoutes from './assets/social-assets.routes';
import socialProjectRoutes from './projects/social-project.routes';
import calendarPieceRoutes from './calendar-pieces/calendar-piece.routes';
import autopilotRoutes from './autopilot/autopilot.routes';
import creativeRoutes from './creative/creative.routes';
import engagementRoutes from './engagement/engagement.routes';
import agentOsRoutes from './projects/agent-os.routes';
import managerRoutes from './manager/manager.routes';
import studioLibraryRoutes from './library/studio-library.routes';
import socialBillingRoutes from './billing/social-billing.routes';
import platformTeamRoutes from './platform-team/platform-team.routes';

const router = Router();

// Creator billing & recharge routes
router.use('/billing', socialBillingRoutes);

// Platform Team: craft tools, AI drafting and monitoring for Instagram / LinkedIn / YouTube / X / Facebook
router.use('/platform-team/:platform', platformTeamRoutes);

// Autopilot (WS2) is mounted before the generic project routes so /projects/:id/autopilot/* reaches it.
router.use('/projects/:id/autopilot', autopilotRoutes);
// Creative engine (WS3): carousels / static posts, also before the generic project routes.
router.use('/projects/:id/creative', creativeRoutes);
// Social OS: run inspector, media index/search, agent memory (/projects/:id/agent-runs, /media-*, /agent-memory).
router.use('/projects/:id', agentOsRoutes);
router.use('/projects', socialProjectRoutes);
router.use('/saved-banks', savedBanksRoutes);
router.use('/assets', socialAssetsRoutes);
router.use('/content-calendar', contentCalendarRoutes);
router.use('/posts', socialPostRoutes);
router.use('/calendar-pieces', calendarPieceRoutes);
router.use('/accounts', socialAccountRoutes);
router.use('/brand-voice', brandVoiceRoutes);
router.use('/inbox', socialInboxRoutes);
router.use('/evergreen', evergreenQueueRoutes);
router.use('/engagement', engagementRoutes);
router.use('/manager', managerRoutes);
router.use('/library', studioLibraryRoutes);

export default router;
