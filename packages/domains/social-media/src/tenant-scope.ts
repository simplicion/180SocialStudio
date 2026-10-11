/**
 * Tenant-scoping helpers shared by the social-media services.
 *
 * The Prisma tenant extension (packages/db/src/index.ts) only injects `companyId` into findFirst / findMany /
 * updateMany / deleteMany / count / aggregate / groupBy. `findUnique`, `update` and `delete` by id are NOT scoped,
 * so services must look records up with `findFirst({ where: { id, companyId } })` and write with
 * `updateMany` / `deleteMany` carrying the same scope, and answer 404 when nothing matches.
 */

/** Typed error with an HTTP status; routes map `statusCode` / `code` straight to the response. */
export class SocialDomainError extends Error {
    readonly code: string;
    readonly statusCode: number;
    readonly details?: Record<string, any>;

    constructor(code: string, statusCode: number, message: string, details?: Record<string, any>) {
        super(message);
        this.name = 'SocialDomainError';
        this.code = code;
        this.statusCode = statusCode;
        this.details = details;
    }
}

export const notFound = (what: string) => new SocialDomainError('NOT_FOUND', 404, `${what} not found`);

export const isSocialDomainError = (e: unknown): e is SocialDomainError => e instanceof SocialDomainError;

/** Throws 401 when no tenant is known. Never fall back to "any company". */
export function requireCompanyId(companyId: string | undefined | null): string {
    if (!companyId) throw new SocialDomainError('UNAUTHENTICATED', 401, 'Company context required');
    return String(companyId);
}

/** Account fields safe to embed in any response (never the legacy plaintext token columns or the vault). */
export const SAFE_ACCOUNT_SELECT = { id: true, platform: true, accountName: true, username: true, profileImageUrl: true, reauthRequired: true, isActive: true } as const;

/**
 * Server-side account reference for the token vault (id/companyId/platform/reauth) and provider calls
 * (platformAccountId). Still no token columns: tokens come only from `SocialTokenVault.getAccessToken`.
 */
export const VAULT_ACCOUNT_SELECT = { ...SAFE_ACCOUNT_SELECT, companyId: true, platformAccountId: true } as const;

/**
 * Calendar pieces carry a nullable `companyId` (older rows only have it on the parent calendar). A piece belongs to
 * the caller when either its own companyId or, for legacy rows, its calendar's companyId matches.
 */
export const pieceScope = (id: string, companyId: string) => ({ id, OR: [{ companyId }, { companyId: null, calendar: { companyId } }] });
