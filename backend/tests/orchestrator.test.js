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
  const hotel = day1.activities.find((a) => a.category === 'hotel');
  assert.equal(hotel.place, 'Grand Hotel');
  assert.equal(hotel.cost.isEstimate, false, 'live hotel price is not an estimate');
  assert.equal(hotel.isLive, true);
  const flight = day1.activities.find((a) => a.category === 'flight');
  assert.equal(flight.title.includes('Flight'), true);
});

test('final validator detects overlapping activities and budget overflow', () => {
  const days = [
    {
      dayNumber: 1,
      date: new Date('2025-06-01'),
      activities: [
        { title: 'A', time: '09:00', category: 'hotel', cost: { amount: 1000, isEstimate: false }, dataStatus: 'live' },
        { title: 'B', time: '09:30', category: 'restaurant', cost: { amount: 500, isEstimate: true }, dataStatus: 'estimate' },
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
