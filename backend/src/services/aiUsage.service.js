import AiUsageLog from '../models/AiUsageLog.js';

export async function aiUsageSummary({ days = 30 } = {}) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const [total, byAgent, byStatus, daily] = await Promise.all([
    AiUsageLog.countDocuments({ createdAt: { $gte: since } }),
    AiUsageLog.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: '$agent', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    AiUsageLog.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    AiUsageLog.aggregate([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 },
          avgLatency: { $avg: '$latencyMs' },
        },
      },
      { $sort: { _id: 1 } },
    ]),
  ]);
  return { total, since, byAgent, byStatus, daily };
}

export default { aiUsageSummary };
