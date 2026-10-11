import { Request, Response } from 'express';
import { prisma, requestContext } from '@workspace/db';

export class SocialAssetsController {
    static async getAssets(req: Request, res: Response) {
        try {
            const companyId = requestContext.getStore()?.companyId as string;
            const { search, type } = req.query;

            const where: any = { companyId };
            if (type && type !== 'all') {
                where.type = String(type);
            }

            const items = await (prisma as any).savedBank.findMany({
                where,
                orderBy: { createdAt: 'desc' }
            }).catch(() => []);

            // Map savedBank items to social asset format
            const assets = (items || []).map((item: any) => ({
                id: item.id,
                url: item.content,
                type: item.type,
                title: item.name,
                description: item.metadata?.description || '',
                tags: item.tags || [],
                createdAt: item.createdAt
            }));

            res.json({ success: true, assets });
        } catch (error: any) {
            console.error('Error fetching social assets:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    static async createAsset(req: Request, res: Response) {
        try {
            const companyId = requestContext.getStore()?.companyId as string;
            const { url, type, title, description, tags } = req.body;

            if (!url || !type) {
                return res.status(400).json({ success: false, error: 'URL and type are required' });
            }

            const bank = await (prisma as any).savedBank.create({
                data: {
                    companyId,
                    type: type || 'link',
                    name: title || url,
                    content: url,
                    tags: tags || [],
                    metadata: { description: description || '' }
                }
            });

            res.status(201).json({
                success: true,
                asset: {
                    id: bank.id,
                    url: bank.content,
                    type: bank.type,
                    title: bank.name,
                    description: description || '',
                    tags: bank.tags || [],
                    createdAt: bank.createdAt
                }
            });
        } catch (error: any) {
            console.error('Error creating social asset:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    static async deleteAsset(req: Request, res: Response) {
        try {
            const companyId = requestContext.getStore()?.companyId as string;
            const { id } = req.params;

            const existing = await (prisma as any).savedBank.findUnique({ where: { id } });
            if (!existing || existing.companyId !== companyId) {
                return res.status(404).json({ success: false, error: 'Asset not found' });
            }

            await (prisma as any).savedBank.delete({ where: { id } });
            res.json({ success: true, message: 'Asset deleted' });
        } catch (error: any) {
            console.error('Error deleting social asset:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }
}
