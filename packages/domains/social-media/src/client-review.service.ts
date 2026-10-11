import { requestContext } from '@workspace/db';
import crypto from 'crypto';
import { getDb } from './publishing/http';
import { SocialDomainError, notFound, requireCompanyId } from './tenant-scope';
import { MAX_REVIEW_LINK_DAYS, REVIEWABLE_STATUSES, assertReviewLinkUsable, reviewLinkState } from './post-guards';

export interface CreateReviewSessionDTO {
    clientId: string;
    projectId?: string;
    name: string;
    startDate: Date | string;
    endDate: Date | string;
    postIds?: string[];
    expiresInDays?: number;
}

const MAX_COMMENT_CHARS = 5000;
const invalidLink = () => new SocialDomainError('REVIEW_LINK_INVALID', 404, 'This review link is not valid.');

/**
 * Tokenized client review links. The agency side is tenant-scoped by the JWT company; the public side is scoped by
 * the session the token resolves to, and every public action re-checks that the link is neither expired nor revoked.
 */
export class ClientReviewService {
    /** Posts a session covers: this company + client (+ project), scheduled inside the window. */
    private static sessionPostScope(session: any) {
        return {
            companyId: session.companyId,
            clientId: session.clientId,
            ...(session.projectId ? { projectId: session.projectId } : {}),
            scheduledFor: { gte: session.startDate, lte: session.endDate },
        };
    }

    /**
     * Agency generates a tokenized review session for their client
     */
    static async createReviewSession(data: CreateReviewSessionDTO) {
        const companyId = requireCompanyId(requestContext.getStore()?.companyId as string);
        const db = getDb();
        if (!data?.clientId || !data?.name) throw new SocialDomainError('VALIDATION_FAILED', 400, 'clientId and name are required.');
        const startDate = new Date(data.startDate);
        const endDate = new Date(data.endDate);
        if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate < startDate) {
            throw new SocialDomainError('VALIDATION_FAILED', 400, 'Give a valid review window (endDate on or after startDate).');
        }
        const client = await db.client.findFirst({ where: { id: data.clientId, companyId } });
        if (!client) throw notFound('Client');
        if (data.projectId) {
            const project = await db.project.findFirst({ where: { id: data.projectId, companyId } });
            if (!project) throw notFound('Project');
        }

        const days = Math.min(Math.max(1, Number(data.expiresInDays) || 14), MAX_REVIEW_LINK_DAYS);
        const token = crypto.randomBytes(24).toString('hex');
        const expiresAt = new Date(Date.now() + days * 24 * 3600 * 1000);

        const session = await db.clientReviewSession.create({
            data: {
                companyId,
                clientId: data.clientId,
                projectId: data.projectId,
                token,
                name: data.name,
                startDate,
                endDate,
                expiresAt,
                status: 'pending',
            },
        });

        // If postIds were specified, move them into review (only this company's, only not-yet-published ones).
        if (data.postIds && data.postIds.length > 0) {
            await db.socialPost.updateMany({
                where: { id: { in: data.postIds }, companyId, status: { in: REVIEWABLE_STATUSES } },
                data: { status: 'in_review' },
            });
        }

        return {
            ...session,
            linkState: reviewLinkState(session),
            publicReviewUrl: `/review/${token}`,
        };
    }

    /** Agency: review sessions of this company (optionally one project / client), newest first, with link state. */
    static async listSessions(filters: { projectId?: string; clientId?: string } = {}) {
        const companyId = requireCompanyId(requestContext.getStore()?.companyId as string);
        const sessions = await getDb().clientReviewSession.findMany({
            where: {
                companyId,
                ...(filters.projectId ? { projectId: String(filters.projectId) } : {}),
                ...(filters.clientId ? { clientId: String(filters.clientId) } : {}),
            },
            orderBy: { createdAt: 'desc' },
            take: 100,
        });
        return sessions.map((s: any) => ({ ...s, linkState: reviewLinkState(s) }));
    }

    /** Agency: withdraw a link immediately (e.g. sent to the wrong person). Idempotent. */
    static async revokeSession(sessionId: string, userId?: string) {
        const companyId = requireCompanyId(requestContext.getStore()?.companyId as string);
        const db = getDb();
        const session = await db.clientReviewSession.findFirst({ where: { id: sessionId, companyId } });
        if (!session) throw notFound('Review session');
        if (session.status !== 'revoked') {
            const note = `Link revoked${userId ? ` by user ${userId}` : ''} at ${new Date().toISOString()}`;
            await db.clientReviewSession.updateMany({
                where: { id: sessionId, companyId },
                data: { status: 'revoked', clientNotes: session.clientNotes ? `${session.clientNotes}\n${note}` : note },
            });
        }
        const updated = await db.clientReviewSession.findFirst({ where: { id: sessionId, companyId } });
        return { ...updated, linkState: 'revoked' as const };
    }

    private static async sessionForToken(token: string) {
        if (!token || typeof token !== 'string') throw invalidLink();
        const session = await getDb().clientReviewSession.findFirst({ where: { token } });
        if (!session) throw invalidLink();
        assertReviewLinkUsable(session);
        return session;
    }

    /**
     * Public endpoint: retrieve review session and its posts by token (NO LOGIN REQUIRED)
     */
    static async getReviewSessionByToken(token: string) {
        const db = getDb();
        const base = await this.sessionForToken(token);
        const session = await db.clientReviewSession.findFirst({
            where: { id: base.id, companyId: base.companyId },
            include: {
                client: { select: { id: true, name: true } },
                project: { select: { id: true, name: true } },
                company: { select: { id: true, name: true } },
                comments: { orderBy: { createdAt: 'desc' } },
            },
        });

        const posts = await db.socialPost.findMany({
            where: this.sessionPostScope(base),
            include: {
                variants: true,
                reviewComments: { orderBy: { createdAt: 'asc' } },
            },
            orderBy: { scheduledFor: 'asc' },
        });

        return { session, posts };
    }

    /**
     * Public: comment on one post of the session. The post must be inside the session (same company, client, project
     * and window) and the author is always the client: the token holder cannot post as the agency.
     */
    static async addPostComment(token: string, postId: string, commentText: string, authorName?: string) {
        const db = getDb();
        const session = await this.sessionForToken(token);
        const text = String(commentText || '').trim();
        if (!postId || !text) throw new SocialDomainError('VALIDATION_FAILED', 400, 'postId and commentText are required.');
        if (text.length > MAX_COMMENT_CHARS) {
            throw new SocialDomainError('VALIDATION_FAILED', 400, `Comments are limited to ${MAX_COMMENT_CHARS} characters.`);
        }
        const post = await db.socialPost.findFirst({ where: { id: String(postId), ...this.sessionPostScope(session) } });
        if (!post) throw notFound('Post');

        const comment = await db.postReviewComment.create({
            data: {
                sessionId: session.id,
                postId: post.id,
                authorName: String(authorName || 'Client Reviewer').slice(0, 120),
                authorType: 'client',
                commentText: text,
                resolved: false,
            },
        });

        await db.clientReviewSession.updateMany({ where: { id: session.id, companyId: session.companyId }, data: { status: 'revisions_requested' } });
        const history = Array.isArray(post.history) ? post.history : [];
        await db.socialPost.updateMany({
            where: { id: post.id, companyId: session.companyId },
            data: {
                history: [
                    ...history,
                    { version: post.versionNumber, action: 'client_comment', sessionId: session.id, author: comment.authorName, timestamp: new Date().toISOString() },
                ],
            },
        });

        return comment;
    }

    /**
     * Client clicks "Approve Entire Calendar". Approves only posts still in a review state (never published, publishing
     * or failed ones), pins each approval to the version the client saw and records it in the post history (audit
     * trail). `seenVersions` ({postId: versionNumber}) lets the portal refuse when the agency edited a post after the
     * page loaded, so a client never approves content they have not seen.
     */
    static async batchApproveSession(token: string, clientNotes?: string, seenVersions?: Record<string, number>) {
        const db = getDb();
        const session = await this.sessionForToken(token);

        const posts: any[] = await db.socialPost.findMany({ where: { ...this.sessionPostScope(session), status: { in: REVIEWABLE_STATUSES } }, take: 500 });
        if (seenVersions && typeof seenVersions === 'object') {
            const stale = posts.filter((p) => seenVersions[p.id] != null && Number(seenVersions[p.id]) !== (p.versionNumber || 1));
            if (stale.length) {
                throw new SocialDomainError('REVIEW_STALE', 409, 'Some posts changed after you opened this page. Reload to review the latest versions.', {
                    postIds: stale.map((p) => p.id),
                });
            }
        }

        const now = new Date().toISOString();
        let approved = 0;
        for (const p of posts) {
            const version = p.versionNumber || 1;
            const history = Array.isArray(p.history) ? p.history : [];
            const r = await db.socialPost.updateMany({
                // versionNumber in the filter: an edit landing between the read and this write is not approved.
                where: { id: p.id, companyId: session.companyId, versionNumber: p.versionNumber, status: { in: REVIEWABLE_STATUSES } },
                data: {
                    status: 'approved',
                    approvedVersion: version,
                    history: [...history, { version, action: 'approved', by: 'client_review', sessionId: session.id, timestamp: now }],
                },
            });
            approved += r.count;
        }

        await db.clientReviewSession.updateMany({
            where: { id: session.id, companyId: session.companyId },
            data: { status: 'approved', clientNotes: clientNotes ? String(clientNotes).slice(0, 5000) : 'Approved by client' },
        });
        const updatedSession = await db.clientReviewSession.findFirst({ where: { id: session.id, companyId: session.companyId } });

        return {
            success: true,
            approvedCount: approved,
            message: approved
                ? `${approved} post${approved === 1 ? '' : 's'} approved.`
                : 'Nothing to approve: every post in this window is already approved or published.',
            session: updatedSession,
        };
    }
}
