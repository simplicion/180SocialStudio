import { Request, Response } from 'express';
import { isPublishError } from '@workspace/social-media';

/**
 * Error responses for the social-media routes. Typed errors keep their status and code (PublishError,
 * SocialDomainError and other `{ code, statusCode }` errors with a 4xx/503 status); anything else is logged
 * server-side and answered with a generic 500 so Prisma / provider internals never reach the client.
 */
export function sendRouteError(res: Response, error: any, scope: string) {
    if (isPublishError(error)) {
        return res.status(error.httpStatus).json({ success: false, code: error.code, error: error.message, platform: error.platform, details: error.details });
    }
    const status = Number(error?.statusCode);
    if (error?.code && Number.isInteger(status) && status >= 400 && status < 600 && status !== 500) {
        return res.status(status).json({ success: false, code: error.code, error: error.message, ...(error.details ? { details: error.details } : {}) });
    }
    console.error(`[social-media:${scope}] unexpected error`, error);
    return res.status(500).json({ success: false, code: 'INTERNAL', error: 'Unexpected error' });
}

/** The caller's company from the verified JWT only (never a header, body or query value). */
export const companyOfUser = (req: Request): string | undefined => (req as any).user?.companyId || undefined;
