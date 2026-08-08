import test from 'node:test';
import assert from 'node:assert/strict';
import itineraryService from '../src/services/itinerary.service.js';
import finalValidatorAgent from '../src/agents/finalValidator.agent.js';

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
  assert.ok(result.issues.some((i) => i.includes('exceeds budget')));
  assert.ok(result.issues.some((i) => i.includes('overlaps')));
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
