/**
 * 180 Engagement & Centralized AI Interactions — Type Definitions
 */

export type EngagementTriggerType = 'comment_keyword' | 'comment_any' | 'dm_inbound' | 'mention';
export type EngagementMatchMode = 'contains' | 'exact' | 'regex';
export type EngagementRuleStatus = 'active' | 'paused' | 'archived';
export type AiAgentGoal = 'qualify_lead' | 'answer_support' | 'book_demo' | 'deliver_resource';

export interface CreateEngagementRuleDTO {
    name: string;
    projectId?: string;
    socialAccountId?: string;
    postId?: string;
    /** Platform media id of an existing post (from GET /accounts/:id/media). Requires socialAccountId. */
    platformMediaId?: string | null;
    platformMediaPermalink?: string | null;
    platformMediaThumbnail?: string | null;
    triggerType: EngagementTriggerType;
    triggerKeywords?: string[];
    matchMode?: EngagementMatchMode;
    actionAutoLike?: boolean;
    actionPublicReplies?: string[];
    actionSendDm?: boolean;
    actionDmTemplate: string;
    actionDmDeliverableUrl?: string;
    actionDmButtons?: Array<{ title: string; url?: string; payload?: string }>;
    actionEnableAiAgent?: boolean;
    aiAgentGoal?: AiAgentGoal;
    aiAgentPromptOverride?: string;
}

export interface UpdateEngagementRuleDTO extends Partial<CreateEngagementRuleDTO> {
    status?: EngagementRuleStatus;
}

export interface InboundEngagementEvent {
    companyId: string;
    socialAccountId: string;
    platform: 'instagram' | 'facebook' | 'threads' | 'youtube' | 'linkedin' | 'tiktok' | 'twitter' | string;
    eventType: 'comment' | 'dm' | 'mention';
    commentId?: string;
    parentCommentId?: string;
    mediaId?: string;
    postId?: string;
    senderId: string;           // Platform user ID or IGSID
    senderHandle: string;       // e.g. "growth_founder"
    senderName?: string;        // e.g. "Alex Rivera"
    text: string;
    timestamp?: number;
    projectId?: string;
}

export interface EngagementExecutionResult {
    matched: boolean;
    ruleId?: string;
    ruleName?: string;
    commentLiked: boolean;
    publicReplySent?: string;
    dmSent?: string;
    error?: string;
    skippedReason?: 'duplicate' | 'inactive' | 'no_match' | 'rate_limited';
    /** Per-action result: sent, skipped (capability / window, with reason) or failed (provider error). */
    actions?: Array<{ action: 'like' | 'reply' | 'dm'; status: 'sent' | 'skipped' | 'failed'; reason?: string }>;
    /** Set when rate limited: the event was stored and will be retried after this delay. */
    retryAfterMs?: number;
}

export interface AiReplySuggestion {
    id: string;
    tone: string;
    replyText: string;
    confidenceScore: number;
}

export interface BatchAiReplyItem {
    conversationId: string;
    platform: string;
    participantHandle: string;
    lastCustomerMessage: string;
    suggestedReply: string;
    tone: string;
    /** Classified intent: lead | question | support | praise | complaint | spam | other. */
    intent?: string;
    confidence?: number | null;
    /** False when the platform / messaging window does not allow this reply now (see blockedReason). */
    canSend?: boolean;
    blockedReason?: string;
    selected: boolean;
}
