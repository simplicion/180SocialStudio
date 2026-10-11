import { getDb } from '../publishing/http';
import { InboundEngagementEvent, EngagementTriggerType } from './types';

// In-memory sliding de-duplication cache as fallback if Redis is unavailable
const dedupMemoryCache = new Set<string>();

export class EngagementMatcher {
    /**
     * Builds a deduplication key to ensure a user only receives ONE automated DM
     * per Reel / Post, avoiding spamming the user on repeated comments.
     */
    static buildDedupKey(companyId: string, ruleId: string, senderId: string, mediaId?: string): string {
        return `dedup:eng:${companyId}:${ruleId}:${senderId}:${mediaId || 'global'}`;
    }

    /** Test hook: forget the in-process dedup hints (the database stays authoritative). */
    static resetDedupCache(): void {
        dedupMemoryCache.clear();
    }

    /**
     * Checks if this interaction has already been triggered for the recipient on this post.
     */
    static async isDuplicate(companyId: string, ruleId: string, senderId: string, mediaId?: string): Promise<boolean> {
        const key = this.buildDedupKey(companyId, ruleId, senderId, mediaId);
        if (dedupMemoryCache.has(key)) {
            return true;
        }

        const db = getDb();
        const existing = await db.socialInteractionLog.findFirst({
            where: {
                companyId,
                ruleId,
                recipientId: senderId,
                // One DM per user per post: any earlier successful/partial run of this rule for this post.
                ...(mediaId ? { OR: [{ platformMediaId: mediaId }, { platformCommentId: mediaId }] } : {}),
                status: { in: ['success', 'partial'] },
            },
            select: { id: true },
        });

        if (existing) {
            dedupMemoryCache.add(key);
            return true;
        }

        return false;
    }

    /**
     * Records interaction key in deduplication cache.
     */
    static recordDeduplication(companyId: string, ruleId: string, senderId: string, mediaId?: string): void {
        const key = this.buildDedupKey(companyId, ruleId, senderId, mediaId);
        dedupMemoryCache.add(key);
        // Evict after 24 hours to prevent memory leaks
        setTimeout(() => dedupMemoryCache.delete(key), 24 * 60 * 60 * 1000).unref();
    }

    /**
     * Tests if text matches keywords based on matchMode.
     */
    /**
     * Tests if text matches keywords based on matchMode.
     * Supports exact match, regex, and boundary-aware contains (handles emojis, punctuation, spaces).
     */
    static matchesKeywords(text: string, keywords: string[], matchMode: 'contains' | 'exact' | 'regex' = 'contains'): boolean {
        if (!keywords.length) return true; // empty keywords = catch all
        const normalizedText = (text || '').trim().toLowerCase();

        for (const kw of keywords) {
            const normalizedKw = (kw || '').trim().toLowerCase();
            if (!normalizedKw) continue;

            if (matchMode === 'exact') {
                if (normalizedText === normalizedKw) return true;
                // Also handle trailing punctuation / emojis in exact mode (e.g. "LINK!" or "LINK🔥")
                const strippedText = normalizedText.replace(/^[\s\p{P}\p{S}]+|[\s\p{P}\p{S}]+$/gu, '');
                if (strippedText === normalizedKw) return true;
            } else if (matchMode === 'contains') {
                // If keyword contains space or symbols, match substring
                if (/\s/.test(normalizedKw)) {
                    if (normalizedText.includes(normalizedKw)) return true;
                } else {
                    // Non-alphanumeric boundary regex: matches start/end or any non-alphanumeric char
                    // (handles emojis like 🔥, symbols, punctuation, spaces, tabs, newlines)
                    const escaped = normalizedKw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const boundaryRegex = new RegExp(`(^|[^a-zA-Z0-9])${escaped}([^a-zA-Z0-9]|$)`, 'i');
                    if (boundaryRegex.test(text)) {
                        return true;
                    }
                }
            } else if (matchMode === 'regex') {
                try {
                    const regex = new RegExp(kw, 'i');
                    if (regex.test(text)) return true;
                } catch {
                    // Invalid regex fallback to substring
                    if (normalizedText.includes(normalizedKw)) return true;
                }
            }
        }

        return false;
    }

    /**
     * Evaluates an inbound event against all active rules in the company.
     * Returns the highest-priority matching rule, or null if no rule applies.
     */
    static async findMatchingRule(event: InboundEngagementEvent): Promise<any | null> {
        const db = getDb();
        const expectedTriggerType: EngagementTriggerType = event.eventType === 'dm' ? 'dm_inbound' : 'comment_keyword';

        // Find candidate active rules for this company and account
        const candidateRules = await db.socialEngagementRule.findMany({
            where: {
                companyId: event.companyId,
                status: 'active',
                OR: [
                    { triggerType: expectedTriggerType },
                    ...(event.eventType === 'comment' ? [{ triggerType: 'comment_any' }] : []),
                ],
                AND: [
                    {
                        OR: [
                            { socialAccountId: null },
                            { socialAccountId: event.socialAccountId },
                        ],
                    },
                    {
                        // Account-wide rules, rules on a 180 Workspace post, and rules on an existing platform post.
                        OR: [
                            { postId: null, platformMediaId: null },
                            ...(event.postId ? [{ postId: event.postId }] : []),
                            ...(event.mediaId ? [{ platformMediaId: event.mediaId }] : []),
                        ],
                    },
                ],
            },
            orderBy: { createdAt: 'desc' },
        });

        // Most specific first: a rule on this exact post beats an account rule, which beats a workspace-wide rule.
        // Array.sort is stable, so equally specific rules keep newest-first order.
        const specificity = (r: any) => (r.postId || r.platformMediaId ? 2 : 0) + (r.socialAccountId ? 1 : 0);
        const ordered = [...candidateRules].sort((a: any, b: any) => specificity(b) - specificity(a));

        for (const rule of ordered) {
            // Check specific target account matching
            if (rule.socialAccountId && event.socialAccountId && rule.socialAccountId !== event.socialAccountId) {
                continue;
            }

            // A post-scoped rule only fires for comments on that post (app post id or platform media id).
            if (rule.postId && !(event.postId && rule.postId === event.postId)) continue;
            if (rule.platformMediaId && !(event.mediaId && rule.platformMediaId === event.mediaId)) continue;

            // If triggerType is comment_any or dm_inbound without keywords, it matches
            if (rule.triggerType === 'comment_any' || (rule.triggerType === 'dm_inbound' && !rule.triggerKeywords?.length)) {
                return rule;
            }

            // Keyword match evaluation
            const isMatch = this.matchesKeywords(
                event.text,
                rule.triggerKeywords || [],
                (rule.matchMode as any) || 'contains'
            );

            if (isMatch) {
                return rule;
            }
        }

        return null;
    }
}
