import { Router } from 'express';
import hotelController from '../controllers/hotel.controller.js';
import { protect } from '../middleware/auth.js';
import validate from '../middleware/validate.js';
import { hotelSearchSchema } from '../validators/general.validator.js';

const router = Router();
router.use(protect);

router.get('/search', validate(hotelSearchSchema, 'query'), hotelController.searchHotels);

export default router;
