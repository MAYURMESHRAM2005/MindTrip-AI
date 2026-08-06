import { Router } from 'express';
import expenseController from '../controllers/expense.controller.js';
import { protect } from '../middleware/auth.js';
import validate from '../middleware/validate.js';
import { expenseSchema } from '../validators/general.validator.js';

const router = Router();
router.use(protect);

router.get('/', expenseController.listExpenses);
router.get('/summary', expenseController.summary);
router.get('/analyze', expenseController.analyze);
router.post('/', validate(expenseSchema), expenseController.addExpense);
router.patch('/:id', expenseController.updateExpense);
router.delete('/:id', expenseController.deleteExpense);

export default router;
