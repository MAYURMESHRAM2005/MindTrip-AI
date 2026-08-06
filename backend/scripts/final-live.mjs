/* Final live verification: generate a fresh trip with real Gemini 3.5 Flash. */
const BASE = 'http://localhost:5000/api';

const login = await fetch(`${BASE}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'live-1785783243810@travelmind.app', password: 'StrongPass1' }),
}).then((r) => r.json());

if (!login.success) {
  console.log('LOGIN FAILED:', JSON.stringify(login).slice(0, 300));
  process.exit(1);
}
const token = login.data.accessToken;
console.log('Login OK as', login.data.user.email);

const started = Date.now();
const gen = await fetch(`${BASE}/trips/generate`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({
    origin: 'Mumbai',
    destination: 'Goa',
    startDate: '2026-11-15',
    endDate: '2026-11-17',
    travelers: 2,
    adults: 2,
    totalBudget: 40000,
    currency: 'INR',
    travelStyle: 'budget',
    interests: ['beaches', 'food', 'history'],
  }),
}).then((r) => r.json());

const elapsed = ((Date.now() - started) / 1000).toFixed(1);
if (!gen.success) {
  console.log('GENERATE FAILED:', JSON.stringify(gen).slice(0, 400));
  process.exit(1);
}
const { trip, itinerary, agentReport, validation } = gen.data;
const agents = agentReport || [];
console.log(`\nTrip generated in ${elapsed}s:`);
console.log('-', trip.title);
console.log('-', trip.destination, '|', trip.startDate, '→', trip.endDate, '| budget', trip.currency, trip.budget);
console.log('- days:', itinerary.days.length, '| activities:', itinerary.days.reduce((n, d) => n + d.activities.length, 0));
console.log('- total estimated cost:', itinerary.totalEstimatedCost ?? 'n/a', trip.currency);

console.log('\nAgent statuses (success / degraded / unavailable):');
const statusCounts = {};
for (const a of agents) statusCounts[a.status] = (statusCounts[a.status] || 0) + 1;
console.log(JSON.stringify(statusCounts));
const ok = agents.filter((a) => a.status === 'success').map((a) => a.agent);
const degraded = agents.filter((a) => a.status === 'degraded').map((a) => a.agent);
const live = agents.filter((a) => a.data?.isLive).map((a) => a.agent);
console.log('- AI-driven OK:', ok.join(', ') || '(none)');
console.log('- degraded (provider unconfigured):', degraded.join(', ') || '(none)');
console.log('- live provider data used:', live.join(', ') || '(none)');

console.log('\nValidator:', validation.passed ? 'PASSED ✅' : 'FAILED ❌');
for (const w of validation.warnings || []) console.log('  -', w);

const trips = await fetch(`${BASE}/trips`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
console.log('\nTotal trips in account:', trips.data.trips.length);
