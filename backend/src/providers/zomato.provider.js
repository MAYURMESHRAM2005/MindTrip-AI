import env from '../config/env.js';
import { live, unavailable, axiosGet } from './base.provider.js';
import logger from '../utils/logger.js';

/**
 * Zomato Restaurant Data provider via RapidAPI.
 * Provides real restaurant ratings, average meal costs, review counts, and cuisines.
 *
 * Replaces the hardcoded RESTAURANT_PRICE_BY_LEVEL estimates with real data.
 *
 * Env vars:
 *   ZOMATO_RAPIDAPI_KEY  — RapidAPI key for Zomato API
 *   ZOMATO_RAPIDAPI_HOST — RapidAPI host (default: zomato4.p.rapidapi.com)
 *
 * The Zomato API on RapidAPI exposes:
 *   GET /api/v2.1/search — search restaurants by query/city/location
 *   Response includes: name, cuisines, average_cost_for_two, rating, votes, location
 */

const RAPIDAPI_HOST_DEFAULT = 'zomato4.p.rapidapi.com';
const BASE_URL_DEFAULT = 'https://zomato4.p.rapidapi.com';

function apiKey() {
  return env.ZOMATO_RAPIDAPI_KEY;
}

function host() {
  return env.ZOMATO_RAPIDAPI_HOST || RAPIDAPI_HOST_DEFAULT;
}

function baseUrl() {
  return `https://${host()}`;
}

function headers() {
  return {
    'x-rapidapi-key': apiKey(),
    'x-rapidapi-host': host(),
  };
}

/**
 * Search for restaurants by destination/city name.
 *
 * @param {object} opts
 * @param {string} opts.destination — City or area name (e.g., "Goa", "Paris")
 * @param {string} opts.cuisine — Optional cuisine filter (e.g., "Italian", "Indian")
 * @param {number} opts.limit — Max results (default 20)
 * @returns {{ success, isLive, data, message, source }}
 */
export async function searchRestaurants({ destination, cuisine, limit = 20 }) {
  logger.entry('[PROVIDER:zomato]', 'searchRestaurants', { destination, cuisine, limit });
  const started = Date.now();

  if (!apiKey()) {
    return unavailable('zomato', 'Zomato API key not configured');
  }

  try {
    const params = {
      q: cuisine ? `${cuisine} restaurants in ${destination}` : `best restaurants in ${destination}`,
      lat: '',
      lon: '',
      count: Math.min(Number(limit) || 20, 20).toString(),
    };

    const data = await axiosGet(
      `${baseUrl()}/api/v2.1/search`,
      params,
      { headers: headers() },
      10000
    );

    const restaurants = [];
    const rawRestaurants = data?.restaurants || data?.results_found || [];

    for (const item of rawRestaurants) {
      const r = item.restaurant || item;
      restaurants.push(mapRestaurant(r));
    }

    const filtered = restaurants.filter(Boolean).slice(0, limit);

    logger.provider('zomato', 'searchRestaurants', {
      isLive: true,
      count: filtered.length,
      latencyMs: Date.now() - started,
    });

    return live('zomato', filtered, `Live restaurant data from Zomato (${filtered.length} options)`);
  } catch (err) {
    logger.error(`[PROVIDER:zomato] searchRestaurants error: ${err.message}`);
    return unavailable('zomato', `Live data unavailable: ${err.message}`);
  }
}

/**
 * Search for restaurants near specific coordinates.
 *
 * @param {object} opts
 * @param {number} opts.lat — Latitude
 * @param {number} opts.lng — Longitude
 * @param {number} opts.radius — Search radius in meters (default 5000)
 * @param {number} opts.limit — Max results (default 15)
 * @returns {{ success, isLive, data, message, source }}
 */
export async function searchNearby({ lat, lng, radius = 5000, limit = 15 }) {
  logger.entry('[PROVIDER:zomato]', 'searchNearby', { lat, lng, radius, limit });
  const started = Date.now();

  if (!apiKey()) {
    return unavailable('zomato', 'Zomato API key not configured');
  }

  try {
    const params = {
      q: '',
      lat: String(lat),
      lon: String(lng),
      radius: String(radius),
      count: Math.min(Number(limit) || 15, 20).toString(),
    };

    const data = await axiosGet(
      `${baseUrl()}/api/v2.1/search`,
      params,
      { headers: headers() },
      10000
    );

    const restaurants = [];
    const rawRestaurants = data?.restaurants || data?.results_found || [];

    for (const item of rawRestaurants) {
      const r = item.restaurant || item;
      restaurants.push(mapRestaurant(r));
    }

    const filtered = restaurants.filter(Boolean).slice(0, limit);

    logger.provider('zomato', 'searchNearby', {
      isLive: true,
      count: filtered.length,
      latencyMs: Date.now() - started,
    });

    return live('zomato', filtered, `Live nearby restaurants from Zomato (${filtered.length})`);
  } catch (err) {
    logger.error(`[PROVIDER:zomato] searchNearby error: ${err.message}`);
    return unavailable('zomato', `Live data unavailable: ${err.message}`);
  }
}

/**
 * Batch-enrich Geoapify restaurants with Zomato real data.
 * Matches Geoapify restaurants by name to Zomato results and returns
 * a Map of lowercase restaurant name → Zomato data.
 *
 * @param {string} destination — City/area name
 * @param {string[]} restaurantNames — List of restaurant names to match
 * @param {object} opts
 * @param {number} opts.maxSearches — Max Zomato API calls (default 5, to limit credit usage)
 * @returns {Map<string, object>}
 */
export async function enrichRestaurants(destination, restaurantNames, { maxSearches = 5 } = {}) {
  logger.entry('[PROVIDER:zomato]', 'enrichRestaurants', {
    destination,
    restaurantCount: restaurantNames.length,
  });
  const started = Date.now();

  if (!apiKey()) {
    logger.info('[PROVIDER:zomato] Skipped enrichment — API key not configured');
    return new Map();
  }

  const results = new Map();
  const searches = restaurantNames.slice(0, maxSearches);

  // Search in parallel with concurrency limit
  const CONCURRENCY = 2;
  for (let i = 0; i < searches.length; i += CONCURRENCY) {
    const batch = searches.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.allSettled(
      batch.map(async (name) => {
        const result = await searchRestaurants({
          destination,
          cuisine: '',
          limit: 10,
        });
        return { name, result };
      })
    );

    for (const settled of batchResults) {
      if (settiled.status !== 'fulfilled') continue;
      const { name, result } = settled.value;
      if (!result.isLive || !result.data?.length) continue;

      // Match by name (fuzzy)
      const lowerName = name.toLowerCase();
      const matched = result.data.filter((r) => {
        const rName = (r.name || '').toLowerCase();
        return rName.includes(lowerName) || lowerName.includes(rName)
          || levenshteinSimilarity(rName, lowerName) > 0.6;
      });

      if (matched.length) {
        results.set(lowerName, matched[0]); // Best match
      }
    }
  }

  logger.info(`[PROVIDER:zomato] Enriched ${results.size}/${searches.length} restaurants with Zomato data (${Date.now() - started}ms)`);
  return results;
}

// ── Mapping helpers ─────────────────────────────────────────────────

/** Map a Zomato restaurant response to a normalized shape. */
function mapRestaurant(r) {
  if (!r || typeof r !== 'object') return null;

  const rating = r.user_rating || r.rating || {};
  const location = r.location || {};
  const cost = Number(r.average_cost_for_two || 0);
  const priceRange = Number(r.price_range || r.priceRange || 0);

  return {
    restaurantId: r.id || r.R?.res_id || '',
    name: r.name || '',
    cuisines: (r.cuisines || r.cuisine || '').split(',').map((s) => s.trim()).filter(Boolean),
    cuisineString: r.cuisines || r.cuisine || '',
    rating: rating.aggregate_rating ? Number(rating.aggregate_rating) : null,
    ratingText: rating.rating_text || rating.ratingText || '',
    ratingColor: rating.rating_color || '',
    votes: rating.votes ? Number(rating.votes) : 0,
    averageCostForTwo: cost || null,
    averageCostPerPerson: cost ? Math.round(cost / 2) : null,
    priceRange, // 1-4 scale
    address: location.address || '',
    locality: location.locality || '',
    city: location.city || '',
    latitude: location.latitude ? Number(location.latitude) : null,
    longitude: location.longitude ? Number(location.longitude) : null,
    phone: r.phone_numbers || r.phoneNumbers || '',
    imageUrl: r.featured_image || r.thumb || '',
    menuUrl: r.menu_url || r.menuUrl || '',
    hasOnlineDelivery: Boolean(r.is_delivering || r.hasOnlineDelivery),
    isLivePricing: true,
    source: 'zomato',
    fetchedAt: new Date().toISOString(),
  };
}

/** Simple Levenshtein-based similarity for fuzzy name matching (0-1 scale). */
function levenshteinSimilarity(a, b) {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const matrix = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }
  const maxLen = Math.max(a.length, b.length);
  return 1 - matrix[a.length][b.length] / maxLen;
}

export default {
  searchRestaurants,
  searchNearby,
  enrichRestaurants,
};
