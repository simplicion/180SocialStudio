import { prisma } from '@workspace/db';

export interface AutomationEvent {
  eventType: string;
  triggeredBy: string;
  targetUser?: string;
  targetClient?: string;
  companyId?: string;
  relatedItem?: { itemId: string; itemModel: string };
  description?: string;
  metadata?: Record<string, unknown>;
  sendEmailNotification?: boolean;
}

/**
 * Trigger an automation event.
 *
 * This is a thin domain-safe facade.  At boot-time the real
 * `AutomationService` (platform-core) registers itself via
 * `registerAutomationProvider`.  If no provider has been registered,
 * the event is logged as a warning but does **not** throw, so
 * domain services remain functional in test / standalone contexts.
 */
let _provider: ((params: AutomationEvent, companyPrisma: any) => Promise<any>) | null = null;

/**
 * Register the real automation provider at app boot-time.
 *
 * Called once from `apps/backend/server.js` (or similar) to wire up
 * the heavy AutomationService without creating a circular dependency
 * from domain packages back to platform-core.
 */
export function registerAutomationProvider(
  provider: (params: AutomationEvent, companyPrisma: any) => Promise<any>
): void {
  _provider = provider;
}

/**
 * Trigger an automation event using the registered provider.
 *
 * @param params   - The automation event payload.
 * @param companyPrisma - The company-scoped Prisma client (multi-tenant).
 *                        Falls back to the global `prisma` if not supplied.
 */
export async function triggerAutomation(
  params: AutomationEvent,
  companyPrisma?: any
): Promise<any> {
  const client = companyPrisma || prisma;

  if (!_provider) {
    console.warn(
      `[Automation] No provider registered. Event "${params.eventType}" was not dispatched. ` +
      'Call registerAutomationProvider() at boot-time.'
    );
    return null;
  }

  try {
    return await _provider(params, client);
  } catch (err: any) {
    console.error(`[Automation] Failed to trigger "${params.eventType}":`, err.message);
    return null;
  }
}
