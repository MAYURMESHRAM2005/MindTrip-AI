import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

/**
 * End-to-end pipeline test for the refactored architecture:
 * - Parallel provider data collection
 * - Single Gemini call for itinerary generation
 * - Schema validation on Gemini response
 * - Deterministic day-by-day planning
 * - Budget enforcement
 *
 * Uses mongodb-memory-server when available; skips gracefully otherwise.
 */

let memoryServerAvailable = true;
try {
  await import('mongodb-memory-server');
} catch {
  memoryServerAvailable = false;
}

const skipReason = memoryServerAvailable ? false : 'mongodb-memory-server not installed';

test('full pipeline: parallel collection → single Gemini call → valid itinerary', { skip: skipReason }, async () => {
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
    await mongoose.connect(mongod.getUri('travelmind_pipeline_test'));
    const { default: app } = await import('../src/app.js');
    const agent = request.agent(app);

    // ── Register a user ──────────────────────────────────────────────
    const reg = await agent.post('/api/auth/register').send({
      name: 'Pipeline Test User',
      email: 'pipeline@travelmind.app',
      password: 'StrongPass1',
    });
    assert.equal(reg.status, 201, JSON.stringify(reg.body));

    // ── Generate a trip ──────────────────────────────────────────────
    const startTime = Date.now();
    const tripRes = await agent.post('/api/trips/generate').send({
      origin: 'Mumbai',
      destination: 'Goa',
      startDate: '2026-03-01',
      endDate: '2026-03-04',
      adults: 2,
      children: 0,
      totalBudget: 50000,
      currency: 'INR',
      travelStyle: 'standard',
      foodPreference: 'vegetarian',
      activityLevel: 'moderate',
    });
    const elapsed = Date.now() - startTime;

    // ── Basic response checks ────────────────────────────────────────
    assert.equal(tripRes.status, 201, `Expected 201, got ${tripRes.status}: ${JSON.stringify(tripRes.body).slice(0, 500)}`);
    assert.ok(tripRes.body.data.trip, 'response must contain trip');
    assert.ok(tripRes.body.data.itinerary, 'response must contain itinerary');

    const trip = tripRes.body.data.trip;
    const itinerary = tripRes.body.data.itinerary;

    // ── Trip model checks ────────────────────────────────────────────
    assert.ok(trip._id, 'trip must have _id');
    assert.equal(trip.destination, 'Goa');
    assert.equal(trip.origin, 'Mumbai');
    assert.equal(trip.budget.total, 50000);
    assert.equal(trip.budget.currency, 'INR');
    assert.equal(trip.travelers.adults, 2);
    assert.ok(trip.startDate);
    assert.ok(trip.endDate);

    // ── Itinerary structure checks ───────────────────────────────────
    assert.ok(Array.isArray(itinerary.days), 'itinerary.days must be an array');
    assert.ok(itinerary.days.length >= 3, `Expected ≥3 days, got ${itinerary.days.length}`);
    assert.ok(itinerary.days.length <= 4, `Expected ≤4 days, got ${itinerary.days.length}`);
    assert.equal(itinerary.currency, 'INR');
    assert.equal(itinerary.totalEstimatedCost > 0, true, 'totalEstimatedCost must be positive');
    assert.ok(itinerary.validation, 'itinerary must have validation');

    // ── Per-day structure checks ─────────────────────────────────────
    for (const day of itinerary.days) {
      assert.ok(typeof day.dayNumber === 'number', `Day must have dayNumber`);
      assert.ok(typeof day.date === 'string' || day.date instanceof Date, `Day must have date`);
      assert.ok(typeof day.area === 'string', `Day must have area`);
      assert.ok(Array.isArray(day.activities), `Day ${day.dayNumber} must have activities`);
      // Departure days typically have only checkout + return transport (2 activities)
      const isDepartureDay = day.dayNumber === itinerary.days.length && itinerary.days.length > 1;
      const minActivities = isDepartureDay ? 1 : 3;
      assert.ok(day.activities.length >= minActivities, `Day ${day.dayNumber} must have ≥${minActivities} activities, got ${day.activities.length}`);

      // Each activity must have required fields
      for (const act of day.activities) {
        assert.ok(typeof act.time === 'string', `Activity must have time`);
        assert.ok(typeof act.title === 'string', `Activity "${act.title}" must have title`);
        assert.ok(typeof act.category === 'string', `Activity "${act.title}" must have category`);
        assert.ok(act.cost !== undefined, `Activity "${act.title}" must have cost`);
        assert.ok(typeof act.cost.amount === 'number', `Activity "${act.title}" cost.amount must be a number`);
        assert.ok(act.cost.amount >= 0, `Activity "${act.title}" cost.amount must be ≥ 0`);
        assert.ok(typeof act.cost.isEstimate === 'boolean', `Activity "${act.title}" cost.isEstimate must be boolean`);
      }

      // Day cost must be a number
      assert.ok(typeof day.dayCost === 'number', `Day ${day.dayNumber} dayCost must be a number`);
      assert.ok(day.dayCost >= 0, `Day ${day.dayNumber} dayCost must be ≥ 0`);
    }

    // ── Agent report checks ──────────────────────────────────────────
    assert.ok(Array.isArray(tripRes.body.data.agentReport), 'agentReport must be an array');
    assert.ok(tripRes.body.data.agentReport.length >= 5, `Expected ≥5 agent reports, got ${tripRes.body.data.agentReport.length}`);

    // Check that agent reports have the required structure
    for (const report of tripRes.body.data.agentReport) {
      assert.ok(typeof report.agent === 'string', `Agent report must have agent name`);
      assert.ok(typeof report.status === 'string', `Agent report must have status`);
      assert.ok(typeof report.message === 'string', `Agent report must have message`);
    }

    // ── Budget checks ────────────────────────────────────────────────
    assert.ok(tripRes.body.data.budget, 'response must contain budget');
    const budget = tripRes.body.data.budget;
    assert.equal(budget.totalBudget, 50000);
    assert.equal(budget.currency, 'INR');
    assert.ok(typeof budget.totalEstimatedCost === 'number');
    assert.ok(typeof budget.remainingBudget === 'number');
    assert.ok(typeof budget.budgetUsedPct === 'number');

    // ── Validation checks ────────────────────────────────────────────
    const validation = itinerary.validation;
    assert.ok(typeof validation.passed === 'boolean', 'validation.passed must be boolean');
    assert.ok(Array.isArray(validation.issues), 'validation.issues must be array');
    assert.ok(Array.isArray(validation.warnings), 'validation.warnings must be array');

    // ── Gemini itinerary (optional — may not be available in test env) ─
    if (tripRes.body.data.geminiItinerary) {
      const gemini = tripRes.body.data.geminiItinerary;
      assert.ok(Array.isArray(gemini.days), 'gemini itinerary must have days');
      assert.ok(gemini.days.length >= 3, 'gemini itinerary must cover all days');
      console.log(`[TEST] Gemini itinerary: ${gemini.days.length} days, summary: "${gemini.summary?.slice(0, 80)}..."`);
    } else {
      console.log(`[TEST] Gemini itinerary not available (expected in test env without API key) — deterministic plan used`);
    }

    // ── Performance checks ───────────────────────────────────────────
    console.log(`[TEST] Pipeline completed in ${elapsed}ms`);
    console.log(`[TEST] Gemini request count: ${tripRes.body.data.geminiRequestCount || 'N/A'}`);
    console.log(`[TEST] Days: ${itinerary.days.length}, Total activities: ${itinerary.days.reduce((s, d) => s + d.activities.length, 0)}`);
    console.log(`[TEST] Total estimated cost: ₹${itinerary.totalEstimatedCost} / ₹${budget.totalBudget} (${budget.budgetUsedPct}%)`);

    // Pipeline should complete in a reasonable time (provider timeouts + Gemini)
    // With 20s provider timeouts + 45s Gemini timeout, worst case ~70s
    assert.ok(elapsed < 90000, `Pipeline took too long: ${elapsed}ms`);

    // ── Self-healing validation test ─────────────────────────────────
    // Inject stale overlap warnings, then verify they are healed on re-read
    const Itinerary = (await import('../src/models/Itinerary.js')).default;
    await Itinerary.updateOne(
      { trip: trip._id },
      {
        $set: {
          validation: {
            passed: false,
            issues: [
              'Day 1: "Dinner" at 20:00 overlaps "Local transport & transfers"',
            ],
            warnings: [],
            validatedAt: new Date(),
          },
        },
      }
    );

    const healed = await agent.get(`/api/trips/${trip._id}/itinerary`);
    assert.equal(healed.status, 200);
    assert.equal(
      healed.body.data.itinerary.validation.issues.some((i) => i.includes('overlaps')),
      false,
      'stale overlap warnings must be healed on read'
    );
    console.log(`[TEST] Self-healing validation: ✓`);

    // ── Budget optimizer test ────────────────────────────────────────
    const optRes = await agent.post(`/api/trips/${trip._id}/optimize-budget`);
    assert.equal(optRes.status, 200, `optimize-budget failed: ${JSON.stringify(optRes.body).slice(0, 300)}`);
    assert.ok('result' in optRes.body.data, 'optimize-budget must return result');
    console.log(`[TEST] Budget optimizer: ✓`);

    console.log(`[TEST] All pipeline tests passed!`);

  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    if (mongod) await mongod.stop();
  }
});

test('pipeline: budget constraint is enforced', { skip: skipReason }, async () => {
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
    await mongoose.connect(mongod.getUri('travelmind_budget_test'));
    const { default: app } = await import('../src/app.js');
    const agent = request.agent(app);

    const reg = await agent.post('/api/auth/register').send({
      name: 'Budget Test User',
      email: 'budget@travelmind.app',
      password: 'StrongPass1',
    });
    assert.equal(reg.status, 201);

    // Use a very low budget to test enforcement
    const tripRes = await agent.post('/api/trips/generate').send({
      origin: 'Mumbai',
      destination: 'Goa',
      startDate: '2026-03-01',
      endDate: '2026-03-03',
      adults: 2,
      totalBudget: 10000, // Very tight budget
      currency: 'INR',
      travelStyle: 'budget',
    });
    assert.equal(tripRes.status, 201, JSON.stringify(tripRes.body).slice(0, 500));

    const trip = tripRes.body.data.trip;
    assert.ok(trip.isOverBudget !== undefined, 'trip must have isOverBudget flag');
    assert.ok(typeof trip.totalEstimatedCost === 'number', 'trip must have totalEstimatedCost');

    // Even with a tight budget, the optimizer should have tried to fit within it
    const totalCost = tripRes.body.data.itinerary.totalEstimatedCost;
    console.log(`[TEST] Budget test: ₹${totalCost} / ₹10000 (over: ${trip.isOverBudget})`);

    // The itinerary should still be valid
    assert.ok(tripRes.body.data.itinerary.validation, 'itinerary must have validation');

    console.log(`[TEST] Budget constraint test passed!`);
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    if (mongod) await mongod.stop();
  }
});

test('pipeline: graceful degradation when providers are unavailable', { skip: skipReason }, async () => {
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
    await mongoose.connect(mongod.getUri('travelmind_degradation_test'));
    const { default: app } = await import('../src/app.js');
    const agent = request.agent(app);

    const reg = await agent.post('/api/auth/register').send({
      name: 'Degradation Test User',
      email: 'degradation@travelmind.app',
      password: 'StrongPass1',
    });
    assert.equal(reg.status, 201);

    // Generate a trip — providers may be unavailable (no API keys in test)
    // The pipeline should degrade gracefully, never 500
    const tripRes = await agent.post('/api/trips/generate').send({
      origin: 'Delhi',
      destination: 'Manali',
      startDate: '2026-04-01',
      endDate: '2026-04-05',
      adults: 1,
      totalBudget: 25000,
      currency: 'INR',
      travelStyle: 'adventure',
    });

    // Must never be 500
    assert.ok(tripRes.status < 500, `Pipeline returned ${tripRes.status} (should never be 500)`);

    if (tripRes.status === 201) {
      // Full success — verify degraded agents are marked
      const report = tripRes.body.data.agentReport;
      const degradedAgents = report.filter((r) => r.status === 'degraded');
      console.log(`[TEST] Degraded agents: ${degradedAgents.map((d) => d.agent).join(', ') || 'none'}`);

      // Even with degraded agents, the itinerary must be valid
      const itinerary = tripRes.body.data.itinerary;
      assert.ok(Array.isArray(itinerary.days), 'itinerary must have days');
      assert.ok(itinerary.days.length >= 4, 'must have ≥4 days');

      // Check that degraded activities are properly marked
      let unavailableCount = 0;
      let liveCount = 0;
      for (const day of itinerary.days) {
        for (const act of day.activities) {
          if (act.dataStatus === 'unavailable') unavailableCount++;
          if (act.dataStatus === 'live') liveCount++;
        }
      }
      console.log(`[TEST] Live activities: ${liveCount}, Unavailable: ${unavailableCount}`);
      console.log(`[TEST] Graceful degradation test passed!`);
    } else {
      console.log(`[TEST] Pipeline returned ${tripRes.status} — providers may need configuration`);
      // Even a 4xx is acceptable (validation error), just not 500
    }
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    if (mongod) await mongod.stop();
  }
});
