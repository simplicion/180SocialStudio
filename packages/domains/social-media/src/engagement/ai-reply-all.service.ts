import { getDb, timing } from '../publishing/http';
import { SocialDomainError, requireCompanyId } from '../tenant-scope';
import { BatchAiReplyItem } from './types';
import { conversationReplyCapability } from './capabilities';
import { parseThread } from './platform-actions';
import { sendToConversation } from './conversation-sender';
import { findForbiddenWords, generateWithTimeout, loadBrandForReplies, parseLlmJson, requireEngagementLlm } from './engagement-ai';

export const REPLY_INTENTS = ['lead', 'question', 'support', 'praise', 'complaint', 'spam', 'other'] as const;
const MAX_BATCH = 50;

export interface BatchDispatchItemResult {
    conversationId: string;
    status: 'sent' | 'rate_limited' | 'failed';
    code?: string;
    error?: string;
    retryAfterMs?: number;
}

export class AiReplyAllService {
    /**
     * Drafts one reply per unanswered conversation (last message from the user) with the company's AI and the
     * project's brand profile, classified by intent. Tenant-scoped. No AI provider → 503 AI_NOT_CONFIGURED.
     * Items that cannot be sent right now (platform has no DMs, 24 h window closed) come back with `canSend: false`.
     */
    static async generateBatchSuggestions(companyId: string, options: { projectId?: string; platform?: string; limit?: number } = {}): Promise<BatchAiReplyItem[]> {
        requireCompanyId(companyId);
        const db = getDb();
        const limit = Math.min(Math.max(1, Number(options.limit) || 20), MAX_BATCH);
        if (options.projectId && !(await db.project.findFirst({ where: { id: options.projectId, companyId }, select: { id: true } }))) {
            throw new SocialDomainError('NOT_FOUND', 404, 'Project not found');
        }
        const where: any = { companyId, isRead: false };
        if (options.projectId) where.projectId = options.projectId;
        if (options.platform) where.platform = options.platform;
        const conversations = await db.socialConversation.findMany({ where, take: limit * 2, orderBy: { lastMessageAt: 'desc' } });

        const pending: Array<{ c: any; last: any }> = [];
        for (const c of conversations) {
            const last = await db.socialMessage.findFirst({ where: { conversationId: c.id }, orderBy: { createdAt: 'desc' } });
            if (last && last.senderType === 'participant') pending.push({ c, last });
            if (pending.length >= limit) break;
        }
        if (!pending.length) return [];

        const llm = await requireEngagementLlm(companyId);
        const brandCache = new Map();
        const nowMs = timing.now();
        const items: BatchAiReplyItem[] = [];
        // One call per project so each batch is written in that project's brand voice.
        const byProject = new Map<string, typeof pending>();
        for (const p of pending) {
            const k = p.c.projectId || '';
            byProject.set(k, [...(byProject.get(k) || []), p]);
        }
        for (const [projectId, group] of byProject) {
            const brand = await loadBrandForReplies(projectId || null, companyId, brandCache);
            const list = group.map((p, i) => `#${i} [${p.c.platform} ${parseThread(p.c.platformThreadId).kind}] @${p.c.participantHandle}: ${String(p.last.content).slice(0, 500)}`).join('\n');
            const prompt = `You draft replies for a brand's social inbox. For each numbered message, classify the intent and write one reply.
${brand.context ? `BRAND:\n${brand.context}\n` : ''}${brand.forbiddenWords.length ? `NEVER use: ${brand.forbiddenWords.join(', ')}\n` : ''}Intents: ${REPLY_INTENTS.join(', ')}. Replies: at most 3 short sentences, no invented prices, links or promises; for spam use an empty reply.
MESSAGES:
${list}
Return ONLY JSON: [{"index": 0, "intent": "question", "reply": "...", "confidence": 0.0-1.0}]`;
            const parsed = parseLlmJson(await generateWithTimeout(llm, prompt, 300 + group.length * 150));
            const rows = Array.isArray(parsed) ? parsed : [];
            group.forEach((p, i) => {
                const row = rows.find((r: any) => Number(r?.index) === i) || {};
                const reply = typeof row.reply === 'string' ? row.reply.trim() : '';
                const intent = (REPLY_INTENTS as readonly string[]).includes(row.intent) ? row.intent : 'other';
                const thread = parseThread(p.c.platformThreadId);
                const cap = conversationReplyCapability(p.c.platform, thread.kind, new Date(p.last.createdAt).getTime(), nowMs);
                const forbidden = findForbiddenWords(reply, brand.forbiddenWords);
                items.push({
                    conversationId: p.c.id,
                    platform: p.c.platform,
                    participantHandle: p.c.participantHandle,
                    lastCustomerMessage: p.last.content,
                    suggestedReply: reply,
                    tone: intent,
                    intent,
                    confidence: typeof row.confidence === 'number' ? Math.max(0, Math.min(1, row.confidence)) : null,
                    canSend: cap.ok && !!reply && !forbidden.length,
                    blockedReason: !cap.ok ? cap.detail || cap.reason : !reply ? 'AI returned no reply' : forbidden.length ? `uses forbidden words: ${forbidden.join(', ')}` : undefined,
                    selected: cap.ok && !!reply && !forbidden.length && intent !== 'spam',
                });
            });
        }
        return items;
    }

    /** Backwards-compatible preview (same data as generateBatchSuggestions). */
    static async previewBatchReplies(companyId: string, projectId?: string): Promise<{ items: BatchAiReplyItem[]; count: number }> {
        const items = await this.generateBatchSuggestions(companyId, { projectId });
        return { items, count: items.length };
    }

    static async executeBatchReply(companyId: string, approvedItems: Array<{ conversationId: string; replyText: string }>) {
        return this.executeBatchReplies(companyId, approvedItems);
    }

    /**
     * Sends approved (optionally edited) replies. Each item is tenant-checked, capability-checked and rate-limited per
     * account; a limited item is NOT sent and comes back `rate_limited` with `retryAfterMs` so the client can re-send it.
     */
    static async executeBatchReplies(
        companyId: string,
        approvedItems: Array<{ conversationId: string; replyText: string }>,
    ): Promise<{ dispatched: number; failed: number; rateLimited: number; errors: string[]; results: BatchDispatchItemResult[] }> {
        requireCompanyId(companyId);
        if (!Array.isArray(approvedItems) || !approvedItems.length) throw new SocialDomainError('VALIDATION_FAILED', 400, 'replies must be a non-empty array');
        if (approvedItems.length > MAX_BATCH) throw new SocialDomainError('VALIDATION_FAILED', 400, `At most ${MAX_BATCH} replies per batch`);
        const results: BatchDispatchItemResult[] = [];
        for (const item of approvedItems) {
            const conversationId = String(item?.conversationId || '');
            try {
                const r = await sendToConversation(companyId, conversationId, String(item?.replyText || ''), 'agent');
                results.push(r.status === 'sent' ? { conversationId, status: 'sent' } : { conversationId, status: 'rate_limited', code: 'RATE_LIMITED', retryAfterMs: r.retryAfterMs });
            } catch (err: any) {
                results.push({ conversationId, status: 'failed', code: err?.code || 'SEND_FAILED', error: String(err?.message || err).slice(0, 300) });
            }
        }
        const failedRows = results.filter((r) => r.status === 'failed');
        return {
            dispatched: results.filter((r) => r.status === 'sent').length,
            failed: failedRows.length,
            rateLimited: results.filter((r) => r.status === 'rate_limited').length,
            errors: failedRows.map((r) => `Conversation ${r.conversationId}: ${r.error}`),
            results,
        };
    }
}
