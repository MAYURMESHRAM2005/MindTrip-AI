import { geocodeApi, routesApi, mapsApi } from './apiClient';

/**
 * Frontend maps service — a thin proxy over the backend.
 *
 * All Geoapify calls (geocoding, routing, nearby places) happen on the
 * backend via /api/geocode, /api/routes and /api/maps/nearby. The frontend
 * never talks to Geoapify directly and never holds an API key.
 *
 * Every method resolves to a normalized shape and never rejects for
 * provider/network failures — the UI decides what to show.
 */

/** Map Geoapify-style mode names to the backend's validated route modes. */
const MODE_MAP = {
  drive: 'driving',
  driving: 'driving',
  walk: 'walking',
  walking: 'walking',
  bicycle: 'bicycling',
  bicycling: 'bicycling',
  transit: 'transit',
};

export const NEARBY_CATEGORIES = [
  { key: 'hotel', label: 'Hotels', color: '#6366f1', categories: 'accommodation.hotel' },
  { key: 'restaurant', label: 'Restaurants', color: '#f43f5e', categories: 'catering.restaurant' },
  { key: 'tourist_attraction', label: 'Tourist attractions', color: '#f59e0b', categories: 'tourism.sights,tourism.attraction,tourism.monument' },
  { key: 'hospital', label: 'Hospitals', color: '#ef4444', categories: 'healthcare.hospital' },
  { key: 'police', label: 'Police', color: '#3b82f6', categories: 'amenity.police' },
  { key: 'atm', label: 'ATMs', color: '#10b981', categories: 'finance.atm' },
  { key: 'pharmacy', label: 'Pharmacies', color: '#a855f7', categories: 'healthcare.pharmacy' },
  { key: 'transit_station', label: 'Transit stations', color: '#14b8a6', categories: 'public_transport' },
];

/** Keys are stored server-side only — the backend owns all Geoapify calls. */
export function geoapifyConfigured() {
  return true;
}

function errMessage(err, fallback) {
  return err?.response?.data?.message || err?.message || fallback;
}

/** Decode an encoded polyline into [[lat, lng], ...] pairs. */
function decodePolyline(encoded) {
  if (!encoded) return [];
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

/**
 * Geocode a free-text address → { lat, lng, address, placeId, isLive }.
 * Resolved by the backend through Geoapify.
 */
export async function geocode(address) {
  if (!address?.trim()) return { isLive: false, message: 'Enter a location to search' };
  try {
    const { data } = await geocodeApi.geocode(address);
    const payload = data?.data;
    if (!payload?.isLive || !payload.geocode) {
      return { isLive: false, message: payload?.message || `No results found for "${address}"` };
    }
    const g = payload.geocode;
    return {
      isLive: true,
      lat: g.lat,
      lng: g.lng,
      address: g.address || address,
      placeId: g.placeId || '',
    };
  } catch (err) {
    return { isLive: false, message: errMessage(err, 'Geocoding failed') };
  }
}

async function toCoords(point) {
  if (point && typeof point === 'object' && point.lat != null && point.lng != null) return point;
  if (typeof point === 'string') {
    const t = point.trim();
    if (/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(t)) {
      const [lat, lng] = t.split(',').map(Number);
      return { lat, lng };
    }
    const g = await geocode(t);
    return g.isLive ? g : null;
  }
  return null;
}

/**
 * Route between two points → { distanceKm, durationMin, route: [[lat,lng],...],
 * originPoint, destinationPoint, isLive }. Accepts "lat,lng" strings or addresses.
 */
export async function getRoute(origin, destination, mode = 'drive') {
  try {
    const o = await toCoords(origin);
    const d = await toCoords(destination);
    const { data } = await routesApi.directions({
      origin: o ? `${o.lat},${o.lng}` : origin,
      destination: d ? `${d.lat},${d.lng}` : destination,
      mode: MODE_MAP[mode] || 'driving',
      alternatives: false,
    });
    const payload = data?.data;
    const directions = payload?.directions;
    const first = directions?.routes?.[0];
    if (!payload?.isLive || !first) {
      return { isLive: false, message: payload?.message || 'No route found' };
    }
    return {
      isLive: true,
      distanceMeters: first.distanceKm != null ? first.distanceKm * 1000 : null,
      distanceKm: first.distanceKm ?? null,
      durationMin: first.durationMin ?? null,
      route: decodePolyline(first.polyline || ''),
      originPoint: directions.originPoint || o,
      destinationPoint: directions.destinationPoint || d,
    };
  } catch (err) {
    return { isLive: false, message: errMessage(err, 'Routing failed') };
  }
}

/**
 * Nearby places grouped by category → { results: { [key]: [...] }, isLive, message }.
 * Each category is resolved server-side; one failure never blocks the others.
 */
export async function getNearby({ lat, lng, radius = 6000 }) {
  if (lat == null || lng == null) {
    return { results: {}, isLive: false, message: 'Missing coordinates for nearby search' };
  }
  try {
    const types = NEARBY_CATEGORIES.map((c) => c.key).join(',');
    const { data } = await mapsApi.nearby({ lat, lng, radius, types });
    const payload = data?.data;
    const results = payload?.results || {};
    const anyLive = Boolean(payload?.isLive);
    return {
      results,
      isLive: anyLive,
      message: anyLive ? '' : (payload?.message || 'Nearby live data unavailable'),
    };
  } catch (err) {
    return { results: {}, isLive: false, message: errMessage(err, 'Nearby search failed') };
  }
}

export const geoapifyService = { geocode, getRoute, getNearby, geoapifyConfigured, NEARBY_CATEGORIES };

export default geoapifyService;
