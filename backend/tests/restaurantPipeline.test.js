import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateRestaurantCandidate,
  normalizeRestaurant,
  runRestaurantPipeline,
  getPipelineSummary,
  KNOWN_RESTAURANT_PROVIDERS,
  VALID_RESTAURANT_CATEGORY_PREFIXES,
  NON_RESTAURANT_PATTERNS,
} from '../src/services/restaurantCandidatePipeline.service.js';

// ══════════════════════════════════════════════════════════════════════
//  HELPER: Build a valid restaurant candidate fixture
// ══════════════════════════════════════════════════════════════════════

function makeValidRestaurant(overrides = {}) {
  return {
    name: 'Leopold Cafe',
    providerId: '87654321',
    provider: 'google',
    source: 'google',
    types: ['catering.restaurant', 'catering.cafe'],
    categories: ['catering.restaurant', 'catering.cafe'],
    address: 'Colaba Causeway, Mumbai, Maharashtra, India',
    city: 'Mumbai',
    country: 'India',
    latitude: 18.9154,
    longitude: 72.8264,
    rating: 4.2,
    reviewCount: 3200,
    cuisines: ['Indian', 'Continental'],
    openingHours: { periods: [{ days: ['all'], open: '07:30', close: '23:30' }] },
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════════
//  1. HOSPITAL REJECTED
// ══════════════════════════════════════════════════════════════════════

test('Hospital candidate is rejected as restaurant', () => {
  const c = makeValidRestaurant({ name: 'Breach Candy Hospital', types: ['healthcare.hospital'] });
  const result = validateRestaurantCandidate(c);
  assert.equal(result.valid, false, 'Hospital should be rejected');
  assert.ok(result.rejection.includes('hospital') || result.rejection.includes('category') || result.rejection.includes('medical'));
});

test('Medical center is rejected as restaurant', () => {
  const c = makeValidRestaurant({ name: 'Apollo Medical Center', types: ['healthcare.hospital'] });
  const result = validateRestaurantCandidate(c);
  assert.equal(result.valid, false, 'Medical center should be rejected');
});

// ══════════════════════════════════════════════════════════════════════
//  2. SPA REJECTED
// ══════════════════════════════════════════════════════════════════════

test('Spa candidate is rejected as restaurant', () => {
  const c = makeValidRestaurant({ name: 'Oasis Day Spa', types: ['commercial.service'] });
  const result = validateRestaurantCandidate(c);
  assert.equal(result.valid, false, 'Spa should be rejected');
  assert.ok(result.rejection.includes('spa') || result.rejection.includes('wellness'));
});

test('Massage parlor is rejected as restaurant', () => {
  const c = makeValidRestaurant({ name: 'Royal Thai Massage', types: ['commercial.service'] });
  const result = validateRestaurantCandidate(c);
  assert.equal(result.valid, false, 'Massage parlor should be rejected');
});

// ══════════════════════════════════════════════════════════════════════
//  3. VALID RESTAURANT ACCEPTED
// ══════════════════════════════════════════════════════════════════════

test('Valid restaurant with catering type is accepted', () => {
  const c = makeValidRestaurant();
  const result = validateRestaurantCandidate(c);
  assert.equal(result.valid, true, `Restaurant should be accepted (got rejection: ${result.rejection})`);
});

test('Valid restaurant with cafe type is accepted', () => {
  const c = makeValidRestaurant({ name: 'Cafe Leopold', types: ['catering.cafe'] });
  const result = validateRestaurantCandidate(c);
  assert.equal(result.valid, true, 'Cafe should be accepted');
});

test('Valid restaurant with fast_food type is accepted', () => {
  const c = makeValidRestaurant({ name: 'McDonalds Colaba', types: ['catering.fast_food'] });
  const result = validateRestaurantCandidate(c);
  assert.equal(result.valid, true, 'Fast food should be accepted');
});

// ══════════════════════════════════════════════════════════════════════
//  4. UNRELATED BUSINESS REJECTED
// ══════════════════════════════════════════════════════════════════════

test('Building/office is rejected as restaurant', () => {
  const c = makeValidRestaurant({ name: 'Bandra Business Tower', types: ['commercial.office'] });
  const result = validateRestaurantCandidate(c);
  assert.equal(result.valid, false, 'Office building should be rejected');
});

test('Residential address is rejected as restaurant', () => {
  const c = makeValidRestaurant({ name: 'Sunshine Apartments', types: ['building.apartments'] });
  const result = validateRestaurantCandidate(c);
  assert.equal(result.valid, false, 'Residential address should be rejected');
});

test('Clinic is rejected as restaurant', () => {
  const c = makeValidRestaurant({ name: 'Dr. Smith Dental Clinic', types: ['healthcare.dentist'] });
  const result = validateRestaurantCandidate(c);
  assert.equal(result.valid, false, 'Clinic should be rejected');
});

test('Pharmacy is rejected as restaurant', () => {
  const c = makeValidRestaurant({ name: 'Apollo Pharmacy', types: ['healthcare.pharmacy'] });
  const result = validateRestaurantCandidate(c);
  assert.equal(result.valid, false, 'Pharmacy should be rejected');
});

// ══════════════════════════════════════════════════════════════════════
//  5. REAL RESTAURANT WITH PRICE ACCEPTED
// ══════════════════════════════════════════════════════════════════════

test('Restaurant with Zomato price data is accepted with real price', () => {
  const c = makeValidRestaurant({
    averageCostPerPerson: 450,
    zomatoData: { averageCostPerPerson: 450, averageCostForTwo: 900 },
  });
  const result = validateRestaurantCandidate(c);
  assert.equal(result.valid, true, 'Restaurant with price should be accepted');

  const normalized = normalizeRestaurant(c);
  assert.equal(normalized.averageCostPerPerson, 450, 'Should use provider price');
  assert.equal(normalized.dataStatus, 'live', 'Should be live when Zomato data');
  assert.equal(normalized.isEstimate, false, 'Should not be estimate when real price');
});

test('Restaurant with direct averageCostPerPerson is accepted with real price', () => {
  const c = makeValidRestaurant({ averageCostPerPerson: 300 });
  const result = validateRestaurantCandidate(c);
  assert.equal(result.valid, true, 'Restaurant with price should be accepted');

  const normalized = normalizeRestaurant(c);
  assert.equal(normalized.averageCostPerPerson, 300, 'Should use provider price');
  assert.equal(normalized.isEstimate, false, 'Should not be estimate');
});

// ══════════════════════════════════════════════════════════════════════
//  6. RESTAURANT WITHOUT PRICE REMAINS PRICE UNAVAILABLE
// ══════════════════════════════════════════════════════════════════════

test('Restaurant without price has null averageCostPerPerson', () => {
  const c = makeValidRestaurant({ averageCostPerPerson: null, priceLevel: 0 });
  const normalized = normalizeRestaurant(c);
  assert.equal(normalized.averageCostPerPerson, null, 'Price should be null');
  assert.equal(normalized.dataStatus, 'unavailable', 'Data status should be unavailable');
  assert.equal(normalized.isEstimate, false, 'Should not be labeled as estimate');
});

test('Restaurant with only priceLevel has null cost and unavailable status', () => {
  const c = makeValidRestaurant({ priceLevel: 2, averageCostPerPerson: 0 });
  const normalized = normalizeRestaurant(c);
  assert.equal(normalized.averageCostPerPerson, null, 'Price should be null (not invented from priceLevel)');
  assert.equal(normalized.dataStatus, 'unavailable', 'Data status should be unavailable');
  assert.equal(normalized.isEstimate, false, 'Should not be labeled as estimate');
});

// ══════════════════════════════════════════════════════════════════════
//  7. WRONG-CITY RESTAURANT REJECTED
// ══════════════════════════════════════════════════════════════════════

test('Restaurant with Hyderabad coordinates rejected from Mumbai itinerary', () => {
  const c = makeValidRestaurant({
    name: 'Paradise Biryani',
    latitude: 17.3616,
    longitude: 78.4747,
    city: 'Hyderabad',
  });
  const destination = { latitude: 19.076, longitude: 72.8777, radiusKm: 55 };
  const result = validateRestaurantCandidate(c, destination, { maxDistanceKm: 55 });
  assert.equal(result.valid, false, 'Wrong-city restaurant should be rejected');
  assert.ok(result.rejection.includes('km') || result.rejection.includes('distance'));
});

test('Restaurant with correct Mumbai coordinates accepted', () => {
  const c = makeValidRestaurant({ latitude: 18.92, longitude: 72.83 });
  const destination = { latitude: 19.076, longitude: 72.8777, radiusKm: 55 };
  const result = validateRestaurantCandidate(c, destination, { maxDistanceKm: 55 });
  assert.equal(result.valid, true, 'Correct-city restaurant should be accepted');
});

// ══════════════════════════════════════════════════════════════════════
//  8. HOTEL WITHOUT RESTAURANT CATEGORY REJECTED
// ══════════════════════════════════════════════════════════════════════

test('Hotel (not restaurant-categorized) is rejected as restaurant', () => {
  const c = makeValidRestaurant({
    name: 'Taj Mahal Palace Hotel',
    types: ['accommodation.hotel'],
    categories: ['accommodation.hotel'],
  });
  const result = validateRestaurantCandidate(c);
  assert.equal(result.valid, false, 'Hotel should be rejected unless categorized as restaurant');
});

// ══════════════════════════════════════════════════════════════════════
//  9. EMPTY/PLACEHOLDER NAMES REJECTED
// ══════════════════════════════════════════════════════════════════════

test('Empty name is rejected', () => {
  const c = makeValidRestaurant({ name: '' });
  const result = validateRestaurantCandidate(c);
  assert.equal(result.valid, false, 'Empty name should be rejected');
  assert.ok(result.rejection.includes('no name'));
});

test('Test/placeholder name is rejected', () => {
  const c = makeValidRestaurant({ name: 'Test Restaurant' });
  const result = validateRestaurantCandidate(c);
  assert.equal(result.valid, false, 'Test name should be rejected');
  assert.ok(result.rejection.includes('test'));
});

// ══════════════════════════════════════════════════════════════════════
//  10. PROVIDER VALIDATION
// ══════════════════════════════════════════════════════════════════════

test('Missing providerId is rejected', () => {
  const c = makeValidRestaurant({ providerId: '' });
  const result = validateRestaurantCandidate(c);
  assert.equal(result.valid, false, 'Missing providerId should be rejected');
  assert.ok(result.rejection.includes('providerId'));
});

test('Unknown provider is rejected', () => {
  const c = makeValidRestaurant({ provider: 'unknownprovider' });
  const result = validateRestaurantCandidate(c);
  assert.equal(result.valid, false, 'Unknown provider should be rejected');
  assert.ok(result.rejection.includes('provider'));
});

// ══════════════════════════════════════════════════════════════════════
//  11. COORDINATE VALIDATION
// ══════════════════════════════════════════════════════════════════════

test('Missing coordinates is rejected', () => {
  const c = makeValidRestaurant({ latitude: null, longitude: null });
  const result = validateRestaurantCandidate(c);
  assert.equal(result.valid, false, 'Missing coordinates should be rejected');
  assert.ok(result.rejection.includes('coordinates'));
});

test('Null-island coordinates (0,0) is rejected', () => {
  const c = makeValidRestaurant({ latitude: 0, longitude: 0 });
  const result = validateRestaurantCandidate(c);
  assert.equal(result.valid, false, 'Null-island coordinates should be rejected');
  assert.ok(result.rejection.includes('null-island'));
});

// ══════════════════════════════════════════════════════════════════════
//  12. NORMALIZATION SHAPE
// ══════════════════════════════════════════════════════════════════════

test('Normalized restaurant has correct shape', () => {
  const c = makeValidRestaurant({ averageCostPerPerson: 350 });
  const normalized = normalizeRestaurant(c);

  assert.equal(normalized.candidateType, 'restaurant');
  assert.equal(typeof normalized.canonicalName, 'string');
  assert.equal(typeof normalized.providerId, 'string');
  assert.equal(typeof normalized.provider, 'string');
  assert.equal(typeof normalized.address, 'string');
  assert.equal(typeof normalized.city, 'string');
  assert.equal(typeof normalized.country, 'string');
  assert.equal(typeof normalized.latitude, 'number');
  assert.equal(typeof normalized.longitude, 'number');
  assert.ok(Array.isArray(normalized.cuisine));
  assert.equal(typeof normalized.rating, 'number');
  assert.equal(typeof normalized.reviewCount, 'number');
  // Without zomatoData, dataStatus is 'provider'; with zomatoData it would be 'live'
  assert.equal(normalized.dataStatus, 'provider');
  assert.equal(normalized.isEstimate, false);
});

// ══════════════════════════════════════════════════════════════════════
//  13. PIPELINE BATCH PROCESSING
// ══════════════════════════════════════════════════════════════════════

test('Pipeline filters good and bad restaurant candidates', () => {
  const candidates = [
    makeValidRestaurant(),                                                    // valid
    makeValidRestaurant({ name: 'Breach Candy Hospital', types: ['healthcare.hospital'] }),  // hospital
    makeValidRestaurant({ name: 'Oasis Day Spa', types: ['commercial.service'] }),           // spa
    makeValidRestaurant({ name: '', types: ['catering.restaurant'] }),                         // empty name
    makeValidRestaurant({ name: 'McDonalds Andheri', types: ['catering.fast_food'] }),        // valid
  ];

  const { accepted, rejected, rejectionLog } = runRestaurantPipeline(candidates);
  assert.ok(accepted.length >= 2, `Should accept at least 2, got ${accepted.length}`);
  assert.ok(rejected.length >= 2, `Should reject at least 2, got ${rejected.length}`);
  assert.equal(rejectionLog.length, rejected.length);
});

test('Pipeline with empty array', () => {
  const { accepted, rejected } = runRestaurantPipeline([]);
  assert.equal(accepted.length, 0);
  assert.equal(rejected.length, 0);
});

test('Pipeline with null array', () => {
  const { accepted, rejected } = runRestaurantPipeline(null);
  assert.equal(accepted.length, 0);
  assert.equal(rejected.length, 0);
});

// ══════════════════════════════════════════════════════════════════════
//  14. PRICE RULE ENFORCEMENT
// ══════════════════════════════════════════════════════════════════════

test('Price rule: Zomato data uses live status', () => {
  const c = makeValidRestaurant({
    averageCostPerPerson: 500,
    zomatoData: { averageCostPerPerson: 500 },
  });
  const normalized = normalizeRestaurant(c);
  assert.equal(normalized.averageCostPerPerson, 500);
  assert.equal(normalized.dataStatus, 'live');
  assert.equal(normalized.isEstimate, false);
});

test('Price rule: Google-only data uses provider status', () => {
  const c = makeValidRestaurant({ averageCostPerPerson: 350 });
  const normalized = normalizeRestaurant(c);
  assert.equal(normalized.averageCostPerPerson, 350);
  assert.equal(normalized.dataStatus, 'provider');
  assert.equal(normalized.isEstimate, false);
});

test('Price rule: no price data uses unavailable status', () => {
  const c = makeValidRestaurant({ averageCostPerPerson: 0 });
  const normalized = normalizeRestaurant(c);
  assert.equal(normalized.averageCostPerPerson, null);
  assert.equal(normalized.dataStatus, 'unavailable');
  assert.equal(normalized.isEstimate, false);
});

// ══════════════════════════════════════════════════════════════════════
//  15. SUMMARY
// ══════════════════════════════════════════════════════════════════════

test('getPipelineSummary returns correct stats', () => {
  const accepted = [
    normalizeRestaurant(makeValidRestaurant({ averageCostPerPerson: 300, rating: 4.5 })),
    normalizeRestaurant(makeValidRestaurant({ name: 'Cafe Leopold', averageCostPerPerson: null })),
  ];
  const rejected = [{ name: 'Bad Place', rejection: 'test' }];
  const summary = getPipelineSummary(accepted, rejected);

  assert.equal(summary.total, 3);
  assert.equal(summary.accepted, 2);
  assert.equal(summary.rejected, 1);
  assert.equal(summary.withPrice, 1);
  assert.equal(summary.withoutPrice, 1);
  assert.equal(summary.withRating, 2);
});

// ══════════════════════════════════════════════════════════════════════
//  16. CONFIGURATION CONSTANTS
// ══════════════════════════════════════════════════════════════════════

test('KNOWN_RESTAURANT_PROVIDERS contains expected providers', () => {
  assert.ok(KNOWN_RESTAURANT_PROVIDERS.has('google'));
  assert.ok(KNOWN_RESTAURANT_PROVIDERS.has('zomato'));
  assert.ok(!KNOWN_RESTAURANT_PROVIDERS.has('randomprovider'));
});

test('VALID_RESTAURANT_CATEGORY_PREFIXES contains catering.restaurant', () => {
  assert.ok(VALID_RESTAURANT_CATEGORY_PREFIXES.includes('catering.restaurant'));
});

test('NON_RESTAURANT_PATTERNS has hospital, spa, hotel, residential, generic, test', () => {
  assert.ok(NON_RESTAURANT_PATTERNS.hospital?.length > 0);
  assert.ok(NON_RESTAURANT_PATTERNS.spa?.length > 0);
  assert.ok(NON_RESTAURANT_PATTERNS.hotel?.length > 0);
  assert.ok(NON_RESTAURANT_PATTERNS.residential?.length > 0);
  assert.ok(NON_RESTAURANT_PATTERNS.generic?.length > 0);
  assert.ok(NON_RESTAURANT_PATTERNS.test?.length > 0);
});
