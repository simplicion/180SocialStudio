// @ts-nocheck
import { OrbitExecutionPlan, OrbitPlanStep, ReconciliationResult } from '../types/plan.types';
import { OrbitExecutionContext } from '../types/resource.types';
import { OrbitPlanner } from '../planner/orbit-planner';
import { OrbitPolicyEngine } from '../policy/policy-engine';
import { OrbitCapabilityResolver } from '../registry/capability-resolver';
import { OrbitVerifier } from './verifier';

export class OrbitReconciler {
    /**
     * Executes the Kubernetes-style desired state reconciliation loop:
     * 1. Topologically sorts the plan's DAG steps.
     * 2. Evaluates zero-trust policy before every step.
     * 3. Intercepts destructive actions with confirmation gates.
     * 4. Applies mutations, captures results, and feeds output IDs downstream.
     * 5. Verifies database actual state against desired state.
     */
    static async reconcile(
        plan: OrbitExecutionPlan,
        context: OrbitExecutionContext
    ): Promise<ReconciliationResult> {
        const sortedSteps = OrbitPlanner.sortStepsTopologically(plan.steps);
        const executionLog: Array<{ stepId: string; status: any; result?: any; error?: string }> = [];
        const stepResults = new Map<string, any>();

        for (const step of sortedSteps) {
            // 1. Policy & Authorization Evaluation
            const policyDecision = await OrbitPolicyEngine.evaluate(
                {
                    resourceKind: step.resourceKind,
                    operation: step.operation,
                    actionName: `${step.resourceKind}.${step.operation}`,
                    companyId: context.companyId,
                    isDestructive: step.isDestructive,
                    isConfirmed: step.isConfirmed,
                    requiredPermission: step.requiredPermission,
                    summary: step.summary,
                    payload: step.payload
                },
                context
            );

            if (!policyDecision.allowed) {
                step.status = 'FAILED';
                step.error = policyDecision.reason;
                executionLog.push({ stepId: step.id, status: 'FAILED', error: policyDecision.reason });
                return {
                    success: false,
                    planId: plan.id,
                    executionLog,
                    failedStep: step,
                    error: policyDecision.reason
                };
            }

            // 2. Interactive Confirmation Gate
            if (policyDecision.requiresConfirmation && !step.isConfirmed) {
                step.status = 'WAITING_CONFIRMATION';
                executionLog.push({ stepId: step.id, status: 'WAITING_CONFIRMATION' });
                return {
                    success: false,
                    planId: plan.id,
                    executionLog,
                    waitingForUserConfirmation: true,
                    confirmationDirective: policyDecision.confirmationPrompt,
                    failedStep: step
                };
            }

            // 3. Inject Dependent Entity IDs (Cascading Context)
            const resolvedPayload = { ...step.payload };
            if (step.dependencies && step.dependencies.length > 0) {
                for (const depId of step.dependencies) {
                    const depResult = stepResults.get(depId);
                    if (depResult) {
                        if (depResult.id) {
                            if (step.resourceKind === 'task') resolvedPayload.projectId = depResult.id;
                            if (step.resourceKind === 'website') resolvedPayload.formId = depResult.id;
                            if (step.resourceKind === 'document') resolvedPayload.employeeId = depResult.id;
                        }
                    }
                }
            }

            // 4. Execute Capability Step
            step.status = 'RUNNING';
            const actionKey = `${step.resourceKind}.${step.operation}`;
            const execResult = await OrbitCapabilityResolver.execute(actionKey, resolvedPayload, context);

            if (!execResult.success) {
                step.status = 'FAILED';
                step.error = execResult.message;
                executionLog.push({ stepId: step.id, status: 'FAILED', error: execResult.message });

                // Enterprise Saga Compensating Rollback Loop
                const rollbackLog: Array<{ stepId: string; status: string; action: string }> = [];
                const completedSteps = sortedSteps.filter(s => s.status === 'COMPLETED').reverse();
                for (const compStep of completedSteps) {
                    const compResult = stepResults.get(compStep.id);
                    if (compResult && compResult.id) {
                        try {
                            const deleteKey = `${compStep.resourceKind}.delete`;
                            await OrbitCapabilityResolver.execute(deleteKey, { id: compResult.id }, context);
                            rollbackLog.push({ stepId: compStep.id, status: 'ROLLED_BACK', action: deleteKey });
                        } catch (rbErr) {
                            rollbackLog.push({ stepId: compStep.id, status: 'ROLLBACK_FAILED', action: `${compStep.resourceKind}.delete` });
                        }
                    }
                }

                return {
                    success: false,
                    planId: plan.id,
                    executionLog,
                    rollbackLog: rollbackLog.length > 0 ? rollbackLog : undefined,
                    failedStep: step,
                    error: execResult.message
                };
            }

            // Store result for downstream dependencies
            step.status = 'COMPLETED';
            step.result = execResult.data;
            stepResults.set(step.id, execResult.data);

            // 5. Post-Execution State Verification
            if (execResult.data?.id) {
                const verification = await OrbitVerifier.verifyResource(
                    step.resourceKind,
                    execResult.data.id,
                    step.expectedState || {},
                    context
                );

                if (!verification.verified && verification.retrySuggested) {
                    // Attempt quick self-healing retry
                    const retryResult = await OrbitCapabilityResolver.execute(actionKey, resolvedPayload, context);
                    if (retryResult.success) {
                        step.result = retryResult.data;
                        stepResults.set(step.id, retryResult.data);
                    }
                }
            }

            executionLog.push({ stepId: step.id, status: 'COMPLETED', result: execResult.data });
        }

        return {
            success: true,
            planId: plan.id,
            executionLog,
            updatedWorkspaceState: plan.desiredStateSummary
        };
    }
}
