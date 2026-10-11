/**
 * Standardized, platform-independent LinkedIn error definitions.
 * Technical details never contain client secrets, access tokens, or sensitive credentials.
 */

export type LinkedInErrorCode =
    | 'SOCIAL_PROVIDER_NOT_CONFIGURED'
    | 'SOCIAL_ACCOUNT_NOT_CONNECTED'
    | 'OAUTH_STATE_INVALID'
    | 'OAUTH_CODE_INVALID'
    | 'TOKEN_EXPIRED'
    | 'TOKEN_REFRESH_FAILED'
    | 'PERMISSION_MISSING'
    | 'CAPABILITY_NOT_GRANTED'
    | 'ACCOUNT_ROLE_INSUFFICIENT'
    | 'MEDIA_UPLOAD_FAILED'
    | 'PUBLISH_FAILED'
    | 'RATE_LIMITED'
    | 'PROVIDER_UNAVAILABLE'
    | 'PLATFORM_API_ERROR'
    | 'PLATFORM_VERSION_UNSUPPORTED'
    | 'PENDING_PLATFORM_ACCESS'
    | 'CROSS_PROJECT_FORBIDDEN';

export interface LinkedInErrorOptions {
    retryable?: boolean;
    httpStatus?: number;
    userAction?: string;
    technicalDetails?: Record<string, any>;
    cause?: unknown;
}

export class LinkedInIntegrationError extends Error {
    readonly provider = 'linkedin' as const;
    readonly code: LinkedInErrorCode;
    readonly retryable: boolean;
    readonly httpStatus: number;
    readonly userAction: string;
    readonly technicalDetails?: Record<string, any>;

    constructor(code: LinkedInErrorCode, message: string, opts: LinkedInErrorOptions = {}) {
        super(message);
        this.name = 'LinkedInIntegrationError';
        this.code = code;
        this.retryable = opts.retryable ?? false;
        this.httpStatus = opts.httpStatus ?? 400;
        this.userAction = opts.userAction ?? 'Please check your connection and try again.';
        this.technicalDetails = opts.technicalDetails ? sanitizeDetails(opts.technicalDetails) : undefined;
        if (opts.cause) (this as any).cause = opts.cause;
    }

    toJSON() {
        return {
            success: false,
            provider: this.provider,
            code: this.code,
            message: this.message,
            retryable: this.retryable,
            userAction: this.userAction,
            technicalDetails: this.technicalDetails,
        };
    }
}

/** Scrub any potential tokens or secrets from diagnostic logs and JSON payloads. */
function sanitizeDetails(details: Record<string, any>): Record<string, any> {
    const sanitized: Record<string, any> = {};
    const forbidden = /token|secret|password|key|authorization|cookie/i;
    for (const [k, v] of Object.entries(details)) {
        if (forbidden.test(k)) {
            sanitized[k] = '[REDACTED]';
        } else if (v && typeof v === 'object' && !Array.isArray(v)) {
            sanitized[k] = sanitizeDetails(v);
        } else {
            sanitized[k] = v;
        }
    }
    return sanitized;
}

export function isLinkedInError(err: unknown): err is LinkedInIntegrationError {
    return err instanceof LinkedInIntegrationError || (Boolean(err) && (err as any).provider === 'linkedin' && typeof (err as any).code === 'string');
}
