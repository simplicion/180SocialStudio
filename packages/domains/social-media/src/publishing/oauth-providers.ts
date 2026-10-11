/**
 * OAuth 2.0 provider definitions (authorize URL, code exchange, refresh, account discovery) per platform.
 * All app credentials come from env via requireAppCredentials() — a missing key is a 503 PUBLISH_NOT_CONFIGURED.
 */
import { META_GRAPH_VERSION, PublishPlatform, requireAppCredentials } from './config';
import { linkedInApiVersion } from './linkedin-version';
import { PublishError } from './errors';
import { providerFetch, providerMessage, readBody } from './http';

export interface TokenSet {
    accessToken: string;
    refreshToken?: string | null;
    expiresAt?: Date | null;
    refreshExpiresAt?: Date | null;
    scopes: string[];
    tokenType?: string | null;
    userId?: string | null;
}

export interface CandidateAccount {
    /** Stable id inside one OAuth session, shown to the user when a selection step is needed. */
    candidateId: string;
    platform: PublishPlatform;
    kind: 'page' | 'instagram_business' | 'channel' | 'member' | 'organization' | 'user';
    platformAccountId: string;
    accountName: string;
    username: string;
    profileImageUrl?: string | null;
    metadata: Record<string, any>;
    tokens: TokenSet;
}

export interface OAuthProvider {
    platform: PublishPlatform;
    usesPkce: boolean;
    /** When true and more than one candidate is found, the user picks which ones to connect. */
    selectable: boolean;
    authorizeUrl(p: { state: string; redirectUri: string; codeChallenge?: string }): string;
    exchangeCode(p: { code: string; redirectUri: string; codeVerifier?: string }): Promise<TokenSet>;
    discoverAccounts(tokens: TokenSet): Promise<CandidateAccount[]>;
    refresh?(refreshToken: string): Promise<TokenSet>;
}

const expiresIn = (secs: any): Date | null => (Number(secs) > 0 ? new Date(Date.now() + Number(secs) * 1000) : null);
const splitScopes = (s: any, sep = /[ ,]+/) => (typeof s === 'string' ? s.split(sep).filter(Boolean) : Array.isArray(s) ? s : []);
const envScopes = (name: string, def: string[]) => (process.env[name]?.trim() ? process.env[name]!.split(/[ ,]+/).filter(Boolean) : def);

async function oauthJson(platform: string, res: Response, what: string) {
    const b = await readBody(res);
    if (!res.ok || b?.error) {
        const invalidGrant = b?.error === 'invalid_grant' || b?.error?.code === 190 || res.status === 401 || /invalid_grant|expired|revoked/i.test(String(b?.error_description || ''));
        throw new PublishError(invalidGrant ? 'REAUTH_REQUIRED' : 'OAUTH_PROVIDER_ERROR', `${what}: ${providerMessage(b, `HTTP ${res.status}`)}`, {
            platform,
            retryable: !invalidGrant && res.status >= 500,
        });
    }
    return b;
}

const form = (o: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(o)) if (v != null) p.set(k, v);
    return p;
};

// ── Meta (Facebook Pages + Instagram professional accounts) ──────────────────

const isInstagramBusinessLogin = () => Boolean(process.env.INSTAGRAM_APP_ID?.trim());

const facebookProvider: OAuthProvider = {
    platform: 'facebook',
    usesPkce: false,
    selectable: true,
    authorizeUrl({ state, redirectUri }) {
        const { clientId } = requireAppCredentials('facebook');
        const scopes = envScopes('META_FACEBOOK_SCOPES', ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'pages_manage_engagement', 'business_management']);
        const q = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, state, response_type: 'code' });
        const configId = process.env.META_LOGIN_CONFIG_ID?.trim();
        if (configId) q.set('config_id', configId);
        else q.set('scope', scopes.join(','));
        return `https://www.facebook.com/${META_GRAPH_VERSION()}/dialog/oauth?${q}`;
    },
    async exchangeCode({ code, redirectUri }) {
        const { clientId, clientSecret } = requireAppCredentials('facebook');
        const graph = (p: string) => `https://graph.facebook.com/${META_GRAPH_VERSION()}/${p}`;
        const scopes = envScopes('META_FACEBOOK_SCOPES', ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'pages_manage_engagement', 'business_management']);
        const short = await oauthJson('facebook', await providerFetch('facebook', graph(`oauth/access_token?${new URLSearchParams({ client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, code })}`)), 'Facebook code exchange');
        const long = await oauthJson('facebook', await providerFetch('facebook', graph(`oauth/access_token?${new URLSearchParams({ grant_type: 'fb_exchange_token', client_id: clientId, client_secret: clientSecret, fb_exchange_token: short.access_token })}`)), 'Facebook long-lived token');
        return { accessToken: long.access_token, expiresAt: expiresIn(long.expires_in), scopes, tokenType: 'user' };
    },
    async discoverAccounts(tokens) {
        const graph = (p: string) => `https://graph.facebook.com/${META_GRAPH_VERSION()}/${p}`;
        const fields = 'id,name,access_token,picture{url}';
        const res = await providerFetch('facebook', graph(`me/accounts?fields=${encodeURIComponent(fields)}&limit=100`), { headers: { Authorization: `Bearer ${tokens.accessToken}` } });
        const body = await oauthJson('facebook', res, 'Facebook page list');
        const pages: any[] = body.data || [];
        const out: CandidateAccount[] = [];
        for (const p of pages) {
            if (!p.access_token) continue;
            const pageTokens: TokenSet = { accessToken: p.access_token, expiresAt: null, scopes: tokens.scopes, tokenType: 'page' };
            out.push({ candidateId: `page:${p.id}`, platform: 'facebook', kind: 'page', platformAccountId: String(p.id), accountName: p.name, username: p.name, profileImageUrl: p.picture?.data?.url ?? null, metadata: { pageId: p.id }, tokens: pageTokens });
        }
        return out;
    },
};

const instagramProvider: OAuthProvider = {
    platform: 'instagram',
    usesPkce: false,
    selectable: true,
    authorizeUrl({ state, redirectUri }) {
        const { clientId } = requireAppCredentials('instagram');
        if (isInstagramBusinessLogin()) {
            const scopes = envScopes('META_INSTAGRAM_SCOPES', [
                'instagram_business_basic',
                'instagram_business_content_publish',
                'instagram_business_manage_messages',
                'instagram_business_manage_comments',
            ]);
            const q = new URLSearchParams({
                enable_fb_login: '0',
                force_authentication: '1',
                client_id: clientId,
                redirect_uri: redirectUri,
                response_type: 'code',
                scope: scopes.join(','),
                state,
            });
            return `https://www.instagram.com/oauth/authorize?${q}`;
        }
        // Legacy / Facebook Login fallback
        const scopes = envScopes('META_INSTAGRAM_SCOPES', ['instagram_basic', 'instagram_content_publish', 'instagram_manage_comments', 'pages_show_list', 'pages_read_engagement', 'business_management']);
        const q = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, state, response_type: 'code' });
        const configId = process.env.META_LOGIN_CONFIG_ID?.trim();
        if (configId) q.set('config_id', configId);
        else q.set('scope', scopes.join(','));
        return `https://www.facebook.com/${META_GRAPH_VERSION()}/dialog/oauth?${q}`;
    },
    async exchangeCode({ code, redirectUri }) {
        const { clientId, clientSecret } = requireAppCredentials('instagram');
        if (isInstagramBusinessLogin()) {
            const scopes = envScopes('META_INSTAGRAM_SCOPES', [
                'instagram_business_basic',
                'instagram_business_content_publish',
                'instagram_business_manage_messages',
                'instagram_business_manage_comments',
            ]);
            const short = await oauthJson('instagram', await providerFetch('instagram', 'https://api.instagram.com/oauth/access_token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: form({ client_id: clientId, client_secret: clientSecret, grant_type: 'authorization_code', redirect_uri: redirectUri, code }),
            }), 'Instagram Business code exchange');

            let long: any = null;
            try {
                // Try POST first (preferred by Meta Graph API token exchange)
                const postRes = await providerFetch('instagram', 'https://graph.instagram.com/access_token', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: form({
                        grant_type: 'ig_exchange_token',
                        client_secret: clientSecret,
                        access_token: short.access_token,
                    }),
                });
                const postBody = await readBody(postRes);
                if (postRes.ok && postBody?.access_token) {
                    long = postBody;
                } else {
                    // Fall back to GET as documented in Graph API specs
                    const getRes = await providerFetch('instagram', `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(clientSecret)}&access_token=${encodeURIComponent(short.access_token)}`);
                    const getBody = await readBody(getRes);
                    if (getRes.ok && getBody?.access_token) {
                        long = getBody;
                    } else {
                        console.warn('[social-publishing] Instagram long-lived token exchange warning (using short-lived token):', postBody?.error?.message || getBody?.error?.message || 'Unsupported');
                    }
                }
            } catch (err: any) {
                console.warn('[social-publishing] Instagram long-lived token exchange failed (using short-lived token):', err?.message || err);
            }

            const token = long?.access_token || short.access_token;
            return {
                accessToken: token,
                refreshToken: token,
                expiresAt: expiresIn(long?.expires_in || short?.expires_in || 3600),
                scopes,
                tokenType: 'bearer',
                userId: short?.user_id ? String(short.user_id) : undefined,
            };
        }

        // Facebook Login for Business fallback
        const graph = (p: string) => `https://graph.facebook.com/${META_GRAPH_VERSION()}/${p}`;
        const scopes = envScopes('META_INSTAGRAM_SCOPES', ['instagram_basic', 'instagram_content_publish', 'instagram_manage_comments', 'pages_show_list', 'pages_read_engagement', 'business_management']);
        const short = await oauthJson('instagram', await providerFetch('instagram', graph(`oauth/access_token?${new URLSearchParams({ client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, code })}`)), 'Meta code exchange');
        const long = await oauthJson('instagram', await providerFetch('instagram', graph(`oauth/access_token?${new URLSearchParams({ grant_type: 'fb_exchange_token', client_id: clientId, client_secret: clientSecret, fb_exchange_token: short.access_token })}`)), 'Meta long-lived token');
        return { accessToken: long.access_token, expiresAt: expiresIn(long.expires_in), scopes, tokenType: 'user' };
    },
    async discoverAccounts(tokens) {
        if (isInstagramBusinessLogin()) {
            // Instagram API with Instagram Login endpoint (graph.instagram.com/me)
            // Supported profile fields: id, username, name, profile_picture_url
            const fields = 'id,username,name,profile_picture_url';
            let res = await providerFetch('instagram', `https://graph.instagram.com/me?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(tokens.accessToken)}`, {
                headers: { Authorization: `Bearer ${tokens.accessToken}` },
            });
            let b = await readBody(res);

            // Also check versioned endpoint if unversioned didn't return an id or user_id
            if (!res.ok || (!b?.id && !b?.user_id)) {
                const vRes = await providerFetch('instagram', `https://graph.instagram.com/${META_GRAPH_VERSION()}/me?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(tokens.accessToken)}`, {
                    headers: { Authorization: `Bearer ${tokens.accessToken}` },
                });
                const vBody = await readBody(vRes);
                if (vRes.ok && (vBody?.id || vBody?.user_id)) {
                    b = vBody;
                    res = vRes;
                }
            }

            if (!res.ok || (!b?.id && !b?.user_id && !tokens.userId)) {
                const rawMsg = providerMessage(b, `HTTP ${res.status}`);
                let msg = `Instagram Business profile: ${rawMsg}`;
                if (rawMsg.includes('Unsupported request') || rawMsg.includes('method type: get')) {
                    msg = `Instagram connection failed: Ensure your Instagram account is switched to a Professional (Creator or Business) account in the Instagram app, and that your Meta app has the "instagram_business_basic" permission configured.`;
                }
                throw new PublishError('OAUTH_PROVIDER_ERROR', msg, { platform: 'instagram' });
            }

            const igId = String(b.id || b.user_id || tokens.userId);
            return [{
                candidateId: `ig:${igId}`,
                platform: 'instagram',
                kind: 'instagram_business',
                platformAccountId: igId,
                accountName: b.name || b.username || 'Instagram Business',
                username: b.username || 'instagram_user',
                profileImageUrl: b.profile_picture_url ?? null,
                metadata: { igUserId: igId, loginMode: 'instagram_business' },
                tokens,
            }];
        }

        // Facebook Login for Business fallback
        const graph = (p: string) => `https://graph.facebook.com/${META_GRAPH_VERSION()}/${p}`;
        const fields = 'id,name,access_token,picture{url},instagram_business_account{id,username,name,profile_picture_url}';
        const res = await providerFetch('instagram', graph(`me/accounts?fields=${encodeURIComponent(fields)}&limit=100`), { headers: { Authorization: `Bearer ${tokens.accessToken}` } });
        const body = await oauthJson('instagram', res, 'Meta page list');
        const pages: any[] = body.data || [];
        const out: CandidateAccount[] = [];
        for (const p of pages) {
            if (!p.access_token || !p.instagram_business_account?.id) continue;
            const ig = p.instagram_business_account;
            const pageTokens: TokenSet = { accessToken: p.access_token, expiresAt: null, scopes: tokens.scopes, tokenType: 'page' };
            out.push({
                candidateId: `ig:${ig.id}`,
                platform: 'instagram',
                kind: 'instagram_business',
                platformAccountId: String(ig.id),
                accountName: ig.name || ig.username,
                username: ig.username,
                profileImageUrl: ig.profile_picture_url ?? null,
                metadata: { pageId: p.id, pageName: p.name, loginMode: 'facebook_login' },
                tokens: pageTokens,
            });
        }
        return out;
    },
    async refresh(refreshToken) {
        if (isInstagramBusinessLogin()) {
            const b = await oauthJson('instagram', await providerFetch('instagram', `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(refreshToken)}`, {
                method: 'GET',
            }), 'Instagram token refresh');
            return {
                accessToken: b.access_token,
                refreshToken: b.access_token,
                expiresAt: expiresIn(b.expires_in),
                scopes: splitScopes(b.scope),
                tokenType: 'bearer',
            };
        }
        throw new PublishError('REAUTH_REQUIRED', 'Facebook Page tokens do not expire or use user token refresh; reconnect this account.', { platform: 'instagram' });
    },
};

// ── Google / YouTube ─────────────────────────────────────────────────────────

const youtubeProvider: OAuthProvider = {
    platform: 'youtube',
    usesPkce: true,
    selectable: false,
    authorizeUrl({ state, redirectUri, codeChallenge }) {
        const { clientId } = requireAppCredentials('youtube');
        const q = new URLSearchParams({
            client_id: clientId,
            redirect_uri: redirectUri,
            response_type: 'code',
            scope: envScopes('YOUTUBE_SCOPES', [
                'https://www.googleapis.com/auth/youtube.upload',
                'https://www.googleapis.com/auth/youtube.readonly',
                'https://www.googleapis.com/auth/youtube.force-ssl',
                'https://www.googleapis.com/auth/yt-analytics.readonly',
            ]).join(' '),
            access_type: 'offline',
            prompt: 'consent',
            include_granted_scopes: 'true',
            state,
            code_challenge: codeChallenge!,
            code_challenge_method: 'S256',
        });
        return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
    },
    async exchangeCode({ code, redirectUri, codeVerifier }) {
        const { clientId, clientSecret } = requireAppCredentials('youtube');
        const b = await oauthJson('youtube', await providerFetch('youtube', 'https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: form({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: codeVerifier }),
        }), 'Google code exchange');
        return { accessToken: b.access_token, refreshToken: b.refresh_token ?? null, expiresAt: expiresIn(b.expires_in), scopes: splitScopes(b.scope), tokenType: b.token_type };
    },
    async refresh(refreshToken) {
        const { clientId, clientSecret } = requireAppCredentials('youtube');
        const b = await oauthJson('youtube', await providerFetch('youtube', 'https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: form({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
        }), 'Google token refresh');
        return { accessToken: b.access_token, refreshToken: b.refresh_token ?? refreshToken, expiresAt: expiresIn(b.expires_in), scopes: splitScopes(b.scope), tokenType: b.token_type };
    },
    async discoverAccounts(tokens) {
        const res = await providerFetch('youtube', 'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers: { Authorization: `Bearer ${tokens.accessToken}` } });
        const b = await oauthJson('youtube', res, 'YouTube channel lookup');
        return (b.items || []).map((c: any) => ({
            candidateId: `channel:${c.id}`,
            platform: 'youtube' as const,
            kind: 'channel' as const,
            platformAccountId: String(c.id),
            accountName: c.snippet?.title || 'YouTube channel',
            username: c.snippet?.customUrl || c.snippet?.title || c.id,
            profileImageUrl: c.snippet?.thumbnails?.default?.url ?? null,
            metadata: { channelId: c.id },
            tokens,
        }));
    },
};

// ── LinkedIn (member + organisation pages) ───────────────────────────────────

const linkedinProvider: OAuthProvider = {
    platform: 'linkedin',
    usesPkce: false,
    selectable: true,
    authorizeUrl({ state, redirectUri }) {
        const { clientId } = requireAppCredentials('linkedin');
        const allowOrg = process.env.LINKEDIN_ENABLE_ORGANIZATIONS === 'true';
        const base = ['openid', 'profile', 'w_member_social'];
        const org = allowOrg ? ['r_organization_social', 'w_organization_social', 'rw_organization_admin'] : [];
        let scopes = envScopes('LINKEDIN_SCOPES', [...base, ...org]);
        if (!allowOrg) {
            // Strip organization scopes unless explicitly enabled to prevent invalid_scope_error
            scopes = scopes.filter((s) => !s.toLowerCase().includes('organization'));
        }
        const q = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, state, scope: scopes.join(' ') });
        return `https://www.linkedin.com/oauth/v2/authorization?${q}`;
    },
    async exchangeCode({ code, redirectUri }) {
        const { clientId, clientSecret } = requireAppCredentials('linkedin');
        const b = await oauthJson('linkedin', await providerFetch('linkedin', 'https://www.linkedin.com/oauth/v2/accessToken', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: form({ grant_type: 'authorization_code', code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri }),
        }), 'LinkedIn code exchange');
        return { accessToken: b.access_token, refreshToken: b.refresh_token ?? null, expiresAt: expiresIn(b.expires_in), refreshExpiresAt: expiresIn(b.refresh_token_expires_in), scopes: splitScopes(b.scope), tokenType: 'Bearer' };
    },
    async refresh(refreshToken) {
        const { clientId, clientSecret } = requireAppCredentials('linkedin');
        const b = await oauthJson('linkedin', await providerFetch('linkedin', 'https://www.linkedin.com/oauth/v2/accessToken', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: form({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret }),
        }), 'LinkedIn token refresh');
        return { accessToken: b.access_token, refreshToken: b.refresh_token ?? refreshToken, expiresAt: expiresIn(b.expires_in), refreshExpiresAt: expiresIn(b.refresh_token_expires_in), scopes: splitScopes(b.scope), tokenType: 'Bearer' };
    },
    async discoverAccounts(tokens) {
        const auth = { Authorization: `Bearer ${tokens.accessToken}` };
        const me = await oauthJson('linkedin', await providerFetch('linkedin', 'https://api.linkedin.com/v2/userinfo', { headers: auth }), 'LinkedIn profile');
        const out: CandidateAccount[] = [
            { candidateId: `member:${me.sub}`, platform: 'linkedin', kind: 'member', platformAccountId: `urn:li:person:${me.sub}`, accountName: me.name || 'LinkedIn member', username: me.name || me.sub, profileImageUrl: me.picture ?? null, metadata: { memberId: me.sub }, tokens },
        ];
        if (tokens.scopes.includes('w_organization_social') || process.env.LINKEDIN_ENABLE_ORGANIZATIONS === 'true') {
            const h = { ...auth, 'LinkedIn-Version': linkedInApiVersion(), 'X-Restli-Protocol-Version': '2.0.0' };
            const aclRes = await providerFetch('linkedin', 'https://api.linkedin.com/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED', { headers: h });
            if (aclRes.ok) {
                const acl = await readBody(aclRes);
                for (const el of acl.elements || []) {
                    const urn: string = el.organization || el.organizationTarget;
                    if (!urn) continue;
                    const id = urn.split(':').pop()!;
                    const orgRes = await providerFetch('linkedin', `https://api.linkedin.com/rest/organizations/${id}`, { headers: h });
                    const org = orgRes.ok ? await readBody(orgRes) : {};
                    out.push({ candidateId: `org:${id}`, platform: 'linkedin', kind: 'organization', platformAccountId: urn, accountName: org.localizedName || `Organization ${id}`, username: org.vanityName || id, profileImageUrl: null, metadata: { organizationId: id }, tokens });
                }
            }
        }
        return out;
    },
};

// ── X ────────────────────────────────────────────────────────────────────────

const xApi = () => (process.env.X_API_BASE_URL?.trim() || 'https://api.x.com').replace(/\/+$/, '');
const xBasic = () => {
    const { clientId, clientSecret } = requireAppCredentials('x');
    return { clientId, header: `Basic ${Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`).toString('base64')}` };
};

const xProvider: OAuthProvider = {
    platform: 'x',
    usesPkce: true,
    selectable: false,
    authorizeUrl({ state, redirectUri, codeChallenge }) {
        const { clientId } = requireAppCredentials('x');
        const q = new URLSearchParams({
            response_type: 'code',
            client_id: clientId,
            redirect_uri: redirectUri,
            scope: envScopes('X_SCOPES', ['tweet.read', 'tweet.write', 'users.read', 'media.write', 'offline.access']).join(' '),
            state,
            code_challenge: codeChallenge!,
            code_challenge_method: 'S256',
        });
        return `https://x.com/i/oauth2/authorize?${q}`;
    },
    async exchangeCode({ code, redirectUri, codeVerifier }) {
        const { clientId, header } = xBasic();
        const b = await oauthJson('x', await providerFetch('x', `${xApi()}/2/oauth2/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: header },
            body: form({ code, grant_type: 'authorization_code', redirect_uri: redirectUri, code_verifier: codeVerifier, client_id: clientId }),
        }), 'X code exchange');
        return { accessToken: b.access_token, refreshToken: b.refresh_token ?? null, expiresAt: expiresIn(b.expires_in), scopes: splitScopes(b.scope), tokenType: b.token_type };
    },
    async refresh(refreshToken) {
        const { clientId, header } = xBasic();
        const b = await oauthJson('x', await providerFetch('x', `${xApi()}/2/oauth2/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: header },
            body: form({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId }),
        }), 'X token refresh');
        // X rotates refresh tokens: the old one is now invalid.
        return { accessToken: b.access_token, refreshToken: b.refresh_token ?? null, expiresAt: expiresIn(b.expires_in), scopes: splitScopes(b.scope), tokenType: b.token_type };
    },
    async discoverAccounts(tokens) {
        const b = await oauthJson('x', await providerFetch('x', `${xApi()}/2/users/me?user.fields=profile_image_url,subscription_type`, { headers: { Authorization: `Bearer ${tokens.accessToken}` } }), 'X profile');
        const u = b.data || {};
        return [{
            candidateId: `user:${u.id}`,
            platform: 'x',
            kind: 'user',
            platformAccountId: String(u.id),
            accountName: u.name || u.username,
            username: u.username,
            profileImageUrl: u.profile_image_url ?? null,
            metadata: { longPostsEnabled: ['Premium', 'PremiumPlus', 'Basic'].includes(u.subscription_type) },
            tokens,
        }];
    },
};


// ── Threads ──────────────────────────────────────────────────────────────────

const DEFAULT_THREADS_SCOPES = [
    'threads_basic',
    'threads_content_publish',
    'threads_delete',
    'threads_keyword_search',
    'threads_manage_insights',
    'threads_manage_mentions',
    'threads_manage_replies',
    'threads_read_replies',
    'threads_profile_discovery',
    'threads_share_to_instagram',
];

const threadsProvider: OAuthProvider = {
    platform: 'threads',
    usesPkce: false,
    selectable: false,
    authorizeUrl({ state, redirectUri }) {
        const { clientId } = requireAppCredentials('threads');
        const scopes = envScopes('THREADS_SCOPES', DEFAULT_THREADS_SCOPES);
        const p = new URLSearchParams({
            client_id: clientId,
            redirect_uri: redirectUri,
            scope: scopes.join(','),
            response_type: 'code',
            state,
        });
        return `https://threads.net/oauth/authorize?${p}`;
    },
    async exchangeCode({ code, redirectUri }) {
        const { clientId, clientSecret } = requireAppCredentials('threads');
        const scopes = envScopes('THREADS_SCOPES', DEFAULT_THREADS_SCOPES);
        const b = await oauthJson('threads', await providerFetch('threads', 'https://graph.threads.net/oauth/access_token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: form({ client_id: clientId, client_secret: clientSecret, grant_type: 'authorization_code', redirect_uri: redirectUri, code }),
        }), 'Threads token exchange');

        let longLived: any = null;
        try {
            longLived = await oauthJson('threads', await providerFetch('threads', `https://graph.threads.net/access_token?grant_type=th_exchange_token&client_secret=${encodeURIComponent(clientSecret)}&access_token=${encodeURIComponent(b.access_token)}`, {
                method: 'GET',
            }), 'Threads long-lived token exchange');
        } catch (err: any) {
            console.warn('[social-publishing] Threads long-lived token exchange warning (using short-lived token):', err?.message || err);
            const raw = String(err?.message || '');
            if (raw.includes('threads_basic') || raw.includes('Threads testers')) {
                throw new PublishError(
                    'OAUTH_PROVIDER_ERROR',
                    'Threads connection failed: This Meta app requires "threads_basic". In Development mode, your Threads username must be added under "Threads Testers" in Meta Developer Dashboard (Roles > Threads Testers) and accepted in your Threads app settings (Settings > Account > Website permissions > Invites).',
                    { platform: 'threads' }
                );
            }
        }

        const token = longLived?.access_token || b.access_token;
        return {
            accessToken: token,
            refreshToken: token,
            expiresAt: expiresIn(longLived?.expires_in || b.expires_in || 60 * 86400),
            tokenType: 'bearer',
            scopes: splitScopes(b.scope).length ? splitScopes(b.scope) : scopes,
        };
    },
    async discoverAccounts(tokens) {
        const res = await providerFetch('threads', 'https://graph.threads.net/v1.0/me?fields=id,username,name,threads_profile_picture_url,threads_biography', {
            headers: { Authorization: `Bearer ${tokens.accessToken}` },
        });
        const b = await readBody(res);
        if (!res.ok) {
            const rawMsg = providerMessage(b, `HTTP ${res.status}`);
            let msg = `Threads profile: ${rawMsg}`;
            if (rawMsg.includes('threads_basic') || rawMsg.includes('Threads testers')) {
                msg = 'Threads connection failed: Your Threads account must be added to "Threads Testers" in the Meta App Dashboard and accepted under Threads Settings > Account > Website permissions > Invites (or submit app for App Review).';
            }
            throw new PublishError('OAUTH_PROVIDER_ERROR', msg, { platform: 'threads' });
        }
        return [{
            candidateId: `user:${b.id}`,
            platform: 'threads',
            kind: 'user',
            platformAccountId: String(b.id),
            accountName: b.name || b.username,
            username: b.username || b.name,
            profileImageUrl: b.threads_profile_picture_url ?? null,
            metadata: { biography: b.threads_biography || null },
            tokens,
        }];
    },
    async refresh(refreshToken) {
        const b = await oauthJson('threads', await providerFetch('threads', `https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=${encodeURIComponent(refreshToken)}`, {
            method: 'GET',
        }), 'Threads token refresh');
        return {
            accessToken: b.access_token,
            refreshToken: b.access_token,
            expiresAt: expiresIn(b.expires_in),
            scopes: splitScopes(b.scope),
            tokenType: 'bearer',
        };
    },
};


const providers: Record<PublishPlatform, OAuthProvider> = {
    facebook: facebookProvider,
    instagram: instagramProvider,
    threads: threadsProvider,
    youtube: youtubeProvider,
    linkedin: linkedinProvider,
    x: xProvider,
};

export function getOAuthProvider(platform: PublishPlatform): OAuthProvider {
    return providers[platform];
}
