/**
 * Hotel Candidate Pipeline
 *
 * Strict validation, rejection, and normalization of hotel candidates.
 * Ensures only real provider hotel offers enter the itinerary.
 * Never fabricates hotel names or prices.
 *
 * Price rules:
 *   - Use provider's actual offer price
 *   - Never use arbitrary fallback prices (₹500, ₹1000, etc.)
 *   - If no hotel offer: hotelName = null, price = null, dataStatus = "unavailable"
 *
 * Normalized shape:
 *   { hotelId, hotelName, provider, providerOfferId, address, city, country,
 *     latitude, longitude, rating, roomType, checkIn, checkOut, rooms,
 *     price, currency, totalPrice, pricePerNight, source, dataStatus, isEstimate }
 */

import logger from '../utils/logger.js';

// ══════════════════════════════════════════════════════════════════════
//  CONFIGURATION
// ══════════════════════════════════════════════════════════════════════

/** Known hotel provider names. */
export const KNOWN_HOTEL_PROVIDERS = new Set([
  'amadeus',
  'amadeus-hotels',
  'booking.com',
  'expedia',
  'hotels.com',
]);

// ══════════════════════════════════════════════════════════════════════
//  VALIDATION
// ══════════════════════════════════════════════════════════════════════

/**
 * Validate a single hotel candidate.
 *
 * @param {object} candidate - Raw hotel from provider
 * @param {object} [opts] - Options
 * @param {string} [opts.destination] - Expected destination for name validation
 * @returns {{ valid: boolean, rejection: string|null, validationStep: string|null }}
 */
export function validateHotelCandidate(candidate, opts = {}) {
  if (!candidate || typeof candidate !== 'object') {
    return { valid: false, rejection: 'Candidate is null or not an object', validationStep: 'pre-check' };
  }

  const name = (candidate.name || '').trim();
  const hotelId = candidate.id || candidate.hotelId || '';

  // Must have a name
  if (!name) {
    return { valid: false, rejection: 'Hotel has no name', validationStep: 'name-empty' };
  }

  // Reject generic/placeholder names
  const GENERIC_PATTERNS = [
    /\baccommodation\b/i,
    /\bovernight\b/i,
    /\blodging\b/i,
    /\bstay\b/i,
    /\bplace to sleep\b/i,
    /\bhotel in\b/i,
    /\bhotel near\b/i,
  ];
  if (GENERIC_PATTERNS.some((p) => p.test(name))) {
    return { valid: false, rejection: `Hotel name "${name}" is generic/placeholder`, validationStep: 'name-generic' };
  }

  // Reject test/placeholder data
  const TEST_PATTERNS = [
    /\bdemo\b/i, /\btest\b/i, /\bsample\b/i, /\bplaceholder\b/i,
    /\bdummy\b/i, /\bfake\b/i, /\bmock\b/i,
  ];
  if (TEST_PATTERNS.some((p) => p.test(name))) {
    return { valid: false, rejection: `Hotel name "${name}" is test/placeholder data`, validationStep: 'name-test' };
  }

  // Must have a valid hotel ID (provider identity)
  if (!hotelId || hotelId.length === 0) {
    return { valid: false, rejection: `Hotel "${name}" has no hotelId`, validationStep: 'hotel-id' };
  }

  // Must have a valid price (provider must give the price)
  const price = candidate.price?.amount ?? candidate.pricePerNight ?? null;
  if (price == null || typeof price !== 'number' || price <= 0) {
    return { valid: false, rejection: `Hotel "${name}" has no valid provider price`, validationStep: 'price' };
  }

  return { valid: true, rejection: null, validationStep: null };
}

// ══════════════════════════════════════════════════════════════════════
//  NORMALIZATION
// ══════════════════════════════════════════════════════════════════════

/**
 * Normalize a validated hotel candidate into the canonical shape.
 *
 * @param {object} candidate - Raw hotel from provider
 * @param {object} opts - Trip context
 * @param {string} opts.checkIn - Check-in date (YYYY-MM-DD)
 * @param {string} opts.checkOut - Check-out date (YYYY-MM-DD)
 * @param {number} opts.rooms - Number of rooms
 * @returns {object|null} Normalized hotel candidate, or null if invalid
 */
export function normalizeHotel(candidate, opts = {}) {
  if (!candidate || typeof candidate !== 'object') return null;

  const name = (candidate.name || '').trim();
  if (!name) return null;

  const hotelId = candidate.id || candidate.hotelId || '';
  const rawProvider = candidate.provider || 'amadeus-hotels';
  const provider = String(rawProvider).toLowerCase();
  const price = candidate.price?.amount ?? candidate.pricePerNight ?? null;
  const currency = candidate.price?.currency || 'INR';
  const rooms = opts.rooms || 1;

  const nights = calculateNights(opts.checkIn, opts.checkOut);
  const totalPrice = price != null ? Math.round(price * rooms * 100) / 100 : null;

  return {
    hotelId,
    hotelName: name,
    provider: provider || 'amadeus-hotels',
    // Stable, namespaced source for provenance checks (e.g. 'amadeus-hotels'
    // for Amadeus offers).
    source: provider === 'amadeus' ? 'amadeus-hotels' : (rawProvider || 'amadeus-hotels'),
    providerOfferId: candidate.offerId || candidate.id || hotelId,
    address: candidate.address || '',
    city: candidate.city || candidate.cityCode || '',
    country: candidate.country || '',
    latitude: candidate.latitude ?? null,
    longitude: candidate.longitude ?? null,
    rating: candidate.rating ?? null,
    roomType: candidate.roomType || candidate.boardType || 'standard',
    checkIn: opts.checkIn || '',
    checkOut: opts.checkOut || '',
    rooms,
    price: price,
    currency,
    totalPrice,
    pricePerNight: price,
    dataStatus: candidate.isLive ? 'live' : 'estimate',
    isEstimate: !candidate.isLive,
  };
}

/**
 * Build a null/unavailable hotel result when no provider hotel is available.
 * This is the honest representation — no fabricated names or prices.
 *
 * @param {object} opts
 * @param {string} opts.destination
 * @param {string} opts.checkIn
 * @param {string} opts.checkOut
 * @param {number} opts.rooms
 * @returns {object} Unavailable hotel result
 */
export function buildUnavailableHotel(opts = {}) {
  return {
    hotelId: null,
    hotelName: null,
    provider: null,
    providerOfferId: null,
    address: '',
    city: opts.destination || '',
    country: '',
    latitude: null,
    longitude: null,
    rating: null,
    roomType: null,
    checkIn: opts.checkIn || '',
    checkOut: opts.checkOut || '',
    rooms: opts.rooms || 1,
    price: null,
    currency: opts.currency || 'INR',
    totalPrice: null,
    pricePerNight: null,
    source: 'unavailable',
    dataStatus: 'unavailable',
    isEstimate: false,
  };
}

/**
 * Calculate number of nights between check-in and check-out.
 */
function calculateNights(checkIn, checkOut) {
  if (!checkIn || !checkOut) return 1;
  try {
    const start = new Date(checkIn);
    const end = new Date(checkOut);
    const diffMs = end - start;
    if (diffMs <= 0) return 1;
    return Math.max(1, Math.round(diffMs / (1000 * 60 * 60 * 24)));
  } catch {
    return 1;
  }
}

// ══════════════════════════════════════════════════════════════════════
//  PIPELINE
// ══════════════════════════════════════════════════════════════════════

/**
 * Run the full hotel candidate pipeline:
 *   1. Validate each candidate
 *   2. Normalize accepted candidates
 *   3. Sort by price (cheapest first)
 *   4. Return accepted, rejected, and rejection log
 *
 * @param {Array} candidates - Raw candidates from providers
 * @param {object} opts - Trip context (checkIn, checkOut, rooms, destination)
 * @returns {{ accepted: Array, rejected: Array, rejectionLog: Array, recommended: object|null }}
 */
export function runHotelPipeline(candidates, opts = {}) {
  const accepted = [];
  const rejected = [];
  const rejectionLog = [];

  for (const candidate of candidates || []) {
    const validation = validateHotelCandidate(candidate, opts);

    if (validation.valid) {
      const normalized = normalizeHotel(candidate, opts);
      if (normalized) {
        accepted.push(normalized);
      }
    } else {
      rejected.push(candidate);
      rejectionLog.push({
        name: candidate.name || '',
        hotelId: candidate.id || candidate.hotelId || '',
        provider: candidate.provider || 'unknown',
        rejection: validation.rejection,
        validationStep: validation.validationStep,
        timestamp: new Date().toISOString(),
      });
    }
  }

  // Sort by price (cheapest first)
  accepted.sort((a, b) => (a.price || Infinity) - (b.price || Infinity));

  const recommended = accepted.length > 0 ? accepted[0] : null;

  if (rejected.length > 0) {
    logger.info(
      `[hotelPipeline] ${accepted.length} accepted, ${rejected.length} rejected out of ${(candidates || []).length}`
    );
    for (const r of rejectionLog) {
      logger.warn(`[hotelPipeline] REJECTED: "${r.name}" — ${r.rejection} (step: ${r.validationStep})`);
    }
  }

  return { accepted, rejected, rejectionLog, recommended };
}

/**
 * Get a pipeline summary for logging/debugging.
 */
export function getPipelineSummary(accepted, rejected) {
  const withPrice = accepted.filter((h) => h.price > 0).length;
  const withRating = accepted.filter((h) => h.rating != null).length;

  return {
    total: accepted.length + rejected.length,
    accepted: accepted.length,
    rejected: rejected.length,
    withPrice,
    withRating,
    avgPrice: withPrice > 0
      ? Math.round(accepted.filter((h) => h.price > 0).reduce((sum, h) => sum + h.price, 0) / withPrice)
      : null,
    minPrice: withPrice > 0
      ? Math.min(...accepted.filter((h) => h.price > 0).map((h) => h.price))
      : null,
    maxPrice: withPrice > 0
      ? Math.max(...accepted.filter((h) => h.price > 0).map((h) => h.price))
      : null,
    recommended: accepted[0] || null,
  };
}

export default {
  validateHotelCandidate,
  normalizeHotel,
  buildUnavailableHotel,
  runHotelPipeline,
  getPipelineSummary,
  KNOWN_HOTEL_PROVIDERS,
};
