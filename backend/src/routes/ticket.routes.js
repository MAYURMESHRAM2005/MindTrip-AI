import { Router } from 'express';
import ticketController from '../controllers/ticket.controller.js';
import { protect } from '../middleware/auth.js';
import validate from '../middleware/validate.js';
import { ticketSchema } from '../validators/general.validator.js';

const router = Router();
router.use(protect);

router.get('/', ticketController.listTickets);
router.post('/', validate(ticketSchema), ticketController.addTicket);
router.post('/:id/qr', ticketController.regenerateQr);
router.delete('/:id', ticketController.deleteTicket);

export default router;
