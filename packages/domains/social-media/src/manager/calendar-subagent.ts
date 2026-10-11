import { getDb } from '../publishing/http';
import { CalendarPivotProposal } from './types';
import { requireCompanyId, SocialDomainError } from '../tenant-scope';

export class CalendarSubagent {
    /**
     * Inspects current month's calendar status, separating past completed posts from upcoming slots.
     */
    static async getCalendarStatus(companyId: string, projectId: string, referenceDate: Date = new Date()) {
        requireCompanyId(companyId);
        const startOfMonth = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1);
        const endOfMonth = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, 0, 23, 59, 59);
        const currentDay = referenceDate.getDate();

        const posts = await (getDb() as any).socialPost.findMany({
            where: {
                companyId,
                projectId,
                scheduledFor: {
                    gte: startOfMonth,
                    lte: endOfMonth,
                },
            },
            orderBy: { scheduledFor: 'asc' },
            include: {
                socialAccount: { select: { platform: true, username: true } },
            },
        });

        const pastPosts: any[] = [];
        const upcomingPosts: any[] = [];

        for (const post of posts) {
            const postDate = new Date(post.scheduledFor);
            if (postDate.getDate() < currentDay || post.status === 'published') {
                pastPosts.push(post);
            } else {
                upcomingPosts.push(post);
            }
        }

        return {
            currentDay,
            totalPostsThisMonth: posts.length,
            pastCount: pastPosts.length,
            upcomingCount: upcomingPosts.length,
            pastPosts: pastPosts.map((p) => ({
                id: p.id,
                title: p.title,
                scheduledFor: p.scheduledFor,
                status: p.status,
                platform: p.socialAccount?.platform || 'instagram',
            })),
            upcomingPosts: upcomingPosts.map((p) => ({
                id: p.id,
                title: p.title,
                scheduledFor: p.scheduledFor,
                status: p.status,
                platform: p.socialAccount?.platform || 'instagram',
            })),
        };
    }

    /**
     * Date range a pivot would cover: from `fromDay` (never before today) to the end of the month. Days before it
     * are never touched. Slot content is written by the calendar agents, not here.
     */
    static planCalendarPivot(
        companyId: string,
        projectId: string,
        options: { fromDay?: number; newWinningFormat: string; pivotReason: string },
        now: Date = new Date(),
    ): CalendarPivotProposal {
        requireCompanyId(companyId);
        const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        const requested = Math.floor(Number(options.fromDay) || now.getDate());
        const fromDay = Math.min(lastDayOfMonth, Math.max(now.getDate(), requested));
        return {
            projectId,
            pivotReason: options.pivotReason,
            fromDay,
            toDay: lastDayOfMonth,
            targetMonth: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
            newWinningFormat: options.newWinningFormat,
            proposedSlots: [],
        };
    }

    /**
     * Applies a pivot: rewrites this month's upcoming autopilot pieces (from `fromDay`, never before today) with the
     * calendar agents, one piece at a time. Pieces already shot, in review or published are never touched. At most
     * [MAX_PIVOT_PIECES] per action; the rest are reported so the user can run it again.
     */
    static async executeCalendarPivot(
        companyId: string,
        projectId: string,
        proposal: CalendarPivotProposal,
        deps: { regenerate?: PivotRegenerate; now?: Date } = {},
    ): Promise<CalendarPivotResult> {
        requireCompanyId(companyId);
        const format = String(proposal.newWinningFormat || '').trim().slice(0, 120);
        if (!format) throw new SocialDomainError('VALIDATION_FAILED', 400, 'Say which format or angle the remaining pieces should use.');
        const db = getDb() as any;
        const now = deps.now || new Date();
        const from = new Date(now.getFullYear(), now.getMonth(), proposal.fromDay);
        const to = new Date(now.getFullYear(), now.getMonth(), proposal.toDay, 23, 59, 59);
        const calendars = await db.contentCalendar.findMany({ where: { companyId, projectId, status: 'active' }, select: { id: true } });
        if (!calendars.length) throw new SocialDomainError('NO_ACTIVE_CALENDAR', 404, 'This project has no active content calendar to update.');
        const pieces = await db.calendarContentPiece.findMany({
            where: {
                companyId,
                calendarId: { in: calendars.map((c: any) => c.id) },
                status: { in: PIVOTABLE_STATUSES },
                dateScheduled: { gte: from, lte: to },
            },
            orderBy: { dateScheduled: 'asc' },
            select: { id: true, headline: true, dateScheduled: true },
        });
        const regenerate: PivotRegenerate =
            deps.regenerate ||
            (async (params) => {
                const { getAutopilotCalendarService } = await import('../autopilot-calendar.service');
                return getAutopilotCalendarService().regeneratePiece(params);
            });
        const instruction =
            `Calendar pivot requested in the 180 Manager (${String(proposal.pivotReason || '').slice(0, 200)}): ` +
            `rework this piece around "${format}" while keeping its day, platform and pillar.`;
        const updated: Array<{ pieceId: string; headline: string }> = [];
        const failed: Array<{ pieceId: string; error: string }> = [];
        for (const p of pieces.slice(0, MAX_PIVOT_PIECES)) {
            try {
                const r: any = await regenerate({ companyId, projectId, pieceId: p.id, instruction });
                updated.push({ pieceId: p.id, headline: r?.piece?.headline || p.headline });
            } catch (err: any) {
                failed.push({ pieceId: p.id, error: String(err?.message || err).slice(0, 200) });
            }
        }
        return { fromDay: proposal.fromDay, toDay: proposal.toDay, format, updated, failed, remaining: Math.max(0, pieces.length - MAX_PIVOT_PIECES) };
    }
}

/** Piece statuses a pivot may rewrite (nothing shot, in review or published). */
export const PIVOTABLE_STATUSES = ['ready', 'in_progress'];
export const MAX_PIVOT_PIECES = 12;
export type PivotRegenerate = (params: { companyId: string; projectId: string; pieceId: string; instruction: string }) => Promise<unknown>;
export interface CalendarPivotResult {
    fromDay: number;
    toDay: number;
    format: string;
    updated: Array<{ pieceId: string; headline: string }>;
    failed: Array<{ pieceId: string; error: string }>;
    /** Matching pieces beyond the per-action cap (run the pivot again for them). */
    remaining: number;
}
