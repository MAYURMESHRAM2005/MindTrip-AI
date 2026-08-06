import env from '../config/env.js';
import { live, unavailable, fetchWithTimeout } from './base.provider.js';

const BASE = 'https://maps.googleapis.com/maps/api/place';

function key() {
  return env.GOOGLE_MAPS_API_KEY;
}

const TYPE_MAP = {
  tourist_attraction: 'tourist_attraction',
  restaurant: 'restaurant',
  hotel: 'lodging',
  hospital: 'hospital',
  police: 'police',
  pharmacy: 'pharmacy',
  atm: 'atm',
  transit_station: 'transit_station',
  embassy: 'embassy',
  cafe: 'cafe',
  shopping: 'shopping_mall',
};

function mapResult(p) {
  return {
    placeId: p.place_id,
    name: p.name,
    address: p.formatted_address || p.vicinity || '',
    coordinates: p.geometry?.location
      ? { lat: p.geometry.location.lat, lng: p.geometry.location.lng }
      : null,
    rating: p.rating ?? null,
    userRatingsTotal: p.user_ratings_total ?? null,
    priceLevel: p.price_level ?? null,
    types: p.types || [],
    openNow: p.opening_hours?.open_now ?? null,
    photoRef: p.photos?.[0]?.photo_reference || '',
    distanceMeters: p.distance_meters ?? null,
    businessStatus: p.business_status || '',
    url: p.url || '',
    website: p.website || '',
  };
}

/**
 * Text search - the main search for restaurants, attractions, hotels by keyword.
 */
export async function textSearch({ query, lat, lng, radius = 5000, type = 'tourist_attraction', limit = 10 }) {
  if (!key()) return unavailable('google-places', 'Google Maps (Places) API key not configured');
  try {
    let url = `${BASE}/textsearch/json?query=${encodeURIComponent(query)}&radius=${radius}&key=${key()}`;
    if (type && TYPE_MAP[type]) url += `&type=${TYPE_MAP[type]}`;
    if (lat && lng) url += `&location=${lat},${lng}`;
    const res = await fetchWithTimeout(url);
    const data = await res.json();
    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      return unavailable('google-places', `Places search failed: ${data.status} (${data.error_message || ''})`);
    }
    return live('google-places', (data.results || []).slice(0, limit).map(mapResult), 'Live data from Google Places');
  } catch (err) {
    return unavailable('google-places', `Live data unavailable: ${err.message}`);
  }
}

/**
 * Nearby search - hospitals, police, ATMs, pharmacies, transit near a point.
 */
export async function nearbySearch({ lat, lng, type = 'hospital', radius = 5000, limit = 12 }) {
  if (!key()) return unavailable('google-places', 'Google Maps (Places) API key not configured');
  try {
    const t = TYPE_MAP[type] || type;
    const url = `${BASE}/nearbysearch/json?location=${lat},${lng}&radius=${radius}&type=${t}&key=${key()}`;
    const res = await fetchWithTimeout(url);
    const data = await res.json();
    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      return unavailable('google-places', `Nearby search failed: ${data.status}`);
    }
    return live('google-places', (data.results || []).slice(0, limit).map(mapResult), 'Live data from Google Places');
  } catch (err) {
    return unavailable('google-places', `Live data unavailable: ${err.message}`);
  }
}

export async function placeDetails(placeId) {
  if (!key()) return unavailable('google-places', 'Google Maps (Places) API key not configured');
  try {
    const url = `${BASE}/details/json?place_id=${encodeURIComponent(placeId)}&fields=name,formatted_address,geometry,rating,user_ratings_total,price_level,website,url,opening_hours,photos,international_phone_number,types&key=${key()}`;
    const res = await fetchWithTimeout(url);
    const data = await res.json();
    if (data.status !== 'OK') return unavailable('google-places', `Place details failed: ${data.status}`);
    return live('google-places', mapResult(data.result));
  } catch (err) {
    return unavailable('google-places', `Live data unavailable: ${err.message}`);
  }
}

export function photoUrl(photoRef, maxWidth = 600) {
  if (!key() || !photoRef) return '';
  return `${BASE}/photo?maxwidth=${maxWidth}&photo_reference=${encodeURIComponent(photoRef)}&key=${key()}`;
}

export default { textSearch, nearbySearch, placeDetails, photoUrl, mapResult };
