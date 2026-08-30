import env from '../config/env.js';
import { live, unavailable, axiosGet, axiosPost, providerHeaders } from './base.provider.js';
import logger from '../utils/logger.js';

/**
 * Viator Partner API provider.
 * Provides real tour/activity pricing and entry fee data.
 *
 * Uses the Viator Partner API v2 (search model):
 *  - POST /products/search  — search tours/activities by destination
 *  - GET  /products/{code}  — get single product details + pricing
 *
 * Basic Access affiliates can use /products/search and /products/{code}.
 * This replaces the hardcoded entryFeeEstimateFor() guesses in itinerary.service.js.
 *
 * Env vars:
 *   VIATOR_API_KEY     — Viator Partner API key (Bearer token)
 *   VIATOR_AFFILIATE_ID — Optional affiliate partner ID
 */

const BASE_URL = 'https://api.viator.com/partner';

function apiKey() {
  return env.VIATOR_API_KEY;
}

function affiliateId() {
  return env.VIATOR_AFFILIATE_ID || '';
}

function authHeaders() {
  return {
    Authorization: `Bearer ${apiKey()}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Accept-Language': 'en',
  };
}

/**
 * Search Viator for tours and activities in a destination.
 * Returns products with real pricing, ratings, and review data.
 *
 * @param {object} opts
 * @param {string} opts.destination — Viator destination name (e.g., "Paris", "Goa", "Tokyo")
 * @param {string} opts.currency — ISO 4217 currency code (e.g., "INR", "USD")
 * @param {number} opts.limit — Max results (default 20)
 * @param {number} opts.maxPrice — Optional max price filter
 * @param {string} opts.sortOrder — SORT_BY_RECOMMENDED, SORT_BY_RATING, SORT_BY_PRICE_LOW_TO_HIGH, SORT_BY_PRICE_HIGH_TO_LOW
 * @returns {{ success, isLive, data, message, source }}
 */
export async function searchProducts({
  destination,
  currency = 'INR',
  limit = 20,
  maxPrice,
  sortOrder = 'SORT_BY_RECOMMENDED',
}) {
  logger.entry('[PROVIDER:viator]', 'searchProducts', { destination, currency, limit });
  const started = Date.now();

  if (!apiKey()) {
    return unavailable('viator', 'Viator API key not configured');
  }

  try {
    const body = {
      searchQuery: destination,
      currency: currency.toUpperCase(),
      sortOrder,
      count: Math.min(Number(limit) || 20, 30),
      start: 1,
      destId: -1, // -1 means search all destinations by name
      flags: [],
    };

    // Optional price filter
    if (maxPrice && maxPrice > 0) {
      body.toPrice = maxPrice;
    }

    const data = await axiosPost(
      `${BASE_URL}/products/search`,
      body,
      { headers: authHeaders() },
      12000
    );

    const products = (data.products || []).map(mapProduct);

    logger.provider('viator', 'searchProducts', {
      isLive: true,
      count: products.length,
      latencyMs: Date.now() - started,
    });

    return live('viator', products, `Live tour data from Viator (${products.length} products)`);
  } catch (err) {
    logger.error(`[PROVIDER:viator] searchProducts error: ${err.message}`);
    return unavailable('viator', `Live data unavailable: ${err.message}`);
  }
}

/**
 * Get details for a single Viator product (tour/activity).
 * Includes full description, pricing tiers, and review data.
 *
 * @param {string} productCode — Viator product code
 * @param {string} currency — ISO 4217 currency code
 * @returns {{ success, isLive, data, message, source }}
 */
export async function getProductDetails(productCode, currency = 'INR') {
  logger.entry('[PROVIDER:viator]', 'getProductDetails', { productCode, currency });
  const started = Date.now();

  if (!apiKey()) {
    return unavailable('viator', 'Viator API key not configured');
  }

  try {
    const data = await axiosGet(
      `${BASE_URL}/products/${productCode}`,
      { currency: currency.toUpperCase(), magnolia: false },
      { headers: authHeaders() },
      10000
    );

    const product = mapProduct(data);

    logger.provider('viator', 'getProductDetails', {
      isLive: true,
      hasPricing: Boolean(product.fromPrice),
      latencyMs: Date.now() - started,
    });

    return live('viator', product, `Live product details from Viator`);
  } catch (err) {
    logger.error(`[PROVIDER:viator] getProductDetails error: ${err.message}`);
    return unavailable('viator', `Live data unavailable: ${err.message}`);
  }
}

/**
 * Search attractions by destination. Returns attraction IDs and basic info
 * that can be used to find linked products.
 *
 * @param {object} opts
 * @param {string} opts.destination — Viator destination name
 * @param {number} opts.limit — Max results (default 30)
 * @returns {{ success, isLive, data, message, source }}
 */
export async function searchAttractions({ destination, limit = 30 }) {
  logger.entry('[PROVIDER:viator]', 'searchAttractions', { destination, limit });
  const started = Date.now();

  if (!apiKey()) {
    return unavailable('viator', 'Viator API key not configured');
  }

  try {
    const data = await axiosGet(
      `${BASE_URL}/attractions/search`,
      {
        destName: destination,
        count: Math.min(Number(limit) || 30, 30),
        start: 1,
        sortOrder: 'SORT_BY_DEFAULT',
      },
      { headers: authHeaders() },
      10000
    );

    const attractions = (data.attractions || []).map(mapAttraction);

    logger.provider('viator', 'searchAttractions', {
      isLive: true,
      count: attractions.length,
      latencyMs: Date.now() - started,
    });

    return live('viator', attractions, `Live attractions from Viator (${attractions.length})`);
  } catch (err) {
    logger.error(`[PROVIDER:viator] searchAttractions error: ${err.message}`);
    return unavailable('viator', `Live data unavailable: ${err.message}`);
  }
}

/**
 * Batch search for products linked to multiple attractions.
 * Useful for enriching Geoapify attractions with real Viator pricing.
 *
 * Searches for each attraction name individually (up to a limit) and
 * returns a Map of attractionName → Viator products.
 *
 * @param {string} destination — Destination name
 * @param {string[]} attractionNames — List of attraction names to match
 * @param {string} currency — ISO 4217 currency code
 * @param {object} opts
 * @param {number} opts.maxPerAttraction — Max products per attraction (default 2)
 * @param {number} opts.maxTotal — Max total API calls (default 8, to limit credit usage)
 * @returns {Map<string, object[]>} — Map of lowercase attraction name → products
 */
export async function enrichAttractionsWithPricing(destination, attractionNames, currency = 'INR', { maxPerAttraction = 2, maxTotal = 8 } = {}) {
  logger.entry('[PROVIDER:viator]', 'enrichAttractionsWithPricing', {
    destination,
    attractionCount: attractionNames.length,
    currency,
  });
  const started = Date.now();

  if (!apiKey()) {
    logger.info('[PROVIDER:viator] Skipped enrichment — API key not configured');
    return new Map();
  }

  const results = new Map();
  const searches = attractionNames.slice(0, maxTotal);

  // Search in parallel with concurrency limit
  const CONCURRENCY = 3;
  for (let i = 0; i < searches.length; i += CONCURRENCY) {
    const batch = searches.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.allSettled(
      batch.map(async (name) => {
        const result = await searchProducts({
          destination,
          currency,
          limit: maxPerAttraction + 1, // +1 for relevance filter
          sortOrder: 'SORT_BY_RECOMMENDED',
        });
        return { name, result };
      })
    );

    for (const settled of batchResults) {
      if (settled.status !== 'fulfilled') continue;
      const { name, result } = settled.value;
      if (!result.isLive || !result.data?.length) continue;

      // Filter products that match this attraction name (fuzzy match)
      const lowerName = name.toLowerCase();
      const matched = result.data.filter((p) => {
        const title = (p.title || '').toLowerCase();
        const desc = (p.shortDescription || '').toLowerCase();
        return title.includes(lowerName) || lowerName.includes(title)
          || title.split(' ').some((w) => w.length > 3 && desc.includes(w));
      });

      const picks = (matched.length ? matched : result.data.slice(0, maxPerAttraction))
        .slice(0, maxPerAttraction);

      if (picks.length) {
        results.set(lowerName, picks);
      }
    }
  }

  logger.info(`[PROVIDER:viator] Enriched ${results.size}/${searches.length} attractions with pricing (${Date.now() - started}ms)`);
  return results;
}

// ── Mapping helpers ─────────────────────────────────────────────────

/** Map a Viator product response to a normalized shape. */
function mapProduct(p) {
  if (!p || typeof p !== 'object') return null;

  const pricing = p.pricingInfo || p.pricing || {};
  const fromPrice = Number(pricing.fromPrice || pricing.price || 0) || null;
  const currency = pricing.currency || 'USD';
  const rating = p.averageRating || p.rating || null;
  const reviewCount = p.reviewCount || p.numberOfReviews || 0;

  return {
    productCode: p.productCode || p.contentId || '',
    title: p.title || p.productName || '',
    shortDescription: p.shortDescription || p.description || '',
    destination: p.destinationName || p.destName || '',
    categoryName: p.categoryName || p.category || '',
    duration: p.duration || p.durationString || '',
    fromPrice: fromPrice ? { amount: fromPrice, currency } : null,
    currency,
    rating: rating ? Number(rating) : null,
    reviewCount: Number(reviewCount) || 0,
    coverImageUrl: p.coverImageUrl || p.imageUrl || p.thumbnailUrl || '',
    isLivePricing: true,
    source: 'viator',
    fetchedAt: new Date().toISOString(),
  };
}

/** Map a Viator attraction response to a normalized shape. */
function mapAttraction(a) {
  if (!a || typeof a !== 'object') return null;

  return {
    attractionId: a.attractionId || '',
    name: a.name || '',
    destination: a.destinationName || '',
    introduction: a.introduction || a.description || '',
    reviewCount: Number(a.reviewCount || 0),
    averageRating: a.averageRating || a.rating || null,
    imageCount: Number(a.imageCount || 0),
    admissionType: a.admissionType || '', // 'FREE', 'PAID', 'MIXED'
    source: 'viator',
  };
}

export default {
  searchProducts,
  getProductDetails,
  searchAttractions,
  enrichAttractionsWithPricing,
};
