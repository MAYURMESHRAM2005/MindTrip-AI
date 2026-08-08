/* Live Budget Optimizer check against the running backend.
 * Registers a fresh user, generates a trip, runs optimize-budget, then
 * re-fetches the itinerary to confirm the optimization persisted.
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

const email = `budget-${Date.now()}@travelmind.app`;

console.log('1) Registering user…');
const reg = await req('POST', '/auth/register', {
  body: { name: 'Budget Live', email, password: 'StrongPass1' },
});
console.log(`   status=${reg.status}`, reg.json.data ? `user=${reg.json.data.user.email}` : reg.json.message);

const login = await req('POST', '/auth/login', { body: { email, password: 'StrongPass1' } });
const token = login.json.data?.accessToken;
console.log(`2) Login status=${login.status} token=${token ? 'OK' : 'MISSING'}`);
if (!token) process.exit(1);

console.log('3) Generating trip…');
const started = Date.now();
const gen = await req('POST', '/trips/generate', {
  token,
  body: {
    origin: 'Mumbai',
    destination: 'Goa',
    startDate: '2026-12-01',
    endDate: '2026-12-04',
    adults: 2,
    totalBudget: 4000,
    currency: 'INR',
    travelStyle: 'budget',
    interests: ['Beaches'],
  },
});
console.log(`   status=${gen.status} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
if (!gen.json.data) {
  console.log('   FAILED:', JSON.stringify(gen.json).slice(0, 500));
  process.exit(1);
}
const { trip, itinerary } = gen.json.data;
console.log(`   Trip "${trip.title}" | est ${itinerary.totalEstimatedCost} INR (budget ${trip.budget.total})`);

const before = itinerary.days.flatMap((d) =>
  d.activities.map((a) => ({ key: `${d.dayNumber}-${a.title}`, amount: a.cost?.amount, cat: a.category }))
);

console.log('\n4) Running optimize-budget…');
const opt = await req('POST', `/trips/${trip._id}/optimize-budget`, { token });
const r = opt.json.data?.result;
console.log(`   status=${opt.status}`);
if (!r) {
  console.log('   FAILED:', JSON.stringify(opt.json).slice(0, 400));
  process.exit(1);
}
console.log(`   original=${r.original} optimized=${r.optimized} saved=${r.saved} remaining=${r.remaining} withinBudget=${r.withinBudget}`);
console.log(`   dropped=${r.dropped.length} reductions=${r.reductions.length}`);
console.log('   dropped items:', r.dropped.map((d) => `${d.category}:${d.amount}`).join(', ') || '(none)');
console.log('   reductions:', r.reductions.map((x) => `${x.category} ${x.from}->${x.to}`).join(', ') || '(none)');

console.log('\n5) Verifying persistence in the saved itinerary…');
const refetch = await req('GET', `/trips/${trip._id}/itinerary`, { token });
const after = refetch.json.data?.itinerary?.days?.flatMap((d) =>
  d.activities.map((a) => ({ key: `${d.dayNumber}-${a.title}`, amount: a.cost?.amount, cat: a.category, dataStatus: a.dataStatus }))
);
const reducedKeys = new Set(r.reductions.map((x) => x.id));
const droppedKeys = new Set(r.dropped.map((x) => x.id));

let persisted = 0;
for (const b of before) {
  if (reducedKeys.has(b.key)) {
    const a = after.find((x) => x.key === b.key);
    const ok = a && a.amount < b.amount;
    console.log(`   reduce  ${b.key}: ${b.amount} -> ${a?.amount} ${ok ? 'OK' : 'NOT PERSISTED ❌'}`);
    if (ok) persisted++;
  }
}
for (const d of droppedKeys) {
  const b = before.find((x) => x.key === d);
  const a = after.find((x) => x.key === d);
  const ok = a && a.amount === 0;
  console.log(`   drop    ${d}: ${b?.amount} -> ${a?.amount} (${a?.dataStatus}) ${ok ? 'OK' : 'NOT PERSISTED ❌'}`);
  if (ok) persisted++;
}

console.log(`\n6) Trip summary fields: moneySaved=${trip.moneySaved} totalOptimizedCost=${trip.totalOptimizedCost}`);
const tripAfter = (await req('GET', `/trips/${trip._id}`, { token })).json.data?.trip;
console.log(`   after save: moneySaved=${tripAfter?.moneySaved} totalOptimizedCost=${tripAfter?.totalOptimizedCost} isOverBudget=${tripAfter?.isOverBudget}`);

const totalChanges = r.dropped.length + r.reductions.length;
if (totalChanges === 0) {
  console.log('\nℹ️ Trip already within budget — nothing to optimize (no persistence to verify).');
} else {
  console.log(persisted === totalChanges
    ? '\n✅ Optimization fully persisted'
    : `\n⚠️ Some optimization changes did NOT persist (${persisted}/${totalChanges})`);
}
