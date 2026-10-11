'use strict';

/**
 * SecurityIsolationGuard
 * Multi-tenant authorization verifier, publishing idempotency key manager,
 * and sensitive credential redactor.
 */

export class SecurityIsolationGuard {
    // In-memory idempotency cache (keyed by idempotencyKey, values: expiration timestamps)
    private static idempotencyStore = new Map<string, number>();

    /**
     * Verifies that the entity belongs strictly to the authenticated tenant company
     */
    static verifyTenantOwnership(
        entityName: string,
        entity: { companyId?: string | null } | null,
        authenticatedCompanyId: string
    ): boolean {
        if (!entity) return false;
        if (!entity.companyId) return false;
        if (entity.companyId !== authenticatedCompanyId) {
            console.error(
                `[Security Warning] Cross-Tenant Access Violation attempt on ${entityName}. Authenticated Company: ${authenticatedCompanyId}, Target Entity Company: ${entity.companyId}`
            );
            return false;
        }
        return true;
    }

    /**
     * Checks if a publishing dispatch request is idempotent (prevents duplicate dispatches)
     * Returns true if request is allowed, false if duplicate within window.
     */
    static checkAndAcquireIdempotency(
        idempotencyKey: string,
        ttlSeconds: number = 60
    ): { allowed: boolean; message?: string } {
        const now = Date.now();
        const existingExpires = this.idempotencyStore.get(idempotencyKey);

        if (existingExpires && existingExpires > now) {
            return {
                allowed: false,
                message: 'Duplicate publishing operation blocked: an identical dispatch is already in progress or completed recently.',
            };
        }

        // Set expiration
        this.idempotencyStore.set(idempotencyKey, now + ttlSeconds * 1000);

        // Periodic cleanup
        if (this.idempotencyStore.size > 1000) {
            for (const [k, exp] of this.idempotencyStore.entries()) {
                if (exp <= now) this.idempotencyStore.delete(k);
            }
        }

        return { allowed: true };
    }

    /**
     * Redacts access tokens, client secrets, and sensitive tokens from objects before serialization
     */
    static redactSensitiveData<T extends Record<string, any>>(obj: T): T {
        if (!obj || typeof obj !== 'object') return obj;

        const clone = Array.isArray(obj) ? ([...obj] as any) : { ...obj };
        const sensitiveKeys = [
            'accessToken',
            'refreshToken',
            'clientSecret',
            'appSecret',
            'apiKey',
            'secret',
            'token',
            'password',
            'oauthSecret',
        ];

        for (const key of Object.keys(clone)) {
            if (sensitiveKeys.some(s => key.toLowerCase().includes(s.toLowerCase()))) {
                clone[key] = '***REDACTED***';
            } else if (typeof clone[key] === 'object' && clone[key] !== null) {
                clone[key] = this.redactSensitiveData(clone[key]);
            }
        }

        return clone;
    }
}
