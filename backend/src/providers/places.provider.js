import env from '../config/env.js';
import { live, unavailable, axiosGet } from './base.provider.js';
import logger from '../utils/logger.js';

/**
 * Geoapify Places provider.
 * Same function signatures as before, so controllers and AI agents keep working.
 */

const PLACES_URL = 'https://api.geoapify.com/v2/places';
const DETAILS_URL = 'https://api.geoapify.com/v2/place-details';
const GEOCODE_URL = 'https://api.geoapify.com/v1/geocode/search';

// ── In-memory cache for place details (opening hours, contact info) ──
// Geoapify place details change rarely — caching avoids re-fetching the same
// place across multiple trips. TTL: 24 hours.
const DETAILS_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const detailsCache = new Map(); // placeId → { data, expiresAt }

/** Get a cached place detail if still valid. */
function getCachedDetails(placeId) {
  const entry = detailsCache.get(placeId);
  if (entry && Date.now() < entry.expiresAt) return entry.data;
  if (entry) detailsCache.delete(placeId); // expired
  return null;
}

/** Store a place detail in cache. */
function setCachedDetails(placeId, data) {
  if (!placeId || !data) return;
  detailsCache.set(placeId, { data, expiresAt: Date.now() + DETAILS_CACHE_TTL_MS });
}

/** Get the current cache size (for logging). */
export function getDetailsCacheSize() {
  return detailsCache.size;
}

/** Clear expired entries from the cache. */
export function purgeExpiredDetailsCache() {
  const now = Date.now();
  for (const [key, entry] of detailsCache) {
    if (now >= entry.expiresAt) detailsCache.delete(key);
  }
}

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
    phone: p.phone || p.contact?.phone || p.housenumber || null,
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
  logger.entry('[PROVIDER:places]', 'textSearch', { query, type, limit, hasCoords: lat != null && lng != null });
  const started = Date.now();
  if (!key()) return unavailable('geoapify', 'Geoapify API key not configured');

  // Places API first. Errors and empty results both fall through to the
  // amenity-geocode fallback below (the API may reject text-only queries).
  let features = [];
  try {
    const params = {
      text: query,
      categories: CATEGORY_MAP[type] || type,
      limit: Math.min(Number(limit) || 10, 35),
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
    const results = features.slice(0, limit).map(mapResult);
    logger.provider('geoapify', 'textSearch', { isLive: true, count: results.length, latencyMs: Date.now() - started });
    return live('geoapify', results, 'Live data from Geoapify');
  }

  // Text-only fallback: geocode the query as an amenity (e.g. "restaurants in Goa")
  try {
    const g = await apiGet(GEOCODE_URL, {
      text: query,
      type: 'amenity',
      limit: Math.min(Number(limit) || 10, 35),
      format: 'json',
      lang: 'en',
    });
    const results = g?.results || [];
    if (!results.length) {
      return unavailable('geoapify', `Places search failed: no results for "${query}"`);
    }
    const fallbackResults = results.slice(0, limit).map((r) => ({
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
    }));
    logger.provider('geoapify', 'textSearch (fallback geocode)', { isLive: true, count: fallbackResults.length, latencyMs: Date.now() - started });
    return live(
      'geoapify',
      fallbackResults,
      'Live data from Geoapify'
    );
  } catch (err) {
    logger.error(`[PROVIDER:places] textSearch error: ${err.message}`);
    return unavailable('geoapify', `Live data unavailable: ${err.message}`);
  }
}

/** Nearby search — hospitals, police, ATMs, pharmacies, transit near a point. */
export async function nearbySearch({ lat, lng, type = 'hospital', radius = 5000, limit = 12 }) {
  logger.entry('[PROVIDER:places]', 'nearbySearch', { type, radius, limit, lat, lng });
  const started = Date.now();
  if (!key()) return unavailable('geoapify', 'Geoapify API key not configured');
  try {
    if (lat == null || lng == null) {
      return unavailable('geoapify', 'Nearby search requires coordinates');
    }
    const data = await apiGet(PLACES_URL, {
      categories: CATEGORY_MAP[type] || type,
      filter: `circle:${lng},${lat},${radius}`,
      bias: `proximity:${lng},${lat}`,
      limit: Math.min(Number(limit) || 12, 35),
      lang: 'en',
      format: 'json',
    });
    const features = data?.features || [];
    const results = features.slice(0, limit).map(mapResult);
    logger.provider('geoapify', 'nearbySearch', { isLive: true, count: results.length, latencyMs: Date.now() - started });
    return live('geoapify', results, 'Live data from Geoapify');
  } catch (err) {
    logger.error(`[PROVIDER:places] nearbySearch error: ${err.message}`);
    return unavailable('geoapify', `Live data unavailable: ${err.message}`);
  }
}

export async function placeDetails(placeId) {
  logger.entry('[PROVIDER:places]', 'placeDetails', { placeId });
  const started = Date.now();
  if (!key()) return unavailable('geoapify', 'Geoapify API key not configured');

  // Check cache first — avoids API call for previously-fetched places
  const cached = getCachedDetails(placeId);
  if (cached) {
    logger.provider('geoapify', 'placeDetails (cached)', { isLive: true, hasOpeningHours: Boolean(cached.openingHours), latencyMs: Date.now() - started });
    return live('geoapify', cached, 'Cached place details');
  }

  try {
    const data = await apiGet(DETAILS_URL, { id: placeId, lang: 'en', format: 'json' });
    if (!data?.features?.[0]) {
      return unavailable('geoapify', `Place details failed: ${data?.error || 'not found'}`);
    }
    const feature = data.features[0];
    const result = mapResult(feature);
    // Parse opening hours from details properties
    const props = feature.properties || {};
    if (props.opening_hours) {
      result.openingHours = parseOpeningHours(props.opening_hours);
      result.openingHoursRaw = props.opening_hours;
    }
    if (props.contact) {
      result.phone = props.contact.phone || result.phone;
      result.email = props.contact.email || null;
    }
    // Cache the result for future requests
    setCachedDetails(placeId, result);
    logger.provider('geoapify', 'placeDetails', { isLive: true, hasOpeningHours: Boolean(props.opening_hours), latencyMs: Date.now() - started });
    return live('geoapify', result);
  } catch (err) {
    logger.error(`[PROVIDER:places] placeDetails error: ${err.message}`);
    return unavailable('geoapify', `Live data unavailable: ${err.message}`);
  }
}

/**
 * Fetch details for multiple places in parallel (batch).
 * Returns a Map of placeId → enriched place object with opening hours.
 * Uses in-memory cache to avoid re-fetching previously-fetched places.
 * Cached results return instantly with zero API credits.
 *
 * @param {string[]} placeIds — Array of Geoapify place IDs
 * @param {object} opts
 * @param {number} opts.concurrency — Max parallel requests (default 8)
 * @returns {Map<string, object>} — placeId → enriched place object
 */
export async function batchPlaceDetails(placeIds, { concurrency = 8 } = {}) {
  if (!key() || !placeIds?.length) return new Map();
  const ids = [...new Set(placeIds)].filter(Boolean); // deduplicate
  logger.info(`[PROVIDER:places] batchPlaceDetails: ${ids.length} unique place IDs requested`);
  const started = Date.now();

  // Separate cached vs uncached IDs
  const cached = new Map();
  const toFetch = [];
  for (const id of ids) {
    const hit = getCachedDetails(id);
    if (hit) {
      cached.set(id, hit);
    } else {
      toFetch.push(id);
    }
  }

  if (cached.size > 0) {
    logger.info(`[PROVIDER:places] batchPlaceDetails: ${cached.size}/${ids.length} served from cache`);
  }

  // Fetch uncached IDs in parallel with concurrency limit
  const results = new Map(cached);
  const CONCURRENCY = concurrency;

  for (let i = 0; i < toFetch.length; i += CONCURRENCY) {
    const batch = toFetch.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.allSettled(
      batch.map((id) => placeDetails(id).then((r) => ({ id, result: r })))
    );
    for (const settled of batchResults) {
      if (settled.status === 'fulfilled' && settled.value.result.isLive) {
        results.set(settled.value.id, settled.value.result.data);
      }
    }
  }

  const apiCalls = toFetch.length;
  const cacheHits = cached.size;
  logger.info(`[PROVIDER:places] batchPlaceDetails: ${results.size}/${ids.length} enriched (${cacheHits} cached, ${apiCalls} API calls) in ${Date.now() - started}ms`);
  return results;
}

/**
 * Parse OSM opening hours string into a structured format.
 * Input: "Sa-Th 10:00-17:00; Fr 10:00-20:30"
 * Output: { raw, periods: [{ days: ['Sa','Th'], open: '10:00', close: '17:00' }, ...] }
 */
function parseOpeningHours(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const periods = [];
  const parts = raw.split(';').map((s) => s.trim()).filter(Boolean);
  
  for (const part of parts) {
    // Match patterns like: "Mo-Fr 09:00-17:00" or "10:00-18:00" or "Jun-Sep: 09:00-18:00"
    const timeMatch = part.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
    if (!timeMatch) continue;
    
    const open = timeMatch[1];
    const close = timeMatch[2];
    const beforeTime = part.substring(0, timeMatch.index).trim();
    
    // Parse day abbreviations
    const dayPattern = /((?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?)/g;
    const days = [];
    let dayMatch;
    while ((dayMatch = dayPattern.exec(beforeTime)) !== null) {
      const range = dayMatch[1];
      if (range.includes('-')) {
        const [start, end] = range.split('-');
        const dayOrder = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
        const startIdx = dayOrder.indexOf(start);
        const endIdx = dayOrder.indexOf(end);
        if (startIdx !== -1 && endIdx !== -1) {
          for (let i = startIdx; i <= endIdx; i++) days.push(dayOrder[i]);
        }
      } else {
        days.push(range);
      }
    }
    
    periods.push({
      days: days.length ? days : ['all'],
      open,
      close,
      text: part,
    });
  }
  
  return { raw, periods };
}

/** Geoapify has no photo API — kept for signature compatibility. */
export function photoUrl() {
  return '';
}

export default { textSearch, nearbySearch, placeDetails, batchPlaceDetails, parseOpeningHours, photoUrl, mapResult, getDetailsCacheSize, purgeExpiredDetailsCache };
