import { getDb } from '../publishing/http';
import { AgentMemoryService } from '../agent-os/agent-memory';
import { requireCompanyId, SocialDomainError } from '../tenant-scope';

export class DirectorSubagent {
    /**
     * Retrieves current editing rules and director preferences for the project.
     */
    static async getDirectorPreferences(companyId: string, projectId: string) {
        requireCompanyId(companyId);
        const memories = await (getDb() as any).agentMemory.findMany({
            where: { companyId, projectId, kind: 'preference' },
            orderBy: { updatedAt: 'desc' },
        });
        return {
            projectId,
            activeRulesCount: memories.length,
            preferences: memories.map((m: any) => ({ key: m.key, rule: m.text, updatedAt: m.updatedAt })),
        };
    }

    /**
     * Stores the editing preferences found in an instruction from the user / 180 Manager. Uses the shared agent
     * memory (one row per preference key, project ownership checked). An instruction with no recognised
     * preference is rejected instead of being reported as applied.
     */
    static async applyEditingRule(companyId: string, projectId: string, ruleInstruction: string, memory = new AgentMemoryService(getDb())) {
        requireCompanyId(companyId);
        if (!projectId) throw new SocialDomainError('VALIDATION_FAILED', 400, 'projectId is required to change editing rules.');
        const applied = await memory.rememberPreferencesFrom(projectId, companyId, String(ruleInstruction || ''), 'director');
        if (!applied.length) {
            throw new SocialDomainError(
                'RULE_NOT_RECOGNISED',
                422,
                'No editing preference was recognised. Try e.g. "less zoom", "smaller captions" or "faster cuts".',
            );
        }
        return { success: true, rulesApplied: applied.map((p) => p.text), count: applied.length };
    }
}
