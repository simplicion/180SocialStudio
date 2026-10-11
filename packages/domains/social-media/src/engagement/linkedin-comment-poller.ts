/**
 * LinkedIn Comment Poller: A background poller for automated comment engagement and lead ingestion.
 *
 * Background:
 * LinkedIn does not offer webhook event subscriptions for comments on free/standard developer tiers.
 * This worker runs periodically (via SocialPublishScheduler tick) to:
 * 1. Find all active SocialEngagementRules targeting LinkedIn accounts.
 * 2. Identify target LinkedIn posts (either specific postId from the rule or recent published LinkedIn posts).
 * 3. Fetch latest comments via LinkedInAdapter.fetchComments(postUrn, token).
 * 4. Deduplicate comments against database records (SocialMessage & SocialInteractionLog).
 * 5. Ingest new comments into SocialInboxService so they appear in Social Inbox.
 * 6. Match against active rules via EngagementMatcher.findMatchingRule().
 * 7. Dispatch automated actions (likeComment, replyToComment) via EngagementDispatcher.executeEngagement().
 */

import { getDb } from '../publishing/http';
import { SocialTokenVault } from '../publishing/token-vault';
import { LinkedInAdapter } from '../adapters/linkedin.adapter';
import { EngagementMatcher } from './engagement-matcher';
import { EngagementDispatcher } from './engagement-dispatcher';
import { SocialInboxService } from '../social-inbox.service';
import { InboundEngagementEvent } from './types';
import { VAULT_ACCOUNT_SELECT } from '../tenant-scope';

export function extractLinkedInUrn(externalIdOrUrl?: string | null): string | null {
    if (!externalIdOrUrl) return null;
    const trimmed = externalIdOrUrl.trim();
    if (trimmed.startsWith('urn:li:')) return trimmed;

    // e.g. https://www.linkedin.com/feed/update/urn:li:activity:1234567890/
    const actMatch = trimmed.match(/activity-([0-9]+)/);
    if (actMatch) return `urn:li:activity:${actMatch[1]}`;

    // e.g. URL-encoded URN
    const encMatch = trimmed.match(/urn%3Ali%3A(activity|share|ugcPost)%3A([0-9]+)/i);
    if (encMatch) return `urn:li:${encMatch[1]}:${encMatch[2]}`;

    // e.g. raw URN substring
    const rawUrnMatch = trimmed.match(/urn:li:(activity|share|ugcPost):([0-9]+)/i);
    if (rawUrnMatch) return rawUrnMatch[0];

    return null;
}

export interface LinkedInPollResult {
    accountsChecked: number;
    postsChecked: number;
    commentsFetched: number;
    commentsIngested: number;
    rulesExecuted: number;
    errors: Array<{ accountId: string; error: string }>;
}

export class LinkedInCommentPoller {
    /**
     * Polls comments across all active LinkedIn engagement rules.
     * Safe to run repeatedly; uses database deduplication to prevent double execution.
     */
    static async pollActivePosts(): Promise<LinkedInPollResult> {
        const db = getDb();
        const result: LinkedInPollResult = {
            accountsChecked: 0,
            postsChecked: 0,
            commentsFetched: 0,
            commentsIngested: 0,
            rulesExecuted: 0,
            errors: [],
        };

        // 1. Find all active rules that could apply to LinkedIn
        const activeRules = await db.socialEngagementRule.findMany({
            where: {
                status: 'active',
                OR: [
                    { triggerType: 'comment_keyword' },
                    { triggerType: 'comment_any' },
                ],
            },
            include: {
                socialAccount: {
                    select: VAULT_ACCOUNT_SELECT,
                },
            },
        });

        if (!activeRules.length) return result;

        // Group rules by companyId and socialAccountId
        const targetAccounts = new Map<string, any>();

        for (const rule of activeRules) {
            if (rule.socialAccount) {
                if (rule.socialAccount.platform === 'linkedin' && !rule.socialAccount.reauthRequired && rule.socialAccount.isActive) {
                    targetAccounts.set(rule.socialAccount.id, rule.socialAccount);
                }
            } else {
                // Global rule: find all active LinkedIn accounts in this company
                const liAccounts = await db.socialAccount.findMany({
                    where: {
                        companyId: rule.companyId,
                        platform: 'linkedin',
                        isActive: true,
                        reauthRequired: false,
                    },
                    select: VAULT_ACCOUNT_SELECT,
                });
                for (const acc of liAccounts) {
                    targetAccounts.set(acc.id, acc);
                }
            }
        }

        result.accountsChecked = targetAccounts.size;
        if (targetAccounts.size === 0) return result;

        // 2. Iterate each LinkedIn account and poll its recent posts
        for (const account of targetAccounts.values()) {
            try {
                let token: string;
                try {
                    token = await SocialTokenVault.getAccessToken(account);
                } catch (tokenErr: any) {
                    console.warn(`[LinkedInPoller] Token error for account ${account.id}: ${tokenErr?.message}`);
                    result.errors.push({ accountId: account.id, error: tokenErr?.message || String(tokenErr) });
                    continue;
                }

                // Collect target post URNs
                // A) Posts specified in rules for this account
                const accountRules = activeRules.filter(
                    (r: any) => r.companyId === account.companyId && (r.socialAccountId === null || r.socialAccountId === account.id)
                );

                const postUrnsToPoll = new Set<string>();

                for (const rule of accountRules) {
                    if (rule.postId) {
                        // Check if rule.postId is already a URN or linked post ID
                        const targetUrn = extractLinkedInUrn(rule.postId);
                        if (targetUrn) {
                            postUrnsToPoll.add(targetUrn);
                        } else {
                            // Look up SocialPost
                            const p = await db.socialPost.findFirst({
                                where: { id: rule.postId, companyId: account.companyId },
                                include: { variants: true },
                            });
                            if (p) {
                                for (const v of p.variants) {
                                    if (v.platform === 'linkedin') {
                                        const urn = extractLinkedInUrn(v.externalId) || extractLinkedInUrn(v.externalUrl);
                                        if (urn) postUrnsToPoll.add(urn);
                                    }
                                }
                            }
                        }
                    }
                }

                // B) If any rule has postId == null (all posts), fetch recently published LinkedIn posts (last 14 days)
                const hasGlobalPostRule = accountRules.some((r: any) => !r.postId);
                if (hasGlobalPostRule) {
                    const recentPublishedVariants = await db.socialPostVariant.findMany({
                        where: {
                            platform: 'linkedin',
                            publishStatus: 'published',
                            publishedAt: {
                                gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000), // last 14 days
                            },
                            socialAccountId: account.id,
                        },
                        select: { externalId: true, externalUrl: true },
                        take: 10,
                        orderBy: { publishedAt: 'desc' },
                    });

                    for (const v of recentPublishedVariants) {
                        const urn = extractLinkedInUrn(v.externalId) || extractLinkedInUrn(v.externalUrl);
                        if (urn) postUrnsToPoll.add(urn);
                    }
                }

                result.postsChecked += postUrnsToPoll.size;

                // 3. For each post URN, fetch comments and evaluate engagement
                for (const postUrn of postUrnsToPoll) {
                    try {
                        const comments = await LinkedInAdapter.fetchComments(postUrn, token, 25);
                        result.commentsFetched += comments.length;

                        for (const c of comments) {
                            const commentId = String(c.id || c.$URN || '');
                            if (!commentId) continue;

                            const commentText = String(c.message?.text || c.text || '').trim();
                            const actorUrn = String(c.created?.actor || c.actor || '');
                            const actorObj = c['actor~'] || c.actorProfile || {};
                            const actorName = c.actorName
                                || [actorObj.localizedFirstName, actorObj.localizedLastName].filter(Boolean).join(' ')
                                || actorObj.name
                                || (actorUrn.includes(':person:') ? 'Connection' : 'LinkedIn User');
                            const timestamp = Number(c.created?.time || Date.now());

                            // Skip self-comments (authored by this account)
                            if (actorUrn && account.platformAccountId && actorUrn === account.platformAccountId) {
                                continue;
                            }

                            // 4. Deduplication: Has this comment already been processed?
                            const alreadyLogged = await db.socialInteractionLog.findFirst({
                                where: {
                                    companyId: account.companyId,
                                    platformCommentId: commentId,
                                    status: { in: ['success', 'partial'] },
                                },
                                select: { id: true },
                            });
                            if (alreadyLogged) continue;

                            // Ingest comment into Social Inbox so it appears in conversations
                            const threadId = `comment:${commentId}`;
                            await SocialInboxService.ingestMessage({
                                companyId: account.companyId,
                                socialAccountId: account.id,
                                platform: 'linkedin',
                                platformThreadId: threadId,
                                participantName: actorName,
                                participantHandle: actorUrn.replace(/^urn:li:(person|organization):/, ''),
                                messageContent: commentText,
                                platformMessageId: commentId,
                            }).catch((err: any) => console.warn(`[LinkedInPoller] Ingest warning: ${err?.message}`));

                            result.commentsIngested++;

                            // 5. Build inbound engagement event and evaluate against active rules
                            const event: InboundEngagementEvent = {
                                companyId: account.companyId,
                                socialAccountId: account.id,
                                platform: 'linkedin',
                                eventType: 'comment',
                                commentId,
                                mediaId: postUrn,
                                postId: postUrn,
                                senderId: actorUrn || commentId,
                                senderHandle: actorUrn.replace(/^urn:li:(person|organization):/, ''),
                                senderName: actorName,
                                text: commentText,
                                timestamp,
                            };

                            const matchedRule = await EngagementMatcher.findMatchingRule(event);
                            if (matchedRule) {
                                const execution = await EngagementDispatcher.executeEngagement(matchedRule, event);
                                if (execution.matched) {
                                    result.rulesExecuted++;
                                    console.log(`[LinkedInPoller] Executed rule "${matchedRule.name}" on LinkedIn comment ${commentId}`);
                                }
                            }
                        }
                    } catch (fetchErr: any) {
                        console.warn(`[LinkedInPoller] Failed to fetch comments for ${postUrn}: ${fetchErr?.message}`);
                    }
                }
            } catch (accErr: any) {
                console.warn(`[LinkedInPoller] Error polling account ${account.id}: ${accErr?.message}`);
                result.errors.push({ accountId: account.id, error: accErr?.message || String(accErr) });
            }
        }

        return result;
    }
}
