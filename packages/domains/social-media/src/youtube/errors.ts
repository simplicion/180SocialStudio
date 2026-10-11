/**
 * Standardized YouTube Error Handling & Secret Scrubbing.
 * Ensures access tokens, refresh tokens, and client secrets are never leaked.
 */

export type YouTubeErrorCode =
    | 'YOUTUBE_NOT_CONFIGURED'
    | 'YOUTUBE_NOT_CONNECTED'
    | 'YOUTUBE_OAUTH_FAILED'
    | 'YOUTUBE_TOKEN_EXPIRED'
    | 'YOUTUBE_TOKEN_REFRESH_FAILED'
    | 'YOUTUBE_PERMISSION_DENIED'
    | 'YOUTUBE_QUOTA_EXCEEDED'
    | 'YOUTUBE_UPLOAD_FAILED'
    | 'YOUTUBE_VIDEO_PROCESSING_FAILED'
    | 'YOUTUBE_INVALID_METADATA'
    | 'YOUTUBE_RATE_LIMITED'
    | 'YOUTUBE_API_UNAVAILABLE';

export class YouTubeIntegrationError extends Error {
    readonly code: YouTubeErrorCode;
    readonly httpStatus: number;
    readonly retryable: boolean;
    readonly userAction?: string;
    readonly technicalDetails?: any;

    constructor(
        codeOrParams:
            | YouTubeErrorCode
            | {
                  code: YouTubeErrorCode;
                  message: string;
                  httpStatus?: number;
                  retryable?: boolean;
                  userAction?: string;
                  technicalDetails?: any;
              },
        message?: string,
        options?: {
            httpStatus?: number;
            retryable?: boolean;
            userAction?: string;
            technicalDetails?: any;
        }
    ) {
        let code: YouTubeErrorCode;
        let msg: string;
        let httpStatus: number;
        let retryable: boolean;
        let userAction: string | undefined;
        let technicalDetails: any;

        if (typeof codeOrParams === 'object') {
            code = codeOrParams.code;
            msg = codeOrParams.message;
            httpStatus = codeOrParams.httpStatus || 500;
            retryable = codeOrParams.retryable ?? false;
            userAction = codeOrParams.userAction;
            technicalDetails = codeOrParams.technicalDetails;
        } else {
            code = codeOrParams;
            msg = message || code;
            httpStatus = options?.httpStatus || 500;
            retryable = options?.retryable ?? false;
            userAction = options?.userAction;
            technicalDetails = options?.technicalDetails;
        }

        const sanitizedMessage = scrubSecrets(msg);
        super(sanitizedMessage);
        this.name = 'YouTubeIntegrationError';
        this.code = code;
        this.httpStatus = httpStatus;
        this.retryable = retryable;
        this.userAction = userAction;
        this.technicalDetails = technicalDetails
            ? sanitizeTechnicalDetails(technicalDetails)
            : undefined;
    }
}

export const YouTubeError = YouTubeIntegrationError;

/**
 * Removes access tokens, refresh tokens, client secrets, and auth codes from any string.
 */
export function scrubSecrets(input: string): string {
    if (!input) return '';
    return input
        .replace(/ya29\.[a-zA-Z0-9_\-]+/g, '[REDACTED_SECRET]')
        .replace(/1\/\/[a-zA-Z0-9_\-]+/g, '[REDACTED_SECRET]')
        .replace(/GOCSPX-[a-zA-Z0-9_\-]+/gi, '[REDACTED_SECRET]')
        .replace(/(client_secret[=:]\s*)[^&\s",]+/gi, '$1[REDACTED_SECRET]')
        .replace(/(Bearer\s+)[a-zA-Z0-9_\.\-]+/gi, '$1[REDACTED_SECRET]')
        .replace(/(code=)[^&\s]+/gi, '$1[REDACTED_SECRET]');
}

/**
 * Deeply sanitizes any error object details.
 */
function sanitizeTechnicalDetails(details: any): any {
    if (typeof details === 'string') {
        return scrubSecrets(details);
    }
    if (Array.isArray(details)) {
        return details.map(sanitizeTechnicalDetails);
    }
    if (typeof details === 'object' && details !== null) {
        const clean: Record<string, any> = {};
        for (const [k, v] of Object.entries(details)) {
            if (/token|secret|password|key|authorization/i.test(k)) {
                clean[k] = '[REDACTED_SECRET]';
            } else if (typeof v === 'string') {
                clean[k] = scrubSecrets(v);
            } else if (typeof v === 'object' && v !== null) {
                clean[k] = sanitizeTechnicalDetails(v);
            } else {
                clean[k] = v;
            }
        }
        return clean;
    }
    return details;
}
