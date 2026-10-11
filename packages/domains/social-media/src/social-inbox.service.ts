import { prisma, requestContext } from '@workspace/db';
import { BrandVoiceService } from './brand-voice.service';
import { getDb } from './publishing/http';
import { SAFE_ACCOUNT_SELECT, SocialDomainError, notFound, requireCompanyId } from './tenant-scope';

export interface IngestMessageDTO {
    socialAccountId: string;
    platform: 'instagram' | 'facebook' | 'linkedin' | 'tiktok' | 'youtube' | 'threads';
    platformThreadId: string;
    participantName: string;
    participantHandle: string;
    participantAvatar?: string;
    messageContent: string;
    platformMessageId?: string;
    projectId?: string;
}

export class SocialInboxService {
    static async listConversations(filters?: { companyId?: string; projectId?: string; platform?: string; isRead?: boolean; search?: string }) {
        const companyId = filters?.companyId || (requestContext.getStore()?.companyId as string);
        if (!companyId) throw new Error('Company context required');

        const db = getDb();
        const whereClause: any = { companyId };
        if (filters?.projectId) {
            whereClause.OR = [{ projectId: filters.projectId }, { projectId: null }];
        }
        if (filters?.platform) whereClause.platform = filters.platform;
        if (filters?.isRead !== undefined) whereClause.isRead = filters.isRead;
        if (filters?.search && filters.search.trim()) {
            const query = filters.search.trim();
            whereClause.AND = [
                {
                    OR: [
                        { participantName: { contains: query, mode: 'insensitive' } },
                        { participantHandle: { contains: query, mode: 'insensitive' } },
                        { lastMessageSnippet: { contains: query, mode: 'insensitive' } },
                    ],
                },
            ];
        }

        const conversations = await db.socialConversation.findMany({
            where: whereClause,
            orderBy: { lastMessageAt: 'desc' },
            include: {
                socialAccount: { select: { id: true, accountName: true, username: true, platform: true, aiInboxMode: true } },
                project: { select: { id: true, name: true } },
                messages: { orderBy: { createdAt: 'asc' }, take: 50 }
            }
        });

        return conversations;
    }

    static async getConversation(id: string) {
        const companyId = requestContext.getStore()?.companyId as string;
        const db = getDb();
        const conversation = await db.socialConversation.findUnique({
            where: { id },
            include: {
                socialAccount: { select: { ...SAFE_ACCOUNT_SELECT, aiInboxMode: true } },
                project: true,
                messages: { orderBy: { createdAt: 'asc' } }
            }
        });

        if (!conversation || conversation.companyId !== companyId) {
            throw notFound('Conversation');
        }

        // Mark as read
        if (!conversation.isRead) {
            await db.socialConversation.update({
                where: { id },
                data: { isRead: true }
            }).catch(() => null);
        }

        return conversation;
    }

    /**
     * Sends a reply on the real platform (DM or public comment reply) and records it only once the provider accepted
     * it. Rate-limited sends answer 429 RATE_LIMITED with `retryAfterMs`.
     */
    static async sendMessage(conversationId: string, content: string, senderType: 'agent' | 'ai_bot' = 'agent') {
        const companyId = requireCompanyId(requestContext.getStore()?.companyId as string);
        const { sendToConversation } = require('./engagement/conversation-sender');
        const r = await sendToConversation(companyId, conversationId, content, senderType === 'ai_bot' ? 'ai_bot' : 'agent');
        if (r.status === 'rate_limited') {
            const e: any = new SocialDomainError('RATE_LIMITED', 429, `Rate limit reached for this account; try again in ${Math.ceil(r.retryAfterMs / 1000)}s`);
            e.details = { retryAfterMs: r.retryAfterMs };
            throw e;
        }
        return getDb().socialMessage.findFirst({ where: { id: r.messageId, conversationId } });
    }

    /**
     * AI smart replies: 3 options from the company's AI, grounded in the project's brand profile.
     * No provider → 503 AI_NOT_CONFIGURED (never canned suggestions).
     */
    static async generateAiSmartReplies(conversationId: string) {
        const companyId = requireCompanyId(requestContext.getStore()?.companyId as string);
        const db = getDb();
        const conversation = await db.socialConversation.findFirst({ where: { id: conversationId, companyId } });
        if (!conversation) throw notFound('Conversation');
        const ai = require('./engagement/engagement-ai');
        const llm = await ai.requireEngagementLlm(companyId);
        const brand = await ai.loadBrandForReplies(conversation.projectId, companyId);
        const history = await db.socialMessage.findMany({ where: { conversationId }, orderBy: { createdAt: 'desc' }, take: 8 });
        const transcript = history.reverse().map((m: any) => `${m.senderType === 'participant' ? 'USER' : 'BRAND'}: ${String(m.content).slice(0, 400)}`).join('\n');
        const prompt = `Suggest 3 different replies a ${conversation.platform} brand could send to the user's last message.
${brand.context ? `BRAND:\n${brand.context}\n` : ''}${brand.forbiddenWords.length ? `NEVER use: ${brand.forbiddenWords.join(', ')}\n` : ''}No invented prices, links or promises. Max 3 sentences each.
CONVERSATION:
${transcript || conversation.lastMessageSnippet || ''}
Return ONLY JSON: [{"tone": "short tone label", "text": "reply"}]`;
        const parsed = ai.parseLlmJson(await ai.generateWithTimeout(llm, prompt, 700));
        const suggestions = (Array.isArray(parsed) ? parsed : [])
            .map((s: any) => ({ tone: String(s?.tone || '').trim(), text: String(s?.text || '').trim() }))
            .filter((s: any) => s.text && !ai.findForbiddenWords(s.text, brand.forbiddenWords).length)
            .slice(0, 3);
        if (!suggestions.length) throw new SocialDomainError('AI_BAD_RESPONSE', 502, 'The AI provider returned no usable suggestions. Try again.');
        return { suggestions, brandToneApplied: brand.context ? 'project brand profile' : null };
    }

    /**
     * Converts a conversation into a CRM lead exactly once (idempotent): a second call returns the existing lead.
     */
    static async convertToCrmLead(conversationId: string, companyIdArg?: string, contact: { email?: string; phone?: string } = {}) {
        const db = getDb();
        const companyId = requireCompanyId(companyIdArg || (requestContext.getStore()?.companyId as string));
        const conversation = await db.socialConversation.findFirst({ where: { id: conversationId, companyId } });
        if (!conversation) throw notFound('Conversation');

        if (conversation.convertedLeadId) {
            const existing = await db.lead.findFirst({ where: { id: conversation.convertedLeadId, companyId } });
            if (existing) return { success: true, created: false, message: 'Conversation is already a CRM lead', lead: existing };
        }

        const lead = await db.lead.create({
            data: {
                companyId,
                name: conversation.participantName || `@${conversation.participantHandle}`,
                email: contact.email ?? null,
                phone: contact.phone ?? null,
                source: `Social (${String(conversation.platform).toUpperCase()})`,
                status: 'new',
                notes: `Captured from Social Inbox (${conversation.platform}): @${conversation.participantHandle}\nLast snippet: "${conversation.lastMessageSnippet || ''}"`,
            },
        });
        // Only the first writer links its lead; a concurrent second lead is removed again.
        const linked = await db.socialConversation.updateMany({
            where: { id: conversationId, companyId, OR: [{ convertedLeadId: null }, { convertedLeadId: conversation.convertedLeadId ?? null }] },
            data: { convertedLeadId: lead.id },
        });
        if (!linked.count) {
            await db.lead.deleteMany({ where: { id: lead.id, companyId } }).catch(() => null);
            const fresh = await db.socialConversation.findFirst({ where: { id: conversationId, companyId } });
            const existing = fresh?.convertedLeadId ? await db.lead.findFirst({ where: { id: fresh.convertedLeadId, companyId } }) : null;
            return { success: true, created: false, message: 'Conversation is already a CRM lead', lead: existing };
        }
        return { success: true, created: true, message: 'Converted conversation into a CRM lead', lead };
    }


    /**
     * Ingests an incoming message (or comment/mention) from a platform webhook into the database.
     * Upserts the conversation and inserts the message.
     */
    static async ingestMessage(dto: IngestMessageDTO & { companyId: string }) {
        const db = getDb();
        const {
            companyId,
            socialAccountId,
            platform,
            platformThreadId,
            participantName,
            participantHandle,
            participantAvatar,
            messageContent,
            platformMessageId,
            projectId,
        } = dto;

        // Upsert the conversation
        const conversation = await db.socialConversation.upsert({
            where: {
                companyId_platform_platformThreadId: {
                    companyId,
                    platform,
                    platformThreadId,
                },
            },
            update: {
                lastMessageSnippet: (messageContent || '').substring(0, 120),
                lastMessageAt: new Date(),
                isRead: false,
                ...(participantName ? { participantName } : {}),
                ...(participantHandle ? { participantHandle } : {}),
                ...(participantAvatar ? { participantAvatar } : {}),
            },
            create: {
                companyId,
                projectId: projectId ?? null,
                socialAccountId,
                platform,
                platformThreadId,
                participantName: participantName || participantHandle || 'Participant',
                participantHandle: participantHandle || 'anonymous',
                participantAvatar: participantAvatar ?? null,
                lastMessageSnippet: (messageContent || '').substring(0, 120),
                lastMessageAt: new Date(),
                isRead: false,
            },
        });

        // Idempotent on the provider message id (Meta re-delivers webhooks).
        if (platformMessageId) {
            const existing = await db.socialMessage.findFirst({ where: { conversationId: conversation.id, platformMessageId } });
            if (existing) return { conversation, message: existing, duplicate: true };
        }

        // Insert the incoming message
        const message = await db.socialMessage.create({
            data: {
                conversationId: conversation.id,
                senderType: 'participant',
                content: messageContent || '',
                platformMessageId: platformMessageId ?? null,
            },
        });

        return { conversation, message, duplicate: false };
    }

    /**
     * Active sync of conversations from connected platform accounts (Instagram Graph API, etc.)
     * Pulls recent DMs and media comments, ingesting them as SocialConversation and SocialMessage records.
     */
    static async syncConversations(params: { companyId: string; projectId?: string; platform?: string; includeSample?: boolean }) {

        const { companyId, projectId, platform, includeSample } = params;
        if (!companyId) throw new SocialDomainError('UNAUTHENTICATED', 401, 'Company context required');

        const db = getDb();
        const { SocialTokenVault } = require('./publishing/token-vault');
        const { metaGraphUrl } = require('./publishing/config');
        const { providerFetch, readBody } = require('./publishing/http');
        const { ThreadsAdapter } = require('./adapters/threads.adapter');
        const { LinkedInAdapter } = require('./adapters/linkedin.adapter');
        const { YouTubeAdapter } = require('./adapters/youtube.adapter');
        const { AiEngagementAgent } = require('./engagement/ai-engagement-agent');

        const where: any = { companyId, isActive: true };
        if (projectId) {
            where.OR = [{ projectId }, { projectId: null }];
        }
        if (platform) where.platform = platform;

        const accounts = await db.socialAccount.findMany({ where });
        let syncedCount = 0;
        const notes: string[] = [];

        for (const acc of accounts) {
            const plat = String(acc.platform).toLowerCase();
            const targetProjectId = acc.projectId || projectId || undefined;

            let token: string;
            try {
                token = await SocialTokenVault.getAccessToken(acc);
            } catch (err: any) {
                notes.push(`Account ${acc.accountName || acc.id}: cannot decrypt token (${err?.message || 'missing'})`);
                continue;
            }

            const platformAccountId = acc.platformAccountId;
            if (!platformAccountId) continue;

            // ── 1. INSTAGRAM ──────────────────────────────────────────────────────────
            if (plat === 'instagram') {
                // 1A. Direct Conversations & Message Thread History
                try {
                    const convUrl = metaGraphUrl(
                        `${encodeURIComponent(platformAccountId)}/conversations?platform=instagram&fields=id,updated_time,participants,messages{id,created_time,from,message,to}&limit=50`,
                        token,
                        'instagram'
                    );
                    const res = await providerFetch('instagram', convUrl, {
                        headers: { Authorization: `Bearer ${token}` },
                        timeoutMs: 15_000,
                    });
                    const body = await readBody(res);
                    if (res.ok && Array.isArray(body?.data)) {
                        for (const thread of body.data) {
                            const threadId = String(thread.id || '');
                            if (!threadId) continue;
                            const participants = Array.isArray(thread.participants?.data) ? thread.participants.data : [];
                            const other = participants.find((p: any) => String(p.id) !== platformAccountId) || participants[0];
                            const participantName = other?.name || other?.username || (other?.id ? `User ${String(other.id).slice(-4)}` : 'Instagram User');
                            const participantHandle = other?.username || other?.id || 'anonymous';

                            const msgs = Array.isArray(thread.messages?.data) ? thread.messages.data : [];
                            const latest = msgs[0];
                            const snippet = latest?.message || (latest?.from?.id === platformAccountId ? '[Sent attachment]' : '[Direct Message]');
                            const lastTime = thread.updated_time ? new Date(thread.updated_time) : (latest?.created_time ? new Date(latest.created_time) : new Date());

                            const conversation = await db.socialConversation.upsert({
                                where: {
                                    companyId_platform_platformThreadId: {
                                        companyId,
                                        platform: 'instagram',
                                        platformThreadId: threadId,
                                    },
                                },
                                update: {
                                    lastMessageSnippet: snippet.substring(0, 120),
                                    lastMessageAt: lastTime,
                                    ...(participantName ? { participantName } : {}),
                                    ...(participantHandle ? { participantHandle } : {}),
                                    ...(targetProjectId ? { projectId: targetProjectId } : {}),
                                },
                                create: {
                                    companyId,
                                    projectId: targetProjectId ?? null,
                                    socialAccountId: acc.id,
                                    platform: 'instagram',
                                    platformThreadId: threadId,
                                    participantName: participantName || participantHandle || 'Participant',
                                    participantHandle: participantHandle || 'anonymous',
                                    lastMessageSnippet: snippet.substring(0, 120),
                                    lastMessageAt: lastTime,
                                    isRead: false,
                                },
                            });

                            // Ingest messages chronologically
                            const chronological = [...msgs].reverse();
                            const pmids = chronological.map((m: any) => String(m.id || '')).filter(Boolean);
                            let existingSet = new Set<string>();
                            if (pmids.length > 0) {
                                const existing = await db.socialMessage.findMany({
                                    where: { conversationId: conversation.id, platformMessageId: { in: pmids } },
                                    select: { platformMessageId: true },
                                });
                                existingSet = new Set(existing.map((e: any) => e.platformMessageId).filter(Boolean) as string[]);
                            }

                            const newMessages = [];
                            for (const m of chronological) {
                                const pmid = String(m.id || '');
                                if (!pmid || existingSet.has(pmid)) continue;

                                const isFromMe = String(m.from?.id) === platformAccountId;
                                const senderType = isFromMe ? 'agent' : 'participant';
                                const content = m.message || (isFromMe ? '[Sent attachment]' : '[Received message]');
                                const createdAt = m.created_time ? new Date(m.created_time) : new Date();

                                newMessages.push({
                                    conversationId: conversation.id,
                                    senderType,
                                    content,
                                    platformMessageId: pmid,
                                    createdAt,
                                });
                            }

                            if (newMessages.length > 0) {
                                await db.socialMessage.createMany({
                                    data: newMessages,
                                    skipDuplicates: true,
                                });
                            }
                            syncedCount++;

                            // Autonomous AI Engagement Agent if enabled on account
                            if (acc.aiInboxMode && acc.aiInboxMode !== 'off' && !conversation.isHumanTakeover) {
                                const latestIsUser = latest?.from?.id !== platformAccountId;
                                if (latestIsUser && snippet) {
                                    AiEngagementAgent.handleIncomingDm(conversation.id, snippet, companyId).catch((err: any) => {
                                        console.warn(`[SyncAiAgent] IG DM auto-reply failed for ${conversation.id}:`, err?.message);
                                    });
                                }
                            }
                        }
                    } else if (body?.error) {
                        notes.push(`Instagram DMs: ${body.error.message || 'error'}`);
                    }
                } catch (err: any) {
                    console.warn('[SocialInboxSync] Instagram DMs fetch failed:', err?.message);
                    notes.push(`Instagram DMs sync: ${err?.message}`);
                }

                // 1B. Media Comments & Threaded Replies
                try {
                    const mediaUrl = metaGraphUrl(
                        `${encodeURIComponent(platformAccountId)}/media?fields=id,caption,timestamp,comments{id,text,timestamp,from,username,replies{id,text,timestamp,from,username}}&limit=25`,
                        token,
                        'instagram'
                    );
                    const res = await providerFetch('instagram', mediaUrl, {
                        headers: { Authorization: `Bearer ${token}` },
                        timeoutMs: 15_000,
                    });
                    const body = await readBody(res);
                    if (res.ok && Array.isArray(body?.data)) {
                        for (const media of body.data) {
                            const comments = Array.isArray(media.comments?.data) ? media.comments.data : [];
                            for (const c of comments) {
                                const cid = String(c.id || '');
                                if (!cid) continue;
                                const fromUser = c.from?.username || c.username || 'Instagram User';
                                const fromHandle = c.from?.username || c.username || 'anonymous';
                                const text = c.text || '';
                                if (!text) continue;
                                const commentTime = c.timestamp ? new Date(c.timestamp) : new Date();

                                const conv = await db.socialConversation.upsert({
                                    where: {
                                        companyId_platform_platformThreadId: {
                                            companyId,
                                            platform: 'instagram',
                                            platformThreadId: `comment:${cid}`,
                                        },
                                    },
                                    update: {
                                        lastMessageSnippet: text.substring(0, 120),
                                        lastMessageAt: commentTime,
                                        ...(targetProjectId ? { projectId: targetProjectId } : {}),
                                    },
                                    create: {
                                        companyId,
                                        projectId: targetProjectId ?? null,
                                        socialAccountId: acc.id,
                                        platform: 'instagram',
                                        platformThreadId: `comment:${cid}`,
                                        participantName: fromUser,
                                        participantHandle: fromHandle,
                                        lastMessageSnippet: text.substring(0, 120),
                                        lastMessageAt: commentTime,
                                        isRead: false,
                                    },
                                });

                                const messagesToInsert: any[] = [{
                                    conversationId: conv.id,
                                    senderType: 'participant',
                                    content: text,
                                    platformMessageId: cid,
                                    createdAt: commentTime,
                                }];

                                // Threaded comment replies
                                const nestedReplies = Array.isArray(c.replies?.data) ? c.replies.data : [];
                                for (const rep of nestedReplies) {
                                    const repId = String(rep.id || '');
                                    if (!repId) continue;
                                    const isFromBrand = String(rep.from?.username || rep.username) === String(acc.username);
                                    messagesToInsert.push({
                                        conversationId: conv.id,
                                        senderType: isFromBrand ? 'agent' : 'participant',
                                        content: rep.text || '',
                                        platformMessageId: repId,
                                        createdAt: rep.timestamp ? new Date(rep.timestamp) : new Date(),
                                    });
                                }

                                await db.socialMessage.createMany({
                                    data: messagesToInsert,
                                    skipDuplicates: true,
                                });
                                syncedCount++;

                                if (acc.aiInboxMode && acc.aiInboxMode !== 'off' && !conv.isHumanTakeover) {
                                    AiEngagementAgent.handleIncomingDm(conv.id, text, companyId).catch((err: any) => {
                                        console.warn(`[SyncAiAgent] IG Comment auto-reply failed for ${conv.id}:`, err?.message);
                                    });
                                }
                            }
                        }
                    } else if (body?.error) {
                        notes.push(`Instagram Comments: ${body.error.message || 'error'}`);
                    }
                } catch (err: any) {
                    console.warn('[SocialInboxSync] Instagram media comments fetch failed:', err?.message);
                    notes.push(`Instagram comments sync: ${err?.message}`);
                }

                // 1C. Tagged Media & Story/Post Mentions
                try {
                    const tagsUrl = metaGraphUrl(
                        `${encodeURIComponent(platformAccountId)}/tags?fields=id,caption,comments{id,text,timestamp,from,username},username,timestamp&limit=15`,
                        token,
                        'instagram'
                    );
                    const res = await providerFetch('instagram', tagsUrl, {
                        headers: { Authorization: `Bearer ${token}` },
                        timeoutMs: 15_000,
                    });
                    const body = await readBody(res);
                    if (res.ok && Array.isArray(body?.data)) {
                        for (const tagged of body.data) {
                            const tid = String(tagged.id || '');
                            if (!tid) continue;
                            const tagUser = tagged.username || 'Instagram User';
                            const tagCaption = tagged.caption ? `[Tagged in post]: ${tagged.caption}` : `Tagged in post by @${tagUser}`;
                            const tagTime = tagged.timestamp ? new Date(tagged.timestamp) : new Date();

                            const conv = await db.socialConversation.upsert({
                                where: {
                                    companyId_platform_platformThreadId: {
                                        companyId,
                                        platform: 'instagram',
                                        platformThreadId: `tag:${tid}`,
                                    },
                                },
                                update: {
                                    lastMessageSnippet: tagCaption.substring(0, 120),
                                    lastMessageAt: tagTime,
                                    ...(targetProjectId ? { projectId: targetProjectId } : {}),
                                },
                                create: {
                                    companyId,
                                    projectId: targetProjectId ?? null,
                                    socialAccountId: acc.id,
                                    platform: 'instagram',
                                    platformThreadId: `tag:${tid}`,
                                    participantName: tagUser,
                                    participantHandle: tagUser,
                                    lastMessageSnippet: tagCaption.substring(0, 120),
                                    lastMessageAt: tagTime,
                                    isRead: false,
                                },
                            });

                            await db.socialMessage.createMany({
                                data: [{
                                    conversationId: conv.id,
                                    senderType: 'participant',
                                    content: tagCaption,
                                    platformMessageId: `tag_${tid}`,
                                    createdAt: tagTime,
                                }],
                                skipDuplicates: true,
                            });
                            syncedCount++;
                        }
                    }
                } catch (err: any) {
                    console.warn('[SocialInboxSync] Instagram tagged media sync failed:', err?.message);
                }
            }

            // ── 2. FACEBOOK ───────────────────────────────────────────────────────────
            else if (plat === 'facebook') {
                // 2A. Facebook Page Messenger DMs
                try {
                    const fbConvUrl = metaGraphUrl(
                        `${encodeURIComponent(platformAccountId)}/conversations?fields=id,updated_time,participants,messages{id,created_time,from,message,to}&limit=30`,
                        token,
                        'facebook'
                    );
                    const res = await providerFetch('facebook', fbConvUrl, {
                        headers: { Authorization: `Bearer ${token}` },
                        timeoutMs: 15_000,
                    });
                    const body = await readBody(res);
                    if (res.ok && Array.isArray(body?.data)) {
                        for (const thread of body.data) {
                            const threadId = String(thread.id || '');
                            if (!threadId) continue;
                            const participants = Array.isArray(thread.participants?.data) ? thread.participants.data : [];
                            const other = participants.find((p: any) => String(p.id) !== platformAccountId) || participants[0];
                            const participantName = other?.name || 'Facebook User';
                            const participantHandle = other?.name ? String(other.name).toLowerCase().replace(/\s+/g, '.') : other?.id || 'facebook.user';

                            const msgs = Array.isArray(thread.messages?.data) ? thread.messages.data : [];
                            const latest = msgs[0];
                            const snippet = latest?.message || '[Messenger Message]';
                            const lastTime = thread.updated_time ? new Date(thread.updated_time) : (latest?.created_time ? new Date(latest.created_time) : new Date());

                            const conversation = await db.socialConversation.upsert({
                                where: {
                                    companyId_platform_platformThreadId: {
                                        companyId,
                                        platform: 'facebook',
                                        platformThreadId: threadId,
                                    },
                                },
                                update: {
                                    lastMessageSnippet: snippet.substring(0, 120),
                                    lastMessageAt: lastTime,
                                    ...(participantName ? { participantName } : {}),
                                    ...(targetProjectId ? { projectId: targetProjectId } : {}),
                                },
                                create: {
                                    companyId,
                                    projectId: targetProjectId ?? null,
                                    socialAccountId: acc.id,
                                    platform: 'facebook',
                                    platformThreadId: threadId,
                                    participantName,
                                    participantHandle,
                                    lastMessageSnippet: snippet.substring(0, 120),
                                    lastMessageAt: lastTime,
                                    isRead: false,
                                },
                            });

                            const chronological = [...msgs].reverse();
                            const newMessages = [];
                            for (const m of chronological) {
                                const pmid = String(m.id || '');
                                const isFromPage = String(m.from?.id) === platformAccountId;
                                const content = m.message || (isFromPage ? '[Sent message]' : '[Received message]');
                                newMessages.push({
                                    conversationId: conversation.id,
                                    senderType: isFromPage ? 'agent' : 'participant',
                                    content,
                                    platformMessageId: pmid || undefined,
                                    createdAt: m.created_time ? new Date(m.created_time) : new Date(),
                                });
                            }

                            if (newMessages.length > 0) {
                                await db.socialMessage.createMany({ data: newMessages, skipDuplicates: true });
                            }
                            syncedCount++;

                            if (acc.aiInboxMode && acc.aiInboxMode !== 'off' && !conversation.isHumanTakeover) {
                                const latestIsUser = latest?.from?.id !== platformAccountId;
                                if (latestIsUser && snippet) {
                                    AiEngagementAgent.handleIncomingDm(conversation.id, snippet, companyId).catch((err: any) => {
                                        console.warn(`[SyncAiAgent] FB DM auto-reply failed for ${conversation.id}:`, err?.message);
                                    });
                                }
                            }
                        }
                    }
                } catch (err: any) {
                    console.warn('[SocialInboxSync] Facebook DMs fetch failed:', err?.message);
                    notes.push(`Facebook DMs sync: ${err?.message}`);
                }

                // 2B. Facebook Page Posts & Comments
                try {
                    const fbPostsUrl = metaGraphUrl(
                        `${encodeURIComponent(platformAccountId)}/posts?fields=id,message,created_time,comments{id,message,created_time,from,comments{id,message,created_time,from}}&limit=20`,
                        token,
                        'facebook'
                    );
                    const res = await providerFetch('facebook', fbPostsUrl, {
                        headers: { Authorization: `Bearer ${token}` },
                        timeoutMs: 15_000,
                    });
                    const body = await readBody(res);
                    if (res.ok && Array.isArray(body?.data)) {
                        for (const post of body.data) {
                            const rawComments = Array.isArray(post.comments?.data) ? post.comments.data : [];
                            const allComments: any[] = [];
                            for (const c of rawComments) {
                                allComments.push(c);
                                if (Array.isArray(c.comments?.data)) {
                                    for (const nested of c.comments.data) allComments.push(nested);
                                }
                            }
                            for (const c of allComments) {
                                const cid = String(c.id || '');
                                if (!cid) continue;
                                const fromUser = c.from?.name || 'Facebook User';
                                const fromHandle = c.from?.name ? String(c.from.name).toLowerCase().replace(/\s+/g, '.') : 'anonymous';
                                const text = c.message || '';
                                if (!text) continue;
                                const commentTime = c.created_time ? new Date(c.created_time) : new Date();

                                const conv = await db.socialConversation.upsert({
                                    where: {
                                        companyId_platform_platformThreadId: {
                                            companyId,
                                            platform: 'facebook',
                                            platformThreadId: `comment:${cid}`,
                                        },
                                    },
                                    update: {
                                        lastMessageSnippet: text.substring(0, 120),
                                        lastMessageAt: commentTime,
                                        ...(targetProjectId ? { projectId: targetProjectId } : {}),
                                    },
                                    create: {
                                        companyId,
                                        projectId: targetProjectId ?? null,
                                        socialAccountId: acc.id,
                                        platform: 'facebook',
                                        platformThreadId: `comment:${cid}`,
                                        participantName: fromUser,
                                        participantHandle: fromHandle,
                                        lastMessageSnippet: text.substring(0, 120),
                                        lastMessageAt: commentTime,
                                        isRead: false,
                                    },
                                });

                                await db.socialMessage.createMany({
                                    data: [{
                                        conversationId: conv.id,
                                        senderType: 'participant',
                                        content: text,
                                        platformMessageId: cid,
                                        createdAt: commentTime,
                                    }],
                                    skipDuplicates: true,
                                });
                                syncedCount++;

                                if (acc.aiInboxMode && acc.aiInboxMode !== 'off' && !conv.isHumanTakeover) {
                                    AiEngagementAgent.handleIncomingDm(conv.id, text, companyId).catch((err: any) => {
                                        console.warn(`[SyncAiAgent] FB comment auto-reply failed for ${conv.id}:`, err?.message);
                                    });
                                }
                            }
                        }
                    }
                } catch (err: any) {
                    console.warn('[SocialInboxSync] Facebook comments fetch failed:', err?.message);
                    notes.push(`Facebook comments sync: ${err?.message}`);
                }
            }

            // ── 3. THREADS ────────────────────────────────────────────────────────────
            else if (plat === 'threads') {
                try {
                    const threads = await ThreadsAdapter.fetchThreads(platformAccountId, token, 20);
                    for (const t of threads) {
                        const tid = String(t.id || '');
                        if (!tid) continue;
                        const replies = await ThreadsAdapter.fetchReplies(tid, token, 30);
                        for (const rep of replies) {
                            const rid = String(rep.id || '');
                            if (!rid) continue;
                            const text = rep.text || '';
                            if (!text) continue;
                            const user = rep.username || 'Threads User';
                            const repTime = rep.timestamp ? new Date(rep.timestamp) : new Date();

                            const conv = await db.socialConversation.upsert({
                                where: {
                                    companyId_platform_platformThreadId: {
                                        companyId,
                                        platform: 'threads',
                                        platformThreadId: `comment:${rid}`,
                                    },
                                },
                                update: {
                                    lastMessageSnippet: text.substring(0, 120),
                                    lastMessageAt: repTime,
                                    ...(targetProjectId ? { projectId: targetProjectId } : {}),
                                },
                                create: {
                                    companyId,
                                    projectId: targetProjectId ?? null,
                                    socialAccountId: acc.id,
                                    platform: 'threads',
                                    platformThreadId: `comment:${rid}`,
                                    participantName: user,
                                    participantHandle: user,
                                    lastMessageSnippet: text.substring(0, 120),
                                    lastMessageAt: repTime,
                                    isRead: false,
                                },
                            });

                            await db.socialMessage.createMany({
                                data: [{
                                    conversationId: conv.id,
                                    senderType: 'participant',
                                    content: text,
                                    platformMessageId: rid,
                                    createdAt: repTime,
                                }],
                                skipDuplicates: true,
                            });
                            syncedCount++;

                            if (acc.aiInboxMode && acc.aiInboxMode !== 'off' && !conv.isHumanTakeover) {
                                AiEngagementAgent.handleIncomingDm(conv.id, text, companyId).catch((err: any) => {
                                    console.warn(`[SyncAiAgent] Threads reply auto-reply failed for ${conv.id}:`, err?.message);
                                });
                            }
                        }
                    }
                } catch (err: any) {
                    console.warn('[SocialInboxSync] Threads sync failed:', err?.message);
                    notes.push(`Threads sync: ${err?.message}`);
                }
            }

            // ── 4. LINKEDIN ───────────────────────────────────────────────────────────
            else if (plat === 'linkedin') {
                try {
                    const posts = await LinkedInAdapter.fetchPosts(platformAccountId, token, 15);
                    for (const p of posts) {
                        const postUrn = p.urn || p.id;
                        if (!postUrn) continue;
                        const comments = await LinkedInAdapter.fetchComments(postUrn, token, 25);
                        for (const c of comments) {
                            const cid = c.id || c.urn || '';
                            if (!cid) continue;
                            const text = c.message?.text || '';
                            if (!text) continue;
                            const actor = c.actor || 'LinkedIn Member';
                            const cleanHandle = String(actor).replace(/^urn:li:(person|organization):/, '');

                            const conv = await db.socialConversation.upsert({
                                where: {
                                    companyId_platform_platformThreadId: {
                                        companyId,
                                        platform: 'linkedin',
                                        platformThreadId: `comment:${cid}`,
                                    },
                                },
                                update: {
                                    lastMessageSnippet: text.substring(0, 120),
                                    lastMessageAt: new Date(),
                                    ...(targetProjectId ? { projectId: targetProjectId } : {}),
                                },
                                create: {
                                    companyId,
                                    projectId: targetProjectId ?? null,
                                    socialAccountId: acc.id,
                                    platform: 'linkedin',
                                    platformThreadId: `comment:${cid}`,
                                    participantName: cleanHandle || 'LinkedIn Member',
                                    participantHandle: cleanHandle || 'linkedin.member',
                                    lastMessageSnippet: text.substring(0, 120),
                                    lastMessageAt: new Date(),
                                    isRead: false,
                                },
                            });

                            await db.socialMessage.createMany({
                                data: [{
                                    conversationId: conv.id,
                                    senderType: 'participant',
                                    content: text,
                                    platformMessageId: cid,
                                    createdAt: new Date(),
                                }],
                                skipDuplicates: true,
                            });
                            syncedCount++;

                            if (acc.aiInboxMode && acc.aiInboxMode !== 'off' && !conv.isHumanTakeover) {
                                AiEngagementAgent.handleIncomingDm(conv.id, text, companyId).catch((err: any) => {
                                    console.warn(`[SyncAiAgent] LinkedIn comment auto-reply failed for ${conv.id}:`, err?.message);
                                });
                            }
                        }
                    }
                } catch (err: any) {
                    console.warn('[SocialInboxSync] LinkedIn sync failed:', err?.message);
                    notes.push(`LinkedIn sync: ${err?.message}`);
                }
            }

            // ── 5. YOUTUBE ────────────────────────────────────────────────────────────
            else if (plat === 'youtube') {
                try {
                    const videos = await YouTubeAdapter.fetchChannelVideos(platformAccountId, token, 15);
                    for (const v of videos) {
                        const vid = v.id?.videoId || (typeof v.id === 'string' ? v.id : '');
                        if (!vid) continue;
                        const threads = await YouTubeAdapter.fetchComments(vid, token, 30);
                        for (const item of threads) {
                            const commentsToIngest: any[] = [];
                            if (item.snippet?.topLevelComment) commentsToIngest.push(item.snippet.topLevelComment);
                            if (Array.isArray(item.replies?.comments)) {
                                for (const rep of item.replies.comments) commentsToIngest.push(rep);
                            }
                            for (const c of commentsToIngest) {
                                const cid = c.id;
                                if (!cid) continue;
                                const text = c.snippet?.textDisplay || c.snippet?.textOriginal || '';
                                if (!text) continue;
                                const author = c.snippet?.authorDisplayName || 'YouTube User';
                                const avatar = c.snippet?.authorProfileImageUrl;
                                const cTime = c.snippet?.publishedAt ? new Date(c.snippet.publishedAt) : new Date();

                                const conv = await db.socialConversation.upsert({
                                    where: {
                                        companyId_platform_platformThreadId: {
                                            companyId,
                                            platform: 'youtube',
                                            platformThreadId: `comment:${cid}`,
                                        },
                                    },
                                    update: {
                                        lastMessageSnippet: text.substring(0, 120),
                                        lastMessageAt: cTime,
                                        ...(avatar ? { participantAvatar: avatar } : {}),
                                        ...(targetProjectId ? { projectId: targetProjectId } : {}),
                                    },
                                    create: {
                                        companyId,
                                        projectId: targetProjectId ?? null,
                                        socialAccountId: acc.id,
                                        platform: 'youtube',
                                        platformThreadId: `comment:${cid}`,
                                        participantName: author,
                                        participantHandle: author.toLowerCase().replace(/\s+/g, '_'),
                                        participantAvatar: avatar ?? null,
                                        lastMessageSnippet: text.substring(0, 120),
                                        lastMessageAt: cTime,
                                        isRead: false,
                                    },
                                });

                                await db.socialMessage.createMany({
                                    data: [{
                                        conversationId: conv.id,
                                        senderType: 'participant',
                                        content: text,
                                        platformMessageId: cid,
                                        createdAt: cTime,
                                    }],
                                    skipDuplicates: true,
                                });
                                syncedCount++;

                                if (acc.aiInboxMode && acc.aiInboxMode !== 'off' && !conv.isHumanTakeover) {
                                    AiEngagementAgent.handleIncomingDm(conv.id, text, companyId).catch((err: any) => {
                                        console.warn(`[SyncAiAgent] YouTube comment auto-reply failed for ${conv.id}:`, err?.message);
                                    });
                                }
                            }
                        }
                    }
                } catch (err: any) {
                    console.warn('[SocialInboxSync] YouTube sync failed:', err?.message);
                    notes.push(`YouTube sync: ${err?.message}`);
                }
            }
        }

        if (syncedCount === 0 && includeSample && accounts.length > 0) {
            await SocialInboxService.seedTestConversation(companyId, projectId, accounts[0].id);
            syncedCount++;
            notes.push('Sample conversation seeded for verification.');
        }

        return {
            synced: syncedCount,
            accountsChecked: accounts.length,
            notes,
        };
    }

    /**
     * Seeds a realistic incoming test conversation for local verification.
     */
    static async seedTestConversation(companyId: string, projectId?: string | null, socialAccountId?: string) {
        const db = getDb();
        const account = socialAccountId
            ? await db.socialAccount.findFirst({ where: { id: socialAccountId, companyId } })
            : await db.socialAccount.findFirst({ where: { companyId, platform: 'instagram', isActive: true } })
              || await db.socialAccount.findFirst({ where: { companyId, isActive: true } });

        if (!account) {
            throw new SocialDomainError('ACCOUNT_NOT_FOUND', 404, 'No active social account found to connect test conversation to.');
        }

        const sid = account.id;
        const pid = projectId || account.projectId || undefined;

        return SocialInboxService.ingestMessage({
            companyId,
            projectId: pid,
            socialAccountId: sid,
            platform: (account.platform as any) || 'instagram',
            platformThreadId: `test_${Date.now()}`,
            participantName: 'Alex Rivera',
            participantHandle: 'alex.rivera.brand',
            messageContent: 'Hey! Loved your recent video on personal branding. Are you currently taking new 1-on-1 strategy clients?',
            platformMessageId: `msg_${Date.now()}`,
        });
    }
}

