// @ts-nocheck
import { OrbitExecutionContext } from '../types/resource.types';
import { PolicyDecision, RiskLevel } from '../types/policy.types';

export class OrbitPolicyEngine {
    /**
     * Evaluates a proposed plan step or action against zero-trust tenant, RBAC,
     * and destructive action safety policies before execution.
     */
    static async evaluate(
        action: {
            resourceKind?: string;
            operation?: string;
            actionName?: string;
            companyId?: string;
            isDestructive?: boolean;
            isConfirmed?: boolean;
            requiredPermission?: string;
            summary?: string;
            payload?: any;
        },
        context: OrbitExecutionContext
    ): Promise<PolicyDecision> {
        // 1. Strict Multi-Tenant Isolation
        if (!context.companyId) {
            return {
                allowed: false,
                requiresConfirmation: false,
                riskLevel: 'CRITICAL',
                reason: 'Authentication Error: Execution context missing valid companyId.'
            };
        }

        if (action.companyId && action.companyId !== context.companyId) {
            return {
                allowed: false,
                requiresConfirmation: false,
                riskLevel: 'CRITICAL',
                reason: 'Security Violation: Attempted cross-tenant mutation on foreign companyId.'
            };
        }

        const userRole = (context.userRole || 'employee').toLowerCase();
        const userPermissions = Array.isArray(context.userPermissions) ? context.userPermissions : [];
        const op = (action.operation || '').toLowerCase();
        const actName = (action.actionName || '').toLowerCase();
        const isAdmin = ['admin', 'superadmin', 'owner'].includes(userRole);

        // 2. Role & Clearance Validation (Run BEFORE confirmation gates)
        if (!isAdmin) {
            // Block sensitive administrative operations for standard employees
            if (
                actName.includes('terminate') ||
                actName.startsWith('delete_') ||
                op === 'delete' ||
                ['get_payroll', 'get_payroll_and_salary_summary'].includes(actName)
            ) {
                return {
                    allowed: false,
                    requiresConfirmation: false,
                    riskLevel: 'HIGH',
                    reason: 'Administrative Access Required: This operation requires workspace administrator clearance.',
                    requiredClearance: ['admin']
                };
            }

            if (action.requiredPermission) {
                const hasPermission = userPermissions.includes(action.requiredPermission) ||
                                      userPermissions.includes(`${action.requiredPermission.split(':')[0]}:all`);
                if (!hasPermission) {
                    return {
                        allowed: false,
                        requiresConfirmation: false,
                        riskLevel: 'HIGH',
                        reason: `Access Denied: Missing required permission pack [${action.requiredPermission}].`,
                        requiredClearance: [action.requiredPermission]
                    };
                }
            }
        }

        // 3. Destructive Action Interception Gate (For authorized users)
        const isDestructive = (
            action.isDestructive ||
            op === 'delete' ||
            actName.startsWith('delete_') ||
            actName.includes('terminate') ||
            actName.includes('bulk_delete') ||
            actName.includes('drop')
        );

        if (isDestructive && !action.isConfirmed) {
            const resourceLabel = action.resourceKind || 'item';
            return {
                allowed: true,
                requiresConfirmation: true,
                riskLevel: 'HIGH',
                reason: 'Destructive action requires explicit user confirmation.',
                confirmationPrompt: `⚠️ **Confirmation Required:** Are you sure you want to permanently delete or terminate this **${resourceLabel}**? This action cannot be undone.`
            };
        }

        return {
            allowed: true,
            requiresConfirmation: false,
            riskLevel: 'LOW'
        };
    }
}
