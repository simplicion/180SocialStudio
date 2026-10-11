export type PlanStepStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'SKIPPED' | 'WAITING_CONFIRMATION';

export interface OrbitPlanStep {
    id: string;
    resourceKind: string;
    operation: 'create' | 'read' | 'update' | 'delete' | 'custom';
    customActionName?: string;
    summary: string;
    payload: Record<string, any>;
    dependencies?: string[]; // IDs of prerequisite steps in the DAG
    isDestructive?: boolean;
    isConfirmed?: boolean;
    requiredPermission?: string;
    expectedState?: Record<string, any>;
    status: PlanStepStatus;
    result?: any;
    error?: string;
}

export interface OrbitExecutionPlan {
    id: string;
    goal: string;
    targetDomain?: string;
    desiredStateSummary: string;
    steps: OrbitPlanStep[];
    createdAt: string;
    status: 'PLANNED' | 'EXECUTING' | 'COMPLETED' | 'FAILED' | 'NEEDS_CONFIRMATION';
}

export interface ReconciliationResult {
    success: boolean;
    planId?: string;
    executionLog: Array<{ stepId: string; status: PlanStepStatus; result?: any; error?: string }>;
    waitingForUserConfirmation?: boolean;
    confirmationDirective?: string;
    failedStep?: OrbitPlanStep;
    error?: string;
    rollbackLog?: Array<{ stepId: string; status: string; action: string }>;
    updatedWorkspaceState?: string;
}
