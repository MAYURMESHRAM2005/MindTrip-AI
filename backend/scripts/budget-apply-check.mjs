/* Verify that optimize-budget actually APPLIES and PERSISTS dropped/reduced
 * costs to the saved itinerary, by first inflating a trip's costs so it is
 * clearly over budget. */
const BASE = 'http://localhost:5000/api';
const TRIP_ID = process.argv[2] || '6a75d0be187d1132c2794312';
const EMAIL = process.argv[3] || 'budget-1786106006714@travelmind.app';
const PASSWORD = 'StrongPass1';

const mongoose = (await import('mongoose')).default;
const { connectDB } = await import('../src/config/db.js');
await connectDB(process.env.MONGODB_URI || '');
const Trip = (await import('../src/models/Trip.js')).default;
const Itinerary = (await import('../src/models/Itinerary.js')).default;

async function api(method, path, token, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

// 1) Inflate costs directly in Mongo so the trip is massively over budget.
const itinerary = await Itinerary.findOne({ trip: TRIP_ID });
const trip = await Trip.findById(TRIP_ID);
if (!itinerary || !trip) {
  console.log('Trip/itinerary not found');
  process.exit(1);
}
let inflated = 0;
for (const day of itinerary.days) {
  for (const act of day.activities) {
    if (act.category === 'restaurant') act.cost.amount = 3000;
    else if (act.category === 'activity' || act.category === 'attraction') act.cost.amount = 2500;
    else if (act.category === 'hotel') act.cost.amount = 4000;
    inflated++;
  }
  day.dayCost = day.activities.reduce((s, a) => s + (a.cost?.amount || 0), 0);
}
itinerary.totalEstimatedCost = itinerary.days.reduce((s, d) => s + d.dayCost, 0);
await itinerary.save();
trip.totalEstimatedCost = itinerary.totalEstimatedCost;
trip.isOverBudget = trip.totalEstimatedCost > trip.budget.total;
await trip.save();
console.log(`Inflated ${inflated} activities. est = ${itinerary.totalEstimatedCost} INR (budget ${trip.budget.total}) -> over-budget: ${trip.isOverBudget}`);

// 2) Login and run the optimizer through the real API.
const login = await api('POST', '/auth/login', null, { email: EMAIL, password: PASSWORD });
const token = login.json.data?.accessToken;
console.log(`Login: ${login.status}${token ? ' OK' : ' FAILED'}`);
if (!token) process.exit(1);

const before = {};
for (const day of itinerary.days)
  for (const act of day.activities) before[`${day.dayNumber}-${act.title}`] = act.cost.amount;

const opt = await api('POST', `/trips/${TRIP_ID}/optimize-budget`, token);
const r = opt.json.data?.result;
console.log(`Optimize: ${opt.status}`);
if (!r) { console.log('FAILED', JSON.stringify(opt.json).slice(0, 300)); process.exit(1); }
console.log(`original=${r.original} optimized=${r.optimized} saved=${r.saved} withinBudget=${r.withinBudget}`);
console.log(`dropped=${r.dropped.length} reductions=${r.reductions.length}`);

// 3) Re-read from the DB and confirm the changes stuck.
const after = await Itinerary.findOne({ trip: TRIP_ID });
const afterMap = {};
for (const day of after.days)
  for (const act of day.activities) afterMap[`${day.dayNumber}-${act.title}`] = { amount: act.cost.amount, status: act.dataStatus };

let checks = 0, passed = 0;
for (const d of r.dropped) {
  checks++;
  const a = afterMap[d.id];
  const ok = a && a.amount === 0 && a.status === 'unavailable';
  console.log(`  drop   ${d.id}: ${before[d.id]} -> ${a?.amount} ${ok ? '✅' : '❌'}`);
  if (ok) passed++;
}
for (const x of r.reductions) {
  checks++;
  const a = afterMap[x.id];
  const ok = a && a.amount < before[x.id];
  console.log(`  reduce ${x.id}: ${before[x.id]} -> ${a?.amount} ${ok ? '✅' : '❌'}`);
  if (ok) passed++;
}
const totalAfter = after.days.reduce((s, d) => s + d.dayCost, 0);
console.log(`\nPersisted day-cost sum = ${totalAfter} (optimized reported ${r.optimized})`);
console.log(`trip.moneySaved=${(await Trip.findById(TRIP_ID)).moneySaved}`);

if (checks === 0) console.log('\n⚠ Nothing to optimize — inflate harder next time.');
else console.log(passed === checks ? '\n✅ All optimization changes persisted' : `\n⚠ Only ${passed}/${checks} changes persisted`);

await mongoose.disconnect();
