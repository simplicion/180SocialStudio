/**
 * Typed errors for the WS4 publishing pipeline. Every error carries a stable `code` the routes map to an HTTP
 * status and the clients (mobile / web) can switch on. None of them ever carries a token.
 */
export type PublishErrorCode =
    | 'PUBLISH_NOT_CONFIGURED'
    | 'TOKEN_VAULT_NOT_CONFIGURED'
    | 'OAUTH_STATE_INVALID'
    | 'OAUTH_REDIRECT_NOT_ALLOWED'
    | 'OAUTH_PROVIDER_ERROR'
    | 'REAUTH_REQUIRED'
    | 'VALIDATION_FAILED'
    | 'ACCOUNT_NOT_CONNECTED'
    | 'APPROVAL_REQUIRED'
    | 'PUBLISH_IN_PROGRESS'
    | 'PROVIDER_ERROR'
    | 'PROVIDER_TIMEOUT'
    | 'OUTCOME_UNKNOWN'
    | 'UNSUPPORTED_PLATFORM'
    | 'NOT_FOUND';

const HTTP_STATUS: Record<PublishErrorCode, number> = {
    PUBLISH_NOT_CONFIGURED: 503,
    TOKEN_VAULT_NOT_CONFIGURED: 503,
    OAUTH_STATE_INVALID: 400,
    OAUTH_REDIRECT_NOT_ALLOWED: 400,
    OAUTH_PROVIDER_ERROR: 502,
    REAUTH_REQUIRED: 409,
    VALIDATION_FAILED: 422,
    ACCOUNT_NOT_CONNECTED: 409,
    APPROVAL_REQUIRED: 409,
    PUBLISH_IN_PROGRESS: 409,
    PROVIDER_ERROR: 502,
    PROVIDER_TIMEOUT: 504,
    OUTCOME_UNKNOWN: 409,
    UNSUPPORTED_PLATFORM: 400,
    NOT_FOUND: 404,
};

export class PublishError extends Error {
    readonly code: PublishErrorCode;
    readonly retryable: boolean;
    readonly platform?: string;
    readonly details?: Record<string, any>;

    constructor(code: PublishErrorCode, message: string, opts: { retryable?: boolean; platform?: string; details?: Record<string, any> } = {}) {
        super(message);
        this.name = 'PublishError';
        this.code = code;
        this.retryable = opts.retryable ?? false;
        this.platform = opts.platform;
        this.details = opts.details;
    }

    get httpStatus(): number {
        return HTTP_STATUS[this.code] ?? 500;
    }

    toJSON() {
        return { code: this.code, message: this.message, platform: this.platform, retryable: this.retryable, ...(this.details ? { details: this.details } : {}) };
    }
}

export const isPublishError = (e: unknown): e is PublishError => e instanceof PublishError;

/** Wrap any thrown value into a PublishError (network failures are retryable provider errors). */
export function toPublishError(e: unknown, platform?: string): PublishError {
    if (e instanceof PublishError) return e;
    const msg = (e as any)?.message || String(e);
    if ((e as any)?.name === 'AbortError' || /timed? ?out/i.test(msg)) {
        return new PublishError('PROVIDER_TIMEOUT', msg, { retryable: true, platform });
    }
    return new PublishError('PROVIDER_ERROR', msg, { retryable: true, platform });
}
