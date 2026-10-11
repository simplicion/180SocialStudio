/**
 * Sends one reply into an inbox conversation on the real platform: a DM for DM threads, a public comment reply for
 * `comment:<id>` threads. Checks platform capability and the messaging window, spends one rate-limit unit, and only
 * then records the message. Nothing is stored as sent unless the provider accepted it.
 */
import { getDb, timing } from '../publishing/http';
import { SocialTokenVault } from '../publishing/token-vault';
import { SocialDomainError, VAULT_ACCOUNT_SELECT } from '../tenant-scope';
import { conversationReplyCapability } from './capabilities';
import { parseThread, replyToComment, sendDirectMessage } from './platform-actions';
import { EngagementRateLimiter } from './rate-limiter';

export type SendResult = { status: 'sent'; messageId: string } | { status: 'rate_limited'; retryAfterMs: number };

export async function sendToConversation(companyId: string, conversationId: string, text: string, senderType: 'agent' | 'ai_bot'): Promise<SendResult> {
    const db = getDb();
    const body = String(text || '').trim();
    if (!body) throw new SocialDomainError('VALIDATION_FAILED', 400, 'Reply text is required');
    if (body.length > 1000) throw new SocialDomainError('VALIDATION_FAILED', 400, 'Replies are limited to 1000 characters');

    const conversation = await db.socialConversation.findFirst({ where: { id: conversationId, companyId } });
    if (!conversation) throw new SocialDomainError('NOT_FOUND', 404, 'Conversation not found');
    const account = await db.socialAccount.findFirst({ where: { id: conversation.socialAccountId, companyId }, select: VAULT_ACCOUNT_SELECT });
    if (!account) throw new SocialDomainError('ACCOUNT_NOT_CONNECTED', 409, 'The social account of this conversation is not connected');

    const thread = parseThread(conversation.platformThreadId);
    const lastUser = await db.socialMessage.findFirst({ where: { conversationId, senderType: 'participant' }, orderBy: { createdAt: 'desc' } });
    const nowMs = timing.now();
    const cap = conversationReplyCapability(conversation.platform, thread.kind, lastUser ? new Date(lastUser.createdAt).getTime() : null, nowMs);
    if (!cap.ok) throw new SocialDomainError(cap.reason === 'outside_messaging_window' ? 'OUTSIDE_MESSAGING_WINDOW' : 'UNSUPPORTED_ON_PLATFORM', 409, cap.detail || cap.reason);

    const token = await SocialTokenVault.getAccessToken(account);
    const decision = await EngagementRateLimiter.take(account.id, 1, nowMs);
    if (!decision.allowed) return { status: 'rate_limited', retryAfterMs: decision.retryAfterMs };

    if (thread.kind === 'comment') await replyToComment(conversation.platform, account, thread.commentId, body, token, thread.mediaId);
    else await sendDirectMessage(conversation.platform, account, thread.recipientId, body, token);

    const message = await db.socialMessage.create({ data: { conversationId, senderType, content: body } });
    await db.socialConversation.updateMany({
        where: { id: conversationId, companyId },
        data: { isRead: true, lastMessageSnippet: body.substring(0, 120), lastMessageAt: new Date(nowMs) },
    });
    return { status: 'sent', messageId: message.id };
}
