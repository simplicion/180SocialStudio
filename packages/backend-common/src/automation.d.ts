export interface AutomationEvent {
    eventType: string;
    triggeredBy: string;
    targetUser?: string;
    targetClient?: string;
    relatedItem?: {
        itemId: string;
        itemModel: string;
    };
    description?: string;
    metadata?: Record<string, unknown>;
    sendEmailNotification?: boolean;
}
/**
 * Register the real automation provider at app boot-time.
 *
 * Called once from `apps/backend/server.js` (or similar) to wire up
 * the heavy AutomationService without creating a circular dependency
 * from domain packages back to platform-core.
 */
export declare function registerAutomationProvider(provider: (params: AutomationEvent, companyPrisma: any) => Promise<any>): void;
/**
 * Trigger an automation event using the registered provider.
 *
 * @param params   - The automation event payload.
 * @param companyPrisma - The company-scoped Prisma client (multi-tenant).
 *                        Falls back to the global `prisma` if not supplied.
 */
export declare function triggerAutomation(params: AutomationEvent, companyPrisma?: any): Promise<any>;
