import {
  GOOGLE_URLS,
  isGoogleMapsConfigured,
  googlePost,
} from '../config/googleMaps.js';
import { live, unavailable } from './base.provider.js';
import logger from '../utils/logger.js';
import { geocode } from './googleGeocoding.provider.js';

/**
 * Google Routes provider.
 *
 * Real driving / walking / bicycling / transit routes, distances and
 * durations from the Routes API. Travel estimates are real route
 * calculations — never invented numbers.
 *
 * Normalized route shape:
 *   { origin, destination, distanceMeters, durationSeconds, distanceKm,
 *     durationMin, polyline, travelMode, steps, dataStatus: 'live' }
 */

const SOURCE = 'google-routes';

// ── Short-lived route cache ───────────────────────────────────────────
// The trip pipeline asks for the SAME pairs repeatedly: prefetchActivityRoutes,
// the traffic agent, transport-intelligence ground transfers, and the Maps page
// can all request "hotel ↔ attraction" or "origin → destination". Traffic-aware
// routes are stable over minutes, so a 15-minute cache safely collapses
// duplicates into a single Routes API call.
const ROUTES_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const ROUTES_CACHE_MAX = 400;
const routesCache = new Map(); // key → { data, expiresAt }

function coordStr(p) {
  return p ? `${Number(p.lat).toFixed(6)},${Number(p.lng).toFixed(6)}` : '';
}

function getCachedRoute(key) {
  const entry = routesCache.get(key);
  if (entry && Date.now() < entry.expiresAt) return entry.data;
  if (entry) routesCache.delete(key); // expired
  return null;
}

function setCachedRoute(key, data) {
  routesCache.set(key, { data, expiresAt: Date.now() + ROUTES_CACHE_TTL_MS });
  if (routesCache.size > ROUTES_CACHE_MAX) {
    const oldest = routesCache.keys().next().value;
    if (oldest) routesCache.delete(oldest);
  }
}

/** Current route cache size (for logging/tests). */
export function getRoutesCacheSize() {
  return routesCache.size;
}

/** Drop expired entries (safe to call periodically). */
export function purgeExpiredRoutesCache() {
  const now = Date.now();
  for (const [key, entry] of routesCache) {
    if (now >= entry.expiresAt) routesCache.delete(key);
  }
}

const TRAVEL_MODE_MAP = {
  driving: 'DRIVE',
  drive: 'DRIVE',
  walking: 'WALK',
  walk: 'WALK',
  bicycling: 'BICYCLE',
  bicycle: 'BICYCLE',
  transit: 'TRANSIT',
};

const COORD_RE = /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/;

function parseCoordString(s) {
  const [lat, lng] = String(s).split(',').map(Number);
  return { lat, lng };
}

/** Accept "lat,lng" strings directly, geocode anything else (Google Geocoding). */
async function resolveCoordinates(place) {
  if (place && typeof place === 'object' && place.lat != null && place.lng != null) {
    return { lat: Number(place.lat), lng: Number(place.lng) };
  }
  if (COORD_RE.test(String(place).trim())) return parseCoordString(place);
  const g = await geocode(place);
  return g.isLive ? { lat: g.data.lat, lng: g.data.lng } : null;
}

/** Parse a Google "493s" duration string into seconds. */
function parseDurationSeconds(value) {
  if (value == null) return 0;
  if (typeof value === 'number') return Math.round(value);
  const m = String(value).match(/([\d.]+)s/);
  return m ? Math.round(Number(m[1])) : 0;
}

/** Field mask for computeRoutes responses. */
// Note: Routes API v2 steps expose staticDuration (not duration) — requesting
// routes.legs.steps.duration makes Google reject the request with a 400
// INVALID_ARGUMENT before any key/restriction checks run.
const ROUTES_FIELD_MASK =
  'routes.duration,routes.distanceMeters,routes.polyline,routes.legs.steps.navigationInstruction,' +
  'routes.legs.steps.polyline,routes.legs.steps.distanceMeters,routes.legs.steps.staticDuration,' +
  'routes.legs.distanceMeters,routes.legs.duration';

/**
 * Directions between two points.
 *
 * @param {string|object} origin - "lat,lng", address, or { lat, lng }
 * @param {string|object} destination
 * @param {string} [mode='driving'] - driving|walking|bicycling|transit
 * @param {boolean} [alternatives=true]
 * @returns live data { origin, destination, mode, routes, originPoint, destinationPoint }
 */
export async function directions(origin, destination, mode = 'driving', alternatives = true) {
  logger.entry('[PROVIDER:google-routes]', 'directions', { origin, destination, mode, alternatives });
  const started = Date.now();
  if (!isGoogleMapsConfigured()) return unavailable(SOURCE, 'Google Maps API key not configured');
  const travelMode = TRAVEL_MODE_MAP[mode] || 'DRIVE';
  try {
    const o = await resolveCoordinates(origin);
    const d = await resolveCoordinates(destination);
    if (!o || !d) {
      return unavailable(SOURCE, 'Directions failed: could not geocode origin/destination');
    }

    const cacheKey = `${coordStr(o)}|${coordStr(d)}|${travelMode}|${alternatives ? 1 : 0}`;
    const cached = getCachedRoute(cacheKey);
    if (cached) {
      logger.provider(SOURCE, 'directions (cached)', { isLive: true, routeCount: cached.routes?.length, latencyMs: Date.now() - started });
      return live(SOURCE, cached, 'Cached driving directions');
    }

    const body = {
      origin: { location: { latLng: { latitude: o.lat, longitude: o.lng } } },
      destination: { location: { latLng: { latitude: d.lat, longitude: d.lng } } },
      travelMode,
      units: 'METRIC',
      languageCode: 'en',
      computeAlternativeRoutes: Boolean(alternatives),
      polylineEncoding: 'ENCODED_POLYLINE',
    };
    // Traffic-aware duration only applies to driving.
    if (travelMode === 'DRIVE') body.routingPreference = 'TRAFFIC_AWARE';

    const data = await googlePost(GOOGLE_URLS.computeRoutes, body, { fieldMask: ROUTES_FIELD_MASK });
    const googleRoutes = data?.routes || [];
    if (!googleRoutes.length) {
      return unavailable(SOURCE, 'Directions failed: no routes found');
    }
    const routes = googleRoutes.map((r) => {
      const leg = r.legs?.[0] || {};
      const durationSeconds = parseDurationSeconds(r.duration || leg.duration);
      const distanceMeters = Number(r.distanceMeters ?? leg.distanceMeters ?? 0);
      const steps = (leg.steps || []).slice(0, 30).map((s) => ({
        instruction: s.navigationInstruction?.instructions || '',
        distanceKm: Math.round((Number(s.distanceMeters) || 0) / 1000),
        durationMin: Math.round(parseDurationSeconds(s.staticDuration || s.duration) / 60),
      }));
      return {
        summary: travelMode === 'DRIVE' ? 'Driving route' : `${travelMode.toLowerCase()} route`,
        travelMode,
        distanceMeters,
        distanceKm: Math.round(distanceMeters / 1000),
        durationSeconds,
        durationMin: Math.round(durationSeconds / 60),
        trafficAware: travelMode === 'DRIVE',
        polyline: r.polyline?.encodedPolyline || '',
        steps,
        dataStatus: 'live',
        source: SOURCE,
      };
    });
    const payload = {
      origin,
      destination,
      mode: travelMode.toLowerCase(),
      travelMode,
      routes,
      originPoint: o,
      destinationPoint: d,
    };
    setCachedRoute(cacheKey, payload);
    logger.provider(SOURCE, 'directions', { isLive: true, routeCount: routes.length, latencyMs: Date.now() - started });
    return live(SOURCE, payload);
  } catch (err) {
    logger.error(`[PROVIDER:google-routes] directions error: ${err.message}`);
    return unavailable(SOURCE, `Live data unavailable: ${err.message}`);
  }
}

const MATRIX_FIELD_MASK = 'originIndex,destinationIndex,duration,distanceMeters,condition';

/**
 * Distance matrix between origin and destination lists (Routes API
 * computeRouteMatrix). Used by the traffic agent / transport intelligence
 * for real travel estimates between many points.
 *
 * @returns live data { rows: [[{ status, distanceKm, durationMin, durationInTrafficMin }]] }
 */
export async function distanceMatrix(origins, destinations, mode = 'driving') {
  logger.entry('[PROVIDER:google-routes]', 'distanceMatrix', { originsCount: origins?.length, destinationsCount: destinations?.length, mode });
  const started = Date.now();
  if (!isGoogleMapsConfigured()) return unavailable(SOURCE, 'Google Maps API key not configured');
  const travelMode = TRAVEL_MODE_MAP[mode] || 'DRIVE';
  try {
    const resolveMany = async (list) => {
      const out = [];
      for (const item of list || []) {
        const c = await resolveCoordinates(item);
        out.push(c ? { waypoint: { location: { latLng: { latitude: c.lat, longitude: c.lng } } } } : null);
      }
      return out;
    };
    const sources = await resolveMany(origins);
    const targets = await resolveMany(destinations);
    if (!sources.length || !targets.length || sources.some((s) => !s) || targets.some((t) => !t)) {
      return unavailable(SOURCE, 'Matrix failed: could not geocode all points');
    }

    const matrixKey = `${JSON.stringify(sources)}|${JSON.stringify(targets)}|${travelMode}`;
    const cachedMatrix = getCachedRoute(matrixKey);
    if (cachedMatrix) {
      logger.provider(SOURCE, 'distanceMatrix (cached)', { isLive: true, latencyMs: Date.now() - started });
      return live(SOURCE, cachedMatrix, 'Cached route matrix');
    }

    const body = {
      origins: sources,
      destinations: targets,
      travelMode,
      units: 'METRIC',
    };
    if (travelMode === 'DRIVE') body.routingPreference = 'TRAFFIC_AWARE';
    const data = await googlePost(GOOGLE_URLS.computeRouteMatrix, body, { fieldMask: MATRIX_FIELD_MASK });
    const elements = Array.isArray(data) ? data : [];

    // computeRouteMatrix returns a flat array; fold into rows[n][m].
    const rows = [];
    for (const el of elements) {
      const oi = el.originIndex ?? 0;
      const di = el.destinationIndex ?? 0;
      if (!rows[oi]) rows[oi] = [];
      const ok = el.condition !== 'ROUTE_NOT_FOUND';
      const seconds = parseDurationSeconds(el.duration);
      rows[oi][di] = {
        status: ok ? 'OK' : 'NOT_FOUND',
        distanceKm: el.distanceMeters != null ? Math.round(Number(el.distanceMeters) / 1000) : null,
        durationMin: ok ? Math.round(seconds / 60) : null,
        durationInTrafficMin: travelMode === 'DRIVE' ? Math.round(seconds / 60) : null,
      };
    }
    // Fill any missing cells (a failure element shouldn't leave gaps).
    for (let i = 0; i < (origins || []).length; i++) {
      if (!rows[i]) rows[i] = [];
      for (let j = 0; j < (destinations || []).length; j++) {
        if (!rows[i][j]) {
          rows[i][j] = { status: 'NOT_FOUND', distanceKm: null, durationMin: null, durationInTrafficMin: null };
        }
      }
    }
    const payload = { rows };
    setCachedRoute(matrixKey, payload);
    logger.provider(SOURCE, 'distanceMatrix', { isLive: true, latencyMs: Date.now() - started });
    return live(SOURCE, payload);
  } catch (err) {
    logger.error(`[PROVIDER:google-routes] distanceMatrix error: ${err.message}`);
    return unavailable(SOURCE, `Live data unavailable: ${err.message}`);
  }
}

export default {
  directions,
  distanceMatrix,
  getRoutesCacheSize,
  purgeExpiredRoutesCache,
};
