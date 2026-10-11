"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logAction = logAction;
const db_1 = require("@workspace/db");
/**
 * Log an action to the AuditLog table.
 *
 * This is the canonical, domain-safe way to record audit events.
 * It never throws — audit logging must never break the main flow.
 */
async function logAction(userId, action, resourceType = '', resourceId = '', details = {}, context = {}) {
    try {
        await db_1.prisma.auditLog.create({
            data: {
                userId,
                action,
                resourceType,
                resourceId: resourceId ? String(resourceId) : '',
                details: (details || {}),
                ipAddress: context.ipAddress || '',
                userAgent: context.userAgent || '',
                companyId: context.companyId ?? null,
            },
        });
    }
    catch (err) {
        // Never throw — audit logging should never break the main flow
        console.error('[Audit] Failed to log action:', err.message);
    }
}
