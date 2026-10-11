export interface AuditContext {
    /** IP address of the request (optional) */
    ipAddress?: string;
    /** User-Agent header (optional) */
    userAgent?: string;
    /** Company ID for multi-tenant scoping */
    companyId?: string | null;
}
/**
 * Log an action to the AuditLog table.
 *
 * This is the canonical, domain-safe way to record audit events.
 * It never throws — audit logging must never break the main flow.
 */
export declare function logAction(userId: string, action: string, resourceType?: string, resourceId?: string, details?: Record<string, unknown>, context?: AuditContext): Promise<void>;
