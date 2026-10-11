import { OrbitExecutionContext, VerificationResult } from '../types/resource.types';
export declare class OrbitVerifier {
    /**
     * Verifies that the actual database state matches the expected state
     * after a capability mutation.
     */
    static verifyResource(kind: string, id: string, expectedState: Record<string, any>, context: OrbitExecutionContext): Promise<VerificationResult>;
}
