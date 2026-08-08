import { Router } from 'express';
import tripController from '../controllers/trip.controller.js';
import chatController from '../controllers/chat.controller.js';
import { protect } from '../middleware/auth.js';
import { aiLimiter } from '../middleware/rateLimiter.js';
import validate from '../middleware/validate.js';
import {
  generateTripSchema,
  updateTripSchema,
  tripIdParams,
  moveActivitySchema,
  chatSchema,
} from '../validators/trip.validator.js';

const router = Router();
router.use(protect);

router.post('/generate', aiLimiter, validate(generateTripSchema), tripController.generate);
router.get('/', tripController.listTrips);
router.get('/:id', validate(tripIdParams, 'params'), tripController.getTrip);
router.patch('/:id', validate(tripIdParams, 'params'), validate(updateTripSchema), tripController.updateTrip);
router.delete('/:id', validate(tripIdParams, 'params'), tripController.deleteTrip);

router.get('/:id/itinerary', validate(tripIdParams, 'params'), tripController.getItinerary);
router.post('/:id/optimize-budget', aiLimiter, validate(tripIdParams, 'params'), tripController.optimizeBudget);
router.get('/:id/pdf', validate(tripIdParams, 'params'), tripController.downloadPdf);
router.get('/:id/budget-pdf', validate(tripIdParams, 'params'), tripController.downloadBudgetPdf);
router.post('/:id/activities/move', validate(tripIdParams, 'params'), validate(moveActivitySchema), tripController.moveActivity);
router.post('/:id/replace-hotel', aiLimiter, validate(tripIdParams, 'params'), tripController.replaceHotel);
router.post('/:id/make-cheaper', aiLimiter, validate(tripIdParams, 'params'), tripController.makeCheaper);

// Chatbot with trip context
router.post('/:id/chat', aiLimiter, validate(tripIdParams, 'params'), validate(chatSchema), chatController.chat);

export default router;
