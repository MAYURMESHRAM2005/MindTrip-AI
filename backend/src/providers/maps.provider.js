import env from '../config/env.js';
import { live, unavailable, axiosGet, axiosPost } from './base.provider.js';
import logger from '../utils/logger.js';

/**
 * Geoapify maps provider.
 * Geocoding, Routing and Matrix APIs from api.geoapify.com.
 * Same function signatures as the old Google provider, so controllers and
 * AI agents keep working unchanged.
 */

const GEOCODE_URL = 'https://api.geoapify.com/v1/geocode/search';
const AUTOCOMPLETE_URL = 'https://api.geoapify.com/v1/geocode/autocomplete';
const ROUTE_URL = 'https://api.geoapify.com/v1/routing';
const MATRIX_URL = 'https://api.geoapify.com/v1/matrix';

function key() {
  return env.GEOAPIFY_API_KEY;
}

const MODE_MAP = {
  driving: 'drive',
  walking: 'walk',
  bicycling: 'bicycle',
  transit: 'transit',
  drive: 'drive',
  walk: 'walk',
  bicycle: 'bicycle',
};

const COORD_RE = /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/;

/* ---------- polyline helpers (5th precision, Leaflet-compatible) ---------- */

function decodePolyline(encoded) {
  const points = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let b;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dLat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dLat;
    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dLng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += dLng;
    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

function encodePolyline(points) {
  let str = '';
  let prevLat = 0;
  let prevLng = 0;
  const enc = (v) => {
    let r = v < 0 ? ~(v << 1) : v << 1;
    let out = '';
    while (r >= 0x20) {
      out += String.fromCharCode((0x20 | (r & 0x1f)) + 63);
      r >>= 5;
    }
    out += String.fromCharCode(r + 63);
    return out;
  };
  for (const [lat, lng] of points) {
    str += enc(Math.round((lat - prevLat) * 1e5));
    str += enc(Math.round((lng - prevLng) * 1e5));
    prevLat = lat;
    prevLng = lng;
  }
  return str;
}

/** GeoJSON geometry (or encoded polyline string) → [[lat, lng], ...] */
function geometryToLatLngs(geometry) {
  if (!geometry) return [];
  if (typeof geometry === 'string') return decodePolyline(geometry).map(([lat, lng]) => [lat, lng]);
  const coords = geometry.coordinates || [];
  if (geometry.type === 'MultiLineString') {
    return coords.flatMap((line) => line.map(([lng, lat]) => [lat, lng]));
  }
  return coords.map(([lng, lat]) => [lat, lng]);
}

/* ------------------------------- helpers -------------------------------- */

async function apiGet(url, params) {
  const qs = new URLSearchParams({ apiKey: key(), ...params });
  return axiosGet(`${url}?${qs}`, {}, 8000);
}

function parseCoordString(s) {
  const [lat, lng] = String(s).split(',').map(Number);
  return { lat, lng };
}

/** Accept "lat,lng" strings directly, geocode anything else. */
async function resolveCoordinates(place) {
  if (COORD_RE.test(String(place).trim())) return parseCoordString(place);
  const g = await geocode(place);
  return g.isLive ? g.data : null;
}

/* -------------------------------- exports -------------------------------- */

export async function geocode(address) {
  logger.entry('[PROVIDER:maps]', 'geocode', { address });
  const started = Date.now();
  if (!key()) return unavailable('geoapify', 'Geoapify API key not configured');
  try {
    const data = await apiGet(GEOCODE_URL, { text: address, limit: 1, format: 'json', lang: 'en' });
    const r = data?.results?.[0];
    if (!r) return unavailable('geoapify', `Geocoding failed: no results for "${address}"`);
    logger.provider('geoapify', 'geocode', { isLive: true, latencyMs: Date.now() - started });
    return live('geoapify', {
      address: r.formatted || r.address_line1 || address,
      lat: r.lat,
      lng: r.lon,
      placeId: r.place_id || '',
    });
  } catch (err) {
    logger.error(`[PROVIDER:maps] geocode error: ${err.message}`);
    return unavailable('geoapify', `Live data unavailable: ${err.message}`);
  }
}

/**
 * As-you-type place suggestions ("Nag" → Nagpur) via the Geoapify autocomplete
 * endpoint. Used by city/place inputs across the app.
 */
export async function autocomplete(text, { limit = 6, type = '' } = {}) {
  if (!key()) return unavailable('geoapify', 'Geoapify API key not configured');
  const q = String(text || '').trim();
  if (q.length < 2) return unavailable('geoapify', 'Type at least 2 characters');
  try {
    const params = {
      text: q,
      limit: Math.min(Number(limit) || 6, 10),
      format: 'json',
      lang: 'en',
    };
    if (type) params.type = type;
    const data = await apiGet(AUTOCOMPLETE_URL, params);
    const results = (data?.results || []).map((r) => ({
      placeId: r.place_id || '',
      name: r.name || r.city || r.state || r.formatted || '',
      formatted: r.formatted || '',
      addressLine1: r.address_line1 || '',
      city: r.city || '',
      state: r.state || '',
      country: r.country || '',
      lat: r.lat != null ? r.lat : null,
      lng: r.lon != null ? r.lon : null,
      resultType: r.result_type || '',
    }));
    if (!results.length) return unavailable('geoapify', `No suggestions for "${q}"`);
    return live('geoapify', results, 'Live suggestions from Geoapify');
  } catch (err) {
    return unavailable('geoapify', `Live data unavailable: ${err.message}`);
  }
}

export async function directions(origin, destination, mode = 'driving', alternatives = true) {
  logger.entry('[PROVIDER:maps]', 'directions', { origin, destination, mode, alternatives });
  const started = Date.now();
  if (!key()) return unavailable('geoapify', 'Geoapify API key not configured');
  try {
    const o = await resolveCoordinates(origin);
    const d = await resolveCoordinates(destination);
    if (!o || !d) {
      return unavailable('geoapify', 'Directions failed: could not geocode origin/destination');
    }
    const params = {
      waypoints: `${o.lat},${o.lng}|${d.lat},${d.lng}`,
      mode: MODE_MAP[mode] || 'drive',
      units: 'metric',
      format: 'geojson',
      details: 'instruction_details',
      steps: true,
    };
    if (alternatives) params.alternatives = 2;
    const data = await apiGet(ROUTE_URL, params);
    const features = data?.features || [];
    if (!features.length) {
      return unavailable('geoapify', `Directions failed: ${data.message || 'no routes found'}`);
    }
    const routes = features.map((f) => {
      const props = f.properties || {};
      return {
        summary: props.mode ? `${props.mode} route` : 'Geoapify route',
        distanceKm: Math.round((props.distance || 0) / 1000),
        durationMin: Math.round((props.time || 0) / 60),
        trafficAware: false,
        polyline: encodePolyline(geometryToLatLngs(f.geometry)),
        steps: (props.legs?.[0]?.steps || []).slice(0, 30).map((s) => ({
          instruction: s.instruction || '',
          distanceKm: Math.round((s.distance || 0) / 1000),
          durationMin: Math.round((s.time || 0) / 60),
        })),
      };
    });
    logger.provider('geoapify', 'directions', { isLive: true, routeCount: routes.length, latencyMs: Date.now() - started });
    return live('geoapify', { origin, destination, mode, routes, originPoint: o, destinationPoint: d });
  } catch (err) {
    logger.error(`[PROVIDER:maps] directions error: ${err.message}`);
    return unavailable('geoapify', `Live data unavailable: ${err.message}`);
  }
}

export async function distanceMatrix(origins, destinations, mode = 'driving') {
  if (!key()) return unavailable('geoapify', 'Geoapify API key not configured');
  try {
    const resolveMany = async (list) => {
      const out = [];
      for (const item of list) {
        const c = await resolveCoordinates(item);
        out.push(c ? { location: [c.lng, c.lat] } : null);
      }
      return out;
    };
    const sources = await resolveMany(origins);
    const targets = await resolveMany(destinations);
    if (sources.some((s) => !s) || targets.some((t) => !t)) {
      return unavailable('geoapify', 'Matrix failed: could not geocode all points');
    }
    const data = await axiosPost(
      MATRIX_URL,
      { mode: MODE_MAP[mode] || 'drive', sources, targets, units: 'metric' },
      { params: { apiKey: key() } },
      10000
    );
    const matrix = data?.sources_to_targets || [];
    return live('geoapify', {
      rows: matrix.map((row) =>
        (row || []).map((el) => ({
          status: el && el.time != null ? 'OK' : 'NOT_FOUND',
          distanceKm: el && el.distance != null ? Math.round(el.distance / 1000) : null,
          durationMin: el && el.time != null ? Math.round(el.time / 60) : null,
          durationInTrafficMin: null,
        }))
      ),
    });
  } catch (err) {
    return unavailable('geoapify', `Live data unavailable: ${err.message}`);
  }
}

/** Geoapify static maps require billing; the UI uses Leaflet + OSM tiles. */
export function staticMapUrl() {
  return '';
}

export default { geocode, autocomplete, directions, distanceMatrix, staticMapUrl };
