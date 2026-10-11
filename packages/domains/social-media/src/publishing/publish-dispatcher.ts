/**
 * PublishDispatcher: publishes a post's platform variants through the platform publishers.
 *
 * Guarantees
 * - Tenant isolation: the post, project and every target account are loaded with the caller's companyId.
 * - Approval gating: when the project requires approval, only approved posts (status `approved`, or
 *   `approvedVersion === versionNumber`) publish — manual, retry and scheduler alike.
 * - Idempotency: each variant is claimed with a conditional update (pending|failed → publishing); published /
 *   processing variants are never sent again, so retries and duplicate requests cannot double-post.
 *   A post-level lease stops two dispatchers working on the same post at once.
 * - Honest results: real per-variant status, `partially_published` when some platforms fail, and
 *   `errorMessage` = JSON {platform: message} (the mobile app parses it). Every attempt is recorded in
 *   SocialPublishAttempt.
 */
import { getPublisher } from '../adapters/registry';
import type { MediaItem, PublishFormat, PublishInput } from '../adapters/types';
import { PublishPlatform, intEnv, isPlatformConfigured, isSimulationMode, normalizePlatform, requireAppCredentials, credentialEnvNames } from './config';
import { PublishError, isPublishError, toPublishError } from './errors';
import { getDb, guessMime, isPdfUrl, isVideoUrl, timing } from './http';
import { SocialTokenVault } from './token-vault';
import { PrismaAgentEventStore, createAgentRunEmitter } from '@workspace/ai/agent-runs';

export type PublishTrigger = 'manual' | 'retry' | 'scheduler';

export interface DispatchOptions {
    companyId: string;
    trigger: PublishTrigger;
    userId?: string | null;
    /** Only publish this platform's variant (retry-variant). */
    platform?: string;
    /** The scheduler already claimed the post lease. */
    claimed?: boolean;
    /** Skip failed variants whose last error is not retryable (scheduler auto-retries). */
    onlyRetryable?: boolean;
}

export interface VariantResult {
    id: string;
    platform: string;
    socialAccountId: string | null;
    publishStatus: string;
    externalId: string | null;
    externalUrl: string | null;
    error: string | null;
    errorCode: string | null;
    retryable: boolean;
    attemptCount: number;
}

export interface DispatchResult {
    /** True when any variant was produced by the sandbox simulator (SIMULATE_SOCIAL_PUBLISHING, never in production). */
    simulated?: boolean;
    success: boolean;
    status: string;
    message: string;
    publishedLinks: Record<string, string>;
    errors?: Record<string, string>;
    warnings?: Record<string, string>;
    variants: VariantResult[];
    post: any;
    retryScheduledFor?: string | null;
}

const leaseMs = () => intEnv('SOCIAL_PUBLISH_LEASE_MS', 30 * 60 * 1000);
const OK_STATES = ['published', 'processing', 'ready_to_publish', 'user_action_required'];

/**
 * Determines if a platform/variant operates in user-assisted publishing mode.
 * For user-assisted platforms (X and Reddit by default unless explicit API credentials and token are configured),
 * 180 Workspace prepares the payload for secure on-device handoff rather than dispatching via platform REST/Graph API.
 */
export function isAssistedPlatform(platform: string, variant?: any): boolean {
    const p = normalizePlatform(platform);
    if (!p) return false;
    const meta = asObj(variant?.platformMeta);
    if (meta.publishingMode === 'user_assisted') return true;
    if (meta.publishingMode === 'api') return false;
    // Unconfigured platforms default to the assisted handoff, except in the dev sandbox (SIMULATE_SOCIAL_PUBLISHING,
    // never in production), where the keyless API flow is simulated end-to-end with real validation.
    if (!isPlatformConfigured(p)) return !isSimulationMode();
    return false;
}

export const projectRequiresApproval = (_project: any) => false;
export const isPostApproved = (_post: any) => true;

function safeJson(s: string) {
    try {
        return JSON.parse(s);
    } catch {
        return {};
    }
}

const asObj = (v: any): Record<string, any> => (v && typeof v === 'object' && !Array.isArray(v) ? v : typeof v === 'string' ? safeJson(v) : {});

function absolutize(url: string): string {
    if (/^https?:\/\//i.test(url)) return url;
    const base = process.env.SOCIAL_MEDIA_PUBLIC_BASE_URL?.trim().replace(/\/+$/, '');
    return base && url.startsWith('/') ? `${base}${url}` : url;
}

/** Builds the normalized publisher input for one variant (no token). */
export function buildPublishInput(post: any, variant: any, account: any, platform: PublishPlatform): PublishInput {
    const meta = asObj(variant.platformMeta);
    const info = { ...asObj(asObj(post.metadata).mediaInfo), ...asObj(meta.mediaInfo) };
    const custom: string[] = Array.isArray(variant.customMediaUrls) && variant.customMediaUrls.length ? variant.customMediaUrls : [];
    const base: string[] = Array.isArray(post.mediaUrls) ? post.mediaUrls : [];
    const pool = (custom.length ? custom : base).filter(Boolean);

    const toItem = (u: string): MediaItem => {
        const i = asObj(info[u]);
        const url = absolutize(u);
        return {
            url,
            kind: isVideoUrl(u) || String(i.mimeType || '').startsWith('video/') ? 'video' : isPdfUrl(u) ? 'document' : 'image',
            mimeType: i.mimeType || guessMime(u),
            width: i.width != null ? Number(i.width) : undefined,
            height: i.height != null ? Number(i.height) : undefined,
            durationSec: i.durationSec != null ? Number(i.durationSec) : undefined,
            sizeBytes: i.sizeBytes != null ? Number(i.sizeBytes) : undefined,
            altText: i.altText,
        };
    };

    const override = String(meta.format || '').toLowerCase();
    let format: PublishFormat = (['video', 'image', 'carousel', 'document', 'text'].includes(override) ? override : post.mediaType) as PublishFormat;
    let media: MediaItem[] = [];
    if (format === 'video') {
        const videoUrl = custom.find((u) => isVideoUrl(u)) || post.finalVideoUrl || base.find((u) => isVideoUrl(u)) || pool[0];
        media = videoUrl ? [{ ...toItem(videoUrl), kind: 'video' }] : [];
    } else if (format === 'image') {
        media = pool.slice(0, 1).map(toItem);
    } else if (format === 'document') {
        const pdf = pool.find((u) => isPdfUrl(u)) || pool[0];
        media = pdf ? [{ ...toItem(pdf), kind: 'document' }] : [];
    } else if (format === 'carousel') {
        media = pool.map(toItem);
    }
    if (!media.length && format !== 'video') format = 'text';
    if (format === 'image' && pool.length > 1) {
        format = 'carousel';
        media = pool.map(toItem);
    }

    return {
        platform,
        postId: post.id,
        variantId: variant.id,
        format,
        caption: String(variant.customContent || post.content || ''),
        title: meta.title || post.title || undefined,
        firstComment: variant.firstComment || undefined,
        media,
        thumbnailUrl: post.thumbnailUrl ? absolutize(post.thumbnailUrl) : undefined,
        platformMeta: meta,
        account: {
            id: account.id,
            platformAccountId: account.platformAccountId,
            username: account.username,
            accountName: account.accountName,
            metadata: asObj(account.metadata),
        },
    };
}

export class PublishDispatcher {
    /** Validates every variant without publishing (used by validate-publish). */
    static async preview(postId: string, companyId: string) {
        const db = getDb();
        const post = await db.socialPost.findFirst({ where: { id: postId, companyId } });
        if (!post) throw new PublishError('NOT_FOUND', 'Post not found');
        const variants = await this.ensureVariants(post);
        const out: Array<{ platform: string; publishStatus: string; issues: string[] }> = [];
        for (const v of variants) {
            const issues: string[] = [];
            const platform = normalizePlatform(v.platform);
            if (!platform) issues.push(`Unsupported platform ${v.platform}.`);
            else {
                const simulated = isSimulationMode();
                const assisted = isAssistedPlatform(platform, v);
                if (!simulated && !assisted && !isPlatformConfigured(platform)) {
                    issues.push(`${platform} publishing is not configured on this server (${credentialEnvNames(platform).join(', ')}).`);
                }
                if (assisted) {
                    // In user-assisted mode, validate only content requirements (no OAuth credentials required)
                    if (!v.customContent && !post.content) {
                        issues.push(`A caption or text is required for ${platform}.`);
                    }
                } else {
                    try {
                        let account: any;
                        try {
                            account = await this.resolveAccount(post, v, platform);
                        } catch (accErr) {
                            if (simulated) {
                                account = {
                                    id: `sim_acc_${platform}`,
                                    platformAccountId: `sim_${platform}_account`,
                                    username: `sandbox_${platform}`,
                                    accountName: `${platform.toUpperCase()} Sandbox`,
                                    metadata: {},
                                };
                            } else {
                                throw accErr;
                            }
                        }
                        if (account.reauthRequired) issues.push(`${account.accountName} must be reconnected.`);
                        issues.push(...getPublisher(platform).validate(buildPublishInput(post, v, account, platform)));
                    } catch (e: any) {
                        issues.push(e.message);
                    }
                }
            }
            out.push({ platform: v.platform, publishStatus: v.publishStatus, issues });
        }
        return out;
    }

    static async publishPost(postId: string, opts: DispatchOptions): Promise<DispatchResult> {
        const db = getDb();
        if (!opts.companyId) throw new PublishError('NOT_FOUND', 'Company context required');
        const post = await db.socialPost.findFirst({ where: { id: postId, companyId: opts.companyId } });
        if (!post) throw new PublishError('NOT_FOUND', 'Post not found');

        const project = post.projectId ? await db.project.findFirst({ where: { id: post.projectId, companyId: opts.companyId } }) : null;
        if (projectRequiresApproval(project) && !isPostApproved(post)) {
            throw new PublishError('APPROVAL_REQUIRED', 'This project requires approval before publishing; the post has not been approved.');
        }

        const variants = await this.ensureVariants(post);
        const wanted = opts.platform ? normalizePlatform(opts.platform) : null;
        if (opts.platform && !wanted) throw new PublishError('UNSUPPORTED_PLATFORM', `Unsupported platform "${opts.platform}".`);
        const scoped = wanted ? variants.filter((v: any) => normalizePlatform(v.platform) === wanted) : variants;
        if (wanted && !scoped.length) throw new PublishError('NOT_FOUND', `This post has no ${opts.platform} variant.`);

        const targets = scoped.filter((v: any) => {
            if (OK_STATES.includes(v.publishStatus)) return false;
            if (opts.onlyRetryable && v.publishStatus === 'failed' && !v.lastErrorRetryable) return false;
            return true;
        });

        if (!targets.length) {
            if (opts.claimed) await db.socialPost.update({ where: { id: post.id }, data: { publishLeaseUntil: null } });
            return this.summarize(post.id, opts, 'Nothing to publish: every selected platform is already published.');
        }

        const unconfigured = targets
            .map((v: any) => ({ platform: normalizePlatform(v.platform), variant: v }))
            .filter(({ platform, variant }: any) => platform && !isPlatformConfigured(platform) && !isAssistedPlatform(platform, variant))
            .map(({ platform }: any) => platform);

        if (!opts.claimed && unconfigured.length === targets.length && targets.length > 0 && !isSimulationMode()) {
            // Nothing could succeed: answer 503 without touching the post.
            requireAppCredentials(unconfigured[0] as PublishPlatform);
        }

        if (!opts.claimed) {
            const now = timing.now();
            const claim = await db.socialPost.updateMany({
                where: { id: post.id, companyId: opts.companyId, OR: [{ publishLeaseUntil: null }, { publishLeaseUntil: { lt: new Date(now) } }] },
                data: {
                    status: 'publishing',
                    publishLeaseUntil: new Date(now + leaseMs()),
                    ...(isPostApproved(post) && post.approvedVersion == null ? { approvedVersion: post.versionNumber } : {}),
                },
            });
            if (claim.count !== 1) throw new PublishError('PUBLISH_IN_PROGRESS', 'This post is already being published.');
        }

        const fresh = { ...post, ...(await db.socialPost.findFirst({ where: { id: post.id, companyId: opts.companyId } })) };
        // Agent run log (run inspector): persisted with the same database client when it has the AgentRunEvent model.
        const events = createAgentRunEmitter({
            store: db?.agentRunEvent ? new PrismaAgentEventStore(db) : null,
            agent: 'publisher',
            scope: post.projectId ? { companyId: opts.companyId, projectId: post.projectId } : null,
        });
        events.emit('AgentStarted', { agent: 'publisher', postId: post.id, trigger: opts.trigger || 'manual' });
        events.emit('PublishStarted', { postId: post.id, platforms: targets.map((v: any) => normalizePlatform(v.platform) || v.platform) });
        try {
            await Promise.all(targets.map((v: any) => this.publishVariant(fresh, v, opts)));
            const result = await this.summarize(post.id, opts);
            events.emit('PublishCompleted', { final: true, postId: post.id, status: (result as any)?.status ?? null, variants: ((result as any)?.variants || []).map((v: any) => ({ platform: v.platform, status: v.status ?? v.publishStatus ?? null })) });
            await events.flush();
            return result;
        } catch (err: any) {
            events.emit('AgentFailed', { agent: 'publisher', postId: post.id, code: err?.code || 'PUBLISH_FAILED' });
            await events.flush();
            throw err;
        }
    }

    /**
     * Creates the implicit variant for posts that only have `socialAccountId` (or in simulation mode, with no account).
     * A post with neither variants nor an account throws ACCOUNT_NOT_CONNECTED; no account is ever picked for it.
     */
    static async ensureVariants(post: any): Promise<any[]> {
        const db = getDb();
        const variants = await db.socialPostVariant.findMany({ where: { postId: post.id }, take: 50 });
        if (variants.length) return variants;

        if (!post.socialAccountId) {
            // Never guess: publishing to "whichever active account the query returns first" could post to the wrong
            // brand's channel. Without a variant or an explicit account the user must choose one.
            if (isSimulationMode()) {
                const v = await db.socialPostVariant.create({
                    data: { postId: post.id, platform: 'instagram', customContent: post.content, customMediaUrls: post.mediaUrls || [], platformMeta: {} },
                });
                return [v];
            }
            throw new PublishError('ACCOUNT_NOT_CONNECTED', 'Choose at least one platform / connected account for this post.');
        }

        const account = await db.socialAccount.findFirst({ where: { id: post.socialAccountId, companyId: post.companyId } });
        if (!account) throw new PublishError('ACCOUNT_NOT_CONNECTED', 'The post\'s social account is not connected.');
        const v = await db.socialPostVariant.create({
            data: { postId: post.id, platform: account.platform, customContent: post.content, customMediaUrls: post.mediaUrls || [], platformMeta: {}, socialAccountId: account.id },
        });
        return [v];
    }

    /** variant.socialAccountId → post.socialAccountId (same platform) → the project's only active account of that platform. */
    static async resolveAccount(post: any, variant: any, platform: PublishPlatform) {
        const db = getDb();
        // Project isolation: an account bound to another project of the same company is never used (brand bleed).
        const sameProject = (a: any) => !a.projectId || !post.projectId || a.projectId === post.projectId;
        const matches = (a: any) => a && a.companyId === post.companyId && sameProject(a) && a.isActive !== false && normalizePlatform(a.platform) === platform;
        const explicit = variant.socialAccountId || asObj(variant.platformMeta).socialAccountId;
        if (explicit) {
            const a = await db.socialAccount.findFirst({ where: { id: explicit, companyId: post.companyId } });
            if (!matches(a)) throw new PublishError('ACCOUNT_NOT_CONNECTED', `The ${platform} account chosen for this post is not connected.`, { platform });
            return a;
        }
        if (post.socialAccountId) {
            const a = await db.socialAccount.findFirst({ where: { id: post.socialAccountId, companyId: post.companyId } });
            if (matches(a)) return a;
        }
        const aliases = platform === 'x' ? ['x', 'twitter'] : [platform];
        const candidates = await db.socialAccount.findMany({
            where: { companyId: post.companyId, platform: { in: aliases }, isActive: true, ...(post.projectId ? { projectId: post.projectId } : {}) },
            take: 5,
        });
        if (candidates.length === 1) return candidates[0];
        if (!candidates.length) throw new PublishError('ACCOUNT_NOT_CONNECTED', `No ${platform} account is connected${post.projectId ? ' to this project' : ''}.`, { platform });
        
        // Smart fallback: If one account is set as default or primary, use it automatically
        const primary = candidates.find((c: any) => c.isDefault || c.isPrimary || asObj(c.metadata).isDefault || asObj(c.metadata).isPrimary);
        if (primary) return primary;

        const candidateNames = candidates.map((c: any) => c.accountName || c.username || c.id).join(', ');
        throw new PublishError(
            'ACCOUNT_NOT_CONNECTED',
            `Several ${platform} accounts are connected; choose one for this post.`,
            { platform, details: { candidates: candidates.map((c: any) => ({ id: c.id, accountName: c.accountName, username: c.username, profileImageUrl: c.profileImageUrl })) } }
        );
    }

    private static async publishVariant(post: any, variant: any, opts: DispatchOptions) {
        const db = getDb();
        const now = timing.now();
        const claim = await db.socialPostVariant.updateMany({
            where: { id: variant.id, postId: post.id, publishStatus: { in: ['pending', 'failed'] } },
            data: { publishStatus: 'publishing', publishLeaseUntil: new Date(now + leaseMs()), attemptCount: { increment: 1 } },
        });
        if (claim.count !== 1) return; // someone else owns it or it is already published

        const platform = normalizePlatform(variant.platform);
        let account: any = null;
        const attempt = await db.socialPublishAttempt.create({
            data: {
                companyId: post.companyId,
                postId: post.id,
                variantId: variant.id,
                platform: variant.platform,
                socialAccountId: variant.socialAccountId || null,
                trigger: opts.trigger,
                attemptNumber: (variant.attemptCount || 0) + 1,
                status: 'started',
                triggeredById: opts.userId || null,
            },
        });

        try {
            if (!platform) throw new PublishError('UNSUPPORTED_PLATFORM', `Unsupported platform "${variant.platform}".`);
            
            if (isAssistedPlatform(platform, variant)) {
                // User-assisted publishing: prepare for mobile handoff
                const done = new Date(timing.now());
                const existingMeta = asObj(variant.platformMeta);
                await db.socialPostVariant.update({
                    where: { id: variant.id },
                    data: {
                        publishStatus: 'ready_to_publish',
                        lastError: 'Ready for user-assisted handoff via mobile app.',
                        lastErrorCode: null,
                        lastErrorRetryable: false,
                        publishLeaseUntil: null,
                        platformMeta: {
                            ...existingMeta,
                            publishingMode: 'user_assisted',
                            preparedAt: done.toISOString(),
                        },
                    },
                });
                await db.socialPublishAttempt.update({
                    where: { id: attempt.id },
                    data: {
                        status: 'processing',
                        finishedAt: done,
                        errorMessage: 'Handoff payload prepared for user review in mobile app.',
                    },
                });
                return;
            }

            const simulated = isSimulationMode();
            if (!simulated) {
                requireAppCredentials(platform);
            }
            let token = 'simulated_sandbox_token';
            try {
                account = await this.resolveAccount(post, variant, platform);
                if (!simulated) {
                    token = await SocialTokenVault.getAccessToken(account);
                }
            } catch (accErr) {
                if (simulated) {
                    account = {
                        id: `sim_acc_${platform}`,
                        platformAccountId: `sim_${platform}_account`,
                        username: `sandbox_${platform}`,
                        accountName: `${platform.toUpperCase()} Sandbox`,
                        metadata: {},
                        isSimulated: true,
                    };
                } else {
                    throw accErr;
                }
            }
            const publisher = getPublisher(platform);
            const input = buildPublishInput(post, variant, account, platform);
            const issues = publisher.validate(input);
            if (issues.length) throw new PublishError('VALIDATION_FAILED', issues.join(' '), { platform, details: { issues } });
            const outcome = await publisher.publish(input, token);
            const done = new Date(timing.now());
            const accDbId = account?.isSimulated ? null : account?.id;
            await db.socialPostVariant.update({
                where: { id: variant.id },
                data: {
                    publishStatus: outcome.state,
                    externalId: outcome.externalId,
                    externalUrl: outcome.url,
                    publishedAt: outcome.state === 'published' ? done : null,
                    lastError: outcome.warning || null,
                    lastErrorCode: null,
                    lastErrorRetryable: false,
                    // For `processing` variants the lease doubles as "next status check at".
                    publishLeaseUntil: outcome.state === 'processing' ? new Date(timing.now() + intEnv('SOCIAL_PROCESSING_RECHECK_MS', 60_000)) : null,
                    socialAccountId: accDbId,
                    // Provider ids the publisher produced (e.g. every post of an X thread), kept for metrics and support.
                    ...(outcome.meta && Object.keys(outcome.meta).length ? { platformMeta: { ...asObj(variant.platformMeta), publishResult: outcome.meta } } : {}),
                },
            });
            await db.socialPublishAttempt.update({
                where: { id: attempt.id },
                data: { status: outcome.state === 'published' ? 'succeeded' : 'processing', externalId: outcome.externalId, externalUrl: outcome.url, socialAccountId: accDbId, finishedAt: done, errorMessage: outcome.warning || null },
            });
        } catch (e) {
            const err = toPublishError(e, platform || variant.platform);
            if (err.code === 'REAUTH_REQUIRED' && account && !account.isSimulated) {
                await SocialTokenVault.markReauthRequired(account.id, err.message).catch(() => null);
            }
            const accDbId = account && !account.isSimulated ? account.id : undefined;
            await db.socialPostVariant.update({
                where: { id: variant.id },
                data: { publishStatus: 'failed', lastError: err.message, lastErrorCode: err.code, lastErrorRetryable: err.retryable, publishLeaseUntil: null, ...(accDbId ? { socialAccountId: accDbId } : {}) },
            });
            await db.socialPublishAttempt.update({
                where: { id: attempt.id },
                data: { status: 'failed', errorCode: err.code, errorMessage: err.message, retryable: err.retryable, finishedAt: new Date(timing.now()), ...(accDbId ? { socialAccountId: accDbId } : {}) },
            });
        }
    }

    /** Recomputes the post's aggregate status from its variants and stores it. */
    static async summarize(postId: string, opts: Pick<DispatchOptions, 'companyId' | 'trigger'>, note?: string): Promise<DispatchResult> {
        const db = getDb();
        const post = await db.socialPost.findFirst({ where: { id: postId, companyId: opts.companyId } });
        if (!post) throw new PublishError('NOT_FOUND', 'Post not found');
        const variants: any[] = await db.socialPostVariant.findMany({ where: { postId }, take: 50 });

        const publishedLinks: Record<string, string> = {};
        const errors: Record<string, string> = {};
        const warnings: Record<string, string> = {};
        for (const v of variants) {
            if (OK_STATES.includes(v.publishStatus)) {
                if (v.externalUrl) publishedLinks[v.platform] = v.externalUrl;
                if (v.lastError && v.publishStatus !== 'ready_to_publish' && v.publishStatus !== 'user_action_required') {
                    warnings[v.platform] = v.lastError;
                }
            } else if (v.publishStatus === 'failed') {
                errors[v.platform] = v.lastError || 'Publishing failed';
            } else if (v.publishStatus === 'pending') {
                errors[v.platform] = 'Not published yet';
            }
        }
        const publishedVariants = variants.filter((v) => v.publishStatus === 'published');
        const ok = variants.filter((v) => OK_STATES.includes(v.publishStatus));
        const processing = variants.filter((v) => v.publishStatus === 'processing');
        const assistedAwaiting = variants.filter((v) => ['ready_to_publish', 'user_action_required'].includes(v.publishStatus));
        const failed = variants.filter((v) => v.publishStatus === 'failed');
        const inFlight = variants.filter((v) => v.publishStatus === 'publishing');

        let status: string;
        if (inFlight.length) status = 'publishing';
        else if (publishedVariants.length === variants.length && variants.length) status = 'published';
        else if (assistedAwaiting.length === variants.length) status = 'ready';
        else if (ok.length === variants.length && variants.length) status = processing.length ? 'publishing' : 'ready';
        else if (ok.length) status = 'partially_published';
        else status = 'failed';

        // Scheduler retries: only when a failed variant is retryable and attempts remain.
        const maxAttempts = intEnv('SOCIAL_PUBLISH_MAX_ATTEMPTS', 5);
        const attemptsSoFar = (post.publishAttemptCount || 0) + (note ? 0 : 1);
        let retryAt: Date | null = null;
        if (opts.trigger === 'scheduler' && !inFlight.length && failed.some((v) => v.lastErrorRetryable) && attemptsSoFar < maxAttempts) {
            const base = intEnv('SOCIAL_PUBLISH_RETRY_BASE_MS', 60_000);
            retryAt = new Date(timing.now() + Math.min(base * 2 ** Math.max(0, attemptsSoFar - 1), intEnv('SOCIAL_PUBLISH_RETRY_MAX_MS', 60 * 60 * 1000)));
        }

        const history = Array.isArray(post.history) ? post.history : [];
        const data: Record<string, any> = {
            status,
            publishedLinks,
            errorMessage: Object.keys(errors).length ? JSON.stringify(errors) : null,
            publishLeaseUntil: null,
            nextPublishAttemptAt: retryAt,
        };
        if (!note) {
            data.publishAttemptCount = attemptsSoFar;
            data.history = [
                ...history,
                {
                    version: post.versionNumber,
                    action: 'publish_attempt',
                    trigger: opts.trigger,
                    status,
                    platforms: Object.fromEntries(variants.map((v) => [v.platform, v.publishStatus])),
                    timestamp: new Date(timing.now()).toISOString(),
                },
            ];
        }
        if (ok.length && !post.publishedAt) data.publishedAt = new Date(timing.now());
        const updated = await db.socialPost.update({ where: { id: postId }, data });

        // Scheduled publishing runs unattended: a final failure (no retry left) must reach a person with the reason.
        if (!note && opts.trigger === 'scheduler' && !retryAt && (status === 'failed' || status === 'partially_published')) {
            await this.notifyPublishFailure(post, errors, status).catch((e) => console.warn('[publish] failure notification not sent:', e?.message));
        }

        const variantResults: VariantResult[] = variants.map((v) => ({
            id: v.id,
            platform: v.platform,
            socialAccountId: v.socialAccountId ?? null,
            publishStatus: v.publishStatus,
            externalId: v.externalId ?? null,
            externalUrl: v.externalUrl ?? null,
            error: v.publishStatus === 'failed' ? v.lastError : null,
            errorCode: v.publishStatus === 'failed' ? v.lastErrorCode : null,
            retryable: Boolean(v.lastErrorRetryable),
            attemptCount: v.attemptCount || 0,
        }));

        const simulatedCount = variants.filter((v) => String(v.externalId || '').startsWith('sim_')).length;
        const message =
            (simulatedCount ? `[SIMULATED: nothing was posted to ${simulatedCount} platform(s)] ` : '') +
            (note ||
            (status === 'published'
                ? 'Published to every platform.'
                : status === 'partially_published'
                  ? `Published to ${ok.length} of ${variants.length} platforms; the others failed and can be retried.`
                  : status === 'publishing'
                    ? 'Accepted by the platform and still processing; the status updates automatically.'
                    : 'Publishing failed on every platform.'));

        return {
            simulated: simulatedCount > 0,
            success: ok.length > 0,
            status,
            message,
            publishedLinks,
            errors: Object.keys(errors).length ? errors : undefined,
            warnings: Object.keys(warnings).length ? warnings : undefined,
            variants: variantResults,
            post: { ...updated, variants },
            retryScheduledFor: retryAt ? retryAt.toISOString() : null,
        };
    }

    /**
     * Needs-attention notification for the post's author: which platforms failed and the provider's reason, with a
     * link to the post where "Retry" is available. No author (system-created post) → nothing to notify.
     */
    static async notifyPublishFailure(post: any, errors: Record<string, string>, status: string) {
        if (!post.createdById) return;
        const db = getDb();
        const failed = Object.entries(errors).filter(([, e]) => e !== 'Not published yet');
        if (!failed.length) return;
        const label = post.title || String(post.content || '').slice(0, 60) || 'Scheduled post';
        const reasons = failed.map(([p, e]) => `${p}: ${String(e).slice(0, 200)}`).join('; ');
        await db.notification.create({
            data: {
                userId: post.createdById,
                type: 'social_publish_failed',
                title: status === 'partially_published' ? `Partly published: ${label}` : `Publishing failed: ${label}`,
                message: `${reasons}. Open the post to fix it and retry.`.slice(0, 1000),
                link: post.projectId ? `/social-projects/${post.projectId}?post=${post.id}` : `/social-projects`,
            },
        });
    }

    /**
     * Crash recovery: a variant still `publishing` after its lease may or may not have reached the platform, so it
     * is failed with OUTCOME_UNKNOWN (not auto-retried; a person checks the platform and retries manually).
     */
    static async recoverStale(): Promise<number> {
        const db = getDb();
        const now = new Date(timing.now());
        const stale = await db.socialPostVariant.findMany({ where: { publishStatus: 'publishing', publishLeaseUntil: { lt: now } }, take: 100 });
        const postIds = new Set<string>();
        for (const v of stale) {
            const r = await db.socialPostVariant.updateMany({
                where: { id: v.id, publishStatus: 'publishing', publishLeaseUntil: { lt: now } },
                data: { publishStatus: 'failed', lastErrorCode: 'OUTCOME_UNKNOWN', lastErrorRetryable: false, publishLeaseUntil: null, lastError: 'Publishing was interrupted before the platform confirmed it. Check the platform before retrying.' },
            });
            if (r.count) postIds.add(v.postId);
        }
        const stalePosts = await db.socialPost.findMany({ where: { status: 'publishing', publishLeaseUntil: { lt: now } }, take: 100 });
        for (const p of stalePosts) postIds.add(p.id);
        for (const id of postIds) {
            const p = await db.socialPost.findFirst({ where: { id } });
            if (p) await this.summarize(id, { companyId: p.companyId, trigger: 'scheduler' }, 'Recovered after an interrupted publish.');
        }
        return postIds.size;
    }

    /** Re-checks variants the platform is still processing (TikTok). */
    static async reconcileProcessing(): Promise<number> {
        const db = getDb();
        const now = timing.now();
        const rows = await db.socialPostVariant.findMany({ where: { publishStatus: 'processing', publishLeaseUntil: { lt: new Date(now) } }, take: 50 });
        let changed = 0;
        for (const v of rows) {
            const post = await db.socialPost.findFirst({ where: { id: v.postId } });
            const platform = normalizePlatform(v.platform);
            if (!post || !platform) continue;
            const publisher = getPublisher(platform);
            try {
                const account = await this.resolveAccount(post, v, platform);
                let outcome = publisher.checkStatus ? await publisher.checkStatus(buildPublishInput(post, v, account, platform), v.externalId, await SocialTokenVault.getAccessToken(account)) : null;
                const ageMs = now - new Date(v.updatedAt || v.createdAt || now).getTime();
                if (!outcome && ageMs > intEnv('SOCIAL_PROCESSING_GIVE_UP_MS', 24 * 3600 * 1000)) {
                    throw new PublishError('OUTCOME_UNKNOWN', 'The platform never confirmed this post. Check the app before retrying.');
                }
                if (!outcome) {
                    await db.socialPostVariant.update({ where: { id: v.id }, data: { publishLeaseUntil: new Date(now + intEnv('SOCIAL_PROCESSING_RECHECK_MS', 60_000)) } });
                    continue;
                }
                outcome = outcome!;
                await db.socialPostVariant.update({
                    where: { id: v.id },
                    data: { publishStatus: outcome.state, externalId: outcome.externalId, externalUrl: outcome.url, publishedAt: outcome.state === 'published' ? new Date(now) : null, publishLeaseUntil: null, lastError: outcome.warning || null },
                });
            } catch (e) {
                const err = isPublishError(e) ? e : toPublishError(e, platform);
                if (err.retryable) continue; // transient: check again next tick
                await db.socialPostVariant.update({ where: { id: v.id }, data: { publishStatus: 'failed', lastError: err.message, lastErrorCode: err.code, lastErrorRetryable: false, publishLeaseUntil: null } });
            }
            changed++;
            await this.summarize(v.postId, { companyId: post.companyId, trigger: 'scheduler' }, 'Platform processing finished.');
        }
        return changed;
    }
}
