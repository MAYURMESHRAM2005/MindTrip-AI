import mongoose from 'mongoose';
import { connectDB } from '../src/config/db.js';
import AiUsageLog from '../src/models/AiUsageLog.js';

await connectDB(process.env.MONGODB_URI || '');

const logs = await AiUsageLog.find({ status: 'success' })
  .sort({ createdAt: -1 })
  .limit(6)
  .select('agent model latencyMs createdAt -_id');
console.log('Recent successful Gemini calls:');
for (const l of logs) {
  console.log(l.agent.padEnd(16), '|', l.model, '|', l.latencyMs + 'ms', '|', new Date(l.createdAt).toLocaleTimeString());
}

const totals = await AiUsageLog.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]);
console.log('\nAll-time status totals:', JSON.stringify(totals));

const byModel = await AiUsageLog.aggregate([{ $group: { _id: '$model', n: { $sum: 1 } } }]);
console.log('Calls by model:', JSON.stringify(byModel));

await mongoose.disconnect();
