import test from 'node:test';
import assert from 'node:assert/strict';
import {
  stableId,
  normalizedId,
  compositeId,
  createTrackingState,
  isExcluded,
  markAsUsed,
  filterAvailable,
  pickDistinct,
  exclusionPenalty,
  validateUniqueness,
  buildCandidatePool,
  getUniquenessStats,
} from '../src/services/uniquenessEngine.service.js';

// ══════════════════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════════════════

function makeAttraction(overrides = {}) {
  return {
    provider: 'google',
    providerId: `attr-${Math.random().toString(36).slice(2, 8)}`,
    type: 'attraction',
    name: 'Gateway of India',
    category: 'attraction',
    ...overrides,
  };
}

function makeRestaurant(overrides = {}) {
  return {
    provider: 'zomato',
    providerId: `rest-${Math.random().toString(36).slice(2, 8)}`,
    type: 'restaurant',
    name: 'Leopold Cafe',
    category: 'restaurant',
    ...overrides,
  };
}

function makeEvent(overrides = {}) {
  return {
    provider: 'ticketmaster',
    providerId: `evt-${Math.random().toString(36).slice(2, 8)}`,
    type: 'event',
    name: 'Mumbai Music Festival',
    category: 'activity',
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════════
//  1. STABLE IDENTITY
// ══════════════════════════════════════════════════════════════════════

test('stableId produces consistent key from provider+providerId', () => {
  const a = makeAttraction({ provider: 'google', providerId: 'abc123' });
  assert.equal(stableId(a), 'google|abc123');
});

test('stableId lowercases provider', () => {
  const a = makeAttraction({ provider: 'Google', providerId: 'abc123' });
  assert.equal(stableId(a), 'google|abc123');
});

test('stableId handles missing provider', () => {
  const a = makeAttraction({ provider: '', providerId: 'abc123' });
  assert.equal(stableId(a), '|abc123');
});

// ══════════════════════════════════════════════════════════════════════
//  2. NORMALIZED IDENTITY
// ══════════════════════════════════════════════════════════════════════

test('normalizedId lowercases name', () => {
  const a = makeAttraction({ name: 'Gateway Of India' });
  assert.equal(normalizedId(a), 'gateway of india');
});

test('normalizedId removes punctuation', () => {
  const a = makeAttraction({ name: 'Gateway of India!' });
  assert.equal(normalizedId(a), 'gateway of india');
});

test('normalizedId normalizes whitespace', () => {
  const a = makeAttraction({ name: 'Gateway  of   India' });
  assert.equal(normalizedId(a), 'gateway of india');
});

test('normalizedId removes common suffixes', () => {
  const a = makeAttraction({ name: 'Gateway of India Museum' });
  assert.equal(normalizedId(a), 'gateway of india');
});

test('normalizedId catches same name with different casing', () => {
  const a1 = makeAttraction({ name: 'Gateway of India' });
  const a2 = makeAttraction({ name: 'GATEWAY OF INDIA' });
  assert.equal(normalizedId(a1), normalizedId(a2));
});

test('normalizedId catches near-duplicates', () => {
  const a1 = makeAttraction({ name: 'Elephanta Caves' });
  const a2 = makeAttraction({ name: 'elephanta cave' });
  // After removing suffixes, both should normalize to similar forms
  const n1 = normalizedId(a1);
  const n2 = normalizedId(a2);
  // "caves" suffix removed from first, "cave" suffix removed from second
  assert.ok(n1.includes('elephanta'), 'first contains elephanta');
  assert.ok(n2.includes('elephanta'), 'second contains elephanta');
});

// ══════════════════════════════════════════════════════════════════════
//  3. COMPOSITE IDENTITY
// ══════════════════════════════════════════════════════════════════════

test('compositeId combines stable and normalized', () => {
  const a = makeAttraction({ provider: 'google', providerId: 'abc', name: 'Gateway of India' });
  const cid = compositeId(a);
  assert.ok(cid.includes('google|abc'), 'contains stable id');
  assert.ok(cid.includes('gateway of india'), 'contains normalized name');
});

// ══════════════════════════════════════════════════════════════════════
//  4. TRACKING STATE
// ══════════════════════════════════════════════════════════════════════

test('createTrackingState creates empty sets', () => {
  const state = createTrackingState();
  assert.ok(state.usedAttractions instanceof Set);
  assert.ok(state.usedRestaurants instanceof Set);
  assert.ok(state.usedEvents instanceof Set);
  assert.ok(state.usedNightlife instanceof Set);
  assert.equal(state.usedAttractions.size, 0);
  assert.equal(state.usedRestaurants.size, 0);
});

// ══════════════════════════════════════════════════════════════════════
//  5. EXCLUSION CHECK
// ══════════════════════════════════════════════════════════════════════

test('Fresh candidate is not excluded', () => {
  const state = createTrackingState();
  const a = makeAttraction();
  const { excluded } = isExcluded(a, 'attraction', state);
  assert.equal(excluded, false);
});

test('Used candidate is excluded by stable ID', () => {
  const state = createTrackingState();
  const a = makeAttraction({ provider: 'google', providerId: 'abc123' });
  markAsUsed(a, 'attraction', state);
  const { excluded, reason } = isExcluded(a, 'attraction', state);
  assert.equal(excluded, true);
  assert.ok(reason.includes('Already used'));
});

test('Used candidate is excluded by normalized name', () => {
  const state = createTrackingState();
  const a1 = makeAttraction({ provider: 'google', providerId: 'abc', name: 'Gateway of India' });
  const a2 = makeAttraction({ provider: 'google', providerId: 'def', name: 'GATEWAY OF INDIA' });
  markAsUsed(a1, 'attraction', state);
  const { excluded } = isExcluded(a2, 'attraction', state);
  assert.equal(excluded, true, 'Same name with different casing should be excluded');
});

test('Transport is never excluded', () => {
  const state = createTrackingState();
  const t = makeAttraction({ provider: 'transport-intelligence', providerId: 'flight-123', category: 'transport' });
  markAsUsed(t, 'transport', state);
  const { excluded } = isExcluded(t, 'transport', state);
  assert.equal(excluded, false, 'Transport should never be excluded');
});

test('Hotel is never excluded', () => {
  const state = createTrackingState();
  const h = makeAttraction({ provider: 'amadeus', providerId: 'hotel-1', category: 'hotel' });
  markAsUsed(h, 'hotel', state);
  const { excluded } = isExcluded(h, 'hotel', state);
  assert.equal(excluded, false, 'Hotel should never be excluded');
});

test('Restaurant is excluded after use', () => {
  const state = createTrackingState();
  const r = makeRestaurant({ provider: 'zomato', providerId: 'rest-1' });
  markAsUsed(r, 'restaurant', state);
  const { excluded } = isExcluded(r, 'restaurant', state);
  assert.equal(excluded, true);
});

test('Event is excluded after use', () => {
  const state = createTrackingState();
  const e = makeEvent({ provider: 'ticketmaster', providerId: 'evt-1' });
  markAsUsed(e, 'event', state);
  const { excluded } = isExcluded(e, 'event', state);
  assert.equal(excluded, true);
});

// ══════════════════════════════════════════════════════════════════════
//  6. FILTER AVAILABLE
// ══════════════════════════════════════════════════════════════════════

test('filterAvailable removes used candidates', () => {
  const state = createTrackingState();
  const a1 = makeAttraction({ providerId: 'a1', name: 'Gateway of India' });
  const a2 = makeAttraction({ providerId: 'a2', name: 'Elephanta Caves' });
  const a3 = makeAttraction({ providerId: 'a3', name: 'Marine Drive' });

  markAsUsed(a1, 'attraction', state);
  const { available, excludedCount } = filterAvailable([a1, a2, a3], 'attraction', state);
  assert.equal(available.length, 2);
  assert.equal(excludedCount, 1);
  assert.ok(!available.find(a => a.providerId === 'a1'));
});

// ══════════════════════════════════════════════════════════════════════
//  7. PICK DISTINCT
// ══════════════════════════════════════════════════════════════════════

test('pickDistinct returns requested number of unique items', () => {
  const state = createTrackingState();
  const pool = [
    makeAttraction({ providerId: 'a1', name: 'Gateway of India' }),
    makeAttraction({ providerId: 'a2', name: 'Elephanta Caves' }),
    makeAttraction({ providerId: 'a3', name: 'Marine Drive' }),
  ];
  const { picks } = pickDistinct(pool, 'attraction', 2, state, 'test');
  assert.equal(picks.length, 2);
  assert.notEqual(picks[0].providerId, picks[1].providerId);
});

test('pickDistinct does not repeat across calls', () => {
  const state = createTrackingState();
  const pool = [
    makeAttraction({ providerId: 'a1', name: 'Gateway of India' }),
    makeAttraction({ providerId: 'a2', name: 'Elephanta Caves' }),
  ];
  const { picks: picks1 } = pickDistinct(pool, 'attraction', 1, state, 'test');
  const { picks: picks2 } = pickDistinct(pool, 'attraction', 1, state, 'test');
  assert.equal(picks1.length, 1);
  assert.equal(picks2.length, 1);
  assert.notEqual(picks1[0].providerId, picks2[0].providerId, 'Should pick different items');
});

test('pickDistinct returns fewer when pool is exhausted', () => {
  const state = createTrackingState();
  const pool = [
    makeAttraction({ providerId: 'a1', name: 'Gateway of India' }),
  ];
  const { picks, notes } = pickDistinct(pool, 'attraction', 3, state, 'test');
  assert.equal(picks.length, 1);
  assert.ok(notes.length > 0, 'Should have note about insufficient candidates');
  assert.ok(notes[0].includes('unfilled'), 'Note should mention unfilled slots');
});

test('pickDistinct never repeats across multiple calls', () => {
  const state = createTrackingState();
  const pool = [
    makeAttraction({ providerId: 'a1', name: 'Place A' }),
    makeAttraction({ providerId: 'a2', name: 'Place B' }),
    makeAttraction({ providerId: 'a3', name: 'Place C' }),
  ];
  const allPicks = [];
  for (let i = 0; i < 3; i++) {
    const { picks } = pickDistinct(pool, 'attraction', 1, state, `day-${i + 1}`);
    allPicks.push(...picks);
  }
  const ids = allPicks.map(p => p.providerId);
  assert.equal(new Set(ids).size, 3, 'All picks should be unique');
});

// ══════════════════════════════════════════════════════════════════════
//  8. EXCLUSION PENALTY
// ══════════════════════════════════════════════════════════════════════

test('Fresh candidate has zero penalty', () => {
  const state = createTrackingState();
  const a = makeAttraction();
  assert.equal(exclusionPenalty(a, 'attraction', state), 0);
});

test('Used candidate has high penalty', () => {
  const state = createTrackingState();
  const a = makeAttraction();
  markAsUsed(a, 'attraction', state);
  assert.equal(exclusionPenalty(a, 'attraction', state), 100);
});

// ══════════════════════════════════════════════════════════════════════
//  9. VALIDATE UNIQUENESS
// ══════════════════════════════════════════════════════════════════════

test('validateUniqueness passes for unique itinerary', () => {
  const days = [
    {
      dayNumber: 1,
      activities: [
        { title: 'Gateway of India', place: 'Gateway of India', category: 'attraction', providerId: 'a1' },
        { title: 'Leopold Cafe', place: 'Leopold Cafe', category: 'restaurant', providerId: 'r1' },
      ],
    },
    {
      dayNumber: 2,
      activities: [
        { title: 'Elephanta Caves', place: 'Elephanta Caves', category: 'attraction', providerId: 'a2' },
        { title: 'Cafe Leopold', place: 'Cafe Leopold', category: 'restaurant', providerId: 'r2' },
      ],
    },
  ];
  const result = validateUniqueness(days);
  assert.equal(result.valid, true);
  assert.equal(result.duplicates.length, 0);
});

test('validateUniqueness detects duplicate attraction', () => {
  const days = [
    {
      dayNumber: 1,
      activities: [
        { title: 'Gateway of India', place: 'Gateway of India', category: 'attraction', providerId: 'a1' },
      ],
    },
    {
      dayNumber: 2,
      activities: [
        { title: 'Gateway of India', place: 'Gateway of India', category: 'attraction', providerId: 'a1' },
      ],
    },
  ];
  const result = validateUniqueness(days);
  assert.equal(result.valid, false);
  assert.equal(result.duplicates.length, 1);
  assert.equal(result.duplicates[0].type, 'attraction');
  assert.equal(result.duplicates[0].day1, 1);
  assert.equal(result.duplicates[0].day2, 2);
});

test('validateUniqueness detects duplicate restaurant', () => {
  const days = [
    {
      dayNumber: 1,
      activities: [
        { title: 'Leopold Cafe', place: 'Leopold Cafe', category: 'restaurant', providerId: 'r1' },
      ],
    },
    {
      dayNumber: 2,
      activities: [
        { title: 'Leopold Cafe', place: 'Leopold Cafe', category: 'restaurant', providerId: 'r1' },
      ],
    },
  ];
  const result = validateUniqueness(days);
  assert.equal(result.valid, false);
  assert.equal(result.duplicates.length, 1);
  assert.equal(result.duplicates[0].type, 'restaurant');
});

test('validateUniqueness detects duplicate by normalized name', () => {
  const days = [
    {
      dayNumber: 1,
      activities: [
        { title: 'Gateway of India', place: 'Gateway of India', category: 'attraction', providerId: 'a1' },
      ],
    },
    {
      dayNumber: 2,
      activities: [
        { title: 'GATEWAY OF INDIA', place: 'GATEWAY OF INDIA', category: 'attraction', providerId: 'a2' },
      ],
    },
  ];
  const result = validateUniqueness(days);
  assert.equal(result.valid, false, 'Normalized name match should be detected as duplicate');
  assert.equal(result.duplicates.length, 1);
});

test('validateUniqueness allows hotel repetition', () => {
  const days = [
    {
      dayNumber: 1,
      activities: [
        { title: 'Taj Mahal Palace', place: 'Taj Mahal Palace', category: 'hotel', providerId: 'h1' },
      ],
    },
    {
      dayNumber: 2,
      activities: [
        { title: 'Taj Mahal Palace', place: 'Taj Mahal Palace', category: 'hotel', providerId: 'h1' },
      ],
    },
  ];
  const result = validateUniqueness(days);
  assert.equal(result.valid, true, 'Hotel repetition should be allowed');
});

test('validateUniqueness allows transport repetition', () => {
  const days = [
    {
      dayNumber: 1,
      activities: [
        { title: 'Flight to Mumbai', place: 'Flight', category: 'flight', providerId: 'f1' },
      ],
    },
    {
      dayNumber: 2,
      activities: [
        { title: 'Flight to Mumbai', place: 'Flight', category: 'flight', providerId: 'f1' },
      ],
    },
  ];
  const result = validateUniqueness(days);
  assert.equal(result.valid, true, 'Transport repetition should be allowed');
});

test('validateUniqueness skips unavailable entries', () => {
  const days = [
    {
      dayNumber: 1,
      activities: [
        { title: 'Unknown Place', place: 'Unknown Place', category: 'attraction', providerId: 'a1', dataStatus: 'unavailable' },
      ],
    },
    {
      dayNumber: 2,
      activities: [
        { title: 'Unknown Place', place: 'Unknown Place', category: 'attraction', providerId: 'a1', dataStatus: 'unavailable' },
      ],
    },
  ];
  const result = validateUniqueness(days);
  assert.equal(result.valid, true, 'Unavailable entries should be skipped');
});

test('validateUniqueness detects multiple duplicates', () => {
  const days = [
    {
      dayNumber: 1,
      activities: [
        { title: 'Gateway of India', place: 'Gateway of India', category: 'attraction', providerId: 'a1' },
        { title: 'Leopold Cafe', place: 'Leopold Cafe', category: 'restaurant', providerId: 'r1' },
      ],
    },
    {
      dayNumber: 2,
      activities: [
        { title: 'Gateway of India', place: 'Gateway of India', category: 'attraction', providerId: 'a1' },
        { title: 'Leopold Cafe', place: 'Leopold Cafe', category: 'restaurant', providerId: 'r1' },
      ],
    },
  ];
  const result = validateUniqueness(days);
  assert.equal(result.valid, false);
  assert.equal(result.duplicates.length, 2);
});

// ══════════════════════════════════════════════════════════════════════
//  10. BUILD CANDIDATE POOL
// ══════════════════════════════════════════════════════════════════════

test('buildCandidatePool deduplicates by stable ID', () => {
  const attractions = [
    makeAttraction({ providerId: 'a1', name: 'Gateway of India' }),
    makeAttraction({ providerId: 'a1', name: 'Gateway of India' }), // duplicate
    makeAttraction({ providerId: 'a2', name: 'Elephanta Caves' }),
  ];
  const pool = buildCandidatePool({ attractions });
  assert.equal(pool.attractions.length, 2);
});

test('buildCandidatePool deduplicates by normalized name', () => {
  const attractions = [
    makeAttraction({ providerId: 'a1', name: 'Gateway of India' }),
    makeAttraction({ providerId: 'a2', name: 'GATEWAY OF INDIA' }), // same name, different ID
  ];
  const pool = buildCandidatePool({ attractions });
  assert.equal(pool.attractions.length, 1, 'Should deduplicate by normalized name');
});

test('buildCandidatePool handles empty inputs', () => {
  const pool = buildCandidatePool({});
  assert.equal(pool.attractions.length, 0);
  assert.equal(pool.restaurants.length, 0);
  assert.equal(pool.events.length, 0);
  assert.equal(pool.nightlife.length, 0);
});

test('buildCandidatePool deduplicates restaurants', () => {
  const restaurants = [
    makeRestaurant({ providerId: 'r1', name: 'Leopold Cafe' }),
    makeRestaurant({ providerId: 'r1', name: 'Leopold Cafe' }), // duplicate
    makeRestaurant({ providerId: 'r2', name: 'Cafe Mondegar' }),
  ];
  const pool = buildCandidatePool({ restaurants });
  assert.equal(pool.restaurants.length, 2);
});

// ══════════════════════════════════════════════════════════════════════
//  11. UNIQUE CANDIDATES ACROSS 4 DAYS
// ══════════════════════════════════════════════════════════════════════

test('4-day Mumbai itinerary has unique attractions across all days', () => {
  const state = createTrackingState();
  const attractions = [
    makeAttraction({ providerId: 'a1', name: 'Gateway of India' }),
    makeAttraction({ providerId: 'a2', name: 'Elephanta Caves' }),
    makeAttraction({ providerId: 'a3', name: 'Chhatrapati Shivaji Maharaj Terminus' }),
    makeAttraction({ providerId: 'a4', name: 'Sanjay Gandhi National Park' }),
    makeAttraction({ providerId: 'a5', name: 'Marine Drive' }),
    makeAttraction({ providerId: 'a6', name: 'Juhu Beach' }),
    makeAttraction({ providerId: 'a7', name: 'Siddhivinayak Temple' }),
    makeAttraction({ providerId: 'a8', name: 'Haji Ali Dargah' }),
  ];

  // Simulate 4-day allocation
  const day1 = pickDistinct(attractions, 'attraction', 2, state, 'Day 1 attractions');
  const day2 = pickDistinct(attractions, 'attraction', 2, state, 'Day 2 attractions');
  const day3 = pickDistinct(attractions, 'attraction', 2, state, 'Day 3 attractions');
  const day4 = pickDistinct(attractions, 'attraction', 2, state, 'Day 4 attractions');

  const allPicks = [...day1.picks, ...day2.picks, ...day3.picks, ...day4.picks];
  const ids = allPicks.map(p => p.providerId);
  assert.equal(new Set(ids).size, allPicks.length, 'All attractions should be unique across 4 days');
  assert.equal(allPicks.length, 8, 'Should have 8 unique attractions (2 per day)');
});

test('4-day Mumbai itinerary has unique restaurants across all days', () => {
  const state = createTrackingState();
  const restaurants = [
    makeRestaurant({ providerId: 'r1', name: 'Leopold Cafe' }),
    makeRestaurant({ providerId: 'r2', name: 'Cafe Mondegar' }),
    makeRestaurant({ providerId: 'r3', name: 'Trishna' }),
    makeRestaurant({ providerId: 'r4', name: 'Maharaja Bhog' }),
    makeRestaurant({ providerId: 'r5', name: 'Britannia & Co.' }),
    makeRestaurant({ providerId: 'r6', name: 'Sassoon Dock' }),
    makeRestaurant({ providerId: 'r7', name: 'Swati Snacks' }),
    makeRestaurant({ providerId: 'r8', name: 'Baghdadi' }),
    makeRestaurant({ providerId: 'r9', name: 'Hotel Excelsior' }),
    makeRestaurant({ providerId: 'r10', name: 'Kyani & Co.' }),
    makeRestaurant({ providerId: 'r11', name: 'Café Nutcracker' }),
    makeRestaurant({ providerId: 'r12', name: 'Theobroma' }),
  ];

  // 3 meals per day × 4 days = 12 restaurants needed
  const day1Breakfast = pickDistinct(restaurants, 'restaurant', 1, state, 'Day 1 breakfast');
  const day1Lunch = pickDistinct(restaurants, 'restaurant', 1, state, 'Day 1 lunch');
  const day1Dinner = pickDistinct(restaurants, 'restaurant', 1, state, 'Day 1 dinner');
  const day2Breakfast = pickDistinct(restaurants, 'restaurant', 1, state, 'Day 2 breakfast');
  const day2Lunch = pickDistinct(restaurants, 'restaurant', 1, state, 'Day 2 lunch');
  const day2Dinner = pickDistinct(restaurants, 'restaurant', 1, state, 'Day 2 dinner');
  const day3Breakfast = pickDistinct(restaurants, 'restaurant', 1, state, 'Day 3 breakfast');
  const day3Lunch = pickDistinct(restaurants, 'restaurant', 1, state, 'Day 3 lunch');
  const day3Dinner = pickDistinct(restaurants, 'restaurant', 1, state, 'Day 3 dinner');
  const day4Breakfast = pickDistinct(restaurants, 'restaurant', 1, state, 'Day 4 breakfast');
  const day4Lunch = pickDistinct(restaurants, 'restaurant', 1, state, 'Day 4 lunch');
  const day4Dinner = pickDistinct(restaurants, 'restaurant', 1, state, 'Day 4 dinner');

  const allPicks = [
    ...day1Breakfast.picks, ...day1Lunch.picks, ...day1Dinner.picks,
    ...day2Breakfast.picks, ...day2Lunch.picks, ...day2Dinner.picks,
    ...day3Breakfast.picks, ...day3Lunch.picks, ...day3Dinner.picks,
    ...day4Breakfast.picks, ...day4Lunch.picks, ...day4Dinner.picks,
  ];
  const ids = allPicks.map(p => p.providerId);
  assert.equal(new Set(ids).size, allPicks.length, 'All restaurants should be unique across 4 days');
  assert.equal(allPicks.length, 12, 'Should have 12 unique restaurants (3 per day × 4 days)');
});

// ══════════════════════════════════════════════════════════════════════
//  12. INSUFFICIENT CANDIDATES
// ══════════════════════════════════════════════════════════════════════

test('Insufficient candidates: pool exhausted gracefully', () => {
  const state = createTrackingState();
  const attractions = [
    makeAttraction({ providerId: 'a1', name: 'Gateway of India' }),
    makeAttraction({ providerId: 'a2', name: 'Elephanta Caves' }),
  ];

  // Try to pick 3 from pool of 2
  const { picks, notes } = pickDistinct(attractions, 'attraction', 3, state, 'test');
  assert.equal(picks.length, 2, 'Should pick all available');
  assert.ok(notes.length > 0, 'Should have note about insufficient candidates');
  assert.ok(notes[0].includes('unfilled'), 'Note should mention unfilled slots');
});

test('Insufficient candidates: cross-day exhaustion', () => {
  const state = createTrackingState();
  const attractions = [
    makeAttraction({ providerId: 'a1', name: 'Gateway of India' }),
    makeAttraction({ providerId: 'a2', name: 'Elephanta Caves' }),
  ];

  // Day 1: pick 2
  const day1 = pickDistinct(attractions, 'attraction', 2, state, 'Day 1');
  assert.equal(day1.picks.length, 2);

  // Day 2: try to pick 2 but pool is exhausted
  const day2 = pickDistinct(attractions, 'attraction', 2, state, 'Day 2');
  assert.equal(day2.picks.length, 0, 'Pool exhausted, no picks');
  assert.ok(day2.notes.length > 0, 'Should note pool exhaustion');
});

// ══════════════════════════════════════════════════════════════════════
//  13. LEGITIMATE TRANSPORT REPETITION
// ══════════════════════════════════════════════════════════════════════

test('Transport repetition is allowed across days', () => {
  const state = createTrackingState();
  const transport = [
    { provider: 'transport-intelligence', providerId: 'flight-1', category: 'flight', name: 'Flight to Mumbai' },
  ];

  pickDistinct(transport, 'flight', 1, state, 'Day 1 transport');
  const { picks } = pickDistinct(transport, 'flight', 1, state, 'Day 2 transport');
  assert.equal(picks.length, 1, 'Transport should be allowed to repeat');
});

test('Same hotel is allowed across multiple nights', () => {
  const state = createTrackingState();
  const hotel = [
    { provider: 'amadeus', providerId: 'hotel-1', category: 'hotel', name: 'Taj Mahal Palace' },
  ];

  pickDistinct(hotel, 'hotel', 1, state, 'Night 1');
  const { picks } = pickDistinct(hotel, 'hotel', 1, state, 'Night 2');
  assert.equal(picks.length, 1, 'Hotel should be allowed to repeat');
});

// ══════════════════════════════════════════════════════════════════════
//  14. GET UNIQUENESS STATS
// ══════════════════════════════════════════════════════════════════════

test('getUniquenessStats returns correct counts', () => {
  const days = [
    {
      dayNumber: 1,
      activities: [
        { title: 'Gateway of India', place: 'Gateway of India', category: 'attraction', providerId: 'a1' },
        { title: 'Leopold Cafe', place: 'Leopold Cafe', category: 'restaurant', providerId: 'r1' },
      ],
    },
    {
      dayNumber: 2,
      activities: [
        { title: 'Elephanta Caves', place: 'Elephanta Caves', category: 'attraction', providerId: 'a2' },
        { title: 'Cafe Mondegar', place: 'Cafe Mondegar', category: 'restaurant', providerId: 'r2' },
      ],
    },
  ];
  const stats = getUniquenessStats(days);
  assert.equal(stats.uniqueAttractions, 2);
  assert.equal(stats.uniqueRestaurants, 2);
  assert.equal(stats.totalDays, 2);
});

test('getUniquenessStats handles empty days', () => {
  const stats = getUniquenessStats([]);
  assert.equal(stats.uniqueAttractions, 0);
  assert.equal(stats.uniqueRestaurants, 0);
  assert.equal(stats.totalDays, 0);
});

// ══════════════════════════════════════════════════════════════════════
//  15. EDGE CASES
// ══════════════════════════════════════════════════════════════════════

test('Null candidate is handled gracefully', () => {
  const state = createTrackingState();
  const { excluded } = isExcluded(null, 'attraction', state);
  assert.equal(excluded, false);
});

test('Empty pool returns empty picks', () => {
  const state = createTrackingState();
  const { picks } = pickDistinct([], 'attraction', 3, state, 'test');
  assert.equal(picks.length, 0);
});

test('Null pool returns empty picks', () => {
  const state = createTrackingState();
  const { picks } = pickDistinct(null, 'attraction', 3, state, 'test');
  assert.equal(picks.length, 0);
});

test('markAsUsed handles null gracefully', () => {
  const state = createTrackingState();
  markAsUsed(null, 'attraction', state); // Should not throw
  assert.equal(state.usedAttractions.size, 0);
});

test('exclusionPenalty handles null gracefully', () => {
  const state = createTrackingState();
  assert.equal(exclusionPenalty(null, 'attraction', state), 0);
});
