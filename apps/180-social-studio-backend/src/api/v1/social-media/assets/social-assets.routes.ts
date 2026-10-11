import { Router } from 'express';
import { SocialAssetsController } from './social-assets.controller';

const router = Router();

router.get('/', SocialAssetsController.getAssets);
router.post('/', SocialAssetsController.createAsset);
router.delete('/:id', SocialAssetsController.deleteAsset);

export default router;
