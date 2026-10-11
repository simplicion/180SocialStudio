import { Router } from 'express';
import { SavedBanksController } from './saved-banks.controller';

const router = Router();

router.get('/', SavedBanksController.getBanks);
router.post('/', SavedBanksController.createBank);
router.delete('/:id', SavedBanksController.deleteBank);

export default router;
