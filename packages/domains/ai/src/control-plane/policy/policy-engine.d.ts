import { OrbitExecutionContext } from '../types/resource.types';
import { PolicyDecision } from '../types/policy.types';
export declare class OrbitPolicyEngine {
    /**
     * Evaluates a proposed plan step or action against zero-trust tenant, RBAC,
     * and destructive action safety policies before execution.
     */
    static evaluate(action: {
        resourceKind?: string;
        operation?: string;
        actionName?: string;
        companyId?: string;
        isDestructive?: boolean;
        isConfirmed?: boolean;
        requiredPermission?: string;
        summary?: string;
        payload?: any;
    }, context: OrbitExecutionContext): Promise<PolicyDecision>;
}
