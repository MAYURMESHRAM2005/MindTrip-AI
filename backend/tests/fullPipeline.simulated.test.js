import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

/**
 * FULL-PIPELINE SIMULATION (no real API keys required)
 *
 * Boots the real Express app + MongoDB (memory server) and runs the complete
 * trip-generation workflow end-to-end. Every Google Maps Platform call
 * (Geocoding, Places API, Routes API) is answered by a LOCAL server that
 * returns realistic RAW Google JSON for Mumbai — including decoy places in
 * Hyderabad/Brazil — so the real provider normalizers, destination lock,
 * candidate-quality gates, restaurant pipeline, uniqueness engine,
 * deterministic day builder, budget engine and final validator are all
 * exercised exactly as they will be against the live APIs.
 *
 * All real-network providers (Gemini, Groq, OpenWeather, Amadeus, train/bus,
 * AviationStack, Zomato, Viator, ...) are blanked before dotenv loads, so the
 * test is hermetic and fast. It degrades exactly like an unconfigured key.
 */

// ── 1. Hermetic environment (must run BEFORE any module imports dotenv) ──
const BLANK = [
  'GEMINI_API_KEY', 'GROQ_API_KEY', 'OPENWEATHER_API_KEY', 'IGNAV_API_KEY',
  'AMADEUS_CLIENT_ID', 'AMADEUS_CLIENT_SECRET', 'TRAIN_API_KEY', 'BUS_API_KEY',
  'AVIATIONSTACK_API_KEY', 'PAY2ALL_API_KEY', 'ZOMATO_RAPIDAPI_KEY',
  'ZOMATO_RAPIDAPI_HOST', 'VIATOR_API_KEY', 'VIATOR_AFFILIATE_ID',
  'UNSPLASH_ACCESS_KEY', 'FIREBASE_PROJECT_ID', 'FIREBASE_SERVICE_ACCOUNT',
];
for (const k of BLANK) process.env[k] = '';
process.env.GOOGLE_MAPS_API_KEY = 'simulated-google-server-key';
process.env.NODE_ENV = 'test';

// ── 2. Simulated Google dataset (all coordinates are real Mumbai spots) ──
const CITIES = {
  Mumbai: { lat: 19.076, lng: 72.8777 },
  Pune: { lat: 18.5204, lng: 73.8567 },
};

// [name, category, lat, lng, rating, userRatingCount, priceLevel, address]
// category: 'attraction' | 'restaurant'
const DATA = [
  // ── Real Mumbai attractions ────────────────────────────────────────────
  ['Gateway of India', 'attraction', 18.922, 72.8347, 4.6, 182341, null, 'Apollo Bandar, Colaba, Mumbai, Maharashtra 400001, India'],
  ['Marine Drive', 'attraction', 18.9439, 72.8233, 4.7, 120918, null, 'Marine Drive, Mumbai, Maharashtra 400002, India'],
  ['Chhatrapati Shivaji Maharaj Terminus', 'attraction', 18.9398, 72.8355, 4.7, 38421, null, 'Fort, Mumbai, Maharashtra 400001, India'],
  ['Haji Ali Dargah', 'attraction', 18.9825, 72.8096, 4.6, 45210, null, 'Haji Ali, Mumbai, Maharashtra 400026, India'],
  ['Siddhivinayak Temple', 'attraction', 19.0168, 72.8302, 4.8, 96754, null, 'Prabhadevi, Mumbai, Maharashtra 400028, India'],
  ['Juhu Beach', 'attraction', 19.0886, 72.8265, 4.4, 61320, null, 'Juhu, Mumbai, Maharashtra 400049, India'],
  ['Colaba Causeway', 'attraction', 18.9188, 72.829, 4.3, 19852, null, 'Colaba, Mumbai, Maharashtra 400005, India'],
  ['Bandra-Worli Sea Link', 'attraction', 19.0453, 72.8116, 4.6, 28450, null, 'Worli, Mumbai, Maharashtra 400030, India'],
  ['Kanheri Caves', 'attraction', 19.2085, 72.9092, 4.5, 14230, null, 'Borivali East, Mumbai, Maharashtra 400066, India'],
  ['Global Vipassana Pagoda', 'attraction', 19.2239, 72.8058, 4.6, 11876, null, 'Gorai, Mumbai, Maharashtra 400091, India'],
  ['Sanjay Gandhi National Park', 'attraction', 19.2147, 72.9106, 4.6, 32118, null, 'Borivali, Mumbai, Maharashtra 400101, India'],
  ['Nehru Science Centre', 'attraction', 19.0056, 72.8156, 4.4, 9670, null, 'Worli, Mumbai, Maharashtra 400018, India'],
  ['Mahalaxmi Dhobi Ghat', 'attraction', 18.9849, 72.8432, 4.2, 7430, null, 'Mahalaxmi, Mumbai, Maharashtra 400011, India'],
  ['Mani Bhavan Gandhi Sangrahalaya', 'attraction', 18.9631, 72.8094, 4.6, 6234, null, 'Gamdevi, Mumbai, Maharashtra 400007, India'],
  ['Jehangir Art Gallery', 'attraction', 18.9255, 72.8316, 4.5, 8765, null, 'Kala Ghoda, Mumbai, Maharashtra 400001, India'],
  // North Mumbai restaurants so northern-area days (Kanheri/SGNP) have meals
  ['Cafe Coffee Day', 'restaurant', 19.2333, 72.8486, 4.1, 5210, 1, 'Borivali West, Mumbai, Maharashtra 400092, India'],
  ['Shiv Sagar', 'restaurant', 19.1696, 72.8498, 4.2, 3310, 1, 'Kandivali West, Mumbai, Maharashtra 400067, India'],
  ['Moti Mahal', 'restaurant', 19.2107, 72.8648, 4.3, 4120, 2, 'Borivali East, Mumbai, Maharashtra 400066, India'],
  // ── Far-away decoys: must be rejected by the destination lock ──────────
  ['Charminar', 'attraction', 17.385, 78.4867, 4.7, 88970, null, 'Charminar, Hyderabad, Telangana 500002, India'],
  ['Christ the Redeemer', 'attraction', -22.9519, -43.2105, 4.8, 112340, null, 'Rio de Janeiro, Brazil'],
  ['Golconda Fort', 'attraction', 17.3833, 78.4011, 4.6, 45210, null, 'Hyderabad, Telangana 500008, India'],

  // ── Real Mumbai restaurants ────────────────────────────────────────────
  ['Trishna', 'restaurant', 18.9251, 72.8312, 4.4, 8410, 3, 'Sai Baba Marg, Kala Ghoda, Mumbai, Maharashtra 400001, India'],
  ['Britannia & Co.', 'restaurant', 18.9273, 72.8328, 4.5, 12110, 2, 'Wakefield House, Ballard Estate, Mumbai, Maharashtra 400001, India'],
  ['Leopold Cafe', 'restaurant', 18.9208, 72.8287, 4.3, 33215, 2, 'Shahid Bhagat Singh Road, Colaba, Mumbai, Maharashtra 400005, India'],
  ['Bademiya', 'restaurant', 18.9187, 72.8274, 4.2, 21734, 1, 'Tulloch Road, Colaba, Mumbai, Maharashtra 400005, India'],
  ['Cafe Mondegar', 'restaurant', 18.921, 72.8285, 4.4, 19842, 2, 'Metro House, Colaba, Mumbai, Maharashtra 400005, India'],
  ['The Table', 'restaurant', 18.9259, 72.8319, 4.5, 9870, 3, 'Kalaghoda, Mumbai, Maharashtra 400001, India'],
  ['Indigo Delicatessen', 'restaurant', 18.9254, 72.8308, 4.4, 7230, 3, 'Pherozeshah Mehta Road, Fort, Mumbai, Maharashtra 400001, India'],
  ['Gajalee', 'restaurant', 19.1138, 72.869, 4.3, 14210, 3, 'Veera Desai Road, Andheri West, Mumbai, Maharashtra 400053, India'],
  ['Mahesh Lunch Home', 'restaurant', 18.9256, 72.831, 4.4, 16220, 3, '8C Bank Street, Fort, Mumbai, Maharashtra 400023, India'],
  ['Swati Snacks', 'restaurant', 18.9727, 72.8266, 4.5, 25330, 2, 'Tardeo, Mumbai, Maharashtra 400034, India'],
  ['Ram Ashraya', 'restaurant', 19.0673, 72.8777, 4.3, 6987, 1, 'Dadar East, Mumbai, Maharashtra 400014, India'],
  ['Sardar Pav Bhaji', 'restaurant', 18.9687, 72.8306, 4.4, 20190, 1, 'Tardeo, Mumbai, Maharashtra 400007, India'],
  ['B. Merwan & Co.', 'restaurant', 18.9441, 72.8324, 4.5, 9320, 1, 'Grant Road East, Mumbai, Maharashtra 400007, India'],
  ['Ideal Corner', 'restaurant', 19.0451, 72.8589, 4.3, 4420, 1, 'King\'s Circle, Matunga, Mumbai, Maharashtra 400019, India'],
  ['Kala Ghoda Cafe', 'restaurant', 18.9265, 72.8322, 4.4, 7640, 2, 'Ropewalk Lane, Kala Ghoda, Mumbai, Maharashtra 400001, India'],
  ['Cafe Noorani', 'restaurant', 18.9209, 72.8286, 4.2, 11520, 1, 'Colaba, Mumbai, Maharashtra 400005, India'],
  // ── Far-away restaurant decoys ─────────────────────────────────────────
  ['Paradise Biryani', 'restaurant', 17.4036, 78.4697, 4.4, 45890, 2, 'Paradise Circle, Secunderabad, Hyderabad, Telangana 500003, India'],
  ['Bawarchi RTC X Roads', 'restaurant', 17.4344, 78.4416, 4.3, 23410, 2, 'RTC X Roads, Hyderabad, Telangana 500020, India'],
];

// ── 3. Local mock Google server ──────────────────────────────────────────
function rawPlace(rec) {
  const [name, category, lat, lng, rating, userRatingCount, priceLevel, address] = rec;
  const id = `ch_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
  const isRestaurant = category === 'restaurant';
  const cityComp = {
    longText: name.includes('Hyderabad') ? 'Hyderabad' : (name === 'Christ the Redeemer' ? 'Rio de Janeiro' : 'Mumbai'),
    shortText: name.includes('Hyderabad') ? 'Hyderabad' : (name === 'Christ the Redeemer' ? 'Rio de Janeiro' : 'Mumbai'),
    types: ['locality'],
  };
  // Restaurants: open daily 08:00-23:00; attractions: daily 09:00-19:00.
  // Trip dates in this test span Thu-Sun, so a single Monday-only period would
  // correctly make every place "closed" (that is the engine doing its job).
  const openHour = isRestaurant ? 8 : 9;
  const closeHour = isRestaurant ? 23 : 19;
  const weekdayDescriptions = [];
  const periods = [];
  for (let d = 0; d < 7; d++) {
    const label = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d];
    weekdayDescriptions.push(`${label}: ${openHour % 12 === 0 ? 12 : openHour % 12}:00 ${openHour < 12 ? 'AM' : 'PM'} – ${closeHour % 12 === 0 ? 12 : closeHour % 12}:00 ${closeHour < 12 ? 'AM' : 'PM'}`);
    periods.push({ open: { day: d, hour: openHour, minute: 0 }, close: { day: d, hour: closeHour, minute: 0 } });
  }
  return {
    id,
    displayName: { text: name },
    formattedAddress: address,
    location: { latitude: lat, longitude: lng },
    rating,
    userRatingCount,
    priceLevel,
    types: isRestaurant
      ? ['restaurant', 'catering.restaurant', 'food', 'point_of_interest', 'establishment']
      : ['tourist_attraction', 'point_of_interest', 'establishment'],
    primaryType: isRestaurant ? 'restaurant' : 'tourist_attraction',
    googleMapsUri: `https://maps.google.com/?cid=${id}`,
    businessStatus: 'OPERATIONAL',
    regularOpeningHours: { weekdayDescriptions, periods },
    addressComponents: [
      { longText: 'Mumbai', shortText: 'Mumbai', types: ['neighborhood'] },
      cityComp,
      { longText: name.includes('Hyderabad') ? 'Telangana' : name === 'Christ the Redeemer' ? 'Rio de Janeiro' : 'Maharashtra', shortText: '', types: ['administrative_area_level_1'] },
      { longText: name.includes('Hyderabad') || name === 'Christ the Redeemer' ? (name === 'Christ the Redeemer' ? 'Brazil' : 'India') : 'India', shortText: name === 'Christ the Redeemer' ? 'BR' : 'IN', types: ['country'] },
    ],
  };
}

const byId = new Map(DATA.map((d) => {
  const raw = rawPlace(d);
  return [raw.id, raw];
}));
const byCategory = {
  attraction: DATA.filter((d) => d[1] === 'attraction').map((d) => rawPlace(d)),
  restaurant: DATA.filter((d) => d[1] === 'restaurant').map((d) => rawPlace(d)),
};

function geocodeResult(query) {
  const q = String(query || '').toLowerCase();
  let city = null;
  for (const [name, c] of Object.entries(CITIES)) {
    if (q.includes(name.toLowerCase())) { city = name; break; }
  }
  if (!city) city = 'Mumbai';
  const c = CITIES[city];
  const isIndia = city !== null;
  return {
    status: 'OK',
    results: [{
      formatted_address: `${city}, ${city === 'Pune' ? 'Maharashtra' : 'Maharashtra'}, India`,
      place_id: `ch_city_${city.toLowerCase()}`,
      geometry: { location: { lat: c.lat, lng: c.lng } },
      address_components: [
        { long_name: city, short_name: city, types: ['locality', 'political'] },
        { long_name: 'Maharashtra', short_name: 'MH', types: ['administrative_area_level_1', 'political'] },
        { long_name: 'India', short_name: 'IN', types: ['country', 'political'] },
      ],
      types: ['locality', 'political'],
    }],
  };
}

function startMockServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const bodyText = chunks.length ? Buffer.concat(chunks).toString('utf8') : '';
      let body = {};
      try { body = bodyText ? JSON.parse(bodyText) : {}; } catch { /* keep {} */ }
      const json = (code, payload) => {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      };
      const path = url.pathname;

      // ── Geocoding / reverse geocoding (legacy REST) ──
      if (path.endsWith('/maps/api/geocode/json')) {
        const q = url.searchParams.get('address') || '';
        if (url.searchParams.get('latlng')) {
          return json(200, { status: 'OK', results: [{ formatted_address: 'Mumbai, Maharashtra, India', place_id: 'ch_city_mumbai', geometry: { location: { lat: CITIES.Mumbai.lat, lng: CITIES.Mumbai.lng } }, address_components: [] }] });
        }
        return json(200, geocodeResult(q));
      }

      // ── Routes API: computeRoutes ──
      if (path.endsWith(':computeRoutes')) {
        const route = {
          distanceMeters: 4200,
          duration: '540s',
          polyline: { encodedPolyline: 'u{rfFp~bVWw@Ce@Da@' },
          legs: [{
            distanceMeters: 4200,
            duration: '540s',
            steps: [{
              distanceMeters: 1200, duration: '180s',
              navigationInstruction: { instructions: 'Head east on main road' },
              polyline: { encodedPolyline: 'u{rfFp~bVWw@' },
            }],
          }],
        };
        return json(200, { routes: [route, { ...route, distanceMeters: 4600, duration: '600s' }] });
      }

      // ── Routes API: computeRouteMatrix ──
      if (path.endsWith(':computeRouteMatrix')) {
        const nOrigins = body.origins?.length || 1;
        const nDests = body.destinations?.length || 1;
        const elements = [];
        for (let oi = 0; oi < nOrigins; oi++) {
          for (let di = 0; di < nDests; di++) {
            elements.push({ originIndex: oi, destinationIndex: di, duration: `${300 + di * 60}s`, distanceMeters: 2500 + di * 400, condition: 'ROUTE_EXISTS' });
          }
        }
        return json(200, elements);
      }

      // ── Places API (New): Text Search ──
      if (path.endsWith(':searchText')) {
        const q = String(body.textQuery || '').toLowerCase();
        let list = byCategory.attraction;
        if (q.includes('restaurant')) list = byCategory.restaurant;
        else if (q.includes('hotel') || q.includes('lodging') || q.includes('stay')) list = [];
        else if (q.includes('event') || q.includes('festival')) list = [];
        return json(200, { places: list.slice(0, body.pageSize || 20) });
      }

      // ── Places API (New): Nearby Search ──
      if (path.endsWith(':searchNearby')) {
        const types = body.includedTypes || [];
        const isNight = types.some((t) => /night_club|bar/i.test(t));
        const center = body.locationRestriction?.circle?.center || {};
        const nearMumbai = Math.abs((center.latitude ?? 0) - CITIES.Mumbai.lat) < 0.5;
        if (isNight && nearMumbai) {
          return json(200, { places: [] }); // nightlife intentionally empty → graceful degrade
        }
        return json(200, { places: [] });
      }

      // ── Places API (New): Place Details ──
      const detailsMatch = path.match(/^\/v1\/places\/([^/]+)$/);
      if (detailsMatch) {
        const rec = byId.get(decodeURIComponent(detailsMatch[1]));
        if (!rec) return json(404, { error: { code: 404, status: 'NOT_FOUND', message: 'Place not found' } });
        return json(200, rec);
      }

      // ── Places API (New): Autocomplete ──
      if (path.endsWith(':autocomplete')) {
        return json(200, {
          suggestions: [{ placePrediction: { text: { text: 'Mumbai, Maharashtra, India' }, placeId: 'ch_city_mumbai' } }],
        });
      }

      // Anything else → empty, so providers degrade gracefully.
      json(200, {});
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const base = `http://127.0.0.1:${server.address().port}`;
      resolve({ base, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

let memoryServerAvailable = true;
try { await import('mongodb-memory-server'); } catch { memoryServerAvailable = false; }
const skipReason = memoryServerAvailable ? false : 'mongodb-memory-server not installed';

test('simulated full pipeline: real Google data → normalized → destination-locked → unique day-wise itinerary', { skip: skipReason, timeout: 120000 }, async () => {
  const phase = (msg) => console.log(`[sim:phase] ${msg}`);
  const mock = await startMockServer();
  phase('mock server up');

  // Re-point the Google providers at the local simulated server. Providers
  // read these URLs at call time, so overriding the properties works even
  // though the config module was already imported.
  const { GOOGLE_URLS } = await import('../src/config/googleMaps.js');
  GOOGLE_URLS.geocode = `${mock.base}/maps/api/geocode/json`;
  GOOGLE_URLS.reverseGeocode = `${mock.base}/maps/api/geocode/json`;
  GOOGLE_URLS.placesTextSearch = `${mock.base}/v1/places:searchText`;
  GOOGLE_URLS.placesNearbySearch = `${mock.base}/v1/places:searchNearby`;
  GOOGLE_URLS.placesAutocomplete = `${mock.base}/v1/places:autocomplete`;
  GOOGLE_URLS.placesDetails = (placeId) => `${mock.base}/v1/places/${encodeURIComponent(placeId)}`;
  GOOGLE_URLS.computeRoutes = `${mock.base}/directions/v2:computeRoutes`;
  GOOGLE_URLS.computeRouteMatrix = `${mock.base}/distanceMatrix/v2:computeRouteMatrix`;

  let mongod;
  try {
    const memoryServer = await import('mongodb-memory-server');
    const { MongoMemoryServer } = memoryServer;
    try {
      phase('starting mongodb-memory-server');
      mongod = await MongoMemoryServer.create({ binary: { version: '7.0.14' } });
      phase('mongod up');
    } catch (err) {
      console.warn(`[SKIP] mongod binary unavailable: ${err.message}`);
      return;
    }
    const mongoose = (await import('mongoose')).default;
    await mongoose.connect(mongod.getUri('travelmind_simulated_test'));
    phase('mongoose connected');

    const { default: app } = await import('../src/app.js');
    phase('app imported');
    const request = (await import('supertest')).default;
    const agent = request.agent(app);

    // Register a fresh user
    const email = `sim${Date.now()}@travelmind.app`;
    const reg = await agent.post('/api/auth/register').send({
      name: 'Sim Test User', email, password: 'StrongPass1',
    });
    assert.equal(reg.status, 201, `register failed: ${JSON.stringify(reg.body).slice(0, 300)}`);

    phase('registering user');
    // Generate a 4-day Mumbai trip from Pune
    const started = Date.now();
    phase('POST /api/trips/generate → Mumbai from Pune');
    const tripRes = await agent.post('/api/trips/generate').send({
      origin: 'Pune',
      destination: 'Mumbai',
      startDate: '2026-04-02',
      endDate: '2026-04-05',
      adults: 2,
      children: 0,
      totalBudget: 80000,
      currency: 'INR',
      travelStyle: 'standard',
      foodPreference: 'non-vegetarian',
      activityLevel: 'moderate',
    });
    const elapsed = Date.now() - started;
    console.log(`\n[sim] trip generation completed in ${elapsed}ms (status ${tripRes.status})\n`);

    assert.equal(tripRes.status, 201, `Expected 201, got ${tripRes.status}: ${JSON.stringify(tripRes.body).slice(0, 800)}`);
    const data = tripRes.body.data || {};
    assert.ok(data.trip, 'response must contain trip');
    assert.ok(data.itinerary, 'response must contain itinerary');

    const trip = data.trip;
    const itinerary = data.itinerary;
    assert.equal(trip.destination, 'Mumbai');
    assert.equal(itinerary.currency, 'INR');

    // ── Structure: days & activities ─────────────────────────────────────
    const days = itinerary.days;
    assert.ok(Array.isArray(days), 'itinerary.days must be an array');
    assert.ok(days.length >= 3 && days.length <= 4, `expected 3-4 days, got ${days.length}`);
    console.log(`[sim] days: ${days.length} | totalEstimatedCost: ${itinerary.totalEstimatedCost} | validation: ${JSON.stringify(itinerary.validation || {}).slice(0, 200)}`);

    // Flatten every activity with its day for cross-day checks
    const flat = [];
    for (const day of days) {
      assert.ok(Array.isArray(day.activities), `day ${day.dayNumber} must have activities`);
      for (const act of day.activities) {
        flat.push({ ...act, _day: day.dayNumber, _date: day.date });
      }
    }
    console.log(`[sim] total activities: ${flat.length}\n`);
    for (const day of days) {
      console.log(`[sim] DAY ${day.dayNumber} (${day.date}) area=${day.area} cost=${day.dayCost}`);
      for (const a of day.activities) {
        console.log(`   ${a.time} [${a.category}] ${a.title} | cost=${a.cost?.amount}${a.cost?.isEstimate ? ' (est)' : ''} status=${a.dataStatus || a.cost?.dataStatus || '?'} providerId=${a.providerId || '?'}`);
      }
    }
    console.log('\n');

    const titles = flat.map((a) => a.title);
    const titlesText = titles.join(' | ').toLowerCase();

    // ── Geo validation: zero decoy places may appear in the itinerary ────
    for (const decoy of ['charminar', 'hyderabad', 'christ the redeemer', 'rio de janeiro', 'brazil', 'golconda', 'paradise biryani', 'bawarchi']) {
      assert.ok(!titlesText.includes(decoy), `decoy "${decoy}" leaked into the Mumbai itinerary: ${titlesText}`);
    }

    // ── Live real places must be present (from the simulated Google feed) ─
    const realAttractionNames = new Set(DATA.filter((d) => d[1] === 'attraction').map((d) => d[0].toLowerCase()));
    const realRestaurantNames = new Set(DATA.filter((d) => d[1] === 'restaurant').map((d) => d[0].toLowerCase()));

    // Attractions are titled exactly by their real name.
    const attractionUses = titles.filter((t) => realAttractionNames.has(t.toLowerCase()));
    // Meals are titled "Breakfast/Lunch/Dinner at <real restaurant>" — never
    // "Breakfast at <invented name>" and never a bare "Breakfast" placeholder
    // when a live restaurant exists.
    const mealMatch = /^(?:breakfast|lunch|dinner)\s+at\s+(.+)$/i;
    const restaurantUses = [];
    for (const t of titles) {
      const mm = mealMatch.exec(t);
      if (mm && realRestaurantNames.has(mm[1].trim().toLowerCase())) restaurantUses.push(mm[1].trim());
    }
    const inventedMeals = titles.filter((t) => mealMatch.test(t) && !restaurantUses.includes(mealMatch.exec(t)[1].trim()));
    console.log(`[sim] live attraction uses: ${attractionUses.length} | live restaurant meals: ${restaurantUses.length}`);
    assert.ok(attractionUses.length >= 3, `expected ≥3 real attractions in the itinerary, got ${attractionUses.length}: ${titlesText}`);
    assert.ok(restaurantUses.length >= 6, `expected ≥6 real restaurants across meal slots, got ${restaurantUses.length}: ${titlesText}`);
    assert.deepEqual(inventedMeals, [], `meal slots must never be "<meal> at <invented name>": ${inventedMeals.join(' | ')}`);

    // ── Day-wise uniqueness: no attraction/restaurant reused across days ──
    const byName = (names) => {
      const counts = {};
      for (const n of names) { const k = n.toLowerCase(); counts[k] = (counts[k] || 0) + 1; }
      return counts;
    };
    const attrCounts = byName(attractionUses);
    const restCounts = byName(restaurantUses);
    const dupAttrs = Object.entries(attrCounts).filter(([, c]) => c > 1);
    const dupRests = Object.entries(restCounts).filter(([, c]) => c > 1);
    assert.deepEqual(dupAttrs, [], `attraction reused across days: ${JSON.stringify(dupAttrs)}`);
    assert.deepEqual(dupRests, [], `restaurant reused across days: ${JSON.stringify(dupRests)}`);

    // No bare meal placeholder may appear when the meal engine found nothing:
    // such slots must be the explicit "— live restaurant data unavailable"
    // form so the UI can show "Price unavailable" honestly.
    for (const a of flat) {
      if (a.category === 'restaurant' && !mealMatch.test(a.title)) {
        assert.ok(
          /live restaurant data unavailable/.test(a.title),
          `meal slot "${a.title}" must either name a real restaurant or explicitly say data is unavailable`
        );
      }
    }

    // ── Cost / data-status invariants ────────────────────────────────────
    const allowedStatuses = new Set(['live', 'estimate', 'estimated', 'unavailable']);
    for (const a of flat) {
      assert.ok(a.cost && typeof a.cost.amount === 'number' && a.cost.amount >= 0, `activity "${a.title}" must have numeric cost.amount ≥ 0`);
      assert.ok(typeof a.cost.isEstimate === 'boolean', `activity "${a.title}" must have boolean isEstimate`);
      const st = a.dataStatus || a.cost.dataStatus || '';
      assert.ok(allowedStatuses.has(st), `activity "${a.title}" has invalid dataStatus "${st}"`);
      // A "live" PRICE must not be 0 and un-estimated: ₹0 with no estimate
      // flag would masquerade an unknown price as free. (A live place whose
      // price is unavailable is represented by cost.dataStatus
      // 'unavailable' — that is honest "Price unavailable", not free.)
      if (a.cost.dataStatus === 'live') {
        assert.ok(a.cost.amount > 0 || a.cost.isEstimate, `live-priced activity "${a.title}" must not show amount 0 without an estimate flag`);
      }
    }

    // Report contains destination-lock rejections for the decoys
    const reportText = JSON.stringify(data.report || data.agentReports || []).toLowerCase();
    console.log(`[sim] report mentions destination-lock rejections: ${reportText.includes('rejected')}`);

    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  } finally {
    await mock.close();
  }
});
