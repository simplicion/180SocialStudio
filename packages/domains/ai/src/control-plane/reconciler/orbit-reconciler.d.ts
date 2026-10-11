import { OrbitExecutionPlan, ReconciliationResult } from '../types/plan.types';
import { OrbitExecutionContext } from '../types/resource.types';
export declare class OrbitReconciler {
    /**
     * Executes the Kubernetes-style desired state reconciliation loop:
     * 1. Topologically sorts the plan's DAG steps.
     * 2. Evaluates zero-trust policy before every step.
     * 3. Intercepts destructive actions with confirmation gates.
     * 4. Applies mutations, captures results, and feeds output IDs downstream.
     * 5. Verifies database actual state against desired state.
     */
    static reconcile(plan: OrbitExecutionPlan, context: OrbitExecutionContext): Promise<ReconciliationResult>;
}
