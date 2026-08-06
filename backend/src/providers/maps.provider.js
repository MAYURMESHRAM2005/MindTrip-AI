import env from '../config/env.js';
import { live, unavailable, fetchWithTimeout } from './base.provider.js';

const BASE = 'https://maps.googleapis.com/maps/api';

function key() {
  return env.GOOGLE_MAPS_API_KEY;
}

export async function geocode(address) {
  if (!key()) return unavailable('google-maps', 'Google Maps API key not configured');
  try {
    const url = `${BASE}/geocode/json?address=${encodeURIComponent(address)}&key=${key()}`;
    const res = await fetchWithTimeout(url);
    const data = await res.json();
    if (data.status !== 'OK' || !data.results?.length) {
      return unavailable('google-maps', `Geocoding failed: ${data.status} (${data.error_message || ''})`);
    }
    const r = data.results[0];
    return live('google-maps', {
      address: r.formatted_address,
      lat: r.geometry.location.lat,
      lng: r.geometry.location.lng,
      placeId: r.place_id,
    });
  } catch (err) {
    return unavailable('google-maps', `Live data unavailable: ${err.message}`);
  }
}

export async function directions(origin, destination, mode = 'driving', alternatives = true) {
  if (!key()) return unavailable('google-maps', 'Google Maps API key not configured');
  try {
    const url = `${BASE}/directions/json?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(
      destination
    )}&mode=${mode}&alternatives=${alternatives}&key=${key()}`;
    const res = await fetchWithTimeout(url);
    const data = await res.json();
    if (data.status !== 'OK') {
      return unavailable('google-maps', `Directions failed: ${data.status}`);
    }
    const routes = data.routes.map((route) => ({
      summary: route.summary,
      distanceKm: Math.round((route.legs?.[0]?.distance?.value || 0) / 1000),
      durationMin: Math.round((route.legs?.[0]?.duration?.value || 0) / 60),
      trafficAware: data.routes[0]?.legs?.[0]?.duration_in_traffic != null,
      polyline: route.overview_polyline?.points || '',
      steps: (route.legs?.[0]?.steps || []).slice(0, 30).map((s) => ({
        instruction: s.html_instructions?.replace(/<[^>]*>/g, '') || '',
        distanceKm: Math.round((s.distance?.value || 0) / 1000),
        durationMin: Math.round((s.duration?.value || 0) / 60),
      })),
    }));
    return live('google-maps', { origin, destination, mode, routes });
  } catch (err) {
    return unavailable('google-maps', `Live data unavailable: ${err.message}`);
  }
}

export async function distanceMatrix(origins, destinations, mode = 'driving') {
  if (!key()) return unavailable('google-maps', 'Google Maps API key not configured');
  try {
    const url = `${BASE}/distancematrix/json?origins=${encodeURIComponent(
      origins.join('|')
    )}&destinations=${encodeURIComponent(destinations.join('|'))}&mode=${mode}&key=${key()}`;
    const res = await fetchWithTimeout(url);
    const data = await res.json();
    if (data.status !== 'OK') return unavailable('google-maps', `Distance Matrix failed: ${data.status}`);
    return live('google-maps', {
      rows: (data.rows || []).map((row) =>
        (row.elements || []).map((el) => ({
          status: el.status,
          distanceKm: el.distance ? Math.round(el.distance.value / 1000) : null,
          durationMin: el.duration ? Math.round(el.duration.value / 60) : null,
          durationInTrafficMin: el.duration_in_traffic ? Math.round(el.duration_in_traffic.value / 60) : null,
        }))
      ),
    });
  } catch (err) {
    return unavailable('google-maps', `Live data unavailable: ${err.message}`);
  }
}

export function staticMapUrl({ lat, lng, zoom = 13, size = '600x300', markers = [] }) {
  if (!key()) return '';
  const parts = [`${BASE}/staticmap?center=${lat},${lng}&zoom=${zoom}&size=${size}&key=${key()}`];
  markers.slice(0, 20).forEach((m, i) => {
    parts.push(`&markers=color:${m.color || 'red'}|${m.lat},${m.lng}`);
  });
  return parts.join('');
}

export default { geocode, directions, distanceMatrix, staticMapUrl };
