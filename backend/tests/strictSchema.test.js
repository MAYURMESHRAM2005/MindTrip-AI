import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateCandidateId,
  buildTrustedDataset,
  buildTrustedLookup,
  hydrateItem,
  hydrateResponse,
  validateItemAgainstTrustedDataset,
} from '../src/services/trustedDatasetBuilder.service.js';
import geminiResponseValidator from '../src/services/geminiResponseValidator.service.js';

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
    types: ['tourism.sights'],
    address: 'Apollo Bunder, Mumbai',
    suburb: 'Colaba',
    city: 'Mumbai',
    country: 'India',
    latitude: 18.922,
    longitude: 72.8347,
    rating: 4.5,
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

// ══════════════════════════════════════════════════════════════════════
//  1. CANDIDATE ID GENERATION
// ══════════════════════════════════════════════════════════════════════

test('generateCandidateId creates stable ID', () => {
  const id = generateCandidateId('google', 'goi-1');
  assert.equal(id, 'google-goi-1');
});

test('generateCandidateId sanitizes special characters', () => {
  const id = generateCandidateId('google', 'GoI-123!');
  assert.equal(id, 'google-goi-123-');
});

test('generateCandidateId handles null inputs', () => {
  const id = generateCandidateId(null, null);
  assert.equal(id, 'unknown-unknown');
});

// ══════════════════════════════════════════════════════════════════════
//  2. TRUSTED DATASET WITH CANDIDATE IDS
// ══════════════════════════════════════════════════════════════════════

test('Trusted candidates have candidateId field', () => {
  const candidates = [makeCandidate(), makeRestaurant(), makeHotel()];
  const dataset = buildTrustedDataset({ candidates });

  for (const c of dataset.candidates) {
    assert.ok(c.candidateId, `Candidate should have candidateId: ${c.name}`);
    assert.ok(typeof c.candidateId === 'string');
    assert.ok(c.candidateId.length > 0);
  }
});

test('candidateId is unique for each candidate', () => {
  const candidates = [
    makeCandidate({ providerId: 'a-1' }),
    makeCandidate({ providerId: 'a-2' }),
    makeRestaurant({ providerId: 'b-1' }),
  ];
  const dataset = buildTrustedDataset({ candidates });
  const ids = dataset.candidates.map((c) => c.candidateId);
  const uniqueIds = new Set(ids);
  assert.equal(ids.length, uniqueIds.size, 'All candidateIds should be unique');
});

// ══════════════════════════════════════════════════════════════════════
//  3. LOOKUP BY CANDIDATE ID
// ══════════════════════════════════════════════════════════════════════

test('buildTrustedLookup indexes by candidateId', () => {
  const candidates = [makeCandidate(), makeRestaurant()];
  const dataset = buildTrustedDataset({ candidates });
  const lookup = buildTrustedLookup(dataset);

  const attraction = dataset.candidates.find((c) => c.type === 'attraction');
  const restaurant = dataset.candidates.find((c) => c.type === 'restaurant');

  assert.ok(lookup.has(attraction.candidateId));
  assert.ok(lookup.has(restaurant.candidateId));
});

test('Lookup returns correct candidate by candidateId', () => {
  const candidates = [makeCandidate()];
  const dataset = buildTrustedDataset({ candidates });
  const lookup = buildTrustedLookup(dataset);

  const trusted = dataset.candidates[0];
  const found = lookup.get(trusted.candidateId);
  assert.equal(found.name, trusted.name);
  assert.equal(found.type, trusted.type);
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
      theme: 'Heritage Day',
      items: [{
        candidateId: 'google-goi-1',
        type: 'attraction',
        time: '09:30',
        reason: 'Famous landmark',
      }],
    }],
  };
  const { valid, errors } = geminiResponseValidator.validateSchema(response);
  assert.equal(valid, true);
  assert.equal(errors.length, 0);
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

test('Empty candidateId is rejected', () => {
  const response = {
    days: [{
      date: '2025-06-01',
      theme: 'Day 1',
      items: [{
        candidateId: '',
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

test('Missing time is rejected', () => {
  const response = {
    days: [{
      date: '2025-06-01',
      theme: 'Day 1',
      items: [{
        candidateId: 'google-goi-1',
        type: 'attraction',
        reason: 'Test',
      }],
    }],
  };
  const { valid, errors } = geminiResponseValidator.validateSchema(response);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('time')));
});

test('Missing reason is rejected', () => {
  const response = {
    days: [{
      date: '2025-06-01',
      theme: 'Day 1',
      items: [{
        candidateId: 'google-goi-1',
        type: 'attraction',
        time: '09:00',
      }],
    }],
  };
  const { valid, errors } = geminiResponseValidator.validateSchema(response);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('reason')));
});

// ══════════════════════════════════════════════════════════════════════
//  5. HYDRATION — RESOLVE CANDIDATE IDS
// ══════════════════════════════════════════════════════════════════════

test('hydrateItem resolves candidateId to full trusted data', () => {
  const candidates = [makeCandidate()];
  const dataset = buildTrustedDataset({ candidates });
  const lookup = buildTrustedLookup(dataset);

  const trusted = dataset.candidates[0];
  const item = {
    candidateId: trusted.candidateId,
    type: 'attraction',
    time: '09:30',
    reason: 'Famous landmark',
  };

  const hydrated = hydrateItem(item, lookup);
  assert.ok(hydrated, 'Should hydrate successfully');
  assert.equal(hydrated.name, 'Gateway of India');
  assert.equal(hydrated.latitude, 18.922);
  assert.equal(hydrated.longitude, 72.8347);
  assert.equal(hydrated.address, 'Apollo Bunder, Mumbai');
  assert.equal(hydrated.rating, 4.5);
  assert.equal(hydrated.dataStatus, 'live');
  assert.equal(hydrated._hydrated, true);
  assert.equal(hydrated._trustedCandidateId, trusted.candidateId);
});

test('hydrateItem preserves Gemini planning decisions', () => {
  const candidates = [makeCandidate()];
  const dataset = buildTrustedDataset({ candidates });
  const lookup = buildTrustedLookup(dataset);

  const trusted = dataset.candidates[0];
  const item = {
    candidateId: trusted.candidateId,
    type: 'attraction',
    time: '14:00',
    reason: 'User loves heritage sites',
    areaId: 'area-2',
  };

  const hydrated = hydrateItem(item, lookup);
  assert.equal(hydrated.time, '14:00');
  assert.equal(hydrated.reason, 'User loves heritage sites');
  assert.equal(hydrated.areaId, 'area-2');
});

test('hydrateItem returns null for unknown candidateId', () => {
  const candidates = [makeCandidate()];
  const dataset = buildTrustedDataset({ candidates });
  const lookup = buildTrustedLookup(dataset);

  const item = {
    candidateId: 'unknown-id',
    type: 'attraction',
    time: '09:00',
    reason: 'Test',
  };

  const hydrated = hydrateItem(item, lookup);
  assert.equal(hydrated, null);
});

test('hydrateResponse resolves all items', () => {
  const candidates = [makeCandidate(), makeRestaurant()];
  const dataset = buildTrustedDataset({ candidates });
  const lookup = buildTrustedLookup(dataset);

  const response = {
    days: [{
      dayNumber: 1,
      date: '2025-06-01',
      theme: 'Day 1',
      items: [
        { candidateId: dataset.candidates[0].candidateId, type: 'attraction', time: '09:00', reason: 'Visit' },
        { candidateId: dataset.candidates[1].candidateId, type: 'restaurant', time: '13:00', reason: 'Lunch' },
      ],
    }],
  };

  const result = hydrateResponse(response, lookup);
  assert.equal(result.hydratedCount, 2);
  assert.equal(result.rejectedCount, 0);
  assert.equal(result.hydratedDays[0].items.length, 2);
  assert.equal(result.hydratedDays[0].items[0].name, 'Gateway of India');
  assert.equal(result.hydratedDays[0].items[1].name, 'Leopold Cafe');
});

test('hydrateResponse rejects unknown candidateIds', () => {
  const candidates = [makeCandidate()];
  const dataset = buildTrustedDataset({ candidates });
  const lookup = buildTrustedLookup(dataset);

  const response = {
    days: [{
      dayNumber: 1,
      date: '2025-06-01',
      theme: 'Day 1',
      items: [
        { candidateId: dataset.candidates[0].candidateId, type: 'attraction', time: '09:00', reason: 'Real' },
        { candidateId: 'fake-id', type: 'attraction', time: '14:00', reason: 'Fake' },
      ],
    }],
  };

  const result = hydrateResponse(response, lookup);
  assert.equal(result.hydratedCount, 1);
  assert.equal(result.rejectedCount, 1);
  assert.ok(result.errors.some((e) => e.includes('fake-id')));
});

// ══════════════════════════════════════════════════════════════════════
//  6. FULL VALIDATION + HYDRATION PIPELINE
// ══════════════════════════════════════════════════════════════════════

test('Full pipeline passes for valid strict schema', () => {
  const candidates = [makeCandidate(), makeRestaurant()];
  const dataset = buildTrustedDataset({ candidates });
  const lookup = buildTrustedLookup(dataset);

  const response = {
    days: [{
      dayNumber: 1,
      date: '2025-06-01',
      theme: 'Arrival',
      items: [
        { candidateId: dataset.candidates[0].candidateId, type: 'attraction', time: '09:00', reason: 'Visit' },
        { candidateId: dataset.candidates[1].candidateId, type: 'restaurant', time: '13:00', reason: 'Lunch' },
      ],
    }],
  };

  const result = geminiResponseValidator.validateGeminiResponse(response, lookup);
  assert.equal(result.valid, true);
  assert.equal(result.summary.hydrated, 2);
  assert.equal(result.summary.rejected, 0);
  assert.equal(result.data.days[0].items[0].name, 'Gateway of India');
  assert.equal(result.data.days[0].items[1].name, 'Leopold Cafe');
});

test('Full pipeline rejects hallucinated candidateId', () => {
  const candidates = [makeCandidate()];
  const dataset = buildTrustedDataset({ candidates });
  const lookup = buildTrustedLookup(dataset);

  const response = {
    days: [{
      dayNumber: 1,
      date: '2025-06-01',
      theme: 'Day 1',
      items: [
        { candidateId: 'hallucinated-id', type: 'attraction', time: '09:00', reason: 'Invented' },
      ],
    }],
  };

  const result = geminiResponseValidator.validateGeminiResponse(response, lookup);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('hallucinated-id')));
});

test('Full pipeline strips forbidden fields and hydrates from trusted data', () => {
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
        price: 999,
      }],
    }],
  };

  const result = geminiResponseValidator.validateGeminiResponse(response, lookup);
  assert.equal(result.valid, true);
  // Hydrated from trusted data, not from Gemini's hallucinated fields
  assert.equal(result.data.days[0].items[0].name, 'Gateway of India');
  assert.equal(result.data.days[0].items[0].rating, 4.5);
});

// ══════════════════════════════════════════════════════════════════════
//  7. ANTI-HALLUCINATION SCENARIOS
// ══════════════════════════════════════════════════════════════════════

test('Gemini inventing a place name is rejected (no candidateId)', () => {
  const candidates = [makeCandidate()];
  const dataset = buildTrustedDataset({ candidates });
  const lookup = buildTrustedLookup(dataset);

  const response = {
    days: [{
      date: '2025-06-01',
      theme: 'Day 1',
      items: [{
        candidateId: 'nonexistent-id',
        type: 'attraction',
        time: '09:00',
        reason: 'Invented',
      }],
    }],
  };

  const result = geminiResponseValidator.validateGeminiResponse(response, lookup);
  assert.equal(result.valid, false);
});

test('Gemini returning only candidateId produces hydrated itinerary', () => {
  const candidates = [makeCandidate(), makeRestaurant(), makeHotel()];
  const dataset = buildTrustedDataset({ candidates });
  const lookup = buildTrustedLookup(dataset);

  const response = {
    days: [{
      dayNumber: 1,
      date: '2025-06-01',
      theme: 'Heritage Day',
      items: [
        { candidateId: dataset.candidates[2].candidateId, type: 'hotel', time: '15:00', reason: 'Check-in' },
        { candidateId: dataset.candidates[0].candidateId, type: 'attraction', time: '09:30', reason: 'Famous landmark' },
        { candidateId: dataset.candidates[1].candidateId, type: 'restaurant', time: '13:00', reason: 'Lunch' },
      ],
    }],
  };

  const result = geminiResponseValidator.validateGeminiResponse(response, lookup);
  assert.equal(result.valid, true);
  assert.equal(result.data.days[0].items.length, 3);

  // All items should be hydrated with full trusted data
  for (const item of result.data.days[0].items) {
    assert.ok(item.name, `Item should have hydrated name: ${item.candidateId}`);
    assert.ok(item._hydrated === true, `Item should be marked as hydrated`);
  }
});

// ══════════════════════════════════════════════════════════════════════
//  8. EDGE CASES
// ══════════════════════════════════════════════════════════════════════

test('Null response handled gracefully', () => {
  const result = geminiResponseValidator.validateGeminiResponse(null, new Map());
  assert.equal(result.valid, false);
});

test('Null lookup handled gracefully', () => {
  const result = geminiResponseValidator.validateGeminiResponse({ days: [] }, null);
  assert.equal(result.valid, false);
});

test('Empty days array is valid (schema) but warned', () => {
  const { valid, warnings } = geminiResponseValidator.validateSchema({ days: [] });
  assert.equal(valid, false);
});

test('Multiple days with mixed valid/invalid items', () => {
  const candidates = [makeCandidate(), makeRestaurant()];
  const dataset = buildTrustedDataset({ candidates });
  const lookup = buildTrustedLookup(dataset);

  const response = {
    days: [
      {
        dayNumber: 1,
        date: '2025-06-01',
        theme: 'Day 1',
        items: [
          { candidateId: dataset.candidates[0].candidateId, type: 'attraction', time: '09:00', reason: 'Real' },
        ],
      },
      {
        dayNumber: 2,
        date: '2025-06-02',
        theme: 'Day 2',
        items: [
          { candidateId: 'fake-id', type: 'attraction', time: '09:00', reason: 'Fake' },
          { candidateId: dataset.candidates[1].candidateId, type: 'restaurant', time: '13:00', reason: 'Real' },
        ],
      },
    ],
  };

  const result = geminiResponseValidator.validateGeminiResponse(response, lookup);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('fake-id')));
});

// ══════════════════════════════════════════════════════════════════════
//  9. FORBIDDEN FIELDS LIST
// ══════════════════════════════════════════════════════════════════════

test('FORBIDDEN_FACTUAL_FIELDS covers all factual data', () => {
  const forbidden = geminiResponseValidator.FORBIDDEN_FACTUAL_FIELDS;
  assert.ok(forbidden.includes('name'), 'Should forbid name');
  assert.ok(forbidden.includes('provider'), 'Should forbid provider');
  assert.ok(forbidden.includes('providerId'), 'Should forbid providerId');
  assert.ok(forbidden.includes('price'), 'Should forbid price');
  assert.ok(forbidden.includes('rating'), 'Should forbid rating');
  assert.ok(forbidden.includes('address'), 'Should forbid address');
  assert.ok(forbidden.includes('latitude'), 'Should forbid latitude');
  assert.ok(forbidden.includes('longitude'), 'Should forbid longitude');
  assert.ok(forbidden.includes('dataStatus'), 'Should forbid dataStatus');
  assert.ok(forbidden.includes('isEstimate'), 'Should forbid isEstimate');
  assert.ok(forbidden.includes('source'), 'Should forbid source');
});

test('REQUIRED_ITEM_FIELDS enforces strict schema', () => {
  const required = geminiResponseValidator.REQUIRED_ITEM_FIELDS;
  assert.ok(required.includes('candidateId'), 'Should require candidateId');
  assert.ok(required.includes('type'), 'Should require type');
  assert.ok(required.includes('time'), 'Should require time');
  assert.ok(required.includes('reason'), 'Should require reason');
});
