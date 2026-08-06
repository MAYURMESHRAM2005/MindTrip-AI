import { Router } from 'express';
import mapController from '../controllers/map.controller.js';
import { protect } from '../middleware/auth.js';
import validate from '../middleware/validate.js';
import { directionsQuery } from '../validators/general.validator.js';

const router = Router();
router.use(protect);

/** GET /api/routes?origin=&destination=&mode= — driving/walking/transit directions. */
router.get('/', validate(directionsQuery, 'query'), mapController.directions);

export default router;
