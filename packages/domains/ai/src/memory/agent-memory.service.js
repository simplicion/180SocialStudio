"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentMemoryService = void 0;
const db_1 = require("@workspace/db");
class AgentMemoryService {
    /**
     * Records a new memory. If a key is provided and kind is 'preference', it overwrites the existing entry for that key.
     */
    static async recordMemory(dto) {
        if (dto.key && dto.kind === 'preference') {
            const existing = await db_1.prisma.agentMemory.findFirst({
                where: { companyId: dto.companyId, projectId: dto.projectId, key: dto.key, kind: dto.kind }
            });
            if (existing) {
                return db_1.prisma.agentMemory.update({
                    where: { id: existing.id },
                    data: {
                        text: dto.text,
                        payload: dto.payload ?? {},
                        weight: dto.weight ?? 1,
                    }
                });
            }
        }
        return db_1.prisma.agentMemory.create({
            data: {
                companyId: dto.companyId,
                projectId: dto.projectId,
                kind: dto.kind,
                scope: dto.scope ?? 'all',
                key: dto.key,
                text: dto.text,
                payload: dto.payload ?? {},
                weight: dto.weight ?? 1,
            }
        });
    }
    /**
     * Retrieves memories compacted as a string context for an agent prompt.
     */
    static async getMemoryContext(companyId, projectId, scope) {
        const memories = await db_1.prisma.agentMemory.findMany({
            where: {
                companyId,
                projectId,
                scope: { in: ['all', scope] }
            },
            orderBy: { createdAt: 'desc' },
            take: 50 // Limit to top 50 recent/relevant memories
        });
        if (memories.length === 0)
            return '';
        const lines = memories.map(m => {
            if (m.kind === 'preference')
                return `- Preference: ${m.text}`;
            if (m.kind === 'proposal_rejected')
                return `- Previous rejection: ${m.text}`;
            if (m.kind === 'proposal_accepted')
                return `- Previous success: ${m.text}`;
            if (m.kind === 'performance')
                return `- Platform Insight: ${m.text}`;
            return `- ${m.text}`;
        });
        return [
            `\n<project_memory>`,
            `The following are established preferences and past learnings for this project that you MUST adhere to:`,
            ...lines,
            `</project_memory>`
        ].join('\n');
    }
}
exports.AgentMemoryService = AgentMemoryService;
