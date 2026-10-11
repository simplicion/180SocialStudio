import { prisma, requestContext } from '@workspace/db';
import { PublishDispatcher, isPostApproved, projectRequiresApproval } from './publishing/publish-dispatcher';
import { getDb } from './publishing/http';
import { SAFE_ACCOUNT_SELECT, SocialDomainError, notFound, pieceScope, requireCompanyId } from './tenant-scope';
import { BrandSafetyAuditor, BrandSafetyAuditResult } from './brand-safety-auditor';
import { SmartTimezoneScheduler, ScheduleCollisionCheckResult } from './smart-timezone-scheduler';
import { PlatformMediaGuard, MediaValidationResult } from './media-platform-guard';
import { getProjectBrandConsciousness } from './brand-consciousness';
import { findDuplicateCaptions, hasSubstantiveChange, parseScheduledFor, sanitizePostUpdate } from './post-guards';

export interface PostVariantInput {
    platform: 'instagram' | 'facebook' | 'linkedin' | 'tiktok' | 'youtube' | 'twitter' | 'x' | 'threads' | 'pinterest' | 'reddit' | string;
    customContent: string;
    customMediaUrls?: string[];
    firstComment?: string;
    platformMeta?: Record<string, any>;
    /** Connected account to publish this variant with (defaults to the post's / project's account of this platform). */
    socialAccountId?: string;
}

export interface CreateSocialPostDTO {
    title?: string;
    content: string;
    mediaUrls?: string[];
    rawMediaUrls?: string[];
    externalStorageLinks?: Array<{ url: string; provider: string; label?: string }>;
    finalVideoUrl?: string;
    thumbnailUrl?: string;
    mediaType?: 'video' | 'image' | 'carousel' | 'document';
    scheduledFor?: Date | string;
    projectId?: string;
    clientId?: string;
    calendarId?: string;
    calendarPieceId?: string;
    socialAccountId?: string;
    variants?: PostVariantInput[];
    metadata?: Record<string, any>;
    isEvergreen?: boolean;
}

const APPROVAL_PENDING_ISSUE = 'Project workflow requires client/editorial approval before publishing.';

export class SocialPostService {
    static async createPost(data: CreateSocialPostDTO, userId?: string) {
        const companyId = requestContext.getStore()?.companyId as string;
        if (!companyId) throw new SocialDomainError('UNAUTHENTICATED', 401, 'Company context required');
        const scheduledFor = parseScheduledFor(data.scheduledFor);

        const post = await (prisma as any).socialPost.create({
            data: {
                companyId,
                clientId: data.clientId,
                projectId: data.projectId,
                calendarId: data.calendarId,
                calendarPieceId: data.calendarPieceId,
                socialAccountId: data.socialAccountId,
                createdById: userId,
                title: data.title,
                content: data.content,
                mediaUrls: data.mediaUrls || [],
                rawMediaUrls: data.rawMediaUrls || [],
                externalStorageLinks: data.externalStorageLinks || [],
                finalVideoUrl: data.finalVideoUrl,
                thumbnailUrl: data.thumbnailUrl,
                mediaType: data.mediaType || 'video',
                status: scheduledFor ? 'scheduled' : 'draft',
                scheduledFor: scheduledFor ?? null,
                isEvergreen: data.isEvergreen || false,
                versionNumber: 1,
                metadata: data.metadata || {},
                history: [
                    {
                        version: 1,
                        action: 'created',
                        userId,
                        timestamp: new Date().toISOString()
                    }
                ],
                variants: data.variants && data.variants.length > 0 ? {
                    create: data.variants.map(v => ({
                        platform: v.platform,
                        customContent: v.customContent || data.content,
                        customMediaUrls: v.customMediaUrls || data.mediaUrls || [],
                        firstComment: v.firstComment,
                        platformMeta: v.platformMeta || {},
                        socialAccountId: v.socialAccountId || undefined
                    }))
                } : undefined
            },
            include: {
                variants: true,
                project: { select: { id: true, name: true } },
                client: { select: { id: true, name: true } },
                socialAccount: { select: { id: true, platform: true, accountName: true, username: true } }
            }
        });

        // If linked to a calendarPiece, sync the status & media
        if (data.calendarPieceId) {
            // Scoped: a piece id of another company matches nothing (update by id alone bypasses the tenant filter).
            await (prisma as any).calendarContentPiece.updateMany({
                where: pieceScope(data.calendarPieceId, companyId),
                data: {
                    rawMediaUrls: data.rawMediaUrls || [],
                    finalVideoUrl: data.finalVideoUrl,
                    thumbnailUrl: data.thumbnailUrl,
                    status: data.finalVideoUrl ? 'ready' : 'in_progress'
                }
            }).catch(() => null);
        }

        return post;
    }

    static async getPost(id: string) {
        const companyId = requestContext.getStore()?.companyId as string;
        const post = await (prisma as any).socialPost.findUnique({
            where: { id },
            include: {
                variants: { include: { socialAccount: { select: SAFE_ACCOUNT_SELECT } } },
                reviewComments: { orderBy: { createdAt: 'asc' } },
                project: true,
                client: true,
                socialAccount: { select: SAFE_ACCOUNT_SELECT },
                calendar: true,
                calendarPiece: true,
                repurposedFrom: { select: { id: true, title: true, versionNumber: true } },
                derivedPosts: { select: { id: true, title: true, status: true, scheduledFor: true } }
            }
        });

        if (!post || (companyId && post.companyId !== companyId)) {
            throw notFound('Post');
        }

        return post;
    }

    static async listPosts(filters?: { projectId?: string; clientId?: string; status?: string; calendarId?: string; isEvergreen?: boolean; limit?: number; offset?: number }) {
        const companyId = requestContext.getStore()?.companyId as string;
        if (!companyId) throw new SocialDomainError('UNAUTHENTICATED', 401, 'Company context required');

        const whereClause: any = { companyId };
        if (filters?.projectId) whereClause.projectId = filters.projectId;
        if (filters?.clientId) whereClause.clientId = filters.clientId;
        if (filters?.status) whereClause.status = filters.status;
        if (filters?.calendarId) whereClause.calendarId = filters.calendarId;
        if (filters?.isEvergreen !== undefined) whereClause.isEvergreen = filters.isEvergreen;

        const posts = await (prisma as any).socialPost.findMany({
            where: whereClause,
            orderBy: { scheduledFor: 'asc' },
            take: filters?.limit || 50,
            skip: filters?.offset || 0,
            include: {
                variants: { include: { socialAccount: { select: SAFE_ACCOUNT_SELECT } } },
                project: { select: { id: true, name: true } },
                client: { select: { id: true, name: true } },
                socialAccount: { select: { id: true, platform: true, accountName: true, username: true } },
                reviewComments: { select: { id: true, resolved: true, authorType: true } }
            }
        });

        return posts;
    }

    static async updatePost(id: string, data: Partial<CreateSocialPostDTO> & { status?: string }, userId?: string) {
        const companyId = requireCompanyId(requestContext.getStore()?.companyId as string);
        const db = getDb();
        const existing = await db.socialPost.findFirst({ where: { id, companyId } });
        if (!existing) throw notFound('Post');
        if (['publishing', 'published'].includes(existing.status)) {
            throw new SocialDomainError('POST_ALREADY_PUBLISHED', 409, 'This post is published (or publishing) and can no longer be edited. Repurpose it to make a new version.');
        }

        // Whitelist: companyId, versionNumber, approvedVersion and publish state are server-owned (mass assignment).
        const updatePayload: any = sanitizePostUpdate(data as any);
        if (data.scheduledFor !== undefined) {
            const unchanged = existing.scheduledFor && data.scheduledFor && new Date(data.scheduledFor as any).getTime() === new Date(existing.scheduledFor).getTime();
            // Re-saving an unchanged (possibly already passed) time is not a new scheduling decision.
            updatePayload.scheduledFor = unchanged ? existing.scheduledFor : parseScheduledFor(data.scheduledFor);
        }
        if (updatePayload.socialAccountId) {
            const acc = await db.socialAccount.findFirst({ where: { id: updatePayload.socialAccountId, companyId } });
            if (!acc) throw notFound('Social account');
        }

        const existingVariants: any[] = await db.socialPostVariant.findMany({ where: { postId: id }, take: 50 });
        const incomingVariants = Array.isArray(data.variants) ? data.variants : undefined;

        // Re-approval: a substantive change to an approved version (status approved, or approvedVersion current, e.g.
        // approved and then scheduled) bumps the version, so the old approval no longer covers the new content.
        let versionBumped = false;
        let newVersion = existing.versionNumber || 1;
        if (isPostApproved(existing) && hasSubstantiveChange(existing, updatePayload, existingVariants, incomingVariants)) {
            newVersion += 1;
            updatePayload.versionNumber = newVersion;
            versionBumped = true;
            const project = existing.projectId ? await db.project.findFirst({ where: { id: existing.projectId, companyId } }) : null;
            if (projectRequiresApproval(project)) updatePayload.status = 'in_review';
            else if (existing.status === 'approved') {
                // No approval needed here: drop the stale "approved" label without unscheduling the post.
                updatePayload.status = (updatePayload.scheduledFor ?? existing.scheduledFor) ? 'scheduled' : 'draft';
            }
        } else if (isPostApproved(existing) && existing.approvedVersion == null) {
            // Pin the approval to this version so a status change (e.g. approved → scheduled) keeps it.
            updatePayload.approvedVersion = existing.versionNumber || 1;
        }

        if (incomingVariants) await this.syncVariants(id, { ...existing, ...updatePayload }, existingVariants, incomingVariants, companyId);

        // Append to history
        const currentHistory = Array.isArray(existing.history) ? existing.history : [];
        const newHistoryEntry = {
            version: newVersion,
            action: versionBumped ? 'version_bumped' : 'updated',
            userId,
            status: updatePayload.status || existing.status,
            ...(versionBumped ? { note: 'Approved content changed; it needs approval again.' } : {}),
            timestamp: new Date().toISOString()
        };
        updatePayload.history = [...currentHistory, newHistoryEntry];

        await db.socialPost.updateMany({ where: { id, companyId }, data: updatePayload });
        const updated = await db.socialPost.findFirst({ where: { id, companyId } });
        const variants = await db.socialPostVariant.findMany({ where: { postId: id }, take: 50 });
        return { ...updated, variants, reapprovalRequired: versionBumped && updatePayload.status === 'in_review' };
    }

    /**
     * Applies a client's variant list to a post: pending/failed variants are updated or removed, new platforms are
     * added, and variants that already went out (published/processing/assisted) are never touched.
     */
    private static async syncVariants(postId: string, post: any, existing: any[], incoming: PostVariantInput[], companyId: string) {
        const db = getDb();
        const key = (p: string) => String(p).toLowerCase();
        const editable = (v: any) => ['pending', 'failed'].includes(v.publishStatus || 'pending');
        const byPlatform = new Map(existing.map((v) => [key(v.platform), v]));
        for (const v of incoming) {
            if (v.socialAccountId) {
                const acc = await db.socialAccount.findFirst({ where: { id: v.socialAccountId, companyId } });
                if (!acc) throw notFound('Social account');
            }
            const data = {
                customContent: v.customContent || post.content,
                customMediaUrls: v.customMediaUrls || post.mediaUrls || [],
                firstComment: v.firstComment ?? null,
                platformMeta: v.platformMeta || {},
                socialAccountId: v.socialAccountId || null,
            };
            const old = byPlatform.get(key(v.platform));
            if (!old) await db.socialPostVariant.create({ data: { postId, platform: v.platform, ...data } });
            else if (editable(old)) await db.socialPostVariant.updateMany({ where: { id: old.id, postId }, data });
        }
        const keep = new Set(incoming.map((v) => key(v.platform)));
        const removable = existing.filter((v) => !keep.has(key(v.platform)) && editable(v)).map((v) => v.id);
        if (removable.length) await db.socialPostVariant.deleteMany({ where: { id: { in: removable }, postId } });
    }

    /**
     * Assign a social account to a specific variant of a post.
     */
    static async assignVariantAccount(postId: string, variantIdOrPlatform: string, socialAccountId: string | null, companyId?: string) {
        const cId = requireCompanyId(companyId || (requestContext.getStore()?.companyId as string));
        const db = getDb();
        const post = await db.socialPost.findFirst({ where: { id: postId, companyId: cId } });
        if (!post) throw notFound('Post');
        if (socialAccountId) {
            const acc = await db.socialAccount.findFirst({ where: { id: socialAccountId, companyId: cId } });
            if (!acc) throw notFound('Social account');
        }
        const variant = await db.socialPostVariant.findFirst({
            where: {
                postId,
                OR: [
                    { id: variantIdOrPlatform },
                    { platform: variantIdOrPlatform.toLowerCase() },
                ],
            },
        });
        if (!variant) throw notFound('Variant');
        await db.socialPostVariant.update({
            where: { id: variant.id },
            data: { socialAccountId: socialAccountId || null },
        });
        return db.socialPostVariant.findUnique({
            where: { id: variant.id },
            include: { socialAccount: { select: SAFE_ACCOUNT_SELECT } },
        });
    }

    /**
     * Submit raw source footage or external storage links (e.g. Google Drive)
     */
    static async submitFootage(postId: string, footage: { rawMediaUrls?: string[]; externalStorageLinks?: Array<{ url: string; provider: string; label?: string }> }) {
        const companyId = requestContext.getStore()?.companyId as string;
        const existing = await (prisma as any).socialPost.findUnique({ where: { id: postId } });
        if (!existing || existing.companyId !== companyId) throw notFound('Post');

        const updated = await (prisma as any).socialPost.update({
            where: { id: postId },
            data: {
                rawMediaUrls: footage.rawMediaUrls || existing.rawMediaUrls,
                externalStorageLinks: footage.externalStorageLinks || existing.externalStorageLinks
            }
        });

        return { success: true, post: updated, message: 'Footage submitted successfully' };
    }

    /**
     * Validates if a post is completely ready for live or scheduled publishing
     */
    static async validatePublishingReadiness(postId: string) {
        const companyId = requireCompanyId(requestContext.getStore()?.companyId as string);
        const post = await (prisma as any).socialPost.findFirst({
            where: { id: postId, companyId },
            include: { variants: true, socialAccount: { select: SAFE_ACCOUNT_SELECT }, project: true }
        });

        if (!post) throw notFound('Post');
        const warnings: string[] = [];

        const issues: string[] = [];
        let platformChecks: Array<{ platform: string; publishStatus: string; issues: string[] }> = [];

        // 1. Content validation
        if (!post.content || post.content.trim() === '') {
            issues.push('Primary content / caption cannot be empty.');
        }

        // 2. Media readiness
        if (post.mediaType === 'video' && !post.finalVideoUrl && (!post.mediaUrls || post.mediaUrls.length === 0)) {
            issues.push('Video posts require a rendered deliverable URL.');
        }

        // 3. Approval requirement check
        if (projectRequiresApproval(post.project) && !isPostApproved(post)) {
            issues.push(APPROVAL_PENDING_ISSUE);
        }

        // 4. Social account check
        if (!post.socialAccountId && (!post.variants || post.variants.length === 0)) {
            issues.push('No target social account or platform variant selected.');
        }

        if (post.socialAccount?.reauthRequired) {
            issues.push(`Social account "${post.socialAccount.accountName}" requires reauthorization.`);
        }

        // 5. Per-platform checks: app configured, account connected, media/caption limits of each platform.
        if (post.socialAccountId || (post.variants && post.variants.length > 0)) {
            try {
                platformChecks = await PublishDispatcher.preview(postId, post.companyId);
                for (const c of platformChecks) {
                    if (c.publishStatus === 'published' || c.publishStatus === 'processing') continue;
                    for (const i of c.issues) issues.push(`${c.platform}: ${i}`);
                }
            } catch (e: any) {
                issues.push(e.message);
            }
        }

        // 6. Production-Grade Business Planner Violations: Brand Safety & Tone
        let brandSafetyResult: BrandSafetyAuditResult | undefined = undefined;
        if (post.projectId && post.content) {
            try {
                const brandProfile = await getProjectBrandConsciousness(post.projectId, post.companyId);
                const rawMeta = (brandProfile as any)?.metadata?.brand || {};
                const brandConfig = {
                    forbiddenWords: brandProfile?.forbiddenWords || [],
                    competitors: rawMeta.competitors || [],
                    tone: brandProfile?.tone || undefined,
                    preferredVocabulary: rawMeta.preferredVocabulary || [],
                };
                brandSafetyResult = BrandSafetyAuditor.auditContent(post.content, brandConfig);
                for (const v of brandSafetyResult.violations) {
                    if (v.severity === 'high') {
                        issues.push(`Brand Safety: ${v.contextSnippet} (${v.suggestion || 'Resolve before scheduling'})`);
                    }
                }
            } catch {
                // If brand profile does not exist or fails, do not block readiness
            }
        }

        // 7. Production-Grade Business Planner Violations: Schedule Collisions
        let scheduleCollisionResult: ScheduleCollisionCheckResult | undefined = undefined;
        if (post.scheduledFor) {
            try {
                const db = getDb();
                const otherPosts = await db.socialPost.findMany({
                    where: {
                        companyId: post.companyId,
                        id: { not: post.id },
                        status: { in: ['scheduled', 'approved'] },
                        scheduledFor: { not: null },
                    },
                    select: { id: true, scheduledFor: true, socialAccountId: true },
                    take: 200,
                });
                scheduleCollisionResult = SmartTimezoneScheduler.checkScheduleCollision(
                    new Date(post.scheduledFor),
                    otherPosts,
                    post.socialAccountId || undefined,
                    15
                );
                if (scheduleCollisionResult.hasCollision && scheduleCollisionResult.warningMessage) {
                    issues.push(`Schedule Collision: ${scheduleCollisionResult.warningMessage}`);
                }
            } catch {
                // Non-blocking fallback
            }
        }

        // 7b. Duplicate content: same caption to the same account/platform within 7 days (warning, not a blocker).
        if (post.content) {
            try {
                const when = new Date(post.scheduledFor || Date.now());
                const windowMs = 7 * 24 * 3600 * 1000;
                const range = { gte: new Date(when.getTime() - windowMs), lte: new Date(when.getTime() + windowMs) };
                const recent = await (prisma as any).socialPost.findMany({
                    where: {
                        companyId: post.companyId,
                        id: { not: post.id },
                        status: { in: ['scheduled', 'approved', 'publishing', 'published', 'partially_published'] },
                        OR: [{ scheduledFor: range }, { publishedAt: range }],
                    },
                    select: { id: true, content: true, scheduledFor: true, publishedAt: true, socialAccountId: true, variants: { select: { platform: true } } },
                    take: 300,
                });
                const dups = findDuplicateCaptions(
                    {
                        id: post.id,
                        content: post.content,
                        when,
                        socialAccountId: post.socialAccountId,
                        platforms: (post.variants || []).map((v: any) => v.platform).concat(post.socialAccount?.platform ? [post.socialAccount.platform] : []),
                    },
                    recent.map((r: any) => ({ ...r, platforms: (r.variants || []).map((v: any) => v.platform) })),
                );
                if (dups.length) {
                    warnings.push(`The same caption is already scheduled or published on this channel within 7 days (${dups.length} post${dups.length > 1 ? 's' : ''}). Platforms may limit reach of repeated posts.`);
                }
            } catch {
                // Advisory only: a failed lookup never blocks publishing.
            }
        }

        // 8. Production-Grade Business Planner Violations: Platform Media Guard
        const mediaGuardResults: MediaValidationResult[] = [];
        const targetPlatforms: string[] = [];
        if (post.variants && post.variants.length > 0) {
            for (const v of post.variants) {
                if (v.platform && !targetPlatforms.includes(v.platform)) targetPlatforms.push(v.platform);
            }
        } else if (post.socialAccount?.platform) {
            targetPlatforms.push(post.socialAccount.platform);
        }

        for (const p of targetPlatforms) {
            const guard = PlatformMediaGuard.validateForPlatform(p, {
                caption: post.content,
                title: post.title || undefined,
                mediaUrls: post.mediaUrls || undefined,
                aspectRatio: (post.metadata as any)?.aspectRatio,
                durationSeconds: (post.metadata as any)?.durationSeconds,
                fileSizeMB: (post.metadata as any)?.fileSizeMB,
            });
            mediaGuardResults.push(guard);
            if (!guard.valid) {
                for (const err of guard.errors) {
                    issues.push(`${p} Media Constraint: ${err}`);
                }
            }
        }

        return {
            isReady: issues.length === 0,
            /** Problems that make scheduling pointless (it would fail at publish time). Approval and collisions are not among them. */
            schedulingBlockers: issues.filter((i) => i !== APPROVAL_PENDING_ISSUE && !i.startsWith('Schedule Collision:')),
            approvalPending: issues.includes(APPROVAL_PENDING_ISSUE),
            warnings,
            issues,
            violations: {
                brandSafety: brandSafetyResult,
                scheduleCollision: scheduleCollisionResult,
                mediaGuard: mediaGuardResults,
            },
            platformChecks,
            post
        };
    }

    /**
     * Syncs a rendered video from 180 Media Studio / ReelWorker back to the calendar piece and its linked post.
     * Tenant-scoped: the piece and post must belong to `companyId` (the caller's JWT company); otherwise 404 and
     * nothing is written. Prefer POST /calendar-pieces/:id/final-video for new clients.
     */
    static async syncVideoFromStudio(
        calendarPieceId: string,
        finalVideoUrl: string,
        thumbnailUrl?: string,
        companyId: string | undefined = requestContext.getStore()?.companyId as string | undefined,
    ) {
        const tenant = requireCompanyId(companyId);
        const db = getDb();

        // 1. Update the calendar piece (only if it is ours)
        const { count } = await db.calendarContentPiece.updateMany({
            where: pieceScope(calendarPieceId, tenant),
            data: { finalVideoUrl, thumbnailUrl, status: 'ready' },
        });
        if (!count) throw notFound('Calendar piece');
        const piece = await db.calendarContentPiece.findFirst({ where: pieceScope(calendarPieceId, tenant) });

        // 2. Update the linked SocialPost of the same company, if any
        const linkedPost = await db.socialPost.findFirst({ where: { calendarPieceId, companyId: tenant } });
        if (linkedPost) {
            await db.socialPost.updateMany({
                where: { id: linkedPost.id, companyId: tenant },
                data: { finalVideoUrl, thumbnailUrl, status: 'ready' },
            });
        }

        return { success: true, piece, linkedPost };
    }

    /**
     * Publish every unpublished platform variant now through the platform publishers (see publishing/publish-dispatcher.ts).
     * Idempotent: variants already published are never sent again. Throws PublishError (typed code) for
     * APPROVAL_REQUIRED, PUBLISH_IN_PROGRESS, PUBLISH_NOT_CONFIGURED (every target unconfigured) and NOT_FOUND.
     */
    static async publishPostNow(postId: string, userId?: string) {
        const companyId = requestContext.getStore()?.companyId as string;
        return PublishDispatcher.publishPost(postId, { companyId, trigger: 'manual', userId });
    }

    /**
     * Retry one platform. Only a failed / pending variant is re-sent; an already published one returns success
     * without posting again.
     */
    static async retryFailedVariant(postId: string, platform: string, userId?: string) {
        const companyId = requestContext.getStore()?.companyId as string;
        const result = await PublishDispatcher.publishPost(postId, { companyId, trigger: 'retry', platform, userId });
        const v = result.variants.find((x) => x.platform === platform) || result.variants.find((x) => x.publishStatus === 'failed');
        const ok = Boolean(v && (v.publishStatus === 'published' || v.publishStatus === 'processing'));
        return {
            ...result,
            success: ok,
            message: ok ? `Published to ${platform}.` : `Retry failed for ${platform}: ${v?.error || 'unknown error'}`
        };
    }

    /** Publish history (one row per platform attempt), newest first. */
    static async listPublishAttempts(postId: string, limit = 50) {
        const companyId = requestContext.getStore()?.companyId as string;
        if (!companyId) throw new SocialDomainError('UNAUTHENTICATED', 401, 'Company context required');
        return (prisma as any).socialPublishAttempt.findMany({
            where: { postId, companyId },
            orderBy: { startedAt: 'desc' },
            take: Math.min(Math.max(limit, 1), 200)
        });
    }

    /**
     * Repurpose an existing evergreen post into a new derivative post
     */
    static async repurposePost(postId: string, options?: { newScheduleDate?: Date | string; newProjectId?: string; newContent?: string }) {
        const companyId = requestContext.getStore()?.companyId as string;
        const original = await (prisma as any).socialPost.findUnique({ where: { id: postId }, include: { variants: true } });
        if (!original || original.companyId !== companyId) throw notFound('Original post');

        // Increment reuse count on original
        await (prisma as any).socialPost.update({
            where: { id: postId },
            data: {
                reuseCount: (original.reuseCount || 0) + 1,
                lastReusedAt: new Date()
            }
        });

        // Create derivative post
        const derivative = await this.createPost({
            title: `Repurposed: ${original.title || 'Post'}`,
            content: options?.newContent || original.content,
            mediaUrls: original.mediaUrls,
            finalVideoUrl: original.finalVideoUrl,
            thumbnailUrl: original.thumbnailUrl,
            mediaType: original.mediaType,
            projectId: options?.newProjectId || original.projectId,
            clientId: original.clientId,
            scheduledFor: options?.newScheduleDate ? new Date(options.newScheduleDate) : undefined,
            isEvergreen: true
        });

        // Link parent relationship
        await (prisma as any).socialPost.update({
            where: { id: derivative.id },
            data: { repurposedFromId: original.id }
        });

        return derivative;
    }

    /**
     * Updates user-assisted publishing status for a platform variant (e.g. X or Reddit).
     * Supported truthful states: 'ready_to_publish' | 'handed_off' | 'user_confirmed' | 'user_cancelled'.
     * Updates variant.publishStatus, platformMeta, and synchronously manages parent post status.
     */
    static async updateAssistedPublishStatus(
        postId: string,
        data: {
            platform: string;
            status: string;
            platformMeta?: Record<string, any>;
            externalUrl?: string;
            userId?: string;
        },
        companyIdOverride?: string
    ) {
        const companyId = companyIdOverride || (requestContext.getStore()?.companyId as string);
        if (!companyId) throw new SocialDomainError('UNAUTHENTICATED', 401, 'Company context required');

        const post = await (prisma as any).socialPost.findFirst({
            where: { id: postId, companyId },
            include: { variants: true }
        });
        if (!post) throw notFound('Post');

        const platform = data.platform.toLowerCase();
        let variant = post.variants?.find((v: any) => v.platform.toLowerCase() === platform);

        if (!variant) {
            variant = await (prisma as any).socialPostVariant.create({
                data: {
                    postId: post.id,
                    platform: data.platform,
                    customContent: post.content,
                    customMediaUrls: post.mediaUrls || [],
                    publishStatus: data.status === 'user_confirmed' ? 'published' : data.status,
                    publishedAt: data.status === 'user_confirmed' ? new Date() : null,
                    externalUrl: data.externalUrl || null,
                    platformMeta: {
                        publishingMode: 'user_assisted',
                        ...(data.platformMeta || {}),
                        lastAssistedStatus: data.status,
                        lastStatusChange: new Date().toISOString()
                    }
                }
            });
        } else {
            const existingMeta = typeof variant.platformMeta === 'object' && variant.platformMeta ? variant.platformMeta : {};
            variant = await (prisma as any).socialPostVariant.update({
                where: { id: variant.id },
                data: {
                    publishStatus: data.status === 'user_confirmed' ? 'published' : data.status,
                    publishedAt: data.status === 'user_confirmed' ? new Date() : variant.publishedAt,
                    externalUrl: data.externalUrl || variant.externalUrl,
                    platformMeta: {
                        ...existingMeta,
                        publishingMode: 'user_assisted',
                        ...(data.platformMeta || {}),
                        lastAssistedStatus: data.status,
                        lastStatusChange: new Date().toISOString()
                    }
                }
            });
        }

        // Record attempt entry
        await (prisma as any).socialPublishAttempt.create({
            data: {
                companyId,
                postId: post.id,
                variantId: variant.id,
                platform: data.platform,
                trigger: 'manual',
                attemptNumber: (variant.attemptCount || 0) + 1,
                status: data.status === 'user_confirmed' ? 'succeeded' : data.status === 'user_cancelled' ? 'failed' : 'processing',
                externalUrl: data.externalUrl || null,
                triggeredById: data.userId || null,
                finishedAt: ['user_confirmed', 'user_cancelled'].includes(data.status) ? new Date() : null,
                errorMessage: data.status === 'user_cancelled' ? 'User cancelled in external app' : null
            }
        }).catch(() => null);

        // Synchronize parent post status
        const freshVariants = await (prisma as any).socialPostVariant.findMany({ where: { postId: post.id } });
        const allPublished = freshVariants.length > 0 && freshVariants.every((v: any) => v.publishStatus === 'published');
        const anyPublished = freshVariants.some((v: any) => v.publishStatus === 'published');

        if (allPublished) {
            await (prisma as any).socialPost.update({
                where: { id: post.id },
                data: { status: 'published' }
            });
        } else if (anyPublished && post.status !== 'publishing') {
            await (prisma as any).socialPost.update({
                where: { id: post.id },
                data: { status: 'partially_published' }
            });
        }

        return { success: true, variant };
    }

    /**
     * Prepares launch context payload for 180 Media Studio (Remotion + AI Director)
     */
    static async buildMediaStudioLaunchContext(contentPieceId?: string, postId?: string) {
        const companyId = requestContext.getStore()?.companyId as string;
        if (!companyId) throw new SocialDomainError('UNAUTHENTICATED', 401, 'Company context required');

        let title = 'New Project';
        let rawMediaUrls: string[] = [];
        let script = '';
        let targetRatio = '9:16';
        let projectId: string | null = null;

        if (postId) {
            const post = await (prisma as any).socialPost.findFirst({
                where: { id: postId, companyId },
                include: { project: true }
            });
            if (!post) throw notFound('Post');
            title = post.title || 'Social Video';
            rawMediaUrls = post.rawMediaUrls || [];
            script = post.content || '';
            projectId = post.projectId;
        } else if (contentPieceId) {
            const piece = await (prisma as any).calendarContentPiece.findFirst({
                where: pieceScope(contentPieceId, companyId),
                include: { calendar: true }
            });
            if (!piece) throw notFound('Calendar piece');
            title = piece.headline || 'Social Video';
            rawMediaUrls = piece.rawMediaUrls || [];
            script = piece.videoScriptOrHooks || piece.adCopyFull || '';
            projectId = piece.calendar?.projectId || null;
        }

        return {
            projectName: title,
            projectId,
            aspectRatio: targetRatio,
            sourceClips: rawMediaUrls.map((url, idx) => ({
                id: `clip-${idx + 1}`,
                name: `Source Clip ${idx + 1}`,
                url,
                type: 'video'
            })),
            aiDirectorContext: {
                scriptSummary: script,
                recommendedPacing: 'MRBEAST_FAST',
                suggestedCaptions: true
            }
        };
    }
}



