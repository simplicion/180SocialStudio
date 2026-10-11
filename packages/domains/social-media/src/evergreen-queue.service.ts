import { prisma, requestContext } from '@workspace/db';

export interface CreateSlotDTO {
    projectId: string;
    dayOfWeek: number; // 0 (Sun) to 6 (Sat)
    timeSlotUtc: string; // e.g. "14:30"
    category: string;
}

export class EvergreenQueueService {
    static async listSlots(projectId: string) {
        const companyId = requestContext.getStore()?.companyId as string;
        if (!companyId) throw new Error('Company context required');

        return await (prisma as any).evergreenQueueSlot.findMany({
            where: { companyId, projectId },
            orderBy: [{ dayOfWeek: 'asc' }, { timeSlotUtc: 'asc' }]
        });
    }

    static async createSlot(data: CreateSlotDTO) {
        const companyId = requestContext.getStore()?.companyId as string;
        if (!companyId) throw new Error('Company context required');

        return await (prisma as any).evergreenQueueSlot.create({
            data: {
                companyId,
                projectId: data.projectId,
                dayOfWeek: data.dayOfWeek,
                timeSlotUtc: data.timeSlotUtc,
                category: data.category,
                isActive: true
            }
        });
    }

    static async deleteSlot(id: string) {
        const companyId = requestContext.getStore()?.companyId as string;
        const slot = await (prisma as any).evergreenQueueSlot.findUnique({ where: { id } });
        if (!slot || slot.companyId !== companyId) throw new Error('Slot not found');

        await (prisma as any).evergreenQueueSlot.delete({ where: { id } });
        return { success: true };
    }
}
