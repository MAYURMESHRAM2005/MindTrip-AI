import { Router } from 'express';
import voiceController from '../controllers/voice.controller.js';
import { protect } from '../middleware/auth.js';
import { aiLimiter } from '../middleware/rateLimiter.js';
import validate from '../middleware/validate.js';
import { voiceSchema } from '../validators/trip.validator.js';

const router = Router();
router.use(protect);

router.post('/command', aiLimiter, validate(voiceSchema), voiceController.processVoiceCommand);
router.post('/speech', voiceController.textForSpeech);

export default router;
