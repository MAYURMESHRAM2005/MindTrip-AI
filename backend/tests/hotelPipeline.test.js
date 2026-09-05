import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateHotelCandidate,
  normalizeHotel,
  buildUnavailableHotel,
  runHotelPipeline,
  getPipelineSummary,
  KNOWN_HOTEL_PROVIDERS,
} from '../src/services/hotelCandidatePipeline.service.js';

// ══════════════════════════════════════════════════════════════════════
//  HELPER: Build a valid hotel candidate fixture
// ══════════════════════════════════════════════════════════════════════

function makeValidHotel(overrides = {}) {
  return {
    id: 'MCLONGHM',
    name: 'Grand Hyatt Mumbai',
    provider: 'Amadeus',
    cityCode: 'BOM',
    latitude: 19.0596,
    longitude: 72.8656,
    address: 'Off Mahalakshmi Station, Mumbai',
    rating: 5,
    amenities: ['SPA', 'POOL'],
    price: { amount: 8500, currency: 'INR' },
    checkIn: '2025-06-01',
    checkOut: '2025-06-03',
    isLive: true,
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════════
//  1. REAL HOTEL OFFER ACCEPTED
// ══════════════════════════════════════════════════════════════════════

test('Real hotel offer with valid price is accepted', () => {
  const c = makeValidHotel();
  const result = validateHotelCandidate(c);
  assert.equal(result.valid, true, `Hotel should be accepted (got: ${result.rejection})`);
});

test('Real hotel offer normalizes correctly', () => {
  const c = makeValidHotel();
  const normalized = normalizeHotel(c, { checkIn: '2025-06-01', checkOut: '2025-06-03', rooms: 1 });
  assert.equal(normalized.hotelName, 'Grand Hyatt Mumbai');
  assert.equal(normalized.price, 8500);
  assert.equal(normalized.pricePerNight, 8500);
  assert.equal(normalized.currency, 'INR');
  assert.equal(normalized.dataStatus, 'live');
  assert.equal(normalized.isEstimate, false);
  assert.equal(normalized.hotelId, 'MCLONGHM');
});

// ══════════════════════════════════════════════════════════════════════
//  2. NO HOTEL OFFER — UNAVAILABLE STATE
// ══════════════════════════════════════════════════════════════════════

test('Hotel without price is rejected', () => {
  const c = makeValidHotel({ price: { amount: 0, currency: 'INR' } });
  const result = validateHotelCandidate(c);
  assert.equal(result.valid, false, 'Hotel without price should be rejected');
  assert.ok(result.rejection.includes('price'));
});

test('buildUnavailableHotel returns honest null state', () => {
  const unavailable = buildUnavailableHotel({ destination: 'Mumbai', rooms: 2 });
  assert.equal(unavailable.hotelName, null);
  assert.equal(unavailable.price, null);
  assert.equal(unavailable.pricePerNight, null);
  assert.equal(unavailable.totalPrice, null);
  assert.equal(unavailable.dataStatus, 'unavailable');
  assert.equal(unavailable.isEstimate, false);
  assert.equal(unavailable.source, 'unavailable');
  assert.equal(unavailable.rooms, 2);
});

test('buildUnavailableHotel defaults', () => {
  const unavailable = buildUnavailableHotel();
  assert.equal(unavailable.hotelName, null);
  assert.equal(unavailable.price, null);
  assert.equal(unavailable.dataStatus, 'unavailable');
  assert.equal(unavailable.isEstimate, false);
});

// ══════════════════════════════════════════════════════════════════════
//  3. PRICE MAPPING
// ══════════════════════════════════════════════════════════════════════

test('Price from provider is used directly', () => {
  const c = makeValidHotel({ price: { amount: 12000, currency: 'INR' } });
  const normalized = normalizeHotel(c, { rooms: 1 });
  assert.equal(normalized.price, 12000);
  assert.equal(normalized.pricePerNight, 12000);
});

test('Total price calculated from nightly × rooms', () => {
  const c = makeValidHotel({ price: { amount: 5000, currency: 'INR' } });
  const normalized = normalizeHotel(c, { rooms: 2 });
  assert.equal(normalized.totalPrice, 10000);
  assert.equal(normalized.rooms, 2);
});

test('Currency preserved from provider', () => {
  const c = makeValidHotel({ price: { amount: 200, currency: 'USD' } });
  const normalized = normalizeHotel(c, { rooms: 1 });
  assert.equal(normalized.currency, 'USD');
});

// ══════════════════════════════════════════════════════════════════════
//  4. OCCUPANCY
// ══════════════════════════════════════════════════════════════════════

test('Rooms parameter is preserved in normalized output', () => {
  const c = makeValidHotel();
  const normalized = normalizeHotel(c, { rooms: 3 });
  assert.equal(normalized.rooms, 3);
  assert.equal(normalized.totalPrice, 8500 * 3);
});

test('Default rooms is 1 when not provided', () => {
  const c = makeValidHotel();
  const normalized = normalizeHotel(c, {});
  assert.equal(normalized.rooms, 1);
});

// ══════════════════════════════════════════════════════════════════════
//  5. MULTI-NIGHT CALCULATION
// ══════════════════════════════════════════════════════════════════════

test('Price per night is the provider rate (total price computed downstream)', () => {
  const c = makeValidHotel({ price: { amount: 5000, currency: 'INR' } });
  const normalized = normalizeHotel(c, { checkIn: '2025-06-01', checkOut: '2025-06-04', rooms: 1 });
  // pricePerNight is always the nightly rate from provider
  assert.equal(normalized.pricePerNight, 5000);
  // totalPrice = nightly × rooms (not × nights — nights handled downstream)
  assert.equal(normalized.totalPrice, 5000);
});

// ══════════════════════════════════════════════════════════════════════
//  6. NO FAKE FALLBACK PRICE
// ══════════════════════════════════════════════════════════════════════

test('Hotel without provider price is rejected — never uses fallback', () => {
  const c = makeValidHotel({ price: { amount: 0, currency: 'INR' } });
  const result = validateHotelCandidate(c);
  assert.equal(result.valid, false, 'Must reject hotel without real price');
  assert.ok(result.rejection.includes('price'));
});

test('Generic hotel names are rejected', () => {
  const c = makeValidHotel({ name: 'Accommodation in Mumbai' });
  const result = validateHotelCandidate(c);
  assert.equal(result.valid, false, 'Generic name should be rejected');
  assert.ok(result.rejection.includes('generic'));
});

test('Test hotel names are rejected', () => {
  const c = makeValidHotel({ name: 'Test Hotel' });
  const result = validateHotelCandidate(c);
  assert.equal(result.valid, false, 'Test name should be rejected');
  assert.ok(result.rejection.includes('test'));
});

test('Pipeline rejects all invalid hotels', () => {
  const candidates = [
    makeValidHotel(),
    makeValidHotel({ name: 'Accommodation in Goa', id: 'h2', price: { amount: 5000 } }),
    makeValidHotel({ name: '', id: 'h3', price: { amount: 3000 } }),
    makeValidHotel({ id: 'h4', price: { amount: 0 } }),
  ];
  const { accepted, rejected } = runHotelPipeline(candidates);
  assert.ok(accepted.length >= 1, 'Should accept at least the valid hotel');
  assert.ok(rejected.length >= 2, 'Should reject generic/empty/no-price hotels');
});

// ══════════════════════════════════════════════════════════════════════
//  7. CURRENCY PRESERVATION
// ══════════════════════════════════════════════════════════════════════

test('INR currency preserved', () => {
  const c = makeValidHotel({ price: { amount: 5000, currency: 'INR' } });
  const normalized = normalizeHotel(c, { rooms: 1 });
  assert.equal(normalized.currency, 'INR');
});

test('USD currency preserved', () => {
  const c = makeValidHotel({ price: { amount: 200, currency: 'USD' } });
  const normalized = normalizeHotel(c, { rooms: 1 });
  assert.equal(normalized.currency, 'USD');
});

test('EUR currency preserved', () => {
  const c = makeValidHotel({ price: { amount: 180, currency: 'EUR' } });
  const normalized = normalizeHotel(c, { rooms: 1 });
  assert.equal(normalized.currency, 'EUR');
});

// ══════════════════════════════════════════════════════════════════════
//  8. NORMALIZED SHAPE
// ══════════════════════════════════════════════════════════════════════

test('Normalized hotel has correct shape', () => {
  const c = makeValidHotel();
  const normalized = normalizeHotel(c, { checkIn: '2025-06-01', checkOut: '2025-06-03', rooms: 2 });

  assert.equal(typeof normalized.hotelId, 'string');
  assert.equal(typeof normalized.hotelName, 'string');
  assert.equal(typeof normalized.provider, 'string');
  assert.equal(typeof normalized.providerOfferId, 'string');
  assert.equal(typeof normalized.address, 'string');
  assert.equal(typeof normalized.city, 'string');
  assert.equal(typeof normalized.latitude, 'number');
  assert.equal(typeof normalized.longitude, 'number');
  assert.equal(typeof normalized.rating, 'number');
  assert.equal(typeof normalized.roomType, 'string');
  assert.equal(typeof normalized.checkIn, 'string');
  assert.equal(typeof normalized.checkOut, 'string');
  assert.equal(typeof normalized.rooms, 'number');
  assert.equal(typeof normalized.price, 'number');
  assert.equal(typeof normalized.currency, 'string');
  assert.equal(typeof normalized.totalPrice, 'number');
  assert.equal(typeof normalized.pricePerNight, 'number');
  assert.equal(typeof normalized.source, 'string');
  assert.equal(typeof normalized.dataStatus, 'string');
  assert.equal(typeof normalized.isEstimate, 'boolean');
});

// ══════════════════════════════════════════════════════════════════════
//  9. PIPELINE BATCH PROCESSING
// ══════════════════════════════════════════════════════════════════════

test('Pipeline sorts accepted hotels by price (cheapest first)', () => {
  const candidates = [
    makeValidHotel({ id: 'h1', name: 'Luxury Hotel', price: { amount: 15000 } }),
    makeValidHotel({ id: 'h2', name: 'Budget Hotel', price: { amount: 3000 } }),
    makeValidHotel({ id: 'h3', name: 'Mid Hotel', price: { amount: 7000 } }),
  ];
  const { accepted } = runHotelPipeline(candidates);
  assert.equal(accepted[0].hotelName, 'Budget Hotel');
  assert.equal(accepted[1].hotelName, 'Mid Hotel');
  assert.equal(accepted[2].hotelName, 'Luxury Hotel');
});

test('Pipeline recommended is cheapest hotel', () => {
  const candidates = [
    makeValidHotel({ id: 'h1', name: 'Expensive', price: { amount: 20000 } }),
    makeValidHotel({ id: 'h2', name: 'Cheap', price: { amount: 2000 } }),
  ];
  const { recommended } = runHotelPipeline(candidates);
  assert.equal(recommended.hotelName, 'Cheap');
});

test('Pipeline with empty array', () => {
  const { accepted, rejected, recommended } = runHotelPipeline([]);
  assert.equal(accepted.length, 0);
  assert.equal(rejected.length, 0);
  assert.equal(recommended, null);
});

test('Pipeline with null array', () => {
  const { accepted, rejected, recommended } = runHotelPipeline(null);
  assert.equal(accepted.length, 0);
  assert.equal(rejected.length, 0);
  assert.equal(recommended, null);
});

// ══════════════════════════════════════════════════════════════════════
//  10. VALIDATION EDGE CASES
// ══════════════════════════════════════════════════════════════════════

test('Empty name is rejected', () => {
  const c = makeValidHotel({ name: '' });
  const result = validateHotelCandidate(c);
  assert.equal(result.valid, false);
  assert.ok(result.rejection.includes('no name'));
});

test('Missing hotelId is rejected', () => {
  const c = makeValidHotel({ id: '' });
  const result = validateHotelCandidate(c);
  assert.equal(result.valid, false);
  assert.ok(result.rejection.includes('hotelId'));
});

test('Null candidate is rejected', () => {
  const result = validateHotelCandidate(null);
  assert.equal(result.valid, false);
});

// ══════════════════════════════════════════════════════════════════════
//  11. SUMMARY
// ══════════════════════════════════════════════════════════════════════

test('getPipelineSummary returns correct stats', () => {
  const accepted = [
    normalizeHotel(makeValidHotel({ price: { amount: 5000 } }), { rooms: 1 }),
    normalizeHotel(makeValidHotel({ id: 'h2', name: 'Hotel 2', price: { amount: 8000 } }), { rooms: 1 }),
  ];
  const rejected = [{ name: 'Bad Hotel', rejection: 'test' }];
  const summary = getPipelineSummary(accepted, rejected);

  assert.equal(summary.total, 3);
  assert.equal(summary.accepted, 2);
  assert.equal(summary.rejected, 1);
  assert.equal(summary.withPrice, 2);
  assert.equal(summary.minPrice, 5000);
  assert.equal(summary.maxPrice, 8000);
  assert.equal(summary.avgPrice, 6500);
  assert.equal(summary.recommended.hotelName, 'Grand Hyatt Mumbai');
});

// ══════════════════════════════════════════════════════════════════════
//  12. CONFIGURATION
// ══════════════════════════════════════════════════════════════════════

test('KNOWN_HOTEL_PROVIDERS contains amadeus', () => {
  assert.ok(KNOWN_HOTEL_PROVIDERS.has('amadeus'));
  assert.ok(KNOWN_HOTEL_PROVIDERS.has('amadeus-hotels'));
});
