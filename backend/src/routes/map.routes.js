import { Router } from 'express';
import mapController from '../controllers/map.controller.js';
import { protect } from '../middleware/auth.js';
import validate from '../middleware/validate.js';
import { geocodeQuery, directionsQuery, autocompleteQuery } from '../validators/general.validator.js';

const router = Router();
router.use(protect);

router.get('/geocode', validate(geocodeQuery, 'query'), mapController.geocode);
router.get('/autocomplete', validate(autocompleteQuery, 'query'), mapController.autocomplete);
router.get('/directions', validate(directionsQuery, 'query'), mapController.directions);
router.get('/nearby', mapController.nearbyPoints);

export default router;
