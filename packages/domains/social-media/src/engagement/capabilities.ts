/**
 * What each network lets a connected business account do with a comment or DM (official APIs only).
 *
 * | platform  | like comment | public reply | private reply / DM                                              |
 * |-----------|--------------|--------------|-----------------------------------------------------------------|
 * | instagram | yes          | yes          | private reply to a comment within 7 days; then one message until the user answers, then a 24 h window |
 * | facebook  | yes          | yes          | private reply within 7 days (pages_messaging); DMs in the 24 h window |
 * | youtube   | no           | yes          | no DMs                                                          |
 * | linkedin  | yes (page)   | yes (page)   | no DMs                                                          |
 * | x         | paid tier    | paid tier    | paid tier (X_API_TIER=paid|basic|pro|enterprise)                 |
 * | tiktok    | no           | yes          | no DMs                                                          |
 * | threads   | no           | yes          | no DMs                                                          |
 *
 * The dispatcher asks this module before every action and logs the reason when an action is skipped.
 */

export type EngagementAction = 'like' | 'reply' | 'dm';

export interface PlatformCapabilities {
    like: boolean;
    reply: boolean;
    dm: boolean;
    /** Comment-to-DM ("private reply") window, in days. */
    privateReplyWindowDays?: number;
    /** Standard messaging window after the user's last message, in hours. */
    messagingWindowHours?: number;
    /** Only one business message is allowed until the user answers. */
    singleMessageUntilUserReplies?: boolean;
    note?: string;
}

const X_PAID_TIERS = ['paid', 'basic', 'pro', 'enterprise'];
const xPaid = () => X_PAID_TIERS.includes(String(process.env.X_API_TIER || '').trim().toLowerCase());

export function canonicalEngagementPlatform(p: string): string {
    const v = String(p || '').toLowerCase().trim();
    if (v === 'twitter') return 'x';
    if (v.startsWith('insta')) return 'instagram';
    if (v === 'youtube_shorts') return 'youtube';
    return v;
}

export function platformCapabilities(platform: string): PlatformCapabilities {
    switch (canonicalEngagementPlatform(platform)) {
        case 'instagram':
            return { like: true, reply: true, dm: true, privateReplyWindowDays: 7, messagingWindowHours: 24, singleMessageUntilUserReplies: true };
        case 'facebook':
            return { like: true, reply: true, dm: true, privateReplyWindowDays: 7, messagingWindowHours: 24, singleMessageUntilUserReplies: true };
        case 'youtube':
            return { like: false, reply: true, dm: false, note: 'YouTube allows comment replies only; there are no DMs.' };
        case 'linkedin':
            return { like: true, reply: true, dm: false, note: 'LinkedIn pages can reply to and like comments; there is no DM API.' };
        case 'x': {
            const paid = xPaid();
            return { like: paid, reply: paid, dm: paid, messagingWindowHours: undefined, note: paid ? undefined : 'X engagement needs a paid API tier (set X_API_TIER).' };
        }
        case 'threads':
            return { like: false, reply: true, dm: false, note: 'Threads allows public replies only.' };
        default:
            return { like: false, reply: false, dm: false, note: `Engagement is not supported on ${platform}.` };
    }
}

export type SkipReason =
    | 'unsupported_on_platform'
    | 'private_reply_window_expired'
    | 'awaiting_user_reply'
    | 'outside_messaging_window'
    | 'not_configured_on_rule'
    | 'missing_comment_id';

export interface ActionPlanItem {
    action: EngagementAction;
    run: boolean;
    skipReason?: SkipReason;
    detail?: string;
}

export interface PlanContext {
    /** When the comment was made (ms). Undefined = unknown (treated as fresh: the webhook is real time). */
    commentAtMs?: number;
    /** The sender's last inbound DM (ms), if any. */
    lastUserMessageAtMs?: number | null;
    /** Our last outbound message to the sender (ms), if any. */
    lastBusinessMessageAtMs?: number | null;
    nowMs: number;
}

const DAY = 86_400_000;

/**
 * Decides which of the rule's actions may run for this event. Pure: all platform history comes in `ctx`.
 */
export function planEngagementActions(
    platform: string,
    rule: { actionAutoLike?: boolean; actionPublicReplies?: string[]; actionSendDm?: boolean; actionDmTemplate?: string },
    event: { eventType: string; commentId?: string },
    ctx: PlanContext,
): ActionPlanItem[] {
    const caps = platformCapabilities(platform);
    const isComment = event.eventType !== 'dm';
    const out: ActionPlanItem[] = [];

    // like
    if (!rule.actionAutoLike) out.push({ action: 'like', run: false, skipReason: 'not_configured_on_rule' });
    else if (!isComment) out.push({ action: 'like', run: false, skipReason: 'unsupported_on_platform', detail: 'DMs cannot be liked' });
    else if (!caps.like) out.push({ action: 'like', run: false, skipReason: 'unsupported_on_platform', detail: caps.note });
    else if (!event.commentId) out.push({ action: 'like', run: false, skipReason: 'missing_comment_id' });
    else out.push({ action: 'like', run: true });

    // public reply
    if (!rule.actionPublicReplies?.length) out.push({ action: 'reply', run: false, skipReason: 'not_configured_on_rule' });
    else if (!isComment) out.push({ action: 'reply', run: false, skipReason: 'unsupported_on_platform', detail: 'public replies apply to comments' });
    else if (!caps.reply) out.push({ action: 'reply', run: false, skipReason: 'unsupported_on_platform', detail: caps.note });
    else if (!event.commentId) out.push({ action: 'reply', run: false, skipReason: 'missing_comment_id' });
    else out.push({ action: 'reply', run: true });

    // private reply / DM
    if (!rule.actionSendDm || !rule.actionDmTemplate) out.push({ action: 'dm', run: false, skipReason: 'not_configured_on_rule' });
    else if (!caps.dm) out.push({ action: 'dm', run: false, skipReason: 'unsupported_on_platform', detail: caps.note });
    else if (isComment) {
        const ageMs = ctx.commentAtMs ? ctx.nowMs - ctx.commentAtMs : 0;
        const userAnsweredSince = ctx.lastBusinessMessageAtMs != null && ctx.lastUserMessageAtMs != null && ctx.lastUserMessageAtMs > ctx.lastBusinessMessageAtMs;
        if (!event.commentId) out.push({ action: 'dm', run: false, skipReason: 'missing_comment_id' });
        else if (caps.privateReplyWindowDays && ageMs > caps.privateReplyWindowDays * DAY) {
            out.push({ action: 'dm', run: false, skipReason: 'private_reply_window_expired', detail: `private replies are allowed within ${caps.privateReplyWindowDays} days of the comment` });
        } else if (caps.singleMessageUntilUserReplies && ctx.lastBusinessMessageAtMs != null && !userAnsweredSince) {
            out.push({ action: 'dm', run: false, skipReason: 'awaiting_user_reply', detail: 'one message is allowed until the user replies' });
        } else out.push({ action: 'dm', run: true });
    } else {
        const last = ctx.lastUserMessageAtMs;
        if (caps.messagingWindowHours && (last == null || ctx.nowMs - last > caps.messagingWindowHours * 3_600_000)) {
            out.push({ action: 'dm', run: false, skipReason: 'outside_messaging_window', detail: `DMs are allowed within ${caps.messagingWindowHours} h of the user's last message` });
        } else out.push({ action: 'dm', run: true });
    }
    return out;
}

/** Can a free-form reply be sent into this conversation right now (DM window, platform support)? */
export function conversationReplyCapability(
    platform: string,
    kind: 'dm' | 'comment',
    lastUserMessageAtMs: number | null,
    nowMs: number,
): { ok: boolean; reason?: SkipReason; detail?: string } {
    const caps = platformCapabilities(platform);
    if (kind === 'comment') return caps.reply ? { ok: true } : { ok: false, reason: 'unsupported_on_platform', detail: caps.note };
    if (!caps.dm) return { ok: false, reason: 'unsupported_on_platform', detail: caps.note };
    if (caps.messagingWindowHours && (lastUserMessageAtMs == null || nowMs - lastUserMessageAtMs > caps.messagingWindowHours * 3_600_000)) {
        return { ok: false, reason: 'outside_messaging_window', detail: `DMs are allowed within ${caps.messagingWindowHours} h of the user's last message` };
    }
    return { ok: true };
}
