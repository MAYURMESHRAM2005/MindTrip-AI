import env from '../config/env.js';
import { live, unavailable, axiosGet } from './base.provider.js';

/**
 * Geoapify Places provider.
 * Same function signatures as before, so controllers and AI agents keep working.
 */

const PLACES_URL = 'https://api.geoapify.com/v2/places';
const DETAILS_URL = 'https://api.geoapify.com/v2/place-details';
const GEOCODE_URL = 'https://api.geoapify.com/v1/geocode/search';

function key() {
  return env.GEOAPIFY_API_KEY;
}

const CATEGORY_MAP = {
  tourist_attraction: 'tourism.sights,tourism.attraction,tourism.monument',
  restaurant: 'catering.restaurant',
  hotel: 'accommodation.hotel',
  hospital: 'healthcare.hospital',
  police: 'amenity.police',
  pharmacy: 'healthcare.pharmacy',
  atm: 'finance.atm',
  transit_station: 'public_transport',
  embassy: 'office.diplomatic',
  cafe: 'catering.cafe',
  bar: 'catering.bar',
  nightlife: 'entertainment.nightclub,catering.bar',
  viewpoint: 'tourism.viewpoint',
  beach: 'natural.beach',
  market: 'commercial.marketplace',
  shopping: 'commercial.shopping_mall',
};

/** Normalize a Geoapify Places GeoJSON feature into the previous place shape. */
function mapResult(f) {
  const p = f?.properties || {};
  const [lng, lat] = f?.geometry?.coordinates || [null, null];
  return {
    placeId: p.place_id || '',
    name: p.name || '',
    address: p.formatted || p.address_line1 || '',
    coordinates: lat != null && lng != null ? { lat, lng } : null,
    rating: null,
    userRatingsTotal: null,
    priceLevel: null,
    types: p.categories || [],
    // Locality fields drive day-by-day geographic area planning (real names,
    // never invented). Falls back gracefully when the provider omits them.
    suburb: p.suburb || '',
    district: p.district || '',
    county: p.county || '',
    city: p.city || '',
    state: p.state || '',
    openNow: null,
    photoRef: '',
    distanceMeters: p.distance ?? null,
    businessStatus: '',
    url: p.website || '',
    website: p.website || '',
  };
}

async function apiGet(url, params) {
  const qs = new URLSearchParams({ apiKey: key(), ...params });
  return axiosGet(`${url}?${qs}`, {}, 8000);
}

/**
 * Text search — restaurants, attractions, hotels by keyword.
 * Uses Geoapify Places with a spatial bias when coordinates are available;
 * falls back to amenity geocoding for text-only queries.
 */
export async function textSearch({ query, lat, lng, radius = 5000, type = 'tourist_attraction', limit = 10 }) {
  if (!key()) return unavailable('geoapify', 'Geoapify API key not configured');

  // Places API first. Errors and empty results both fall through to the
  // amenity-geocode fallback below (the API may reject text-only queries).
  let features = [];
  try {
    const params = {
      text: query,
      categories: CATEGORY_MAP[type] || type,
      limit: Math.min(Number(limit) || 10, 20),
      lang: 'en',
      format: 'json',
    };
    if (lat != null && lng != null) {
      params.filter = `circle:${lng},${lat},${radius}`;
      params.bias = `proximity:${lng},${lat}`;
    }
    const data = await apiGet(PLACES_URL, params);
    features = data?.features || [];
  } catch {
    features = [];
  }

  if (features.length) {
    return live('geoapify', features.slice(0, limit).map(mapResult), 'Live data from Geoapify');
  }

  // Text-only fallback: geocode the query as an amenity (e.g. "restaurants in Goa")
  try {
    const g = await apiGet(GEOCODE_URL, {
      text: query,
      type: 'amenity',
      limit: Math.min(Number(limit) || 10, 20),
      format: 'json',
      lang: 'en',
    });
    const results = g?.results || [];
    if (!results.length) {
      return unavailable('geoapify', `Places search failed: no results for "${query}"`);
    }
    return live(
      'geoapify',
      results.slice(0, limit).map((r) => ({
        placeId: r.place_id || '',
        name: r.name || r.formatted || '',
        address: r.formatted || '',
        coordinates: r.lat != null && r.lon != null ? { lat: r.lat, lng: r.lon } : null,
        rating: null,
        userRatingsTotal: null,
        priceLevel: null,
        types: r.result_type ? [r.result_type] : [],
        openNow: null,
        photoRef: '',
        distanceMeters: null,
        businessStatus: '',
        url: '',
        website: '',
      })),
      'Live data from Geoapify'
    );
  } catch (err) {
    return unavailable('geoapify', `Live data unavailable: ${err.message}`);
  }
}

/** Nearby search — hospitals, police, ATMs, pharmacies, transit near a point. */
export async function nearbySearch({ lat, lng, type = 'hospital', radius = 5000, limit = 12 }) {
  if (!key()) return unavailable('geoapify', 'Geoapify API key not configured');
  try {
    if (lat == null || lng == null) {
      return unavailable('geoapify', 'Nearby search requires coordinates');
    }
    const data = await apiGet(PLACES_URL, {
      categories: CATEGORY_MAP[type] || type,
      filter: `circle:${lng},${lat},${radius}`,
      bias: `proximity:${lng},${lat}`,
      limit: Math.min(Number(limit) || 12, 20),
      lang: 'en',
      format: 'json',
    });
    const features = data?.features || [];
    return live('geoapify', features.slice(0, limit).map(mapResult), 'Live data from Geoapify');
  } catch (err) {
    return unavailable('geoapify', `Live data unavailable: ${err.message}`);
  }
}

export async function placeDetails(placeId) {
  if (!key()) return unavailable('geoapify', 'Geoapify API key not configured');
  try {
    const data = await apiGet(DETAILS_URL, { id: placeId, lang: 'en', format: 'json' });
    if (!data?.features?.[0]) {
      return unavailable('geoapify', `Place details failed: ${data?.error || 'not found'}`);
    }
    return live('geoapify', mapResult(data.features[0]));
  } catch (err) {
    return unavailable('geoapify', `Live data unavailable: ${err.message}`);
  }
}

/** Geoapify has no photo API — kept for signature compatibility. */
export function photoUrl() {
  return '';
}

export default { textSearch, nearbySearch, placeDetails, photoUrl, mapResult };
