import ApiResponse from '../utils/ApiResponse.js';
import asyncHandler from '../utils/asyncHandler.js';
import Expense from '../models/Expense.js';
import Trip from '../models/Trip.js';
import budgetService from '../services/budget.service.js';
import expenseAgent from '../agents/expense.agent.js';

export const listExpenses = asyncHandler(async (req, res) => {
  const filter = { user: req.user._id };
  if (req.query.tripId) filter.trip = req.query.tripId;
  if (req.query.category) filter.category = req.query.category;
  const expenses = await Expense.find(filter).sort({ date: -1 }).limit(500);
  res.json(ApiResponse.ok('Expenses', { expenses }));
});

export const addExpense = asyncHandler(async (req, res) => {
  const expense = await Expense.create({ ...req.body, user: req.user._id });
  res.status(201).json(ApiResponse.created('Expense added', { expense }));
});

export const updateExpense = asyncHandler(async (req, res) => {
  const expense = await Expense.findOneAndUpdate(
    { _id: req.params.id, user: req.user._id },
    { $set: req.body },
    { new: true }
  );
  if (!expense) {
    return res.status(404).json({ success: false, message: 'Expense not found' });
  }
  res.json(ApiResponse.ok('Expense updated', { expense }));
});

export const deleteExpense = asyncHandler(async (req, res) => {
  await Expense.findOneAndDelete({ _id: req.params.id, user: req.user._id });
  res.json(ApiResponse.ok('Expense deleted'));
});

/**
 * Summary: planned vs actual vs remaining, category breakdown, daily spend.
 */
export const summary = asyncHandler(async (req, res) => {
  const { tripId } = req.query;
  const filter = { user: req.user._id };
  if (tripId) filter.trip = tripId;

  const [expenses, trip] = await Promise.all([
    Expense.find(filter),
    tripId ? Trip.findOne({ _id: tripId, user: req.user._id }) : Trip.findOne({ user: req.user._id }).sort({ createdAt: -1 }),
  ]);

  const totalSpent = expenses.reduce((s, e) => s + e.amount, 0);
  const byCategory = {};
  const byDay = {};
  for (const e of expenses) {
    byCategory[e.category] = (byCategory[e.category] || 0) + e.amount;
    const key = new Date(e.date).toISOString().slice(0, 10);
    byDay[key] = (byDay[key] || 0) + e.amount;
  }

  const planned = trip?.budget?.total ?? 0;
  const allocation = trip ? budgetService.allocationForStyle(trip.preferences?.travelStyle || 'standard', planned) : null;

  res.json(
    ApiResponse.ok('Expense summary', {
      plannedBudget: planned,
      currency: trip?.budget?.currency || 'INR',
      actualSpending: totalSpent,
      remainingBudget: Math.max(0, planned - totalSpent),
      byCategory,
      byDay,
      allocation,
      tripId: trip?._id || null,
    })
  );
});

/**
 * AI expense analysis (Expense Agent) on real recorded expenses.
 */
export const analyze = asyncHandler(async (req, res) => {
  const { tripId } = req.query;
  const filter = { user: req.user._id };
  if (tripId) filter.trip = tripId;
  const expenses = await Expense.find(filter);
  const trip = tripId
    ? await Trip.findOne({ _id: tripId, user: req.user._id })
    : await Trip.findOne({ user: req.user._id }).sort({ createdAt: -1 });

  const allocation = trip
    ? budgetService.allocationForStyle(trip.preferences?.travelStyle || 'standard', trip.budget.total)
    : null;

  const result = await expenseAgent.run({
    expenses: expenses.map((e) => ({ category: e.category, amount: e.amount, date: e.date })),
    allocation,
    totalBudget: trip?.budget?.total || 0,
    currency: trip?.budget?.currency || 'INR',
    userId: req.user._id.toString(),
  });

  res.json(ApiResponse.ok('Expense analysis', { analysis: result.data }));
});

export default { listExpenses, addExpense, updateExpense, deleteExpense, summary, analyze };
