import { Router } from 'express';
import translateController from '../controllers/translate.controller.js';
import { protect } from '../middleware/auth.js';
import validate from '../middleware/validate.js';
import { translateSchema } from '../validators/general.validator.js';

const router = Router();
router.use(protect);

router.post('/', validate(translateSchema), translateController.translate);

export default router;
