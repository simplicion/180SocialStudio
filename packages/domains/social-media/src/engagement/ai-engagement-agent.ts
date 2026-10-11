import { getDb } from '../publishing/http';
import { SocialInboxService } from '../social-inbox.service';
import { generateWithTimeout, findForbiddenWords, loadBrandForReplies, parseLlmJson, requireEngagementLlm } from './engagement-ai';
import { sendToConversation } from './conversation-sender';
import { fenceUntrusted, UNTRUSTED_DATA_POLICY } from '@workspace/ai/agent-runs';

export interface AiAgentTurnOutcome {
    replied: boolean;
    replyText?: string;
    leadConverted: boolean;
    humanEscalated: boolean;
    /** Set when nothing was sent; a typed code such as AI_NOT_CONFIGURED, AI_TIMEOUT, RATE_LIMITED, FORBIDDEN_WORDS. */
    error?: string;
    errorCode?: string;
    /** Lead qualification the AI reported for this turn (qualify goal only). */
    qualification?: LeadQualification;
}

export const AI_INBOX_MODES = ['off', 'reply', 'qualify'] as const;
export type AiInboxMode = (typeof AI_INBOX_MODES)[number];
export const LEAD_STAGES = ['new', 'engaged', 'qualified', 'disqualified', 'handoff'] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

/** What the person actually said about each criterion (null = not said yet) plus the AI's stage and 0-100 score. */
export interface LeadQualification {
    need: string | null;
    budget: string | null;
    timeline: string | null;
    authority: string | null;
    fit: 'good' | 'unclear' | 'poor';
    score: number;
    stage: LeadStage;
    reason: string | null;
}

const str = (v: unknown, max = 200): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

/** Validates the model's qualification block; anything malformed is dropped rather than guessed. */
export function parseLeadQualification(raw: any): LeadQualification | null {
    if (!raw || typeof raw !== 'object') return null;
    const score = Number(raw.score);
    if (!Number.isFinite(score) || score < 0 || score > 100) return null;
    if (!LEAD_STAGES.includes(raw.stage)) return null;
    const fit = ['good', 'unclear', 'poor'].includes(raw.fit) ? raw.fit : 'unclear';
    return {
        need: str(raw.need),
        budget: str(raw.budget),
        timeline: str(raw.timeline),
        authority: str(raw.authority),
        fit,
        score: Math.round(score),
        stage: raw.stage,
        reason: str(raw.reason, 300),
    };
}

const GOALS: Record<string, string> = {
    qualify_lead: 'Qualify the lead: understand their need and, when it fits, ask for an email or phone number so the team can follow up.',
    answer_support: 'Answer support questions accurately. If you do not know, say the team will follow up.',
    book_demo: 'Help them book a demo: ask for their email so the team can send a booking link.',
    deliver_resource: 'Make sure they received the resource they asked for and answer follow-up questions.',
    answer_questions: 'Answer their questions helpfully from the brand profile. If they show buying intent, ask what they need so the team can help.',
};

const QUALIFY_CRITERIA = `Qualify with these criteria, using ONLY what the person wrote: need (what they want), budget, timeline, authority (do they decide), fit with the brand's offer.
Stage: "new" (no info yet), "engaged" (talking, criteria incomplete), "qualified" (clear need + fit, and budget or timeline fits), "disqualified" (clearly not a fit or spam), "handoff" (ready to buy / wants a call / needs a person).
Ask at most ONE qualifying question per reply, the most important missing one.`;

export class AiEngagementAgent {
    static readonly EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
    static readonly PHONE_REGEX = /(\+?[0-9]{1,3}[-.\s]?)?(\(?[0-9]{3}\)?[-.\s]?)[0-9]{3}[-.\s]?[0-9]{4}/;
    /** Explicit requests for a person. Deterministic, checked before any AI call. */
    public static readonly HUMAN_ESCALATION_KEYWORDS = [
        'talk to a human', 'speak to a human', 'real human', 'a human please', 'talk to a person', 'talk to someone', 'speak to someone',
        'talk to an agent', 'talk to agent', 'real person', 'support agent', 'live agent', 'stop bot', 'representative', 'operator',
    ];

    /**
     * One turn of the AI DM agent for an inbound message. Only runs when the conversation has the agent on and no human
     * took over. Tenant-scoped by `companyId`. Never sends canned text: every reply comes from the company's AI with the
     * project's brand profile; failures leave the message for a human (typed error on the outcome).
     */
    static async handleIncomingDm(conversationId: string, incomingText: string, companyId?: string): Promise<AiAgentTurnOutcome> {
        const db = getDb();
        const outcome: AiAgentTurnOutcome = { replied: false, leadConverted: false, humanEscalated: false };

        const conversation = await db.socialConversation.findFirst({ where: companyId ? { id: conversationId, companyId } : { id: conversationId } });
        if (!conversation) {
            outcome.error = `Conversation ${conversationId} not found`;
            outcome.errorCode = 'NOT_FOUND';
            return outcome;
        }
        const tenant = conversation.companyId as string;
        // A thread a human took over is never answered. Otherwise the thread's own switch or the account's AI inbox mode
        // turns the agent on.
        if (conversation.isHumanTakeover) return outcome;
        const account = await db.socialAccount.findFirst({
            where: { id: conversation.socialAccountId, companyId: tenant },
            select: { aiInboxMode: true, aiInboxInstructions: true },
        });
        const accountMode: AiInboxMode = AI_INBOX_MODES.includes(account?.aiInboxMode) ? account.aiInboxMode : 'off';
        if (!conversation.aiAgentActive && accountMode === 'off') return outcome;

        const normalized = String(incomingText || '').toLowerCase();
        if (this.HUMAN_ESCALATION_KEYWORDS.some((kw) => normalized.includes(kw))) {
            await db.socialConversation.updateMany({ where: { id: conversationId, companyId: tenant }, data: { isHumanTakeover: true, isRead: false } });
            outcome.humanEscalated = true;
            return outcome;
        }

        // Lead capture: an email or phone in the message converts the thread to a CRM lead once.
        if (this.EMAIL_REGEX.test(incomingText) || this.PHONE_REGEX.test(incomingText)) {
            try {
                const r = await SocialInboxService.convertToCrmLead(conversationId, tenant, {
                    email: incomingText.match(this.EMAIL_REGEX)?.[0],
                    phone: incomingText.match(this.PHONE_REGEX)?.[0],
                });
                outcome.leadConverted = r.created;
            } catch (err: any) {
                console.warn(`[AiEngagementAgent] lead conversion failed: ${err.message}`);
            }
        }

        try {
            const llm = await requireEngagementLlm(tenant);
            const brand = await loadBrandForReplies(conversation.projectId, tenant);
            const history = await db.socialMessage.findMany({ where: { conversationId }, orderBy: { createdAt: 'desc' }, take: 10 });
            const transcript = history
                .reverse()
                .map((m: any) => `${m.senderType === 'participant' ? 'USER' : 'BRAND'}: ${String(m.content).slice(0, 500)}`)
                .join('\n');
            const rule = await db.socialEngagementRule.findFirst({ where: { companyId: tenant, socialAccountId: conversation.socialAccountId, status: 'active', actionEnableAiAgent: true } });
            // A funnel rule's goal wins; otherwise the account's AI inbox mode decides.
            const goalKey = rule?.aiAgentGoal || (accountMode === 'reply' ? 'answer_questions' : 'qualify_lead');
            const goal = GOALS[goalKey] || GOALS.qualify_lead;
            const qualify = goalKey === 'qualify_lead';
            const extra = [rule?.aiAgentPromptOverride, account?.aiInboxInstructions].filter((x) => typeof x === 'string' && x.trim()).map((x) => String(x).slice(0, 1000));

            const prompt = `You are the ${conversation.platform} DM assistant for the brand below. Reply to the person's last message.
${UNTRUSTED_DATA_POLICY}
${brand.context ? `BRAND:\n${brand.context}\n` : ''}GOAL: ${goal}
${qualify ? `${QUALIFY_CRITERIA}\n` : ''}${extra.length ? `INSTRUCTIONS FROM THE BRAND: ${extra.join(' ')}\n` : ''}${brand.forbiddenWords.length ? `NEVER use these words: ${brand.forbiddenWords.join(', ')}\n` : ''}${outcome.leadConverted ? 'The person just shared contact details; thank them and say the team will follow up.\n' : ''}Rules: at most 3 short sentences, no invented prices, links, discounts or promises. If the person is angry, asks for something you cannot answer, or wants a person, set "escalate": true.
${fenceUntrusted('comment', transcript || `USER: ${incomingText}`, { label: 'conversation', maxChars: 6000 }).block}
Return ONLY JSON: {"reply": "...", "intent": "lead|question|support|praise|complaint|spam|other", "escalate": false${qualify ? ', "qualification": {"need": null, "budget": null, "timeline": null, "authority": null, "fit": "good|unclear|poor", "score": 0, "stage": "new|engaged|qualified|disqualified|handoff", "reason": "..."}' : ''}}`;

            let parsed = parseLlmJson(await generateWithTimeout(llm, prompt, qualify ? 600 : 400));
            let reply = typeof parsed?.reply === 'string' ? parsed.reply.trim() : '';
            if (reply && findForbiddenWords(reply, brand.forbiddenWords).length) {
                parsed = parseLlmJson(await generateWithTimeout(llm, `${prompt}\nYour previous answer used a forbidden word. Rewrite without: ${brand.forbiddenWords.join(', ')}`, 400));
                reply = typeof parsed?.reply === 'string' ? parsed.reply.trim() : '';
                if (findForbiddenWords(reply, brand.forbiddenWords).length) {
                    outcome.errorCode = 'FORBIDDEN_WORDS';
                    outcome.error = 'The AI reply used forbidden brand words; left for a human.';
                    return outcome;
                }
            }
            if (parsed?.escalate === true) {
                await db.socialConversation.updateMany({ where: { id: conversationId, companyId: tenant }, data: { isHumanTakeover: true, isRead: false } });
                outcome.humanEscalated = true;
                return outcome;
            }
            if (!reply) {
                outcome.errorCode = 'AI_BAD_RESPONSE';
                outcome.error = 'The AI provider returned no usable reply.';
                return outcome;
            }

            const sent = await sendToConversation(tenant, conversationId, reply, 'ai_bot');
            if (sent.status === 'rate_limited') {
                outcome.errorCode = 'RATE_LIMITED';
                outcome.error = `Rate limited; the conversation stays unread for a human (retry in ${Math.ceil(sent.retryAfterMs / 1000)}s).`;
                return outcome;
            }
            outcome.replied = true;
            outcome.replyText = reply;

            const q = qualify ? parseLeadQualification(parsed?.qualification) : null;
            if (q) {
                outcome.qualification = q;
                await this.recordQualification(conversation, q);
            }
        } catch (err: any) {
            outcome.errorCode = err?.code || 'SEND_FAILED';
            outcome.error = err?.message || String(err);
        }
        return outcome;
    }

    /**
     * Stores the qualification on the conversation. The first time a lead becomes qualified (or asks for a person),
     * the thread is marked unread and the project owner is notified; a handoff also hands the thread to a human.
     */
    static async recordQualification(conversation: any, q: LeadQualification) {
        const db = getDb();
        const tenant = conversation.companyId as string;
        const hot = q.stage === 'qualified' || q.stage === 'handoff';
        const firstTime = hot && !conversation.leadQualifiedAt;
        await db.socialConversation.updateMany({
            where: { id: conversation.id, companyId: tenant },
            data: {
                leadScore: q.score,
                leadStage: q.stage,
                leadQualification: q as any,
                ...(firstTime ? { leadQualifiedAt: new Date(), isRead: false } : {}),
                ...(q.stage === 'handoff' ? { isHumanTakeover: true } : {}),
            },
        });
        if (!firstTime || !conversation.projectId) return;
        const project = await db.project.findFirst({ where: { id: conversation.projectId, companyId: tenant }, select: { ownerId: true } });
        if (!project?.ownerId) return;
        await db.notification
            .create({
                data: {
                    userId: project.ownerId,
                    type: 'social_lead_qualified',
                    title: q.stage === 'handoff' ? `@${conversation.participantHandle} wants to talk to you` : `Qualified lead: @${conversation.participantHandle}`,
                    message: `${q.need ? `Needs: ${q.need}. ` : ''}${q.budget ? `Budget: ${q.budget}. ` : ''}${q.timeline ? `Timeline: ${q.timeline}. ` : ''}Score ${q.score}/100 on ${conversation.platform}.`.slice(0, 1000),
                    link: `/inbox?conversationId=${conversation.id}`,
                },
            })
            .catch((err: any) => console.warn(`[AiEngagementAgent] lead notification failed: ${err?.message}`));
    }
}
