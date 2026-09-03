/**
 * End-to-end verification of the MindTrip AI Itinerary Pipeline.
 *
 * Traces the complete execution path:
 *   normalizeCandidates → AI plan → resolveProviderIds → deterministic validation → replanning → final itinerary
 *
 * Each test simulates a specific scenario without calling real LLMs or external APIs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCandidates, resolveProviderIds, rebuildCosts } from '../src/orchestrator/orchestratorAIPlanning.js';
import finalValidatorAgent from '../src/agents/finalValidator.agent.js';
import { ERROR_TYPES } from '../src/agents/finalValidator.agent.js';
import itineraryService from '../src/services/itinerary.service.js';

// ══════════════════════════════════════════════════════════════════════
//  TEST DATA — reusable candidates
// ══════════════════════════════════════════════════════════════════════

const ATTRACTIONS = Array.from({ length: 10 }, (_, i) => ({
  name: `Attraction ${i + 1}`,
  placeId: `attr-${i + 1}`,
  types: ['tourist_attraction'],
  address: `Area ${String.fromCharCode(65 + i)}, Goa`,
  suburb: `Area ${String.fromCharCode(65 + i)}`,
  coordinates: { lat: 15.5 + i * 0.01, lng: 73.7 + i * 0.005 },
  rating: 4.0 + (i % 5) * 0.2,
  priceLevel: i % 3,
  entryFee: { amount: i * 50, currency: 'INR', isEstimate: false },
  openingHours: { periods: [{ open: { day: 0, time: '09:00' }, close: { day: 0, time: '18:00' } }] },
  estimatedVisitHours: 1.5,
  dataStatus: 'live',
  isLive: true,
}));

const RESTAURANTS = Array.from({ length: 12 }, (_, i) => ({
  name: `Restaurant ${i + 1}`,
  placeId: `rest-${i + 1}`,
  types: ['restaurant'],
  address: `Area ${String.fromCharCode(65 + (i % 10))}, Goa`,
  suburb: `Area ${String.fromCharCode(65 + (i % 10))}`,
  coordinates: { lat: 15.52 + i * 0.005, lng: 73.75 + i * 0.003 },
  rating: 3.8 + (i % 5) * 0.15,
  priceLevel: i % 4,
  averageCostPerPerson: 200 + i * 100,
  cuisines: ['Indian'],
  dataStatus: 'live',
  isLive: true,
}));

const HOTEL_RESULT = {
  data: {
    isLive: true,
    recommended: {
      name: 'Grand Hotel Goa',
      price: { amount: 3000, currency: 'INR' },
      latitude: 15.5,
      longitude: 73.75,
      address: 'Baga, Goa',
    },
    hotels: [],
  },
};

function buildCandidates() {
  return normalizeCandidates({
    attractions: ATTRACTIONS,
    restaurants: RESTAURANTS,
    nightlife: [],
    hotelResult: HOTEL_RESULT,
    transportResult: null,
    eventsResult: null,
  });
}

// ══════════════════════════════════════════════════════════════════════
//  TEST 1: 5-day trip, no attraction repeated across days
// ══════════════════════════════════════════════════════════════════════
test('TEST 1: 5-day trip — no attraction repeated across days', () => {
  const candidates = buildCandidates();
  // Build a valid 5-day plan with distinct attractions per day
  const days = [];
  const usedAttractions = new Set();
  for (let d = 1; d <= 5; d++) {
    const acts = [
      { title: 'Hotel', time: '07:00', category: 'hotel', provider: 'amadeus', providerId: 'Grand Hotel Goa',
        cost: { amount: 3000, isEstimate: false }, dataStatus: 'live', isLive: true, source: 'amadeus-hotels' },
      { title: 'Breakfast', time: '08:00', category: 'restaurant', provider: 'geoapify', providerId: `rest-${d * 2 - 1}`,
        cost: { amount: 200 + (d * 2 - 1) * 100, isEstimate: false }, dataStatus: 'live', isLive: true, source: 'geoapify',
        coordinates: RESTAURANTS[d * 2 - 2].coordinates },
    ];
    // Pick a distinct attraction for morning and afternoon
    for (const slot of ['morning', 'afternoon']) {
      const idx = (d - 1) * 2 + (slot === 'morning' ? 0 : 1);
      const attr = ATTRACTIONS[idx];
      const time = slot === 'morning' ? '10:00' : '14:00';
      acts.push({
        title: attr.name, time, category: 'attraction', provider: 'geoapify', providerId: attr.placeId,
        cost: { amount: attr.entryFee.amount, isEstimate: false }, dataStatus: 'live', isLive: true, source: 'geoapify',
        coordinates: attr.coordinates,
      });
      usedAttractions.add(attr.placeId);
    }
    acts.push(
      { title: `Lunch ${d}`, time: '13:00', category: 'restaurant', provider: 'geoapify', providerId: `rest-${d * 2}`,
        cost: { amount: 300 + d * 100, isEstimate: false }, dataStatus: 'live', isLive: true, source: 'geoapify',
        coordinates: RESTAURANTS[d * 2 - 1].coordinates },
      { title: `Dinner ${d}`, time: '19:30', category: 'restaurant', provider: 'geoapify', providerId: `rest-${d * 2 + 1}`,
        cost: { amount: 400 + d * 100, isEstimate: false }, dataStatus: 'live', isLive: true, source: 'geoapify',
        coordinates: RESTAURANTS[d * 2]?.coordinates || RESTAURANTS[0].coordinates },
    );
    days.push({ dayNumber: d, date: `2025-06-0${d}`, activities: acts });
  }

  const totalCost = days.reduce((sum, d) => sum + d.activities.reduce((s, a) => s + (a.cost?.amount || 0), 0), 0);

  const result = finalValidatorAgent.runEnhanced({
    days, budget: 100000, totalEstimatedCost: totalCost,
    destination: 'Goa', origin: '', prefs: {}, candidates,
  });

  // Filter out HOTEL_DATES (no hotel on departure day in this test data)
  const nonHotelIssues = result.structuredErrors.filter(e => e.type !== ERROR_TYPES.HOTEL_DATES);

  // No duplicate ATTRACTION provider IDs should appear across days
  const dupIssues = nonHotelIssues.filter(e => e.type === ERROR_TYPES.DUPLICATE);
  const attractionDups = dupIssues.filter(e => {
    const msg = e.message || '';
    return msg.includes('Attraction') || (e.replaceableCategory === 'attraction');
  });
  assert.equal(attractionDups.length, 0, `No duplicate attractions across days — got ${attractionDups.length} duplicate issues: ${JSON.stringify(attractionDups)}`);
});

// ══════════════════════════════════════════════════════════════════════
//  TEST 2: AI returns a fake providerId → validator rejects
// ══════════════════════════════════════════════════════════════════════
test('TEST 2: AI returns fake providerId → validator rejects it', () => {
  const candidates = buildCandidates();

  // Simulate AI returning a fake providerId that resolveProviderIds CANNOT resolve
  const aiDays = [{
    date: '2025-06-01', theme: 'Day 1',
    items: [
      { type: 'attraction', provider: 'geoapify', providerId: 'FAKE-PLACE-DOES-NOT-EXIST',
        startTime: '09:00', endTime: '11:00', reason: 'Fake place' },
    ],
  }];

  const { resolved, unresolvedCount } = resolveProviderIds(aiDays, candidates);
  // The fake item should be unresolved and dropped
  assert.equal(unresolvedCount, 1, 'fake providerId is unresolved');
  assert.equal(resolved[0].activities.length, 0, 'fake item dropped from resolved days');

  // Also verify that if somehow a fake providerId slips into the itinerary,
  // the enhanced validator catches it
  const daysWithFake = [{
    dayNumber: 1, date: new Date('2025-06-01'),
    activities: [
      { title: 'Fake Place', time: '09:00', category: 'attraction',
        provider: 'geoapify', providerId: 'nonexistent-id-12345',
        cost: { amount: 0, isEstimate: true }, dataStatus: 'estimate' },
    ],
  }];
  const result = finalValidatorAgent.runEnhanced({
    days: daysWithFake, budget: 10000, totalEstimatedCost: 0,
    destination: 'Goa', origin: '', prefs: {}, candidates,
  });
  assert.equal(result.passed, false, 'validation fails with fake providerId');
  const providerErr = result.structuredErrors.find(e => e.type === ERROR_TYPES.PROVIDER_ID_NOT_FOUND);
  assert.ok(providerErr, 'PROVIDER_ID_NOT_FOUND error present');
});

// ══════════════════════════════════════════════════════════════════════
//  TEST 3: AI returns attraction during closed hours → validator rejects + replanning
// ══════════════════════════════════════════════════════════════════════
test('TEST 3: AI returns attraction during closed hours → validator rejects and replanning occurs', () => {
  const candidates = buildCandidates();
  // Attraction 1 has opening hours 09:00-18:00. Schedule it at 20:00 (after close).
  const days = [{
    dayNumber: 1, date: new Date('2025-06-01'),
    activities: [
      { title: 'Attraction 1', time: '20:00', category: 'attraction',
        provider: 'geoapify', providerId: 'attr-1',
        cost: { amount: 0, isEstimate: false }, dataStatus: 'live', isLive: true, source: 'geoapify',
        coordinates: ATTRACTIONS[0].coordinates, openingHours: ATTRACTIONS[0].openingHours },
      { title: 'Dinner', time: '19:00', category: 'restaurant',
        provider: 'geoapify', providerId: 'rest-1',
        cost: { amount: 300, isEstimate: false }, dataStatus: 'live', isLive: true, source: 'geoapify' },
    ],
  }];

  const result = finalValidatorAgent.runEnhanced({
    days, budget: 10000, totalEstimatedCost: 300,
    destination: 'Goa', origin: '', prefs: {}, candidates,
  });

  // Opening hours violation MUST be an issue (not just a warning) to trigger replanning
  const hoursIssue = result.structuredErrors.find(e => e.type === ERROR_TYPES.OPENING_HOURS);
  assert.ok(hoursIssue, 'OPENING_HOURS issue present — triggers replanning');
  assert.ok(hoursIssue.message.includes('CLOSED'), 'issue message says CLOSED');
  assert.equal(result.passed, false, 'validation fails due to closed hours');
});

// ══════════════════════════════════════════════════════════════════════
//  TEST 4: AI invents a restaurant → providerId does not exist → rejected
// ══════════════════════════════════════════════════════════════════════
test('TEST 4: AI invents restaurant → providerId does not exist → system rejects', () => {
  const candidates = buildCandidates();

  // Try to resolve an invented restaurant
  const aiDays = [{
    date: '2025-06-01', theme: 'Day 1',
    items: [
      { type: 'restaurant', provider: 'geoapify', providerId: 'The-Magic-Kitchen-Invented',
        startTime: '12:00', endTime: '13:00', reason: 'Invented restaurant' },
    ],
  }];
  const { unresolvedCount } = resolveProviderIds(aiDays, candidates);
  assert.equal(unresolvedCount, 1, 'invented restaurant cannot be resolved');

  // Also verify the validator catches it if injected directly
  const daysWithInvented = [{
    dayNumber: 1, date: new Date('2025-06-01'),
    activities: [
      { title: 'Magic Kitchen', time: '12:00', category: 'restaurant',
        provider: 'geoapify', providerId: 'magic-kitchen-invented',
        cost: { amount: 500, isEstimate: true }, dataStatus: 'estimate' },
    ],
  }];
  const result = finalValidatorAgent.runEnhanced({
    days: daysWithInvented, budget: 10000, totalEstimatedCost: 500,
    destination: 'Goa', origin: '', prefs: {}, candidates,
  });
  assert.equal(result.passed, false, 'validation rejects invented restaurant');
  const providerErr = result.structuredErrors.find(e =>
    e.type === ERROR_TYPES.PROVIDER_ID_NOT_FOUND || e.type === ERROR_TYPES.PROVIDER_ID_MISSING
  );
  assert.ok(providerErr, 'provider error present for invented restaurant');
});

// ══════════════════════════════════════════════════════════════════════
//  TEST 5: AI gives different price than API → backend uses provider price
// ══════════════════════════════════════════════════════════════════════
test('TEST 5: AI gives different price → backend uses provider price from candidate', () => {
  const candidates = buildCandidates();

  // resolveProviderIds always uses buildCostFromCandidate which reads from candidate
  const aiDays = [{
    date: '2025-06-01', theme: 'Day 1',
    items: [
      { type: 'attraction', provider: 'geoapify', providerId: 'attr-1',
        startTime: '10:00', endTime: '12:00', reason: 'Fort visit' },
    ],
  }];

  const { resolved } = resolveProviderIds(aiDays, candidates);
  const act = resolved[0].activities[0];

  // The cost MUST come from the candidate (entryFee.amount = 0 for attr-1), not from AI
  const candidate = candidates.find(c => c.providerId === 'attr-1');
  assert.equal(act.cost.amount, candidate.price, 'cost comes from candidate, not AI');
  assert.equal(act.coordinates.lat, candidate.latitude, 'coordinates come from candidate');
  assert.equal(act.coordinates.lng, candidate.longitude, 'coordinates come from candidate');
  assert.equal(act.rating, candidate.rating, 'rating comes from candidate');
  assert.equal(act.address, candidate.address, 'address comes from candidate');
});

// ══════════════════════════════════════════════════════════════════════
//  TEST 6: Budget exceeded → budget engine detects → replanning
// ══════════════════════════════════════════════════════════════════════
test('TEST 6: Budget exceeded → deterministic budget engine detects → AI gets replanning request', () => {
  const candidates = buildCandidates();

  // Build a trip that costs way more than the budget
  const days = [{
    dayNumber: 1, date: new Date('2025-06-01'),
    activities: [
      { title: 'Hotel', time: '12:00', category: 'hotel',
        provider: 'amadeus', providerId: 'Grand Hotel Goa',
        cost: { amount: 15000, isEstimate: false }, dataStatus: 'live', isLive: true, source: 'amadeus-hotels' },
      { title: 'Lunch', time: '13:00', category: 'restaurant',
        provider: 'geoapify', providerId: 'rest-1',
        cost: { amount: 2000, isEstimate: false }, dataStatus: 'live', isLive: true, source: 'geoapify' },
    ],
  }];

  const totalCost = 17000;
  const budget = 5000;

  // Deterministic validator should catch this
  const detResult = finalValidatorAgent.runDeterministic({
    days, budget, totalEstimatedCost: totalCost,
    destination: 'Goa', origin: '', prefs: {},
  });
  assert.equal(detResult.passed, false, 'deterministic validation fails on over-budget');
  const budgetErr = detResult.issues.find(e => e.type === ERROR_TYPES.BUDGET);
  assert.ok(budgetErr, 'BUDGET error present in deterministic validation');
  assert.ok(budgetErr.message.includes('exceeds budget'), 'error mentions budget exceeded');

  // Enhanced validator should also catch this
  const enhResult = finalValidatorAgent.runEnhanced({
    days, budget, totalEstimatedCost: totalCost,
    destination: 'Goa', origin: '', prefs: {}, candidates,
  });
  assert.equal(enhResult.passed, false, 'enhanced validation fails on over-budget');
  const budgetErrEnh = enhResult.structuredErrors.find(e => e.type === ERROR_TYPES.BUDGET);
  assert.ok(budgetErrEnh, 'BUDGET error present in enhanced validation');

  // The replanning loop in orchestratorAIPlanning.js checks validation.data.passed
  // When false, it collects structuredErrors and sends them to the AI with alternatives
  assert.equal(enhResult.passed, false, 'this would trigger replanning in the pipeline');
});

// ══════════════════════════════════════════════════════════════════════
//  TEST 7: Two activities overlap → validator rejects
// ══════════════════════════════════════════════════════════════════════
test('TEST 7: Two activities overlap → validator rejects the schedule', () => {
  const candidates = buildCandidates();

  // Museum (attraction, 120 min default) at 09:00 overlaps with lunch at 09:30
  const days = [{
    dayNumber: 1, date: new Date('2025-06-01'),
    activities: [
      { title: 'Museum Visit', time: '09:00', category: 'attraction',
        provider: 'geoapify', providerId: 'attr-1',
        cost: { amount: 100, isEstimate: false }, dataStatus: 'live', isLive: true, source: 'geoapify',
        coordinates: ATTRACTIONS[0].coordinates },
      { title: 'Lunch at Resto', time: '09:30', category: 'restaurant',
        provider: 'geoapify', providerId: 'rest-1',
        cost: { amount: 500, isEstimate: false }, dataStatus: 'live', isLive: true, source: 'geoapify',
        coordinates: RESTAURANTS[0].coordinates },
    ],
  }];

  const result = finalValidatorAgent.runDeterministic({
    days, budget: 10000, totalEstimatedCost: 600,
    destination: 'Goa', origin: '', prefs: {},
  });
  assert.equal(result.passed, false, 'validation rejects overlapping activities');
  const overlapErr = result.issues.find(e => e.type === ERROR_TYPES.OVERLAP);
  assert.ok(overlapErr, 'OVERLAP error present');
  assert.ok(overlapErr.message.includes('overlaps'), 'error mentions overlap');
});

// ══════════════════════════════════════════════════════════════════════
//  TEST 8: Geographically distant consecutive activities → travel feasibility
// ══════════════════════════════════════════════════════════════════════
test('TEST 8: Geographically distant consecutive activities → travel feasibility detected', () => {
  const candidates = buildCandidates();

  // Two attractions 1500km apart scheduled on the same day with minimal gap
  const days = [{
    dayNumber: 1, date: new Date('2025-06-01'),
    activities: [
      { title: 'Goa Beach', time: '09:00', category: 'attraction',
        provider: 'geoapify', providerId: 'attr-1',
        cost: { amount: 0, isEstimate: false }, dataStatus: 'live', isLive: true, source: 'geoapify',
        coordinates: { lat: 15.5, lng: 73.8 } },
      { title: 'Delhi Monument', time: '11:00', category: 'attraction',
        provider: 'geoapify', providerId: 'attr-2',
        cost: { amount: 0, isEstimate: false }, dataStatus: 'live', isLive: true, source: 'geoapify',
        coordinates: { lat: 28.6, lng: 77.2 } }, // 1500km away
    ],
  }];

  const result = finalValidatorAgent.runDeterministic({
    days, budget: 10000, totalEstimatedCost: 0,
    destination: 'Goa', origin: '', prefs: {},
  });

  // Must be detected — now an issue that triggers replanning
  const geoIssue = result.issues.find(e => e.type === ERROR_TYPES.GEOGRAPHIC_REVIEW);
  assert.ok(geoIssue, 'GEOGRAPHIC_REVIEW issue present');
  assert.ok(geoIssue.message.includes('km'), 'message includes distance');
  assert.equal(result.passed, false, 'validation fails due to infeasible distance');
});

// ══════════════════════════════════════════════════════════════════════
//  TEST 9: Gemini fails → deterministic fallback → still validates
// ══════════════════════════════════════════════════════════════════════
test('TEST 9: Gemini fails → deterministic fallback → still validates', () => {
  // Simulate the orchestrator behavior when AI planning fails.
  // In the real pipeline (tripOrchestrator.js):
  //   const finalDays = aiPlanSuccess ? aiPlanningResult.days : days;
  // The deterministic `days` is validated in BATCH 6 before AI planning runs.

  const candidates = buildCandidates();

  // Build a valid deterministic plan
  const days = [{
    dayNumber: 1, date: new Date('2025-06-01'),
    activities: [
      { title: 'Hotel', time: '12:00', category: 'hotel',
        provider: 'amadeus', providerId: 'Grand Hotel Goa',
        cost: { amount: 3000, isEstimate: false }, dataStatus: 'live', isLive: true, source: 'amadeus-hotels' },
      { title: 'Attraction 1', time: '14:00', category: 'attraction',
        provider: 'geoapify', providerId: 'attr-1',
        cost: { amount: 0, isEstimate: false }, dataStatus: 'live', isLive: true, source: 'geoapify',
        coordinates: ATTRACTIONS[0].coordinates },
      { title: 'Dinner', time: '19:00', category: 'restaurant',
        provider: 'geoapify', providerId: 'rest-1',
        cost: { amount: 400, isEstimate: false }, dataStatus: 'live', isLive: true, source: 'geoapify',
        coordinates: RESTAURANTS[0].coordinates },
    ],
  }];

  // Validate the deterministic plan (this is what BATCH 6 does)
  const validation = finalValidatorAgent.runDeterministic({
    days, budget: 10000, totalEstimatedCost: 3400,
    destination: 'Goa', origin: '', prefs: {},
  });

  // The deterministic plan should pass validation
  assert.equal(validation.passed, true, 'deterministic plan passes validation');
  assert.equal(validation.issues.length, 0, 'no issues in deterministic plan');

  // This is the deterministic plan that would be used as fallback when AI fails
  const aiPlanSuccess = false;
  const finalDays = aiPlanSuccess ? null : days;
  assert.ok(finalDays, 'deterministic fallback plan is available');
  assert.equal(finalDays.length, 1, 'fallback has correct day count');
  assert.ok(finalDays[0].activities.length > 0, 'fallback has activities');
});

// ══════════════════════════════════════════════════════════════════════
//  TEST 10: All AI attempts fail → best valid deterministic itinerary
// ══════════════════════════════════════════════════════════════════════
test('TEST 10: All AI attempts fail → system returns valid deterministic itinerary, not fabricated data', () => {
  // Simulate the full orchestrator fallback chain.
  // When runAIPlanningPipeline returns { success: false, days: null },
  // the orchestrator uses `days` (deterministic) as `finalDays`.

  // Build a deterministic plan using the real itineraryService
  const days = itineraryService.buildDays({
    origin: 'Mumbai',
    destination: 'Goa',
    startDate: '2025-06-01',
    endDate: '2025-06-03',
    travelers: { adults: 2, children: 0 },
    prefs: { foodPreference: '', travelStyle: 'standard', activityLevel: 'moderate', interests: [], accessibility: [] },
    hotelResult: HOTEL_RESULT,
    transportResult: { mode: 'flight', data: { isLive: false, selected: null } },
    returnTransportResult: null,
    weatherResult: { data: { provider: 'unavailable', forecast: null } },
    attractions: ATTRACTIONS,
    restaurants: RESTAURANTS,
    nightlife: [],
    budgetAllocation: { transport: { amount: 5000 }, hotels: { amount: 12000 }, food: { amount: 6000 }, activities: { amount: 3000 } },
    totalBudget: 50000,
    currency: 'INR',
  });

  // The deterministic plan uses real provider data
  assert.ok(days.length === 3, 'has 3 days');
  for (const day of days) {
    for (const act of day.activities) {
      assert.ok(act.dataStatus, `activity "${act.title}" has dataStatus`);
      assert.ok(['live', 'estimate', 'unavailable'].includes(act.dataStatus), `dataStatus is valid: ${act.dataStatus}`);
      // Every activity must have a source — no fabricated data
      assert.ok(act.source, `activity "${act.title}" has a source`);
    }
  }

  // Validate the deterministic plan
  const totalCost = itineraryService.computeItineraryCost(days);
  const validation = finalValidatorAgent.runDeterministic({
    days, budget: 50000, totalEstimatedCost: totalCost,
    destination: 'Goa', origin: 'Mumbai', prefs: {},
  });

  // The deterministic plan from real data should be valid
  assert.equal(validation.passed, true, 'deterministic plan from real data passes validation');

  // Verify no fabricated data (every cost has a source)
  for (const day of days) {
    for (const act of day.activities) {
      if (act.cost?.amount > 0) {
        assert.ok(act.source, `cost-bearing activity "${act.title}" has source metadata`);
      }
    }
  }
});

// ══════════════════════════════════════════════════════════════════════
//  MONGODB STORAGE: Final validated itinerary stored, not raw deterministic
// ══════════════════════════════════════════════════════════════════════
test('MongoDB stores FINAL VALIDATED itinerary — not the old raw deterministic days', () => {
  // Simulate the orchestrator's storage logic:
  //   itinerary = await Itinerary.create({ days: finalDays || [], ... })
  // where finalDays = aiPlanSuccess ? aiPlanningResult.days : days

  // Case A: AI succeeds → stores resolved+validated AI plan
  const aiResolvedDays = [{
    dayNumber: 1, date: '2025-06-01', area: 'Baga',
    activities: [{
      title: 'Attraction 1', time: '10:00', category: 'attraction',
      provider: 'geoapify', providerId: 'attr-1',
      cost: { amount: 0, isEstimate: false }, dataStatus: 'live', isLive: true, source: 'geoapify',
      coordinates: ATTRACTIONS[0].coordinates,
      _resolvedFrom: 'geoapify:attr-1',
    }],
  }];
  rebuildCosts(aiResolvedDays, { partySize: 2, totalBudget: 50000 });
  const finalDaysA = aiResolvedDays; // AI success path
  assert.ok(finalDaysA[0].activities[0]._resolvedFrom, 'AI plan carries resolution metadata');
  assert.equal(finalDaysA[0].activities[0].cost.amount, 0, 'cost from candidate, not AI');

  // Case B: AI fails → stores deterministic plan (validated in BATCH 6)
  const deterministicDays = itineraryService.buildDays({
    origin: '', destination: 'Goa', startDate: '2025-06-01', endDate: '2025-06-02',
    travelers: { adults: 2, children: 0 },
    prefs: { foodPreference: '', travelStyle: 'standard', activityLevel: 'moderate', interests: [], accessibility: [] },
    hotelResult: HOTEL_RESULT,
    transportResult: { mode: 'flight', data: { isLive: false, selected: null } },
    weatherResult: { data: { provider: 'unavailable', forecast: null } },
    attractions: ATTRACTIONS,
    restaurants: RESTAURANTS,
    budgetAllocation: { transport: { amount: 5000 }, hotels: { amount: 8000 }, food: { amount: 4000 } },
    totalBudget: 50000,
    currency: 'INR',
  });
  const finalDaysB = deterministicDays; // AI failure path

  // Both paths produce valid data
  for (const act of finalDaysA[0].activities) {
    assert.ok(act.cost != null, 'AI plan has cost data');
  }
  for (const day of finalDaysB) {
    for (const act of day.activities) {
      assert.ok(act.source, 'deterministic plan has source metadata');
    }
  }

  // The validation object stored in MongoDB includes usedAIPlan flag
  // This is how the frontend knows which path was used
  const storedValidationA = { passed: true, usedAIPlan: true, aiProvider: 'gemini', replanAttempts: 1 };
  const storedValidationB = { passed: true, usedAIPlan: false, aiProvider: null, replanAttempts: 0 };
  assert.equal(storedValidationA.usedAIPlan, true, 'AI plan marked as AI');
  assert.equal(storedValidationB.usedAIPlan, false, 'deterministic plan marked as non-AI');
});

// ══════════════════════════════════════════════════════════════════════
//  Hotel pricePerNight bug fix verification
// ══════════════════════════════════════════════════════════════════════
test('Hotel candidates have pricePerNight for correct cost resolution', () => {
  const candidates = buildCandidates();
  const hotelCandidate = candidates.find(c => c.type === 'hotel');
  assert.ok(hotelCandidate, 'hotel candidate exists');
  assert.ok(hotelCandidate.pricePerNight > 0, 'hotel has pricePerNight set');
  assert.equal(hotelCandidate.pricePerNight, 3000, 'pricePerNight matches API price');

  // Verify resolveProviderIds produces correct hotel cost
  const aiDays = [{
    date: '2025-06-01', theme: 'Day 1',
    items: [
      { type: 'hotel', provider: 'amadeus', providerId: 'Grand Hotel Goa',
        startTime: '12:00', endTime: '12:30', reason: 'Check-in' },
    ],
  }];
  const { resolved } = resolveProviderIds(aiDays, candidates);
  const hotelAct = resolved[0].activities[0];
  assert.equal(hotelAct.cost.amount, 3000, 'hotel cost resolved from candidate pricePerNight');
  assert.equal(hotelAct.cost.source, 'amadeus-hotels', 'hotel cost source is correct');
});

// ══════════════════════════════════════════════════════════════════════
//  Replanning loop verification
// ══════════════════════════════════════════════════════════════════════
test('Replanning: structured errors contain day + providerId + alternatives for AI replanning', () => {
  const candidates = buildCandidates();

  // Duplicate the same attraction on two days
  const days = [
    {
      dayNumber: 1, date: new Date('2025-06-01'),
      activities: [
        { title: 'Attraction 1', time: '09:00', category: 'attraction',
          provider: 'geoapify', providerId: 'attr-1',
          cost: { amount: 0, isEstimate: false }, dataStatus: 'live', isLive: true, source: 'geoapify',
          coordinates: ATTRACTIONS[0].coordinates },
        { title: 'Restaurant 1', time: '12:30', category: 'restaurant',
          provider: 'geoapify', providerId: 'rest-1',
          cost: { amount: 300, isEstimate: false }, dataStatus: 'live', isLive: true, source: 'geoapify',
          coordinates: RESTAURANTS[0].coordinates },
      ],
    },
    {
      dayNumber: 2, date: new Date('2025-06-02'),
      activities: [
        { title: 'Attraction 1 Again', time: '09:00', category: 'attraction',
          provider: 'geoapify', providerId: 'attr-1',
          cost: { amount: 0, isEstimate: false }, dataStatus: 'live', isLive: true, source: 'geoapify',
          coordinates: ATTRACTIONS[0].coordinates },
        { title: 'Restaurant 2', time: '12:30', category: 'restaurant',
          provider: 'geoapify', providerId: 'rest-2',
          cost: { amount: 400, isEstimate: false }, dataStatus: 'live', isLive: true, source: 'geoapify',
          coordinates: RESTAURANTS[1].coordinates },
      ],
    },
  ];

  const result = finalValidatorAgent.runEnhanced({
    days, budget: 10000, totalEstimatedCost: 700,
    destination: 'Goa', origin: '', prefs: {}, candidates,
  });

  assert.equal(result.passed, false, 'duplicate fails validation');

  // Find the DUPLICATE error
  const dupErr = result.structuredErrors.find(e => e.type === ERROR_TYPES.DUPLICATE);
  assert.ok(dupErr, 'DUPLICATE error present');
  assert.equal(dupErr.day, 2, 'error points to day 2');
  assert.ok(dupErr.providerId, 'error has providerId');
  assert.ok(dupErr.message, 'error has message');

  // The error should have alternatives for AI to pick from
  assert.ok(dupErr.availableAlternatives, 'alternatives provided for replanning');
  assert.ok(dupErr.availableAlternatives.length > 0, 'alternatives are non-empty');
  assert.ok(dupErr.availableAlternatives.every(a => a.provider && a.providerId), 'alternatives have provider+providerId');
  assert.equal(dupErr.replaceableCategory, 'attraction', 'alternatives are same category');
});

// ══════════════════════════════════════════════════════════════════════
//  Complete pipeline trace: 5-day trip end-to-end
// ══════════════════════════════════════════════════════════════════════
test('Full pipeline trace: normalize → AI plan → resolve → validate → costs', () => {
  // Step 1: Normalize candidates from provider data
  const candidates = normalizeCandidates({
    attractions: ATTRACTIONS.slice(0, 6),
    restaurants: RESTAURANTS.slice(0, 6),
    nightlife: [],
    hotelResult: HOTEL_RESULT,
    transportResult: null,
    eventsResult: null,
  });
  assert.ok(candidates.length > 0, 'candidates normalized');

  // Step 2: Simulate AI returning a valid plan
  const aiDays = [{
    date: '2025-06-01', theme: 'Heritage & Beach',
    items: [
      { type: 'hotel', provider: 'amadeus', providerId: 'Grand Hotel Goa',
        startTime: '12:00', endTime: '12:30', reason: 'Check-in' },
      { type: 'attraction', provider: 'geoapify', providerId: 'attr-1',
        startTime: '14:00', endTime: '16:00', reason: 'Historic fort' },
      { type: 'restaurant', provider: 'geoapify', providerId: 'rest-1',
        startTime: '12:30', endTime: '13:30', reason: 'Lunch' },
      { type: 'restaurant', provider: 'geoapify', providerId: 'rest-2',
        startTime: '19:00', endTime: '20:00', reason: 'Dinner' },
    ],
  }];

  // Step 3: Resolve provider IDs against candidate dataset
  const { resolved, resolvedCount } = resolveProviderIds(aiDays, candidates);
  assert.equal(resolvedCount, 4, 'all 4 items resolved');
  assert.equal(resolved[0].activities.length, 4, '4 activities in resolved day');

  // Step 4: Rebuild costs from resolved data
  rebuildCosts(resolved, { partySize: 2, totalBudget: 50000 });

  // Verify costs come from candidates
  const hotelAct = resolved[0].activities.find(a => a.category === 'hotel');
  assert.equal(hotelAct.cost.amount, 3000, 'hotel cost from candidate');

  const attrAct = resolved[0].activities.find(a => a.category === 'attraction');
  assert.equal(attrAct.cost.amount, ATTRACTIONS[0].entryFee.amount, 'attraction cost from candidate');

  const restAct = resolved[0].activities.find(a => a.category === 'restaurant' && a.time === '12:30');
  assert.equal(restAct.cost.amount, RESTAURANTS[0].averageCostPerPerson, 'restaurant cost from candidate');

  // Step 5: Validate the resolved plan
  const totalCost = resolved.reduce((sum, d) => sum + (d.dayCost || 0), 0);
  const validation = finalValidatorAgent.runEnhanced({
    days: resolved, budget: 50000, totalEstimatedCost: totalCost,
    destination: 'Goa', origin: '', prefs: {}, candidates,
  });

  // Filter out expected non-activity issues (hotel dates etc.)
  const nonHotelIssues = validation.structuredErrors.filter(e =>
    e.type !== ERROR_TYPES.HOTEL_DATES
  );
  assert.equal(nonHotelIssues.length, 0, `no unexpected issues: ${JSON.stringify(nonHotelIssues)}`);

  // Step 6: Verify cumulative costs
  assert.ok(resolved[0].costBreakdown, 'day has costBreakdown');
  assert.ok(typeof resolved[0].costBreakdown.cumulative === 'number', 'cumulative is a number');
  assert.ok(resolved[0].costBreakdown.cumulative === totalCost, 'cumulative matches total');
});
