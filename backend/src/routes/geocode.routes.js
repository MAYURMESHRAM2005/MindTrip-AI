import { Router } from 'express';
import mapController from '../controllers/map.controller.js';
import { protect } from '../middleware/auth.js';
import validate from '../middleware/validate.js';
import { geocodeQuery } from '../validators/general.validator.js';

const router = Router();
router.use(protect);

/** GET /api/geocode?address=Goa — resolve an address to coordinates. */
router.get('/', validate(geocodeQuery, 'query'), mapController.geocode);

export default router;
