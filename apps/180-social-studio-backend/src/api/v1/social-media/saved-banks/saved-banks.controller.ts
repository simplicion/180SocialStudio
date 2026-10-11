import { Request, Response, NextFunction } from 'express';
import { SavedBanksService } from '@workspace/social-media';

export class SavedBanksController {
    static async getBanks(req: Request, res: Response, next: NextFunction) {
        try {
            const banks = await SavedBanksService.getBanks();
            return res.json({ success: true, banks });
        } catch (error) {
            return res.status(500).json({ success: false, message: 'Failed to fetch saved banks' });
        }
    }

    static async createBank(req: Request, res: Response, next: NextFunction) {
        try {
            const { type, name, content, tags } = req.body;
            
            const bank = await SavedBanksService.createBank({ type, name, content, tags });
            return res.json({ success: true, bank });
        } catch (error: any) {
            if (error.message === 'Type, name, and content are required') {
                return res.status(400).json({ success: false, message: error.message });
            }
            return res.status(500).json({ success: false, message: 'Failed to create saved bank' });
        }
    }

    static async deleteBank(req: Request, res: Response, next: NextFunction) {
        try {
            const { id } = req.params;

            await SavedBanksService.deleteBank(String(id));
            return res.json({ success: true, message: 'Bank deleted' });
        } catch (error: any) {
            if (error.message === 'Bank not found') {
                return res.status(404).json({ success: false, message: 'Bank not found' });
            }
            return res.status(500).json({ success: false, message: 'Failed to delete saved bank' });
        }
    }
}
