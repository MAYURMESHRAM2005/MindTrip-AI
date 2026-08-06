import ApiResponse from '../utils/ApiResponse.js';
import asyncHandler from '../utils/asyncHandler.js';
import User from '../models/User.js';
import Trip from '../models/Trip.js';
import Expense from '../models/Expense.js';
import AiUsageLog from '../models/AiUsageLog.js';
import Notification from '../models/Notification.js';
import { providerStatuses } from '../providers/index.js';
import { aiUsageSummary } from '../services/aiUsage.service.js';

export const stats = asyncHandler(async (_req, res) => {
  const [users, trips, expenses, aiLogs, notifications] = await Promise.all([
    User.countDocuments(),
    Trip.countDocuments(),
    Expense.countDocuments(),
    AiUsageLog.countDocuments(),
    Notification.countDocuments(),
  ]);
  const revenue = await Expense.aggregate([{ $group: { _id: null, total: { $sum: '$amount' } } }]);
  res.json(
    ApiResponse.ok('Admin stats', {
      users,
      trips,
      expenses,
      aiCalls: aiLogs,
      notifications,
      totalExpenses: revenue[0]?.total || 0,
    })
  );
});

export const listUsers = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, parseInt(req.query.limit, 10) || 20);
  const q = req.query.q || '';
  const filter = q ? { $or: [{ name: new RegExp(q, 'i') }, { email: new RegExp(q, 'i') }] } : {};
  const [users, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).select('-password'),
    User.countDocuments(filter),
  ]);
  res.json(ApiResponse.ok('Users', { users, total, page, limit }));
});

export const updateUser = asyncHandler(async (req, res) => {
  const user = await User.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true });
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });
  res.json(ApiResponse.ok('User updated', { user }));
});

export const deleteUser = asyncHandler(async (req, res) => {
  if (req.params.id === req.user._id.toString()) {
    return res.status(400).json({ success: false, message: 'Admins cannot delete themselves' });
  }
  const user = await User.findByIdAndDelete(req.params.id);
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });
  res.json(ApiResponse.ok('User deleted'));
});

export const listTrips = asyncHandler(async (req, res) => {
  const trips = await Trip.find()
    .sort({ createdAt: -1 })
    .limit(100)
    .populate('user', 'name email');
  res.json(ApiResponse.ok('All trips', { trips }));
});

export const aiUsage = asyncHandler(async (req, res) => {
  const days = parseInt(req.query.days, 10) || 30;
  const summary = await aiUsageSummary({ days });
  res.json(ApiResponse.ok('AI usage', { summary }));
});

export const providers = asyncHandler(async (_req, res) => {
  res.json(ApiResponse.ok('Provider status', { providers: providerStatuses() }));
});

export const errors = asyncHandler(async (req, res) => {
  const days = parseInt(req.query.days, 10) || 7;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const errors = await AiUsageLog.find({ status: { $in: ['error', 'unavailable'] }, createdAt: { $gte: since } })
    .sort({ createdAt: -1 })
    .limit(100);
  res.json(ApiResponse.ok('Error log', { errors }));
});

export const analytics = asyncHandler(async (_req, res) => {
  const [tripsByDestination, tripsByStatus, signups] = await Promise.all([
    Trip.aggregate([{ $group: { _id: '$destination', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 10 }]),
    Trip.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    User.aggregate([
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
      { $limit: 60 },
    ]),
  ]);
  res.json(ApiResponse.ok('Analytics', { tripsByDestination, tripsByStatus, signups }));
});

export default { stats, listUsers, updateUser, deleteUser, listTrips, aiUsage, providers, errors, analytics };
