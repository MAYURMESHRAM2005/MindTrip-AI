import { Router } from 'express';
import chatController from '../controllers/chat.controller.js';
import { protect } from '../middleware/auth.js';
import { aiLimiter } from '../middleware/rateLimiter.js';
import validate from '../middleware/validate.js';
import { chatSchema } from '../validators/trip.validator.js';

const router = Router();
router.use(protect);

router.post('/', aiLimiter, validate(chatSchema), chatController.chat);
router.get('/history', chatController.history);
router.get('/:id', chatController.oneConversation);
router.delete('/history', chatController.clearHistory);

export default router;
