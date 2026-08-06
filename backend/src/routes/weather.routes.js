import { Router } from 'express';
import weatherController from '../controllers/weather.controller.js';
import { protect } from '../middleware/auth.js';
import validate from '../middleware/validate.js';
import { weatherQuery } from '../validators/general.validator.js';

const router = Router();
router.use(protect);

router.get('/current', validate(weatherQuery, 'query'), weatherController.current);
router.get('/forecast', validate(weatherQuery, 'query'), weatherController.forecast);

export default router;
