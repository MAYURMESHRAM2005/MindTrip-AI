/* Live end-to-end check against the running backend (localhost:5000).
 * Registers a fresh user, generates a trip through the real multi-agent
 * pipeline, then reports agent results and confirms the Gemini model used.
 */
const BASE = 'http://localhost:5000/api';

async function req(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

const email = `live-${Date.now()}@travelmind.app`;

console.log('1) Registering user…');
const reg = await req('POST', '/auth/register', {
  body: { name: 'Live Test', email, password: 'StrongPass1' },
});
console.log(`   status=${reg.status}`, reg.json.data ? `user=${reg.json.data.user.email}` : reg.json.message);

const login = await req('POST', '/auth/login', {
  body: { email, password: 'StrongPass1' },
});
const token = login.json.data?.accessToken;
console.log(`2) Login status=${login.status} token=${token ? 'OK' : 'MISSING'}`);
if (!token) process.exit(1);

console.log('3) Generating trip through the multi-agent pipeline (Gemini 3.5 Flash)…');
const started = Date.now();
const trip = await req('POST', '/trips/generate', {
  token,
  body: {
    origin: 'Mumbai',
    destination: 'Goa',
    startDate: '2026-09-10',
    endDate: '2026-09-13',
    adults: 2,
    totalBudget: 45000,
    currency: 'INR',
    travelStyle: 'budget',
    interests: ['Beaches', 'Food'],
    foodPreference: 'vegetarian',
  },
});
const elapsed = ((Date.now() - started) / 1000).toFixed(1);
const d = trip.json.data;
console.log(`   status=${trip.status} in ${elapsed}s`);

if (!d) {
  console.log('   FAILED:', JSON.stringify(trip.json).slice(0, 500));
  process.exit(1);
}

const report = d.agentReport || [];
const aiUsed = report.filter((r) => r.usedAI);
const degraded = report.filter((r) => r.status === 'degraded');
console.log(`   Trip: "${d.trip.title}" → ${d.trip.destination}, ${d.itinerary.days.length} days`);
console.log(`   Estimated cost: ${d.trip.totalEstimatedCost} ${d.trip.budget.currency} (budget ${d.trip.budget.total})`);
console.log(`   Agents run: ${report.length} | AI-processed: ${aiUsed.length} | degraded: ${degraded.length}`);
console.log(`   Validation: ${d.validation?.passed ? 'PASSED' : 'ISSUES'} (${(d.validation?.issues || []).length} issues)`);
console.log(`   Data availability: ${JSON.stringify(d.dataAvailability)}`);
console.log('   Agent statuses:', report.map((r) => `${r.agent}:${r.status}`).join(', '));
console.log('   Day 1 activities:', (d.itinerary.days[0]?.activities || []).map((a) => a.title).join(' | '));

// Confirm the model actually used in AiUsageLog
console.log('4) Verifying AiUsageLog…');
const mongoose = (await import('mongoose')).default;
const { connectDB } = await import('../src/config/db.js');
await connectDB(process.env.MONGODB_URI || '');
const AiUsageLog = (await import('../src/models/AiUsageLog.js')).default;
const logs = await AiUsageLog.find({ user: d.trip.user, status: 'success' })
  .sort({ createdAt: -1 })
  .limit(8)
  .select('agent model action status -_id');
const models = [...new Set(logs.map((l) => l.model))];
console.log(`   Models observed: ${models.join(', ') || 'none'}`);
console.log(`   Sample agent calls: ${logs.map((l) => `${l.agent}(${l.model}:${l.status})`).join(', ') || 'none'}`);
if (!models.includes('gemini-3.5-flash')) console.log('   ⚠ gemini-3.5-flash not found in recent AI logs');

await mongoose.disconnect();
console.log('\nDONE');
