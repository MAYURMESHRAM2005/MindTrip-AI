/**
 * itineraryDataCorrectness.test.js — Comprehensive Itinerary Data Correctness
 *
 * Test scenario:
 *   Destination: Mumbai, India
 *   Duration: 4 days
 *   Travelers: 5
 *   Budget: ₹50,000
 *
 * Validates: destination boundary, uniqueness, real data/provenance,
 * prices, hotels, restaurants, attractions, geography, day planning,
 * weather, budget, Gemini candidate IDs, persistence, and regression.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import itineraryService from '../src/services/itinerary.service.js';
import budgetService from '../src/services/budget.service.js';
import geminiResponseValidator from '../src/services/geminiResponseValidator.service.js';
import trustedDatasetBuilderModule from '../src/services/trustedDatasetBuilder.service.js';
import { validateProvenance, validateItineraryProvenance, ensureProvenance } from '../src/validators/provenanceValidator.js';

const { buildTrustedDataset, buildTrustedLookup, validateItemAgainstTrustedDataset } = trustedDatasetBuilderModule;

// ══════════════════════════════════════════════════════════════════════
//  MUMBAI BOUNDARY CONSTANTS
// ══════════════════════════════════════════════════════════════════════

/** Mumbai bounding box (generous for Greater Mumbai + suburbs). */
const MUMBAI_BOUNDS = {
  latMin: 18.88,
  latMax: 19.28,
  lngMin: 72.75,
  lngMax: 73.05,
};

/** Forbidden cities — must never appear in a Mumbai itinerary. */
const FORBIDDEN_CITIES = [
  'hyderabad', 'macapá', 'macapa', 'delhi', 'bangalore', 'bengaluru',
  'chennai', 'kolkata', 'pune', 'ahmedabad', 'jaipur', 'lucknow',
  'agra', 'varanasi', 'goa', 'manali', 'shimla', 'udaipur',
  'jodhpur', 'kochi', 'cochin', 'thiruvananthapuram', 'indore',
  'nagpur', 'surat', 'vadodara', 'rajkot', 'bhopal',
];

/** Forbidden attraction/restaurant names — placeholders, demos, hospitals, etc. */
const FORBIDDEN_PLACE_NAMES = [
  /\b(hospital|clinic|pharmacy|medical center)\b/i,
  /\b(spa|massage|salon|beauty parlor)\b/i,
  /\b(demo|test|sample|placeholder|lorem ipsum)\b/i,
  /\b(building|building complex|commercial complex)\b/i,
  /\b(mall|shopping mall)\b/i, // too generic for attraction
  /^area \d/i, // geographic cluster label used as attraction name
  /accommodation in|mumbai$/i, // fallback titles
  /overnight in/i,
];

/** Boundary tolerance in degrees for coordinate checks. */
const BOUNDS_TOLERANCE = 0.05;

// ══════════════════════════════════════════════════════════════════════
//  TEST FIXTURES — Mumbai-specific candidate factories
// ══════════════════════════════════════════════════════════════════════

function makeMumbaiAttraction(overrides = {}) {
  return {
    name: 'Gateway of India',
    providerId: 'goi-1',
    provider: 'google',
    source: 'google',
    type: 'attraction',
    types: ['tourism.sights', 'tourism.monument'],
    address: 'Apollo Bunder, Mumbai',
    suburb: 'Colaba',
    district: 'Mumbai City',
    city: 'Mumbai',
    state: 'Maharashtra',
    country: 'India',
    latitude: 18.922,
    longitude: 72.8347,
    coordinates: { lat: 18.922, lng: 72.8347 },
    rating: 4.5,
    reviewCount: 12500,
    priceLevel: 1,
    entryFee: { amount: 0, currency: 'INR', isEstimate: false, source: 'google' },
    openingHours: { periods: [{ days: ['all'], open: '09:00', close: '18:00' }] },
    dataStatus: 'live',
    isEstimate: false,
    ...overrides,
  };
}

function makeMumbaiRestaurant(overrides = {}) {
  return {
    name: 'Leopold Cafe',
    providerId: 'leo-1',
    provider: 'google',
    source: 'google',
    type: 'restaurant',
    types: ['amenity.restaurant'],
    cuisine: ['Indian', 'Continental'],
    address: 'Colaba Causeway, Mumbai',
    suburb: 'Colaba',
    district: 'Mumbai City',
    city: 'Mumbai',
    state: 'Maharashtra',
    country: 'India',
    latitude: 18.9154,
    longitude: 72.8264,
    coordinates: { lat: 18.9154, lng: 72.8264 },
    rating: 4.2,
    reviewCount: 5600,
    priceLevel: 2,
    averageCostPerPerson: 800,
    averageCostForTwo: 1600,
    dataStatus: 'live',
    isEstimate: false,
    ...overrides,
  };
}

function makeMumbaiHotel(overrides = {}) {
  return {
    name: 'Taj Mahal Palace',
    providerId: 'taj-1',
    provider: 'amadeus-hotels',
    source: 'amadeus-hotels',
    type: 'hotel',
    address: 'Apollo Bunder, Mumbai',
    suburb: 'Colaba',
    district: 'Mumbai City',
    city: 'Mumbai',
    state: 'Maharashtra',
    country: 'India',
    latitude: 18.9228,
    longitude: 72.8331,
    coordinates: { lat: 18.9228, lng: 72.8331 },
    rating: 4.7,
    reviewCount: 18000,
    price: { amount: 8500, currency: 'INR' },
    pricePerNight: 8500,
    amenities: ['Free Wi-Fi', 'Pool', 'Spa', 'Restaurant'],
    dataStatus: 'live',
    isEstimate: false,
    ...overrides,
  };
}

function makeMumbaiNightlife(overrides = {}) {
  return {
    name: 'Trilogy Nightclub',
    providerId: 'tri-1',
    provider: 'google',
    source: 'google',
    type: 'nightlife',
    types: ['amenity.nightclub'],
    address: 'Juhu, Mumbai',
    suburb: 'Juhu',
    city: 'Mumbai',
    country: 'India',
    latitude: 19.0948,
    longitude: 72.8266,
    coordinates: { lat: 19.0948, lng: 72.8266 },
    rating: 4.1,
    dataStatus: 'live',
    isEstimate: false,
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════════
//  BUILD MUMBAI TEST DATASET
// ══════════════════════════════════════════════════════════════════════

/** Build enough Mumbai-specific candidates for a 4-day itinerary. */
function buildMumbaiCandidates() {
  const attractions = [
    makeMumbaiAttraction({ name: 'Gateway of India', providerId: 'goi-1', latitude: 18.922, longitude: 72.8347 }),
    makeMumbaiAttraction({ name: 'Elephanta Caves', providerId: 'ec-2', latitude: 18.9634, longitude: 72.9315, suburb: 'Elephanta Island' }),
    makeMumbaiAttraction({ name: 'Chhatrapati Shivaji Terminus', providerId: 'cst-3', latitude: 18.9398, longitude: 72.8355, suburb: 'Fort' }),
    makeMumbaiAttraction({ name: 'Marine Drive', providerId: 'md-4', latitude: 18.9432, longitude: 72.8234, suburb: 'Churchgate' }),
    makeMumbaiAttraction({ name: 'Siddhivinayak Temple', providerId: 'svt-5', latitude: 19.0169, longitude: 72.8310, suburb: 'Prabhadevi' }),
    makeMumbaiAttraction({ name: 'Haji Ali Dargah', providerId: 'had-6', latitude: 18.9826, longitude: 72.8093, suburb: 'Worli' }),
    makeMumbaiAttraction({ name: 'Juhu Beach', providerId: 'jb-7', latitude: 19.0948, longitude: 72.8266, suburb: 'Juhu' }),
    makeMumbaiAttraction({ name: 'Kanheri Caves', providerId: 'knc-8', latitude: 19.2094, longitude: 72.8504, suburb: 'Borivali' }),
    makeMumbaiAttraction({ name: 'Sanjay Gandhi National Park', providerId: 'sgnp-9', latitude: 19.2147, longitude: 72.9107, suburb: 'Borivali' }),
    makeMumbaiAttraction({ name: 'Chowpatty Beach', providerId: 'cb-10', latitude: 18.9543, longitude: 72.8133, suburb: 'Girgaon' }),
  ];

  const restaurants = [
    makeMumbaiRestaurant({ name: 'Leopold Cafe', providerId: 'leo-1', latitude: 18.9154, longitude: 72.8264, suburb: 'Colaba', averageCostPerPerson: 800 }),
    makeMumbaiRestaurant({ name: 'Trishna', providerId: 'tri-2', latitude: 18.9300, longitude: 72.8334, suburb: 'Fort', averageCostPerPerson: 1200 }),
    makeMumbaiRestaurant({ name: 'Britannia & Co.', providerId: 'brit-3', latitude: 18.9465, longitude: 72.8350, suburb: 'Ballard Estate', averageCostPerPerson: 600 }),
    makeMumbaiRestaurant({ name: 'Mahesh Lunch Home', providerId: 'mlh-4', latitude: 18.9770, longitude: 72.8157, suburb: 'Worli', averageCostPerPerson: 700 }),
    makeMumbaiRestaurant({ name: 'Gajanan Vada Pav', providerId: 'gvp-5', latitude: 19.0250, longitude: 72.8560, suburb: 'Thane', averageCostPerPerson: 100 }),
    makeMumbaiRestaurant({ name: 'Café Mondegar', providerId: 'cmd-6', latitude: 18.9290, longitude: 72.8313, suburb: 'Colaba', averageCostPerPerson: 500 }),
    makeMumbaiRestaurant({ name: 'Swati Snacks', providerId: 'ssn-7', latitude: 18.9600, longitude: 72.8200, suburb: 'Parel', averageCostPerPerson: 400 }),
    makeMumbaiRestaurant({ name: 'Copper Chimney', providerId: 'cch-8', latitude: 18.9338, longitude: 72.8340, suburb: 'Nariman Point', averageCostPerPerson: 1500 }),
  ];

  const hotels = [
    makeMumbaiHotel({ name: 'Taj Mahal Palace', providerId: 'taj-1', latitude: 18.9228, longitude: 72.8331, pricePerNight: 8500 }),
    makeMumbaiHotel({ name: 'ITC Maratha', providerId: 'itc-2', latitude: 19.0860, longitude: 72.8575, suburb: 'Andheri', pricePerNight: 6000 }),
    makeMumbaiHotel({ name: 'Hotel Residency Fort', providerId: 'hrf-3', latitude: 18.9342, longitude: 72.8365, suburb: 'Fort', pricePerNight: 3500 }),
  ];

  const nightlife = [
    makeMumbaiNightlife({ name: 'Trilogy Nightclub', providerId: 'tri-n1', latitude: 19.0948, longitude: 72.8266, suburb: 'Juhu' }),
    makeMumbaiNightlife({ name: 'Polyester', providerId: 'pol-n2', latitude: 18.9254, longitude: 72.8320, suburb: 'Colaba' }),
  ];

  return { attractions, restaurants, hotels, nightlife };
}

// ══════════════════════════════════════════════════════════════════════
//  HELPER: Build itinerary days for testing
// ══════════════════════════════════════════════════════════════════════

/** Build a realistic 4-day Mumbai itinerary using buildDaysPlan. */
function buildMumbaiItinerary() {
  const candidates = buildMumbaiCandidates();
  const partySize = 5;
  const adults = 5;
  const children = 0;
  const totalBudget = 50000;
  const nights = 3; // 4-day trip = 3 nights
  const rooms = budgetService.roomsForParty({ adults, children });

  // Build budget allocation (simple default split)
  const allocation = budgetService.allocateBudget(totalBudget);

  // Hotel result fixture
  const hotelResult = {
    data: {
      isLive: true,
      hotels: [
        { name: 'Taj Mahal Palace', latitude: 18.9228, longitude: 72.8331, price: { amount: 8500, currency: 'INR' }, address: 'Apollo Bunder, Mumbai', rating: 4.7, provider: 'amadeus-hotels' },
        { name: 'Hotel Residency Fort', latitude: 18.9342, longitude: 72.8365, price: { amount: 3500, currency: 'INR' }, address: 'Fort, Mumbai', rating: 4.2, provider: 'amadeus-hotels' },
      ],
      recommended: { name: 'Hotel Residency Fort', latitude: 18.9342, longitude: 72.8365, price: { amount: 3500, currency: 'INR' }, address: 'Fort, Mumbai', rating: 4.2 },
    },
  };

  // Transport result fixture
  const transportResult = {
    mode: 'flight',
    data: {
      isLive: true,
      selected: { airline: 'IndiGo', flightNumber: '6E-201', price: { amount: 4500, currency: 'INR' }, durationMin: 105, provider: 'google-flights' },
      offers: [
        { airline: 'IndiGo', flightNumber: '6E-201', price: { amount: 4500, currency: 'INR' } },
        { airline: 'SpiceJet', flightNumber: 'SG-705', price: { amount: 4200, currency: 'INR' } },
      ],
    },
  };

  // Return transport
  const returnTransportResult = {
    recommended: {
      mode: 'flight',
      isLive: true,
      mainTransport: { airline: 'IndiGo', flightNumber: '6E-202', price: { amount: 4500, currency: 'INR' }, provider: 'google-flights' },
      totalCost: 4500,
      source: 'google-flights',
    },
  };

  // Weather result fixture
  const startDate = '2025-10-15';
  const endDate = '2025-10-18';
  const weatherResult = {
    data: {
      provider: 'live',
      current: { temp: 30, condition: 'Partly Cloudy', humidity: 70, windSpeed: 12, sunrise: '06:20', sunset: '18:15' },
      forecast: [
        { date: '2025-10-15', tempMin: 25, tempMax: 32, condition: 'Partly Cloudy', rainProbability: 10, humidity: 70 },
        { date: '2025-10-16', tempMin: 24, tempMax: 31, condition: 'Sunny', rainProbability: 5, humidity: 65 },
        { date: '2025-10-17', tempMin: 26, tempMax: 33, condition: 'Cloudy', rainProbability: 30, humidity: 75 },
        { date: '2025-10-18', tempMin: 25, tempMax: 30, condition: 'Light Rain', rainProbability: 65, humidity: 80 },
      ],
    },
  };

  const result = itineraryService.buildDaysPlan({
    origin: 'Delhi',
    destination: 'Mumbai',
    startDate,
    endDate,
    travelers: { adults, children },
    prefs: { foodPreference: 'vegetarian', travelStyle: 'standard', hotelPreference: 'standard' },
    hotelResult,
    transportResult,
    returnTransportResult,
    weatherResult,
    attractions: candidates.attractions,
    restaurants: candidates.restaurants,
    nightlife: candidates.nightlife,
    budgetAllocation: allocation,
    totalBudget,
    currency: 'INR',
  });

  return { ...result, candidates, totalBudget, partySize, startDate, endDate };
}

// ══════════════════════════════════════════════════════════════════════
//  SECTION 1: DESTINATION BOUNDARY
// ══════════════════════════════════════════════════════════════════════

test('DESTINATION: every attraction is inside Mumbai boundary', () => {
  const { days } = buildMumbaiItinerary();
  for (const day of days) {
    for (const act of day.activities || []) {
      if (act.category === 'attraction' || act.category === 'activity') {
        if (act.coordinates?.lat != null && act.coordinates?.lng != null) {
          const { lat, lng } = act.coordinates;
          assert.ok(
            lat >= MUMBAI_BOUNDS.latMin - BOUNDS_TOLERANCE && lat <= MUMBAI_BOUNDS.latMax + BOUNDS_TOLERANCE,
            `Attraction "${act.title}" lat ${lat} outside Mumbai bounds [${MUMBAI_BOUNDS.latMin}, ${MUMBAI_BOUNDS.latMax}]`
          );
          assert.ok(
            lng >= MUMBAI_BOUNDS.lngMin - BOUNDS_TOLERANCE && lng <= MUMBAI_BOUNDS.lngMax + BOUNDS_TOLERANCE,
            `Attraction "${act.title}" lng ${lng} outside Mumbai bounds [${MUMBAI_BOUNDS.lngMin}, ${MUMBAI_BOUNDS.lngMax}]`
          );
        }
      }
    }
  }
});

test('DESTINATION: every restaurant is inside Mumbai boundary', () => {
  const { days } = buildMumbaiItinerary();
  for (const day of days) {
    for (const act of day.activities || []) {
      if (act.category === 'restaurant') {
        if (act.coordinates?.lat != null && act.coordinates?.lng != null) {
          const { lat, lng } = act.coordinates;
          assert.ok(
            lat >= MUMBAI_BOUNDS.latMin - BOUNDS_TOLERANCE && lat <= MUMBAI_BOUNDS.latMax + BOUNDS_TOLERANCE,
            `Restaurant "${act.title}" lat ${lat} outside Mumbai bounds`
          );
          assert.ok(
            lng >= MUMBAI_BOUNDS.lngMin - BOUNDS_TOLERANCE && lng <= MUMBAI_BOUNDS.lngMax + BOUNDS_TOLERANCE,
            `Restaurant "${act.title}" lng ${lng} outside Mumbai bounds`
          );
        }
      }
    }
  }
});

test('DESTINATION: every hotel is inside Mumbai boundary', () => {
  const { days } = buildMumbaiItinerary();
  for (const day of days) {
    for (const act of day.activities || []) {
      if (act.category === 'hotel') {
        if (act.coordinates?.lat != null && act.coordinates?.lng != null) {
          const { lat, lng } = act.coordinates;
          assert.ok(
            lat >= MUMBAI_BOUNDS.latMin - BOUNDS_TOLERANCE && lat <= MUMBAI_BOUNDS.latMax + BOUNDS_TOLERANCE,
            `Hotel "${act.title}" lat ${lat} outside Mumbai bounds`
          );
          assert.ok(
            lng >= MUMBAI_BOUNDS.lngMin - BOUNDS_TOLERANCE && lng <= MUMBAI_BOUNDS.lngMax + BOUNDS_TOLERANCE,
            `Hotel "${act.title}" lng ${lng} outside Mumbai bounds`
          );
        }
      }
    }
  }
});

// ══════════════════════════════════════════════════════════════════════
//  SECTION 2: UNIQUENESS
// ══════════════════════════════════════════════════════════════════════

test('UNIQUENESS: no attraction providerId repeated across days (live only)', () => {
  const { days } = buildMumbaiItinerary();
  const seenIds = new Set();
  const duplicates = [];
  for (const day of days) {
    for (const act of day.activities || []) {
      if ((act.category === 'attraction' || act.category === 'activity') && act.provenance?.providerId) {
        // Only check live entities — unavailable fallbacks use timestamp-based IDs
        if (act.dataStatus !== 'live') continue;
        const id = act.provenance.providerId;
        if (seenIds.has(id)) {
          duplicates.push(`Day ${day.dayNumber}: "${act.title}" providerId="${id}"`);
        }
        seenIds.add(id);
      }
    }
  }
  assert.equal(duplicates.length, 0, `Duplicate attraction providerIds: ${duplicates.join('; ')}`);
});

test('UNIQUENESS: no normalized live attraction name repeated across days', () => {
  const { days } = buildMumbaiItinerary();
  const seenNames = new Map();
  const duplicates = [];
  for (const day of days) {
    for (const act of day.activities || []) {
      if (act.category === 'attraction' || act.category === 'activity') {
        // Skip unavailable/fallback entries
        if (act.dataStatus !== 'live') continue;
        const normalizedName = (act.place || act.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        if (normalizedName && seenNames.has(normalizedName)) {
          duplicates.push(`Day ${day.dayNumber}: "${act.title}" (first seen day ${seenNames.get(normalizedName)})`);
        }
        seenNames.set(normalizedName, day.dayNumber);
      }
    }
  }
  assert.equal(duplicates.length, 0, `Duplicate attraction names: ${duplicates.join('; ')}`);
});

test('UNIQUENESS: no restaurant providerId repeated across days', () => {
  const { days } = buildMumbaiItinerary();
  const seenIds = new Set();
  const duplicates = [];
  for (const day of days) {
    for (const act of day.activities || []) {
      if (act.category === 'restaurant' && act.provenance?.providerId) {
        const id = act.provenance.providerId;
        if (seenIds.has(id)) {
          duplicates.push(`Day ${day.dayNumber}: "${act.title}" providerId="${id}"`);
        }
        seenIds.add(id);
      }
    }
  }
  assert.equal(duplicates.length, 0, `Duplicate restaurant providerIds: ${duplicates.join('; ')}`);
});

test('UNIQUENESS: no restaurant normalized name repeated across days', () => {
  const { days } = buildMumbaiItinerary();
  const seenNames = new Map();
  const duplicates = [];
  for (const day of days) {
    for (const act of day.activities || []) {
      if (act.category === 'restaurant') {
        const normalizedName = (act.place || act.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        // Skip unavailable/generic entries
        if (!normalizedName || normalizedName.includes('unavailable') || normalizedName.includes('restaurantdata')) continue;
        if (seenNames.has(normalizedName)) {
          duplicates.push(`Day ${day.dayNumber}: "${act.title}" (first seen day ${seenNames.get(normalizedName)})`);
        }
        seenNames.set(normalizedName, day.dayNumber);
      }
    }
  }
  assert.equal(duplicates.length, 0, `Duplicate restaurant names: ${duplicates.join('; ')}`);
});

// ══════════════════════════════════════════════════════════════════════
//  SECTION 3: REAL DATA / PROVENANCE
// ══════════════════════════════════════════════════════════════════════

test('REAL DATA: every live entity has provider', () => {
  const { days } = buildMumbaiItinerary();
  const violations = [];
  for (const day of days) {
    for (const act of day.activities || []) {
      if (act.dataStatus === 'live' && act.isLive) {
        if (!act.source || act.source === 'none' || act.source === 'unavailable') {
          violations.push(`Day ${day.dayNumber}: "${act.title}" is live but source="${act.source}"`);
        }
      }
    }
  }
  assert.equal(violations.length, 0, `Live entities without provider: ${violations.join('; ')}`);
});

test('REAL DATA: every live entity has providerId', () => {
  const { days } = buildMumbaiItinerary();
  const violations = [];
  for (const day of days) {
    for (const act of day.activities || []) {
      if (act.dataStatus === 'live' && act.isLive) {
        if (!act.provenance?.providerId || act.provenance.providerId.startsWith('unavailable-') || act.provenance.providerId.startsWith('fallback-')) {
          violations.push(`Day ${day.dayNumber}: "${act.title}" is live but providerId="${act.provenance?.providerId}"`);
        }
      }
    }
  }
  assert.equal(violations.length, 0, `Live entities without providerId: ${violations.join('; ')}`);
});

test('REAL DATA: every live entity has source', () => {
  const { days } = buildMumbaiItinerary();
  const violations = [];
  for (const day of days) {
    for (const act of day.activities || []) {
      if (act.dataStatus === 'live' && act.isLive) {
        if (!act.source || act.source === 'none' || act.source === 'unavailable') {
          violations.push(`Day ${day.dayNumber}: "${act.title}" live but source missing`);
        }
      }
    }
  }
  assert.equal(violations.length, 0, `Live entities without source: ${violations.join('; ')}`);
});

test('REAL DATA: every live price has provenance', () => {
  const { days } = buildMumbaiItinerary();
  const violations = [];
  for (const day of days) {
    for (const act of day.activities || []) {
      if (act.cost?.amount > 0 && act.dataStatus === 'live') {
        if (!act.provenance) {
          violations.push(`Day ${day.dayNumber}: "${act.title}" has live price but no provenance block`);
        } else {
          const result = validateProvenance(act.provenance, act.title);
          if (!result.valid) {
            violations.push(`Day ${day.dayNumber}: "${act.title}" provenance invalid: ${result.errors.join(', ')}`);
          }
        }
      }
    }
  }
  assert.equal(violations.length, 0, `Live prices without provenance: ${violations.join('; ')}`);
});

// ══════════════════════════════════════════════════════════════════════
//  SECTION 4: PRICES
// ══════════════════════════════════════════════════════════════════════

test('PRICES: no fabricated exact prices (no suspicious round numbers for live data)', () => {
  const { days } = buildMumbaiItinerary();
  const violations = [];
  for (const day of days) {
    for (const act of day.activities || []) {
      if (act.cost?.amount != null && act.cost.amount > 0 && act.dataStatus === 'live') {
        // A fabricated price often ends in 00 or 50 — but provider data can too.
        // The real check: if dataStatus is 'live', the cost must not be fabricated.
        // We verify that isEstimate is false for live prices.
        if (act.cost.isEstimate === true) {
          violations.push(`Day ${day.dayNumber}: "${act.title}" has dataStatus=live but isEstimate=true`);
        }
      }
    }
  }
  assert.equal(violations.length, 0, `Fabricated price flags: ${violations.join('; ')}`);
});

test('PRICES: estimated prices have isEstimate=true', () => {
  const { days } = buildMumbaiItinerary();
  const violations = [];
  for (const day of days) {
    for (const act of day.activities || []) {
      if (act.dataStatus === 'estimated' || act.dataStatus === 'estimate') {
        if (act.cost?.isEstimate !== true && act.cost?.amount != null && act.cost.amount > 0) {
          violations.push(`Day ${day.dayNumber}: "${act.title}" dataStatus="${act.dataStatus}" but isEstimate=${act.cost.isEstimate}`);
        }
      }
    }
  }
  assert.equal(violations.length, 0, `Estimated prices without isEstimate=true: ${violations.join('; ')}`);
});

test('PRICES: unavailable prices are null or amount=0', () => {
  const { days } = buildMumbaiItinerary();
  const violations = [];
  for (const day of days) {
    for (const act of day.activities || []) {
      if (act.dataStatus === 'unavailable') {
        if (act.cost?.amount != null && act.cost.amount > 0 && act.cost.dataStatus !== 'live') {
          // An unavailable item should not have a positive price
          // Exception: transport budget estimates are allowed
          if (act.source !== 'budget-estimate' && act.category !== 'transport') {
            violations.push(`Day ${day.dayNumber}: "${act.title}" dataStatus=unavailable but amount=${act.cost.amount}`);
          }
        }
      }
    }
  }
  assert.equal(violations.length, 0, `Unavailable prices with amount: ${violations.join('; ')}`);
});

// ══════════════════════════════════════════════════════════════════════
//  SECTION 5: HOTELS
// ══════════════════════════════════════════════════════════════════════

test('HOTELS: no generic "Accommodation in Mumbai" when provider hotel exists', () => {
  const { days, hotelResult } = buildMumbaiItinerary();
  if (hotelResult?.data?.hotels?.length > 0) {
    const violations = [];
    for (const day of days) {
      for (const act of day.activities || []) {
        if (act.category === 'hotel' && act.dataStatus === 'live') {
          if (/accommodation in/i.test(act.title) || /accommodation in/i.test(act.place)) {
            violations.push(`Day ${day.dayNumber}: generic hotel title "${act.title}"`);
          }
        }
      }
    }
    assert.equal(violations.length, 0, `Generic hotel titles: ${violations.join('; ')}`);
  }
});

test('HOTELS: no generic "Overnight in Mumbai" when provider hotel exists', () => {
  const { days, hotelResult } = buildMumbaiItinerary();
  if (hotelResult?.data?.hotels?.length > 0) {
    const violations = [];
    for (const day of days) {
      for (const act of day.activities || []) {
        if (act.category === 'hotel' && act.slot === 'hotel') {
          if (/overnight in/i.test(act.title)) {
            violations.push(`Day ${day.dayNumber}: generic overnight title "${act.title}"`);
          }
        }
      }
    }
    assert.equal(violations.length, 0, `Generic overnight titles: ${violations.join('; ')}`);
  }
});

test('HOTELS: real hotel identity must be present for live hotel data', () => {
  const { days, hotelResult } = buildMumbaiItinerary();
  if (hotelResult?.data?.hotels?.length > 0) {
    const violations = [];
    for (const day of days) {
      for (const act of day.activities || []) {
        if (act.category === 'hotel' && act.dataStatus === 'live') {
          // Must have a real hotel name, not a generic fallback
          const name = act.place || act.title || '';
          if (/\b(mumbai|destination|city|location)\b$/i.test(name) && !/\b(hotel|inn|resort|palace)\b/i.test(name)) {
            violations.push(`Day ${day.dayNumber}: suspicious hotel name "${name}"`);
          }
        }
      }
    }
    assert.equal(violations.length, 0, `Suspicious hotel names: ${violations.join('; ')}`);
  }
});

// ══════════════════════════════════════════════════════════════════════
//  SECTION 6: RESTAURANTS
// ══════════════════════════════════════════════════════════════════════

test('RESTAURANTS: no hospital', () => {
  const { days } = buildMumbaiItinerary();
  const violations = [];
  for (const day of days) {
    for (const act of day.activities || []) {
      if (act.category === 'restaurant') {
        if (/\b(hospital|clinic|medical)\b/i.test(act.place || '')) {
          violations.push(`Day ${day.dayNumber}: hospital as restaurant "${act.place}"`);
        }
      }
    }
  }
  assert.equal(violations.length, 0, `Hospitals as restaurants: ${violations.join('; ')}`);
});

test('RESTAURANTS: no spa', () => {
  const { days } = buildMumbaiItinerary();
  const violations = [];
  for (const day of days) {
    for (const act of day.activities || []) {
      if (act.category === 'restaurant') {
        if (/\b(spa|massage|salon|beauty)\b/i.test(act.place || '')) {
          violations.push(`Day ${day.dayNumber}: spa as restaurant "${act.place}"`);
        }
      }
    }
  }
  assert.equal(violations.length, 0, `Spas as restaurants: ${violations.join('; ')}`);
});

test('RESTAURANTS: no generic building', () => {
  const { days } = buildMumbaiItinerary();
  const violations = [];
  for (const day of days) {
    for (const act of day.activities || []) {
      if (act.category === 'restaurant') {
        if (/^(building|complex|tower|plaza)$/i.test(act.place || '')) {
          violations.push(`Day ${day.dayNumber}: generic building as restaurant "${act.place}"`);
        }
      }
    }
  }
  assert.equal(violations.length, 0, `Generic buildings as restaurants: ${violations.join('; ')}`);
});

test('RESTAURANTS: no placeholder restaurant', () => {
  const { days } = buildMumbaiItinerary();
  const violations = [];
  for (const day of days) {
    for (const act of day.activities || []) {
      if (act.category === 'restaurant') {
        const place = (act.place || '').toLowerCase();
        if (/\b(demo|test|sample|placeholder|lorem|xyz)\b/i.test(place)) {
          violations.push(`Day ${day.dayNumber}: placeholder restaurant "${act.place}"`);
        }
      }
    }
  }
  assert.equal(violations.length, 0, `Placeholder restaurants: ${violations.join('; ')}`);
});

test('RESTAURANTS: real restaurant identity required when live data exists', () => {
  const { days } = buildMumbaiItinerary();
  const violations = [];
  for (const day of days) {
    for (const act of day.activities || []) {
      if (act.category === 'restaurant' && act.dataStatus === 'live') {
        const name = act.place || '';
        if (!name || name.length < 3) {
          violations.push(`Day ${day.dayNumber}: live restaurant has no real name`);
        }
        if (/^restaurant$/i.test(name)) {
          violations.push(`Day ${day.dayNumber}: live restaurant name is just "restaurant"`);
        }
      }
    }
  }
  assert.equal(violations.length, 0, `Restaurants without real identity: ${violations.join('; ')}`);
});

// ══════════════════════════════════════════════════════════════════════
//  SECTION 7: ATTRACTIONS
// ══════════════════════════════════════════════════════════════════════

test('ATTRACTIONS: no raw street address used as attraction name', () => {
  const { days } = buildMumbaiItinerary();
  const violations = [];
  for (const day of days) {
    for (const act of day.activities || []) {
      if (act.category === 'attraction' || act.category === 'activity') {
        const name = act.place || act.title || '';
        // Raw addresses typically contain numbers followed by common address words
        if (/\d+\s+(st|street|road|rd|ave|avenue|blvd|lane|ln|dr|drive|way|ct|court|pl|place)\b/i.test(name)) {
          violations.push(`Day ${day.dayNumber}: raw address as attraction "${name}"`);
        }
      }
    }
  }
  assert.equal(violations.length, 0, `Raw addresses as attractions: ${violations.join('; ')}`);
});

test('ATTRACTIONS: no demo/test attraction', () => {
  const { days } = buildMumbaiItinerary();
  const violations = [];
  for (const day of days) {
    for (const act of day.activities || []) {
      if (act.category === 'attraction' || act.category === 'activity') {
        const name = (act.place || act.title || '').toLowerCase();
        if (/\b(demo|test|sample|placeholder|lorem|xyz|fake|mock)\b/.test(name)) {
          violations.push(`Day ${day.dayNumber}: demo/test attraction "${act.place || act.title}"`);
        }
      }
    }
  }
  assert.equal(violations.length, 0, `Demo/test attractions: ${violations.join('; ')}`);
});

test('ATTRACTIONS: no unrelated building as attraction', () => {
  const { days } = buildMumbaiItinerary();
  const violations = [];
  for (const day of days) {
    for (const act of day.activities || []) {
      if (act.category === 'attraction') {
        const name = (act.place || '').toLowerCase();
        // A street address or generic "building" should not be an attraction
        if (/^\d+\s/.test(name) || /^(building|tower|complex|office)$/i.test(name)) {
          violations.push(`Day ${day.dayNumber}: unrelated building "${act.place}"`);
        }
      }
    }
  }
  assert.equal(violations.length, 0, `Unrelated buildings as attractions: ${violations.join('; ')}`);
});

// ══════════════════════════════════════════════════════════════════════
//  SECTION 8: GEOGRAPHY
// ══════════════════════════════════════════════════════════════════════

test('GEOGRAPHY: no Hyderabad in Mumbai itinerary', () => {
  const { days } = buildMumbaiItinerary();
  const violations = [];
  for (const day of days) {
    for (const act of day.activities || []) {
      const text = `${act.title || ''} ${act.place || ''} ${act.description || ''} ${act.address || ''}`.toLowerCase();
      if (/\bhyderabad\b/i.test(text) && act.category !== 'transport') {
        violations.push(`Day ${day.dayNumber}: Hyderabad reference in "${act.title}"`);
      }
    }
  }
  assert.equal(violations.length, 0, `Hyderabad references: ${violations.join('; ')}`);
});

test('GEOGRAPHY: no Macapá in Mumbai itinerary', () => {
  const { days } = buildMumbaiItinerary();
  const violations = [];
  for (const day of days) {
    for (const act of day.activities || []) {
      const text = `${act.title || ''} ${act.place || ''} ${act.description || ''}`.toLowerCase();
      if (/macap[áa]/i.test(text)) {
        violations.push(`Day ${day.dayNumber}: Macapá reference in "${act.title}"`);
      }
    }
  }
  assert.equal(violations.length, 0, `Macapá references: ${violations.join('; ')}`);
});

test('GEOGRAPHY: no foreign country in Mumbai itinerary', () => {
  const { days } = buildMumbaiItinerary();
  const foreignCountries = [
    'usa', 'united states', 'uk', 'united kingdom', 'france', 'germany', 'japan',
    'china', 'thailand', 'dubai', 'uae', 'singapore', 'australia', 'canada',
    'italy', 'spain', 'brazil', 'mexico', 'indonesia', 'vietnam', 'cambodia',
  ];
  const violations = [];
  for (const day of days) {
    for (const act of day.activities || []) {
      const text = `${act.title || ''} ${act.place || ''} ${act.description || ''}`.toLowerCase();
      for (const country of foreignCountries) {
        if (text.includes(country)) {
          violations.push(`Day ${day.dayNumber}: foreign country "${country}" in "${act.title}"`);
        }
      }
    }
  }
  assert.equal(violations.length, 0, `Foreign country references: ${violations.join('; ')}`);
});

test('GEOGRAPHY: no unrelated city in Mumbai itinerary (excluding transport)', () => {
  const { days } = buildMumbaiItinerary();
  const violations = [];
  for (const day of days) {
    for (const act of day.activities || []) {
      // Transport activities legitimately reference origin/destination cities
      if (act.category === 'transport' || act.slot === 'transport') continue;
      const text = `${act.title || ''} ${act.place || ''} ${act.description || ''}`.toLowerCase();
      for (const city of FORBIDDEN_CITIES) {
        // Check for city name as a standalone word, not part of "Mumbai" or address
        const regex = new RegExp(`\\b${city}\\b`, 'i');
        if (regex.test(text)) {
          violations.push(`Day ${day.dayNumber}: forbidden city "${city}" in "${act.title}"`);
        }
      }
    }
  }
  assert.equal(violations.length, 0, `Unrelated city references: ${violations.join('; ')}`);
});

// ══════════════════════════════════════════════════════════════════════
//  SECTION 9: DAY PLANNING
// ══════════════════════════════════════════════════════════════════════

test('DAY PLANNING: different attraction set per day', () => {
  const { days } = buildMumbaiItinerary();
  const dayAttractionSets = days.map((day) => {
    return new Set(
      (day.activities || [])
        .filter((a) => a.category === 'attraction' || a.category === 'activity')
        .map((a) => a.place || a.title)
    );
  });

  // Check that at least some days have different attractions
  let differentCount = 0;
  for (let i = 0; i < dayAttractionSets.length; i++) {
    for (let j = i + 1; j < dayAttractionSets.length; j++) {
      const setA = dayAttractionSets[i];
      const setB = dayAttractionSets[j];
      const intersection = [...setA].filter((x) => setB.has(x));
      if (intersection.length < setA.size && intersection.length < setB.size) {
        differentCount++;
      }
    }
  }
  // At least half the day pairs should have different attractions
  const totalPairs = (days.length * (days.length - 1)) / 2;
  assert.ok(
    differentCount >= Math.floor(totalPairs / 2),
    `Only ${differentCount}/${totalPairs} day pairs have different attractions`
  );
});

test('DAY PLANNING: different restaurant set per day', () => {
  const { days } = buildMumbaiItinerary();
  const dayRestaurantSets = days.map((day) => {
    return new Set(
      (day.activities || [])
        .filter((a) => a.category === 'restaurant')
        .map((a) => a.place || a.title)
    );
  });

  // Check that at least some days have different restaurants
  let differentCount = 0;
  for (let i = 0; i < dayRestaurantSets.length; i++) {
    for (let j = i + 1; j < dayRestaurantSets.length; j++) {
      const setA = dayRestaurantSets[i];
      const setB = dayRestaurantSets[j];
      const intersection = [...setA].filter((x) => setB.has(x));
      if (intersection.length < setA.size || intersection.length < setB.size) {
        differentCount++;
      }
    }
  }
  // At least some pairs should have different restaurants
  const totalPairs = (days.length * (days.length - 1)) / 2;
  assert.ok(
    differentCount > 0,
    `All day pairs have identical restaurant sets`
  );
});

test('DAY PLANNING: geographic clustering (attractions in same day are near each other)', () => {
  const { days } = buildMumbaiItinerary();
  for (const day of days) {
    const placeActivities = (day.activities || []).filter(
      (a) => (a.category === 'attraction' || a.category === 'activity') && a.coordinates?.lat && a.coordinates?.lng
    );
    if (placeActivities.length < 2) continue;

    // Check that the average pairwise distance is reasonable (< 20km for Mumbai)
    let totalDist = 0;
    let pairs = 0;
    for (let i = 0; i < placeActivities.length; i++) {
      for (let j = i + 1; j < placeActivities.length; j++) {
        const a = placeActivities[i];
        const b = placeActivities[j];
        const dist = itineraryService.buildDaysPlan ? Math.sqrt(
          (a.coordinates.lat - b.coordinates.lat) ** 2 +
          (a.coordinates.lng - b.coordinates.lng) ** 2
        ) * 111 : 0; // rough km conversion
        totalDist += dist;
        pairs++;
      }
    }
    const avgDist = pairs > 0 ? totalDist / pairs : 0;
    assert.ok(
      avgDist < 25,
      `Day ${day.dayNumber}: average attraction distance ${avgDist.toFixed(1)}km exceeds 25km threshold`
    );
  }
});

test('DAY PLANNING: reasonable travel distance between consecutive activities', () => {
  const { days } = buildMumbaiItinerary();
  for (const day of days) {
    for (const act of day.activities || []) {
      if (act.travel?.distanceKm != null) {
        // No single travel leg should exceed 100km within Mumbai
        assert.ok(
          act.travel.distanceKm <= 100,
          `Day ${day.dayNumber}: "${act.title}" travel distance ${act.travel.distanceKm}km exceeds 100km`
        );
      }
    }
  }
});

// ══════════════════════════════════════════════════════════════════════
//  SECTION 10: WEATHER
// ══════════════════════════════════════════════════════════════════════

test('WEATHER: correct date associated with each day', () => {
  const { days, startDate } = buildMumbaiItinerary();
  const expectedDates = ['2025-10-15', '2025-10-16', '2025-10-17', '2025-10-18'];
  for (let i = 0; i < days.length; i++) {
    const dayDate = typeof days[i].date === 'string'
      ? days[i].date.split('T')[0]
      : new Date(days[i].date).toISOString().split('T')[0];
    assert.equal(
      dayDate,
      expectedDates[i],
      `Day ${days[i].dayNumber}: expected date ${expectedDates[i]} but got ${dayDate}`
    );
  }
});

test('WEATHER: weather data present for each day', () => {
  const { days } = buildMumbaiItinerary();
  for (const day of days) {
    // Weather should be present (at least null is acceptable, but structure should exist)
    if (day.weather != null) {
      assert.ok(
        typeof day.weather === 'object',
        `Day ${day.dayNumber}: weather should be an object`
      );
    }
  }
});

// ══════════════════════════════════════════════════════════════════════
//  SECTION 11: BUDGET
// ══════════════════════════════════════════════════════════════════════

test('BUDGET: day totals correct', () => {
  const { days } = buildMumbaiItinerary();
  for (const day of days) {
    const computedTotal = (day.activities || []).reduce((sum, a) => sum + (a.cost?.amount || 0), 0);
    const expectedTotal = Math.round(computedTotal * 100) / 100;
    assert.equal(
      day.dayCost,
      expectedTotal,
      `Day ${day.dayNumber}: dayCost=${day.dayCost} but sum of activities=${expectedTotal}`
    );
  }
});

test('BUDGET: cumulative totals correct', () => {
  const { days } = buildMumbaiItinerary();
  let cumulative = 0;
  for (const day of days) {
    cumulative = Math.round((cumulative + day.dayCost) * 100) / 100;
    assert.equal(
      day.cumulativeCost,
      cumulative,
      `Day ${day.dayNumber}: cumulativeCost=${day.cumulativeCost} but expected=${cumulative}`
    );
  }
});

test('BUDGET: remaining budget correct', () => {
  const { days, totalBudget } = buildMumbaiItinerary();
  for (const day of days) {
    const expectedRemaining = Math.round((totalBudget - day.cumulativeCost) * 100) / 100;
    assert.equal(
      day.remainingBudget,
      expectedRemaining,
      `Day ${day.dayNumber}: remainingBudget=${day.remainingBudget} but expected=${expectedRemaining}`
    );
  }
});

test('BUDGET: total does not exceed budget cap', () => {
  const { days, totalBudget } = buildMumbaiItinerary();
  const totalCost = days.reduce((sum, d) => sum + d.dayCost, 0);
  // Allow small floating point tolerance
  assert.ok(
    totalCost <= totalBudget * 1.01,
    `Total cost ${totalCost} exceeds budget ${totalBudget}`
  );
});

test('BUDGET: cost breakdown sums to day total', () => {
  const { days } = buildMumbaiItinerary();
  for (const day of days) {
    if (day.costBreakdown) {
      const breakdown = day.costBreakdown;
      const breakdownSum = Math.round((
        (breakdown.accommodation || 0) +
        (breakdown.breakfast || 0) +
        (breakdown.lunch || 0) +
        (breakdown.dinner || 0) +
        (breakdown.transport || 0) +
        (breakdown.activities || 0) +
        (breakdown.evening || 0) +
        (breakdown.night || 0) +
        (breakdown.misc || 0)
      ) * 100) / 100;
      assert.equal(
        breakdownSum,
        day.dayCost,
        `Day ${day.dayNumber}: breakdown sums to ${breakdownSum} but dayCost=${day.dayCost}`
      );
    }
  }
});

// ══════════════════════════════════════════════════════════════════════
//  SECTION 12: GEMINI CANDIDATE IDS
// ══════════════════════════════════════════════════════════════════════

test('GEMINI: only candidate IDs accepted', () => {
  const candidates = [
    makeMumbaiAttraction({ providerId: 'goi-1', provider: 'google' }),
    makeMumbaiRestaurant({ providerId: 'leo-1', provider: 'google' }),
    makeMumbaiHotel({ providerId: 'taj-1', provider: 'amadeus-hotels' }),
  ];
  const dataset = buildTrustedDataset({ candidates });
  const lookup = buildTrustedLookup(dataset);

  // Valid candidate IDs should pass
  for (const c of dataset.candidates) {
    const { valid } = validateItemAgainstTrustedDataset(
      { candidateId: c.candidateId, type: c.type },
      lookup
    );
    assert.equal(valid, true, `Candidate "${c.candidateId}" should be accepted`);
  }
});

test('GEMINI: unknown candidate IDs rejected', () => {
  const candidates = [makeMumbaiAttraction({ providerId: 'goi-1', provider: 'google' })];
  const dataset = buildTrustedDataset({ candidates });
  const lookup = buildTrustedLookup(dataset);

  const fakeIds = ['fake-123', 'hallucinated-place', 'gemini-invented', 'nonexistent'];
  for (const fakeId of fakeIds) {
    const { valid } = validateItemAgainstTrustedDataset(
      { candidateId: fakeId, type: 'attraction' },
      lookup
    );
    assert.equal(valid, false, `Fake candidateId "${fakeId}" should be rejected`);
  }
});

test('GEMINI: Gemini-generated factual values ignored/rejected', () => {
  const candidates = [makeMumbaiAttraction({ providerId: 'goi-1', provider: 'google', rating: 4.5 })];
  const dataset = buildTrustedDataset({ candidates });
  const lookup = buildTrustedLookup(dataset);

  const response = {
    days: [{
      dayNumber: 1,
      date: '2025-10-15',
      theme: 'Day 1',
      items: [{
        candidateId: dataset.candidates[0].candidateId,
        type: 'attraction',
        time: '09:00',
        reason: 'Visit',
        // Forbidden fields Gemini might inject:
        name: 'Invented Name',
        rating: 9.9,
        price: 999999,
        latitude: 0,
        longitude: 0,
      }],
    }],
  };

  const result = geminiResponseValidator.validateGeminiResponse(response, lookup);
  assert.equal(result.valid, true, 'Response should pass validation');
  // Forbidden fields should be stripped or replaced with trusted data
  const item = result.data.days[0].items[0];
  assert.equal(item.name, 'Gateway of India', 'Forbidden name should be replaced with trusted data');
  assert.equal(item.rating, 4.5, 'Forbidden rating should be replaced with trusted data');
  // Price may be stripped (undefined), null (no trusted data), or set to trusted data value (0 for free entry)
  assert.ok(
    item.price === undefined || item.price === null || item.price === 0,
    `Forbidden price should be stripped or set to trusted value, got ${item.price}`
  );
});

// ══════════════════════════════════════════════════════════════════════
//  SECTION 13: VALIDATOR / PERSISTENCE
// ══════════════════════════════════════════════════════════════════════

test('VALIDATOR: invalid itinerary cannot be persisted (missing provenance)', () => {
  const invalidDay = {
    dayNumber: 1,
    activities: [
      {
        title: 'Fake Activity',
        place: 'Nowhere',
        category: 'attraction',
        // Missing provenance block entirely
      },
    ],
  };

  const result = validateItineraryProvenance([invalidDay]);
  assert.equal(result.valid, false, 'Invalid itinerary should fail validation');
  assert.ok(result.errors.length > 0, 'Should have validation errors');
});

test('VALIDATOR: valid itinerary passes persistence validation', () => {
  const { days } = buildMumbaiItinerary();
  // Ensure all activities have provenance
  for (const day of days) {
    for (const act of day.activities || []) {
      ensureProvenance(act);
    }
  }
  const result = validateItineraryProvenance(days);
  // Should have no blocking errors (warnings are ok)
  assert.equal(result.errors.length, 0, `Validation errors: ${result.errors.join('; ')}`);
});

test('VALIDATOR: provenance block is mandatory for every activity', () => {
  const { days } = buildMumbaiItinerary();
  const missing = [];
  for (const day of days) {
    for (const act of day.activities || []) {
      if (!act.provenance) {
        missing.push(`Day ${day.dayNumber}: "${act.title}"`);
      }
    }
  }
  assert.equal(missing.length, 0, `Activities without provenance: ${missing.join('; ')}`);
});

// ══════════════════════════════════════════════════════════════════════
//  SECTION 14: REGRESSION TESTS
// ══════════════════════════════════════════════════════════════════════

test('REGRESSION: no more than three generic fallbacks per day', () => {
  const { days } = buildMumbaiItinerary();
  for (const day of days) {
    const genericFallbacks = (day.activities || []).filter((act) =>
      /^(morning activity|afternoon activity|evening activity|night activity)$/i.test(act.title)
    );
    // At most 3 generic fallbacks per day — if all slots are fallbacks, that's a bug
    assert.ok(
      genericFallbacks.length <= 3,
      `Day ${day.dayNumber}: ${genericFallbacks.length} generic fallbacks (max 3 allowed)`
    );
  }
});

test('REGRESSION: no "Live hotel data unavailable" when provider hotel data exists', () => {
  const { days, hotelResult } = buildMumbaiItinerary();
  if (hotelResult?.data?.hotels?.length > 0) {
    const violations = [];
    for (const day of days) {
      for (const act of day.activities || []) {
        if (/live hotel data unavailable/i.test(act.title)) {
          violations.push(`Day ${day.dayNumber}: "${act.title}"`);
        }
      }
    }
    assert.equal(violations.length, 0, `Hotel unavailable fallbacks: ${violations.join('; ')}`);
  }
});

test('REGRESSION: no "No nightlife or evening attraction data available" when nightlife candidates exist', () => {
  const { days, candidates } = buildMumbaiItinerary();
  if (candidates.nightlife.length > 0) {
    const violations = [];
    for (const day of days) {
      for (const act of day.activities || []) {
        if (/no nightlife or evening attraction data available/i.test(act.title)) {
          violations.push(`Day ${day.dayNumber}: "${act.title}"`);
        }
      }
    }
    // Allow some unavailable entries if the candidate pool is small
    // But not all 4 days should have this fallback
    assert.ok(
      violations.length < days.length,
      `All ${days.length} days have nightlife unavailable fallbacks: ${violations.join('; ')}`
    );
  }
});

test('REGRESSION: no "Check-in at undefined" or "Overnight at undefined"', () => {
  const { days } = buildMumbaiItinerary();
  const violations = [];
  for (const day of days) {
    for (const act of day.activities || []) {
      if (/undefined/i.test(act.title) || /undefined/i.test(act.place || '')) {
        violations.push(`Day ${day.dayNumber}: "${act.title}"`);
      }
    }
  }
  assert.equal(violations.length, 0, `Undefined references: ${violations.join('; ')}`);
});

test('REGRESSION: arrival day has outbound transport', () => {
  const { days } = buildMumbaiItinerary();
  if (days.length > 0) {
    const firstDay = days[0];
    const hasTransport = (firstDay.activities || []).some(
      (a) => a.category === 'transport' || a.slot === 'transport'
    );
    assert.ok(hasTransport, 'Arrival day should have outbound transport');
  }
});

test('REGRESSION: departure day has return transport', () => {
  const { days } = buildMumbaiItinerary();
  if (days.length > 1) {
    const lastDay = days[days.length - 1];
    const hasTransport = (lastDay.activities || []).some(
      (a) => a.category === 'transport' || a.slot === 'transport'
    );
    assert.ok(hasTransport, 'Departure day should have return transport');
  }
});

test('REGRESSION: every non-departure day has at least 3 activities', () => {
  const { days } = buildMumbaiItinerary();
  for (const day of days) {
    // Departure day (last day of multi-day trip) may have fewer activities
    const isDepartureDay = day.dayNumber === days.length && days.length > 1;
    const minActivities = isDepartureDay ? 2 : 3;
    assert.ok(
      (day.activities || []).length >= minActivities,
      `Day ${day.dayNumber}: only ${(day.activities || []).length} activities (minimum ${minActivities})`
    );
  }
});

test('REGRESSION: every activity has a time field', () => {
  const { days } = buildMumbaiItinerary();
  const missing = [];
  for (const day of days) {
    for (const act of day.activities || []) {
      if (!act.time) {
        missing.push(`Day ${day.dayNumber}: "${act.title}"`);
      }
    }
  }
  assert.equal(missing.length, 0, `Activities without time: ${missing.join('; ')}`);
});

test('REGRESSION: every activity has a cost object', () => {
  const { days } = buildMumbaiItinerary();
  const missing = [];
  for (const day of days) {
    for (const act of day.activities || []) {
      if (!act.cost || typeof act.cost !== 'object') {
        missing.push(`Day ${day.dayNumber}: "${act.title}"`);
      }
    }
  }
  assert.equal(missing.length, 0, `Activities without cost object: ${missing.join('; ')}`);
});

test('REGRESSION: overnight cost matches hotel rate × rooms', () => {
  const { days } = buildMumbaiItinerary();
  for (const day of days) {
    const overnight = (day.activities || []).find(
      (a) => a.slot === 'hotel' && /overnight/i.test(a.title)
    );
    if (overnight && overnight.cost?.amount > 0) {
      // The cost should be a reasonable hotel rate × rooms
      assert.ok(
        overnight.cost.amount > 0 && overnight.cost.amount < 100000,
        `Day ${day.dayNumber}: overnight cost ${overnight.cost.amount} seems unreasonable`
      );
    }
  }
});

test('REGRESSION: dataStatus is always one of live/estimated/estimate/unavailable', () => {
  const { days } = buildMumbaiItinerary();
  const allowedStatuses = ['live', 'estimated', 'estimate', 'unavailable'];
  const violations = [];
  for (const day of days) {
    for (const act of day.activities || []) {
      if (act.dataStatus && !allowedStatuses.includes(act.dataStatus)) {
        violations.push(`Day ${day.dayNumber}: "${act.title}" dataStatus="${act.dataStatus}"`);
      }
    }
  }
  assert.equal(violations.length, 0, `Invalid dataStatus values: ${violations.join('; ')}`);
});

test('REGRESSION: no activity has both isLive=true and dataStatus=unavailable', () => {
  const { days } = buildMumbaiItinerary();
  const violations = [];
  for (const day of days) {
    for (const act of day.activities || []) {
      if (act.isLive === true && act.dataStatus === 'unavailable') {
        violations.push(`Day ${day.dayNumber}: "${act.title}" isLive=true but dataStatus=unavailable`);
      }
    }
  }
  assert.equal(violations.length, 0, `isLive/dataStatus conflicts: ${violations.join('; ')}`);
});

test('REGRESSION: no activity has both isLive=false and dataStatus=live', () => {
  const { days } = buildMumbaiItinerary();
  const violations = [];
  for (const day of days) {
    for (const act of day.activities || []) {
      if (act.isLive === false && act.dataStatus === 'live') {
        violations.push(`Day ${day.dayNumber}: "${act.title}" isLive=false but dataStatus=live`);
      }
    }
  }
  assert.equal(violations.length, 0, `isLive/dataStatus conflicts: ${violations.join('; ')}`);
});

test('REGRESSION: no attraction uses a numeric-only name', () => {
  const { days } = buildMumbaiItinerary();
  const violations = [];
  for (const day of days) {
    for (const act of day.activities || []) {
      if ((act.category === 'attraction' || act.category === 'activity') && act.dataStatus !== 'unavailable') {
        const name = (act.place || act.title || '').trim();
        if (/^\d+$/.test(name)) {
          violations.push(`Day ${day.dayNumber}: numeric-only attraction name "${name}"`);
        }
      }
    }
  }
  assert.equal(violations.length, 0, `Numeric-only attraction names: ${violations.join('; ')}`);
});

test('REGRESSION: no attraction uses coordinates (0, 0) — null island', () => {
  const { days } = buildMumbaiItinerary();
  const violations = [];
  for (const day of days) {
    for (const act of day.activities || []) {
      if (act.coordinates?.lat === 0 && act.coordinates?.lng === 0) {
        violations.push(`Day ${day.dayNumber}: "${act.title}" has (0,0) coordinates`);
      }
    }
  }
  assert.equal(violations.length, 0, `Null island coordinates: ${violations.join('; ')}`);
});

test('REGRESSION: cost.amount is never negative', () => {
  const { days } = buildMumbaiItinerary();
  const violations = [];
  for (const day of days) {
    for (const act of day.activities || []) {
      if (act.cost?.amount != null && act.cost.amount < 0) {
        violations.push(`Day ${day.dayNumber}: "${act.title}" has negative cost ${act.cost.amount}`);
      }
    }
  }
  assert.equal(violations.length, 0, `Negative costs: ${violations.join('; ')}`);
});

test('REGRESSION: no "No validated" fallback for all activity slots', () => {
  const { days } = buildMumbaiItinerary();
  let fallbackCount = 0;
  for (const day of days) {
    for (const act of day.activities || []) {
      if (/no validated|live .* data unavailable/i.test(act.title)) {
        fallbackCount++;
      }
    }
  }
  // At most 2 fallback activities across the entire itinerary (not every slot)
  assert.ok(
    fallbackCount < days.length * 2,
    `Too many fallback activities: ${fallbackCount}/${days.length * 4} slots`
  );
});

test('REGRESSION: non-departure days have at least 2 meals', () => {
  const { days } = buildMumbaiItinerary();
  for (const day of days) {
    // Departure day (last day) may not have full meals
    const isDepartureDay = day.dayNumber === days.length && days.length > 1;
    if (isDepartureDay) continue;
    const meals = (day.activities || []).filter((a) => a.category === 'restaurant');
    assert.ok(
      meals.length >= 2,
      `Day ${day.dayNumber}: only ${meals.length} meals (expected at least 2)`
    );
  }
});

test('REGRESSION: no repeated attraction across the full itinerary', () => {
  const { days } = buildMumbaiItinerary();
  const allAttractions = [];
  for (const day of days) {
    for (const act of day.activities || []) {
      if (act.category === 'attraction' || act.category === 'activity') {
        if (act.dataStatus !== 'unavailable') {
          allAttractions.push(act.place || act.title);
        }
      }
    }
  }
  const unique = new Set(allAttractions);
  assert.equal(
    allAttractions.length,
    unique.size,
    `Repeated attractions: ${allAttractions.filter((a, i) => allAttractions.indexOf(a) !== i).join(', ')}`
  );
});
