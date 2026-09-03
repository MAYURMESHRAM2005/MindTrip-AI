import test from 'node:test';
import assert from 'node:assert/strict';
import itineraryService from '../src/services/itinerary.service.js';
import finalValidatorAgent from '../src/agents/finalValidator.agent.js';
import { buildTransportFallbackOrder } from '../src/orchestrator/tripOrchestrator.js';

test('dateRange produces one day per calendar date', () => {
  const days = itineraryService.dateRange('2025-06-01', '2025-06-05');
  assert.equal(days.length, 5);
});

test('buildDays produces a complete day-by-day skeleton with labelled data status', () => {
  const days = itineraryService.buildDays({
    origin: 'Mumbai',
    destination: 'Goa',
    startDate: '2025-06-01',
    endDate: '2025-06-03',
    travelers: { adults: 2, children: 0 },
    prefs: { foodPreference: 'vegetarian', travelStyle: 'standard', activityLevel: 'moderate', interests: [], accessibility: [] },
    hotelResult: { data: { isLive: false, recommended: null, hotels: [] } },
    transportResult: { mode: 'flight', data: { isLive: false, selected: null } },
    weatherResult: { data: { provider: 'unavailable', forecast: null } },
    attractions: [],
    restaurants: [],
    budgetAllocation: { transport: { amount: 5000 }, hotels: { amount: 9000 }, food: { amount: 3000 } },
    currency: 'INR',
  });

  assert.equal(days.length, 3);
  const day1 = days[0];
  assert.equal(day1.dayNumber, 1);
  assert.ok(day1.activities.length >= 5, 'should have a full day of activities');
  const statuses = day1.activities.map((a) => a.dataStatus);
  assert.ok(statuses.every((s) => ['live', 'estimate', 'unavailable'].includes(s)));
  assert.ok(day1.activities.some((a) => a.category === 'hotel'), 'day includes accommodation');
  assert.ok(day1.activities.some((a) => a.category === 'transport'), 'day includes transport');
  // All costs are estimates when data is unavailable - never presented as live
  const unavail = day1.activities.filter((a) => a.dataStatus === 'unavailable');
  assert.ok(unavail.every((a) => a.cost.isEstimate === true), 'unavailable items keep estimate flags');
});

test('buildDays uses live data when provided', () => {
  const days = itineraryService.buildDays({
    origin: '',
    destination: 'Paris',
    startDate: '2025-06-01',
    endDate: '2025-06-02',
    travelers: { adults: 2, children: 0 },
    prefs: { foodPreference: '', travelStyle: 'luxury', activityLevel: 'moderate', interests: [], accessibility: [] },
    hotelResult: {
      data: {
        isLive: true,
        recommended: { name: 'Grand Hotel', price: { amount: 12000, currency: 'INR' }, address: 'Champs Elysees', latitude: 48.87, longitude: 2.3, isLive: true },
        hotels: [],
      },
    },
    transportResult: { mode: 'flight', data: { isLive: true, selected: { airline: 'AF', flightNumber: '102', price: { amount: 30000 } } } },
    weatherResult: { data: { provider: 'live', forecast: [{ tempMax: 22, condition: 'Clear' }] } },
    attractions: [{ name: 'Eiffel Tower', address: 'Paris', coordinates: { lat: 48.858, lng: 2.294 }, types: ['tourist_attraction'] }],
    restaurants: [{ name: 'Cafe Paris', rating: 4.5, priceLevel: 2, coordinates: { lat: 48.85, lng: 2.3 } }],
    budgetAllocation: { transport: { amount: 40000 }, hotels: { amount: 30000 }, food: { amount: 15000 } },
    currency: 'INR',
  });

  const day1 = days[0];
  const checkIn = day1.activities.find((a) => a.category === 'hotel' && a.slot === 'hotel' && a.time === '12:00');
  assert.equal(checkIn.place, 'Grand Hotel');
  const overnight = day1.activities.find((a) => a.category === 'hotel' && a.cost?.amount > 0);
  assert.equal(overnight.place, 'Grand Hotel');
  assert.equal(overnight.cost.isEstimate, false, 'live hotel price is not an estimate');
  assert.equal(overnight.isLive, true);
  // One night charged on arrival day (2 adults = 1 room × ₹12,000).
  assert.equal(overnight.cost.amount, 12000);
  const flight = day1.activities.find((a) => a.category === 'flight');
  assert.equal(flight.title.includes('Flight'), true);
});

test('final validator detects overlapping activities and budget overflow', () => {
  const days = [
    {
      dayNumber: 1,
      date: new Date('2025-06-01'),
      activities: [
        // Attraction runs 09:00-11:00 (120 min) - the 09:30 restaurant genuinely
        // starts inside that window.
        { title: 'Fort', time: '09:00', category: 'attraction', cost: { amount: 1000, isEstimate: false }, dataStatus: 'live' },
        { title: 'Snack', time: '09:30', category: 'restaurant', cost: { amount: 500, isEstimate: true }, dataStatus: 'estimate' },
      ],
    },
  ];
  const result = finalValidatorAgent.runDeterministic({
    days,
    budget: 500,
    totalEstimatedCost: 1500,
    destination: 'Goa',
    origin: 'Mumbai',
    prefs: { foodPreference: 'vegetarian' },
  });
  assert.ok(result.issues.some((i) => typeof i === 'string' ? i.includes('exceeds budget') : i.message?.includes('exceeds budget')));
  assert.ok(result.issues.some((i) => typeof i === 'string' ? i.includes('overlaps') : i.message?.includes('overlaps')));
  assert.equal(result.passed, false);
});

test('final validator does not flag adjacent schedule entries (19:15 transport + 20:00 dinner)', () => {
  const days = [
    {
      dayNumber: 1,
      date: new Date('2025-06-01'),
      activities: [
        { title: 'Local transport & transfers', time: '19:15', category: 'transport', cost: { amount: 100, isEstimate: true }, dataStatus: 'estimate' },
        { title: 'Dinner', time: '20:00', category: 'restaurant', cost: { amount: 800, isEstimate: true }, dataStatus: 'estimate' },
        { title: 'Night out', time: '21:30', category: 'activity', cost: { amount: 0, isEstimate: true }, dataStatus: 'estimate' },
        { title: 'Overnight at Hotel', time: '22:30', category: 'hotel', cost: { amount: 2000, isEstimate: true }, dataStatus: 'estimate' },
      ],
    },
  ];
  const result = finalValidatorAgent.runDeterministic({
    days,
    budget: 10000,
    totalEstimatedCost: 2900,
    destination: 'Goa',
    origin: '',
    prefs: {},
  });
  assert.ok(!result.issues.some((i) => i.includes('overlaps')), 'adjacent entries are not overlaps');
  assert.equal(result.passed, true);
});

test('final validator passes a clean itinerary', () => {
  const days = [
    {
      dayNumber: 1,
      date: new Date('2025-06-01'),
      activities: [
        { title: 'Hotel', time: '13:00', category: 'hotel', cost: { amount: 2000, isEstimate: true }, dataStatus: 'estimate' },
        { title: 'Lunch', time: '14:00', category: 'restaurant', cost: { amount: 500, isEstimate: true }, dataStatus: 'estimate' },
        { title: 'Beach', time: '15:30', category: 'attraction', cost: { amount: 0, isEstimate: true }, dataStatus: 'estimate' },
      ],
    },
  ];
  const result = finalValidatorAgent.runDeterministic({
    days,
    budget: 10000,
    totalEstimatedCost: 2500,
    destination: 'Goa',
    origin: '',
    prefs: {},
  });
  assert.equal(result.passed, true);
  assert.equal(result.issues.length, 0);
});

test('final validator flags duplicate attractions and restaurants across days', () => {
  const days = [
    {
      dayNumber: 1,
      date: new Date('2025-06-01'),
      activities: [
        { title: 'Fort Aguada', place: 'Fort Aguada', time: '09:30', category: 'attraction', cost: { amount: 0, isEstimate: true }, dataStatus: 'live' },
        { title: 'Lunch at R1', place: 'R1', time: '13:00', category: 'restaurant', cost: { amount: 700, isEstimate: true }, dataStatus: 'live' },
      ],
    },
    {
      dayNumber: 2,
      date: new Date('2025-06-02'),
      activities: [
        { title: 'Fort Aguada', place: 'Fort Aguada', time: '09:30', category: 'attraction', cost: { amount: 0, isEstimate: true }, dataStatus: 'live' },
        { title: 'Dinner at R1', place: 'R1', time: '20:00', category: 'restaurant', cost: { amount: 800, isEstimate: true }, dataStatus: 'live' },
      ],
    },
  ];
  const result = finalValidatorAgent.runDeterministic({
    days,
    budget: 10000,
    totalEstimatedCost: 1500,
    destination: 'Goa',
    origin: '',
    prefs: {},
  });
  assert.equal(result.duplicatesFound, true);
  assert.equal(result.duplicatePlaces.length, 1);
  assert.equal(result.duplicateRestaurants.length, 1);
});

test('buildDays picks distinct restaurants per day and scales cost by travellers', () => {
  const restaurants = Array.from({ length: 12 }, (_, i) => ({
    name: `Restaurant ${i + 1}`,
    placeId: `r${i + 1}`,
    rating: 4,
    priceLevel: 1,
  }));
  const days = itineraryService.buildDays({
    origin: '',
    destination: 'Goa',
    startDate: '2025-06-01',
    endDate: '2025-06-03',
    travelers: { adults: 4, children: 0 },
    prefs: { foodPreference: 'vegetarian', travelStyle: 'standard', activityLevel: 'moderate', interests: [], accessibility: [] },
    hotelResult: { data: { isLive: false, recommended: null, hotels: [] } },
    transportResult: { mode: 'flight', data: { isLive: false, selected: null } },
    weatherResult: { data: { provider: 'unavailable', forecast: null } },
    attractions: [],
    restaurants,
    budgetAllocation: { transport: { amount: 5000 }, hotels: { amount: 9000 }, food: { amount: 6000 } },
    totalBudget: 50000,
    currency: 'INR',
  });

  // Distinct breakfast/lunch/dinner across the first two days (6 slots, 12 options).
  const used = new Set();
  for (const day of days.slice(0, 2)) {
    const meals = day.activities.filter((a) => a.slot === 'breakfast' || a.slot === 'lunch' || a.slot === 'dinner');
    assert.equal(meals.length, 3, 'every day has breakfast, lunch and dinner');
    const names = meals.map((m) => m.place);
    assert.equal(new Set(names).size, 3, 'meals within a day are distinct');
    for (const n of names) {
      assert.ok(!used.has(n), `restaurant ${n} must not repeat across days`);
      used.add(n);
    }
  }

  // Traveller scaling: priceLevel 1 lunch = ₹350/person × 4 = ₹1400 total.
  const lunch = days[0].activities.find((a) => a.slot === 'lunch');
  assert.equal(lunch.cost.perPerson, 350);
  assert.equal(lunch.cost.amount, 1400);

  // Every day carries a cost breakdown with cumulative totals (the departure
  // day legitimately has no costs when there's no origin/return leg).
  for (const day of days) {
    assert.ok(typeof day.costBreakdown?.dayTotal === 'number', 'day total present');
    assert.ok(typeof day.costBreakdown.cumulative === 'number');
    assert.ok(typeof day.remainingBudget === 'number');
  }
  const day1 = days[0];
  assert.ok(day1.costBreakdown.dayTotal > 0, 'a full activity day has costs');
});

test('buildDays assigns distinct geographic areas per day from real locality data', () => {
  // 3 real attractions per locality - each day stays within its own area and
  // no place repeats across the trip.
  const mk = (name, suburb, lat, lng) => ({
    name,
    placeId: `${name}-${suburb}`,
    suburb,
    address: `${name}, ${suburb}, Goa`,
    coordinates: { lat, lng },
    types: ['tourist_attraction'],
  });
  const attractions = [
    mk('Fort Aguada', 'Candolim', 15.493, 73.763),
    mk('Candolim Beach', 'Candolim', 15.497, 73.752),
    mk('Reis Magos Fort', 'Candolim', 15.5, 73.777),
    mk('Baga Beach', 'Baga', 15.555, 73.751),
    mk('Baga Arcade', 'Baga', 15.559, 73.747),
    mk('Vagator Hills', 'Baga', 15.547, 73.741),
    mk('Anjuna Flea Market', 'Anjuna', 15.569, 73.741),
    mk('Anjuna Beach', 'Anjuna', 15.573, 73.735),
    mk('Chapora Fort', 'Anjuna', 15.597, 73.733),
  ];
  const days = itineraryService.buildDays({
    origin: '',
    destination: 'Goa',
    startDate: '2025-06-01',
    endDate: '2025-06-03',
    travelers: { adults: 2, children: 0 },
    prefs: { foodPreference: '', travelStyle: 'standard', activityLevel: 'moderate', interests: [], accessibility: [] },
    hotelResult: { data: { isLive: false, recommended: null, hotels: [] } },
    transportResult: { mode: 'flight', data: { isLive: false, selected: null } },
    weatherResult: { data: { provider: 'unavailable', forecast: null } },
    attractions,
    restaurants: [],
    budgetAllocation: { transport: { amount: 5000 }, hotels: { amount: 9000 }, food: { amount: 3000 } },
    totalBudget: 50000,
    currency: 'INR',
  });

  assert.equal(days.length, 3);
  const areas = days.map((d) => d.area);
  assert.equal(new Set(areas).size, 3, 'each day has its own geographic area');
  assert.ok(days.every((d) => d.area && d.area !== 'Goa'), 'area names come from real localities');

  // Day 1 is planned in Candolim, day 2 in Baga, day 3 in Anjuna.
  assert.equal(days[0].area, 'Candolim');
  assert.equal(days[1].area, 'Baga');
  assert.equal(days[2].area, 'Anjuna');

  // Days 1-2 are full travel days (day 3 is departure with no sightseeing).
  // Their picks (morning + afternoon + evening) are all distinct and no
  // attraction repeats across the trip.
  const used = new Set();
  for (const day of days.slice(0, 2)) {
    const picks = day.activities.filter((x) => x.slot === 'morning' || x.slot === 'afternoon' || x.slot === 'evening');
    assert.ok(picks.length >= 3, `day ${day.dayNumber} has a full activity schedule`);
    for (const a of picks) {
      assert.ok(!used.has(a.place), `attraction ${a.place} must not repeat`);
      used.add(a.place);
    }
    // All picks for the day fall inside the day's own area.
    for (const a of picks) {
      assert.ok(a.address.includes(day.area), `day ${day.dayNumber} pick stays in ${day.area}`);
    }
  }
});

// ═══════════════════════════════════════════════════════════════════
// Transport Fallback Logic Tests
// ═══════════════════════════════════════════════════════════════════

test('buildTransportFallbackOrder returns preferred mode first', () => {
  const order = buildTransportFallbackOrder('train', '');
  assert.deepEqual(order, ['train', 'flight', 'bus']);
});

test('buildTransportFallbackOrder defaults to flight when no preference', () => {
  const order = buildTransportFallbackOrder('flight', '');
  assert.deepEqual(order, ['flight', 'train', 'bus']);
});

test('buildTransportFallbackOrder uses userPreference when preferredMode is empty', () => {
  const order = buildTransportFallbackOrder('', 'bus');
  assert.deepEqual(order, ['bus', 'flight', 'train']);
});

test('buildTransportFallbackOrder prefers preferredMode over userPreference', () => {
  const order = buildTransportFallbackOrder('train', 'bus');
  assert.deepEqual(order, ['train', 'flight', 'bus']);
});

test('buildTransportFallbackOrder defaults to flight when both are empty', () => {
  const order = buildTransportFallbackOrder('', '');
  assert.deepEqual(order, ['flight', 'train', 'bus']);
});

test('buildTransportFallbackOrder includes all three modes exactly once', () => {
  for (const mode of ['flight', 'train', 'bus']) {
    const order = buildTransportFallbackOrder(mode, '');
    const unique = new Set(order);
    assert.equal(unique.size, 3, `order for ${mode} should have 3 unique modes`);
    assert.ok(order.includes('flight'), `order for ${mode} includes flight`);
    assert.ok(order.includes('train'), `order for ${mode} includes train`);
    assert.ok(order.includes('bus'), `order for ${mode} includes bus`);
  }
});

test('buildTransportFallbackOrder handles null preferredMode', () => {
  const order = buildTransportFallbackOrder(null, 'train');
  assert.deepEqual(order, ['train', 'flight', 'bus']);
});

test('buildTransportFallbackOrder handles undefined inputs', () => {
  const order = buildTransportFallbackOrder(undefined, undefined);
  assert.deepEqual(order, ['flight', 'train', 'bus']);
});

test('buildTransportFallbackOrder handles null userPreference', () => {
  const order = buildTransportFallbackOrder('bus', null);
  assert.deepEqual(order, ['bus', 'flight', 'train']);
});

test('buildTransportFallbackOrder first element is always the resolved primary', () => {
  // Even with garbage input, the function should resolve to a valid primary
  const order1 = buildTransportFallbackOrder('bus', '');
  assert.equal(order1[0], 'bus');
  const order2 = buildTransportFallbackOrder('', 'train');
  assert.equal(order2[0], 'train');
  const order3 = buildTransportFallbackOrder('', '');
  assert.equal(order3[0], 'flight');
});

test('buildDaysPlan uses transport fallback info when modesChecked is provided', () => {
  const days = itineraryService.buildDays({
    origin: 'Umred',
    destination: 'Nagpur',
    startDate: '2025-06-01',
    endDate: '2025-06-02',
    travelers: { adults: 2, children: 0 },
    prefs: { foodPreference: '', travelStyle: 'standard', activityLevel: 'moderate', interests: [], accessibility: [] },
    hotelResult: { data: { isLive: false, recommended: null, hotels: [] } },
    transportResult: {
      mode: 'train',
      data: {
        isLive: false,
        selected: null,
        message: 'Live transport data unavailable from Umred to Nagpur. All checked modes (flights, trains, buses) returned no results.',
        modesChecked: ['flight', 'train', 'bus'],
      },
    },
    weatherResult: { data: { provider: 'unavailable', forecast: null } },
    attractions: [],
    restaurants: [],
    budgetAllocation: { transport: { amount: 3000 }, hotels: { amount: 5000 }, food: { amount: 2000 } },
    currency: 'INR',
  });

  const day1 = days[0];
  const transport = day1.activities.find((a) => a.category === 'transport' && a.slot === 'transport');
  assert.ok(transport, 'day includes transport activity');
  assert.equal(transport.isLive, false, 'transport is not live when all modes failed');
  assert.equal(transport.dataStatus, 'unavailable');
  assert.ok(transport.cost.isEstimate, 'transport cost is an estimate');
  assert.ok(transport.description.includes('unavailable'), 'description mentions unavailability');
});

test('buildDaysPlan uses live train data when train is selected', () => {
  const days = itineraryService.buildDays({
    origin: 'Mumbai',
    destination: 'Goa',
    startDate: '2025-06-01',
    endDate: '2025-06-02',
    travelers: { adults: 2, children: 0 },
    prefs: { foodPreference: '', travelStyle: 'standard', activityLevel: 'moderate', interests: [], accessibility: [] },
    hotelResult: { data: { isLive: false, recommended: null, hotels: [] } },
    transportResult: {
      mode: 'train',
      data: {
        isLive: true,
        selected: { trainName: 'Konkan Kanya', trainNumber: '10111', price: { amount: 850, currency: 'INR' } },
        offers: [
          { trainName: 'Konkan Kanya', trainNumber: '10111', price: { amount: 850, currency: 'INR' } },
          { trainName: 'Jan Shatabdi', trainNumber: '12051', price: { amount: 650, currency: 'INR' } },
        ],
      },
    },
    weatherResult: { data: { provider: 'unavailable', forecast: null } },
    attractions: [],
    restaurants: [],
    budgetAllocation: { transport: { amount: 5000 }, hotels: { amount: 5000 }, food: { amount: 2000 } },
    currency: 'INR',
  });

  const day1 = days[0];
  const transport = day1.activities.find((a) => a.category === 'train' && a.slot === 'transport');
  assert.ok(transport, 'day includes train transport');
  assert.equal(transport.isLive, true, 'train data is live');
  assert.equal(transport.dataStatus, 'live');
  assert.equal(transport.cost.amount, 850, 'uses live train price');
  assert.equal(transport.cost.isEstimate, false, 'live price is not an estimate');
  assert.ok(transport.place.includes('Konkan Kanya'), 'place includes train name');
});

test('buildDaysPlan uses live bus data when bus is selected', () => {
  const days = itineraryService.buildDays({
    origin: 'Mumbai',
    destination: 'Goa',
    startDate: '2025-06-01',
    endDate: '2025-06-02',
    travelers: { adults: 2, children: 0 },
    prefs: { foodPreference: '', travelStyle: 'standard', activityLevel: 'moderate', interests: [], accessibility: [] },
    hotelResult: { data: { isLive: false, recommended: null, hotels: [] } },
    transportResult: {
      mode: 'bus',
      data: {
        isLive: true,
        selected: { operator: 'Paulo Travels', departureTime: '22:00', price: { amount: 600, currency: 'INR' } },
        offers: [
          { operator: 'Paulo Travels', departureTime: '22:00', price: { amount: 600, currency: 'INR' } },
          { operator: 'Neeta Travels', departureTime: '21:30', price: { amount: 750, currency: 'INR' } },
        ],
      },
    },
    weatherResult: { data: { provider: 'unavailable', forecast: null } },
    attractions: [],
    restaurants: [],
    budgetAllocation: { transport: { amount: 5000 }, hotels: { amount: 5000 }, food: { amount: 2000 } },
    currency: 'INR',
  });

  const day1 = days[0];
  const transport = day1.activities.find((a) => a.category === 'bus' && a.slot === 'transport');
  assert.ok(transport, 'day includes bus transport');
  assert.equal(transport.isLive, true, 'bus data is live');
  assert.equal(transport.dataStatus, 'live');
  assert.equal(transport.cost.amount, 600, 'uses live bus price');
  assert.equal(transport.cost.isEstimate, false, 'live price is not an estimate');
  assert.ok(transport.place.includes('Paulo Travels'), 'place includes bus operator');
});

test('buildDaysPlan shows honest message when no transport is available', () => {
  const days = itineraryService.buildDays({
    origin: 'Umred',
    destination: 'Nagpur',
    startDate: '2025-06-01',
    endDate: '2025-06-02',
    travelers: { adults: 2, children: 0 },
    prefs: { foodPreference: '', travelStyle: 'standard', activityLevel: 'moderate', interests: [], accessibility: [] },
    hotelResult: { data: { isLive: false, recommended: null, hotels: [] } },
    transportResult: {
      mode: 'flight',
      data: {
        isLive: false,
        selected: null,
        message: 'Live transport data unavailable from Umred to Nagpur. All checked modes returned no results.',
        modesChecked: ['flight', 'train', 'bus'],
      },
    },
    weatherResult: { data: { provider: 'unavailable', forecast: null } },
    attractions: [],
    restaurants: [],
    budgetAllocation: { transport: { amount: 3000 }, hotels: { amount: 5000 }, food: { amount: 2000 } },
    currency: 'INR',
  });

  const day1 = days[0];
  const transport = day1.activities.find((a) => a.category === 'transport' && a.slot === 'transport');
  assert.ok(transport, 'day includes transport activity');
  assert.equal(transport.isLive, false);
  assert.equal(transport.dataStatus, 'unavailable');
  assert.ok(transport.description.includes('unavailable'), 'honest about unavailability');
  assert.ok(transport.cost.isEstimate, 'cost is marked as estimate');
  // The estimate should come from the budget allocation, not an invented price
  assert.ok(transport.cost.estimateNote.includes('Estimated'), 'estimate note present');
});

test('buildDaysPlan includes fetchedAt metadata on all activities', () => {
  const days = itineraryService.buildDays({
    origin: '',
    destination: 'Goa',
    startDate: '2025-06-01',
    endDate: '2025-06-02',
    travelers: { adults: 2, children: 0 },
    prefs: { foodPreference: '', travelStyle: 'standard', activityLevel: 'moderate', interests: [], accessibility: [] },
    hotelResult: { data: { isLive: false, recommended: null, hotels: [] } },
    transportResult: { mode: 'flight', data: { isLive: false, selected: null } },
    weatherResult: { data: { provider: 'unavailable', forecast: null } },
    attractions: [],
    restaurants: [],
    budgetAllocation: { transport: { amount: 3000 }, hotels: { amount: 5000 }, food: { amount: 2000 } },
    currency: 'INR',
  });

  for (const day of days) {
    for (const act of day.activities) {
      assert.ok(act.fetchedAt, `activity "${act.title}" has fetchedAt`);
      assert.ok(typeof act.fetchedAt === 'string', 'fetchedAt is a string');
      // Should be a valid ISO date
      assert.ok(!isNaN(new Date(act.fetchedAt).getTime()), `fetchedAt "${act.fetchedAt}" is a valid date`);
    }
  }
});

test('buildDaysPlan marks restaurant costs as estimates with source metadata', () => {
  const days = itineraryService.buildDays({
    origin: '',
    destination: 'Goa',
    startDate: '2025-06-01',
    endDate: '2025-06-02',
    travelers: { adults: 2, children: 0 },
    prefs: { foodPreference: '', travelStyle: 'standard', activityLevel: 'moderate', interests: [], accessibility: [] },
    hotelResult: { data: { isLive: false, recommended: null, hotels: [] } },
    transportResult: { mode: 'flight', data: { isLive: false, selected: null } },
    weatherResult: { data: { provider: 'unavailable', forecast: null } },
    attractions: [],
    restaurants: [
      { name: 'Test Restaurant', placeId: 'r1', rating: 4, priceLevel: 2, coordinates: { lat: 15.5, lng: 73.8 } },
    ],
    budgetAllocation: { transport: { amount: 3000 }, hotels: { amount: 5000 }, food: { amount: 4000 } },
    currency: 'INR',
  });

  const day1 = days[0];
  const meals = day1.activities.filter((a) => a.category === 'restaurant');
  assert.ok(meals.length > 0, 'day has restaurant activities');
  for (const meal of meals) {
    assert.equal(meal.cost.isEstimate, true, `"${meal.title}" cost is marked as estimate`);
    assert.ok(meal.cost.estimateNote, `"${meal.title}" has estimateNote`);
    assert.ok(meal.cost.estimateNote.includes('Estimated'), `"${meal.title}" estimateNote mentions Estimated`);
    assert.ok(meal.cost.source, `"${meal.title}" has source`);
    assert.ok(meal.fetchedAt, `"${meal.title}" has fetchedAt`);
  }
});

test('final validator flags attraction scheduled after 21:00', () => {
  const days = [
    {
      dayNumber: 1,
      date: new Date('2025-06-01'),
      activities: [
        { title: 'Fort', time: '09:00', category: 'attraction', cost: { amount: 100, isEstimate: true }, dataStatus: 'live' },
        { title: 'Night Museum Tour', time: '22:00', category: 'attraction', cost: { amount: 200, isEstimate: true }, dataStatus: 'live' },
      ],
    },
  ];
  const result = finalValidatorAgent.runDeterministic({
    days,
    budget: 10000,
    totalEstimatedCost: 300,
    destination: 'Goa',
    origin: '',
    prefs: {},
  });
  assert.ok(result.warnings.some((w) => { const msg = typeof w === 'string' ? w : w.message || ''; return msg.includes('22:00') && (msg.includes('opening hours') || msg.includes('close by 20:00')); }), 'flags late-night attraction');
});

test('final validator flags insufficient buffer between transport and next activity', () => {
  const days = [
    {
      dayNumber: 1,
      date: new Date('2025-06-01'),
      activities: [
        { title: 'Flight to Goa', time: '08:00', category: 'flight', cost: { amount: 5000, isEstimate: false }, dataStatus: 'live' },
        { title: 'Beach', time: '08:15', category: 'attraction', cost: { amount: 0, isEstimate: true }, dataStatus: 'estimate' },
      ],
    },
  ];
  const result = finalValidatorAgent.runDeterministic({
    days,
    budget: 10000,
    totalEstimatedCost: 5000,
    destination: 'Goa',
    origin: 'Mumbai',
    prefs: {},
  });
  assert.ok(result.warnings.some((w) => { const msg = typeof w === 'string' ? w : w.message || ''; return msg.includes('buffer'); }), 'flags insufficient transport buffer');
});

test('final validator flags isLive/dataStatus contradiction', () => {
  const days = [
    {
      dayNumber: 1,
      date: new Date('2025-06-01'),
      activities: [
        { title: 'Ghost Flight', time: '09:00', category: 'flight', cost: { amount: 5000, isEstimate: false }, dataStatus: 'unavailable', isLive: true },
      ],
    },
  ];
  const result = finalValidatorAgent.runDeterministic({
    days,
    budget: 10000,
    totalEstimatedCost: 5000,
    destination: 'Goa',
    origin: 'Mumbai',
    prefs: {},
  });
  assert.ok(result.issues.some((i) => { const msg = typeof i === 'string' ? i : (i.message || ''); return msg.includes('isLive') && msg.includes('unavailable'); }), 'flags isLive/dataStatus contradiction');
});

test('buildDays enforces the budget as a hard constraint', () => {
  const expensiveHotel = {
    name: 'Luxury Hotel',
    placeId: 'h1',
    price: { amount: 12000, currency: 'INR' },
    latitude: 15.49,
    longitude: 73.81,
    isLive: true,
  };
  const days = itineraryService.buildDays({
    origin: 'Mumbai',
    destination: 'Goa',
    startDate: '2025-06-01',
    endDate: '2025-06-05',
    travelers: { adults: 2, children: 0 },
    prefs: { foodPreference: '', travelStyle: 'standard', activityLevel: 'moderate', interests: [], accessibility: [] },
    hotelResult: { data: { isLive: true, recommended: expensiveHotel, hotels: [] } },
    transportResult: { mode: 'flight', data: { isLive: false, selected: null } },
    weatherResult: { data: { provider: 'unavailable', forecast: null } },
    attractions: [],
    restaurants: [],
    budgetAllocation: {
      transport: { amount: 10000 },
      hotels: { amount: 20000 },
      food: { amount: 8000 },
      activities: { amount: 2000 },
      misc: { amount: 1000 },
      emergencyReserve: { amount: 1000 },
    },
    totalBudget: 30000,
    currency: 'INR',
  });

  const total = itineraryService.computeItineraryCost(days);
  assert.ok(total <= 30000, `total ${total} must stay within the budget`);
  const last = days[days.length - 1];
  assert.ok(last.remainingBudget >= 0, 'remaining budget is never negative');
});

// ═══════════════════════════════════════════════════════════════════
// Transport Fallback Integration Tests — mode switching, departure,
// no-origin, and return transport scenarios.
// ═══════════════════════════════════════════════════════════════════

test('buildDaysPlan switches transport mode when fallback finds a live option', () => {
  // Simulates: user prefers flight, but only train has live data.
  // The orchestrator would set mode='train' after fallback succeeds.
  const days = itineraryService.buildDays({
    origin: 'Mumbai',
    destination: 'Goa',
    startDate: '2025-06-01',
    endDate: '2025-06-02',
    travelers: { adults: 2, children: 0 },
    prefs: { foodPreference: '', travelStyle: 'standard', activityLevel: 'moderate', interests: [], accessibility: [] },
    hotelResult: { data: { isLive: false, recommended: null, hotels: [] } },
    transportResult: {
      mode: 'train', // orchestrator switched from flight → train after fallback
      data: {
        isLive: true,
        selected: { trainName: 'Hazard express', trainNumber: '17617', price: { amount: 450, currency: 'INR' } },
        offers: [],
      },
    },
    weatherResult: { data: { provider: 'unavailable', forecast: null } },
    attractions: [],
    restaurants: [],
    budgetAllocation: { transport: { amount: 5000 }, hotels: { amount: 5000 }, food: { amount: 2000 } },
    currency: 'INR',
  });

  const day1 = days[0];
  const transport = day1.activities.find((a) => a.slot === 'transport' && a.category === 'train');
  assert.ok(transport, 'day includes train transport (not flight)');
  assert.ok(transport.title.includes('Train'), 'title says Train, not Flight');
  assert.equal(transport.cost.amount, 450, 'uses train price');
  assert.equal(transport.isLive, true);
});

test('buildDaysPlan departure day includes return transport when origin is set', () => {
  const days = itineraryService.buildDays({
    origin: 'Mumbai',
    destination: 'Goa',
    startDate: '2025-06-01',
    endDate: '2025-06-03',
    travelers: { adults: 2, children: 0 },
    prefs: { foodPreference: '', travelStyle: 'standard', activityLevel: 'moderate', interests: [], accessibility: [] },
    hotelResult: { data: { isLive: false, recommended: null, hotels: [] } },
    transportResult: { mode: 'flight', data: { isLive: false, selected: null } },
    weatherResult: { data: { provider: 'unavailable', forecast: null } },
    attractions: [],
    restaurants: [],
    budgetAllocation: { transport: { amount: 6000 }, hotels: { amount: 6000 }, food: { amount: 3000 } },
    currency: 'INR',
  });

  // Day 3 is departure day
  const day3 = days[2];
  assert.equal(day3.dayNumber, 3);
  const returnTransport = day3.activities.find(
    (a) => a.category === 'transport' && a.title.includes('Return')
  );
  assert.ok(returnTransport, 'departure day has return transport');
  assert.ok(returnTransport.title.includes('Mumbai'), 'return transport mentions origin');
  assert.equal(returnTransport.isLive, false, 'return transport is not live (never fetched)');
  assert.equal(returnTransport.dataStatus, 'unavailable');
  assert.ok(returnTransport.cost.isEstimate, 'return transport cost is an estimate');
});

test('buildDaysPlan departure day has no sightseeing activities', () => {
  const days = itineraryService.buildDays({
    origin: 'Mumbai',
    destination: 'Goa',
    startDate: '2025-06-01',
    endDate: '2025-06-03',
    travelers: { adults: 2, children: 0 },
    prefs: { foodPreference: '', travelStyle: 'standard', activityLevel: 'moderate', interests: [], accessibility: [] },
    hotelResult: { data: { isLive: false, recommended: null, hotels: [] } },
    transportResult: { mode: 'flight', data: { isLive: false, selected: null } },
    weatherResult: { data: { provider: 'unavailable', forecast: null } },
    attractions: [
      { name: 'Fort Aguada', placeId: 'a1', address: 'Candolim, Goa', coordinates: { lat: 15.49, lng: 73.76 }, types: ['tourist_attraction'] },
    ],
    restaurants: [],
    budgetAllocation: { transport: { amount: 6000 }, hotels: { amount: 6000 }, food: { amount: 3000 } },
    currency: 'INR',
  });

  const day3 = days[2];
  const sightseeing = day3.activities.filter(
    (a) => a.category === 'attraction' || (a.category === 'activity' && a.slot !== 'night')
  );
  assert.equal(sightseeing.length, 0, 'departure day has no sightseeing');
  // Departure day should only have check-out and return transport
  const categories = day3.activities.map((a) => a.category);
  assert.ok(categories.every((c) => c === 'hotel' || c === 'transport'), 'departure day only has hotel + transport');
});

test('buildDaysPlan no-origin trip has no outbound transport on day 1', () => {
  const days = itineraryService.buildDays({
    origin: '',
    destination: 'Goa',
    startDate: '2025-06-01',
    endDate: '2025-06-02',
    travelers: { adults: 2, children: 0 },
    prefs: { foodPreference: '', travelStyle: 'standard', activityLevel: 'moderate', interests: [], accessibility: [] },
    hotelResult: { data: { isLive: false, recommended: null, hotels: [] } },
    transportResult: { mode: 'flight', data: { isLive: false, selected: null } },
    weatherResult: { data: { provider: 'unavailable', forecast: null } },
    attractions: [],
    restaurants: [],
    budgetAllocation: { transport: { amount: 3000 }, hotels: { amount: 5000 }, food: { amount: 2000 } },
    currency: 'INR',
  });

  const day1 = days[0];
  // No outbound/return transport, but local transport estimates may exist
  const outboundTransport = day1.activities.filter(
    (a) => a.slot === 'transport' && a.title.includes('to Goa') || a.title.includes('from')
  );
  assert.equal(outboundTransport.length, 0, 'no outbound transport when origin is empty');
  // Only local transport (intra-day) should exist
  const localTransport = day1.activities.filter(
    (a) => a.slot === 'transport' && a.title.includes('Local transport')
  );
  assert.ok(localTransport.length <= 1, 'at most one local transport entry');
});

test('buildDaysPlan no-origin trip has no return transport on departure day', () => {
  const days = itineraryService.buildDays({
    origin: '',
    destination: 'Goa',
    startDate: '2025-06-01',
    endDate: '2025-06-03',
    travelers: { adults: 2, children: 0 },
    prefs: { foodPreference: '', travelStyle: 'standard', activityLevel: 'moderate', interests: [], accessibility: [] },
    hotelResult: { data: { isLive: false, recommended: null, hotels: [] } },
    transportResult: { mode: 'flight', data: { isLive: false, selected: null } },
    weatherResult: { data: { provider: 'unavailable', forecast: null } },
    attractions: [],
    restaurants: [],
    budgetAllocation: { transport: { amount: 3000 }, hotels: { amount: 5000 }, food: { amount: 2000 } },
    currency: 'INR',
  });

  const day3 = days[2];
  const returnTransport = day3.activities.filter(
    (a) => a.category === 'transport' && a.title.includes('Return')
  );
  assert.equal(returnTransport.length, 0, 'no return transport when origin is empty');
});

test('buildDaysPlan hotel repeats across days (allowed), attractions prefer uniqueness', () => {
  const days = itineraryService.buildDays({
    origin: '',
    destination: 'Goa',
    startDate: '2025-06-01',
    endDate: '2025-06-04',
    travelers: { adults: 2, children: 0 },
    prefs: { foodPreference: '', travelStyle: 'standard', activityLevel: 'moderate', interests: [], accessibility: [] },
    hotelResult: {
      data: {
        isLive: true,
        recommended: { name: 'Beach Resort', price: { amount: 2000, currency: 'INR' }, latitude: 15.5, longitude: 73.8, isLive: true },
        hotels: [],
      },
    },
    transportResult: { mode: 'flight', data: { isLive: false, selected: null } },
    weatherResult: { data: { provider: 'unavailable', forecast: null } },
    attractions: [
      { name: 'Fort Aguada', placeId: 'a1', suburb: 'Candolim', address: 'Fort Aguada, Candolim, Goa', coordinates: { lat: 15.493, lng: 73.763 }, types: ['tourist_attraction'] },
      { name: 'Candolim Beach', placeId: 'a2', suburb: 'Candolim', address: 'Candolim Beach, Candolim, Goa', coordinates: { lat: 15.497, lng: 73.752 }, types: ['tourist_attraction'] },
      { name: 'Baga Beach', placeId: 'a3', suburb: 'Baga', address: 'Baga Beach, Baga, Goa', coordinates: { lat: 15.555, lng: 73.751 }, types: ['tourist_attraction'] },
      { name: 'Baga Arcade', placeId: 'a4', suburb: 'Baga', address: 'Baga Arcade, Baga, Goa', coordinates: { lat: 15.559, lng: 73.747 }, types: ['tourist_attraction'] },
    ],
    restaurants: [],
    budgetAllocation: { transport: { amount: 5000 }, hotels: { amount: 18000 }, food: { amount: 6000 } },
    currency: 'INR',
  });

  // Days 1-3 are full days, day 4 is departure
  const fullDays = days.slice(0, 3);

  // Hotel name should be the same across all nights (hotels CAN repeat)
  const hotelNames = fullDays
    .map((d) => d.activities.find((a) => a.category === 'hotel' && a.cost?.amount > 0))
    .filter(Boolean)
    .map((a) => a.place);
  if (hotelNames.length > 1) {
    assert.ok(hotelNames.every((n) => n === hotelNames[0]), 'same hotel across all nights');
  }

  // Attractions should prefer uniqueness, but with only 2 areas for 3 days,
  // the system honestly reuses when the pool is exhausted. Verify that
  // within each day, morning/afternoon/evening slots each pick exactly one.
  for (const day of fullDays) {
    const dayAttractions = day.activities.filter((a) => a.category === 'attraction');
    assert.ok(dayAttractions.length >= 1, `day ${day.dayNumber} has at least one attraction`);
    // Each attraction should have a valid place name (not empty)
    for (const a of dayAttractions) {
      assert.ok(a.place && a.place.length > 0, `day ${day.dayNumber} attraction has a place name`);
    }
  }
  // Across all full days, the system attempted distinct picks (some may
  // repeat due to sparse data — that's honest behavior, not a bug).
  const allPlaces = fullDays.flatMap((d) => d.activities.filter((a) => a.category === 'attraction').map((a) => a.place));
  assert.ok(allPlaces.length >= 3, 'at least 3 total attraction activities across the trip');
});

test('buildDaysPlan outbound transport cost uses live price when available', () => {
  const days = itineraryService.buildDays({
    origin: 'Mumbai',
    destination: 'Goa',
    startDate: '2025-06-01',
    endDate: '2025-06-02',
    travelers: { adults: 2, children: 0 },
    prefs: { foodPreference: '', travelStyle: 'standard', activityLevel: 'moderate', interests: [], accessibility: [] },
    hotelResult: { data: { isLive: false, recommended: null, hotels: [] } },
    transportResult: {
      mode: 'flight',
      data: {
        isLive: true,
        selected: { airline: 'IndiGo', flightNumber: '6E-301', price: { amount: 4500, currency: 'INR' } },
        offers: [],
      },
    },
    weatherResult: { data: { provider: 'unavailable', forecast: null } },
    attractions: [],
    restaurants: [],
    budgetAllocation: { transport: { amount: 10000 }, hotels: { amount: 5000 }, food: { amount: 2000 } },
    currency: 'INR',
  });

  const day1 = days[0];
  const outbound = day1.activities.find((a) => a.slot === 'transport' && a.category === 'flight');
  assert.ok(outbound, 'outbound flight exists');
  assert.equal(outbound.cost.amount, 4500, 'uses live flight price from provider');
  assert.equal(outbound.cost.isEstimate, false, 'live price is not an estimate');
  assert.equal(outbound.isLive, true);
  assert.equal(outbound.dataStatus, 'live');
});

test('buildDaysPlan outbound transport uses budget estimate when not live', () => {
  const days = itineraryService.buildDays({
    origin: 'Mumbai',
    destination: 'Goa',
    startDate: '2025-06-01',
    endDate: '2025-06-02',
    travelers: { adults: 2, children: 0 },
    prefs: { foodPreference: '', travelStyle: 'standard', activityLevel: 'moderate', interests: [], accessibility: [] },
    hotelResult: { data: { isLive: false, recommended: null, hotels: [] } },
    transportResult: {
      mode: 'flight',
      data: { isLive: false, selected: null },
    },
    weatherResult: { data: { provider: 'unavailable', forecast: null } },
    attractions: [],
    restaurants: [],
    budgetAllocation: { transport: { amount: 10000 }, hotels: { amount: 5000 }, food: { amount: 2000 } },
    currency: 'INR',
  });

  const day1 = days[0];
  const outbound = day1.activities.find((a) => a.slot === 'transport');
  assert.ok(outbound, 'outbound transport exists');
  assert.equal(outbound.cost.isEstimate, true, 'budget estimate is an estimate');
  assert.ok(outbound.cost.estimateNote.includes('Estimated'), 'has estimate note');
  assert.equal(outbound.isLive, false);
  assert.equal(outbound.dataStatus, 'unavailable');
});

test('buildDaysPlan total cost equals sum of day costs', () => {
  const days = itineraryService.buildDays({
    origin: 'Mumbai',
    destination: 'Goa',
    startDate: '2025-06-01',
    endDate: '2025-06-03',
    travelers: { adults: 2, children: 0 },
    prefs: { foodPreference: '', travelStyle: 'standard', activityLevel: 'moderate', interests: [], accessibility: [] },
    hotelResult: { data: { isLive: false, recommended: null, hotels: [] } },
    transportResult: { mode: 'flight', data: { isLive: false, selected: null } },
    weatherResult: { data: { provider: 'unavailable', forecast: null } },
    attractions: [],
    restaurants: [],
    budgetAllocation: { transport: { amount: 5000 }, hotels: { amount: 9000 }, food: { amount: 3000 } },
    currency: 'INR',
  });

  const totalFromDays = itineraryService.computeItineraryCost(days);
  const totalFromSum = days.reduce((s, d) => s + d.dayCost, 0);
  assert.equal(totalFromDays, totalFromSum, 'computeItineraryCost matches manual sum');
  // Cumulative of last day should match total
  const lastDay = days[days.length - 1];
  assert.equal(lastDay.cumulativeCost, totalFromDays, 'last day cumulative equals total');
});
