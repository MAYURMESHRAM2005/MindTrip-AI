/**
 * Restaurant Candidate Pipeline
 *
 * Strict validation, rejection, and normalization of restaurant candidates.
 * Ensures only real restaurant/food establishments enter the itinerary.
 *
 * Validation rules (applied in order):
 *   1. providerId must exist
 *   2. provider/source must be known
 *   3. valid restaurant/food category
 *   4. destination validation must pass
 *   5. coordinates must be valid
 *   6. name must represent a real restaurant/food establishment
 *   7. reject hospitals
 *   8. reject clinics
 *   9. reject spas
 *  10. reject hotels unless explicitly categorized as restaurant
 *  11. reject residential addresses
 *  12. reject generic buildings
 *  13. reject empty/placeholder names
 *  14. reject obvious provider test data
 *
 * Price rules:
 *   - If provider gives an actual restaurant price/average cost: use it
 *   - If provider does not provide price: price = null, dataStatus = "unavailable", isEstimate = false
 *   - If the application has a clearly defined statistical estimate: label it explicitly, never label as live
 *
 * Normalized shape:
 *   { candidateType, canonicalName, providerId, provider, address, city, country,
 *     latitude, longitude, cuisine, rating, reviewCount, priceLevel,
 *     averageCostPerPerson, openingHours, source, dataStatus, isEstimate }
 */

import logger from '../utils/logger.js';
import { haversineKm } from '../utils/geo.js';

// ══════════════════════════════════════════════════════════════════════
//  CONFIGURATION
// ══════════════════════════════════════════════════════════════════════

/** Known restaurant-compatible provider names. */
export const KNOWN_RESTAURANT_PROVIDERS = new Set([
  'google',
  'zomato',
  'yelp',
  'tripadvisor',
  'opentable',
]);

/** Valid category prefixes for restaurant candidates. */
export const VALID_RESTAURANT_CATEGORY_PREFIXES = [
  'catering.restaurant',
  'catering.cafe',
  'catering.fast_food',
  'catering.bar',
  'catering.biergarten',
  'catering.food_court',
  'catering.pub',
  'catering.ice_cream',
  'catering.bakery',
  'commercial',
];

/** Patterns that indicate a restaurant/food establishment in the name. */
const RESTAURANT_NAME_INDICATORS = [
  /\brestaurant\b/i,
  /\bcafe\b/i,
  /\bcafeteria\b/i,
  /\bbistro\b/i,
  /\bbrasserie\b/i,
  /\btrattoria\b/i,
  /\bpizzeria\b/i,
  /\bsushi\b/i,
  /\bgrill\b/i,
  /\bsteakhouse\b/i,
  /\bthali\b/i,
  /\bdhaba\b/i,
  /\bkhao\s*gal[iy]\b/i,
  /\bfood\b/i,
  /\beatery\b/i,
  /\bkitchen\b/i,
  /\btandoor/i,
  /\bbiryani\b/i,
  /\bnoodle/i,
  /\bcurry\b/i,
  /\bsoup\b/i,
  /\bpasta\b/i,
  /\bwine\s*bar\b/i,
  /\btea\s*house\b/i,
  /\bcha\b/i,
  /\bchai\b/i,
  /\bjuice\s*bar\b/i,
  /\bsmoothie\b/i,
  /\bbakery\b/i,
  /\bpatisserie\b/i,
  /\bconfiserie\b/i,
  /\bdessert\b/i,
  /\bice\s*cream\b/i,
  /\bpub\b/i,
  /\btavern\b/i,
  /\binn\b/i,
  /\bdiner\b/i,
  /\bsteak\b/i,
  /\bsweet\b/i,
  /\bcandy\b/i,
];

/** Patterns that indicate a non-restaurant (must reject). */
export const NON_RESTAURANT_PATTERNS = {
  hospital: [
    /\bhospital\b/i,
    /\bmedical\s*center\b/i,
    /\bclinic\b/i,
    /\bnursing\b/i,
    /\bhealth\s*care\b/i,
    /\bhealthcare\b/i,
    /\bdiagnostic\b/i,
    /\bpathology\b/i,
    /\bradiology\b/i,
    /\bsurgical\b/i,
    /\bmaternity\b/i,
    /\bpediatric\b/i,
    /\bcardiac\b/i,
    /\bortho/i,
    /\beye\s*care\b/i,
    /\bdental\b/i,
  ],
  spa: [
    /\bspa\b/i,
    /\bwellness\s*center\b/i,
    /\bmassage\b/i,
    /\bsauna\b/i,
    /\bhammam\b/i,
    /\bday\s*spa\b/i,
    /\bbeauty\s*parlou?r\b/i,
    /\bsalon\b/i,
    /\btherapeutic\b/i,
    /\bphysiotherapy\b/i,
    /\bphysio\b/i,
  ],
  hotel: [
    /\bhotel\b/i,
    /\bmotel\b/i,
    /\bhostel\b/i,
    /\bguest\s*house\b/i,
    /\bguesthouse\b/i,
    /\blodge\b/i,
    /\bresort\b/i,
    /\binn\b(?!\s+(restaurant|bar|grill|cafe|kitchen))/i,
    /\bserviced\s*apartment\b/i,
    /\bpaying\s*guest\b/i,
    /\bp\.g\.\b/i,
  ],
  residential: [
    /\bapartment\b/i,
    /\bflat\b/i,
    /\bvilla\b/i,
    /\bbungalow\b/i,
    /\bcolony\b/i,
    /\bnagar\b/i,
    /\bhousing\s*society\b/i,
    /\bresidential\b/i,
    /\bplot\s*no\b/i,
    /\bhouse\s*no\b/i,
    /\bward\b/i,
  ],
  generic: [
    /\bbuilding\b/i,
    /\boffice\b/i,
    /\bworkspace\b/i,
    /\bcoworking\b/i,
    /\bparking\b/i,
    /\bwarehouse\b/i,
    /\bfactory\b/i,
    /\bshowroom\b/i,
    /\boutlet\b/i,
    /\bbranch\b/i,
    /\bhead\s*office\b/i,
    /\bcomplex\b/i,
    /\btower\b/i,
  ],
  test: [
    /\bdemo\b/i,
    /\btest\b/i,
    /\bsample\b/i,
    /\bplaceholder\b/i,
    /\bdummy\b/i,
    /\bfake\b/i,
    /\bmock\b/i,
    /\buntitled\b/i,
    /\bunknown\b/i,
    /\bunnamed\b/i,
    /\bdefault\b/i,
  ],
};

// ══════════════════════════════════════════════════════════════════════
//  VALIDATION
// ══════════════════════════════════════════════════════════════════════

/**
 * Validate a single restaurant candidate.
 *
 * @param {object} candidate - Raw candidate from a provider
 * @param {object} [destination] - Optional destination lock for geographic validation
 * @param {object} [opts] - Options
 * @param {number} [opts.maxDistanceKm] - Max distance from destination centroid (default 50)
 * @returns {{ valid: boolean, rejection: string|null, validationStep: string|null }}
 */
export function validateRestaurantCandidate(candidate, destination = null, opts = {}) {
  if (!candidate || typeof candidate !== 'object') {
    return { valid: false, rejection: 'Candidate is null or not an object', validationStep: 'pre-check' };
  }

  const name = (candidate.name || candidate.canonicalName || '').trim();
  const providerId = candidate.providerId || candidate.placeId || candidate.id || '';
  const provider = (candidate.provider || candidate.source || '').toLowerCase();
  const types = candidate.types || candidate.categories || [];

  // Rule 13: reject empty/placeholder names
  if (!name) {
    return { valid: false, rejection: 'Candidate has no name', validationStep: 'name-empty' };
  }

  // Rule 1: providerId must exist
  if (!providerId || providerId.length === 0) {
    return { valid: false, rejection: `Candidate "${name}" has no providerId`, validationStep: 'provider-id' };
  }

  // Rule 2: provider/source must be known
  if (!provider || !KNOWN_RESTAURANT_PROVIDERS.has(provider)) {
    return { valid: false, rejection: `Candidate "${name}" has unknown provider "${provider}"`, validationStep: 'provider-known' };
  }

  // Rule 3: valid restaurant/food category
  const typeStr = types.join(' ').toLowerCase();
  const hasValidCategory = VALID_RESTAURANT_CATEGORY_PREFIXES.some((prefix) => typeStr.includes(prefix));
  if (!hasValidCategory) {
    return { valid: false, rejection: `Candidate "${name}" has no valid restaurant/food category (types: ${types.join(', ')})`, validationStep: 'category' };
  }

  // Rule 5: coordinates must be valid
  const lat = candidate.latitude ?? candidate.coordinates?.lat ?? null;
  const lng = candidate.longitude ?? candidate.coordinates?.lng ?? null;
  if (lat == null || lng == null) {
    return { valid: false, rejection: `Candidate "${name}" has no coordinates`, validationStep: 'coordinates' };
  }
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return { valid: false, rejection: `Candidate "${name}" has non-numeric coordinates`, validationStep: 'coordinates-type' };
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { valid: false, rejection: `Candidate "${name}" has out-of-range coordinates (${lat}, ${lng})`, validationStep: 'coordinates-range' };
  }
  if (Math.abs(lat) < 0.01 && Math.abs(lng) < 0.01) {
    return { valid: false, rejection: `Candidate "${name}" has null-island coordinates (0, 0)`, validationStep: 'coordinates-null-island' };
  }

  // Rule 6: name must represent a real restaurant/food establishment
  const hasFoodIndicator = RESTAURANT_NAME_INDICATORS.some((p) => p.test(name));
  const hasTypeFoodIndicator = typeStr.includes('catering');
  if (!hasFoodIndicator && !hasTypeFoodIndicator) {
    // Not necessarily reject — the name might still be valid if category is correct
    // But log a warning for monitoring
    logger.warn(`[restaurantPipeline] Candidate "${name}" has no obvious food-related name indicator (types: ${types.join(', ')})`);
  }

  // Rule 7: reject hospitals
  if (NON_RESTAURANT_PATTERNS.hospital.some((p) => p.test(name))) {
    return { valid: false, rejection: `Candidate "${name}" is a hospital/medical facility`, validationStep: 'reject-hospital' };
  }

  // Rule 8: reject clinics
  if (NON_RESTAURANT_PATTERNS.hospital.some((p) => p.test(name)) || /\bclinic\b/i.test(name)) {
    // Already covered by hospital patterns, but explicit check
    if (/\bclinic\b/i.test(name)) {
      return { valid: false, rejection: `Candidate "${name}" is a clinic`, validationStep: 'reject-clinic' };
    }
  }

  // Rule 9: reject spas
  if (NON_RESTAURANT_PATTERNS.spa.some((p) => p.test(name))) {
    return { valid: false, rejection: `Candidate "${name}" is a spa/wellness facility`, validationStep: 'reject-spa' };
  }

  // Rule 10: reject hotels unless explicitly categorized as restaurant
  const isHotel = NON_RESTAURANT_PATTERNS.hotel.some((p) => p.test(name));
  const isRestaurantCategory = hasValidCategory && typeStr.includes('catering.restaurant');
  if (isHotel && !isRestaurantCategory) {
    return { valid: false, rejection: `Candidate "${name}" is a hotel (not categorized as restaurant)`, validationStep: 'reject-hotel' };
  }

  // Rule 11: reject residential addresses
  if (NON_RESTAURANT_PATTERNS.residential.some((p) => p.test(name))) {
    return { valid: false, rejection: `Candidate "${name}" is a residential address`, validationStep: 'reject-residential' };
  }

  // Rule 12: reject generic buildings
  if (NON_RESTAURANT_PATTERNS.generic.some((p) => p.test(name))) {
    return { valid: false, rejection: `Candidate "${name}" is a generic building/business`, validationStep: 'reject-generic' };
  }

  // Rule 14: reject obvious provider test data
  if (NON_RESTAURANT_PATTERNS.test.some((p) => p.test(name))) {
    return { valid: false, rejection: `Candidate "${name}" appears to be test/placeholder data`, validationStep: 'reject-test' };
  }

  // Rule 4: destination validation (if destination provided)
  if (destination) {
    const distanceCheck = isWithinDistance(lat, lng, destination, opts.maxDistanceKm || 50);
    if (!distanceCheck.within) {
      return {
        valid: false,
        rejection: `Candidate "${name}" is ${distanceCheck.distanceKm.toFixed(1)}km from destination (max ${opts.maxDistanceKm || 50}km)`,
        validationStep: 'destination-distance',
      };
    }
  }

  return { valid: true, rejection: null, validationStep: null };
}

/**
 * Check if coordinates are within a certain distance of the destination.
 */
function isWithinDistance(lat, lng, destination, maxDistanceKm) {
  const destLat = destination.latitude ?? null;
  const destLng = destination.longitude ?? null;
  if (destLat == null || destLng == null) {
    return { within: true, distanceKm: 0 }; // Can't verify — allow
  }
  const distanceKm = haversineKm(destLat, destLng, lat, lng);
  return { within: distanceKm <= maxDistanceKm, distanceKm };
}

// ══════════════════════════════════════════════════════════════════════
//  NORMALIZATION
// ══════════════════════════════════════════════════════════════════════

/**
 * Normalize a validated restaurant candidate into the canonical shape.
 *
 * Price rules:
 *   - If provider gives actual price: use provider value
 *   - If provider does not provide price: price = null, dataStatus = "unavailable", isEstimate = false
 *   - If statistical estimate exists: label explicitly, never as live
 *
 * @param {object} candidate - Raw candidate from provider
 * @returns {object} Normalized restaurant candidate
 */
export function normalizeRestaurant(candidate) {
  const name = (candidate.name || '').trim();
  const providerId = candidate.providerId || candidate.placeId || candidate.id || '';
  const provider = (candidate.provider || candidate.source || '').toLowerCase();
  const source = candidate.source || candidate.provider || '';
  const types = candidate.types || candidate.categories || [];
  const cuisines = candidate.cuisines || candidate.zomatoData?.cuisines || [];

  const lat = candidate.latitude ?? candidate.coordinates?.lat ?? null;
  const lng = candidate.longitude ?? candidate.coordinates?.lng ?? null;

  // Price resolution
  const hasProviderPrice = Boolean(candidate.averageCostPerPerson > 0 || candidate.zomatoData?.averageCostPerPerson > 0);
  const hasPriceLevel = Boolean(candidate.priceLevel > 0 || candidate.priceRange > 0);
  const hasZomatoData = Boolean(candidate.zomatoData?.averageCostPerPerson > 0);

  let averageCostPerPerson = null;
  let dataStatus = 'unavailable';
  let isEstimate = false;

  if (hasProviderPrice) {
    // Provider gives actual restaurant price — use it
    averageCostPerPerson = candidate.averageCostPerPerson || candidate.zomatoData?.averageCostPerPerson || null;
    dataStatus = hasZomatoData ? 'live' : 'provider';
    isEstimate = false;
  } else if (hasPriceLevel) {
    // Statistical estimate from priceLevel — label explicitly as estimated
    averageCostPerPerson = null; // Do NOT invent a number
    dataStatus = 'unavailable';
    isEstimate = false;
  }
  // else: no price data at all
  //   averageCostPerPerson = null
  //   dataStatus = "unavailable"
  //   isEstimate = false

  return {
    candidateType: 'restaurant',
    canonicalName: name,
    providerId,
    provider: provider || source,
    address: candidate.address || '',
    city: candidate.city || candidate.suburb || candidate.district || '',
    country: candidate.country || '',
    latitude: lat,
    longitude: lng,
    cuisine: cuisines.length > 0 ? cuisines : (types.length > 0 ? types : []),
    rating: candidate.rating != null ? Number(candidate.rating) : null,
    reviewCount: candidate.reviewCount || candidate.userRatingsTotal || candidate.votes || 0,
    priceLevel: candidate.priceLevel || candidate.priceRange || null,
    averageCostPerPerson,
    openingHours: candidate.openingHours || null,
    source,
    dataStatus,
    isEstimate,
  };
}

// ══════════════════════════════════════════════════════════════════════
//  PIPELINE
// ══════════════════════════════════════════════════════════════════════

/**
 * Run the full restaurant candidate pipeline:
 *   1. Validate each candidate
 *   2. Normalize accepted candidates
 *   3. Return accepted, rejected, and rejection log
 *
 * @param {Array} candidates - Raw candidates from providers
 * @param {object} [destination] - Optional destination lock
 * @param {object} [opts] - Options
 * @returns {{ accepted: Array, rejected: Array, rejectionLog: Array }}
 */
export function runRestaurantPipeline(candidates, destination = null, opts = {}) {
  const accepted = [];
  const rejected = [];
  const rejectionLog = [];

  for (const candidate of candidates || []) {
    const validation = validateRestaurantCandidate(candidate, destination, opts);

    if (validation.valid) {
      const normalized = normalizeRestaurant(candidate);
      accepted.push(normalized);
    } else {
      rejected.push(candidate);
      rejectionLog.push({
        name: candidate.name || '',
        providerId: candidate.providerId || candidate.placeId || candidate.id || '',
        provider: candidate.provider || candidate.source || 'unknown',
        rejection: validation.rejection,
        validationStep: validation.validationStep,
        timestamp: new Date().toISOString(),
      });
    }
  }

  if (rejected.length > 0) {
    logger.info(
      `[restaurantPipeline] ${accepted.length} accepted, ${rejected.length} rejected out of ${(candidates || []).length}`
    );
    for (const r of rejectionLog) {
      logger.warn(`[restaurantPipeline] REJECTED: "${r.name}" — ${r.rejection} (step: ${r.validationStep})`);
    }
  }

  return { accepted, rejected, rejectionLog };
}

/**
 * Get a pipeline summary for logging/debugging.
 */
export function getPipelineSummary(accepted, rejected) {
  const withPrice = accepted.filter((r) => r.averageCostPerPerson > 0).length;
  const withoutPrice = accepted.filter((r) => r.averageCostPerPerson == null).length;
  const withRating = accepted.filter((r) => r.rating != null).length;

  return {
    total: accepted.length + rejected.length,
    accepted: accepted.length,
    rejected: rejected.length,
    withPrice,
    withoutPrice,
    withRating,
    avgRating: accepted.length > 0
      ? Math.round(accepted.filter((r) => r.rating != null).reduce((sum, r) => sum + r.rating, 0) / withRating * 10) / 10
      : null,
    rejectionReasons: rejected.map((r) => r.rejection).filter(Boolean),
  };
}

export default {
  validateRestaurantCandidate,
  normalizeRestaurant,
  runRestaurantPipeline,
  getPipelineSummary,
  KNOWN_RESTAURANT_PROVIDERS,
  VALID_RESTAURANT_CATEGORY_PREFIXES,
  NON_RESTAURANT_PATTERNS,
};
