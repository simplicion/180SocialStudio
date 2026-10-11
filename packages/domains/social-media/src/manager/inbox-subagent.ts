import { getDb } from '../publishing/http';
import { InboxOpportunity } from './types';
import { requireCompanyId } from '../tenant-scope';

const DEAL_KEYWORDS = [
    'pricing', 'cost', 'quote', 'hire', 'service', 'call', 'meeting', 'budget', 'work together',
    'sponsor', 'partnership', 'collab', 'consulting', 'retainer', 'agency', 'contract', 'proposal',
    'book a demo', 'how much', 'interested in your', 'available for'
];

export class InboxSubagent {
    /**
     * Scans multi-channel inboxes (Instagram, LinkedIn, etc.) for commercial opportunities, deals, and leads.
     */
    static async findOpportunities(
        companyId: string,
        options: { projectId?: string; platform?: string; limit?: number } = {}
    ): Promise<InboxOpportunity[]> {
        requireCompanyId(companyId);
        const limit = Math.min(Math.max(1, options.limit || 10), 50);

        const where: any = { companyId };
        if (options.projectId) where.projectId = options.projectId;
        if (options.platform) where.platform = options.platform;

        // One query: each conversation with only its latest message (no per-conversation lookups).
        const conversations = await (getDb() as any).socialConversation.findMany({
            where,
            orderBy: { lastMessageAt: 'desc' },
            take: 100,
            include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
        });

        const opportunities: Array<InboxOpportunity & { rank: number }> = [];
        for (const conv of conversations) {
            const lastMessage = conv.messages?.[0];
            if (!lastMessage) continue;
            const text = String(lastMessage.content || '').toLowerCase();
            const matchedKw = DEAL_KEYWORDS.filter((kw) => text.includes(kw));
            const stage = conv.leadStage as string | null;
            const score = typeof conv.leadScore === 'number' ? conv.leadScore : null;
            const qualifiedByAi = stage === 'qualified' || stage === 'handoff' || (stage === 'engaged' && (score ?? 0) >= 50);
            if (stage === 'disqualified') continue;
            // An opportunity is a thread the AI qualified, or an unanswered inbound message with buying words.
            if (!qualifiedByAi && !(matchedKw.length && lastMessage.senderType === 'participant')) continue;

            let oppType: InboxOpportunity['opportunityType'] = 'lead';
            if (text.includes('sponsor') || text.includes('collab') || text.includes('partnership')) oppType = 'partnership';
            else if (stage === 'handoff' || text.includes('pricing') || text.includes('quote') || text.includes('hire') || text.includes('budget')) oppType = 'deal';

            const q = conv.leadQualification && typeof conv.leadQualification === 'object' ? conv.leadQualification : null;
            opportunities.push({
                conversationId: conv.id,
                platform: conv.platform,
                participantHandle: conv.participantHandle,
                participantName: conv.participantName,
                lastMessage: String(lastMessage.content || ''),
                opportunityType: oppType,
                // The AI's 0-100 score when there is one; keyword-only matches are reported as low confidence.
                confidence: score != null ? score / 100 : Math.min(0.5, 0.2 + matchedKw.length * 0.1),
                inAppInboxDeepLink: `/inbox?conversationId=${conv.id}`,
                summary: q?.need
                    ? `@${conv.participantHandle} on ${conv.platform}: needs ${q.need}${q.budget ? `, budget ${q.budget}` : ''}${q.timeline ? `, timeline ${q.timeline}` : ''}.`
                    : `@${conv.participantHandle} on ${conv.platform} mentioned: ${matchedKw.join(', ')}.`,
                rank: (qualifiedByAi ? 1000 : 0) + (score ?? 0) + matchedKw.length,
            });
        }
        return opportunities
            .sort((x, y) => y.rank - x.rank)
            .slice(0, limit)
            .map(({ rank: _rank, ...o }) => o);
    }

    /**
     * Assigns a conversation to the AI Agent or takes over for a human.
     */
    static async setConversationMode(companyId: string, conversationId: string, mode: 'ai_agent' | 'human_takeover') {
        requireCompanyId(companyId);
        return (getDb() as any).socialConversation.updateMany({
            where: { id: conversationId, companyId },
            data: {
                aiAgentActive: mode === 'ai_agent',
                isHumanTakeover: mode === 'human_takeover',
            },
        });
    }
}
