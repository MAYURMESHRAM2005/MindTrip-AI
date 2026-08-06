import { Router } from 'express';
import currencyController from '../controllers/currency.controller.js';
import { protect } from '../middleware/auth.js';

const router = Router();
router.use(protect);

router.get('/rates', currencyController.rates);
router.get('/convert', currencyController.convert);

export default router;
