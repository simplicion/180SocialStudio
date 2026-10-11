export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface PolicyDecision {
    allowed: boolean;
    requiresConfirmation: boolean;
    riskLevel: RiskLevel;
    reason?: string;
    confirmationPrompt?: string;
    blockedOperation?: string;
    requiredClearance?: string[];
}
