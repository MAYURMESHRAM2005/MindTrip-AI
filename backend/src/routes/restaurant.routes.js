import { Router } from 'express';
import restaurantController from '../controllers/restaurant.controller.js';
import { protect } from '../middleware/auth.js';
import validate from '../middleware/validate.js';
import { restaurantSearchQuery } from '../validators/general.validator.js';

const router = Router();
router.use(protect);

router.get('/search', validate(restaurantSearchQuery, 'query'), restaurantController.searchRestaurants);

export default router;
