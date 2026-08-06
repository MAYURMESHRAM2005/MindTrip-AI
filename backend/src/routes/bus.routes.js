import { Router } from 'express';
import busController from '../controllers/bus.controller.js';
import { protect } from '../middleware/auth.js';
import validate from '../middleware/validate.js';
import { trainBusSearchSchema } from '../validators/general.validator.js';

const router = Router();
router.use(protect);

router.get('/search', validate(trainBusSearchSchema, 'query'), busController.searchBuses);

export default router;
