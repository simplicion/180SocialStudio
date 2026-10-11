/**
 * Token vault: the only code that reads or writes provider tokens. Tokens are AES-256-GCM encrypted
 * (token-crypto.ts) in `SocialAccountCredential`, a separate table that account listings never include, and are
 * bound to their account id via AAD. Access tokens are refreshed shortly before expiry; a refresh the provider
 * rejects marks the account `reauthRequired` so the UI asks the user to reconnect.
 */
import { PublishPlatform, intEnv, normalizePlatform } from './config';
import { PublishError, isPublishError } from './errors';
import { getDb, timing } from './http';
import { getOAuthProvider, TokenSet } from './oauth-providers';
import { currentKeyId, decryptSecret, encryptSecret } from './token-crypto';

const aad = (accountId: string, kind: 'access' | 'refresh') => `social-account:${accountId}:${kind}`;
const inflight = new Map<string, Promise<string>>();

export interface VaultAccountRef {
    id: string;
    companyId: string;
    platform: string;
    reauthRequired?: boolean;
}

export class SocialTokenVault {
    static async saveTokens(accountId: string, companyId: string, tokens: TokenSet) {
        if (!tokens.accessToken) throw new PublishError('OAUTH_PROVIDER_ERROR', 'Provider returned no access token.');
        const data = {
            companyId,
            accessTokenEnc: encryptSecret(tokens.accessToken, aad(accountId, 'access')),
            refreshTokenEnc: tokens.refreshToken ? encryptSecret(tokens.refreshToken, aad(accountId, 'refresh')) : null,
            accessTokenExpiresAt: tokens.expiresAt ?? null,
            refreshTokenExpiresAt: tokens.refreshExpiresAt ?? null,
            tokenType: tokens.tokenType ?? null,
            scopes: tokens.scopes || [],
            keyId: currentKeyId(),
            lastRefreshedAt: new Date(timing.now()),
            refreshFailureCount: 0,
            lastRefreshError: null,
        };
        const db = getDb();
        await db.socialAccountCredential.upsert({
            where: { socialAccountId: accountId },
            create: { socialAccountId: accountId, ...data },
            update: data,
        });
        await db.socialAccount.update({
            where: { id: accountId },
            data: { reauthRequired: false, reauthReason: null, accessToken: null, refreshToken: null, tokenExpiresAt: tokens.expiresAt ?? null, scopes: tokens.scopes || [] },
        });
    }

    static async markReauthRequired(accountId: string, reason: string) {
        await getDb().socialAccount.update({ where: { id: accountId }, data: { reauthRequired: true, reauthReason: reason.slice(0, 1000) } });
    }

    static async revoke(accountId: string) {
        await getDb().socialAccountCredential.deleteMany({ where: { socialAccountId: accountId } });
    }

    static async hasCredential(accountId: string): Promise<boolean> {
        return Boolean(await getDb().socialAccountCredential.findUnique({ where: { socialAccountId: accountId }, select: { id: true } }));
    }

    /**
     * Returns a usable access token, refreshing it when it expires within SOCIAL_TOKEN_REFRESH_SKEW_SEC (default 300).
     * `forceRefresh` refreshes regardless of expiry (used by the proactive job for long-lived tokens).
     */
    static async getAccessToken(account: VaultAccountRef, opts: { forceRefresh?: boolean } = {}): Promise<string> {
        const platform = normalizePlatform(account.platform) as PublishPlatform;
        if (account.reauthRequired) throw new PublishError('REAUTH_REQUIRED', 'This account must be reconnected.', { platform });
        const db = getDb();
        const cred = await db.socialAccountCredential.findUnique({ where: { socialAccountId: account.id } });
        if (!cred || cred.companyId !== account.companyId) {
            throw new PublishError('REAUTH_REQUIRED', 'No stored credentials for this account; connect it again.', { platform });
        }
        const skew = intEnv('SOCIAL_TOKEN_REFRESH_SKEW_SEC', 300) * 1000;
        const exp = cred.accessTokenExpiresAt ? new Date(cred.accessTokenExpiresAt).getTime() : null;
        if (!opts.forceRefresh && (exp == null || exp - timing.now() > skew)) return decryptSecret(cred.accessTokenEnc, aad(account.id, 'access'));

        const key = account.id;
        if (!inflight.has(key)) {
            inflight.set(key, this.refresh(account, platform, cred).finally(() => inflight.delete(key)));
        }
        return inflight.get(key)!;
    }

    private static async refresh(account: VaultAccountRef, platform: PublishPlatform, cred: any): Promise<string> {
        const db = getDb();
        const provider = getOAuthProvider(platform);
        const stillValid = cred.accessTokenExpiresAt && new Date(cred.accessTokenExpiresAt).getTime() > timing.now();
        if (!provider.refresh || !cred.refreshTokenEnc) {
            if (stillValid) return decryptSecret(cred.accessTokenEnc, aad(account.id, 'access'));
            await this.markReauthRequired(account.id, 'Access token expired and the platform issued no refresh token.');
            throw new PublishError('REAUTH_REQUIRED', 'Access token expired; reconnect this account.', { platform });
        }
        try {
            const refreshToken = decryptSecret(cred.refreshTokenEnc, aad(account.id, 'refresh'));
            const next = await provider.refresh(refreshToken);
            await this.saveTokens(account.id, account.companyId, { ...next, refreshToken: next.refreshToken ?? refreshToken });
            return next.accessToken;
        } catch (e: any) {
            // Another worker may have refreshed (and rotated) the token meanwhile: use theirs.
            const latest = await db.socialAccountCredential.findUnique({ where: { socialAccountId: account.id } });
            if (latest && latest.lastRefreshedAt && cred.lastRefreshedAt && new Date(latest.lastRefreshedAt).getTime() > new Date(cred.lastRefreshedAt).getTime()) {
                return decryptSecret(latest.accessTokenEnc, aad(account.id, 'access'));
            }
            const err = isPublishError(e) ? e : new PublishError('PROVIDER_ERROR', e?.message || String(e), { retryable: true, platform });
            if (err.code === 'REAUTH_REQUIRED') {
                await this.markReauthRequired(account.id, `Token refresh rejected: ${err.message}`);
                throw err;
            }
            await db.socialAccountCredential.update({
                where: { socialAccountId: account.id },
                data: { refreshFailureCount: (cred.refreshFailureCount || 0) + 1, lastRefreshError: err.message.slice(0, 1000) },
            });
            if (stillValid) return decryptSecret(cred.accessTokenEnc, aad(account.id, 'access'));
            throw new PublishError(err.code === 'TOKEN_VAULT_NOT_CONFIGURED' ? err.code : 'PROVIDER_ERROR', `Could not refresh the access token: ${err.message}`, { retryable: err.retryable, platform });
        }
    }

    /**
     * One-off backfill: encrypt plaintext tokens left in SocialAccount.accessToken/refreshToken into the vault and
     * clear the plaintext columns. Safe to run repeatedly.
     */
    static async migrateLegacyPlaintextTokens(): Promise<{ migrated: number }> {
        const db = getDb();
        let migrated = 0;
        for (;;) {
            const rows = await db.socialAccount.findMany({ where: { accessToken: { not: null } }, take: 100 });
            if (!rows.length) break;
            for (const a of rows) {
                await this.saveTokens(a.id, a.companyId, { accessToken: a.accessToken, refreshToken: a.refreshToken, expiresAt: a.tokenExpiresAt, scopes: a.scopes || [] });
                migrated++;
            }
        }
        return { migrated };
    }

    /**
     * Proactively refreshes credentials approaching expiry (e.g. within 7 days) to ensure
     * dormant Instagram and Threads accounts don't lose their 60-day tokens.
     */
    static async proactiveRefreshExpiringTokens(windowMs: number = 7 * 24 * 60 * 60 * 1000): Promise<{ refreshed: number; failed: number }> {
        const db = getDb();
        const now = timing.now();
        const threshold = new Date(now + windowMs);
        let refreshed = 0;
        let failed = 0;

        const expiring = await db.socialAccountCredential.findMany({
            where: {
                accessTokenExpiresAt: {
                    lte: threshold,
                    gt: new Date(now),
                },
                refreshTokenEnc: { not: null },
            },
            take: 20,
        }).catch(() => []);

        for (const cred of expiring) {
            try {
                const account = await db.socialAccount.findUnique({
                    where: { id: cred.socialAccountId },
                });
                if (!account || !account.isActive || account.reauthRequired || account.companyId !== cred.companyId) continue;
                await this.getAccessToken(account, { forceRefresh: true });
                refreshed++;
            } catch {
                failed++;
            }
        }

        return { refreshed, failed };
    }
}

