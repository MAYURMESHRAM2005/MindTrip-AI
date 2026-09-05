import {
  GOOGLE_URLS,
  isGoogleMapsConfigured,
  googleQueryGet,
  googlePost,
  GoogleMapsError,
} from '../config/googleMaps.js';
import { live, unavailable } from './base.provider.js';
import logger from '../utils/logger.js';

/**
 * Google Geocoding provider.
 *
 * - geocode:      address → { lat, lng, address, placeId, city/state/country }
 * - reverseGeocode: lat,lng → human-readable address
 * - autocomplete: as-you-type place suggestions via the Places API (New)
 *
 * Every function returns the normalized provider envelope
 * { success, isLive, data, message, source } — never throws for provider
 * failures, so callers can degrade gracefully.
 */

const SOURCE = 'google-geocoding';

// ── Short-lived autocomplete cache ────────────────────────────────────
// Autocomplete is typed in bursts ("nag" → "nagp" → "nagpu"...) and the
// same prefix is frequently re-typed or shared across users (GlobalSearch +
// PlaceAutocomplete). Each hit costs Google Places quota, so identical
// queries are served from an in-memory cache for a short window. TTL 60s
// matches the frontend's staleTime so the cache and UI stay in sync.
const AUTOCOMPLETE_CACHE_TTL_MS = 60 * 1000;
const AUTOCOMPLETE_CACHE_MAX = 200;
const autocompleteCache = new Map(); // key → { data, expiresAt }

/** Build a cache key from the query parameters (case-insensitive). */
function autocompleteCacheKey(text, type, limit) {
  return `${String(text).trim().toLowerCase()}|${type || ''}|${limit || 6}`;
}

/** Get a cached autocomplete response if still valid, else null. */
function getCachedAutocomplete(key) {
  const entry = autocompleteCache.get(key);
  if (entry && Date.now() < entry.expiresAt) return entry.data;
  if (entry) autocompleteCache.delete(key); // expired
  return null;
}

/** Store an autocomplete response, evicting oldest entries over the cap. */
function setCachedAutocomplete(key, data) {
  autocompleteCache.set(key, { data, expiresAt: Date.now() + AUTOCOMPLETE_CACHE_TTL_MS });
  if (autocompleteCache.size > AUTOCOMPLETE_CACHE_MAX) {
    const oldest = autocompleteCache.keys().next().value;
    if (oldest) autocompleteCache.delete(oldest);
  }
}

/** Current cache size (for logging/tests). */
export function getAutocompleteCacheSize() {
  return autocompleteCache.size;
}

/** Drop expired entries (safe to call periodically). */
export function purgeExpiredAutocompleteCache() {
  const now = Date.now();
  for (const [key, entry] of autocompleteCache) {
    if (now >= entry.expiresAt) autocompleteCache.delete(key);
  }
}

// ── Shared geocode / reverse-geocode cache ────────────────────────────
// Geocoding results are stable (an address maps to the same coordinates for
// months). The trip pipeline geocodes the SAME destination many times per
// generation (destination lock, transport intelligence ×2, nightlife, events,
// traffic agent) — a shared cache collapses those into one network call and
// shields the Geocoding API quota.
const GEOCODE_CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const GEOCODE_CACHE_MAX = 500;
const geocodeCache = new Map(); // key → { data, expiresAt }

function geocodeCacheKey(address) {
  return String(address || '').trim().toLowerCase();
}

function geocodeCoordKey(lat, lng) {
  return `${Number(lat).toFixed(6)},${Number(lng).toFixed(6)}`;
}

function getCachedGeocode(key) {
  const entry = geocodeCache.get(key);
  if (entry && Date.now() < entry.expiresAt) return entry.data;
  if (entry) geocodeCache.delete(key); // expired
  return null;
}

function setCachedGeocode(key, data) {
  geocodeCache.set(key, { data, expiresAt: Date.now() + GEOCODE_CACHE_TTL_MS });
  if (geocodeCache.size > GEOCODE_CACHE_MAX) {
    const oldest = geocodeCache.keys().next().value;
    if (oldest) geocodeCache.delete(oldest);
  }
}

/** Current geocode cache size (for logging/tests). */
export function getGeocodeCacheSize() {
  return geocodeCache.size;
}

/** Drop expired entries (safe to call periodically). */
export function purgeExpiredGeocodeCache() {
  const now = Date.now();
  for (const [key, entry] of geocodeCache) {
    if (now >= entry.expiresAt) geocodeCache.delete(key);
  }
}

/** Parse address_components into locality fields for downstream geography checks. */
export function parseAddressComponents(components = []) {
  const pick = (types) => {
    for (const c of components) {
      if ((c.types || []).some((t) => types.includes(t))) return c.long_name || c.short_name || '';
    }
    return '';
  };
  // Smallest meaningful subdivision first (neighborhood → locality).
  let suburb = '';
  for (const t of ['neighborhood', 'sublocality_level_1', 'sublocality', 'locality']) {
    if (pick([t])) {
      suburb = pick([t]);
      break;
    }
  }
  return {
    suburb,
    district: pick(['administrative_area_level_2']),
    county: pick(['administrative_area_level_2']),
    city: pick(['locality']) || pick(['administrative_area_level_3']) || pick(['administrative_area_level_1']),
    state: pick(['administrative_area_level_1']),
    country: pick(['country']),
    postalCode: pick(['postal_code']),
  };
}

/** Normalize a Geocoding API result (address → coordinates). */
function mapGeocodeResult(r) {
  const loc = r?.geometry?.location || {};
  const locality = parseAddressComponents(r?.address_components);
  return {
    address: r?.formatted_address || '',
    formatted: r?.formatted_address || '',
    lat: loc.lat != null ? Number(loc.lat) : null,
    lng: loc.lng != null ? Number(loc.lng) : null,
    placeId: r?.place_id || '',
    ...locality,
    types: r?.types || [],
  };
}

/** Handle the legacy Geocoding API envelope ({ status, results, error_message }). */
function checkGeocodeEnvelope(data) {
  if (!data || typeof data !== 'object') {
    throw new GoogleMapsError('Geocoding returned a malformed response.', { code: 'MALFORMED_RESPONSE' });
  }
  const status = data.status || '';
  // Every non-OK status must be handled explicitly — otherwise failures like
  // REQUEST_DENIED (bad key / billing not enabled) fall through and are
  // misreported as "no results", hiding the real cause from the user.
  if (status === 'OK') return;
  if (status === 'ZERO_RESULTS') {
    throw new GoogleMapsError('No results found.', { code: 'NO_RESULTS', status });
  }
  if (status === 'REQUEST_DENIED') {
    const reason = data.error_message || 'Geocoding request denied.';
    logger.error(`[GOOGLE_MAPS] ${GOOGLE_URLS.geocode} failed — http=200 googleStatus=REQUEST_DENIED code=PERMISSION_DENIED message="${reason}"`);
    throw new GoogleMapsError(reason, { code: 'PERMISSION_DENIED', status });
  }
  if (status === 'OVER_QUERY_LIMIT') {
    throw new GoogleMapsError('Geocoding quota exceeded.', { code: 'RATE_LIMITED', status });
  }
  if (status === 'INVALID_REQUEST') {
    throw new GoogleMapsError(data.error_message || 'Geocoding request was invalid.', { code: 'INVALID_REQUEST', status });
  }
  throw new GoogleMapsError(data.error_message || `Geocoding failed with status ${status}`, { code: 'GOOGLE_MAPS_ERROR', status });
}

/**
 * Geocode a free-text address / place name.
 * @returns live data { address, formatted, lat, lng, placeId, city, state, country, ... }
 */
export async function geocode(address) {
  logger.entry('[PROVIDER:google-geocoding]', 'geocode', { address });
  const started = Date.now();
  if (!isGoogleMapsConfigured()) {
    return unavailable(SOURCE, 'Google Maps API key not configured');
  }
  if (!address || !String(address).trim()) {
    return unavailable(SOURCE, 'Geocoding requires an address');
  }

  const cacheKey = geocodeCacheKey(address);
  const cached = getCachedGeocode(cacheKey);
  if (cached) {
    logger.provider(SOURCE, 'geocode (cached)', { isLive: true, latencyMs: Date.now() - started });
    return live(SOURCE, cached, `Cached geocode for "${address}"`);
  }

  try {
    const data = await googleQueryGet(GOOGLE_URLS.geocode, { address: String(address).trim(), language: 'en' });
    checkGeocodeEnvelope(data);
    const r = data.results?.[0];
    if (!r) return unavailable(SOURCE, `Geocoding failed: no results for "${address}"`);
    const result = mapGeocodeResult(r);
    setCachedGeocode(cacheKey, result);
    logger.provider(SOURCE, 'geocode', { isLive: true, latencyMs: Date.now() - started });
    return live(SOURCE, result, `Live geocode for "${address}"`);
  } catch (err) {
    logger.error(`[PROVIDER:google-geocoding] geocode error: code=${err.code} status=${err.status} ${err.message}`);
    return unavailable(SOURCE, err.code === 'NO_RESULTS' ? `Geocoding failed: no results for "${address}"` : `Live data unavailable: ${err.message}`);
  }
}

/**
 * Reverse geocode a coordinate pair into a human-readable address.
 */
export async function reverseGeocode(lat, lng) {
  logger.entry('[PROVIDER:google-geocoding]', 'reverseGeocode', { lat, lng });
  const started = Date.now();
  if (!isGoogleMapsConfigured()) {
    return unavailable(SOURCE, 'Google Maps API key not configured');
  }
  if (lat == null || lng == null) {
    return unavailable(SOURCE, 'Reverse geocoding requires coordinates');
  }

  const cacheKey = `reverse:${geocodeCoordKey(lat, lng)}`;
  const cached = getCachedGeocode(cacheKey);
  if (cached) {
    logger.provider(SOURCE, 'reverseGeocode (cached)', { isLive: true, latencyMs: Date.now() - started });
    return live(SOURCE, cached, 'Cached reverse geocode');
  }

  try {
    const data = await googleQueryGet(GOOGLE_URLS.reverseGeocode, { latlng: `${lat},${lng}`, language: 'en' });
    checkGeocodeEnvelope(data);
    const r = data.results?.[0];
    if (!r) return unavailable(SOURCE, 'Reverse geocoding returned no results');
    const result = mapGeocodeResult(r);
    setCachedGeocode(cacheKey, result);
    logger.provider(SOURCE, 'reverseGeocode', { isLive: true, latencyMs: Date.now() - started });
    return live(SOURCE, result, 'Live reverse geocode');
  } catch (err) {
    logger.error(`[PROVIDER:google-geocoding] reverseGeocode error: code=${err.code} status=${err.status} ${err.message}`);
    return unavailable(SOURCE, `Live data unavailable: ${err.message}`);
  }
}

/**
 * As-you-type place suggestions ("Nag" → Nagpur) via the Places API (New)
 * Autocomplete endpoint. Suggestions carry place IDs + display text; they
 * intentionally omit coordinates (callers geocode the selected place).
 */
export async function autocomplete(text, { limit = 6, type = '' } = {}) {
  logger.entry('[PROVIDER:google-geocoding]', 'autocomplete', { text, type, limit });
  const started = Date.now();
  if (!isGoogleMapsConfigured()) {
    return unavailable(SOURCE, 'Google Maps API key not configured');
  }
  const q = String(text || '').trim();
  if (q.length < 2) return unavailable(SOURCE, 'Type at least 2 characters');

  const cacheKey = autocompleteCacheKey(q, type, limit);
  const cached = getCachedAutocomplete(cacheKey);
  if (cached) {
    logger.provider(SOURCE, 'autocomplete (cached)', { isLive: true, count: cached.length, latencyMs: Date.now() - started });
    return live(SOURCE, cached, 'Cached suggestions from Google Places');
  }

  try {
    const body = {
      input: q,
      languageCode: 'en',
      // Match old semantics: restrict to a reasonable result window.
      // No lat/lng is attached — the caller geocodes after selection.
    };
    if (type && type !== 'any') body.includedType = type;
    const data = await googlePost(GOOGLE_URLS.placesAutocomplete, body, {
      fieldMask: 'suggestions.placePrediction.placeId,suggestions.placePrediction.text.text,suggestions.placePrediction.structuredFormat.mainText.text,suggestions.placePrediction.structuredFormat.secondaryText.text',
    });
    const suggestions = (data?.suggestions || [])
      .map((s) => {
        const pred = s?.placePrediction || {};
        const main = pred.structuredFormat?.mainText?.text || pred.text?.text || '';
        const secondary = pred.structuredFormat?.secondaryText?.text || '';
        const full = pred.text?.text || [main, secondary].filter(Boolean).join(', ');
        return {
          placeId: pred.placeId || '',
          name: main || full,
          formatted: full,
          // Optional detail lines (city/state/country) are not always split
          // by the API; the formatted secondary text covers them.
          addressLine1: main,
          city: '',
          state: '',
          country: '',
          lat: null,
          lng: null,
          resultType: '',
        };
      })
      .filter((s) => s.placeId)
      .slice(0, Math.min(Number(limit) || 6, 10));
    // A successful query with zero matches is NOT a provider failure — return
    // live data with an empty list so callers can show "no matching places"
    // instead of mislabelling it as live data being unavailable.
    setCachedAutocomplete(cacheKey, suggestions);
    logger.provider(SOURCE, 'autocomplete', { isLive: true, count: suggestions.length, latencyMs: Date.now() - started });
    if (!suggestions.length) return live(SOURCE, [], `No suggestions for "${q}"`);
    return live(SOURCE, suggestions, 'Live suggestions from Google Places');
  } catch (err) {
    logger.error(`[PROVIDER:google-geocoding] autocomplete error: code=${err.code} status=${err.status} ${err.message}`);
    return unavailable(SOURCE, `Live data unavailable: ${err.message}`);
  }
}

export default {
  geocode,
  reverseGeocode,
  autocomplete,
  parseAddressComponents,
  getAutocompleteCacheSize,
  purgeExpiredAutocompleteCache,
  getGeocodeCacheSize,
  purgeExpiredGeocodeCache,
};
