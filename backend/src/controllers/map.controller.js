import ApiResponse from '../utils/ApiResponse.js';
import asyncHandler from '../utils/asyncHandler.js';
import geocodeProvider from '../providers/googleGeocoding.provider.js';
import routesProvider from '../providers/googleRoutes.provider.js';
import placesProvider from '../providers/googlePlaces.provider.js';
import { haversineKm } from '../utils/geo.js';

export const geocode = asyncHandler(async (req, res) => {
  const result = await geocodeProvider.geocode(req.query.address);
  // Always include the provider message in the payload: clients show the real
  // failure reason (e.g. billing/permission denied) instead of guessing from
  // isLive alone and reporting a generic "no results found".
  res.json(ApiResponse.ok(result.message, {
    geocode: result.data,
    isLive: result.isLive,
    message: result.message,
  }));
});

export const autocomplete = asyncHandler(async (req, res) => {
  const { q, type, limit } = req.query;
  const result = await geocodeProvider.autocomplete(q, { type, limit });
  if (!result.isLive) {
    return res.json(ApiResponse.ok(result.message, { suggestions: [], isLive: false, message: result.message }));
  }
  res.json(ApiResponse.ok(result.message, { suggestions: result.data, isLive: true }));
});

export const directions = asyncHandler(async (req, res) => {
  const { origin, destination, mode, alternatives } = req.query;
  // Accept both the URL string form (?alternatives=false) and coerced boolean.
  const wantAlternatives = alternatives !== 'false' && alternatives !== false && alternatives !== '0';
  const result = await routesProvider.directions(origin, destination, mode, wantAlternatives);

  // When routing is unavailable, provide a straight-line distance estimate,
  // clearly labelled as an approximation.
  if (!result.isLive) {
    const g1 = await geocodeProvider.geocode(origin);
    const g2 = await geocodeProvider.geocode(destination);
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
  // Collect the real failure reasons so an all-failed search surfaces the
  // actual cause (e.g. billing / permission denied) instead of a generic
  // "no nearby places" message.
  const failureReasons = new Set();

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
    if (r.isLive) {
      allUnavailable = false;
    } else if (r.message && !/no results|no nearby/i.test(r.message)) {
      failureReasons.add(r.message.replace(/^Live data unavailable: /, ''));
    }
  }

  const summary = allUnavailable
    ? `Live data unavailable${failureReasons.size ? `: ${[...failureReasons][0]}` : ''}`
    : 'Nearby places';

  res.json(
    ApiResponse.ok(summary, {
      results,
      isLive: !allUnavailable,
      message: summary,
    })
  );
});

export default { geocode, autocomplete, directions, nearbyPoints };
