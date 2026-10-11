import { OrbitExecutionPlan, OrbitPlanStep } from '../types/plan.types';
import { OrbitExecutionContext } from '../types/resource.types';
export declare class OrbitPlanner {
    /**
     * Compiles a high-level user goal or command into a declarative Desired State manifest
     * and a Directed Acyclic Graph (DAG) of execution steps.
     */
    static plan(goal: string, context: OrbitExecutionContext): Promise<OrbitExecutionPlan>;
    /**
     * Topologically sorts DAG steps ensuring dependencies run before dependents
     */
    static sortStepsTopologically(steps: OrbitPlanStep[]): OrbitPlanStep[];
}
