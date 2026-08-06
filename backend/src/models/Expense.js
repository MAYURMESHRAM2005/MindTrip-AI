import mongoose from 'mongoose';
import { EXPENSE_CATEGORIES, CURRENCIES } from '../utils/constants.js';

const expenseSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    trip: { type: mongoose.Schema.Types.ObjectId, ref: 'Trip', default: null, index: true },
    category: { type: String, enum: EXPENSE_CATEGORIES, required: true, index: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, enum: CURRENCIES, default: 'INR' },
    description: { type: String, required: true, trim: true, maxlength: 300 },
    date: { type: Date, required: true, index: true },
    location: { type: String, default: '' },
    paymentMethod: { type: String, default: '' },
    receiptUrl: { type: String, default: '' },
    isEstimate: { type: Boolean, default: false },
  },
  { timestamps: true }
);

expenseSchema.index({ user: 1, trip: 1, date: -1 });

const Expense = mongoose.model('Expense', expenseSchema);
export default Expense;
