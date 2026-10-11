import { prisma, requestContext } from '@workspace/db';
import { SocialTokenVault } from './publishing/token-vault';
import { normalizePlatform } from './publishing/config';
import { SocialDomainError, notFound } from './tenant-scope';
import { getDb } from './publishing/http';

/** Post states that would still publish on their own; these are paused when their account goes away. */
const PENDING_PUBLISH_STATUSES = ['scheduled', 'approved'];

export interface ConnectAccountDTO {
    platform: 'instagram' | 'facebook' | 'linkedin' | 'tiktok' | 'youtube' | 'x' | 'twitter';
    platformAccountId: string;
    accountName: string;
    username: string;
    profileImageUrl?: string;
    accessToken: string;
    refreshToken?: string;
    tokenExpiresAt?: Date;
    scopes?: string[];
    metadata?: Record<string, any>;
    projectId?: string;
    clientId?: string;
}

/** Fields that must never leave the server. The vault table is never included by these queries at all. */
const SECRET_FIELDS = ['accessToken', 'refreshToken', 'credential'];

/** Client-safe view of a social account: no tokens, plus `hasCredential` / `reauthRequired` for the UI. */
export function toPublicAccount<T extends Record<string, any> | null | undefined>(a: T): any {
    if (!a) return a;
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(a)) if (!SECRET_FIELDS.includes(k)) out[k] = v;
    out.hasCredential = Boolean((a as any).credential || (a as any).accessToken || (a as any).hasCredential);
    out.tokenHealth = accountTokenHealth(a as any);
    return out;
}

export interface TokenHealth {
    state: 'ok' | 'expiring_soon' | 'expired' | 'reauth_required' | 'unknown';
    /** When publishing stops working without a reconnect (null = no known end). */
    lapsesAt: string | null;
    message: string | null;
}

/**
 * When the account stops being usable. With a refresh token the proactive job keeps the access token fresh, so the
 * account lapses when the refresh token does; without one it lapses with the access token. Warns 7 days ahead.
 */
export function accountTokenHealth(a: { reauthRequired?: boolean; reauthReason?: string | null; credential?: any }, now: number = Date.now()): TokenHealth {
    if (a?.reauthRequired) return { state: 'reauth_required', lapsesAt: null, message: a.reauthReason || 'The platform rejected the saved login. Reconnect the account.' };
    const c = a?.credential;
    if (!c) return { state: 'unknown', lapsesAt: null, message: null };
    const hasRefresh = Boolean(c.refreshTokenEnc);
    const raw = hasRefresh ? c.refreshTokenExpiresAt : c.accessTokenExpiresAt;
    if (!raw) return { state: 'ok', lapsesAt: null, message: null };
    const at = new Date(raw).getTime();
    const iso = new Date(at).toISOString();
    if (at <= now) return { state: 'expired', lapsesAt: iso, message: 'The saved login has expired. Reconnect the account to keep publishing.' };
    const days = Math.ceil((at - now) / 86_400_000);
    if (days <= 7) return { state: 'expiring_soon', lapsesAt: iso, message: `The saved login expires in ${days} day${days === 1 ? '' : 's'}. Reconnect before then so scheduled posts keep publishing.` };
    return { state: 'ok', lapsesAt: iso, message: null };
}

const PUBLIC_INCLUDE = {
    project: { select: { id: true, name: true } },
    client: { select: { id: true, name: true } },
    // refreshTokenEnc is read only to derive tokenHealth; toPublicAccount drops the whole credential object.
    credential: { select: { id: true, accessTokenExpiresAt: true, refreshTokenExpiresAt: true, refreshTokenEnc: true } },
};

export class SocialAccountService {
    static async listAccounts(projectId?: string) {
        const companyId = requestContext.getStore()?.companyId as string;
        if (!companyId) throw new SocialDomainError('UNAUTHENTICATED', 401, 'Company context required');

        const whereClause: any = {
            companyId,
            isActive: true,
            OR: [
                { projectId: null },
                { project: { deletedAt: null } }
            ]
        };
        if (projectId) whereClause.projectId = projectId;

        const rows = await (prisma as any).socialAccount.findMany({
            where: whereClause,
            orderBy: { createdAt: 'desc' },
            include: PUBLIC_INCLUDE,
        });
        return rows.map(toPublicAccount);
    }

    static async getAccount(id: string) {
        const companyId = requestContext.getStore()?.companyId as string;
        const account = await (prisma as any).socialAccount.findFirst({
            where: { id, companyId },
            include: PUBLIC_INCLUDE,
        });
        if (!account) throw notFound('Social account');
        return toPublicAccount(account);
    }

    /**
     * Manual connect with a token obtained elsewhere (legacy / admin tooling). The token goes straight into the
     * encrypted vault; the account row never stores it. Prefer the OAuth flow (SocialOAuthService).
     */
    static async connectAccount(data: ConnectAccountDTO) {
        const companyId = requestContext.getStore()?.companyId as string;
        if (!companyId) throw new SocialDomainError('UNAUTHENTICATED', 401, 'Company context required');
        const platform = normalizePlatform(data.platform);
        if (!platform) throw new SocialDomainError('VALIDATION_FAILED', 400, `Unsupported platform "${data.platform}"`);
        if (!data.platformAccountId || !data.accessToken) throw new SocialDomainError('VALIDATION_FAILED', 400, 'platformAccountId and accessToken are required');

        const fields = {
            accountName: data.accountName,
            username: data.username,
            profileImageUrl: data.profileImageUrl,
            scopes: data.scopes || [],
            metadata: data.metadata || {},
            projectId: data.projectId,
            clientId: data.clientId,
            isActive: true,
            accessToken: null,
            refreshToken: null,
        };
        const account = await (prisma as any).socialAccount.upsert({
            where: { companyId_platform_platformAccountId: { companyId, platform, platformAccountId: data.platformAccountId } },
            update: fields,
            create: { companyId, platform, platformAccountId: data.platformAccountId, ...fields },
        });
        await SocialTokenVault.saveTokens(account.id, companyId, {
            accessToken: data.accessToken,
            refreshToken: data.refreshToken ?? null,
            expiresAt: data.tokenExpiresAt ? new Date(data.tokenExpiresAt) : null,
            scopes: data.scopes || [],
        });
        return toPublicAccount({ ...account, hasCredential: true });
    }

    static async disconnectAccount(id: string) {
        const companyId = requestContext.getStore()?.companyId as string;
        if (!companyId) throw new SocialDomainError('UNAUTHENTICATED', 401, 'Company context required');
        const db = getDb();
        const account = await db.socialAccount.findFirst({ where: { id, companyId } });
        if (!account) throw notFound('Social account');

        await db.socialAccount.updateMany({
            where: { id, companyId },
            data: { isActive: false, accessToken: null, refreshToken: null },
        });
        // Tokens are destroyed on disconnect; reconnecting runs OAuth again.
        await SocialTokenVault.revoke(id);

        const pausedPostIds = await this.pausePostsForAccount(account, companyId);
        return {
            success: true,
            pausedPosts: pausedPostIds.length,
            pausedPostIds,
            message: pausedPostIds.length
                ? `Account disconnected. ${pausedPostIds.length} scheduled post${pausedPostIds.length === 1 ? '' : 's'} using it were paused and moved to drafts.`
                : 'Account disconnected successfully',
        };
    }

    /**
     * Scheduled posts that publish through this account would fail silently at their time, so they are moved to
     * draft with a clear reason (kept on the calendar; the time is preserved for rescheduling). Variants already
     * published are untouched.
     */
    static async pausePostsForAccount(account: { id: string; accountName?: string | null; platform: string }, companyId: string): Promise<string[]> {
        const db = getDb();
        const viaVariant = await db.socialPostVariant.findMany({
            where: { socialAccountId: account.id, publishStatus: { in: ['pending', 'failed'] } },
            select: { postId: true },
            take: 500,
        });
        const candidateIds = Array.from(new Set(viaVariant.map((v: any) => v.postId)));
        const posts = await db.socialPost.findMany({
            where: {
                companyId,
                status: { in: PENDING_PUBLISH_STATUSES },
                OR: [{ socialAccountId: account.id }, ...(candidateIds.length ? [{ id: { in: candidateIds } }] : [])],
            },
            take: 500,
        });
        const reason = `Paused: the ${account.platform} account "${account.accountName || account.id}" was disconnected. Reconnect it or choose another account, then schedule again.`;
        const paused: string[] = [];
        for (const p of posts) {
            const history = Array.isArray(p.history) ? p.history : [];
            const r = await db.socialPost.updateMany({
                where: { id: p.id, companyId, status: { in: PENDING_PUBLISH_STATUSES } },
                data: {
                    status: 'draft',
                    nextPublishAttemptAt: null,
                    errorMessage: reason,
                    history: [...history, { version: p.versionNumber, action: 'paused_account_disconnected', accountId: account.id, previousStatus: p.status, timestamp: new Date().toISOString() }],
                },
            });
            if (r.count) paused.push(p.id);
        }
        return paused;
    }

    /**
     * Designates a connected account as the primary/default account for its platform in the workspace/project.
     */
    static async setDefaultAccount(id: string, companyId: string) {
        if (!companyId) throw new SocialDomainError('UNAUTHENTICATED', 401, 'Company context required');
        const db = getDb();
        const account = await db.socialAccount.findFirst({ where: { id, companyId } });
        if (!account) throw notFound('Social account');

        // Unset default from sibling accounts of the same platform
        const siblings = await db.socialAccount.findMany({
            where: {
                companyId,
                platform: account.platform,
                id: { not: id },
                ...(account.projectId ? { projectId: account.projectId } : {}),
            },
        });
        for (const sib of siblings) {
            const meta = (sib.metadata && typeof sib.metadata === 'object' ? sib.metadata : {}) as Record<string, any>;
            if (meta.isDefault || meta.isPrimary) {
                await db.socialAccount.update({
                    where: { id: sib.id },
                    data: { metadata: { ...meta, isDefault: false, isPrimary: false } },
                });
            }
        }

        const currentMeta = (account.metadata && typeof account.metadata === 'object' ? account.metadata : {}) as Record<string, any>;
        const updated = await db.socialAccount.update({
            where: { id },
            data: { metadata: { ...currentMeta, isDefault: true, isPrimary: true } },
        });
        return toPublicAccount({ ...updated, hasCredential: true });
    }
}
