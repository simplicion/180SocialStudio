/**
 * Typed errors for the creative engine (image agent, carousel design agent, carousel compiler, jobs).
 * Routes map `status` + `code` straight to the HTTP response, so clients can branch on `code`.
 */
export type CreativeErrorCode =
    | 'COMPANY_REQUIRED'
    | 'PROJECT_NOT_FOUND'
    | 'PIECE_NOT_FOUND'
    | 'POST_NOT_FOUND'
    | 'JOB_NOT_FOUND'
    | 'INVALID_INPUT'
    | 'AI_NOT_CONFIGURED'
    | 'AI_PROVIDER_ERROR'
    | 'AI_BAD_RESPONSE'
    | 'IMAGE_MODEL_NOT_CONFIGURED'
    | 'IMAGE_PROVIDER_ERROR'
    | 'STORAGE_UNAVAILABLE'
    | 'JOB_BUSY'
    | 'RENDER_FAILED';

export class CreativeError extends Error {
    constructor(public status: number, public code: CreativeErrorCode, message: string, public details?: any) {
        super(message);
        this.name = 'CreativeError';
    }
}

export const isCreativeError = (e: unknown): e is CreativeError => e instanceof CreativeError;
