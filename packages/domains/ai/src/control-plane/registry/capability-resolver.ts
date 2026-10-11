// @ts-nocheck
import { orbitResourceRegistry } from './resource-registry';
import { OrbitExecutionContext, VerificationResult } from '../types/resource.types';
import { OrbitPolicyEngine } from '../policy/policy-engine';

export interface CapabilityExecutionResult {
    success: boolean;
    data?: any;
    message?: string;
    unauthorized?: boolean;
    requiresConfirmation?: boolean;
    confirmationPrompt?: string;
    directive?: any;
    documentPreview?: any;
    executionTimeMs: number;
}

export class OrbitCapabilityResolver {
    /**
     * Executes a resource capability with full context, zero-trust policy evaluation, and telemetry
     */
    static async execute(
        actionName: string,
        args: any,
        context: OrbitExecutionContext
    ): Promise<CapabilityExecutionResult> {
        const startTime = Date.now();
        const safeArgs = args || {};
        const safeContext = context || {};

        // 1. Normalize action identifier (e.g. 'task.create', 'create_task', 'task_create')
        let kind = '';
        let operation = '';

        if (actionName.includes('.')) {
            const parts = actionName.split('.');
            kind = parts[0];
            operation = parts[1];
        } else if (actionName.includes('_')) {
            const parts = actionName.split('_');
            if (['create', 'get', 'update', 'delete', 'list', 'search'].includes(parts[0])) {
                operation = parts[0] === 'get' || parts[0] === 'list' || parts[0] === 'search' ? 'read' : parts[0];
                kind = parts.slice(1).join('_');
            } else if (['read', 'create', 'update', 'delete'].includes(parts[parts.length - 1])) {
                operation = parts[parts.length - 1];
                kind = parts.slice(0, -1).join('_');
            }
        }

        // 2. Lookup registered resource
        let resource = orbitResourceRegistry.getResource(kind);
        if (!resource) {
            resource = orbitResourceRegistry.getResource(actionName);
        }

        if (!resource) {
            // Check legacy tool fallback
            const { aiToolRegistry } = require('../../tools/ai-tool-registry');
            if (aiToolRegistry && aiToolRegistry.hasTool(actionName)) {
                const legacyResult = await aiToolRegistry.executeTool(actionName, safeArgs, safeContext);
                return {
                    success: legacyResult.success !== false && !legacyResult.error,
                    data: legacyResult,
                    message: legacyResult.message || legacyResult.summary,
                    unauthorized: legacyResult.unauthorized,
                    directive: legacyResult.directive,
                    documentPreview: legacyResult.documentPreview,
                    executionTimeMs: Date.now() - startTime
                };
            }

            return {
                success: false,
                message: `Capability or resource "${actionName}" not found in Orbit Control Plane.`,
                executionTimeMs: Date.now() - startTime
            };
        }

        // 3. Zero-Trust Policy Engine Evaluation
        const policyDecision = await OrbitPolicyEngine.evaluate(
            {
                resourceKind: kind || actionName,
                operation: operation || 'read',
                actionName,
                companyId: safeContext.companyId,
                payload: safeArgs
            },
            safeContext
        );

        if (!policyDecision.allowed) {
            return {
                success: false,
                unauthorized: true,
                message: policyDecision.reason || `🔒 Administrative Action Restricted: You do not have permission for action "${actionName}".`,
                executionTimeMs: Date.now() - startTime
            };
        }

        // 4. Dispatch to capability handler
        try {
            let result: any = null;
            if (operation === 'read' && resource.capabilities.read) {
                result = await resource.capabilities.read(safeArgs, safeContext);
            } else if (operation === 'create' && resource.capabilities.create) {
                result = await resource.capabilities.create(safeArgs, safeContext);
            } else if (operation === 'update' && resource.capabilities.update) {
                result = await resource.capabilities.update(safeArgs.id || safeArgs.taskId || safeArgs.projectId, safeArgs, safeContext);
            } else if (operation === 'delete' && resource.capabilities.delete) {
                result = await resource.capabilities.delete(safeArgs.id || safeArgs.taskId || safeArgs.projectId || safeArgs, safeContext);
            } else if (resource.capabilities.customActions && resource.capabilities.customActions[operation]) {
                result = await resource.capabilities.customActions[operation](safeArgs.id || safeArgs, safeArgs, safeContext);
            } else if (resource.capabilities.create) {
                result = await resource.capabilities.create(safeArgs, safeContext);
            } else if (resource.capabilities.read) {
                result = await resource.capabilities.read(safeArgs, safeContext);
            }

            return {
                success: result?.success !== false && !result?.error,
                data: result,
                message: result?.message || result?.summary || `Action ${actionName} executed successfully.`,
                documentPreview: result?.documentPreview,
                directive: result?.directive,
                executionTimeMs: Date.now() - startTime
            };
        } catch (err: any) {
            console.error(`[OrbitCapabilityResolver] Error executing ${actionName}:`, err);
            return {
                success: false,
                message: `Failed to execute ${actionName}: ${err.message}`,
                executionTimeMs: Date.now() - startTime
            };
        }
    }

    /**
     * Verifies actual state against desired state
     */
    static async verify(
        kind: string,
        id: string,
        desiredState: any,
        context: OrbitExecutionContext
    ): Promise<VerificationResult> {
        const resource = orbitResourceRegistry.getResource(kind);
        if (!resource || !resource.capabilities.verify) {
            return { verified: true };
        }
        return await resource.capabilities.verify(id, desiredState, context);
    }
}
