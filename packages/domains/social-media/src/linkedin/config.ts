/**
 * Centralized LinkedIn API configuration, versioning, and environment resolution.
 * Strictly adheres to 180 Workspace security standards: never exposes or logs raw credentials.
 */
import { linkedInApiVersion } from '../publishing/linkedin-version';

export interface LinkedInApiConfig {
    readonly restBaseUrl: string;
    readonly oauthAuthorizeUrl: string;
    readonly oauthTokenUrl: string;
    readonly userinfoUrl: string;
    readonly apiVersion: string;
    readonly restliProtocolVersion: string;
    readonly timeoutMs: number;
    readonly maxRetries: number;
    readonly retryInitialDelayMs: number;
    readonly retryMaxDelayMs: number;
    readonly rateLimitRps: number;
    readonly devTierDailyLimit: number;
}

export type LinkedInProviderMode = 'live' | 'mock';

export const LINKEDIN_SCOPES = {
    // Member capabilities (Share on LinkedIn product)
    OPENID: 'openid',
    PROFILE: 'profile',
    EMAIL: 'email',
    MEMBER_SHARE: 'w_member_social',

    // Organization / Community Management capabilities (Under review for App 263851696)
    ORG_READ_SOCIAL: 'r_organization_social',
    ORG_WRITE_SOCIAL: 'w_organization_social',
    ORG_READ_FEED: 'r_organization_social_feed',
    ORG_WRITE_FEED: 'w_organization_social_feed',
    ORG_ADMIN: 'rw_organization_admin',
    ORG_READ_ADMIN: 'r_organization_admin',
} as const;

export const DEFAULT_MEMBER_SCOPES = [
    LINKEDIN_SCOPES.OPENID,
    LINKEDIN_SCOPES.PROFILE,
    LINKEDIN_SCOPES.MEMBER_SHARE,
];

export const COMMUNITY_MANAGEMENT_ORG_SCOPES = [
    LINKEDIN_SCOPES.ORG_READ_SOCIAL,
    LINKEDIN_SCOPES.ORG_WRITE_SOCIAL,
    LINKEDIN_SCOPES.ORG_ADMIN,
];

const intEnv = (name: string, fallback: number): number => {
    const val = Number(process.env[name]);
    return Number.isFinite(val) && val > 0 ? val : fallback;
};

export function getLinkedInApiConfig(): LinkedInApiConfig {
    return {
        restBaseUrl: (process.env.LINKEDIN_API_BASE_URL || 'https://api.linkedin.com/rest').replace(/\/+$/, ''),
        oauthAuthorizeUrl: process.env.LINKEDIN_OAUTH_AUTH_URL || 'https://www.linkedin.com/oauth/v2/authorization',
        oauthTokenUrl: process.env.LINKEDIN_OAUTH_TOKEN_URL || 'https://www.linkedin.com/oauth/v2/accessToken',
        userinfoUrl: process.env.LINKEDIN_USERINFO_URL || 'https://api.linkedin.com/v2/userinfo',
        // LinkedIn Marketing Version is dynamically resolved and validated via linkedInApiVersion().
        apiVersion: linkedInApiVersion(),
        restliProtocolVersion: '2.0.0',
        timeoutMs: intEnv('LINKEDIN_REQUEST_TIMEOUT_MS', 30000),
        maxRetries: intEnv('LINKEDIN_MAX_RETRIES', 3),
        retryInitialDelayMs: intEnv('LINKEDIN_RETRY_INITIAL_DELAY_MS', 1000),
        retryMaxDelayMs: intEnv('LINKEDIN_RETRY_MAX_DELAY_MS', 10000),
        rateLimitRps: intEnv('LINKEDIN_RATE_LIMIT_RPS', 10),
        devTierDailyLimit: intEnv('LINKEDIN_DEV_TIER_DAILY_LIMIT', 500),
    };
}

export function getLinkedInProviderMode(): LinkedInProviderMode {
    // Production never serves the demo member: missing credentials surface as PUBLISH_NOT_CONFIGURED instead.
    if (process.env.NODE_ENV === 'production') return 'live';
    const forced = process.env.LINKEDIN_PROVIDER_MODE?.toLowerCase().trim();
    if (forced === 'mock' || forced === 'live') {
        return forced;
    }
    const hasClientId = Boolean(process.env.LINKEDIN_CLIENT_ID?.trim());
    const hasClientSecret = Boolean(process.env.LINKEDIN_CLIENT_SECRET?.trim());
    const simPublishing = ['true', '1'].includes(String(process.env.SIMULATE_SOCIAL_PUBLISHING ?? '').trim().toLowerCase());

    // If simulator enabled, or credentials missing, or not in production: fallback to mock safely
    if (simPublishing || !hasClientId || !hasClientSecret) {
        return 'mock';
    }
    return 'live';
}

export interface LinkedInConfigDiagnostics {
    mode: LinkedInProviderMode;
    clientId: 'CONFIGURED' | 'EMPTY';
    clientSecret: 'CONFIGURED' | 'EMPTY';
    apiVersion: string;
    restBaseUrl: string;
    communityManagementStatus: 'review_in_progress' | 'approved' | 'not_provisioned';
    configuredScopes: string[];
    livePublishingEnabled: boolean;
    mockPublishingEnabled: boolean;
}

export function getLinkedInDiagnostics(): LinkedInConfigDiagnostics {
    const mode = getLinkedInProviderMode();
    const config = getLinkedInApiConfig();
    const hasClientId = Boolean(process.env.LINKEDIN_CLIENT_ID?.trim());
    const hasClientSecret = Boolean(process.env.LINKEDIN_CLIENT_SECRET?.trim());
    const cmStatusRaw = process.env.LINKEDIN_COMMUNITY_MANAGEMENT_STATUS?.trim().toLowerCase();
    const cmStatus: LinkedInConfigDiagnostics['communityManagementStatus'] =
        cmStatusRaw === 'approved'
            ? 'approved'
            : cmStatusRaw === 'not_provisioned'
            ? 'not_provisioned'
            : 'review_in_progress';

    const customScopes = process.env.LINKEDIN_SCOPES?.trim();
    const configuredScopes = customScopes
        ? customScopes.split(/[ ,]+/).filter(Boolean)
        : [...DEFAULT_MEMBER_SCOPES, ...(cmStatus === 'approved' ? COMMUNITY_MANAGEMENT_ORG_SCOPES : [])];

    return {
        mode,
        clientId: hasClientId ? 'CONFIGURED' : 'EMPTY',
        clientSecret: hasClientSecret ? 'CONFIGURED' : 'EMPTY',
        apiVersion: config.apiVersion,
        restBaseUrl: config.restBaseUrl,
        communityManagementStatus: cmStatus,
        configuredScopes,
        livePublishingEnabled: mode === 'live' && hasClientId && hasClientSecret,
        mockPublishingEnabled: true,
    };
}
