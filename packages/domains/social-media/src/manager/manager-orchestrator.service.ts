import { fenceUntrusted, sanitizeInlineUntrusted, UNTRUSTED_DATA_POLICY } from '@workspace/ai/agent-runs';
import { getDb } from '../publishing/http';
import { ManagerTurnResult, ManagerAction, ManagerUserIntent, DelegatedAgentType } from './types';
import { AnalyticsSubagent } from './analytics-subagent';
import { CalendarSubagent, PivotRegenerate } from './calendar-subagent';
import { InboxSubagent } from './inbox-subagent';
import { DirectorSubagent } from './director-subagent';
import { requireCompanyId, SocialDomainError, notFound } from '../tenant-scope';
import { requireEngagementLlm, generateWithTimeout, parseLlmJson, loadBrandForReplies } from '../engagement/engagement-ai';

const INTENTS: ManagerUserIntent[] = ['analytics', 'calendar_update', 'inbox_hunt', 'director_rule', 'video_intel', 'general_query'];
const AGENTS: DelegatedAgentType[] = ['analytics', 'calendar', 'inbox', 'director', 'video_intel'];
const ACTION_TYPES: ManagerAction['type'][] = ['update_calendar', 'open_inbox_conversation', 'apply_director_rule', 'analyze_video', 'quick_reply'];
const MAX_MESSAGE = 4000;
const HISTORY_TURNS = 12;

type Section<T> = { ok: true; data: T } | { ok: false; unavailable: string };
const section = async <T>(p: Promise<T>): Promise<Section<T>> => {
    try {
        return { ok: true, data: await p };
    } catch (err: any) {
        return { ok: false, unavailable: String(err?.message || err).slice(0, 160) };
    }
};
const view = <T>(s: Section<T> | null) => (s == null ? 'not loaded (no project selected)' : s.ok ? s.data : `UNAVAILABLE: ${(s as { unavailable: string }).unavailable}`);

/** Keeps only well-formed actions the client can run; ids that the context did not produce are dropped. */
export function sanitizeManagerActions(raw: unknown, ctx: { projectId: string | null; conversationIds: Set<string> }): ManagerAction[] {
    if (!Array.isArray(raw)) return [];
    const out: ManagerAction[] = [];
    for (const a of raw.slice(0, 4)) {
        if (!a || typeof a !== 'object' || !ACTION_TYPES.includes((a as any).type)) continue;
        const type = (a as any).type as ManagerAction['type'];
        const label = sanitizeInlineUntrusted((a as any).label, 60);
        if (!label) continue;
        const p = (a as any).payload && typeof (a as any).payload === 'object' ? (a as any).payload : {};
        let payload: Record<string, any>;
        if (type === 'open_inbox_conversation') {
            const id = String(p.conversationId || '');
            if (!ctx.conversationIds.has(id)) continue;
            payload = { conversationId: id, deepLink: `/inbox?conversationId=${encodeURIComponent(id)}` };
        } else if (type === 'update_calendar' || type === 'apply_director_rule') {
            if (!ctx.projectId) continue;
            payload =
                type === 'update_calendar'
                    ? { projectId: ctx.projectId, fromDay: Number(p.fromDay) || undefined, format: sanitizeInlineUntrusted(p.format, 80) }
                    : { projectId: ctx.projectId, rule: sanitizeInlineUntrusted(p.rule, 300) };
            if (type === 'apply_director_rule' && !payload.rule) continue;
        } else {
            payload = { text: sanitizeInlineUntrusted(p.text, 300) };
        }
        out.push({ id: `act_${out.length + 1}`, label, type, payload });
    }
    return out;
}

export class ManagerOrchestratorService {
    private static async requireProject(companyId: string, projectId: string | null | undefined): Promise<string | null> {
        if (!projectId) return null;
        const p = await (getDb() as any).project.findFirst({ where: { id: String(projectId), companyId }, select: { id: true } });
        if (!p) throw notFound('Project');
        return p.id;
    }

    /** Lists the caller's manager conversations (newest first). */
    static async listConversations(companyId: string, projectId?: string) {
        requireCompanyId(companyId);
        return (getDb() as any).managerConversation.findMany({
            where: { companyId, ...(projectId ? { projectId } : {}) },
            orderBy: { updatedAt: 'desc' },
            take: 30,
            select: { id: true, projectId: true, title: true, updatedAt: true },
        });
    }

    /** Messages of one conversation, oldest first; 404 for another tenant's conversation. */
    static async getMessages(companyId: string, conversationId: string) {
        requireCompanyId(companyId);
        const db = getDb() as any;
        const conv = await db.managerConversation.findFirst({ where: { id: String(conversationId), companyId }, select: { id: true } });
        if (!conv) throw notFound('Conversation');
        const rows = await db.managerMessage.findMany({ where: { conversationId: conv.id }, orderBy: { createdAt: 'desc' }, take: 100 });
        return rows.reverse();
    }

    /**
     * One chat turn with the 180 Manager. The answer always comes from the company's AI over real workspace data;
     * there is no canned fallback (no AI → 503 AI_NOT_CONFIGURED, slow AI → 504 AI_TIMEOUT).
     */
    static async handleUserChat(
        companyId: string,
        input: { projectId?: string; conversationId?: string; message: string; attachedAssetUrl?: string },
    ): Promise<ManagerTurnResult> {
        requireCompanyId(companyId);
        const text = String(input.message || '').trim();
        if (!text) throw new SocialDomainError('VALIDATION_FAILED', 400, 'message is required');
        if (text.length > MAX_MESSAGE) throw new SocialDomainError('VALIDATION_FAILED', 400, `message must be at most ${MAX_MESSAGE} characters`);
        const db = getDb() as any;

        // Conversation: server-owned and tenant-scoped. A foreign or unknown id is a 404, never a shared session.
        let conversation: { id: string; projectId: string | null };
        if (input.conversationId) {
            conversation = await db.managerConversation.findFirst({ where: { id: String(input.conversationId), companyId }, select: { id: true, projectId: true } });
            if (!conversation) throw notFound('Conversation');
        } else {
            const projectId = await this.requireProject(companyId, input.projectId);
            conversation = await db.managerConversation.create({
                data: { companyId, projectId, title: text.replace(/\s+/g, ' ').slice(0, 60) },
                select: { id: true, projectId: true },
            });
        }
        const projectId = conversation.projectId || (await this.requireProject(companyId, input.projectId));

        // The AI is resolved first so a missing provider fails fast, before any context is loaded.
        const llm = await requireEngagementLlm(companyId);

        const [analytics, calendar, inbox, director, brand, history] = await Promise.all([
            section(AnalyticsSubagent.getCrossAccountSummary(companyId, projectId || undefined)),
            projectId ? section(CalendarSubagent.getCalendarStatus(companyId, projectId)) : Promise.resolve(null),
            section(InboxSubagent.findOpportunities(companyId, { projectId: projectId || undefined, limit: 5 })),
            projectId ? section(DirectorSubagent.getDirectorPreferences(companyId, projectId)) : Promise.resolve(null),
            projectId ? loadBrandForReplies(projectId, companyId).catch(() => null) : Promise.resolve(null),
            db.managerMessage.findMany({ where: { conversationId: conversation.id }, orderBy: { createdAt: 'desc' }, take: HISTORY_TURNS }),
        ]);

        const opportunities = inbox.ok ? inbox.data : [];
        // Inbound DMs are third-party text: only ids/handles stay structured, message bodies are fenced.
        const inboxView = inbox.ok
            ? opportunities.map((o) => ({ conversationId: o.conversationId, platform: o.platform, handle: sanitizeInlineUntrusted(o.participantHandle, 60), type: o.opportunityType }))
            : view(inbox);
        const dmBodies = opportunities.map((o) => fenceUntrusted('comment', o.lastMessage, { label: `dm ${o.conversationId}`, maxChars: 500 }).block).join('\n');
        const transcript = history
            .reverse()
            .map((m: any) => `${m.senderType === 'user' ? 'USER' : 'MANAGER'}: ${String(m.content || '').slice(0, 800)}`)
            .join('\n');

        const prompt = `You are the 180 Manager, the user's AI social media manager inside 180 Workspace.
${UNTRUSTED_DATA_POLICY}

RULES:
- Answer ONLY from WORKSPACE DATA below. Never invent numbers, accounts, trends, deals or results.
- If a section is UNAVAILABLE or a number is null, say that it is not available and why; do not estimate it.
- "metrics.source" tells you if a number is live or stored; mention it when you quote numbers.
- You cannot change anything yourself. To change the calendar or editing rules, propose an action the user must confirm.
- Only reference inbox conversationIds that appear in INBOX.

WORKSPACE DATA (${new Date().toISOString().slice(0, 10)}):
BRAND: ${brand?.context ? brand.context.slice(0, 1500) : 'not loaded'}
ANALYTICS: ${JSON.stringify(view(analytics))}
CALENDAR: ${JSON.stringify(view(calendar))}
INBOX: ${JSON.stringify(inboxView)}
${dmBodies}
DIRECTOR_PREFERENCES: ${JSON.stringify(view(director))}

CONVERSATION SO FAR:
${transcript || '(new conversation)'}

${fenceUntrusted('other', text, { label: 'user message', maxChars: MAX_MESSAGE }).block}

Return ONLY JSON:
{"reply":"markdown answer","intent":"${INTENTS.join('|')}","delegatedAgents":[${AGENTS.map((a) => `"${a}"`).join(',')}],
 "suggestedActions":[{"label":"short label","type":"${ACTION_TYPES.join('|')}","payload":{}}]}
Payloads: open_inbox_conversation {"conversationId"}, update_calendar {"fromDay","format"}, apply_director_rule {"rule"}.`;

        const parsed = parseLlmJson(await generateWithTimeout(llm, prompt, 900));
        if (!parsed || typeof parsed.reply !== 'string' || !parsed.reply.trim()) {
            throw new SocialDomainError('AI_INVALID_OUTPUT', 502, 'The AI returned an unreadable answer. Try again.');
        }
        const reply = parsed.reply.trim().slice(0, 8000);
        const intent: ManagerUserIntent = INTENTS.includes(parsed.intent) ? parsed.intent : 'general_query';
        const delegatedAgents: DelegatedAgentType[] = Array.isArray(parsed.delegatedAgents)
            ? Array.from(new Set(parsed.delegatedAgents.filter((a: any) => AGENTS.includes(a))))
            : [];
        const suggestedActions = sanitizeManagerActions(parsed.suggestedActions, {
            projectId,
            conversationIds: new Set(opportunities.map((o) => o.conversationId)),
        });

        await db.managerMessage.create({ data: { conversationId: conversation.id, senderType: 'user', content: text } });
        const saved = await db.managerMessage.create({
            data: {
                conversationId: conversation.id,
                senderType: 'manager',
                content: reply,
                intent,
                suggestedActions: suggestedActions as any,
                delegatedAgent: delegatedAgents.join(',') || null,
            },
        });
        await db.managerConversation.updateMany({ where: { id: conversation.id, companyId }, data: { updatedAt: new Date() } });

        return { reply, intent, delegatedAgents, suggestedActions, conversationId: conversation.id, messageId: saved?.id };
    }

    /**
     * Runs an action chip the user confirmed. The project always comes from the action payload and is checked
     * against the caller's company before anything is written.
     */
    static async executeAction(companyId: string, action: ManagerAction, deps: { regenerate?: PivotRegenerate; now?: Date } = {}) {
        requireCompanyId(companyId);
        const payload = action?.payload && typeof action.payload === 'object' ? action.payload : {};
        if (action?.type === 'update_calendar') {
            const projectId = await this.requireProject(companyId, payload.projectId);
            if (!projectId) throw new SocialDomainError('VALIDATION_FAILED', 400, 'projectId is required');
            const proposal = CalendarSubagent.planCalendarPivot(
                companyId,
                projectId,
                { fromDay: payload.fromDay, newWinningFormat: String(payload.format || ''), pivotReason: 'Requested in 180 Manager' },
                deps.now,
            );
            return CalendarSubagent.executeCalendarPivot(companyId, projectId, proposal, deps);
        }
        if (action?.type === 'apply_director_rule') {
            const projectId = await this.requireProject(companyId, payload.projectId);
            return DirectorSubagent.applyEditingRule(companyId, projectId || '', String(payload.rule || ''));
        }
        throw new SocialDomainError('UNSUPPORTED_ACTION', 400, `Action "${String(action?.type)}" runs in the app, not on the server.`);
    }
}
