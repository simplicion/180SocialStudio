import { prisma, requestContext } from '@workspace/db';

export class SavedBanksService {
    static async getBanks() {
        const companyId = requestContext.getStore()?.companyId as string;
        try {
            const banks = await prisma.savedBank.findMany({
                where: { companyId },
                orderBy: { createdAt: 'desc' }
            });
            return banks;
        } catch (error) {
            console.error('Error fetching banks:', error);
            throw new Error('Failed to fetch saved banks');
        }
    }

    static async createBank(data: { type: string, name: string, content: string, tags?: string[] }) {
        const companyId = requestContext.getStore()?.companyId as string;
        try {
            if (!data.type || !data.name || !data.content) {
                throw new Error('Type, name, and content are required');
            }

            const bank = await prisma.savedBank.create({
                data: {
                    companyId,
                    type: data.type,
                    name: data.name,
                    content: data.content,
                    tags: data.tags || []
                }
            });
            return bank;
        } catch (error) {
            console.error('Error creating bank:', error);
            throw new Error('Failed to create saved bank');
        }
    }

    static async deleteBank(id: string) {
        const companyId = requestContext.getStore()?.companyId as string;
        try {
            const bank = await prisma.savedBank.findUnique({ where: { id } });
            if (!bank || bank.companyId !== companyId) {
                throw new Error('Bank not found');
            }

            await prisma.savedBank.delete({ where: { id } });
            return true;
        } catch (error: any) {
            console.error('Error deleting bank:', error);
            if (error.message === 'Bank not found') throw error;
            throw new Error('Failed to delete saved bank');
        }
    }
}
