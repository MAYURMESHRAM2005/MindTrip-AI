import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

let memoryServerAvailable = true;
try {
  await import('mongodb-memory-server');
} catch {
  memoryServerAvailable = false;
}

const skipReason = memoryServerAvailable ? false : 'mongodb-memory-server not installed';

/**
 * Route-wiring smoke test: every feature module must respond (200/201/403),
 * degrade gracefully when providers are unconfigured, and never 500.
 */
test('all feature routes are wired and respond', { skip: skipReason }, async () => {
  const memoryServer = await import('mongodb-memory-server');
  const { MongoMemoryServer } = memoryServer;
  let mongod;
  const mongoose = (await import('mongoose')).default;

  try {
    mongod = await MongoMemoryServer.create({ binary: { version: '7.0.14' } });
  } catch (err) {
    console.warn(`[SKIP] mongod binary unavailable: ${err.message}`);
    return;
  }

  try {
    await mongoose.connect(mongod.getUri('travelmind_smoke'));
    const { default: app } = await import('../src/app.js');
    const agent = request.agent(app);

    const reg = await agent.post('/api/auth/register').send({
      name: 'Smoke User',
      email: 'smoke@travelmind.app',
      password: 'StrongPass1',
    });
    assert.equal(reg.status, 201, JSON.stringify(reg.body));
    const tripRes = await agent.post('/api/trips/generate').send({
      origin: 'Mumbai',
      destination: 'Goa',
      startDate: '2026-02-01',
      endDate: '2026-02-05',
      adults: 2,
      totalBudget: 40000,
      currency: 'INR',
      travelStyle: 'budget',
    });
    assert.equal(tripRes.status, 201, JSON.stringify(tripRes.body));
    const tripId = tripRes.body.data.trip._id;

    // Self-healing validation: inject the legacy false-positive overlap warning
    // (the exact bug reported in the UI) into the stored itinerary, then GET it
    // and confirm the read path re-runs the deterministic validator and heals it.
    const Itinerary = (await import('../src/models/Itinerary.js')).default;
    await Itinerary.updateOne(
      { trip: tripId },
      {
        $set: {
          validation: {
            passed: false,
            issues: [
              'Day 1: "Dinner" at 20:00 overlaps "Local transport & transfers"',
              'Day 2: "Dinner" at 20:00 overlaps "Local transport & transfers"',
              'Day 3: "Dinner" at 20:00 overlaps "Local transport & transfers"',
              'Day 4: "Dinner" at 20:00 overlaps "Local transport & transfers"',
              'Day 5: "Dinner" at 20:00 overlaps "Local transport & transfers"',
            ],
            warnings: [],
            validatedAt: new Date(),
          },
        },
      }
    );
    const healed = await agent.get(`/api/trips/${tripId}/itinerary`);
    assert.equal(healed.status, 200);
    assert.equal(
      healed.body.data.itinerary.validation.issues.some((i) => i.includes('overlaps')),
      false,
      'stale overlap warnings must be healed on read'
    );
    assert.equal(healed.body.data.itinerary.validation.passed, true);

    const cases = [
      ['GET', '/api/users/me', 200],
      ['GET', '/api/users/preferences', 200],
      ['GET', '/api/trips', 200],
      ['GET', `/api/trips/${tripId}/itinerary`, 200],
      ['POST', `/api/trips/${tripId}/optimize-budget`, 200],
      ['GET', '/api/hotels/search?city=Goa&checkIn=2026-02-01&checkOut=2026-02-03&adults=2', 200],
      ['GET', '/api/flights/search?origin=BOM&destination=GOI&departDate=2026-02-01&adults=1', 200],
      ['GET', '/api/trains/search?from=Mumbai&to=Goa&date=2026-02-01', 200],
      ['GET', '/api/buses/search?from=Pune&to=Goa&date=2026-02-01', 200],
      ['GET', '/api/restaurants/search?q=Goa%20restaurants', 200],
      ['GET', '/api/restaurants/search?city=Goa', 200],
      ['GET', '/api/restaurants/search?lat=15.49&lng=73.81', 200],
      ['GET', '/api/places/search?q=Goa', 200],
      ['GET', '/api/maps/geocode?address=Goa', 200],
      ['GET', '/api/maps/autocomplete?q=Nag', 200],
      ['GET', '/api/geocode?address=Goa', 200],
      ['GET', '/api/routes?origin=Mumbai&destination=Goa&mode=driving', 200],
      ['GET', '/api/weather/forecast?city=Goa', 200],
      ['GET', '/api/currency/rates', 200],
      ['POST', '/api/chat', 200, { message: 'What should I do if it rains?', tripId }],
      ['POST', '/api/voice/command', 200, { transcript: 'Find cheaper hotels', tripId }],
      ['POST', '/api/expenses', 201, { category: 'food', amount: 350, description: 'Lunch', date: '2026-02-01' }],
      ['GET', '/api/expenses/summary?tripId=' + tripId, 200],
      ['POST', '/api/tickets', 201, { category: 'flight', title: 'Test flight', reference: 'MY-PNR-123' }],
      ['GET', '/api/tickets', 200],
      ['GET', '/api/notifications', 200],
      ['GET', '/api/emergency/nearby?lat=15.49&lng=73.81', 200],
      ['POST', '/api/translate', 200, { text: 'Hello', target: 'hi' }],
      // RBAC: admin endpoints must be forbidden for regular users
      ['GET', '/api/admin/stats', 403],
    ];

    for (const [method, url, expected, body] of cases) {
      const req = body ? agent[method.toLowerCase()](url).send(body) : agent[method.toLowerCase()](url);
      const res = await req;
      assert.equal(res.status, expected, `${method} ${url} -> expected ${expected}, got ${res.status}: ${JSON.stringify(res.body).slice(0, 200)}`);
      if (res.status < 500) {
        assert.equal(res.body.success, expected < 400, `${method} ${url} should report success=${expected < 400}`);
      }
    }

    // Mutation paths must also heal validation: corrupt stored issues, call
    // the budget optimizer (which drops/rewrites activities), then confirm the
    // served itinerary re-validates clean.
    await Itinerary.updateOne(
      { trip: tripId },
      {
        $set: {
          validation: {
            passed: false,
            issues: ['Day 1: "Lunch" at 13:00 overlaps "Local transport & transfers"'],
            warnings: [],
            validatedAt: new Date(),
          },
        },
      }
    );
    await agent.post(`/api/trips/${tripId}/optimize-budget`).send({});
    const afterOptimize = await agent.get(`/api/trips/${tripId}/itinerary`);
    assert.equal(afterOptimize.status, 200);
    assert.equal(
      afterOptimize.body.data.itinerary.validation.issues.some((i) => i.includes('overlaps')),
      false,
      'optimize-budget must heal stale overlap warnings'
    );

    // PDF downloads
    const pdf = await agent.get(`/api/trips/${tripId}/pdf`);
    assert.equal(pdf.status, 200);
    assert.ok(pdf.headers['content-type']?.includes('application/pdf'), 'should stream a PDF');
    const budgetPdf = await agent.get(`/api/trips/${tripId}/budget-pdf`);
    assert.equal(budgetPdf.status, 200);
    assert.ok(budgetPdf.headers['content-type']?.includes('application/pdf'), 'should stream a budget PDF');
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    if (mongod) await mongod.stop();
  }
});
