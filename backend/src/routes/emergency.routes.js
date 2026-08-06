import { Router } from 'express';
import emergencyController from '../controllers/emergency.controller.js';
import { protect } from '../middleware/auth.js';
import validate from '../middleware/validate.js';
import { emergencyContactSchema } from '../validators/general.validator.js';

const router = Router();
router.use(protect);

router.get('/nearby', emergencyController.nearby);
router.get('/contacts', emergencyController.listContacts);
router.post('/contacts', validate(emergencyContactSchema), emergencyController.addContact);
router.patch('/contacts/:id', emergencyController.updateContact);
router.delete('/contacts/:id', emergencyController.deleteContact);

export default router;
