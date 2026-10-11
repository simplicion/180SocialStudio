/**
 * Social publish scheduler: a DB-polling worker (no Redis dependency, safe with several backend instances).
 *
 * Each tick:
 *  1. recoverStale()        — variants stuck in `publishing` past their lease → failed / OUTCOME_UNKNOWN
 *  2. reconcileProcessing() — re-check posts the platform is still processing (TikTok)
 *  3. due posts: status scheduled|approved with scheduledFor <= now, plus failed|partially_published posts whose
 *     retry time (nextPublishAttemptAt) has come. Each post is claimed with one conditional UPDATE
 *     (status unchanged AND lease free → status=publishing, lease=now+30m). Postgres re-evaluates the WHERE under
 *     the row lock, so exactly one worker wins even when several poll at once.
 *  Approval gating: posts of projects with approvalRequired publish only when approved; unapproved ones are
 *  skipped and re-checked later (nextPublishAttemptAt pushed out).
 *  Publishing autonomy (brand consciousness `autonomy.publishing`, default MANUAL): under MANUAL, a post created by
 *  an AI agent (metadata.source autopilot / agent / ai / director) is never published by the scheduler until a person
 *  approved it. Posts written or scheduled by a person are unaffected. ASSISTED lets agent posts publish on schedule.
 *
 * Why not BullMQ: Redis is optional in this deployment (REDIS_URL unset disables queues) and a lost Redis would
 * lose scheduled jobs; the database is already the source of truth for scheduledFor.
 */
import { PUBLISHING_AUTONOMY, readBrandConsciousness } from '../brand-consciousness';
import { intEnv } from './config';
import { getDb, timing } from './http';
import { PublishDispatcher, isPostApproved, projectRequiresApproval } from './publish-dispatcher';
import { SocialTokenVault } from './token-vault';

export interface TickResult {
    claimed: string[];
    skippedAwaitingApproval: string[];
    /** Agent-authored posts held because the brand's publishing autonomy is MANUAL and nobody approved them. */
    skippedAutonomy: string[];
    recovered: number;
    reconciled: number;
    errors: Array<{ postId: string; error: string }>;
}

const AGENT_SOURCES = ['autopilot', 'agent', 'ai', 'director', 'agent_os'];

/** True when the post was produced by an AI agent rather than written by a person. */
export function isAgentAuthoredPost(post: any): boolean {
    let m = post?.metadata;
    if (typeof m === 'string') {
        try {
            m = JSON.parse(m);
        } catch {
            m = {};
        }
    }
    return AGENT_SOURCES.includes(String(m?.source || '').toLowerCase());
}

/** The project's `autonomy.publishing` (brand consciousness), or the MANUAL policy default. */
export async function projectPublishingAutonomy(db: any, projectId: string | null, companyId: string): Promise<(typeof PUBLISHING_AUTONOMY)[number]> {
    if (!projectId || !db.brandVoiceProfile) return 'MANUAL';
    const row = await db.brandVoiceProfile.findFirst({ where: { projectId, companyId } });
    return readBrandConsciousness({ id: projectId }, row).autonomy.publishing;
}

export class SocialPublishScheduler {
    private static timer: NodeJS.Timeout | null = null;
    private static running = false;

    static async tick(opts: { batchSize?: number } = {}): Promise<TickResult> {
        const db = getDb();
        const result: TickResult = { claimed: [], skippedAwaitingApproval: [], skippedAutonomy: [], recovered: 0, reconciled: 0, errors: [] };
        result.recovered = await PublishDispatcher.recoverStale().catch(() => 0);
        result.reconciled = await PublishDispatcher.reconcileProcessing().catch(() => 0);
        await SocialTokenVault.proactiveRefreshExpiringTokens().catch(() => ({ refreshed: 0, failed: 0 }));
        // 180 Engagement: replay comment/DM automations that were deferred by the per-account rate limit.
        await require('../engagement/engagement-dispatcher').EngagementDispatcher.retryDeferred().catch((e: any) => result.errors.push({ postId: "engagement-retry", error: String(e?.message || e) }));
        // 180 Engagement: poll LinkedIn comments for automated like/reply engagement and lead ingestion.
        await require('../engagement/linkedin-comment-poller').LinkedInCommentPoller.pollActivePosts().catch((e: any) => {
            console.warn('[SocialScheduler] LinkedIn comment poller error:', e?.message || e);
        });

        const now = new Date(timing.now());
        const due = await db.socialPost.findMany({
            where: {
                OR: [
                    { status: { in: ['scheduled', 'approved'] }, scheduledFor: { lte: now }, OR: [{ nextPublishAttemptAt: null }, { nextPublishAttemptAt: { lte: now } }] },
                    { status: { in: ['failed', 'partially_published'] }, nextPublishAttemptAt: { lte: now } },
                ],
            },
            orderBy: { scheduledFor: 'asc' },
            take: opts.batchSize ?? intEnv('SOCIAL_SCHEDULER_BATCH', 20),
        });

        for (const post of due) {
            try {
                const isRetry = post.status === 'failed' || post.status === 'partially_published';
                if (!isRetry) {
                    const project = post.projectId ? await db.project.findFirst({ where: { id: post.projectId, companyId: post.companyId } }) : null;
                    if (projectRequiresApproval(project) && !isPostApproved(post)) {
                        await db.socialPost.updateMany({
                            where: { id: post.id, status: post.status },
                            data: { nextPublishAttemptAt: new Date(timing.now() + intEnv('SOCIAL_APPROVAL_RECHECK_MS', 5 * 60 * 1000)) },
                        });
                        result.skippedAwaitingApproval.push(post.id);
                        continue;
                    }
                    // Autonomy: an agent-authored post needs a person's approval when the brand says MANUAL.
                    if (isAgentAuthoredPost(post) && !isPostApproved(post) && (await projectPublishingAutonomy(db, post.projectId, post.companyId)) === 'MANUAL') {
                        await db.socialPost.updateMany({
                            where: { id: post.id, status: post.status },
                            data: {
                                nextPublishAttemptAt: new Date(timing.now() + intEnv('SOCIAL_APPROVAL_RECHECK_MS', 5 * 60 * 1000)),
                                errorMessage: JSON.stringify({ autonomy: 'Publishing autonomy is MANUAL: approve this AI-created post (or switch the brand to ASSISTED) to publish it.' }),
                            },
                        });
                        result.skippedAutonomy.push(post.id);
                        continue;
                    }
                }
                const leaseUntil = new Date(timing.now() + intEnv('SOCIAL_PUBLISH_LEASE_MS', 30 * 60 * 1000));
                const claim = await db.socialPost.updateMany({
                    where: { id: post.id, status: post.status, OR: [{ publishLeaseUntil: null }, { publishLeaseUntil: { lt: new Date(timing.now()) } }] },
                    data: {
                        status: 'publishing',
                        publishLeaseUntil: leaseUntil,
                        nextPublishAttemptAt: null,
                        ...(isPostApproved(post) && post.approvedVersion == null ? { approvedVersion: post.versionNumber } : {}),
                    },
                });
                if (claim.count !== 1) continue; // another worker took it
                result.claimed.push(post.id);
                await PublishDispatcher.publishPost(post.id, { companyId: post.companyId, trigger: 'scheduler', claimed: true, onlyRetryable: isRetry });
            } catch (e: any) {
                result.errors.push({ postId: post.id, error: e?.message || String(e) });
                // Never leave a claimed post locked: record the failure and release it.
                await db.socialPost
                    .updateMany({ where: { id: post.id, status: 'publishing' }, data: { status: 'failed', publishLeaseUntil: null, errorMessage: JSON.stringify({ scheduler: e?.message || String(e) }) } })
                    .catch(() => null);
            }
        }
        return result;
    }

    /** Starts polling every SOCIAL_SCHEDULER_INTERVAL_MS (default 30s). Idempotent. */
    static start(opts: { intervalMs?: number; log?: (msg: string) => void } = {}) {
        if (this.timer) return;
        const interval = opts.intervalMs ?? intEnv('SOCIAL_SCHEDULER_INTERVAL_MS', 30_000);
        const log = opts.log ?? ((m: string) => console.log(m));
        const run = async () => {
            if (this.running) return;
            this.running = true;
            try {
                const r = await this.tick();
                if (r.claimed.length || r.recovered || r.reconciled || r.errors.length) {
                    log(`[SocialPublishScheduler] published=${r.claimed.length} recovered=${r.recovered} reconciled=${r.reconciled} errors=${r.errors.length}`);
                }
            } catch (e: any) {
                log(`[SocialPublishScheduler] tick failed: ${e?.message || e}`);
            } finally {
                this.running = false;
            }
        };
        this.timer = setInterval(run, interval);
        this.timer.unref?.();
        void run();
        log(`[SocialPublishScheduler] polling every ${Math.round(interval / 1000)}s`);
    }

    static stop() {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
    }
}
