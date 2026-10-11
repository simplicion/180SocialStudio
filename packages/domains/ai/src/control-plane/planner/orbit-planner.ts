// @ts-nocheck
import { OrbitExecutionPlan, OrbitPlanStep } from '../types/plan.types';
import { OrbitExecutionContext } from '../types/resource.types';
import { OrbitContextEngine } from '../context/context-engine';

export class OrbitPlanner {
    /**
     * Compiles a high-level user goal or command into a declarative Desired State manifest
     * and a Directed Acyclic Graph (DAG) of execution steps.
     */
    static async plan(
        goal: string,
        context: OrbitExecutionContext
    ): Promise<OrbitExecutionPlan> {
        const planId = `plan_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const lowerGoal = (goal || '').toLowerCase().trim();
        const steps: OrbitPlanStep[] = [];

        // 1. Multi-Step Campaign Pattern (Form -> Website -> Tasks)
        if (lowerGoal.includes('campaign') || lowerGoal.includes('launch') || (lowerGoal.includes('website') && lowerGoal.includes('form'))) {
            const formStepId = `step_1_form`;
            const webStepId = `step_2_website`;
            const taskStepId = `step_3_tasks`;

            steps.push({
                id: formStepId,
                resourceKind: 'form',
                operation: 'create',
                summary: 'Create lead intake capture form',
                payload: { title: `${goal.slice(0, 30)} - Lead Intake`, prompt: 'Create lead capture form with name, email, company, phone' },
                status: 'PENDING'
            });

            steps.push({
                id: webStepId,
                resourceKind: 'website',
                operation: 'create',
                summary: 'Compile marketing landing page connected to intake form',
                payload: { name: `${goal.slice(0, 30)} - Landing Page`, prompt: `Build landing page for ${goal}` },
                dependencies: [formStepId],
                status: 'PENDING'
            });

            steps.push({
                id: taskStepId,
                resourceKind: 'task',
                operation: 'create',
                summary: 'Create campaign launch review task',
                payload: { title: `Review and publish campaign: ${goal.slice(0, 40)}`, priority: 'high' },
                dependencies: [webStepId],
                status: 'PENDING'
            });

            return {
                id: planId,
                goal,
                targetDomain: 'advertising',
                desiredStateSummary: 'Form created, website generated, and launch task scheduled.',
                steps,
                createdAt: new Date().toISOString(),
                status: 'PLANNED'
            };
        }

        // 2. Sprint Planning Pattern (Project -> Multiple Tasks)
        if (lowerGoal.includes('sprint') || (lowerGoal.includes('project') && lowerGoal.includes('tasks'))) {
            const projStepId = `step_1_project`;
            steps.push({
                id: projStepId,
                resourceKind: 'project',
                operation: 'create',
                summary: `Initialize Project: ${goal.slice(0, 30)}`,
                payload: { name: goal.slice(0, 40), priority: 'high' },
                status: 'PENDING'
            });

            steps.push({
                id: `step_2_task_1`,
                resourceKind: 'task',
                operation: 'create',
                summary: 'Sprint Architecture & Scope Definition',
                payload: { title: 'Architecture & Scope Definition', priority: 'high' },
                dependencies: [projStepId],
                status: 'PENDING'
            });

            steps.push({
                id: `step_3_task_2`,
                resourceKind: 'task',
                operation: 'create',
                summary: 'Sprint Implementation & QA',
                payload: { title: 'Sprint Implementation & QA', priority: 'medium' },
                dependencies: [projStepId],
                status: 'PENDING'
            });

            return {
                id: planId,
                goal,
                targetDomain: 'projects-and-tasks',
                desiredStateSummary: 'Project container created with sprint deliverable tasks.',
                steps,
                createdAt: new Date().toISOString(),
                status: 'PLANNED'
            };
        }

        // 3. Employee Onboarding Pattern (Hire -> Offer Letter Document -> Setup Task)
        if (lowerGoal.includes('onboard') || lowerGoal.includes('hire')) {
            const empStepId = `step_1_emp`;
            const docStepId = `step_2_doc`;
            const taskStepId = `step_3_task`;

            steps.push({
                id: empStepId,
                resourceKind: 'employee',
                operation: 'create',
                summary: `Onboard employee profile: ${goal.slice(0, 30)}`,
                payload: { name: goal.replace(/^(onboard|hire)\s+/i, '').slice(0, 30) || 'New Employee', role: 'Team Member' },
                status: 'PENDING'
            });

            steps.push({
                id: docStepId,
                resourceKind: 'document',
                operation: 'create',
                summary: 'Generate employment contract & offer letter',
                payload: { title: 'Employment Agreement', documentType: 'OFFER_LETTER', prompt: `Employment offer letter for ${goal}` },
                dependencies: [empStepId],
                status: 'PENDING'
            });

            steps.push({
                id: taskStepId,
                resourceKind: 'task',
                operation: 'create',
                summary: 'Setup workstation and credentials',
                payload: { title: 'IT Setup: Workstation & Credentials', priority: 'high' },
                dependencies: [empStepId],
                status: 'PENDING'
            });

            return {
                id: planId,
                goal,
                targetDomain: 'hr-management',
                desiredStateSummary: 'Employee onboarded, contract drafted in 180 Documents, and IT setup task created.',
                steps,
                createdAt: new Date().toISOString(),
                status: 'PLANNED'
            };
        }

        // 4. Default Single-Step Intent Plan
        const intent = OrbitContextEngine.classifyIntent(goal);
        let resourceKind = 'task';
        if (intent.targetDomains.includes('crm-and-sales')) resourceKind = 'lead';
        else if (intent.targetDomains.includes('finance')) resourceKind = 'invoice';
        else if (intent.targetDomains.includes('workspace-tools') && lowerGoal.includes('doc')) resourceKind = 'document';
        else if (intent.targetDomains.includes('workspace-tools') && lowerGoal.includes('form')) resourceKind = 'form';
        else if (intent.targetDomains.includes('advertising')) resourceKind = 'website';

        steps.push({
            id: `step_1_action`,
            resourceKind,
            operation: intent.actionType === 'query' ? 'read' : 'create',
            summary: goal,
            payload: { prompt: goal, title: goal.slice(0, 50) },
            status: 'PENDING'
        });

        return {
            id: planId,
            goal,
            targetDomain: intent.primaryDomain,
            desiredStateSummary: `Execute ${goal}`,
            steps,
            createdAt: new Date().toISOString(),
            status: 'PLANNED'
        };
    }

    /**
     * Topologically sorts DAG steps ensuring dependencies run before dependents
     */
    static sortStepsTopologically(steps: OrbitPlanStep[]): OrbitPlanStep[] {
        const sorted: OrbitPlanStep[] = [];
        const visited = new Set<string>();
        const temp = new Set<string>();
        const stepMap = new Map<string, OrbitPlanStep>();

        steps.forEach(s => stepMap.set(s.id, s));

        function visit(step: OrbitPlanStep) {
            if (temp.has(step.id)) {
                // Cycle detected: resolve gracefully by ignoring dependency cycle
                return;
            }
            if (!visited.has(step.id)) {
                temp.add(step.id);
                if (step.dependencies) {
                    for (const depId of step.dependencies) {
                        const depStep = stepMap.get(depId);
                        if (depStep) visit(depStep);
                    }
                }
                temp.delete(step.id);
                visited.add(step.id);
                sorted.push(step);
            }
        }

        for (const step of steps) {
            if (!visited.has(step.id)) {
                visit(step);
            }
        }

        return sorted;
    }
}
