import { PublishError } from './errors';
import { linkedInApiVersion } from './linkedin-version';

/** Canonical platform ids used by accounts, variants and publishers. `twitter` is an alias of `x`. */
export type PublishPlatform = 'instagram' | 'facebook' | 'youtube' | 'linkedin' | 'x' | 'threads';
export const PUBLISH_PLATFORMS: PublishPlatform[] = ['instagram', 'facebook', 'youtube', 'linkedin', 'x', 'threads'];

export function normalizePlatform(raw: unknown): PublishPlatform | null {
    const v = String(raw ?? '').toLowerCase().trim();
    if (v === 'twitter' || v === 'x') return 'x';
    if (v === 'youtube_shorts' || v === 'youtube-shorts' || v === 'youtube') return 'youtube';
    if (v === 'threads' || v === 'thread') return 'threads';
    if (v.startsWith('insta')) return 'instagram';
    if (v === 'facebook' || v === 'fb') return 'facebook';
    if (v === 'linkedin') return 'linkedin';
    return null;
}

export interface AppCredentials {
    clientId: string;
    clientSecret: string;
}

/** Env var names per platform. Instagram and Facebook share the Meta app. */
const CREDENTIAL_ENV: Record<PublishPlatform, { id: string[]; secret: string[] }> = {
    instagram: { id: ['INSTAGRAM_APP_ID', 'META_APP_ID'], secret: ['INSTAGRAM_APP_SECRET', 'META_APP_SECRET'] },
    facebook: { id: ['META_APP_ID'], secret: ['META_APP_SECRET'] },
    threads: { id: ['THREADS_APP_ID', 'META_APP_ID'], secret: ['THREADS_APP_SECRET', 'META_APP_SECRET'] },
    youtube: { id: ['YOUTUBE_CLIENT_ID', 'GOOGLE_CLIENT_ID'], secret: ['YOUTUBE_CLIENT_SECRET', 'GOOGLE_CLIENT_SECRET'] },
    linkedin: { id: ['LINKEDIN_CLIENT_ID'], secret: ['LINKEDIN_CLIENT_SECRET'] },
    x: { id: ['X_CLIENT_ID', 'TWITTER_CLIENT_ID'], secret: ['X_CLIENT_SECRET', 'TWITTER_CLIENT_SECRET'] },
};

/**
 * Sandbox mode for demos / local UI work: publishers return clearly marked fake results (meta.simulated, ids
 * prefixed `sim_`). Strictly opt-in via SIMULATE_SOCIAL_PUBLISHING=true (ALLOW_SIMULATED_PUBLISHING is an alias)
 * and ALWAYS off when NODE_ENV=production. A missing platform key never switches it on: that is a
 * 503 PUBLISH_NOT_CONFIGURED, not a fake success.
 */
export function isSimulationMode(): boolean {
    const on = (v?: string) => ['true', '1'].includes(String(v ?? '').trim().toLowerCase());
    if (!on(process.env.SIMULATE_SOCIAL_PUBLISHING) && !on(process.env.ALLOW_SIMULATED_PUBLISHING)) return false;
    if (process.env.NODE_ENV === 'production') {
        if (!simulationWarned) console.error('[social-publishing] SIMULATE_SOCIAL_PUBLISHING is ignored in production.');
        simulationWarned = true;
        return false;
    }
    return true;
}
let simulationWarned = false;

const firstEnv = (names: string[]) => {
    for (const n of names) {
        const v = process.env[n]?.trim();
        if (v) return v;
    }
    return undefined;
};

export function credentialEnvNames(platform: PublishPlatform): string[] {
    const c = CREDENTIAL_ENV[platform];
    return [c.id[0], c.secret[0]];
}

export function isPlatformConfigured(platform: PublishPlatform): boolean {
    const c = CREDENTIAL_ENV[platform];
    return Boolean(firstEnv(c.id) && firstEnv(c.secret));
}

/** App credentials from the environment only; never a value embedded in code. Missing → PUBLISH_NOT_CONFIGURED. */
export function requireAppCredentials(platform: PublishPlatform): AppCredentials {
    const c = CREDENTIAL_ENV[platform];
    const clientId = firstEnv(c.id);
    const clientSecret = firstEnv(c.secret);
    if (!clientId || !clientSecret) {
        const missing = [!clientId ? c.id[0] : null, !clientSecret ? c.secret[0] : null].filter(Boolean);
        throw new PublishError('PUBLISH_NOT_CONFIGURED', `${platform} publishing is not configured on this server (missing ${missing.join(', ')}).`, {
            platform,
            details: { missingEnv: missing },
        });
    }
    return { clientId, clientSecret };
}

/** Public base URL of this API, used to build provider redirect URIs. */
export function oauthCallbackUrl(platform: PublishPlatform): string {
    const base = (process.env.SOCIAL_OAUTH_CALLBACK_BASE_URL || 'https://api.180workspace.com').trim().replace(/\/+$/, '');
    return `${base}/api/v1/social-media/accounts/oauth/${platform}/callback`;
}

export const META_GRAPH_VERSION = () => process.env.META_GRAPH_VERSION?.trim() || 'v21.0';
export const LINKEDIN_API_VERSION = () => linkedInApiVersion();

/**
 * Meta webhook hub.verify_token. Read from env only; there is deliberately no fallback (a literal default
 * would be a publicly known secret). Empty means "not configured" and the verify endpoint answers 503.
 */
export function metaWebhookVerifyToken(): string {
    return process.env.META_WEBHOOK_VERIFY_TOKEN?.trim() || '';
}

export function metaWebhookAppSecret(): string {
    return process.env.META_WEBHOOK_APP_SECRET?.trim() || process.env.META_APP_SECRET?.trim() || '';
}

export const intEnv = (name: string, def: number) => {
    const n = Number(process.env[name]);
    return Number.isFinite(n) && n > 0 ? n : def;
};

/**
 * Detects whether an access token belongs to Instagram Direct / Instagram User Login
 * (e.g. IGAA..., IGAQ..., IGQV...) vs a Facebook Page / User Token (e.g. EAAB...).
 */
export function isInstagramUserToken(token?: string | null): boolean {
    if (!token) return false;
    const t = token.trim();
    return t.startsWith('IGA') || t.startsWith('IGAA') || t.startsWith('IGQ') || t.startsWith('IGD');
}

/**
 * Resolves the appropriate Meta Graph host depending on token type and target platform.
 * Direct Instagram User access tokens MUST call `https://graph.instagram.com`.
 * Facebook tokens and legacy Page-linked tokens call `https://graph.facebook.com`.
 */
export function metaGraphHost(token?: string | null, platform?: string | null): string {
    if (token && isInstagramUserToken(token)) {
        return 'https://graph.instagram.com';
    }
    return 'https://graph.facebook.com';
}

/**
 * Constructs a fully qualified Graph API URL respecting Instagram User Tokens.
 */
export function metaGraphUrl(path: string, token?: string | null, platform?: string | null): string {
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    const cleanPath = path.replace(/^\/+/, '');
    return `${metaGraphHost(token, platform)}/${META_GRAPH_VERSION()}/${cleanPath}`;
}


