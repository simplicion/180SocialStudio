import { prisma } from '@workspace/db';
export class AssetService {
    static async getAssets(filter: any = {}) {
        const { limit, page, search, ...rest } = filter;

        const where: any = {};
        if (rest.companyId) where.companyId = rest.companyId;
        if (rest.status) where.status = rest.status;
        if (rest.type) where.type = rest.type;
        if (rest.provider) where.provider = rest.provider;
        if (rest.ownerId) where.ownerId = rest.ownerId;
        if (rest.id) where.id = rest.id;

        if (search) {
            where.OR = [
                { name: { contains: search, mode: 'insensitive' } },
                { provider: { contains: search, mode: 'insensitive' } },
                { description: { contains: search, mode: 'insensitive' } },
                { url: { contains: search, mode: 'insensitive' } },
            ];
        }

        const take = limit ? Math.min(Number(limit) || 100, 500) : 100;
        const skip = page && Number(page) > 1 ? (Number(page) - 1) * take : undefined;

        const assets = await prisma.asset.findMany({
            where,
            include: {
                owner: {
                    select: { id: true, name: true, email: true }
                }
            },
            orderBy: { createdAt: 'desc' },
            take,
            skip,
        });

        return assets;
    }

    static async getAssetStats(companyId?: string) {
        const where: any = {};
        if (companyId) where.companyId = companyId;

        const groupStats = await prisma.asset.groupBy({
            by: ['type'],
            where,
            _count: { _all: true },
            _sum: { cost: true }
        });

        const stats = groupStats.map((g: any) => ({
            _id: g.type,
            count: g._count._all,
            totalCost: g._sum.cost || 0
        }));

        const activeIntegrationsCount = await prisma.asset.count({
            where: {
                ...where,
                type: { in: ['api', 'service'] },
                status: 'active'
            }
        });

        return { stats, activeIntegrationsCount };
    }

    static async getAssetById(id: string) {
        return prisma.asset.findFirst({
            where: { 
                id
            },
            include: { owner: { select: { name: true } } }
        });
    }

    static async createAsset(data: any) {
        if (!data.name || !data.type) {
            throw new Error('Asset name and type are required');
        }

        let parsedRenewalDate = undefined;
        if (data.renewalDate) {
            parsedRenewalDate = new Date(data.renewalDate).toISOString();
        } else if (data.renewalDate === null) {
            parsedRenewalDate = null;
        }

        const assetData = {
            ...data
        };

        if (parsedRenewalDate !== undefined) {
            assetData.renewalDate = parsedRenewalDate;
        }

        return prisma.asset.create({
            data: assetData
        });
    }

    static async updateAsset(id: string, data: any) {
        let parsedRenewalDate = undefined;
        if (data.renewalDate) {
            parsedRenewalDate = new Date(data.renewalDate).toISOString();
        } else if (data.renewalDate === null) {
            parsedRenewalDate = null;
        }

        const updateData = { ...data, updatedAt: new Date() };
        if (parsedRenewalDate !== undefined) {
            updateData.renewalDate = parsedRenewalDate;
        }

        const assetInfo = await prisma.asset.updateMany({
            where: { 
                id
            },
            data: updateData
        });

        if (assetInfo.count === 0) throw new Error('Asset not found');
        
        return prisma.asset.findFirst({ where: { id } });
    }

    static async deleteAsset(id: string) {
        const asset = await prisma.asset.deleteMany({
            where: { 
                id
            }
        });
        if (asset.count === 0) throw new Error('Asset not found');
        return { success: true };
    }
}
