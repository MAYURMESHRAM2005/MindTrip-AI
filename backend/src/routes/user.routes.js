import { Router } from 'express';
import userController from '../controllers/user.controller.js';
import { protect } from '../middleware/auth.js';
import validate from '../middleware/validate.js';
import { profileSchema } from '../validators/general.validator.js';
import Joi from 'joi';

const router = Router();
router.use(protect);

const saveDestinationSchema = Joi.object({ destination: Joi.string().trim().min(2).max(120).required() });

router.get('/me', userController.getMe);
router.patch('/me', validate(profileSchema), userController.updateProfile);
router.delete('/me', userController.deleteAccount);

router.get('/preferences', userController.getPreferences);
router.patch('/preferences', userController.updatePreferences);

router.post('/destinations', validate(saveDestinationSchema), userController.saveDestination);

export default router;
