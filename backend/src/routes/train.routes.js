import { Router } from 'express';
import trainController from '../controllers/train.controller.js';
import { protect } from '../middleware/auth.js';
import validate from '../middleware/validate.js';
import { trainBusSearchSchema } from '../validators/general.validator.js';

const router = Router();
router.use(protect);

router.get('/search', validate(trainBusSearchSchema, 'query'), trainController.searchTrains);

export default router;
