/**
 * 180 Manager & Multi-Agent Swarm — Core Type Contracts
 */

export type ManagerUserIntent =
    | 'analytics'
    | 'calendar_update'
    | 'inbox_hunt'
    | 'director_rule'
    | 'video_intel'
    | 'general_query';

export type DelegatedAgentType =
    | 'calendar'
    | 'inbox'
    | 'analytics'
    | 'director'
    | 'video_intel';

export interface ManagerAction {
    id: string;
    label: string;
    type: 'update_calendar' | 'open_inbox_conversation' | 'apply_director_rule' | 'analyze_video' | 'quick_reply';
    payload: Record<string, any>;
    icon?: string;
}

export interface ManagerTurnResult {
    reply: string;
    intent: ManagerUserIntent;
    delegatedAgents: DelegatedAgentType[];
    suggestedActions: ManagerAction[];
    conversationId: string;
    messageId?: string;
}

export interface CalendarPivotProposal {
    projectId: string;
    pivotReason: string;
    fromDay: number;
    toDay: number;
    targetMonth: string; // "YYYY-MM"
    newWinningFormat: string;
    proposedSlots: Array<{
        date: string;
        title: string;
        format: string;
        platform: string;
        contentPillar?: string;
    }>;
}

export interface InboxOpportunity {
    conversationId: string;
    platform: string;
    participantHandle: string;
    participantName?: string;
    lastMessage: string;
    opportunityType: 'deal' | 'lead' | 'vip_client' | 'partnership' | 'support_inquiry';
    confidence: number;
    inAppInboxDeepLink: string;
    summary: string;
}

export interface VideoTraitAnalysis {
    postId?: string;
    assetUrl?: string;
    durationSec?: number;
    hookScore: number;
    visualHookAnalysis: string;
    audioHookTranscript: string;
    pacingScore: number;
    cutsPerMinute?: number;
    energyLevel: 'high' | 'medium' | 'calm';
    detectedFormat: 'talking_head' | 'tutorial' | 'breakdown' | 'meme' | 'pov' | 'lifestyle';
    speechTranscript: string;
    viralityHypothesis: string;
    /** What the score was derived from. Media is never sent to the server. */
    basis: 'transcript' | 'caption';
}

export interface AccountMetricsSnapshot {
    /** live = fetched just now; stored = last saved value; unavailable = see `unavailable`. Never estimated. */
    source: string;
    followers: number | null;
    reach: number | null;
    views: number | null;
    engagements: number | null;
    periodDays: number | null;
    unavailable: string | null;
}

export interface CrossAccountAnalyticsSummary {
    totalAccounts: number;
    /** Start of the calendar month the counts cover (ISO). */
    periodStart: string;
    accounts: Array<{
        id: string;
        platform: string;
        username: string;
        /** Variants published by this account since periodStart. */
        publishedThisMonth: number;
        /** Engagement automation events (comment/DM triggers) since periodStart. */
        automationEventsThisMonth: number;
        metrics: AccountMetricsSnapshot | null;
    }>;
}
