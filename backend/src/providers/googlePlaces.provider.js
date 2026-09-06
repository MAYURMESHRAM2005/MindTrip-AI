import {
  GOOGLE_URLS,
  isGoogleMapsConfigured,
  googleHeaderGet,
  googlePost,
} from '../config/googleMaps.js';
import { live, unavailable } from './base.provider.js';
import logger from '../utils/logger.js';

/**
 * Google Places provider (Places API — New).
 *
 * Real restaurants, hotels, attractions, emergency services etc. come from
 * Google Places. Every returned place carries a real Google placeId and real
 * provider fields; anything Google does not return stays null — never invented.
 *
 * Normalized place shape (superset of the previous provider contract):
 *   { placeId, name, formattedAddress, address, latitude, longitude,
 *     coordinates, rating, userRatingCount, priceLevel, openingHours, types,
 *     googleMapsUri, website, phone, businessStatus, openNow, suburb/district/
 *     county/city/state/country, photoRef, dataStatus: 'live', source }
 */

const SOURCE = 'google-places';
const PLACES_FIELD_MASK =
  'places.id,places.displayName,places.formattedAddress,places.shortFormattedAddress,' +
  'places.location,places.rating,places.userRatingCount,places.priceLevel,' +
  'places.types,places.primaryType,places.googleMapsUri,places.websiteUri,' +
  'places.internationalPhoneNumber,places.nationalPhoneNumber,places.businessStatus,' +
  'places.currentOpeningHours,places.regularOpeningHours,places.photos,' +
  'places.addressComponents,places.plusCode';

const DETAILS_FIELD_MASK =
  'id,displayName,formattedAddress,shortFormattedAddress,location,rating,userRatingCount,' +
  'priceLevel,types,primaryType,googleMapsUri,websiteUri,internationalPhoneNumber,' +
  'nationalPhoneNumber,businessStatus,currentOpeningHours,regularOpeningHours,' +
  'photos,addressComponents,plusCode';

/** Max results Google Places (New) accepts per request. */
const MAX_PAGE_SIZE = 20;
const MAX_RADIUS_M = 50000;

// ── In-memory cache for place details (opening hours, contact info). ──
// Google place details change rarely — caching avoids re-fetching the same
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

// ── Search result cache (textSearch / nearbySearch) ──────────────────
// The same keyword/area searches are repeated constantly: the Maps page's
// 8 categories, emergency categories, the attraction/restaurant agents, and
// the trip nightlife step. Each hit costs Places (New) quota, so successful
// searches are cached briefly. Nearby data changes slowly (TTL 3h); free-text
// results slightly faster (TTL 1h).
const NEARBY_CACHE_TTL_MS = 3 * 60 * 60 * 1000; // 3 hours
const TEXT_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const SEARCH_CACHE_MAX = 300;
const searchCache = new Map(); // key → { data, expiresAt }

/** Build a stable cache key from a search request (order-independent). */
function searchCacheKey(prefix, params) {
  const { query = '', lat = '', lng = '', type = '', radius = '', limit = '' } = params;
  return `${prefix}|${String(query).trim().toLowerCase()}|${lat}|${lng}|${type}|${radius}|${limit}`;
}

function getCachedSearch(key) {
  const entry = searchCache.get(key);
  if (entry && Date.now() < entry.expiresAt) return entry.data;
  if (entry) searchCache.delete(key); // expired
  return null;
}

function setCachedSearch(key, data, ttlMs) {
  searchCache.set(key, { data, expiresAt: Date.now() + ttlMs });
  if (searchCache.size > SEARCH_CACHE_MAX) {
    const oldest = searchCache.keys().next().value;
    if (oldest) searchCache.delete(oldest);
  }
}

/** Get the current search cache size (for logging). */
export function getSearchCacheSize() {
  return searchCache.size;
}

/** Drop expired entries from the search cache. */
export function purgeExpiredSearchCache() {
  const now = Date.now();
  for (const [key, entry] of searchCache) {
    if (now >= entry.expiresAt) searchCache.delete(key);
  }
}

/** Clear expired entries from the cache. */
export function purgeExpiredDetailsCache() {
  const now = Date.now();
  for (const [key, entry] of detailsCache) {
    if (now >= entry.expiresAt) detailsCache.delete(key);
  }
}

// ══════════════════════════════════════════════════════════════════════
//  CATEGORY / TYPE MAPPING
// ══════════════════════════════════════════════════════════════════════

/**
 * Requested search category → Google includedTypes for Nearby Search.
 * (Text Search uses the free-text query instead.)
 */
const NEARBY_INCLUDED_TYPES = {
  restaurant: ['restaurant'],
  cafe: ['cafe', 'bakery'],
  bar: ['bar'],
  nightlife: ['bar', 'night_club', 'restaurant'],
  hotel: ['lodging'],
  tourist_attraction: [
    'tourist_attraction', 'museum', 'art_gallery', 'amusement_park', 'park',
    'zoo', 'aquarium', 'landmark', 'natural_feature', 'point_of_interest',
    'church', 'hindu_temple', 'mosque', 'synagogue', 'stadium',
    'shopping_mall', 'movie_theater',
  ],
  hospital: ['hospital'],
  police: ['police'],
  pharmacy: ['pharmacy'],
  atm: ['atm'],
  transit_station: ['transit_station', 'train_station', 'subway_station', 'light_rail_station', 'bus_station'],
  embassy: ['embassy'],
  viewpoint: ['view_point', 'tourist_attraction'],
  beach: ['beach', 'natural_feature'],
  market: ['supermarket', 'shopping_mall', 'store', 'food'],
  shopping: ['shopping_mall', 'department_store'],
  'transport.airport': ['airport'],
  'transport.train': ['train_station', 'transit_station'],
  'transport.bus': ['bus_station', 'transit_station'],
};

/** Google place type → legacy-style category tokens (keeps filters working). */
const GOOGLE_TYPE_TOKENS = {
  restaurant: ['catering.restaurant'],
  cafe: ['catering.cafe'],
  bakery: ['catering.bakery'],
  bar: ['catering.bar'],
  night_club: ['entertainment.nightclub', 'catering.bar'],
  meal_takeaway: ['catering.restaurant'],
  meal_delivery: ['catering.restaurant'],
  food: ['catering'],
  tourist_attraction: ['tourism.sights', 'tourism.attraction'],
  museum: ['tourism.attraction', 'tourism.museum'],
  art_gallery: ['tourism.attraction', 'tourism.art_gallery'],
  amusement_park: ['entertainment.theme_park', 'leisure.park'],
  aquarium: ['tourism.attraction', 'entertainment.aquarium'],
  zoo: ['tourism.attraction', 'entertainment.zoo'],
  park: ['leisure.park'],
  natural_feature: ['natural.feature'],
  beach: ['natural.beach'],
  landmark: ['tourism.sights', 'heritage'],
  historical_landmark: ['tourism.sights', 'heritage'],
  church: ['tourism.attraction', 'place_of_worship'],
  hindu_temple: ['tourism.attraction', 'place_of_worship'],
  mosque: ['tourism.attraction', 'place_of_worship'],
  synagogue: ['tourism.attraction', 'place_of_worship'],
  stadium: ['leisure.stadium', 'entertainment'],
  view_point: ['tourism.viewpoint'],
  movie_theater: ['entertainment.cinema'],
  bowling_alley: ['leisure.bowling'],
  casino: ['entertainment.casino'],
  performing_arts_theater: ['entertainment.theatre'],
  shopping_mall: ['commercial.shopping_mall'],
  department_store: ['commercial.shopping_mall'],
  supermarket: ['commercial.marketplace'],
  store: ['commercial'],
  shopping_center: ['commercial.shopping_mall'],
  lodging: ['accommodation.hotel'],
  hotel: ['accommodation.hotel'],
  hospital: ['healthcare.hospital'],
  pharmacy: ['healthcare.pharmacy'],
  drugstore: ['healthcare.pharmacy'],
  police: ['amenity.police'],
  atm: ['finance.atm'],
  bank: ['finance.bank'],
  embassy: ['office.diplomatic'],
  airport: ['public_transport.airport', 'transport.airport'],
  train_station: ['public_transport.railway_station'],
  subway_station: ['public_transport.subway'],
  light_rail_station: ['public_transport'],
  bus_station: ['public_transport.bus'],
  transit_station: ['public_transport'],
  gym: ['leisure.fitness'],
  spa: ['leisure.spa'],
  doctor: ['healthcare'],
  dentist: ['healthcare'],
  physiotherapist: ['healthcare'],
  university: ['education'],
  school: ['education'],
  primary_school: ['education'],
  secondary_school: ['education'],
  library: ['education.library', 'leisure.library'],
};

/** Requested search category → fallback legacy tokens when no Google type matches. */
const CATEGORY_TOKENS = {
  tourist_attraction: ['tourism.sights', 'tourism.attraction'],
  restaurant: ['catering.restaurant'],
  hotel: ['accommodation.hotel'],
  cafe: ['catering.cafe'],
  bar: ['catering.bar'],
  nightlife: ['entertainment.nightclub', 'catering.bar'],
  hospital: ['healthcare.hospital'],
  police: ['amenity.police'],
  pharmacy: ['healthcare.pharmacy'],
  atm: ['finance.atm'],
  transit_station: ['public_transport'],
  embassy: ['office.diplomatic'],
  viewpoint: ['tourism.viewpoint'],
  beach: ['natural.beach'],
  market: ['commercial.marketplace'],
  shopping: ['commercial.shopping_mall'],
  'transport.airport': ['transport.airport'],
  'transport.train': ['transport.train'],
  'transport.bus': ['transport.bus'],
};

/** Union of the Google types, alias tokens and requested-category tokens. */
function buildTypes(googleTypes = [], category = '') {
  const out = new Set((googleTypes || []).map((t) => String(t).toLowerCase()).filter(Boolean));
  for (const t of out) {
    for (const token of GOOGLE_TYPE_TOKENS[t] || []) out.add(token);
  }
  for (const token of CATEGORY_TOKENS[category] || []) out.add(token);
  return [...out];
}

// ══════════════════════════════════════════════════════════════════════
//  OPENING HOURS NORMALIZATION
// ══════════════════════════════════════════════════════════════════════

const DAY_ORDER = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const DAY_INDEX = { Su: 0, Mo: 1, Tu: 2, We: 3, Th: 4, Fr: 5, Sa: 6 };

function pad2(n) {
  return String(n).padStart(2, '0');
}

/**
 * Normalize Google regularOpeningHours into the shape the itinerary engine
 * consumes: { raw, periods: [{ days, open, close, text }] }.
 */
export function parseGoogleOpeningHours(hours) {
  if (!hours || typeof hours !== 'object') return null;
  const raw = Array.isArray(hours.weekdayDescriptions) ? hours.weekdayDescriptions.join('; ') : '';
  const periods = [];
  for (const p of hours.periods || []) {
    if (!p?.open || !p?.close) continue;
    const openDay = p.open.day != null ? DAY_ORDER[p.open.day] : 'all';
    const closeDay = p.close.day != null ? DAY_ORDER[p.close.day] : openDay;
    const open = `${pad2(p.open.hour ?? 0)}:${pad2(p.open.minute ?? 0)}`;
    const close = `${pad2(p.close.hour ?? 0)}:${pad2(p.close.minute ?? 0)}`;
    // Overnight close lands on a later day — still represent as the open day.
    periods.push({
      days: [openDay],
      open,
      close,
      text: `${openDay} ${open}-${close}${closeDay !== openDay ? ` (until ${closeDay})` : ''}`,
    });
  }
  if (!periods.length && raw) {
    // No machine-readable periods — keep raw text only.
    return { raw, periods: [], openNow: hours.openNow ?? null };
  }
  return { raw, periods, openNow: hours.openNow ?? null };
}

/** Compatibility alias kept for callers/tests that referenced the old parser name. */
export const parseOpeningHours = parseGoogleOpeningHours;

// ══════════════════════════════════════════════════════════════════════
//  RESPONSE NORMALIZATION
// ══════════════════════════════════════════════════════════════════════

/**
 * Normalize a Google Places object into the canonical place shape.
 *
 * @param {object} p - raw Google place (search result or details)
 * @param {object} [opts]
 * @param {string} [opts.category] - requested category (for legacy tokens)
 */
export function mapResult(p = {}, opts = {}) {
  const category = opts.category || '';
  const loc = p.location || {};
  const lat = loc.latitude != null ? Number(loc.latitude) : null;
  const lng = loc.longitude != null ? Number(loc.longitude) : null;
  const comps = (p.addressComponents || []).map((c) => ({
    long_name: c.longText ?? c.long_name ?? '',
    short_name: c.shortText ?? c.short_name ?? '',
    types: c.types || [],
  }));
  const locality = {};
  const pick = (types) => {
    for (const c of comps) {
      if ((c.types || []).some((t) => types.includes(t))) return c.long_name || c.short_name || '';
    }
    return '';
  };
  let suburb = '';
  for (const t of ['neighborhood', 'sublocality_level_1', 'sublocality', 'locality']) {
    if (pick([t])) {
      suburb = pick([t]);
      break;
    }
  }
  locality.suburb = suburb;
  locality.district = pick(['administrative_area_level_2']);
  locality.county = pick(['administrative_area_level_2']);
  locality.city = pick(['locality']) || pick(['administrative_area_level_3']) || pick(['administrative_area_level_1']);
  locality.state = pick(['administrative_area_level_1']);
  locality.country = pick(['country']);

  const formattedAddress = p.formattedAddress || p.shortFormattedAddress || '';
  const photos = (p.photos || []).map((ph) => ph.name || '').filter(Boolean);
  const openingHours = parseGoogleOpeningHours(p.regularOpeningHours || p.currentOpeningHours);

  return {
    placeId: p.id || p.placeId || '',
    name: p.displayName?.text || p.name || '',
    formattedAddress,
    address: formattedAddress,
    latitude: lat,
    longitude: lng,
    coordinates: lat != null && lng != null ? { lat, lng } : null,
    plusCode: p.plusCode?.globalCode || '',
    phone: p.internationalPhoneNumber || p.nationalPhoneNumber || null,
    website: p.websiteUri || '',
    url: p.websiteUri || '',
    googleMapsUri: p.googleMapsUri || '',
    rating: typeof p.rating === 'number' ? p.rating : null,
    userRatingCount: typeof p.userRatingCount === 'number' ? p.userRatingCount : null,
    userRatingsTotal: typeof p.userRatingCount === 'number' ? p.userRatingCount : null,
    reviewCount: typeof p.userRatingCount === 'number' ? p.userRatingCount : null,
    priceLevel: typeof p.priceLevel === 'number' ? p.priceLevel : null,
    types: buildTypes(p.types, category),
    categories: buildTypes(p.types, category),
    primaryType: p.primaryType || '',
    businessStatus: p.businessStatus || '',
    openNow: p.currentOpeningHours?.openNow ?? (openingHours ? openingHours.openNow : null) ?? null,
    openingHours,
    openingHoursRaw: openingHours ? openingHours.raw : '',
    photos,
    photoRef: photos[0] || '',
    distanceMeters: p.distanceMeters ?? null,
    // Locality fields drive day-by-day geographic area planning (real names,
    // never invented).
    ...locality,
    // Provenance — everything below is real provider data.
    dataStatus: 'live',
    isLive: true,
    source: SOURCE,
    provider: 'google',
  };
}

// ══════════════════════════════════════════════════════════════════════
//  TEXT / NEARBY SEARCH
// ══════════════════════════════════════════════════════════════════════

function clampLimit(limit) {
  const n = Math.min(Number(limit) || 10, MAX_PAGE_SIZE);
  return Math.max(1, n);
}

function clampRadius(radius) {
  const r = Number(radius) || 5000;
  return Math.min(Math.max(r, 1), MAX_RADIUS_M);
}

/**
 * Text search — restaurants, attractions, hotels by keyword.
 * Uses Places API (New) Text Search with a location bias when coordinates
 * are available.
 */
export async function textSearch({ query, lat, lng, radius = 5000, type = 'tourist_attraction', limit = 10 }) {
  logger.entry('[PROVIDER:google-places]', 'textSearch', { query, type, limit, hasCoords: lat != null && lng != null });
  const started = Date.now();
  if (!isGoogleMapsConfigured()) return unavailable(SOURCE, 'Google Maps API key not configured');
  const q = String(query || '').trim();
  if (!q) return unavailable(SOURCE, 'Places search requires a query');

  // Include the location bias in the cache key: the same free-text query asked
  // near different coordinates must never reuse results cached for another city.
  const cacheKey = searchCacheKey('text', {
    query: q,
    type,
    limit,
    lat: lat != null && !Number.isNaN(Number(lat)) ? Number(lat).toFixed(5) : null,
    lng: lng != null && !Number.isNaN(Number(lng)) ? Number(lng).toFixed(5) : null,
  });
  const cached = getCachedSearch(cacheKey);
  if (cached) {
    logger.provider(SOURCE, 'textSearch (cached)', { isLive: true, count: cached.length, latencyMs: Date.now() - started });
    return live(SOURCE, cached, 'Cached data from Google Places');
  }

  try {
    const body = {
      textQuery: q,
      languageCode: 'en',
      pageSize: clampLimit(limit),
    };
    if (lat != null && lng != null && !Number.isNaN(Number(lat)) && !Number.isNaN(Number(lng))) {
      body.locationBias = {
        circle: {
          center: { latitude: Number(lat), longitude: Number(lng) },
          radius: clampRadius(radius),
        },
      };
    }
    const data = await googlePost(GOOGLE_URLS.placesTextSearch, body, { fieldMask: PLACES_FIELD_MASK });
    const results = (data?.places || []).map((p) => mapResult(p, { category: type }));
    if (!results.length) {
      return unavailable(SOURCE, `Places search returned no results for "${q}"`, { code: 'NO_RESULTS' });
    }
    setCachedSearch(cacheKey, results, TEXT_CACHE_TTL_MS);
    logger.provider(SOURCE, 'textSearch', { isLive: true, count: results.length, latencyMs: Date.now() - started });
    return live(SOURCE, results, 'Live data from Google Places');
  } catch (err) {
    logger.error(`[PROVIDER:google-places] textSearch error: ${err.message}`);
    return unavailable(SOURCE, `Live data unavailable: ${err.message}`);
  }
}

/**
 * Nearby search — hotels, restaurants, hospitals, police, ATMs, pharmacies,
 * transit stations near a point (Places API New Nearby Search).
 */
export async function nearbySearch({ lat, lng, type = 'hospital', radius = 5000, limit = 12 }) {
  logger.entry('[PROVIDER:google-places]', 'nearbySearch', { type, radius, limit, lat, lng });
  const started = Date.now();
  if (!isGoogleMapsConfigured()) return unavailable(SOURCE, 'Google Maps API key not configured');
  if (lat == null || lng == null || Number.isNaN(Number(lat)) || Number.isNaN(Number(lng))) {
    return unavailable(SOURCE, 'Nearby search requires coordinates');
  }

  const cacheKey = searchCacheKey('nearby', {
    lat: Number(lat).toFixed(5),
    lng: Number(lng).toFixed(5),
    type,
    radius: clampRadius(radius),
    limit: clampLimit(limit),
  });
  const cached = getCachedSearch(cacheKey);
  if (cached) {
    logger.provider(SOURCE, 'nearbySearch (cached)', { isLive: true, count: cached.length, latencyMs: Date.now() - started });
    return live(SOURCE, cached, 'Cached data from Google Places');
  }

  try {
    const includedTypes = NEARBY_INCLUDED_TYPES[type] || [type];
    const body = {
      includedTypes,
      locationRestriction: {
        circle: {
          center: { latitude: Number(lat), longitude: Number(lng) },
          radius: clampRadius(radius),
        },
      },
      languageCode: 'en',
      maxResultCount: clampLimit(limit),
    };
    const data = await googlePost(GOOGLE_URLS.placesNearbySearch, body, { fieldMask: PLACES_FIELD_MASK });
    const results = (data?.places || []).map((p) => mapResult(p, { category: type }));
    if (!results.length) {
      return unavailable(SOURCE, `No nearby ${type} results in this area`, { code: 'NO_RESULTS' });
    }
    setCachedSearch(cacheKey, results, NEARBY_CACHE_TTL_MS);
    logger.provider(SOURCE, 'nearbySearch', { isLive: true, count: results.length, latencyMs: Date.now() - started });
    return live(SOURCE, results, 'Live data from Google Places');
  } catch (err) {
    logger.error(`[PROVIDER:google-places] nearbySearch error: ${err.message}`);
    return unavailable(SOURCE, `Live data unavailable: ${err.message}`);
  }
}

// ══════════════════════════════════════════════════════════════════════
//  PLACE DETAILS
// ══════════════════════════════════════════════════════════════════════

/**
 * Fetch details for one Google place (opening hours, phone, website, photos).
 * Results are cached in memory for 24 hours.
 */
export async function placeDetails(placeId) {
  logger.entry('[PROVIDER:google-places]', 'placeDetails', { placeId });
  const started = Date.now();
  if (!isGoogleMapsConfigured()) return unavailable(SOURCE, 'Google Maps API key not configured');
  if (!placeId) return unavailable(SOURCE, 'Place details requires a placeId');

  const cached = getCachedDetails(placeId);
  if (cached) {
    logger.provider(SOURCE, 'placeDetails (cached)', { isLive: true, hasOpeningHours: Boolean(cached.openingHours), latencyMs: Date.now() - started });
    return live(SOURCE, cached, 'Cached place details');
  }

  try {
    const data = await googleHeaderGet(GOOGLE_URLS.placesDetails(placeId), { fieldMask: DETAILS_FIELD_MASK });
    if (!data || !data.id) {
      return unavailable(SOURCE, `Place details failed: place "${placeId}" not found`);
    }
    const result = mapResult(data, {});
    setCachedDetails(placeId, result);
    logger.provider(SOURCE, 'placeDetails', { isLive: true, hasOpeningHours: Boolean(result.openingHours), latencyMs: Date.now() - started });
    return live(SOURCE, result, 'Live place details from Google Places');
  } catch (err) {
    logger.error(`[PROVIDER:google-places] placeDetails error: ${err.message}`);
    return unavailable(SOURCE, `Live data unavailable: ${err.message}`);
  }
}

/**
 * Fetch details for multiple places in parallel (batched, concurrency-capped).
 * Returns a Map of placeId → enriched place. Cached results return instantly.
 *
 * @param {string[]} placeIds
 * @param {object} opts
 * @param {number} opts.concurrency — max parallel requests (default 8)
 * @returns {Promise<Map<string, object>>}
 */
export async function batchPlaceDetails(placeIds, { concurrency = 8 } = {}) {
  if (!isGoogleMapsConfigured() || !placeIds?.length) return new Map();
  const ids = [...new Set(placeIds)].filter(Boolean);
  logger.info(`[PROVIDER:google-places] batchPlaceDetails: ${ids.length} unique place IDs requested`);
  const started = Date.now();

  const cached = new Map();
  const toFetch = [];
  for (const id of ids) {
    const hit = getCachedDetails(id);
    if (hit) cached.set(id, hit);
    else toFetch.push(id);
  }
  if (cached.size > 0) {
    logger.info(`[PROVIDER:google-places] batchPlaceDetails: ${cached.size}/${ids.length} served from cache`);
  }

  const results = new Map(cached);
  const CONCURRENCY = Math.max(1, Number(concurrency) || 8);
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

  logger.info(`[PROVIDER:google-places] batchPlaceDetails: ${results.size}/${ids.length} enriched (${cached.size} cached) in ${Date.now() - started}ms`);
  return results;
}

/**
 * Photo media URL for a Google Photos (New) photo name.
 *
 * Serving photo media requires embedding an API key in the URL, and the
 * server-side GOOGLE_MAPS_API_KEY must NEVER be exposed to the browser, so
 * this returns '' (photo unavailable) — exactly like the previous provider,
 * which had no photo API either. Places still carry googleMapsUri so users
 * can open the real place page. If photo display is added later, it must
 * proxy through the backend or use a referrer-restricted browser key.
 */
export function photoUrl() {
  return '';
}

export default {
  textSearch,
  nearbySearch,
  placeDetails,
  batchPlaceDetails,
  parseOpeningHours,
  parseGoogleOpeningHours,
  photoUrl,
  mapResult,
  getDetailsCacheSize,
  purgeExpiredDetailsCache,
  getSearchCacheSize,
  purgeExpiredSearchCache,
};
