import { Router, Request, Response } from 'express';
import { EvergreenQueueService } from '@workspace/social-media';

const router = Router();

// List slots for project
router.get('/:projectId/slots', async (req: Request, res: Response) => {
    try {
        const slots = await EvergreenQueueService.listSlots(String(req.params.projectId));
        res.json({ success: true, slots });
    } catch (error: any) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// Create slot
router.post('/slots', async (req: Request, res: Response) => {
    try {
        const slot = await EvergreenQueueService.createSlot(req.body);
        res.status(201).json({ success: true, slot });
    } catch (error: any) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// Delete slot
router.delete('/slots/:id', async (req: Request, res: Response) => {
    try {
        const result = await EvergreenQueueService.deleteSlot(String(req.params.id));
        res.json(result);
    } catch (error: any) {
        res.status(400).json({ success: false, error: error.message });
    }
});

export default router;
