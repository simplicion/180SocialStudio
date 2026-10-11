/**
 * Connect-account OAuth flow.
 *   start()    → signed `state` + one-time session row (PKCE verifier encrypted) → provider authorize URL
 *   callback() → verifies state, consumes the session exactly once, exchanges the code, discovers accounts,
 *                stores tokens in the vault, and returns where to send the browser:
 *                redirectUri?status=connected&platform=…&accountId=…  (or status=select&selectionId=…, status=error)
 *   getSelection()/completeSelection() → Meta pages / IG accounts and LinkedIn member vs organisations picker.
 */
import crypto from 'crypto';
import { PublishPlatform, isPlatformConfigured, isSimulationMode, normalizePlatform, oauthCallbackUrl, requireAppCredentials } from './config';
import { PublishError, isPublishError } from './errors';
import { getDb, timing } from './http';
import { CandidateAccount, getOAuthProvider } from './oauth-providers';
import { decryptSecret, encryptSecret, stateSigningKey } from './token-crypto';
import { SocialTokenVault } from './token-vault';
import { getLinkedInProviderMode } from '../linkedin/config';
import { getYouTubeProviderMode } from '../youtube/config';

export const MOBILE_OAUTH_REDIRECT = 'workspace180://oauth/callback';
const SESSION_TTL_MS = 15 * 60 * 1000;

interface StatePayload {
    sid: string;
    pf: PublishPlatform;
    c: string; // companyId
    u: string; // userId
    p: string | null; // projectId
    r: string; // redirectUri
    exp: number;
}

// ── state signing ────────────────────────────────────────────────────────────

export function signState(payload: StatePayload): string {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.createHmac('sha256', stateSigningKey()).update(body).digest('base64url');
    return `${body}.${sig}`;
}

export function verifyState(state: string): StatePayload {
    const [body, sig] = String(state || '').split('.');
    if (!body || !sig) throw new PublishError('OAUTH_STATE_INVALID', 'Missing or malformed OAuth state.');
    const expected = crypto.createHmac('sha256', stateSigningKey()).update(body).digest();
    const got = Buffer.from(sig, 'base64url');
    if (got.length !== expected.length || !crypto.timingSafeEqual(got, expected)) throw new PublishError('OAUTH_STATE_INVALID', 'OAuth state signature is invalid.');
    let p: StatePayload;
    try {
        p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch {
        throw new PublishError('OAUTH_STATE_INVALID', 'OAuth state is unreadable.');
    }
    if (!p.exp || p.exp < timing.now()) throw new PublishError('OAUTH_STATE_INVALID', 'OAuth state has expired; start the connection again.');
    return p;
}

// ── redirect allow-list ──────────────────────────────────────────────────────

function webOrigins(): string[] {
    const raw = [process.env.CLIENT_URL, process.env.SOCIAL_OAUTH_WEB_ORIGINS].filter(Boolean).join(',');
    return raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => {
            try {
                return new URL(s).origin;
            } catch {
                return null;
            }
        })
        .filter(Boolean) as string[];
}

/** Only the app's deep link (mobile) or a page on a configured web origin (web) may receive the result. */
export function assertRedirectAllowed(redirectUri: string, client: 'mobile' | 'web'): string {
    let u: URL;
    try {
        u = new URL(redirectUri);
    } catch {
        throw new PublishError('OAUTH_REDIRECT_NOT_ALLOWED', 'redirectUri is not a valid URL.');
    }
    const extra = (process.env.SOCIAL_OAUTH_ALLOWED_REDIRECTS || '').split(',').map((s) => s.trim()).filter(Boolean);
    const bare = `${u.protocol}//${u.host}${u.pathname}`;
    if (client === 'mobile') {
        if (bare === MOBILE_OAUTH_REDIRECT || extra.includes(bare)) return redirectUri;
        throw new PublishError('OAUTH_REDIRECT_NOT_ALLOWED', `Mobile clients must use ${MOBILE_OAUTH_REDIRECT}.`);
    }
    if (u.username || u.password) throw new PublishError('OAUTH_REDIRECT_NOT_ALLOWED', 'redirectUri must not contain credentials.');
    const localHttp = u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname);
    if ((u.protocol === 'https:' || localHttp) && (webOrigins().includes(u.origin) || extra.includes(bare))) return redirectUri;
    throw new PublishError('OAUTH_REDIRECT_NOT_ALLOWED', 'redirectUri is not on the allow-list (CLIENT_URL / SOCIAL_OAUTH_WEB_ORIGINS / SOCIAL_OAUTH_ALLOWED_REDIRECTS).');
}

export function withParams(redirectUri: string, params: Record<string, string | undefined | null>): string {
    const u = new URL(redirectUri);
    for (const [k, v] of Object.entries(params)) if (v != null && v !== '') u.searchParams.set(k, v);
    return u.toString();
}

// ── service ──────────────────────────────────────────────────────────────────

export interface StartOAuthInput {
    platform: string;
    companyId: string;
    userId: string;
    projectId?: string | null;
    redirectUri: string;
    client?: string;
}

export interface CandidateView {
    candidateId: string;
    kind: CandidateAccount['kind'];
    platform: PublishPlatform;
    platformAccountId: string;
    accountName: string;
    username: string;
    profileImageUrl?: string | null;
    metadata: Record<string, any>;
}

const view = (c: CandidateAccount): CandidateView => ({
    candidateId: c.candidateId,
    kind: c.kind,
    platform: c.platform,
    platformAccountId: c.platformAccountId,
    accountName: c.accountName,
    username: c.username,
    profileImageUrl: c.profileImageUrl,
    metadata: c.metadata,
});

export class SocialOAuthService {
    static async start(input: StartOAuthInput): Promise<{ url: string; state: string; expiresAt: string }> {
        const platform = normalizePlatform(input.platform);
        if (!platform) throw new PublishError('UNSUPPORTED_PLATFORM', `Unsupported platform "${input.platform}".`);
        if (!input.companyId || !input.userId) throw new PublishError('OAUTH_STATE_INVALID', 'Authenticated user and company are required.');
        const client = input.client === 'mobile' ? 'mobile' : 'web';
        const redirectUri = assertRedirectAllowed(String(input.redirectUri || ''), client);

        const db = getDb();
        const projectId = input.projectId ? String(input.projectId) : null;
        if (projectId) {
            const project = await db.project.findFirst({ where: { id: projectId, companyId: input.companyId }, select: { id: true } });
            if (!project) throw new PublishError('NOT_FOUND', 'Project not found.');
        }

        const isMockLinkedIn = platform === 'linkedin' && getLinkedInProviderMode() === 'mock';
        const isMockYouTube = platform === 'youtube' && getYouTubeProviderMode() === 'mock';
        if ((!isPlatformConfigured(platform) && isSimulationMode()) || isMockLinkedIn || isMockYouTube) {
            let candidate: CandidateAccount;
            if (platform === 'linkedin') {
                candidate = {
                    candidateId: 'member:mock_member_180',
                    platform: 'linkedin',
                    kind: 'member',
                    platformAccountId: 'urn:li:person:mock_member_180',
                    accountName: 'Alex Rivera (Demo)',
                    username: 'alex.rivera',
                    profileImageUrl: 'https://api.dicebear.com/7.x/identicon/png?seed=linkedin-demo',
                    metadata: { memberId: 'mock_member_180', simulated: true, connectedAt: new Date().toISOString() },
                    tokens: {
                        accessToken: 'simulated_linkedin_token',
                        scopes: ['openid', 'profile', 'w_member_social'],
                    },
                };
            } else if (platform === 'youtube') {
                candidate = {
                    candidateId: 'channel:UC_mock_180_channel',
                    platform: 'youtube',
                    kind: 'channel',
                    platformAccountId: 'UC_mock_180_channel',
                    accountName: '180 Workspace Channel (Demo)',
                    username: '@180workspace',
                    profileImageUrl: 'https://api.dicebear.com/7.x/identicon/png?seed=youtube-demo',
                    metadata: {
                        channelId: 'UC_mock_180_channel',
                        customUrl: '@180workspace',
                        simulated: true,
                        connectedAt: new Date().toISOString(),
                    },
                    tokens: {
                        accessToken: 'simulated_youtube_token',
                        scopes: [
                            'https://www.googleapis.com/auth/youtube.upload',
                            'https://www.googleapis.com/auth/youtube.readonly',
                            'https://www.googleapis.com/auth/youtube.force-ssl',
                            'https://www.googleapis.com/auth/yt-analytics.readonly',
                        ],
                    },
                };
            } else {
                candidate = {
                    candidateId: `sandbox:${platform}`,
                    platform,
                    kind: 'user',
                    platformAccountId: `sandbox_${platform}_${input.companyId.slice(0, 8)}`,
                    accountName: `${platform.charAt(0).toUpperCase() + platform.slice(1)} (Sandbox)`,
                    username: `sandbox_${platform}`,
                    profileImageUrl: `https://api.dicebear.com/7.x/identicon/png?seed=${platform}`,
                    metadata: { simulated: true, connectedAt: new Date().toISOString() },
                    tokens: {
                        accessToken: 'simulated_sandbox_token',
                        scopes: ['publish', 'read'],
                    },
                };
            }
            const account = await this.connectCandidate(input.companyId, projectId, candidate);
            const targetUrl = withParams(redirectUri, {
                status: 'connected',
                platform,
                accountId: account.id,
            });
            return {
                url: targetUrl,
                state: 'simulated_state',
                expiresAt: new Date(timing.now() + SESSION_TTL_MS).toISOString(),
            };
        }

        requireAppCredentials(platform);
        const callback = oauthCallbackUrl(platform);

        const provider = getOAuthProvider(platform);
        const sid = crypto.randomUUID();
        const verifier = provider.usesPkce ? crypto.randomBytes(48).toString('base64url') : null;
        const challenge = verifier ? crypto.createHash('sha256').update(verifier).digest('base64url') : undefined;
        const expiresAt = new Date(timing.now() + SESSION_TTL_MS);

        await db.socialOAuthSession.create({
            data: {
                id: sid,
                companyId: input.companyId,
                userId: input.userId,
                projectId,
                platform,
                client,
                redirectUri,
                codeVerifierEnc: verifier ? encryptSecret(verifier, `oauth-session:${sid}`) : null,
                status: 'pending',
                expiresAt,
            },
        });
        const state = signState({ sid, pf: platform, c: input.companyId, u: input.userId, p: projectId, r: redirectUri, exp: expiresAt.getTime() });
        const url = provider.authorizeUrl({ state, redirectUri: callback, codeChallenge: challenge });
        return { url, state, expiresAt: expiresAt.toISOString() };
    }

    /**
     * Handles the provider redirect. Throws OAUTH_STATE_INVALID when the state cannot be trusted (the route then
     * answers 400 without redirecting anywhere); otherwise always returns the client redirect URL.
     */
    static async callback(platformParam: string, query: Record<string, any>): Promise<{ redirectTo: string; status: string; accountIds: string[] }> {
        const platform = normalizePlatform(platformParam);
        const st = verifyState(String(query.state || ''));
        if (!platform || st.pf !== platform) throw new PublishError('OAUTH_STATE_INVALID', 'OAuth state does not match this platform.');

        const db = getDb();
        const session = await db.socialOAuthSession.findUnique({ where: { id: st.sid } });
        if (!session || session.companyId !== st.c || session.userId !== st.u || session.redirectUri !== st.r || session.platform !== platform) {
            throw new PublishError('OAUTH_STATE_INVALID', 'OAuth session not found for this state.');
        }
        if (new Date(session.expiresAt).getTime() < timing.now()) throw new PublishError('OAUTH_STATE_INVALID', 'OAuth session expired; start again.');
        const claimed = await db.socialOAuthSession.updateMany({ where: { id: session.id, consumedAt: null }, data: { consumedAt: new Date(timing.now()) } });
        if (claimed.count !== 1) throw new PublishError('OAUTH_STATE_INVALID', 'This OAuth callback was already used.');

        const fail = async (code: string, description: string) => {
            await db.socialOAuthSession.update({ where: { id: session.id }, data: { status: 'failed', error: `${code}: ${description}`.slice(0, 1000), codeVerifierEnc: null } });
            return { redirectTo: withParams(session.redirectUri, { status: 'error', platform: platformParam, error: code, error_description: description }), status: 'error', accountIds: [] };
        };

        if (query.error || query.error_code) {
            return fail(String(query.error || query.error_code), String(query.error_description || query.error_message || query.error_reason || 'Authorization was cancelled.'));
        }
        if (!query.code) return fail('missing_code', 'The platform did not return an authorization code.');

        try {
            const provider = getOAuthProvider(platform);
            const codeVerifier = session.codeVerifierEnc ? decryptSecret(session.codeVerifierEnc, `oauth-session:${session.id}`) : undefined;
            const tokens = await provider.exchangeCode({ code: String(query.code), redirectUri: oauthCallbackUrl(platform), codeVerifier });
            const candidates = await provider.discoverAccounts(tokens);
            if (!candidates.length) {
                const hint =
                    platform === 'instagram'
                        ? 'No Instagram professional account was found for this user.'
                        : platform === 'facebook'
                          ? 'No Facebook Pages were shared with the app.'
                          : platform === 'youtube'
                            ? 'This Google account has no YouTube channel.'
                            : platform === 'threads'
                              ? 'No Threads account was found for this user.'
                              : 'No publishable account was found.';
                return fail('no_accounts', hint);
            }

            if (provider.selectable && candidates.length > 1) {
                await db.socialOAuthSession.update({
                    where: { id: session.id },
                    data: { status: 'awaiting_selection', candidatesEnc: encryptSecret(JSON.stringify(candidates), `oauth-candidates:${session.id}`), codeVerifierEnc: null },
                });
                return {
                    redirectTo: withParams(session.redirectUri, { status: 'select', platform: platformParam, selectionId: session.id, count: String(candidates.length) }),
                    status: 'select',
                    accountIds: [],
                };
            }

            const accounts = [];
            for (const c of candidates) accounts.push(await this.connectCandidate(session.companyId, session.projectId, c));
            await db.socialOAuthSession.update({ where: { id: session.id }, data: { status: 'completed', codeVerifierEnc: null } });
            const ids = accounts.map((a: any) => a.id);
            return {
                redirectTo: withParams(session.redirectUri, { status: 'connected', platform: platformParam, accountId: ids[0], accountIds: ids.length > 1 ? ids.join(',') : undefined }),
                status: 'connected',
                accountIds: ids,
            };
        } catch (e: any) {
            const err = isPublishError(e) ? e : new PublishError('OAUTH_PROVIDER_ERROR', e?.message || String(e));
            return fail(err.code.toLowerCase(), err.message);
        }
    }

    private static async loadSelection(selectionId: string, companyId: string, userId: string) {
        const db = getDb();
        const s = await db.socialOAuthSession.findUnique({ where: { id: selectionId } });
        if (!s || s.companyId !== companyId || s.userId !== userId) throw new PublishError('NOT_FOUND', 'Selection not found.');
        if (s.status !== 'awaiting_selection' || !s.candidatesEnc) throw new PublishError('NOT_FOUND', 'This selection is no longer pending.');
        if (new Date(s.expiresAt).getTime() + SESSION_TTL_MS < timing.now()) throw new PublishError('OAUTH_STATE_INVALID', 'Selection expired; connect again.');
        const candidates: CandidateAccount[] = JSON.parse(decryptSecret(s.candidatesEnc, `oauth-candidates:${s.id}`));
        return { session: s, candidates };
    }

    static async getSelection(selectionId: string, companyId: string, userId: string) {
        const { session, candidates } = await this.loadSelection(selectionId, companyId, userId);
        return { selectionId: session.id, platform: session.platform, projectId: session.projectId, candidates: candidates.map(view) };
    }

    static async completeSelection(selectionId: string, companyId: string, userId: string, candidateIds: string[]) {
        const { session, candidates } = await this.loadSelection(selectionId, companyId, userId);
        const chosen = candidates.filter((c) => candidateIds.includes(c.candidateId));
        if (!chosen.length) throw new PublishError('VALIDATION_FAILED', 'Pick at least one account to connect.');
        const db = getDb();
        const claimed = await db.socialOAuthSession.updateMany({ where: { id: session.id, status: 'awaiting_selection' }, data: { status: 'completed', candidatesEnc: null } });
        if (claimed.count !== 1) throw new PublishError('NOT_FOUND', 'This selection is no longer pending.');
        const accounts = [];
        for (const c of chosen) accounts.push(await this.connectCandidate(session.companyId, session.projectId, c));
        return accounts;
    }

    /** Upserts the account row (no tokens on it) and stores the tokens in the vault. */
    static async connectCandidate(companyId: string, projectId: string | null, c: CandidateAccount) {
        const db = getDb();
        const existing = await db.socialAccount.findFirst({ where: { companyId, platform: c.platform, platformAccountId: c.platformAccountId } });
        const base = {
            accountName: c.accountName,
            username: c.username,
            profileImageUrl: c.profileImageUrl ?? null,
            metadata: { ...(existing?.metadata || {}), ...c.metadata, kind: c.kind },
            isActive: true,
            reauthRequired: false,
            reauthReason: null,
            ...(projectId ? { projectId } : {}),
        };
        const account = existing
            ? await db.socialAccount.update({ where: { id: existing.id }, data: base })
            : await db.socialAccount.create({ data: { companyId, platform: c.platform, platformAccountId: c.platformAccountId, scopes: c.tokens.scopes || [], ...base } });
        await SocialTokenVault.saveTokens(account.id, companyId, c.tokens);
        return account;
    }
}
