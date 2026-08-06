import { Router } from 'express';
import flightController from '../controllers/flight.controller.js';
import { protect } from '../middleware/auth.js';
import validate from '../middleware/validate.js';
import { flightSearchSchema } from '../validators/general.validator.js';

const router = Router();
router.use(protect);

router.get('/search', validate(flightSearchSchema, 'query'), flightController.searchFlights);

export default router;
