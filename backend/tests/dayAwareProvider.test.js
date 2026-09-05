import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateTripDays,
  getWeatherForDay,
  getEventsForDay,
  filterByOpeningHours,
  filterByTimeSlot,
  isPlaceOpenOnDay,
  isPlaceOpenAtHour,
  buildDaySpecificPools,
  buildEnrichedDayContexts,
  selectDayCandidates,
  enrichCandidatesWithDayAvailability,
  runDayAwarePipeline,
  getDayAbbreviation,
} from '../src/services/dayAwareProvider.service.js';

// ══════════════════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════════════════

function makeAttraction(overrides = {}) {
  return {
    id: `attr-${Math.random().toString(36).slice(2, 8)}`,
    name: 'Test Attraction',
    type: 'attraction',
    types: ['tourism.attraction'],
    openingHours: null,
    coordinates: { lat: 19.076, lng: 72.8777 },
    ...overrides,
  };
}

function makeRestaurant(overrides = {}) {
  return {
    id: `rest-${Math.random().toString(36).slice(2, 8)}`,
    name: 'Test Restaurant',
    type: 'restaurant',
    types: ['catering.restaurant'],
    openingHours: null,
    coordinates: { lat: 19.076, lng: 72.8777 },
    ...overrides,
  };
}

function makeEvent(overrides = {}) {
  return {
    id: `evt-${Math.random().toString(36).slice(2, 8)}`,
    name: 'Test Event',
    category: 'music',
    date: '2025-06-15',
    time: '19:00',
    venueName: 'Test Venue',
    ...overrides,
  };
}

function makeWeatherForecast(dateKey, overrides = {}) {
  return {
    date: dateKey,
    condition: 'Partly Cloudy',
    tempMin: 24,
    tempMax: 32,
    rainProbability: 30,
    humidity: 65,
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════════
//  1. GENERATE TRIP DAYS
// ══════════════════════════════════════════════════════════════════════

test('generateTripDays produces correct number of days', () => {
  const days = generateTripDays('2025-06-15', '2025-06-18');
  assert.equal(days.length, 4);
  assert.equal(days[0].dayNumber, 1);
  assert.equal(days[3].dayNumber, 4);
});

test('generateTripDays includes correct dateKeys', () => {
  const days = generateTripDays('2025-06-15', '2025-06-17');
  assert.equal(days[0].dateKey, '2025-06-15');
  assert.equal(days[1].dateKey, '2025-06-16');
  assert.equal(days[2].dateKey, '2025-06-17');
});

test('generateTripDays correctly identifies weekends', () => {
  // 2025-06-15 is a Sunday
  const days = generateTripDays('2025-06-14', '2025-06-16');
  assert.equal(days[0].isWeekend, true); // Saturday
  assert.equal(days[1].isWeekend, true); // Sunday
  assert.equal(days[2].isWeekend, false); // Monday
});

test('generateTripDays single day trip', () => {
  const days = generateTripDays('2025-06-15', '2025-06-15');
  assert.equal(days.length, 1);
  assert.equal(days[0].dayNumber, 1);
});

test('generateTripDays includes dayName', () => {
  const days = generateTripDays('2025-06-16', '2025-06-16');
  assert.equal(days[0].dayName, 'Monday');
});

// ══════════════════════════════════════════════════════════════════════
//  2. WEATHER FOR DAY
// ══════════════════════════════════════════════════════════════════════

test('getWeatherForDay returns forecast for matching date', () => {
  const forecast = [
    makeWeatherForecast('2025-06-15'),
    makeWeatherForecast('2025-06-16', { condition: 'Rainy' }),
  ];
  const result = getWeatherForDay(forecast, '2025-06-16');
  assert.equal(result.condition, 'Rainy');
});

test('getWeatherForDay returns null for non-matching date', () => {
  const forecast = [makeWeatherForecast('2025-06-15')];
  const result = getWeatherForDay(forecast, '2025-06-20');
  assert.equal(result, null);
});

test('getWeatherForDay handles empty forecast', () => {
  assert.equal(getWeatherForDay([], '2025-06-15'), null);
  assert.equal(getWeatherForDay(null, '2025-06-15'), null);
});

// ══════════════════════════════════════════════════════════════════════
//  3. EVENTS FOR DAY
// ══════════════════════════════════════════════════════════════════════

test('getEventsForDay returns events for matching date', () => {
  const events = [
    makeEvent({ date: '2025-06-15', name: 'Concert A' }),
    makeEvent({ date: '2025-06-16', name: 'Festival B' }),
    makeEvent({ date: '2025-06-15', name: 'Comedy Show C' }),
  ];
  const result = getEventsForDay(events, '2025-06-15');
  assert.equal(result.length, 2);
  assert.ok(result.some((e) => e.name === 'Concert A'));
  assert.ok(result.some((e) => e.name === 'Comedy Show C'));
});

test('getEventsForDay returns empty for non-matching date', () => {
  const events = [makeEvent({ date: '2025-06-15' })];
  const result = getEventsForDay(events, '2025-06-20');
  assert.equal(result.length, 0);
});

test('getEventsForDay handles null events', () => {
  assert.deepEqual(getEventsForDay(null, '2025-06-15'), []);
});

// ══════════════════════════════════════════════════════════════════════
//  4. OPENING HOURS
// ══════════════════════════════════════════════════════════════════════

test('isPlaceOpenOnDay returns true for open day', () => {
  const place = {
    openingHours: {
      periods: [{ days: ['Mo', 'Tu', 'We', 'Th', 'Fr'], open: '09:00', close: '18:00' }],
    },
  };
  // Monday = 1
  assert.equal(isPlaceOpenOnDay(place, 1), true);
});

test('isPlaceOpenOnDay returns false for closed day', () => {
  const place = {
    openingHours: {
      periods: [{ days: ['Mo', 'Tu', 'We', 'Th', 'Fr'], open: '09:00', close: '18:00' }],
    },
  };
  // Sunday = 0
  assert.equal(isPlaceOpenOnDay(place, 0), false);
});

test('isPlaceOpenOnDay returns null for no data', () => {
  assert.equal(isPlaceOpenOnDay({}, 1), null);
  assert.equal(isPlaceOpenOnDay(null, 1), null);
});

test('isPlaceOpenOnDay handles "all" days', () => {
  const place = {
    openingHours: {
      periods: [{ days: ['all'], open: '00:00', close: '23:59' }],
    },
  };
  assert.equal(isPlaceOpenOnDay(place, 0), true);
  assert.equal(isPlaceOpenOnDay(place, 6), true);
});

test('isPlaceOpenAtHour checks specific time', () => {
  const place = {
    openingHours: {
      periods: [{ days: ['Mo'], open: '09:00', close: '17:00' }],
    },
  };
  assert.equal(isPlaceOpenAtHour(place, 1, 12), true); // Noon on Monday
  assert.equal(isPlaceOpenAtHour(place, 1, 18), false); // 6 PM on Monday (closed)
  assert.equal(isPlaceOpenAtHour(place, 1, 8), false); // 8 AM on Monday (not open yet)
});

test('isPlaceOpenAtHour handles overnight hours', () => {
  const place = {
    openingHours: {
      periods: [{ days: ['Fr'], open: '22:00', close: '03:00' }],
    },
  };
  assert.equal(isPlaceOpenAtHour(place, 5, 23), true); // 11 PM Friday
  assert.equal(isPlaceOpenAtHour(place, 6, 1), true); // 1 AM Saturday (still open from Friday)
  assert.equal(isPlaceOpenAtHour(place, 6, 12), false); // Noon Saturday
});

// ══════════════════════════════════════════════════════════════════════
//  5. FILTER BY OPENING HOURS
// ══════════════════════════════════════════════════════════════════════

test('filterByOpeningHours separates open, closed, unknown', () => {
  const candidates = [
    makeAttraction({ name: 'Open Museum', openingHours: { periods: [{ days: ['Mo'], open: '09:00', close: '18:00' }] } }),
    makeAttraction({ name: 'Closed Park', openingHours: { periods: [{ days: ['Tu'], open: '09:00', close: '18:00' }] } }),
    makeAttraction({ name: 'Unknown Place' }),
  ];
  // Monday = 1
  const result = filterByOpeningHours(candidates, 1);
  assert.equal(result.open.length, 1);
  assert.equal(result.closed.length, 1);
  assert.equal(result.unknown.length, 1);
});

// ══════════════════════════════════════════════════════════════════════
//  6. FILTER BY TIME SLOT
// ══════════════════════════════════════════════════════════════════════

test('filterByTimeSlot filters by hour', () => {
  const candidates = [
    makeAttraction({ name: 'Morning Museum', openingHours: { periods: [{ days: ['Mo'], open: '08:00', close: '14:00' }] } }),
    makeAttraction({ name: 'Evening Bar', openingHours: { periods: [{ days: ['Mo'], open: '17:00', close: '23:00' }] } }),
  ];
  const morningResult = filterByTimeSlot(candidates, 1, 'morning');
  assert.equal(morningResult.suitable.length, 1);
  assert.equal(morningResult.suitable[0].name, 'Morning Museum');
});

// ══════════════════════════════════════════════════════════════════════
//  7. BUILD DAY-SPECIFIC POOLS
// ══════════════════════════════════════════════════════════════════════

test('buildDaySpecificPools creates pools for each day', () => {
  const tripDays = generateTripDays('2025-06-15', '2025-06-17');
  const attractions = [
    makeAttraction({ name: 'Museum A', openingHours: { periods: [{ days: ['Mo', 'Tu', 'We'], open: '09:00', close: '18:00' }] } }),
    makeAttraction({ name: 'Park B' }),
  ];
  const pools = buildDaySpecificPools({ tripDays, attractions });
  assert.equal(pools.length, 3);
  // Day 1 (Sunday) - Museum might be closed
  // Day 2 (Monday) - Museum open
  // Day 3 (Tuesday) - Museum open
  assert.equal(pools[0].dayNumber, 1);
  assert.equal(pools[1].dayNumber, 2);
});

test('buildDaySpecificPools filters events by date', () => {
  const tripDays = generateTripDays('2025-06-15', '2025-06-17');
  const events = [
    makeEvent({ date: '2025-06-15', name: 'Day 1 Event' }),
    makeEvent({ date: '2025-06-16', name: 'Day 2 Event' }),
  ];
  const pools = buildDaySpecificPools({ tripDays, events });
  assert.equal(pools[0].events.length, 1);
  assert.equal(pools[0].events[0].name, 'Day 1 Event');
  assert.equal(pools[1].events.length, 1);
  assert.equal(pools[1].events[0].name, 'Day 2 Event');
  assert.equal(pools[2].events.length, 0);
});

test('buildDaySpecificPools includes weather per day', () => {
  const tripDays = generateTripDays('2025-06-15', '2025-06-16');
  const forecast = [
    makeWeatherForecast('2025-06-15', { condition: 'Sunny' }),
    makeWeatherForecast('2025-06-16', { condition: 'Rainy' }),
  ];
  const pools = buildDaySpecificPools({ tripDays, weatherForecast: forecast });
  assert.equal(pools[0].weather.condition, 'Sunny');
  assert.equal(pools[1].weather.condition, 'Rainy');
});

test('buildDaySpecificPools logs correctly', () => {
  const tripDays = generateTripDays('2025-06-15', '2025-06-15');
  const attractions = [makeAttraction(), makeAttraction({ name: 'B' })];
  const pools = buildDaySpecificPools({ tripDays, attractions });
  assert.equal(pools[0]._logging.totalAttractions, 2);
  assert.equal(pools[0]._logging.filteredAttractions, 2);
});

// ══════════════════════════════════════════════════════════════════════
//  8. ENRICHED DAY CONTEXTS
// ══════════════════════════════════════════════════════════════════════

test('buildEnrichedDayContexts creates context for each day', () => {
  const tripDays = generateTripDays('2025-06-15', '2025-06-16');
  const pools = buildDaySpecificPools({ tripDays });
  const contexts = buildEnrichedDayContexts({ dayPools: pools });
  assert.equal(contexts.length, 2);
  assert.equal(contexts[0].dayNumber, 1);
  assert.equal(contexts[0].date, '2025-06-15');
});

test('buildEnrichedDayContexts includes weather', () => {
  const tripDays = generateTripDays('2025-06-15', '2025-06-15');
  const forecast = [makeWeatherForecast('2025-06-15', { tempMax: 35 })];
  const pools = buildDaySpecificPools({ tripDays, weatherForecast: forecast });
  const contexts = buildEnrichedDayContexts({ dayPools: pools });
  assert.equal(contexts[0].weather.tempMax, 35);
});

// ══════════════════════════════════════════════════════════════════════
//  9. SELECT DAY CANDIDATES
// ══════════════════════════════════════════════════════════════════════

test('selectDayCandidates respects max limits', () => {
  const pool = {
    dayNumber: 1,
    dateKey: '2025-06-15',
    attractions: [makeAttraction(), makeAttraction({ name: 'B' }), makeAttraction({ name: 'C' })],
    restaurants: [makeRestaurant(), makeRestaurant({ name: 'R2' }), makeRestaurant({ name: 'R3' })],
    events: [],
    nightlife: [],
    weather: null,
  };
  const result = selectDayCandidates(pool, { maxAttractions: 2, maxRestaurants: 1 });
  assert.equal(result.attractions.length, 2);
  assert.equal(result.restaurants.length, 1);
});

test('selectDayCandidates prefers indoor in bad weather', () => {
  const pool = {
    dayNumber: 1,
    dateKey: '2025-06-15',
    attractions: [
      makeAttraction({ name: 'Outdoor Park', types: ['natural.park'] }),
      makeAttraction({ name: 'City Museum', types: ['entertainment.museum'] }),
    ],
    restaurants: [],
    events: [],
    nightlife: [],
    weather: { rainProbability: 80 },
  };
  const result = selectDayCandidates(pool);
  // Museum (indoor) should be first
  assert.equal(result.attractions[0].name, 'City Museum');
});

// ══════════════════════════════════════════════════════════════════════
//  10. ENRICH CANDIDATES WITH DAY AVAILABILITY
// ══════════════════════════════════════════════════════════════════════

test('enrichCandidatesWithDayAvailability adds day metadata', () => {
  const tripDays = generateTripDays('2025-06-15', '2025-06-16');
  const attractions = [makeAttraction({ id: 'a1', name: 'Museum' })];
  const pools = buildDaySpecificPools({ tripDays, attractions });
  const candidates = [{ id: 'a1', name: 'Museum', type: 'attraction' }];
  const enriched = enrichCandidatesWithDayAvailability(candidates, pools);
  assert.ok(enriched[0]._availableDays);
  assert.ok(enriched[0]._daySpecific);
});

// ══════════════════════════════════════════════════════════════════════
//  11. PIPELINE
// ══════════════════════════════════════════════════════════════════════

test('runDayAwarePipeline returns complete result', () => {
  const result = runDayAwarePipeline({
    startDate: '2025-06-15',
    endDate: '2025-06-18',
    attractions: [makeAttraction()],
    restaurants: [makeRestaurant()],
    events: [makeEvent({ date: '2025-06-16' })],
    logPipeline: false,
  });
  assert.equal(result.tripDays.length, 4);
  assert.equal(result.dayPools.length, 4);
  assert.equal(result.dayContexts.length, 4);
  assert.equal(result.daySelections.length, 4);
  assert.ok(result.summary.totalDays === 4);
  assert.ok(result.latencyMs >= 0);
});

test('runDayAwarePipeline handles empty inputs', () => {
  const result = runDayAwarePipeline({
    startDate: '2025-06-15',
    endDate: '2025-06-15',
    logPipeline: false,
  });
  assert.equal(result.tripDays.length, 1);
  assert.equal(result.summary.totalAttractions, 0);
});

// ══════════════════════════════════════════════════════════════════════
//  12. 4-DAY MUMBAI TRIP SCENARIO
// ══════════════════════════════════════════════════════════════════════

test('4-day Mumbai trip has unique day-specific data', () => {
  const attractions = [
    makeAttraction({ id: 'a1', name: 'Gateway of India', types: ['tourism.attraction'] }),
    makeAttraction({ id: 'a2', name: 'Elephanta Caves', types: ['tourism.attraction'] }),
    makeAttraction({ id: 'a3', name: 'Marine Drive', types: ['natural.beach'] }),
    makeAttraction({ id: 'a4', name: 'Siddhivinayak Temple', types: ['religion.temple'] }),
  ];
  const restaurants = [
    makeRestaurant({ id: 'r1', name: 'Leopold Cafe' }),
    makeRestaurant({ id: 'r2', name: 'Trishna' }),
    makeRestaurant({ id: 'r3', name: 'Britannia & Co' }),
    makeRestaurant({ id: 'r4', name: 'Swati Snacks' }),
  ];
  const events = [
    makeEvent({ date: '2025-06-16', name: 'Mumbai Music Festival' }),
    makeEvent({ date: '2025-06-17', name: 'Food Walk' }),
  ];
  const forecast = [
    makeWeatherForecast('2025-06-15', { condition: 'Sunny', rainProbability: 10 }),
    makeWeatherForecast('2025-06-16', { condition: 'Cloudy', rainProbability: 40 }),
    makeWeatherForecast('2025-06-17', { condition: 'Rainy', rainProbability: 80 }),
    makeWeatherForecast('2025-06-18', { condition: 'Sunny', rainProbability: 5 }),
  ];

  const result = runDayAwarePipeline({
    startDate: '2025-06-15',
    endDate: '2025-06-18',
    attractions,
    restaurants,
    events,
    weatherForecast: forecast,
    logPipeline: false,
  });

  // Each day should have its own weather
  assert.equal(result.dayPools[0].weather.condition, 'Sunny');
  assert.equal(result.dayPools[1].weather.condition, 'Cloudy');
  assert.equal(result.dayPools[2].weather.condition, 'Rainy');
  assert.equal(result.dayPools[3].weather.condition, 'Sunny');

  // Events should be date-specific
  assert.equal(result.dayPools[0].events.length, 0); // No event on June 15
  assert.equal(result.dayPools[1].events.length, 1); // Music festival on June 16
  assert.equal(result.dayPools[2].events.length, 1); // Food walk on June 17
  assert.equal(result.dayPools[3].events.length, 0); // No event on June 18

  // Each day should have candidates (all open on weekdays)
  for (const pool of result.dayPools) {
    assert.ok(pool.attractions.length > 0, `Day ${pool.dayNumber} should have attractions`);
    assert.ok(pool.restaurants.length > 0, `Day ${pool.dayNumber} should have restaurants`);
  }

  // Day selections should respect max limits
  for (const sel of result.daySelections) {
    assert.ok(sel.attractions.length <= 4, `Day ${sel.dayNumber} should have at most 4 attractions`);
    assert.ok(sel.restaurants.length <= 3, `Day ${sel.dayNumber} should have at most 3 restaurants`);
  }
});

// ══════════════════════════════════════════════════════════════════════
//  13. DAY ABBREVIATION
// ══════════════════════════════════════════════════════════════════════

test('getDayAbbreviation returns correct abbreviations', () => {
  assert.equal(getDayAbbreviation(0), 'Su');
  assert.equal(getDayAbbreviation(1), 'Mo');
  assert.equal(getDayAbbreviation(6), 'Sa');
});

// ══════════════════════════════════════════════════════════════════════
//  14. EDGE CASES
// ══════════════════════════════════════════════════════════════════════

test('filterByOpeningHours handles empty candidates', () => {
  const result = filterByOpeningHours([], 1);
  assert.equal(result.open.length, 0);
  assert.equal(result.closed.length, 0);
  assert.equal(result.unknown.length, 0);
});

test('getWeatherForDay handles different date formats', () => {
  const forecast = [{ date: '2025-06-15T00:00:00.000Z', condition: 'Sunny' }];
  const result = getWeatherForDay(forecast, '2025-06-15');
  assert.equal(result.condition, 'Sunny');
});

test('selectDayCandidates handles empty pool', () => {
  const pool = {
    dayNumber: 1,
    dateKey: '2025-06-15',
    attractions: [],
    restaurants: [],
    events: [],
    nightlife: [],
    weather: null,
  };
  const result = selectDayCandidates(pool);
  assert.equal(result.attractions.length, 0);
  assert.equal(result.restaurants.length, 0);
});
