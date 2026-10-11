/**
 * Pure guards for post create/update/schedule and client review links. No database access here, so every rule is
 * unit-testable; the services call these and turn the result into typed `SocialDomainError`s.
 */
import { SocialDomainError } from './tenant-scope';

/** Grace for clock skew / slow forms: a time up to this far in the past still counts as "now". */
export const SCHEDULE_PAST_GRACE_MS = 2 * 60 * 1000;

/**
 * Parses a `scheduledFor` value. Returns `undefined` when not given, `null` when explicitly cleared.
 * Throws INVALID_SCHEDULE for unparseable input and SCHEDULE_IN_PAST for times already gone (the scheduler would
 * otherwise publish it on its next tick without anyone noticing the typo).
 */
export function parseScheduledFor(value: unknown, now: number = Date.now()): Date | null | undefined {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    const d = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(d.getTime())) throw new SocialDomainError('INVALID_SCHEDULE', 400, 'scheduledFor is not a valid date/time.');
    if (d.getTime() < now - SCHEDULE_PAST_GRACE_MS) {
        throw new SocialDomainError('SCHEDULE_IN_PAST', 422, `The scheduled time ${d.toISOString()} is in the past. Pick a future time or publish now.`, {
            scheduledFor: d.toISOString(),
            now: new Date(now).toISOString(),
        });
    }
    return d;
}

/** Fields a client may change with PUT /posts/:id. Everything else (companyId, versions, publish state) is server-owned. */
export const EDITABLE_POST_FIELDS = [
    'title',
    'content',
    'mediaUrls',
    'rawMediaUrls',
    'externalStorageLinks',
    'finalVideoUrl',
    'thumbnailUrl',
    'mediaType',
    'scheduledFor',
    'metadata',
    'isEvergreen',
    'socialAccountId',
    'clientId',
    'status',
] as const;

/** Statuses a client may set directly. Approval comes only from the review flow; publish states only from the dispatcher. */
export const CLIENT_SETTABLE_STATUSES = ['draft', 'in_progress', 'in_review', 'revisions_requested', 'rejected', 'scheduled', 'archived'] as const;

export function sanitizePostUpdate(data: Record<string, any>): Record<string, any> {
    const out: Record<string, any> = {};
    for (const k of EDITABLE_POST_FIELDS) if (data[k] !== undefined) out[k] = data[k];
    if (out.status !== undefined && !(CLIENT_SETTABLE_STATUSES as readonly string[]).includes(out.status)) {
        throw new SocialDomainError(
            'STATUS_NOT_SETTABLE',
            422,
            `Status "${out.status}" cannot be set directly. Approval comes from the review flow and publish states from publishing.`,
        );
    }
    return out;
}

/** Fields whose change alters what the audience sees, so an approval of the old version no longer covers it. */
const SUBSTANTIVE_FIELDS = ['title', 'content', 'mediaUrls', 'finalVideoUrl', 'thumbnailUrl', 'mediaType'] as const;

const same = (a: any, b: any) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export interface VariantLike {
    platform: string;
    customContent?: string | null;
    customMediaUrls?: string[] | null;
    firstComment?: string | null;
}

/** True when the update changes approved content (post copy/media, first comment, or any variant's copy/media). */
export function hasSubstantiveChange(
    existing: Record<string, any>,
    update: Record<string, any>,
    existingVariants: VariantLike[] = [],
    incomingVariants?: VariantLike[],
): boolean {
    for (const k of SUBSTANTIVE_FIELDS) {
        if (update[k] !== undefined && !same(update[k], existing[k])) return true;
    }
    if (update.metadata !== undefined && !same(update.metadata?.firstComment, existing.metadata?.firstComment)) return true;
    if (incomingVariants) {
        const key = (v: VariantLike) => String(v.platform).toLowerCase();
        const before = new Map(existingVariants.map((v) => [key(v), v]));
        if (incomingVariants.length !== existingVariants.length) return true;
        for (const v of incomingVariants) {
            const old = before.get(key(v));
            if (!old) return true;
            if (!same(v.customContent || '', old.customContent || '')) return true;
            if (v.customMediaUrls !== undefined && !same(v.customMediaUrls, old.customMediaUrls)) return true;
            if (v.firstComment !== undefined && !same(v.firstComment || null, old.firstComment || null)) return true;
        }
    }
    return false;
}

const normalizeCaption = (s: string) =>
    String(s || '')
        .toLowerCase()
        .replace(/https?:\/\/\S+/g, '')
        .replace(/\s+/g, ' ')
        .trim();

export interface DuplicateCandidate {
    id: string;
    content?: string | null;
    scheduledFor?: Date | string | null;
    publishedAt?: Date | string | null;
    socialAccountId?: string | null;
    platforms?: string[];
}

/**
 * Posts that repeat the same caption (ignoring case, whitespace and links) on the same account or platform within
 * `windowDays` of `when`. Platforms (Instagram, X, LinkedIn) throttle or reject exact repeats, and audiences notice.
 */
export function findDuplicateCaptions(
    target: { id: string; content: string; when: Date; socialAccountId?: string | null; platforms: string[] },
    others: DuplicateCandidate[],
    windowDays = 7,
): DuplicateCandidate[] {
    const caption = normalizeCaption(target.content);
    if (caption.length < 20) return []; // short captions ("New video!") repeat legitimately
    const windowMs = windowDays * 24 * 3600 * 1000;
    const platforms = new Set(target.platforms.map((p) => p.toLowerCase()));
    return others.filter((o) => {
        if (o.id === target.id) return false;
        if (normalizeCaption(o.content || '') !== caption) return false;
        const t = o.scheduledFor || o.publishedAt;
        if (!t) return false;
        if (Math.abs(new Date(t).getTime() - target.when.getTime()) > windowMs) return false;
        if (target.socialAccountId && o.socialAccountId === target.socialAccountId) return true;
        return (o.platforms || []).some((p) => platforms.has(p.toLowerCase()));
    });
}

// ── client review links ───────────────────────────────────────────────────────

export type ReviewLinkState = 'active' | 'expired' | 'revoked';

export function reviewLinkState(session: { status?: string | null; expiresAt: Date | string }, now: number = Date.now()): ReviewLinkState {
    if (session.status === 'revoked') return 'revoked';
    if (now > new Date(session.expiresAt).getTime()) return 'expired';
    return 'active';
}

/** Throws the typed error a public review action should answer with when the link can no longer be used. */
export function assertReviewLinkUsable(session: { status?: string | null; expiresAt: Date | string }, now: number = Date.now()) {
    const state = reviewLinkState(session, now);
    if (state === 'revoked') {
        throw new SocialDomainError('REVIEW_LINK_REVOKED', 410, 'This review link was withdrawn by the agency. Ask them for a new link.');
    }
    if (state === 'expired') {
        throw new SocialDomainError('REVIEW_LINK_EXPIRED', 410, 'This review link has expired. Ask your agency team for a new link.');
    }
}

/** Post statuses a client review may approve. Published / publishing / failed posts are never flipped back to approved. */
export const REVIEWABLE_STATUSES = ['draft', 'in_progress', 'in_review', 'scheduled', 'ready', 'revisions_requested'];

/** Max review-link lifetime; longer links are a standing credential. */
export const MAX_REVIEW_LINK_DAYS = 90;
