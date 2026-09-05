import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

/**
 * Google Maps Platform provider tests.
 *
 * All Google APIs are MOCKED with a local HTTP server — no live network
 * calls and no real keys. Providers read their endpoint URLs from the
 * exported GOOGLE_URLS object, so each test points the URLs it exercises at
 * the local server and asserts the normalized envelopes.
 */

process.env.GOOGLE_MAPS_API_KEY = 'test-server-key';

async function startMock(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const GEOCODE_RESPONSE = {
  status: 'OK',
  results: [
    {
      formatted_address: 'Mumbai, Maharashtra, India',
      place_id: 'ChIJMumbai',
      geometry: { location: { lat: 19.076, lng: 72.8777 } },
      address_components: [
        { long_name: 'Mumbai', short_name: 'Mumbai', types: ['locality'] },
        { long_name: 'Maharashtra', short_name: 'MH', types: ['administrative_area_level_1'] },
        { long_name: 'India', short_name: 'IN', types: ['country'] },
      ],
      types: ['locality', 'political'],
    },
  ],
};

const TEXT_RESPONSE = {
  places: [
    {
      id: 'ChIJGateway',
      displayName: { text: 'Gateway of India' },
      formattedAddress: 'Apollo Bandar, Colaba, Mumbai, Maharashtra, India',
      location: { latitude: 18.9219841, longitude: 72.8346543 },
      rating: 4.6,
      userRatingCount: 1200,
      priceLevel: 2,
      types: ['tourist_attraction', 'point_of_interest', 'establishment'],
      primaryType: 'tourist_attraction',
      googleMapsUri: 'https://maps.google.com/?cid=gateway',
      businessStatus: 'OPERATIONAL',
      regularOpeningHours: {
        weekdayDescriptions: ['Monday: 9:00 AM – 6:00 PM'],
        periods: [
          { open: { day: 1, hour: 9, minute: 0 }, close: { day: 1, hour: 18, minute: 0 } },
        ],
      },
      photos: [{ name: 'places/ChIJGateway/photos/AUc123' }],
      addressComponents: [
        { longText: 'Apollo Bandar', types: ['neighborhood'] },
        { longText: 'Mumbai', types: ['locality'] },
        { longText: 'India', types: ['country'] },
      ],
    },
    {
      id: 'ChIJMarine',
      displayName: { text: 'Marine Drive' },
      formattedAddress: 'Marine Drive, Mumbai, Maharashtra, India',
      location: { latitude: 18.9439, longitude: 72.8232 },
      types: ['tourist_attraction', 'point_of_interest'],
      primaryType: 'tourist_attraction',
      googleMapsUri: 'https://maps.google.com/?cid=marine',
    },
  ],
};

const ROUTES_RESPONSE = {
  routes: [
    {
      duration: '600s',
      distanceMeters: 2000,
      polyline: { encodedPolyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@' },
      legs: [
        {
          duration: '600s',
          distanceMeters: 2000,
          steps: [
            {
              navigationInstruction: { instructions: 'Head south on A Road' },
              distanceMeters: 100,
              // Routes API v2 steps expose staticDuration (not duration).
              staticDuration: '15s',
              polyline: { encodedPolyline: '_p~iF~ps|U' },
            },
          ],
        },
      ],
    },
  ],
};

const MATRIX_RESPONSE = [
  { originIndex: 0, destinationIndex: 0, distanceMeters: 2500, duration: '480s', condition: 'ROUTE_EXISTS' },
  { originIndex: 0, destinationIndex: 1, distanceMeters: 5000, duration: '900s', condition: 'ROUTE_EXISTS' },
];

const AUTOCOMPLETE_RESPONSE = {
  suggestions: [
    {
      placePrediction: {
        placeId: 'ChIJMumbaiAC',
        text: { text: 'Mumbai, Maharashtra, India' },
        structuredFormat: {
          mainText: { text: 'Mumbai' },
          secondaryText: { text: 'Maharashtra, India' },
        },
      },
    },
  ],
};

test('googleGeocoding.geocode normalizes Geocoding API responses', async () => {
  const mock = await startMock((req, res) => {
    if (req.url.includes('geocode')) return json(res, 200, GEOCODE_RESPONSE);
    json(res, 200, { status: 'ZERO_RESULTS', results: [] });
  });
  try {
    const { GOOGLE_URLS } = await import('../src/config/googleMaps.js');
    GOOGLE_URLS.geocode = `${mock.base}/geocode`;
    const { geocode } = await import('../src/providers/googleGeocoding.provider.js');
    const result = await geocode('Mumbai, India');

    assert.equal(result.isLive, true);
    assert.equal(result.source, 'google-geocoding');
    assert.equal(result.data.lat, 19.076);
    assert.equal(result.data.lng, 72.8777);
    assert.equal(result.data.placeId, 'ChIJMumbai');
    assert.equal(result.data.address, 'Mumbai, Maharashtra, India');
    assert.equal(result.data.city, 'Mumbai');
    assert.equal(result.data.state, 'Maharashtra');
    assert.equal(result.data.country, 'India');
  } finally {
    await mock.close();
  }
});

test('googleGeocoding.geocode returns unavailable when no results exist', async () => {
  const mock = await startMock((req, res) => json(res, 200, { status: 'ZERO_RESULTS', results: [] }));
  try {
    const { GOOGLE_URLS } = await import('../src/config/googleMaps.js');
    GOOGLE_URLS.geocode = `${mock.base}/geocode`;
    const { geocode } = await import('../src/providers/googleGeocoding.provider.js');
    const result = await geocode('Atlantis City');
    assert.equal(result.isLive, false);
    assert.equal(result.data, null);
    assert.match(result.message, /no results/i);
  } finally {
    await mock.close();
  }
});

test('googleGeocoding.geocode surfaces REQUEST_DENIED as permission denied (not "no results")', async () => {
  const mock = await startMock((req, res) =>
    json(res, 200, { status: 'REQUEST_DENIED', results: [], error_message: 'You must enable Billing on the Google Cloud Project' })
  );
  try {
    const { GOOGLE_URLS } = await import('../src/config/googleMaps.js');
    GOOGLE_URLS.geocode = `${mock.base}/denied`;
    const { geocode } = await import('../src/providers/googleGeocoding.provider.js');
    const result = await geocode('Goa');
    assert.equal(result.isLive, false);
    assert.equal(result.data, null);
    assert.match(result.message, /permission denied|billing|denied/i);
    // The real cause must not be hidden behind a misleading "no results".
    assert.doesNotMatch(result.message, /no results for/i);
  } finally {
    await mock.close();
  }
});

test('googleGeocoding.autocomplete maps place predictions to suggestions', async () => {
  const mock = await startMock((req, res) => json(res, 200, AUTOCOMPLETE_RESPONSE));
  try {
    const { GOOGLE_URLS } = await import('../src/config/googleMaps.js');
    GOOGLE_URLS.placesAutocomplete = `${mock.base}/autocomplete`;
    const { autocomplete } = await import('../src/providers/googleGeocoding.provider.js');
    const result = await autocomplete('Mum');
    assert.equal(result.isLive, true);
    assert.equal(result.data[0].placeId, 'ChIJMumbaiAC');
    assert.equal(result.data[0].name, 'Mumbai');
    assert.equal(result.data[0].formatted, 'Mumbai, Maharashtra, India');
  } finally {
    await mock.close();
  }
});

test('googleGeocoding.geocode serves identical addresses from cache (one Google call)', async () => {
  let calls = 0;
  const mock = await startMock((req, res) => {
    calls++;
    json(res, 200, GEOCODE_RESPONSE);
  });
  try {
    const { GOOGLE_URLS } = await import('../src/config/googleMaps.js');
    GOOGLE_URLS.geocode = `${mock.base}/geocode`;
    const provider = await import('../src/providers/googleGeocoding.provider.js');
    provider.purgeExpiredGeocodeCache();

    // Unique address — other tests in this file also geocode "Mumbai, India",
    // and the module-level cache is shared, so a unique key proves the cache.
    const first = await provider.geocode('Lucknow, Uttar Pradesh');
    const second = await provider.geocode('  lucknow, uttar pradesh  ');
    assert.equal(first.isLive, true);
    assert.equal(second.isLive, true);
    assert.equal(second.data.lat, 19.076);
    assert.equal(calls, 1, 'identical geocodes must not hit Google twice');
    assert.ok(provider.getGeocodeCacheSize() >= 1);
    provider.purgeExpiredGeocodeCache();
  } finally {
    await mock.close();
  }
});

test('googleGeocoding.reverseGeocode caches identical coordinates', async () => {
  let calls = 0;
  const mock = await startMock((req, res) => {
    calls++;
    json(res, 200, GEOCODE_RESPONSE);
  });
  try {
    const { GOOGLE_URLS } = await import('../src/config/googleMaps.js');
    GOOGLE_URLS.reverseGeocode = `${mock.base}/reverse`;
    const provider = await import('../src/providers/googleGeocoding.provider.js');
    provider.purgeExpiredGeocodeCache();

    const first = await provider.reverseGeocode(26.8467, 80.9462);
    const second = await provider.reverseGeocode(26.8467, 80.9462);
    assert.equal(first.isLive, true);
    assert.equal(second.isLive, true);
    assert.equal(calls, 1, 'identical reverse geocodes must hit Google once');
    provider.purgeExpiredGeocodeCache();
  } finally {
    await mock.close();
  }
});

test('googlePlaces.textSearch serves identical queries from cache', async () => {
  let calls = 0;
  const mock = await startMock((req, res) => {
    calls++;
    json(res, 200, TEXT_RESPONSE);
  });
  try {
    const { GOOGLE_URLS } = await import('../src/config/googleMaps.js');
    GOOGLE_URLS.placesTextSearch = `${mock.base}/text`;
    const provider = await import('../src/providers/googlePlaces.provider.js');
    provider.purgeExpiredSearchCache();

    const first = await provider.textSearch({ query: 'Enchanted Fort Bhangarh sights', type: 'tourist_attraction', limit: 5 });
    const second = await provider.textSearch({ query: 'enchanted fort bhangarh sights', type: 'tourist_attraction', limit: 5 });
    assert.equal(first.isLive, true);
    assert.equal(second.isLive, true);
    assert.equal(second.data.length, 2);
    assert.equal(calls, 1, 'identical text searches must not hit Google twice');
    provider.purgeExpiredSearchCache();
  } finally {
    await mock.close();
  }
});

test('googlePlaces.nearbySearch serves identical area searches from cache', async () => {
  let calls = 0;
  const mock = await startMock((req, res) => {
    calls++;
    json(res, 200, {
      places: [
        { id: 'ChIJNearby', displayName: { text: 'A Hospital' }, formattedAddress: 'Goa', location: { latitude: 15.5, longitude: 73.75 }, types: ['hospital'], primaryType: 'hospital' },
      ],
    });
  });
  try {
    const { GOOGLE_URLS } = await import('../src/config/googleMaps.js');
    GOOGLE_URLS.placesNearbySearch = `${mock.base}/nearby`;
    const provider = await import('../src/providers/googlePlaces.provider.js');
    provider.purgeExpiredSearchCache();

    const first = await provider.nearbySearch({ lat: 17.385, lng: 78.4867, type: 'hospital', radius: 3000, limit: 8 });
    const second = await provider.nearbySearch({ lat: 17.385, lng: 78.4867, type: 'hospital', radius: 3000, limit: 8 });
    assert.equal(first.isLive, true);
    assert.equal(second.isLive, true);
    assert.equal(calls, 1, 'identical nearby searches must not hit Google twice');
    provider.purgeExpiredSearchCache();
  } finally {
    await mock.close();
  }
});

test('googleRoutes.directions serves the same pair from cache across callers', async () => {
  let calls = 0;
  const mock = await startMock((req, res) => {
    calls++;
    json(res, 200, ROUTES_RESPONSE);
  });
  try {
    const { GOOGLE_URLS } = await import('../src/config/googleMaps.js');
    GOOGLE_URLS.computeRoutes = `${mock.base}/routes`;
    const routesProvider = await import('../src/providers/googleRoutes.provider.js');
    routesProvider.purgeExpiredRoutesCache();

    // Same pair passed as lat,lng strings AND as an address — the address
    // resolves through the (cached) geocoder to the same coordinates and the
    // route cache dedupes to a single Routes call.
    const first = await routesProvider.directions('19.1,72.9', '19.2,72.95', 'driving', false);
    const second = await routesProvider.directions('19.1,72.9', '19.2,72.95', 'driving', false);
    assert.equal(first.isLive, true);
    assert.equal(second.isLive, true);
    assert.equal(second.data.routes[0].distanceMeters, 2000);
    assert.equal(calls, 1, 'identical route pairs must not hit Routes API twice');
    routesProvider.purgeExpiredRoutesCache();
  } finally {
    await mock.close();
  }
});

test('googleRoutes.distanceMatrix dedupes identical origin/destination sets', async () => {
  let calls = 0;
  const mock = await startMock((req, res) => {
    calls++;
    json(res, 200, MATRIX_RESPONSE);
  });
  try {
    const { GOOGLE_URLS } = await import('../src/config/googleMaps.js');
    GOOGLE_URLS.computeRouteMatrix = `${mock.base}/matrix`;
    const routesProvider = await import('../src/providers/googleRoutes.provider.js');
    routesProvider.purgeExpiredRoutesCache();

    await routesProvider.distanceMatrix(['19.1,72.9'], ['19.2,72.95', '19.3,73.0'], 'driving');
    const second = await routesProvider.distanceMatrix(['19.1,72.9'], ['19.2,72.95', '19.3,73.0'], 'driving');
    assert.equal(second.isLive, true);
    assert.equal(second.data.rows[0][0].status, 'OK');
    assert.equal(calls, 1, 'identical matrices must not hit Routes API twice');
    routesProvider.purgeExpiredRoutesCache();
  } finally {
    await mock.close();
  }
});

test('googleGeocoding.autocomplete serves identical queries from cache (one Google call)', async () => {
  let autocompleteCalls = 0;
  const mock = await startMock((req, res) => {
    autocompleteCalls++;
    json(res, 200, AUTOCOMPLETE_RESPONSE);
  });
  try {
    const { GOOGLE_URLS } = await import('../src/config/googleMaps.js');
    GOOGLE_URLS.placesAutocomplete = `${mock.base}/autocomplete`;
    const provider = await import('../src/providers/googleGeocoding.provider.js');

    provider.purgeExpiredAutocompleteCache();
    // Same query, different casing and whitespace → one Google call total.
    const first = await provider.autocomplete('Mumbai');
    const second = await provider.autocomplete('  mumbai  ', { limit: 6 });
    assert.equal(first.isLive, true);
    assert.equal(second.isLive, true);
    assert.equal(second.data[0].placeId, 'ChIJMumbaiAC');
    assert.equal(autocompleteCalls, 1, 'identical queries must not hit Google twice');
    assert.ok(provider.getAutocompleteCacheSize() >= 1);

    // A different query is a separate cache entry → goes to Google.
    const third = await provider.autocomplete('Pune');
    assert.equal(third.isLive, true);
    assert.equal(autocompleteCalls, 2);
    provider.purgeExpiredAutocompleteCache();
  } finally {
    await mock.close();
  }
});

test('googleGeocoding.autocomplete does not cache provider failures', async () => {
  let calls = 0;
  const mock = await startMock((req, res) => {
    calls++;
    json(res, 403, { error: { code: 403, status: 'PERMISSION_DENIED', message: 'The caller does not have permission' } });
  });
  try {
    const { GOOGLE_URLS } = await import('../src/config/googleMaps.js');
    GOOGLE_URLS.placesAutocomplete = `${mock.base}/denied`;
    const provider = await import('../src/providers/googleGeocoding.provider.js');
    provider.purgeExpiredAutocompleteCache();

    const first = await provider.autocomplete('Delhi');
    const second = await provider.autocomplete('Delhi');
    assert.equal(first.isLive, false);
    assert.equal(second.isLive, false);
    // Failures must not be cached/stuck — the app stays free to recover
    // once the quota/permission problem clears.
    assert.equal(calls, 2);
    provider.purgeExpiredAutocompleteCache();
  } finally {
    await mock.close();
  }
});

test('googleGeocoding.autocomplete returns live empty list for a successful no-match query', async () => {
  const mock = await startMock((req, res) => json(res, 200, { suggestions: [] }));
  try {
    const { GOOGLE_URLS } = await import('../src/config/googleMaps.js');
    GOOGLE_URLS.placesAutocomplete = `${mock.base}/empty`;
    const { autocomplete } = await import('../src/providers/googleGeocoding.provider.js');
    const result = await autocomplete('zzzznotaplace');
    assert.equal(result.isLive, true, 'an empty result set is not a provider failure');
    assert.deepEqual(result.data, []);
  } finally {
    await mock.close();
  }
});

test('googlePlaces.textSearch normalizes real places with live provenance', async () => {
  const mock = await startMock((req, res) => json(res, 200, TEXT_RESPONSE));
  try {
    const { GOOGLE_URLS } = await import('../src/config/googleMaps.js');
    GOOGLE_URLS.placesTextSearch = `${mock.base}/text`;
    const provider = await import('../src/providers/googlePlaces.provider.js');
    const result = await provider.textSearch({ query: 'Mumbai top tourist attractions', type: 'tourist_attraction', limit: 5 });

    assert.equal(result.isLive, true);
    assert.equal(result.source, 'google-places');
    assert.equal(result.data.length, 2);

    const first = result.data[0];
    assert.equal(first.placeId, 'ChIJGateway');
    assert.equal(first.name, 'Gateway of India');
    assert.equal(first.dataStatus, 'live');
    assert.equal(first.rating, 4.6);
    assert.equal(first.userRatingCount, 1200);
    assert.equal(first.priceLevel, 2);
    assert.equal(first.coordinates.lat, 18.9219841);
    assert.equal(first.googleMapsUri, 'https://maps.google.com/?cid=gateway');
    // Google types are preserved and legacy tokens keep itinerary filters working.
    assert.ok(first.types.includes('tourist_attraction'));
    assert.ok(first.types.includes('tourism.sights'));
    // Real locality parsed from Google address components.
    assert.equal(first.city, 'Mumbai');
    assert.equal(first.country, 'India');
    // Opening hours + photo reference normalized.
    assert.ok(first.openingHours.periods.length >= 1);
    assert.equal(first.openingHours.raw.includes('Monday'), true);
    assert.equal(first.photoRef, 'places/ChIJGateway/photos/AUc123');
  } finally {
    await mock.close();
  }
});

test('googlePlaces.textSearch degrades gracefully on permission errors', async () => {
  const mock = await startMock((req, res) =>
    json(res, 403, { error: { code: 403, status: 'REQUEST_DENIED', message: 'API key not authorized.' } })
  );
  try {
    const { GOOGLE_URLS } = await import('../src/config/googleMaps.js');
    GOOGLE_URLS.placesTextSearch = `${mock.base}/denied`;
    const provider = await import('../src/providers/googlePlaces.provider.js');
    const result = await provider.textSearch({ query: 'restaurants in Goa', type: 'restaurant', limit: 5 });
    assert.equal(result.isLive, false);
    assert.equal(result.data, null);
    assert.match(result.message, /permission denied/i);
  } finally {
    await mock.close();
  }
});

test('googlePlaces.nearbySearch adds restaurant category tokens', async () => {
  const mock = await startMock((req, res) =>
    json(res, 200, {
      places: [
        { id: 'ChIJRest', displayName: { text: 'Baga Thali House' }, formattedAddress: 'Baga, Goa', location: { latitude: 15.555, longitude: 73.751 }, types: ['restaurant', 'point_of_interest'], primaryType: 'restaurant' },
      ],
    })
  );
  try {
    const { GOOGLE_URLS } = await import('../src/config/googleMaps.js');
    GOOGLE_URLS.placesNearbySearch = `${mock.base}/nearby`;
    const provider = await import('../src/providers/googlePlaces.provider.js');
    const result = await provider.nearbySearch({ lat: 15.555, lng: 73.751, type: 'restaurant', radius: 3000, limit: 5 });
    assert.equal(result.isLive, true);
    assert.equal(result.data[0].name, 'Baga Thali House');
    assert.ok(result.data[0].types.includes('catering.restaurant'));
    assert.equal(result.data[0].provider, 'google');
  } finally {
    await mock.close();
  }
});

test('googlePlaces.placeDetails serves repeated calls from cache', async () => {
  let detailCalls = 0;
  const mock = await startMock((req, res) => {
    detailCalls++;
    json(res, 200, {
      id: 'ChIJGateway',
      displayName: { text: 'Gateway of India' },
      formattedAddress: 'Apollo Bandar, Mumbai, Maharashtra, India',
      location: { latitude: 18.9219841, longitude: 72.8346543 },
      rating: 4.6,
      types: ['tourist_attraction', 'point_of_interest'],
      googleMapsUri: 'https://maps.google.com/?cid=gateway',
      regularOpeningHours: { weekdayDescriptions: ['Monday: 9:00 AM – 6:00 PM'] },
      addressComponents: [{ longText: 'Mumbai', types: ['locality'] }],
    });
  });
  try {
    const { GOOGLE_URLS } = await import('../src/config/googleMaps.js');
    GOOGLE_URLS.placesDetails = (id) => `${mock.base}/details/${id}`;
    const provider = await import('../src/providers/googlePlaces.provider.js');

    const first = await provider.placeDetails('ChIJGateway');
    assert.equal(first.isLive, true);
    assert.equal(first.data.openingHours.raw.includes('Monday'), true);

    const second = await provider.placeDetails('ChIJGateway');
    assert.equal(second.isLive, true);
    assert.equal(detailCalls, 1, 'second details call must be served from the cache');

    const map = await provider.batchPlaceDetails(['ChIJGateway', 'ChIJGateway']);
    assert.equal(map.get('ChIJGateway').name, 'Gateway of India');
    assert.equal(map.size, 1);
    assert.equal(detailCalls, 1, 'batch details must reuse the cache too');
    provider.purgeExpiredDetailsCache();
  } finally {
    await mock.close();
  }
});

test('googleRoutes.directions returns real distance/duration/polyline', async () => {
  const mock = await startMock((req, res) => json(res, 200, ROUTES_RESPONSE));
  try {
    const { GOOGLE_URLS } = await import('../src/config/googleMaps.js');
    GOOGLE_URLS.computeRoutes = `${mock.base}/routes`;
    const routesProvider = await import('../src/providers/googleRoutes.provider.js');
    const result = await routesProvider.directions('18.9,72.8', '18.94,72.83', 'driving', false);

    assert.equal(result.isLive, true);
    assert.equal(result.source, 'google-routes');
    const route = result.data.routes[0];
    assert.equal(route.distanceMeters, 2000);
    assert.equal(route.distanceKm, 2);
    assert.equal(route.durationMin, 10);
    assert.equal(route.trafficAware, true);
    assert.ok(route.polyline.length > 0, 'route carries an encoded polyline');
    assert.equal(route.steps[0].instruction, 'Head south on A Road');
  } finally {
    await mock.close();
  }
});

test('googleRoutes.distanceMatrix folds elements into rows', async () => {
  const mock = await startMock((req, res) => json(res, 200, MATRIX_RESPONSE));
  try {
    const { GOOGLE_URLS } = await import('../src/config/googleMaps.js');
    GOOGLE_URLS.computeRouteMatrix = `${mock.base}/matrix`;
    const routesProvider = await import('../src/providers/googleRoutes.provider.js');
    const result = await routesProvider.distanceMatrix(
      ['18.9,72.8'],
      ['18.94,72.83', '19.0,73.0'],
      'driving'
    );
    assert.equal(result.isLive, true);
    assert.equal(result.data.rows.length, 1);
    assert.equal(result.data.rows[0].length, 2);
    assert.equal(result.data.rows[0][0].status, 'OK');
    assert.equal(result.data.rows[0][0].durationMin, 8);
    assert.equal(result.data.rows[0][1].distanceKm, 5);
  } finally {
    await mock.close();
  }
});
