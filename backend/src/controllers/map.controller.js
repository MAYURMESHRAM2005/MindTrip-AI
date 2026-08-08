import ApiResponse from '../utils/ApiResponse.js';
import asyncHandler from '../utils/asyncHandler.js';
import mapsProvider from '../providers/maps.provider.js';
import placesProvider from '../providers/places.provider.js';
import { haversineKm } from '../utils/geo.js';

export const geocode = asyncHandler(async (req, res) => {
  const result = await mapsProvider.geocode(req.query.address);
  res.json(ApiResponse.ok(result.message, { geocode: result.data, isLive: result.isLive }));
});

export const autocomplete = asyncHandler(async (req, res) => {
  const { q, type, limit } = req.query;
  const result = await mapsProvider.autocomplete(q, { type, limit });
  if (!result.isLive) {
    return res.json(ApiResponse.ok(result.message, { suggestions: [], isLive: false, message: result.message }));
  }
  res.json(ApiResponse.ok(result.message, { suggestions: result.data, isLive: true }));
});

export const directions = asyncHandler(async (req, res) => {
  const { origin, destination, mode, alternatives } = req.query;
  // Accept both the URL string form (?alternatives=false) and coerced boolean.
  const wantAlternatives = alternatives !== 'false' && alternatives !== false && alternatives !== '0';
  const result = await mapsProvider.directions(origin, destination, mode, wantAlternatives);

  // When Geoapify is unavailable, provide a straight-line distance estimate,
  // clearly labelled as an approximation.
  if (!result.isLive) {
    const g1 = await mapsProvider.geocode(origin);
    const g2 = await mapsProvider.geocode(destination);
    let fallback = null;
    if (g1.isLive && g2.isLive) {
      const km = haversineKm(g1.data.lat, g1.data.lng, g2.data.lat, g2.data.lng);
      fallback = {
        origin: g1.data,
        destination: g2.data,
        routes: [
          {
            summary: 'Straight-line approximation',
            distanceKm: Math.round(km * 10) / 10,
            durationMin: Math.round((km / 40) * 60),
            trafficAware: false,
            isEstimate: true,
          },
        ],
      };
    }
    return res.json(ApiResponse.ok(result.message, { directions: fallback, isLive: false, message: result.message }));
  }

  res.json(ApiResponse.ok(result.message, { directions: result.data, isLive: true }));
});

/**
 * Nearby points of interest for the Emergency Center and Maps page:
 * hospitals, police, pharmacies, ATMs, transit stations.
 */
export const nearbyPoints = asyncHandler(async (req, res) => {
  const { lat, lng, types, radius } = req.query;
  const typeList = (types || 'hospital,police,pharmacy,atm,transit_station').split(',');
  const results = {};
  let allUnavailable = true;

  // Support all map categories (up to 10) — hotels, restaurants, attractions, etc.
  for (const type of typeList.slice(0, 10)) {
    const r = await placesProvider.nearbySearch({
      lat: Number(lat),
      lng: Number(lng),
      type,
      radius: radius ? Number(radius) : 5000,
      limit: 8,
    });
    results[type] = r.data || [];
    if (r.isLive) allUnavailable = false;
  }

  res.json(
    ApiResponse.ok(allUnavailable ? 'Nearby live data unavailable' : 'Nearby places', {
      results,
      isLive: !allUnavailable,
    })
  );
});

export default { geocode, autocomplete, directions, nearbyPoints };
