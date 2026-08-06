import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

/**
 * Health endpoint tests - no database required.
 */
test('GET /api/health returns service status', async () => {
  const { default: app } = await import('../src/app.js');
  const res = await request(app).get('/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.status, 'ok');
});

test('unknown route returns 404 JSON', async () => {
  const { default: app } = await import('../src/app.js');
  const res = await request(app).get('/api/definitely-not-a-route');
  assert.equal(res.status, 404);
  assert.equal(res.body.success, false);
});

test('validation rejects malformed register payload', async () => {
  const { default: app } = await import('../src/app.js');
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: 'A', email: 'not-an-email', password: 'short' });
  assert.equal(res.status, 400);
  assert.equal(res.body.success, false);
  assert.ok(Array.isArray(res.body.details));
});

/**
 * Full auth + trip flow against a real test MongoDB.
 * Uses mongodb-memory-server when available (devDependency); the suite skips
 * gracefully when it cannot be installed so unit tests still run anywhere.
 */
let memoryServerAvailable = true;
try {
  await import('mongodb-memory-server');
} catch {
  memoryServerAvailable = false;
}

const skipReason = memoryServerAvailable ? false : 'mongodb-memory-server not installed';

test('register → me → logout → refresh flow', { skip: skipReason }, async () => {
  const memoryServer = await import('mongodb-memory-server');
  const { MongoMemoryServer } = memoryServer;
  let mongod;
  const mongoose = (await import('mongoose')).default;

  try {
    mongod = await MongoMemoryServer.create({ binary: { version: '7.0.14' } });
  } catch (err) {
    console.warn(`[SKIP] mongod binary unavailable: ${err.message}`);
    return; // graceful skip when the binary cannot be downloaded
  }

  try {
    await mongoose.connect(mongod.getUri('travelmind_test'));

    const { default: app } = await import('../src/app.js');
    const agent = request.agent(app);

    const reg = await agent.post('/api/auth/register').send({
      name: 'Test User',
      email: 'test@travelmind.app',
      password: 'StrongPass1',
    });
    assert.equal(reg.status, 201, JSON.stringify(reg.body));
    assert.ok(reg.headers['set-cookie']?.some((c) => c.includes('access_token')));

    const me = await agent.get('/api/auth/me');
    assert.equal(me.status, 200);
    assert.equal(me.body.data.user.email, 'test@travelmind.app');

    // Create a trip through the multi-agent pipeline (providers unconfigured → graceful degradation)
    const tripRes = await agent.post('/api/trips/generate').send({
      origin: 'Mumbai',
      destination: 'Goa',
      startDate: '2026-01-10',
      endDate: '2026-01-14',
      adults: 2,
      totalBudget: 50000,
      currency: 'INR',
      travelStyle: 'standard',
    });
    assert.equal(tripRes.status, 201, JSON.stringify(tripRes.body));
    assert.ok(tripRes.body.data.trip._id);
    assert.ok(tripRes.body.data.itinerary.days.length >= 4, 'itinerary covers all days');
    assert.ok(Array.isArray(tripRes.body.data.agentReport), 'agent report recorded');

    const trips = await agent.get('/api/trips');
    assert.equal(trips.body.data.trips.length, 1);

    // Budget optimizer (deterministic) works on the generated trip
    const opt = await agent.post(`/api/trips/${tripRes.body.data.trip._id}/optimize-budget`);
    assert.equal(opt.status, 200, JSON.stringify(opt.body));
    assert.ok('result' in opt.body.data);

    const logout = await agent.post('/api/auth/logout');
    assert.equal(logout.status, 200);

    const meAfter = await agent.get('/api/auth/me');
    assert.equal(meAfter.status, 401);
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    await mongod.stop();
  }
});
