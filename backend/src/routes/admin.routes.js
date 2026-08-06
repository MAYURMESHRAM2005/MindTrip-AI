import { Router } from 'express';
import adminController from '../controllers/admin.controller.js';
import { protect, isAdmin } from '../middleware/auth.js';
import validate from '../middleware/validate.js';
import { adminUpdateUserSchema } from '../validators/general.validator.js';

const router = Router();
router.use(protect, isAdmin);

router.get('/stats', adminController.stats);
router.get('/users', adminController.listUsers);
router.patch('/users/:id', validate(adminUpdateUserSchema), adminController.updateUser);
router.delete('/users/:id', adminController.deleteUser);
router.get('/trips', adminController.listTrips);
router.get('/ai-usage', adminController.aiUsage);
router.get('/providers', adminController.providers);
router.get('/errors', adminController.errors);
router.get('/analytics', adminController.analytics);

export default router;
