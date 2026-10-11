import crypto from 'crypto';
import { getDb } from './http';
import { metaWebhookAppSecret, metaWebhookVerifyToken } from './config';
import { SocialInboxService } from '../social-inbox.service';
import { EngagementMatcher } from '../engagement/engagement-matcher';
import { EngagementDispatcher } from '../engagement/engagement-dispatcher';
import { AiEngagementAgent } from '../engagement/ai-engagement-agent';
import { InboundEngagementEvent } from '../engagement/types';
import { EngagementRateLimiter } from '../engagement/rate-limiter';
import { commentThreadId } from '../engagement/platform-actions';

export interface WebhookChallengeResult {
    success: boolean;
    challenge?: string;
    statusCode: number;
    error?: string;
}

export interface SignedRequestData {
    user_id?: string;
    algorithm?: string;
    issued_at?: number;
    [key: string]: any;
}

export interface DataDeletionResponse {
    url: string;
    confirmation_code: string;
}

export class MetaWebhooksService {
    /**
     * Verifies the GET hub.challenge handshake from Meta developer dashboard.
     * Meta requires returning the challenge param verbatim with 200 OK.
     */
    static verifyChallenge(query: Record<string, any>): WebhookChallengeResult {
        const mode = query['hub.mode'];
        const token = query['hub.verify_token'];
        const challenge = query['hub.challenge'];
        const configuredToken = metaWebhookVerifyToken();

        if (!configuredToken) {
            console.error('[MetaWebhooks] META_WEBHOOK_VERIFY_TOKEN is not set; rejecting webhook verification with 503. Set it in the server environment.');
            return {
                success: false,
                statusCode: 503,
                error: 'META_WEBHOOK_VERIFY_TOKEN is not configured on this server.',
            };
        }

        if (mode === 'subscribe' && token === configuredToken) {
            return {
                success: true,
                challenge: String(challenge ?? ''),
                statusCode: 200,
            };
        }

        return {
            success: false,
            statusCode: 403,
            error: 'Verification token or mode mismatch.',
        };
    }

    /**
     * Verifies the x-hub-signature-256 header sent with every POST event from Meta.
     */
    /** True when META_WEBHOOK_APP_SECRET (or META_APP_SECRET) is set; without it every event is refused (fail closed). */
    static isSignatureConfigured(): boolean {
        return Boolean(metaWebhookAppSecret());
    }

    static verifySignature(rawBody: Buffer | string, signatureHeader?: string): boolean {
        if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
            return false;
        }

        const secret = metaWebhookAppSecret();
        if (!secret) return false;

        const signature = signatureHeader.slice('sha256='.length);
        const bodyBuf = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ''), 'utf8');

        const hmac = crypto.createHmac('sha256', secret);
        hmac.update(bodyBuf);
        const expectedSig = hmac.digest('hex');

        if (signature.length !== expectedSig.length) return false;

        try {
            return crypto.timingSafeEqual(Buffer.from(signature, 'utf8'), Buffer.from(expectedSig, 'utf8'));
        } catch {
            return false;
        }
    }

    /**
     * Decodes and cryptographically verifies a signed_request from Meta (used for Deauthorization and Data Deletion).
     */
    static parseSignedRequest(signedRequest: string): SignedRequestData {
        if (!signedRequest || typeof signedRequest !== 'string') {
            throw new Error('Missing signed_request parameter');
        }

        const parts = signedRequest.split('.');
        if (parts.length !== 2) {
            throw new Error('Invalid signed_request format (expected signature.payload)');
        }

        const [encodedSig, payloadB64] = parts;
        const secret = metaWebhookAppSecret();
        if (!secret) {
            throw new Error('Meta App Secret is not configured');
        }

        // Base64url decode signature
        const sig = Buffer.from(encodedSig.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
        const expectedSig = crypto.createHmac('sha256', secret).update(payloadB64).digest();

        if (sig.length !== expectedSig.length || !crypto.timingSafeEqual(sig, expectedSig)) {
            throw new Error('Signature verification failed on signed_request');
        }

        // Base64url decode payload
        const rawJson = Buffer.from(payloadB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
        try {
            return JSON.parse(rawJson);
        } catch {
            throw new Error('Failed to parse signed_request payload JSON');
        }
    }

    /**
     * Handles Meta Deauthorization Callback (user uninstalled the app or revoked permissions in Facebook/IG settings).
     * Marks affected accounts as reauthRequired to protect against unauthorized publishing attempts.
     */
    static async handleDeauthorization(signedRequest: string): Promise<{ success: boolean; accountsAffected: number }> {
        const data = this.parseSignedRequest(signedRequest);
        const userId = data.user_id;
        if (!userId) {
            throw new Error('No user_id found in deauthorization signed_request');
        }

        const db = getDb();
        const accounts = await db.socialAccount.findMany({
            where: {
                platformAccountId: userId,
                platform: { in: ['facebook', 'instagram', 'threads'] },
            },
        });

        if (!accounts.length) {
            return { success: true, accountsAffected: 0 };
        }

        await db.socialAccount.updateMany({
            where: {
                platformAccountId: userId,
                platform: { in: ['facebook', 'instagram', 'threads'] },
            },
            data: {
                reauthRequired: true,
                reauthReason: 'User revoked app authorization in Meta account settings.',
            },
        });

        return { success: true, accountsAffected: accounts.length };
    }

    /**
     * Handles Meta Data Deletion Request Callback (GDPR / Meta compliance).
     * Deletes credentials and scrubs tokens for the specified Meta user_id, returning
     * a confirmation URL and tracking code required by Meta's Data Deletion protocol.
     */
    static async handleDataDeletion(signedRequest: string): Promise<DataDeletionResponse> {
        const data = this.parseSignedRequest(signedRequest);
        const userId = data.user_id;
        if (!userId) {
            throw new Error('No user_id found in data deletion signed_request');
        }

        const db = getDb();
        const confirmationCode = `del_${crypto.randomBytes(12).toString('hex')}`;

        const accounts = await db.socialAccount.findMany({
            where: {
                platformAccountId: userId,
                platform: { in: ['facebook', 'instagram', 'threads'] },
            },
        });

        for (const account of accounts) {
            // Delete encrypted vault credentials
            await db.socialAccountCredential.deleteMany({
                where: { socialAccountId: account.id },
            }).catch(() => null);

            // Clear deprecated plaintext columns and mark inactive
            await db.socialAccount.update({
                where: { id: account.id },
                data: {
                    accessToken: null,
                    refreshToken: null,
                    tokenExpiresAt: null,
                    isActive: false,
                    reauthRequired: true,
                    reauthReason: `Data deleted upon user request via Meta callback (Code: ${confirmationCode})`,
                    metadata: {
                        ...(typeof account.metadata === 'object' && account.metadata ? account.metadata : {}),
                        dataDeletion: {
                            requestedAt: new Date().toISOString(),
                            confirmationCode,
                        },
                    },
                },
            }).catch(() => null);
        }

        const baseUrl = (process.env.CLIENT_URL || 'https://180workspace.com').split(',')[0].trim().replace(/\/+$/, '');
        return {
            url: `${baseUrl}/data-deletion?id=${confirmationCode}`,
            confirmation_code: confirmationCode,
        };
    }

    /**
     * Ingests real-time events sent by Meta (Page feed/messages, Instagram DMs/comments, Threads replies).
     * Call only after `verifySignature` passed. Idempotent: every message / comment id is claimed once (Redis claim +
     * the stored platformMessageId), so Meta's re-deliveries never trigger a second reply or DM. Our own messages
     * (echoes) and our own comments are ignored so automations never answer themselves.
     */
    static async handleWebhookEvent(payload: any): Promise<{ success: boolean; processedEntries: number; messagesIngested: number; duplicates: number }> {
        if (!payload || typeof payload !== 'object') {
            return { success: false, processedEntries: 0, messagesIngested: 0, duplicates: 0 };
        }

        const db = getDb();
        const objectType = String(payload.object || '').toLowerCase();
        const entries = Array.isArray(payload.entry) ? payload.entry : [];
        let messagesIngested = 0;
        let duplicates = 0;
        const platforms = objectType === 'instagram' ? ['instagram'] : objectType === 'threads' ? ['threads'] : ['facebook'];
        const toMs = (t: any) => {
            const n = typeof t === 'string' && !/^\d+$/.test(t) ? Date.parse(t) : Number(t);
            if (!Number.isFinite(n) || n <= 0) return undefined;
            return n < 1e12 ? n * 1000 : n;
        };

        for (const entry of entries) {
            const platformAccountId = String(entry.id || '');
            if (!platformAccountId) continue;
            const accounts = await db.socialAccount.findMany({ where: { platformAccountId, platform: { in: platforms }, isActive: true } });

            for (const account of accounts) {
                const claim = (id: string) => EngagementRateLimiter.claim(`wh:${account.id}:${id}`, 24 * 3_600_000);

                // 1. Messaging (Messenger / Instagram Direct)
                for (const m of Array.isArray(entry.messaging) ? entry.messaging : []) {
                    if (!m?.message || m.message.is_echo) continue; // our own outbound message
                    if (!m.message.text && !m.message.attachments) continue;
                    const senderId = String(m.sender?.id || '');
                    if (!senderId || senderId === platformAccountId) continue;
                    const mid = m.message.mid ? String(m.message.mid) : undefined;
                    if (mid && !(await claim(mid))) {
                        duplicates++;
                        continue;
                    }
                    const text = m.message.text || '[Media Attachment]';
                    const ingest = await SocialInboxService.ingestMessage({
                        companyId: account.companyId,
                        projectId: account.projectId || undefined,
                        socialAccountId: account.id,
                        platform: account.platform as any,
                        platformThreadId: senderId,
                        participantName: `User ${senderId.slice(-4)}`,
                        participantHandle: senderId,
                        messageContent: text,
                        platformMessageId: mid,
                    }).catch((err: any) => {
                        console.error('[MetaWebhook] DM ingest failed:', err?.message);
                        return null;
                    });
                    if (!ingest) continue;
                    if ((ingest as any).duplicate) {
                        duplicates++;
                        continue;
                    }
                    messagesIngested++;

                    const event: InboundEngagementEvent = {
                        companyId: account.companyId,
                        projectId: account.projectId || undefined,
                        socialAccountId: account.id,
                        platform: account.platform,
                        eventType: 'dm',
                        senderId,
                        senderHandle: senderId,
                        text,
                        timestamp: toMs(m.timestamp) ?? toMs(entry.time),
                    };
                    const rule = m.message.text ? await EngagementMatcher.findMatchingRule(event).catch(() => null) : null;
                    if (rule) {
                        await EngagementDispatcher.executeEngagement(rule, event).catch((err: any) => console.error('[MetaWebhook] DM rule failed:', err?.message));
                    } else {
                        const conv = (ingest as any).conversation;
                        // The agent itself checks the thread switch and the account's AI inbox mode.
                        if (conv && !conv.isHumanTakeover) {
                            const r = await AiEngagementAgent.handleIncomingDm(conv.id, text, account.companyId).catch((err: any) => ({ error: err?.message } as any));
                            if (r?.error) console.warn(`[MetaWebhook] AI agent did not reply (${r.errorCode || 'error'}): ${r.error}`);
                        }
                    }
                }

                // 2. Changes (IG comments, FB feed comments, Threads replies)
                for (const ch of Array.isArray(entry.changes) ? entry.changes : []) {
                    const val = ch?.value;
                    if (!val || !['comments', 'feed', 'replies'].includes(ch.field)) continue;
                    if (ch.field === 'feed' && (val.item !== 'comment' || (val.verb && val.verb !== 'add'))) continue;
                    const commentText = val.text || val.message || '';
                    const commentId = String(val.comment_id || val.id || '');
                    const fromId = String(val.from?.id || '');
                    if (!commentText || !commentId || !fromId || fromId === platformAccountId) continue; // our own replies never trigger rules
                    if (!(await claim(commentId))) {
                        duplicates++;
                        continue;
                    }
                    const fromUser = val.from?.name || val.from?.username || `User ${fromId.slice(-4)}`;
                    const fromHandle = val.from?.username || fromId;
                    const mediaId = val.media?.id || val.post_id || val.root_id || undefined;

                    const ingest = await SocialInboxService.ingestMessage({
                        companyId: account.companyId,
                        projectId: account.projectId || undefined,
                        socialAccountId: account.id,
                        platform: account.platform as any,
                        platformThreadId: commentThreadId(commentId),
                        participantName: fromUser,
                        participantHandle: fromHandle,
                        messageContent: commentText,
                        platformMessageId: commentId,
                    }).catch((err: any) => {
                        console.error('[MetaWebhook] comment ingest failed:', err?.message);
                        return null;
                    });
                    if ((ingest as any)?.duplicate) {
                        duplicates++;
                        continue;
                    }
                    if (ingest) messagesIngested++;

                    // The platform media id → our post (same company), so post-scoped rules match.
                    const variant = mediaId
                        ? await db.socialPostVariant.findFirst({ where: { externalId: String(mediaId), post: { companyId: account.companyId } }, select: { postId: true } }).catch(() => null)
                        : null;
                    const event: InboundEngagementEvent = {
                        companyId: account.companyId,
                        projectId: account.projectId || undefined,
                        socialAccountId: account.id,
                        platform: account.platform,
                        eventType: 'comment',
                        postId: variant?.postId,
                        mediaId,
                        commentId,
                        parentCommentId: val.parent_id || undefined,
                        senderId: fromId,
                        senderHandle: fromHandle,
                        senderName: fromUser,
                        text: commentText,
                        timestamp: toMs(val.created_time) ?? toMs(entry.time),
                    };
                    const rule = await EngagementMatcher.findMatchingRule(event).catch(() => null);
                    if (rule) {
                        await EngagementDispatcher.executeEngagement(rule, event).catch((err: any) => console.error('[MetaWebhook] rule failed:', err?.message));
                    } else {
                        const conv = (ingest as any)?.conversation;
                        if (conv && !conv.isHumanTakeover) {
                            const r = await AiEngagementAgent.handleIncomingDm(conv.id, commentText, account.companyId).catch((err: any) => ({ error: err?.message } as any));
                            if (r?.error) console.warn(`[MetaWebhook] AI agent did not reply to comment (${r.errorCode || 'error'}): ${r.error}`);
                        }
                    }
                }
            }
        }

        return { success: true, processedEntries: entries.length, messagesIngested, duplicates };
    }
}
