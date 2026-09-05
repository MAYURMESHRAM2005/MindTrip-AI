import test from 'node:test';
import assert from 'node:assert/strict';
import orchestratorModule from '../src/orchestrator/orchestratorAIPlanning.js';

const { rebuildCosts } = orchestratorModule;

// ══════════════════════════════════════════════════════════════════════
//  FIXTURES
// ══════════════════════════════════════════════════════════════════════

function makeActivity(overrides = {}) {
  return {
    title: 'Test Activity',
    place: 'Test Place',
    category: 'attraction',
    provider: 'google',
    providerId: 'test-1',
    time: '09:00',
    cost: { amount: 200, currency: 'INR', isEstimate: false, source: 'google', dataStatus: 'live' },
    source: 'google',
    dataStatus: 'live',
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

// ══════════════════════════════════════════════════════════════════════
//  1. DIFFERENT PROVIDER PRICES → DIFFERENT DAILY TOTALS
// ══════════════════════════════════════════════════════════════════════

test('Different hotel prices produce different daily totals', () => {
  const days1 = [makeDay({ activities: [makeActivity({ category: 'hotel', slot: 'hotel', cost: { amount: 3000, currency: 'INR', isEstimate: false, source: 'amadeus', dataStatus: 'live' }, time: '15:00', title: 'Hotel' })] })];
  const days2 = [makeDay({ activities: [makeActivity({ category: 'hotel', slot: 'hotel', cost: { amount: 8000, currency: 'INR', isEstimate: false, source: 'amadeus', dataStatus: 'live' }, time: '15:00', title: 'Hotel' })] })];

  rebuildCosts(days1, { partySize: 2, totalBudget: 50000 });
  rebuildCosts(days2, { partySize: 2, totalBudget: 50000 });

  assert.notEqual(days1[0].dayCost, days2[0].dayCost);
  assert.equal(days1[0].dayCost, 3000);
  assert.equal(days2[0].dayCost, 8000);
});

test('Different restaurant prices produce different daily totals', () => {
  const days1 = [makeDay({ activities: [
    makeActivity({ category: 'restaurant', slot: 'breakfast', cost: { amount: 400, currency: 'INR', isEstimate: false, source: 'zomato', dataStatus: 'live' }, time: '08:00', title: 'Breakfast' }),
    makeActivity({ category: 'restaurant', slot: 'lunch', cost: { amount: 600, currency: 'INR', isEstimate: false, source: 'zomato', dataStatus: 'live' }, time: '13:00', title: 'Lunch' }),
  ] })];
  const days2 = [makeDay({ activities: [
    makeActivity({ category: 'restaurant', slot: 'breakfast', cost: { amount: 200, currency: 'INR', isEstimate: false, source: 'zomato', dataStatus: 'live' }, time: '08:00', title: 'Breakfast' }),
    makeActivity({ category: 'restaurant', slot: 'lunch', cost: { amount: 1500, currency: 'INR', isEstimate: false, source: 'zomato', dataStatus: 'live' }, time: '13:00', title: 'Lunch' }),
  ] })];

  rebuildCosts(days1, { partySize: 2, totalBudget: 50000 });
  rebuildCosts(days2, { partySize: 2, totalBudget: 50000 });

  assert.notEqual(days1[0].dayCost, days2[0].dayCost);
  assert.equal(days1[0].dayCost, 1000);
  assert.equal(days2[0].dayCost, 1700);
});

test('Multi-day itinerary with different per-day costs', () => {
  const days = [
    makeDay({ dayNumber: 1, activities: [
      makeActivity({ category: 'hotel', slot: 'hotel', cost: { amount: 3000, currency: 'INR', isEstimate: false, source: 'amadeus', dataStatus: 'live' }, time: '15:00', title: 'Hotel' }),
      makeActivity({ category: 'restaurant', slot: 'breakfast', cost: { amount: 400, currency: 'INR', isEstimate: false, source: 'zomato', dataStatus: 'live' }, time: '08:00', title: 'Breakfast' }),
    ] }),
    makeDay({ dayNumber: 2, date: '2025-06-02', activities: [
      makeActivity({ category: 'hotel', slot: 'hotel', cost: { amount: 3000, currency: 'INR', isEstimate: false, source: 'amadeus', dataStatus: 'live' }, time: '15:00', title: 'Hotel' }),
      makeActivity({ category: 'attraction', slot: 'morning', cost: { amount: 500, currency: 'INR', isEstimate: false, source: 'viator', dataStatus: 'live' }, time: '10:00', title: 'Attraction' }),
    ] }),
    makeDay({ dayNumber: 3, date: '2025-06-03', activities: [
      makeActivity({ category: 'restaurant', slot: 'lunch', cost: { amount: 800, currency: 'INR', isEstimate: false, source: 'zomato', dataStatus: 'live' }, time: '13:00', title: 'Lunch' }),
    ] }),
  ];

  rebuildCosts(days, { partySize: 2, totalBudget: 50000 });

  // Day 1: hotel 3000 + breakfast 400 = 3400
  assert.equal(days[0].dayCost, 3400);
  // Day 2: hotel 3000 + attraction 500 = 3500
  assert.equal(days[1].dayCost, 3500);
  // Day 3: lunch 800
  assert.equal(days[2].dayCost, 800);

  // Cumulative totals
  assert.equal(days[0].cumulativeCost, 3400);
  assert.equal(days[1].cumulativeCost, 6900);
  assert.equal(days[2].cumulativeCost, 7700);

  // Remaining budget
  assert.equal(days[0].remainingBudget, 46600);
  assert.equal(days[1].remainingBudget, 43100);
  assert.equal(days[2].remainingBudget, 42300);
});

// ══════════════════════════════════════════════════════════════════════
//  2. NULL AMOUNTS TREATED AS 0 IN TOTALS
// ══════════════════════════════════════════════════════════════════════

test('Null cost amounts are treated as 0 in day total', () => {
  const days = [makeDay({ activities: [
    makeActivity({ cost: { amount: null, currency: 'INR', isEstimate: false, source: 'unavailable', dataStatus: 'unavailable' } }),
    makeActivity({ cost: { amount: 500, currency: 'INR', isEstimate: false, source: 'google', dataStatus: 'live' }, title: 'Activity 2', time: '14:00' }),
  ] })];

  rebuildCosts(days, { partySize: 2, totalBudget: 50000 });

  assert.equal(days[0].dayCost, 500);
  assert.equal(days[0].costBreakdown.activities, 500);
});

// ══════════════════════════════════════════════════════════════════════
//  3. CUMULATIVE TOTAL IS CORRECT
// ══════════════════════════════════════════════════════════════════════

test('Cumulative total equals sum of all day totals', () => {
  const days = [
    makeDay({ dayNumber: 1, activities: [makeActivity({ cost: { amount: 1000, currency: 'INR', isEstimate: false, source: 'test', dataStatus: 'live' } })] }),
    makeDay({ dayNumber: 2, date: '2025-06-02', activities: [makeActivity({ cost: { amount: 2000, currency: 'INR', isEstimate: false, source: 'test', dataStatus: 'live' }, title: 'Activity 2', time: '14:00' })] }),
    makeDay({ dayNumber: 3, date: '2025-06-03', activities: [makeActivity({ cost: { amount: 1500, currency: 'INR', isEstimate: false, source: 'test', dataStatus: 'live' }, title: 'Activity 3', time: '10:00' })] }),
  ];

  rebuildCosts(days, { partySize: 2, totalBudget: 50000 });

  const totalDayCosts = days.reduce((sum, d) => sum + d.dayCost, 0);
  assert.equal(days[2].cumulativeCost, totalDayCosts);
  assert.equal(days[2].cumulativeCost, 4500);
});

// ══════════════════════════════════════════════════════════════════════
//  4. REMAINING BUDGET IS CORRECT
// ══════════════════════════════════════════════════════════════════════

test('Remaining budget equals totalBudget minus cumulative', () => {
  const days = [
    makeDay({ dayNumber: 1, activities: [makeActivity({ cost: { amount: 5000, currency: 'INR', isEstimate: false, source: 'test', dataStatus: 'live' } })] }),
    makeDay({ dayNumber: 2, date: '2025-06-02', activities: [makeActivity({ cost: { amount: 3000, currency: 'INR', isEstimate: false, source: 'test', dataStatus: 'live' }, title: 'Activity 2', time: '14:00' })] }),
  ];

  rebuildCosts(days, { partySize: 2, totalBudget: 20000 });

  assert.equal(days[0].remainingBudget, 15000);
  assert.equal(days[1].remainingBudget, 12000);
});

test('Negative remaining budget is not hidden', () => {
  const days = [makeDay({ activities: [makeActivity({ cost: { amount: 25000, currency: 'INR', isEstimate: false, source: 'test', dataStatus: 'live' } })] })];

  rebuildCosts(days, { partySize: 2, totalBudget: 20000 });

  assert.equal(days[0].remainingBudget, -5000);
});

// ══════════════════════════════════════════════════════════════════════
//  5. COST BREAKDOWN CATEGORIES
// ══════════════════════════════════════════════════════════════════════

test('Cost breakdown correctly categorizes activities', () => {
  const days = [makeDay({ activities: [
    makeActivity({ category: 'hotel', slot: 'hotel', cost: { amount: 3000, currency: 'INR' }, time: '15:00', title: 'Hotel' }),
    makeActivity({ category: 'restaurant', slot: 'breakfast', cost: { amount: 400, currency: 'INR' }, time: '08:00', title: 'Breakfast' }),
    makeActivity({ category: 'restaurant', slot: 'lunch', cost: { amount: 600, currency: 'INR' }, time: '13:00', title: 'Lunch' }),
    makeActivity({ category: 'attraction', slot: 'morning', cost: { amount: 200, currency: 'INR' }, time: '10:00', title: 'Attraction' }),
    makeActivity({ category: 'attraction', slot: 'evening', cost: { amount: 150, currency: 'INR' }, time: '17:00', title: 'Evening' }),
  ] })];

  rebuildCosts(days, { partySize: 2, totalBudget: 50000 });

  assert.equal(days[0].costBreakdown.accommodation, 3000);
  assert.equal(days[0].costBreakdown.breakfast, 400);
  assert.equal(days[0].costBreakdown.lunch, 600);
  assert.equal(days[0].costBreakdown.activities, 200);
  assert.equal(days[0].costBreakdown.evening, 150);
  assert.equal(days[0].dayCost, 4350);
});

// ══════════════════════════════════════════════════════════════════════
//  6. NO DUPLICATE FALLBACK COSTS
// ══════════════════════════════════════════════════════════════════════

test('Days with different activities have different costs', () => {
  const days = [
    makeDay({ dayNumber: 1, activities: [
      makeActivity({ category: 'attraction', cost: { amount: 100, currency: 'INR' }, time: '09:00', title: 'Cheap Attraction' }),
    ] }),
    makeDay({ dayNumber: 2, date: '2025-06-02', activities: [
      makeActivity({ category: 'attraction', cost: { amount: 500, currency: 'INR' }, time: '09:00', title: 'Expensive Attraction' }),
    ] }),
    makeDay({ dayNumber: 3, date: '2025-06-03', activities: [
      makeActivity({ category: 'attraction', cost: { amount: 250, currency: 'INR' }, time: '09:00', title: 'Medium Attraction' }),
    ] }),
  ];

  rebuildCosts(days, { partySize: 2, totalBudget: 50000 });

  // Each day should have a DIFFERENT cost
  assert.notEqual(days[0].dayCost, days[1].dayCost);
  assert.notEqual(days[1].dayCost, days[2].dayCost);
  assert.notEqual(days[0].dayCost, days[2].dayCost);

  assert.equal(days[0].dayCost, 100);
  assert.equal(days[1].dayCost, 500);
  assert.equal(days[2].dayCost, 250);
});

test('Null costs do not create identical fallback totals', () => {
  const days = [
    makeDay({ dayNumber: 1, activities: [
      makeActivity({ cost: { amount: null, currency: 'INR', dataStatus: 'unavailable' }, time: '09:00', title: 'Activity A' }),
    ] }),
    makeDay({ dayNumber: 2, date: '2025-06-02', activities: [
      makeActivity({ cost: { amount: null, currency: 'INR', dataStatus: 'unavailable' }, time: '09:00', title: 'Activity B' }),
    ] }),
  ];

  rebuildCosts(days, { partySize: 2, totalBudget: 50000 });

  // Both days should have 0 total (null = 0), not some fabricated fallback
  assert.equal(days[0].dayCost, 0);
  assert.equal(days[1].dayCost, 0);
  assert.equal(days[0].cumulativeCost, 0);
  assert.equal(days[1].cumulativeCost, 0);
});

// ══════════════════════════════════════════════════════════════════════
//  7. PER-PERSON COST
// ══════════════════════════════════════════════════════════════════════

test('Per-person cost is calculated correctly', () => {
  const days = [makeDay({ activities: [makeActivity({ cost: { amount: 1000, currency: 'INR', isEstimate: false, source: 'test', dataStatus: 'live' } })] })];
  rebuildCosts(days, { partySize: 4, totalBudget: 50000 });
  assert.equal(days[0].costBreakdown.perPerson, 250);
});

test('Budget with no totalBudget returns null remaining', () => {
  const days = [makeDay({ activities: [makeActivity({ cost: { amount: 1000, currency: 'INR' } })] })];
  rebuildCosts(days, { partySize: 2, totalBudget: 0 });
  assert.equal(days[0].remainingBudget, null);
});

// ══════════════════════════════════════════════════════════════════════
//  8. EDGE CASES
// ══════════════════════════════════════════════════════════════════════

test('Empty activities array produces zero day cost', () => {
  const days = [makeDay({ activities: [] })];
  rebuildCosts(days, { partySize: 2, totalBudget: 50000 });
  assert.equal(days[0].dayCost, 0);
  assert.equal(days[0].cumulativeCost, 0);
});

test('All null costs produce zero day total', () => {
  const days = [makeDay({ activities: [
    makeActivity({ cost: { amount: null, currency: 'INR', isEstimate: false, source: 'unavailable', dataStatus: 'unavailable' } }),
    makeActivity({ cost: { amount: null, currency: 'INR', isEstimate: false, source: 'unavailable', dataStatus: 'unavailable' }, title: 'Activity 2', time: '14:00' }),
  ] })];

  rebuildCosts(days, { partySize: 2, totalBudget: 50000 });
  assert.equal(days[0].dayCost, 0);
});

test('Mixed live and unavailable costs', () => {
  const days = [makeDay({ activities: [
    makeActivity({ cost: { amount: 500, currency: 'INR', dataStatus: 'live' }, time: '09:00', title: 'Live Activity' }),
    makeActivity({ cost: { amount: null, currency: 'INR', dataStatus: 'unavailable' }, time: '14:00', title: 'Unavailable Activity' }),
  ] })];

  rebuildCosts(days, { partySize: 2, totalBudget: 50000 });
  assert.equal(days[0].dayCost, 500);
});
