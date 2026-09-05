import test from 'node:test';
import assert from 'node:assert/strict';
import trustedDatasetBuilderModule from '../src/services/trustedDatasetBuilder.service.js';
import geminiResponseValidator from '../src/services/geminiResponseValidator.service.js';

const {
  buildTrustedDataset,
  buildTrustedLookup,
  validateItemAgainstTrustedDataset,
} = trustedDatasetBuilderModule;

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
    types: ['tourism.sights', 'tourism.monument'],
    address: 'Apollo Bunder, Mumbai',
    suburb: 'Colaba',
    city: 'Mumbai',
    country: 'India',
    latitude: 18.922,
    longitude: 72.8347,
    rating: 4.5,
    reviewCount: 12500,
    priceLevel: 1,
    openingHours: { periods: [{ days: ['all'], open: '09:00', close: '18:00' }] },
    dataStatus: 'live',
    isEstimate: false,
    ...overrides,
  };
}

function makeRestaurant(overrides = {}) {
  return makeCandidate({
    name: 'Leopold Cafe',
    providerId: 'leo-1',
    provider: 'restaurant-engine',
    source: 'restaurant-engine',
    type: 'restaurant',
    cuisine: ['Indian', 'Continental'],
    averageCostPerPerson: 800,
    ...overrides,
  });
}

function makeHotel(overrides = {}) {
  return makeCandidate({
    name: 'Taj Mahal Palace',
    providerId: 'taj-1',
    provider: 'amadeus',
    type: 'hotel',
    pricePerNight: 12000,
    ...overrides,
  });
}

function makeEvent(overrides = {}) {
  return makeCandidate({
    name: 'Mumbai Music Festival',
    providerId: 'tm-1',
    provider: 'ticketmaster',
    type: 'event',
    eventDate: '2025-06-15',
    eventTime: '19:00',
    venue: 'NSCI Dome',
    isFree: false,
    price: 2500,
    ...overrides,
  });
}

function makeTransport(overrides = {}) {
  return makeCandidate({
    name: 'AI 680 Mumbai to Delhi',
    providerId: 'AI680',
    provider: 'transport-intelligence',
    type: 'flight',
    departure: '08:00',
    arrival: '10:15',
    duration: '2h 15m',
    price: 5500,
    ...overrides,
  });
}

// ══════════════════════════════════════════════════════════════════════
//  1. TRUSTED DATASET BUILDER
// ══════════════════════════════════════════════════════════════════════

test('buildTrustedDataset creates trusted candidates with candidateIds', () => {
  const candidates = [makeCandidate(), makeRestaurant(), makeHotel()];
  const dataset = buildTrustedDataset({ candidates });

  assert.ok(dataset.candidates.length === 3, `Should have 3 candidates: ${dataset.candidates.length}`);
  assert.ok(dataset._meta.totalCandidates === 3);
  assert.ok(dataset._meta.byType.attractions === 1);
  assert.ok(dataset._meta.byType.restaurants === 1);
  assert.ok(dataset._meta.byType.hotels === 1);

  // All candidates should have candidateId
  for (const c of dataset.candidates) {
    assert.ok(c.candidateId, `Candidate should have candidateId: ${c.name}`);
  }
});

test('Trusted attraction has correct shape with candidateId', () => {
  const candidate = makeCandidate();
  const dataset = buildTrustedDataset({ candidates: [candidate] });
  const trusted = dataset.candidates[0];

  assert.equal(trusted.candidateId, 'google-goi-1');
  assert.equal(trusted.provider, 'google');
  assert.equal(trusted.providerId, 'goi-1');
  assert.equal(trusted.type, 'attraction');
  assert.equal(trusted.name, 'Gateway of India');
  assert.equal(typeof trusted.latitude, 'number');
  assert.equal(typeof trusted.longitude, 'number');
  assert.equal(trusted.dataStatus, 'live');
  assert.equal(trusted.source, 'google');
  assert.equal(trusted.isEstimate, false);
});

test('Trusted restaurant has correct shape with candidateId', () => {
  const candidate = makeRestaurant();
  const dataset = buildTrustedDataset({ candidates: [candidate] });
  const trusted = dataset.candidates[0];

  assert.equal(trusted.candidateId, 'restaurant-engine-leo-1');
  assert.equal(trusted.type, 'restaurant');
  assert.equal(trusted.name, 'Leopold Cafe');
  assert.equal(trusted.averageCostPerPerson, 800);
  assert.equal(trusted.dataStatus, 'live');
});

test('Trusted hotel has correct shape with candidateId', () => {
  const candidate = makeHotel();
  const dataset = buildTrustedDataset({ candidates: [candidate] });
  const trusted = dataset.candidates[0];

  assert.equal(trusted.candidateId, 'amadeus-taj-1');
  assert.equal(trusted.type, 'hotel');
  assert.equal(trusted.name, 'Taj Mahal Palace');
  assert.equal(trusted.pricePerNight, 12000);
  assert.equal(trusted.dataStatus, 'live');
});

test('Trusted event has correct shape with candidateId', () => {
  const candidate = makeEvent();
  const dataset = buildTrustedDataset({ candidates: [candidate] });
  const trusted = dataset.candidates[0];

  assert.equal(trusted.candidateId, 'ticketmaster-tm-1');
  assert.equal(trusted.type, 'event');
  assert.equal(trusted.name, 'Mumbai Music Festival');
  assert.equal(trusted.eventDate, '2025-06-15');
  assert.equal(trusted.price, 2500);
});

test('Trusted transport has correct shape with candidateId', () => {
  const candidate = makeTransport();
  const dataset = buildTrustedDataset({ candidates: [candidate] });
  const trusted = dataset.candidates[0];

  assert.equal(trusted.candidateId, 'transport-intelligence-ai680');
  assert.equal(trusted.type, 'flight');
  assert.equal(trusted.name, 'AI 680 Mumbai to Delhi');
  assert.equal(trusted.price, 5500);
});

// ══════════════════════════════════════════════════════════════════════
//  2. TRUSTED LOOKUP
// ══════════════════════════════════════════════════════════════════════

test('buildTrustedLookup indexes by candidateId', () => {
  const candidates = [makeCandidate(), makeRestaurant()];
  const dataset = buildTrustedDataset({ candidates });
  const lookup = buildTrustedLookup(dataset);

  const attraction = dataset.candidates.find((c) => c.type === 'attraction');
  const restaurant = dataset.candidates.find((c) => c.type === 'restaurant');

  assert.ok(lookup instanceof Map);
  assert.ok(lookup.has(attraction.candidateId));
  assert.ok(lookup.has(restaurant.candidateId));
  assert.ok(lookup.has('name|gateway of india'));
  assert.ok(lookup.has('name|leopold cafe'));
});

// ══════════════════════════════════════════════════════════════════════
//  3. ITEM VALIDATION AGAINST TRUSTED DATASET
// ══════════════════════════════════════════════════════════════════════

test('Valid item with candidateId passes validation', () => {
  const candidates = [makeCandidate()];
  const dataset = buildTrustedDataset({ candidates });
  const lookup = buildTrustedLookup(dataset);

  const trusted = dataset.candidates[0];
  const item = { candidateId: trusted.candidateId, type: 'attraction' };
  const { valid } = validateItemAgainstTrustedDataset(item, lookup);
  assert.equal(valid, true);
});

test('Unknown candidateId is rejected', () => {
  const candidates = [makeCandidate()];
  const dataset = buildTrustedDataset({ candidates });
  const lookup = buildTrustedLookup(dataset);

  const item = { candidateId: 'unknown-id', type: 'attraction' };
  const { valid, reason } = validateItemAgainstTrustedDataset(item, lookup);
  assert.equal(valid, false);
  assert.ok(reason.includes('not found'));
});

test('Type mismatch is rejected', () => {
  const candidates = [makeCandidate()];
  const dataset = buildTrustedDataset({ candidates });
  const lookup = buildTrustedLookup(dataset);

  const trusted = dataset.candidates[0];
  const item = { candidateId: trusted.candidateId, type: 'restaurant' };
  const { valid, reason } = validateItemAgainstTrustedDataset(item, lookup);
  assert.equal(valid, false);
  assert.ok(reason.includes('type mismatch'));
});

// ══════════════════════════════════════════════════════════════════════
//  4. SCHEMA VALIDATION — STRICT ID-ONLY FORMAT
// ══════════════════════════════════════════════════════════════════════

test('Valid strict schema passes', () => {
  const response = {
    days: [{
      dayNumber: 1,
      date: '2025-06-01',
      areaId: 'area-1',
      theme: 'Arrival Day',
      items: [{
        candidateId: 'google-goi-1',
        type: 'attraction',
        time: '09:00',
        reason: 'Popular landmark',
      }],
    }],
  };
  const { valid } = geminiResponseValidator.validateSchema(response);
  assert.equal(valid, true);
});

test('Missing days is rejected', () => {
  const { valid, errors } = geminiResponseValidator.validateSchema({});
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('days')));
});

test('Empty days is rejected', () => {
  const { valid, errors } = geminiResponseValidator.validateSchema({ days: [] });
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('empty')));
});

test('Invalid type is rejected', () => {
  const response = {
    days: [{
      date: '2025-06-01',
      theme: 'Day 1',
      items: [{
        candidateId: 'google-goi-1',
        type: 'invalid-type',
        time: '09:00',
        reason: 'Test',
      }],
    }],
  };
  const { valid, errors } = geminiResponseValidator.validateSchema(response);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('type')));
});

test('Forbidden factual fields generate warnings', () => {
  const response = {
    days: [{
      date: '2025-06-01',
      theme: 'Day 1',
      items: [{
        candidateId: 'google-goi-1',
        type: 'attraction',
        time: '09:00',
        reason: 'Test',
        name: 'Gateway of India',
        price: 500,
        rating: 4.5,
      }],
    }],
  };
  const { valid, warnings } = geminiResponseValidator.validateSchema(response);
  assert.equal(valid, true);
  assert.ok(warnings.some((w) => w.includes('name')));
  assert.ok(warnings.some((w) => w.includes('price')));
  assert.ok(warnings.some((w) => w.includes('rating')));
});

test('Missing candidateId is rejected', () => {
  const response = {
    days: [{
      date: '2025-06-01',
      theme: 'Day 1',
      items: [{
        type: 'attraction',
        time: '09:00',
        reason: 'Test',
      }],
    }],
  };
  const { valid, errors } = geminiResponseValidator.validateSchema(response);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('candidateId')));
});

// ══════════════════════════════════════════════════════════════════════
//  5. FULL VALIDATION + HYDRATION PIPELINE
// ══════════════════════════════════════════════════════════════════════

test('Full validation passes for valid strict schema', () => {
  const candidates = [makeCandidate(), makeRestaurant()];
  const dataset = buildTrustedDataset({ candidates });
  const lookup = buildTrustedLookup(dataset);

  const attraction = dataset.candidates.find((c) => c.type === 'attraction');
  const restaurant = dataset.candidates.find((c) => c.type === 'restaurant');

  const response = {
    days: [{
      dayNumber: 1,
      date: '2025-06-01',
      theme: 'Arrival',
      items: [
        { candidateId: attraction.candidateId, type: 'attraction', time: '09:00', reason: 'Visit' },
        { candidateId: restaurant.candidateId, type: 'restaurant', time: '13:00', reason: 'Lunch' },
      ],
    }],
  };

  const result = geminiResponseValidator.validateGeminiResponse(response, lookup);
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
  assert.equal(result.summary.hydrated, 2);
  assert.equal(result.summary.rejected, 0);
  assert.equal(result.data.days[0].items[0].name, 'Gateway of India');
  assert.equal(result.data.days[0].items[1].name, 'Leopold Cafe');
});

test('Full validation rejects hallucinated candidateId', () => {
  const candidates = [makeCandidate()];
  const dataset = buildTrustedDataset({ candidates });
  const lookup = buildTrustedLookup(dataset);

  const response = {
    days: [{
      dayNumber: 1,
      date: '2025-06-01',
      theme: 'Day 1',
      items: [
        { candidateId: 'fake-id', type: 'attraction', time: '09:00', reason: 'Hallucinated' },
      ],
    }],
  };

  const result = geminiResponseValidator.validateGeminiResponse(response, lookup);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('fake-id')));
  assert.equal(result.summary.rejected, 1);
});

test('Full validation strips forbidden fields and hydrates from trusted data', () => {
  const candidates = [makeCandidate({ rating: 4.5 })];
  const dataset = buildTrustedDataset({ candidates });
  const lookup = buildTrustedLookup(dataset);

  const response = {
    days: [{
      dayNumber: 1,
      date: '2025-06-01',
      theme: 'Day 1',
      items: [{
        candidateId: dataset.candidates[0].candidateId,
        type: 'attraction',
        time: '09:00',
        reason: 'Test',
        name: 'Wrong Name',
        rating: 1.0,
        price: 500,
      }],
    }],
  };

  const result = geminiResponseValidator.validateGeminiResponse(response, lookup);
  assert.equal(result.valid, true);
  assert.equal(result.data.days[0].items[0].name, 'Gateway of India');
  assert.equal(result.data.days[0].items[0].rating, 4.5);
});

// ══════════════════════════════════════════════════════════════════════
//  6. ANTI-HALLUCINATION SCENARIOS
// ══════════════════════════════════════════════════════════════════════

test('Gemini inventing a place name is rejected (no valid candidateId)', () => {
  const candidates = [makeCandidate()];
  const dataset = buildTrustedDataset({ candidates });
  const lookup = buildTrustedLookup(dataset);

  const response = {
    days: [{
      date: '2025-06-01',
      theme: 'Day 1',
      items: [
        { candidateId: 'nonexistent', type: 'attraction', time: '09:00', reason: 'Invented' },
      ],
    }],
  };

  const result = geminiResponseValidator.validateGeminiResponse(response, lookup);
  assert.equal(result.valid, false);
  assert.ok(result.summary.rejected > 0);
});

test('Gemini inventing a restaurant is rejected', () => {
  const candidates = [makeRestaurant()];
  const dataset = buildTrustedDataset({ candidates });
  const lookup = buildTrustedLookup(dataset);

  const response = {
    days: [{
      date: '2025-06-01',
      theme: 'Day 1',
      items: [
        { candidateId: 'fake-restaurant', type: 'restaurant', time: '13:00', reason: 'Invented' },
      ],
    }],
  };

  const result = geminiResponseValidator.validateGeminiResponse(response, lookup);
  assert.equal(result.valid, false);
});

test('Gemini inventing a hotel is rejected', () => {
  const candidates = [makeHotel()];
  const dataset = buildTrustedDataset({ candidates });
  const lookup = buildTrustedLookup(dataset);

  const response = {
    days: [{
      date: '2025-06-01',
      theme: 'Day 1',
      items: [
        { candidateId: 'fake-hotel', type: 'hotel', time: '15:00', reason: 'Invented' },
      ],
    }],
  };

  const result = geminiResponseValidator.validateGeminiResponse(response, lookup);
  assert.equal(result.valid, false);
});

// ══════════════════════════════════════════════════════════════════════
//  7. EDGE CASES
// ══════════════════════════════════════════════════════════════════════

test('Empty candidates list produces empty dataset', () => {
  const dataset = buildTrustedDataset({ candidates: [] });
  assert.equal(dataset.candidates.length, 0);
  assert.equal(dataset._meta.totalCandidates, 0);
});

test('Null candidates handled gracefully', () => {
  const dataset = buildTrustedDataset({ candidates: null });
  assert.equal(dataset.candidates.length, 0);
});

test('validateGeminiResponse handles null response', () => {
  const result = geminiResponseValidator.validateGeminiResponse(null, new Map());
  assert.equal(result.valid, false);
});

test('validateGeminiResponse handles null lookup', () => {
  const result = geminiResponseValidator.validateGeminiResponse({ days: [] }, null);
  assert.equal(result.valid, false);
});

test('Weather data included in trusted dataset', () => {
  const weather = {
    data: {
      forecast: [
        { date: '2025-06-01', condition: 'Sunny', rainProbability: 10, tempMin: 25, tempMax: 32 },
      ],
    },
  };
  const dataset = buildTrustedDataset({ candidates: [], weather });
  assert.equal(dataset.weather.available, true);
  assert.equal(dataset.weather.forecast.length, 1);
  assert.equal(dataset.weather.forecast[0].condition, 'Sunny');
});

test('FORBIDDEN_FACTUAL_FIELDS list is comprehensive', () => {
  const forbidden = geminiResponseValidator.FORBIDDEN_FACTUAL_FIELDS;
  assert.ok(forbidden.includes('price'));
  assert.ok(forbidden.includes('coordinates'));
  assert.ok(forbidden.includes('rating'));
  assert.ok(forbidden.includes('openingHours'));
  assert.ok(forbidden.includes('latitude'));
  assert.ok(forbidden.includes('longitude'));
  assert.ok(forbidden.includes('dataStatus'));
  assert.ok(forbidden.includes('isEstimate'));
  assert.ok(forbidden.includes('source'));
  assert.ok(forbidden.includes('name'));
  assert.ok(forbidden.includes('provider'));
  assert.ok(forbidden.includes('providerId'));
});

test('REQUIRED_ITEM_FIELDS enforces strict schema', () => {
  const required = geminiResponseValidator.REQUIRED_ITEM_FIELDS;
  assert.ok(required.includes('candidateId'));
  assert.ok(required.includes('type'));
  assert.ok(required.includes('time'));
  assert.ok(required.includes('reason'));
});
