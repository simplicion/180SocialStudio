"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAutomationProvider = registerAutomationProvider;
exports.triggerAutomation = triggerAutomation;
const db_1 = require("@workspace/db");
/**
 * Trigger an automation event.
 *
 * This is a thin domain-safe facade.  At boot-time the real
 * `AutomationService` (platform-core) registers itself via
 * `registerAutomationProvider`.  If no provider has been registered,
 * the event is logged as a warning but does **not** throw, so
 * domain services remain functional in test / standalone contexts.
 */
let _provider = null;
/**
 * Register the real automation provider at app boot-time.
 *
 * Called once from `apps/backend/server.js` (or similar) to wire up
 * the heavy AutomationService without creating a circular dependency
 * from domain packages back to platform-core.
 */
function registerAutomationProvider(provider) {
    _provider = provider;
}
/**
 * Trigger an automation event using the registered provider.
 *
 * @param params   - The automation event payload.
 * @param companyPrisma - The company-scoped Prisma client (multi-tenant).
 *                        Falls back to the global `prisma` if not supplied.
 */
async function triggerAutomation(params, companyPrisma) {
    const client = companyPrisma || db_1.prisma;
    if (!_provider) {
        console.warn(`[Automation] No provider registered. Event "${params.eventType}" was not dispatched. ` +
            'Call registerAutomationProvider() at boot-time.');
        return null;
    }
    try {
        return await _provider(params, client);
    }
    catch (err) {
        console.error(`[Automation] Failed to trigger "${params.eventType}":`, err.message);
        return null;
    }
}
