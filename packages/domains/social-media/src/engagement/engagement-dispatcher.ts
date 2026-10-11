import { getDb, timing } from '../publishing/http';
import { planEngagementActions } from './capabilities';
import { likeComment, replyToComment, sendDirectMessage, sendPrivateReply } from './platform-actions';
import { EngagementRateLimiter } from './rate-limiter';
import { SocialTokenVault } from '../publishing/token-vault';
import { InboundEngagementEvent, EngagementExecutionResult } from './types';
import { EngagementMatcher } from './engagement-matcher';
import { VAULT_ACCOUNT_SELECT } from '../tenant-scope';

export class EngagementDispatcher {
    /**
     * Replaces variable tokens in templates:
     * {name} -> recipient's display name or handle
     * {handle} -> recipient's username / handle
     * {deliverable_link} -> rule's deliverable URL
     */
    static interpolateTemplate(template: string, event: InboundEngagementEvent, deliverableUrl?: string): string {
        if (!template || typeof template !== 'string') return '';
        let result = template;
        const senderHandle = event.senderHandle || 'friend';
        const name = event.senderName || (senderHandle.startsWith('@') ? senderHandle : `@${senderHandle}`);
        const handle = senderHandle.startsWith('@') ? senderHandle : `@${senderHandle}`;
        const rawHandle = senderHandle.replace(/^@/, '');
        const firstName = (event.senderName || rawHandle).split(' ')[0].replace(/^@/, '');
        const link = deliverableUrl || '';

        result = result.replace(/\{name\}/gi, name);
        result = result.replace(/\{handle\}/gi, handle);
        result = result.replace(/\{username\}/gi, handle);
        result = result.replace(/\{firstname\}/gi, firstName);
        result = result.replace(/\{deliverable_link\}/gi, link);
        result = result.replace(/\{link\}/gi, link);
        result = result.replace(/\{url\}/gi, link);
        return result.trim();
    }

    /**
     * Convenient overload for direct string parameter interpolation
     */
    static interpolateDmTemplate(template: string, name: string, handle: string, deliverableUrl?: string): string {
        return this.interpolateTemplate(
            template,
            {
                companyId: '',
                socialAccountId: '',
                platform: 'instagram',
                eventType: 'comment',
                senderId: '',
                senderHandle: handle,
                senderName: name,
                text: '',
            },
            deliverableUrl
        );
    }

    /**
     * Selects a public comment reply from configured rotating templates to prevent spam flags ('' when none are set).
     * Interpolates {name}, {handle}, {firstname}, {link}, {deliverable_link}, {url}.
     */
    static pickRotatingPublicReply(
        templates: string[],
        recipientHandle: string,
        opts: { event?: InboundEngagementEvent; deliverableUrl?: string; platform?: string } = {}
    ): string {
        const cleanHandle = (recipientHandle || 'there').startsWith('@') ? recipientHandle : `@${recipientHandle || 'there'}`;
        const validTemplates = (templates || []).filter((t) => t && typeof t === 'string' && t.trim().length > 0);
        // No templates configured → no public reply. The brand's words are never invented for it.
        if (!validTemplates.length) return '';
        const template = validTemplates[Math.floor(Math.random() * validTemplates.length)];

        if (opts.event) {
            return this.interpolateTemplate(template, opts.event, opts.deliverableUrl);
        }

        let res = template.replace(/\{handle\}/gi, cleanHandle).replace(/\{name\}/gi, cleanHandle).replace(/\{username\}/gi, cleanHandle);
        if (opts.deliverableUrl) {
            res = res.replace(/\{link\}/gi, opts.deliverableUrl).replace(/\{url\}/gi, opts.deliverableUrl).replace(/\{deliverable_link\}/gi, opts.deliverableUrl);
        }
        return res.trim();
    }

    /**
     * Runs a matched rule for one comment / DM:
     * 1. one-DM-per-user-per-post guard (DB history + a short Redis claim against concurrent deliveries)
     * 2. per-platform capability plan (unsupported actions are skipped with a logged reason; IG/FB 7-day private-reply
     *    window and "one message until the user replies")
     * 3. token from the encrypted vault only
     * 4. per-account leaky-bucket rate limit: when full, the whole event is stored as `rate_limited` with its payload and
     *    retried by `retryDeferred()` (scheduler tick); nothing is dropped
     * 5. real provider calls; only confirmed actions are reported/counted
     * 6. audit log + counters (tenant-scoped writes)
     */
    static async executeEngagement(rule: any, event: InboundEngagementEvent, opts: { existingLogId?: string; attempts?: number } = {}): Promise<EngagementExecutionResult> {
        const db = getDb();
        const nowMs = timing.now();
        const outcome: EngagementExecutionResult = { matched: true, ruleId: rule.id, ruleName: rule.name, commentLiked: false, actions: [] };
        const mediaKey = event.mediaId || event.postId || null;
        const dedupTarget = mediaKey || event.commentId;

        const writeLog = async (status: string, extra: Record<string, any> = {}) => {
            const notes = (outcome.actions || []).filter((a) => a.status !== 'sent').map((a) => `${a.action}: ${a.reason}`).join('; ');
            const data = {
                status,
                commentLiked: outcome.commentLiked,
                publicReplySent: outcome.publicReplySent || null,
                dmSent: outcome.dmSent || null,
                errorMessage: outcome.error || notes || null,
                ...extra,
            };
            try {
                if (opts.existingLogId) {
                    await db.socialInteractionLog.updateMany({ where: { id: opts.existingLogId, companyId: event.companyId }, data });
                } else {
                    await db.socialInteractionLog.create({
                        data: {
                            companyId: event.companyId,
                            ruleId: rule.id,
                            socialAccountId: event.socialAccountId,
                            platform: event.platform,
                            platformCommentId: event.commentId || null,
                            platformMediaId: mediaKey,
                            recipientId: event.senderId,
                            recipientHandle: event.senderHandle,
                            ...data,
                        },
                    });
                }
            } catch (err: any) {
                console.warn(`[EngagementDispatcher] audit log write failed: ${err.message}`);
            }
        };

        // 1. Account of the event's company only; tokens only from the vault.
        const account = await db.socialAccount.findFirst({ where: { id: event.socialAccountId, companyId: event.companyId }, select: VAULT_ACCOUNT_SELECT });
        if (!account) {
            outcome.error = `Social account ${event.socialAccountId} not found`;
            return outcome;
        }

        // 2. One DM per user per post (per rule): DB history, then a claim so parallel deliveries cannot both pass.
        if (await EngagementMatcher.isDuplicate(event.companyId, rule.id, event.senderId, dedupTarget)) {
            outcome.skippedReason = 'duplicate';
            if (opts.existingLogId) await writeLog('duplicate_skipped', { nextAttemptAt: null });
            return outcome;
        }
        const claimKey = EngagementMatcher.buildDedupKey(event.companyId, rule.id, event.senderId, dedupTarget);
        if (!(await EngagementRateLimiter.claim(claimKey, 10 * 60_000))) {
            outcome.skippedReason = 'duplicate';
            return outcome;
        }

        try {
            // 3. Capability plan with the sender's messaging history.
            const conv = await db.socialConversation.findFirst({
                where: { companyId: event.companyId, platform: event.platform, platformThreadId: event.senderId },
                select: { id: true },
            });
            let lastUser: number | null = null;
            let lastBusiness: number | null = null;
            if (conv) {
                const msgs = await db.socialMessage.findMany({ where: { conversationId: conv.id }, orderBy: { createdAt: 'desc' }, take: 20 });
                for (const m of msgs) {
                    const t = new Date(m.createdAt).getTime();
                    if (m.senderType === 'participant') lastUser = Math.max(lastUser ?? 0, t);
                    else lastBusiness = Math.max(lastBusiness ?? 0, t);
                }
            }
            if (event.eventType === 'dm') lastUser = Math.max(lastUser ?? 0, event.timestamp || nowMs);
            const plan = planEngagementActions(event.platform, rule, event, {
                commentAtMs: event.timestamp,
                lastUserMessageAtMs: lastUser,
                lastBusinessMessageAtMs: lastBusiness,
                nowMs,
            });
            for (const p of plan) {
                if (!p.run && p.skipReason !== 'not_configured_on_rule') {
                    outcome.actions!.push({ action: p.action, status: 'skipped', reason: p.detail ? `${p.skipReason} (${p.detail})` : String(p.skipReason) });
                }
            }
            const toRun = plan.filter((p) => p.run);
            if (!toRun.length) {
                await writeLog('skipped', { nextAttemptAt: null });
                return outcome;
            }

            // 4. Token.
            let token: string;
            try {
                token = await SocialTokenVault.getAccessToken(account);
            } catch (err: any) {
                outcome.error = `No usable credentials for this account: ${err.message}`;
                await writeLog('failed', { nextAttemptAt: null });
                return outcome;
            }

            // 5. Rate limit: all planned actions or none; otherwise defer the whole event.
            const decision = await EngagementRateLimiter.take(account.id, toRun.length, nowMs);
            if (!decision.allowed) {
                const attempts = (opts.attempts ?? 0) + 1;
                outcome.skippedReason = 'rate_limited';
                outcome.retryAfterMs = decision.retryAfterMs;
                await writeLog(attempts > MAX_DEFER_ATTEMPTS ? 'failed' : 'rate_limited', {
                    attempts,
                    nextAttemptAt: new Date(nowMs + decision.retryAfterMs),
                    payload: { kind: 'rule', ruleId: rule.id, event },
                    errorMessage: `rate limited (${EngagementRateLimiter.limitPerMinute()}/min per account); retry in ${Math.ceil(decision.retryAfterMs / 1000)}s`,
                });
                return outcome;
            }

            // 6. Execute.
            const run = async (action: 'like' | 'reply' | 'dm', fn: () => Promise<void>) => {
                try {
                    await fn();
                    outcome.actions!.push({ action, status: 'sent' });
                    return true;
                } catch (err: any) {
                    outcome.actions!.push({ action, status: 'failed', reason: String(err?.message || err).slice(0, 300) });
                    return false;
                }
            };
            for (const p of toRun) {
                if (p.action === 'like') {
                    if (await run('like', () => likeComment(event.platform, account, event.commentId!, token))) outcome.commentLiked = true;
                } else if (p.action === 'reply') {
                    const text = this.pickRotatingPublicReply(rule.actionPublicReplies, event.senderHandle, {
                        event,
                        deliverableUrl: rule.actionDmDeliverableUrl,
                        platform: event.platform,
                    });
                    if (await run('reply', () => replyToComment(event.platform, account, event.commentId!, text, token, event.mediaId))) outcome.publicReplySent = text;
                } else {
                    const text = this.interpolateTemplate(rule.actionDmTemplate, event, rule.actionDmDeliverableUrl);
                    const ok = await run('dm', () =>
                        event.eventType === 'dm'
                            ? sendDirectMessage(event.platform, account, event.senderId, text, token)
                            : sendPrivateReply(event.platform, account, event.commentId!, event.senderId, text, token),
                    );
                    if (ok) outcome.dmSent = text;
                }
            }

            // 7. Record the DM or public reply in the conversation thread (so the inbox sees it).
            if (outcome.dmSent) {
                try {
                    const thread = await db.socialConversation.upsert({
                        where: { companyId_platform_platformThreadId: { companyId: event.companyId, platform: event.platform, platformThreadId: event.senderId } },
                        update: { lastMessageSnippet: outcome.dmSent.substring(0, 120), lastMessageAt: new Date(nowMs), aiAgentActive: Boolean(rule.actionEnableAiAgent) },
                        create: {
                            companyId: event.companyId,
                            projectId: rule.projectId || event.projectId || null,
                            socialAccountId: event.socialAccountId,
                            platform: event.platform,
                            platformThreadId: event.senderId,
                            participantName: event.senderName || event.senderHandle,
                            participantHandle: event.senderHandle,
                            lastMessageSnippet: outcome.dmSent.substring(0, 120),
                            lastMessageAt: new Date(nowMs),
                            isRead: true,
                            aiAgentActive: Boolean(rule.actionEnableAiAgent),
                        },
                    });
                    await db.socialMessage.create({ data: { conversationId: thread.id, senderType: 'ai_bot', content: outcome.dmSent } });
                } catch (err: any) {
                    console.warn(`[EngagementDispatcher] conversation sync warning: ${err.message}`);
                }
            } else if (outcome.publicReplySent && event.commentId) {
                try {
                    const thread = await db.socialConversation.findFirst({
                        where: { companyId: event.companyId, platform: event.platform, platformThreadId: `comment:${event.commentId}` },
                    });
                    if (thread) {
                        await db.socialConversation.update({
                            where: { id: thread.id },
                            data: { lastMessageSnippet: outcome.publicReplySent.substring(0, 120), lastMessageAt: new Date(nowMs) },
                        });
                        await db.socialMessage.create({
                            data: { conversationId: thread.id, senderType: 'ai_bot', content: outcome.publicReplySent },
                        });
                    }
                } catch (err: any) {
                    console.warn(`[EngagementDispatcher] public reply thread sync warning: ${err.message}`);
                }
            }

            // 8. Audit + counters (only confirmed actions count).
            const sent = outcome.actions!.filter((a) => a.status === 'sent').length;
            const failures = outcome.actions!.filter((a) => a.status === 'failed');
            const status = failures.length === 0 ? 'success' : sent > 0 ? 'partial' : 'failed';
            if (status === 'failed') outcome.error = failures.map((a) => `${a.action}: ${a.reason}`).join('; ');
            await writeLog(status, { nextAttemptAt: null });
            await db.socialEngagementRule
                .updateMany({
                    where: { id: rule.id, companyId: event.companyId },
                    data: {
                        statsTriggeredCount: { increment: 1 },
                        ...(outcome.dmSent ? { statsDmsSentCount: { increment: 1 } } : {}),
                        ...(outcome.commentLiked ? { statsCommentsLiked: { increment: 1 } } : {}),
                    },
                })
                .catch(() => null);
            if (status !== 'failed') EngagementMatcher.recordDeduplication(event.companyId, rule.id, event.senderId, dedupTarget);
            return outcome;
        } finally {
            await EngagementRateLimiter.release(claimKey);
        }
    }

    /**
     * Re-runs rate-limited events whose retry time has come (called from the publishing scheduler tick).
     * Rows are claimed with a conditional update, so several workers never replay the same event.
     */
    static async retryDeferred(opts: { limit?: number } = {}): Promise<{ retried: number }> {
        const db = getDb();
        const now = new Date(timing.now());
        const due = await db.socialInteractionLog.findMany({
            where: { status: 'rate_limited', nextAttemptAt: { lte: now } },
            orderBy: { nextAttemptAt: 'asc' },
            take: opts.limit ?? 25,
        });
        let retried = 0;
        for (const row of due) {
            const claimed = await db.socialInteractionLog.updateMany({ where: { id: row.id, companyId: row.companyId, status: 'rate_limited' }, data: { status: 'retrying' } });
            if (!claimed.count) continue;
            const payload = row.payload as any;
            const rule = payload?.ruleId ? await db.socialEngagementRule.findFirst({ where: { id: payload.ruleId, companyId: row.companyId } }) : null;
            if (!rule || rule.status !== 'active' || !payload?.event || payload.event.companyId !== row.companyId) {
                await db.socialInteractionLog.updateMany({ where: { id: row.id, companyId: row.companyId }, data: { status: 'failed', errorMessage: 'rule no longer active; deferred event discarded' } });
                continue;
            }
            await this.executeEngagement(rule, payload.event, { existingLogId: row.id, attempts: row.attempts ?? 0 });
            retried++;
        }
        return { retried };
    }
}

const MAX_DEFER_ATTEMPTS = 20;
