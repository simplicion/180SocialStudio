import { OrbitExecutionContext, VerificationResult } from '../types/resource.types';
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
export declare class OrbitCapabilityResolver {
    /**
     * Executes a resource capability with full context, zero-trust policy evaluation, and telemetry
     */
    static execute(actionName: string, args: any, context: OrbitExecutionContext): Promise<CapabilityExecutionResult>;
    /**
     * Verifies actual state against desired state
     */
    static verify(kind: string, id: string, desiredState: any, context: OrbitExecutionContext): Promise<VerificationResult>;
}
