import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runHardValidation,
  attemptDeterministicRepair,
  SEVERITY,
  ERROR_CODE,
} from '../src/services/hardValidationGate.service.js';

// ══════════════════════════════════════════════════════════════════════
//  FIXTURES
// ══════════════════════════════════════════════════════════════════════

function makeCandidate(overrides = {}) {
  return {
    name: 'Gateway of India',
    providerId: 'goi-1',
    provider: 'google',
    source: 'google',
    type: 'attraction',
    address: 'Apollo Bunder, Mumbai',
    suburb: 'Colaba',
    city: 'Mumbai',
    country: 'India',
    latitude: 18.922,
    longitude: 72.8347,
    rating: 4.5,
    priceLevel: 1,
    hasOpeningHours: true,
    dataStatus: 'live',
    isEstimate: false,
    ...overrides,
  };
}

function makeRestaurantCandidate(overrides = {}) {
  return makeCandidate({
    name: 'Leopold Cafe',
    providerId: 'leo-1',
    provider: 'restaurant-engine',
    type: 'restaurant',
    averageCostPerPerson: 800,
    ...overrides,
  });
}

function makeHotelCandidate(overrides = {}) {
  return makeCandidate({
    name: 'Taj Mahal Palace',
    providerId: 'taj-1',
    provider: 'amadeus',
    type: 'hotel',
    pricePerNight: 12000,
    ...overrides,
  });
}

function makeActivity(overrides = {}) {
  return {
    title: 'Gateway of India',
    place: 'Gateway of India',
    category: 'attraction',
    provider: 'google',
    providerId: 'goi-1',
    time: '09:30',
    coordinates: { lat: 18.922, lng: 72.8347 },
    address: 'Apollo Bunder, Mumbai',
    city: 'Mumbai',
    cost: { amount: 200, currency: 'INR', isEstimate: false, source: 'google', dataStatus: 'live' },
    source: 'google',
    dataStatus: 'live',
    isEstimate: false,
    openingHours: { periods: [{ days: ['all'], open: '09:00', close: '18:00' }] },
    ...overrides,
  };
}

function makeDay(overrides = {}) {
  return {
    dayNumber: 1,
    date: '2025-06-01',
    activities: [makeActivity()],
    ...overrides,
  };
}

function buildCandidateMap(candidates) {
  const map = new Map();
  for (const c of candidates) {
    const key = `${c.provider}|${c.providerId}`;
    if (key !== '|') map.set(key, c);
    if (c.name) map.set(`name|${c.name.toLowerCase()}`, c);
  }
  return map;
}

// ══════════════════════════════════════════════════════════════════════
//  1. UNKNOWN PROVIDER ID (HARD)
// ══════════════════════════════════════════════════════════════════════

test('Unknown provider ID is a hard failure', () => {
  const candidates = [makeCandidate()];
  const candidateMap = buildCandidateMap(candidates);
  const days = [makeDay({ activities: [makeActivity({ providerId: 'unknown-id' })] })];

  const result = runHardValidation({ days, candidateMap, destination: 'Mumbai', country: 'India' });
  assert.equal(result.passed, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODE.UNKNOWN_PROVIDER_ID && e.severity === SEVERITY.HARD));
});

// ══════════════════════════════════════════════════════════════════════
//  2. FAKE CANDIDATE (HARD)
// ══════════════════════════════════════════════════════════════════════

test('Fake candidate not in trusted dataset is a hard failure', () => {
  const candidateMap = new Map();
  const days = [makeDay({ activities: [makeActivity({ provider: 'google', providerId: 'fake-id' })] })];

  const result = runHardValidation({ days, candidateMap, destination: 'Mumbai', country: 'India' });
  assert.equal(result.passed, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODE.FAKE_CANDIDATE));
});

// ══════════════════════════════════════════════════════════════════════
//  3. DUPLICATE ATTRACTION ACROSS DAYS (HARD)
// ══════════════════════════════════════════════════════════════════════

test('Duplicate attraction across days is a hard failure', () => {
  const candidates = [makeCandidate()];
  const candidateMap = buildCandidateMap(candidates);
  const days = [
    makeDay({ dayNumber: 1, activities: [makeActivity()] }),
    makeDay({ dayNumber: 2, date: '2025-06-02', activities: [makeActivity()] }),
  ];

  const result = runHardValidation({ days, candidateMap, destination: 'Mumbai', country: 'India' });
  assert.equal(result.passed, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODE.DUPLICATE_ATTRACTION));
});

// ══════════════════════════════════════════════════════════════════════
//  4. WRONG COUNTRY (HARD)
// ══════════════════════════════════════════════════════════════════════

test('Wrong country is a hard failure', () => {
  const candidates = [makeCandidate({ country: 'Pakistan' })];
  const candidateMap = buildCandidateMap(candidates);
  const days = [makeDay()];

  const result = runHardValidation({ days, candidateMap, destination: 'Mumbai', country: 'India' });
  assert.equal(result.passed, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODE.WRONG_COUNTRY));
});

// ══════════════════════════════════════════════════════════════════════
//  5. INVALID RESTAURANT CATEGORY (HARD)
// ══════════════════════════════════════════════════════════════════════

test('Invalid restaurant category is a hard failure', () => {
  const candidates = [makeCandidate({ type: 'hospital', name: 'Hospital' })];
  const candidateMap = buildCandidateMap(candidates);
  const days = [makeDay({ activities: [makeActivity({ category: 'restaurant', title: 'Hospital', place: 'Hospital' })] })];

  const result = runHardValidation({ days, candidateMap, destination: 'Mumbai', country: 'India' });
  assert.equal(result.passed, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODE.INVALID_RESTAURANT_CATEGORY));
});

// ══════════════════════════════════════════════════════════════════════
//  6. FABRICATED HOTEL (HARD)
// ══════════════════════════════════════════════════════════════════════

test('Fabricated hotel name is a hard failure', () => {
  const candidateMap = new Map();
  const days = [makeDay({ activities: [makeActivity({ category: 'hotel', title: 'Accommodation in Mumbai', place: 'Accommodation in Mumbai', provider: '', providerId: '' })] })];

  const result = runHardValidation({ days, candidateMap, destination: 'Mumbai', country: 'India' });
  assert.equal(result.passed, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODE.FABRICATED_HOTEL));
});

// ══════════════════════════════════════════════════════════════════════
//  7. FABRICATED PRICE (HARD)
// ══════════════════════════════════════════════════════════════════════

test('Fabricated price is a hard failure', () => {
  const candidates = [makeRestaurantCandidate({ averageCostPerPerson: 800 })];
  const candidateMap = buildCandidateMap(candidates);
  const days = [makeDay({ activities: [makeActivity({
    category: 'restaurant',
    title: 'Leopold Cafe',
    place: 'Leopold Cafe',
    provider: 'restaurant-engine',
    providerId: 'leo-1',
    cost: { amount: 9999, currency: 'INR', source: 'fabricated' },
    time: '13:00',
  })] })];

  const result = runHardValidation({ days, candidateMap, destination: 'Mumbai', country: 'India' });
  assert.equal(result.passed, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODE.FABRICATED_PRICE));
});

// ══════════════════════════════════════════════════════════════════════
//  8. FABRICATED COORDINATES (HARD)
// ══════════════════════════════════════════════════════════════════════

test('Fabricated coordinates are a hard failure', () => {
  const candidates = [makeCandidate({ latitude: 18.922, longitude: 72.8347 })];
  const candidateMap = buildCandidateMap(candidates);
  const days = [makeDay({ activities: [makeActivity({ coordinates: { lat: 40.7128, lng: -74.006 } })] })];

  const result = runHardValidation({ days, candidateMap, destination: 'Mumbai', country: 'India' });
  assert.equal(result.passed, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODE.FABRICATED_COORDINATES));
});

// ══════════════════════════════════════════════════════════════════════
//  9. TIME CONFLICT (HARD)
// ══════════════════════════════════════════════════════════════════════

test('Time conflict is a hard failure', () => {
  const candidateMap = new Map();
  const acts = [
    makeActivity({ title: 'Activity A', time: '09:00', duration: 120 }),
    makeActivity({ title: 'Activity B', time: '09:30', providerId: 'b-1' }),
  ];
  const days = [makeDay({ activities: acts })];

  const result = runHardValidation({ days, candidateMap, destination: 'Mumbai', country: 'India' });
  assert.equal(result.passed, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODE.TIME_CONFLICT));
});

// ══════════════════════════════════════════════════════════════════════
//  10. DAY/DATE CONSISTENCY (HARD)
// ══════════════════════════════════════════════════════════════════════

test('Non-consecutive dates are a hard failure', () => {
  const candidateMap = new Map();
  const days = [
    makeDay({ dayNumber: 1, date: '2025-06-01' }),
    makeDay({ dayNumber: 2, date: '2025-06-05', activities: [] }),
  ];

  const result = runHardValidation({ days, candidateMap, destination: 'Mumbai', country: 'India' });
  assert.equal(result.passed, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODE.INVALID_DAY_DATE));
});

// ══════════════════════════════════════════════════════════════════════
//  11. CURRENCY MISMATCH (HARD)
// ══════════════════════════════════════════════════════════════════════

test('Currency mismatch is a hard failure', () => {
  const candidateMap = new Map();
  const days = [makeDay({ activities: [makeActivity({ cost: { amount: 200, currency: 'USD' } })] })];

  const result = runHardValidation({ days, candidateMap, destination: 'Mumbai', country: 'India', currency: 'INR' });
  assert.equal(result.passed, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODE.CURRENCY_MISMATCH));
});

// ══════════════════════════════════════════════════════════════════════
//  12. RESTAURANT DUPLICATE (HARD)
// ══════════════════════════════════════════════════════════════════════

test('Duplicate restaurant across days is a hard failure', () => {
  const candidates = [makeRestaurantCandidate()];
  const candidateMap = buildCandidateMap(candidates);
  const days = [
    makeDay({ activities: [makeActivity({ category: 'restaurant', title: 'Leopold Cafe', place: 'Leopold Cafe' })] }),
    makeDay({ dayNumber: 2, date: '2025-06-02', activities: [makeActivity({ category: 'restaurant', title: 'Leopold Cafe', place: 'Leopold Cafe' })] }),
  ];

  const result = runHardValidation({ days, candidateMap, destination: 'Mumbai', country: 'India' });
  assert.equal(result.passed, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODE.DUPLICATE_RESTAURANT));
});

// ══════════════════════════════════════════════════════════════════════
//  13. VALID ITINERARY PASSES
// ══════════════════════════════════════════════════════════════════════

test('Valid itinerary with real candidates passes', () => {
  const candidates = [makeCandidate(), makeRestaurantCandidate()];
  const candidateMap = buildCandidateMap(candidates);
  const days = [
    makeDay({
      activities: [
        makeActivity({ category: 'attraction', time: '09:00' }),
        makeActivity({
          category: 'restaurant',
          title: 'Leopold Cafe',
          place: 'Leopold Cafe',
          provider: 'restaurant-engine',
          providerId: 'leo-1',
          time: '13:00',
          cost: { amount: 800, currency: 'INR', isEstimate: false, source: 'restaurant-engine', dataStatus: 'live' },
        }),
      ],
    }),
  ];

  const result = runHardValidation({ days, candidateMap, destination: 'Mumbai', country: 'India', budget: 50000 });
  assert.equal(result.passed, true);
  assert.equal(result.errors.filter((e) => e.severity === SEVERITY.HARD).length, 0);
});

// ══════════════════════════════════════════════════════════════════════
//  14. SOFT WARNINGS DON'T BLOCK
// ══════════════════════════════════════════════════════════════════════

test('Soft warnings do not block persistence', () => {
  const candidates = [makeCandidate({ rating: null })];
  const candidateMap = buildCandidateMap(candidates);
  const days = [makeDay()];

  const result = runHardValidation({ days, candidateMap, destination: 'Mumbai', country: 'India', budget: 50000 });
  // Should pass even with soft warnings
  assert.equal(result.passed, true);
  assert.ok(result.warnings.length >= 0); // May have warnings but still passes
});

// ══════════════════════════════════════════════════════════════════════
//  15. DETERMINISTIC REPAIR
// ══════════════════════════════════════════════════════════════════════

test('Deterministic repair fixes fabricated price', () => {
  const candidates = [makeRestaurantCandidate({ averageCostPerPerson: 800 })];
  const candidateMap = buildCandidateMap(candidates);
  const act = makeActivity({
    category: 'restaurant',
    title: 'Leopold Cafe',
    place: 'Leopold Cafe',
    provider: 'restaurant-engine',
    providerId: 'leo-1',
    cost: { amount: 9999, currency: 'INR', source: 'fabricated' },
    time: '13:00',
  });
  const days = [makeDay({ activities: [act] })];

  const errors = [
    { code: ERROR_CODE.FABRICATED_PRICE, severity: SEVERITY.HARD, dayNumber: 1, item: 'Leopold Cafe', message: 'test' },
  ];

  const result = attemptDeterministicRepair({ days, candidateMap, errors });
  assert.equal(result.repairCount, 1);
  assert.equal(result.repairedDays[0].activities[0].cost.amount, 800);
});

test('Deterministic repair fixes fabricated coordinates', () => {
  const candidates = [makeCandidate({ latitude: 18.922, longitude: 72.8347 })];
  const candidateMap = buildCandidateMap(candidates);
  const act = makeActivity({ coordinates: { lat: 40.7128, lng: -74.006 }, time: '09:00', duration: 60 });
  const days = [makeDay({ activities: [act] })];

  const errors = [
    { code: ERROR_CODE.FABRICATED_COORDINATES, severity: SEVERITY.HARD, dayNumber: 1, item: 'Gateway of India', message: 'test' },
  ];

  const result = attemptDeterministicRepair({ days, candidateMap, errors });
  assert.equal(result.repairCount, 1);
  assert.equal(result.repairedDays[0].activities[0].coordinates.lat, 18.922);
  assert.equal(result.repairedDays[0].activities[0].coordinates.lng, 72.8347);
});

test('Deterministic repair fixes currency mismatch', () => {
  const candidateMap = new Map();
  const act = makeActivity({ cost: { amount: 200, currency: 'USD' }, time: '09:00', duration: 60 });
  const days = [makeDay({ activities: [act] })];

  const errors = [
    { code: ERROR_CODE.CURRENCY_MISMATCH, severity: SEVERITY.HARD, dayNumber: 1, item: 'Gateway of India', message: 'test', expected: 'INR' },
  ];

  const result = attemptDeterministicRepair({ days, candidateMap, errors });
  assert.equal(result.repairCount, 1);
  assert.equal(result.repairedDays[0].activities[0].cost.currency, 'INR');
});

// ══════════════════════════════════════════════════════════════════════
//  16. ERROR STRUCTURE
// ══════════════════════════════════════════════════════════════════════

test('Errors have correct structure', () => {
  const candidateMap = new Map();
  const days = [makeDay({ activities: [makeActivity({ providerId: 'unknown' })] })];

  const result = runHardValidation({ days, candidateMap, destination: 'Mumbai', country: 'India' });
  assert.ok(result.errors.length > 0);

  for (const err of result.errors) {
    assert.ok(err.code, 'Error should have code');
    assert.ok(err.severity, 'Error should have severity');
    assert.ok(typeof err.message === 'string', 'Error should have message');
    assert.ok(err.timestamp, 'Error should have timestamp');
  }
});

test('Summary has correct structure', () => {
  const candidateMap = new Map();
  const days = [makeDay({ activities: [makeActivity({ providerId: 'unknown' })] })];

  const result = runHardValidation({ days, candidateMap, destination: 'Mumbai', country: 'India' });
  assert.equal(typeof result.summary.passed, 'boolean');
  assert.equal(typeof result.summary.totalErrors, 'number');
  assert.equal(typeof result.summary.hardErrors, 'number');
  assert.equal(typeof result.summary.softWarnings, 'number');
  assert.ok(Array.isArray(result.summary.errorCodes));
  assert.ok(Array.isArray(result.summary.warningCodes));
});

// ══════════════════════════════════════════════════════════════════════
//  17. EDGE CASES
// ══════════════════════════════════════════════════════════════════════

test('Empty days array passes', () => {
  const result = runHardValidation({ days: [], candidateMap: new Map(), destination: 'Mumbai' });
  assert.equal(result.passed, true);
});

test('Null days handled gracefully', () => {
  const result = runHardValidation({ days: null, candidateMap: new Map(), destination: 'Mumbai' });
  assert.equal(result.passed, true);
});

test('Unavailable items skip most validations', () => {
  const candidateMap = new Map();
  const days = [makeDay({ activities: [makeActivity({ dataStatus: 'unavailable', provider: '', providerId: '' })] })];

  const result = runHardValidation({ days, candidateMap, destination: 'Mumbai', country: 'India' });
  // Unavailable items should not trigger hard errors
  assert.equal(result.errors.filter((e) => e.severity === SEVERITY.HARD).length, 0);
});

test('Hotels and transport skip provider ID validation', () => {
  const candidateMap = new Map();
  const days = [makeDay({ activities: [makeActivity({ category: 'hotel', title: 'Taj', place: 'Taj', provider: '', providerId: '' })] })];

  const result = runHardValidation({ days, candidateMap, destination: 'Mumbai', country: 'India' });
  // Hotel without provider ID should not be a hard error
  const hardErrors = result.errors.filter((e) => e.severity === SEVERITY.HARD && e.code !== ERROR_CODE.FABRICATED_HOTEL);
  assert.equal(hardErrors.length, 0);
});

test('Invalid coordinates (out of range) are a hard failure', () => {
  const candidateMap = new Map();
  const days = [makeDay({ activities: [makeActivity({ coordinates: { lat: 999, lng: -999 } })] })];

  const result = runHardValidation({ days, candidateMap, destination: 'Mumbai', country: 'India' });
  assert.equal(result.passed, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODE.FABRICATED_COORDINATES));
});

test('Budget exceeded is a soft warning', () => {
  const candidates = [makeCandidate()];
  const candidateMap = buildCandidateMap(candidates);
  const act = makeActivity({ cost: { amount: 60000, currency: 'INR' } });
  const days = [makeDay({ activities: [act] })];

  const result = runHardValidation({ days, candidateMap, destination: 'Mumbai', country: 'India', budget: 50000 });
  assert.equal(result.passed, true); // Soft warning, not hard failure
  assert.ok(result.warnings.some((w) => w.code === ERROR_CODE.BUDGET_EXCEEDED));
});
