/**
 * Destination Lock Service
 *
 * Deterministic geographic boundary enforcement. Every candidate (attraction,
 * restaurant, hotel, event, activity) returned by external providers is
 * validated against the user-selected destination BEFORE it enters the
 * itinerary pipeline or the AI planner context.
 *
 * Design rules:
 *  - Coordinates are the strongest validation signal.
 *  - City/country matching provides a secondary check.
 *  - No LLM involvement — all logic is pure code.
 *  - Rejected candidates are logged with structured rejection metadata.
 *  - The validation is reusable across all candidate types.
 *
 * Radius strategy:
 *  - Metropolitan destinations (city-level) use a configurable radius
 *    (default 40 km) to include legitimate suburbs and nearby areas.
 *  - The radius is configurable via DESTINATION_LOCK_RADIUS_KM env var
 *    or per-call override.
 *  - Metropolitan regions can be expanded with ALLOWED_METRO_AREAS for
 *    cities like Mumbai that include Thane, Navi Mumbai, etc.
 */

import { haversineKm } from '../utils/geo.js';
import geocodeProvider from '../providers/googleGeocoding.provider.js';
import logger from '../utils/logger.js';

// ══════════════════════════════════════════════════════════════════════
//  CONFIGURATION
// ══════════════════════════════════════════════════════════════════════

/** Default radius in km for destination boundary. */
export const DEFAULT_RADIUS_KM = 40;

/**
 * Metropolitan area expansions: cities that legitimately include nearby
 * areas as part of the destination region.
 *
 * Key: normalized city name (lowercase, trimmed)
 * Value: { radiusKm, allowedSuburbs: string[] }
 *
 * When a metropolitan area is defined, its radius overrides the default,
 * and any suburb/city in `allowedSuburbs` is always accepted even if
 * coordinates are slightly outside the radius.
 */
export const METRO_AREAS = {
  mumbai: {
    radiusKm: 55,
    allowedSuburbs: [
      'mumbai', 'bombay',
      'navi mumbai', 'new mumbai',
      'thane', 'thana',
      'kalyan', 'dombivli',
      'vasai', 'virar',
      'palghar',
      'ulhasnagar',
      'ambarnath',
      'badlapur',
      'badlapur east',
      'badlapur west',
    ],
  },
  delhi: {
    radiusKm: 60,
    allowedSuburbs: [
      'delhi', 'new delhi', 'old delhi',
      'noida', 'greater noida',
      'gurgaon', 'gurugram',
      'faridabad',
      'ghaziabad',
      'dwarka',
      'rohini',
      'pitampura',
    ],
  },
  bangalore: {
    radiusKm: 50,
    allowedSuburbs: [
      'bangalore', 'bengaluru', 'bangalore urban',
      'whitefield', 'koramangala', 'indiranagar',
      'electronic city', 'hebbal', 'marathahalli',
      'sarjapur', 'hosur', 'devanahalli',
    ],
  },
  chennai: {
    radiusKm: 45,
    allowedSuburbs: [
      'chennai', 'madras',
      'adyar', 'tambaram', 'chromepet',
      'sholinganallur', 'omr', 'ecr',
      'kanchipuram',
    ],
  },
  hyderabad: {
    radiusKm: 45,
    allowedSuburbs: [
      'hyderabad', 'secunderabad',
      'cyberabad', 'HITEC city',
      'gachibowli', 'madhapur',
      'kukatpally', 'miyapur',
      'warangal',
    ],
  },
  goa: {
    radiusKm: 80,
    allowedSuburbs: [
      'goa', 'panaji', 'panjim', 'mapusa',
      'margao', 'madgaon', 'calangute',
      'baga', 'anjuna', 'vagator',
      'candolim', 'arpora', 'sinquerim',
      'colva', 'benaulim', 'varca',
      'north goa', 'south goa',
      'ponda', 'vasco da gama',
    ],
  },
  jaipur: {
    radiusKm: 40,
    allowedSuburbs: [
      'jaipur', 'ajmer', 'pushkar',
      'jodhpur', 'udaipur', 'jaisalmer',
      'kishangarh',
    ],
  },
  kolkata: {
    radiusKm: 45,
    allowedSuburbs: [
      'kolkata', 'calcutta',
      'howrah', 'durgapur',
      'siliguri', 'darjeeling',
    ],
  },
  pune: {
    radiusKm: 50,
    allowedSuburbs: [
      'pune', 'pimpri', 'chinchwad',
      'lonavala', 'khandala',
      'lavasa', 'khadki',
    ],
  },
  manali: {
    radiusKm: 50,
    allowedSuburbs: [
      'manali', 'kullu', 'rohtang',
      'solang', 'naggar',
      'manikaran', 'kasol',
    ],
  },
};

// ══════════════════════════════════════════════════════════════════════
//  DESTINATION RESOLUTION
// ══════════════════════════════════════════════════════════════════════

/**
 * Normalize a destination name for matching.
 * Removes extra whitespace, converts to lowercase, trims common suffixes.
 */
export function normalizeDestinationName(name) {
  if (!name || typeof name !== 'string') return '';
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/,\s*india$/i, '')
    .replace(/,\s*usa$/i, '')
    .replace(/,\s*uk$/i, '')
    .replace(/,\s*brazil$/i, '')
    .replace(/,\s*uae$/i, '')
    .replace(/,\s*emirates$/i, '');
}

/**
 * Resolve a user-provided destination string into a canonical destination
 * object with coordinates and boundary information.
 *
 * @param {string} destination - User input (e.g. "Mumbai", "Goa, India")
 * @param {object} [opts]
 * @param {number} [opts.radiusKm] - Override default radius
 * @returns {Promise<object|null>} Canonical destination or null if geocoding fails
 */
export async function resolveDestination(destination, opts = {}) {
  if (!destination || typeof destination !== 'string') return null;

  const normalizedName = normalizeDestinationName(destination);
  if (!normalizedName) return null;

  // Geocode the destination (Google Geocoding API)
  const geo = await geocodeProvider.geocode(destination);
  if (!geo.isLive || !geo.data) {
    logger.warn(`[destinationLock] Could not geocode destination "${destination}": ${geo.message}`);
    return null;
  }

  const { lat, lng, address } = geo.data;

  // Determine metro area and radius
  const metroKey = normalizedName.split(',')[0].trim();
  const metro = METRO_AREAS[metroKey] || null;
  const radiusKm = opts.radiusKm || metro?.radiusKm || DEFAULT_RADIUS_KM;

  // Build city/state/country from the formatted address
  const addressParts = parseFormattedAddress(address || '');

  return {
    name: destination,
    normalizedName,
    city: addressParts.city || metroKey,
    cityNormalized: metroKey,
    state: addressParts.state || '',
    country: addressParts.country || '',
    latitude: lat,
    longitude: lng,
    radiusKm,
    metro: metro,
    formattedAddress: address || '',
    isMetro: Boolean(metro),
  };
}

/**
 * Parse a formatted address string into city, state, country components.
 * Google formatted addresses are typically:
 *   "Place Name, City, State, Country"
 *   "City, State, Country"
 */
function parseFormattedAddress(formatted) {
  if (!formatted) return { city: '', state: '', country: '' };
  const parts = formatted.split(',').map((s) => s.trim()).filter(Boolean);
  // Last part is usually country, second-to-last is state
  const country = parts[parts.length - 1] || '';
  const state = parts.length >= 3 ? parts[parts.length - 2] : '';
  // City is typically the part before state
  const city = parts.length >= 2 ? parts[parts.length - 2] : parts[0] || '';
  return { city, state, country };
}

// ══════════════════════════════════════════════════════════════════════
//  CANDIDATE VALIDATION
// ══════════════════════════════════════════════════════════════════════

/**
 * Build a rejection log entry.
 */
function createRejection(reason, candidate, destination, provider) {
  return {
    reason,
    candidate: {
      name: candidate.name || '',
      address: candidate.address || '',
      city: candidate.city || candidate.suburb || '',
      state: candidate.state || '',
      country: candidate.country || '',
      latitude: candidate.latitude ?? candidate.coordinates?.lat ?? null,
      longitude: candidate.longitude ?? candidate.coordinates?.lng ?? null,
      provider: candidate.provider || '',
      providerId: candidate.providerId || candidate.placeId || '',
    },
    expectedDestination: {
      name: destination.name,
      city: destination.city,
      state: destination.state,
      country: destination.country,
      latitude: destination.latitude,
      longitude: destination.longitude,
      radiusKm: destination.radiusKm,
    },
    provider: provider || candidate.provider || 'unknown',
    timestamp: new Date().toISOString(),
  };
}

/**
 * Check if a candidate's coordinates are within the destination boundary.
 * Uses haversine distance from the destination centroid.
 */
function isWithinRadius(candidate, destination) {
  const lat = candidate.latitude ?? candidate.coordinates?.lat ?? null;
  const lng = candidate.longitude ?? candidate.coordinates?.lng ?? null;

  if (lat == null || lng == null) return null; // Unknown — can't verify by coordinates

  const distanceKm = haversineKm(destination.latitude, destination.longitude, lat, lng);
  return { within: distanceKm <= destination.radiusKm, distanceKm };
}

/**
 * Check if a candidate's city matches the destination.
 * Normalizes both strings for comparison.
 */
function cityMatches(candidate, destination) {
  const candidateCity = normalizeDestinationName(
    candidate.city || candidate.suburb || candidate.district || ''
  );
  const destCity = destination.cityNormalized || normalizeDestinationName(destination.city || '');

  if (!candidateCity || !destCity) return null; // Unknown

  // Direct match
  if (candidateCity === destCity) return true;

  // Check metropolitan area allowed suburbs
  if (destination.metro?.allowedSuburbs) {
    const match = destination.metro.allowedSuburbs.some(
      (suburb) => candidateCity === normalizeDestinationName(suburb)
    );
    if (match) return true;
  }

  // Partial match — candidate city contains destination city or vice versa
  // Guard: empty string is contained in everything, so skip if either is empty
  if (candidateCity.length > 0 && destCity.length > 0) {
    if (candidateCity.includes(destCity) || destCity.includes(candidateCity)) return true;
  }

  return false;
}

/**
 * Check if a candidate's country matches the destination.
 */
function countryMatches(candidate, destination) {
  const candidateCountry = normalizeDestinationName(candidate.country || '');
  const destCountry = normalizeDestinationName(destination.country || '');

  if (!candidateCountry || !destCountry) return null; // Unknown

  return candidateCountry === destCountry;
}

/**
 * Check if a candidate's name/address contains obvious references
 * to a different city or country.
 */
function nameContainsDifferentLocation(candidate, destination) {
  const name = (candidate.name || '').toLowerCase();
  const address = (candidate.address || '').toLowerCase();
  const combined = `${name} ${address}`;

  // Known distant cities that must never appear in a Mumbai itinerary
  const DISTANT_CITIES = [
    'hyderabad', 'macapá', 'macapa', 'brazil', 'bangkok', 'paris',
    'london', 'tokyo', 'new york', 'dubai', 'singapore', 'sydney',
    'berlin', 'rome', 'madrid', 'amsterdam', 'istanbul', 'cairo',
    'nairobi', 'cape town', 'mexico city', 'buenos aires', 'lima',
    'santiago', 'bogota', 'toronto', 'vancouver', 'seoul', 'beijing',
    'shanghai', 'hong kong', 'taipei', 'kathmandu', 'colombo',
    'maldives', 'phuket', 'bali', 'hanoi', 'ho chi minh',
  ];

  // Check if the destination is one of the distant cities (then it's valid)
  const destNorm = normalizeDestinationName(destination.name || '');

  for (const city of DISTANT_CITIES) {
    if (combined.includes(city) && !destNorm.includes(city)) {
      return city;
    }
  }
  return null;
}

/**
 * Validate a single candidate against the destination boundary.
 *
 * @param {object} candidate - Normalized candidate object
 * @param {object} destination - Canonical destination from resolveDestination()
 * @param {string} [provider] - Provider name for logging
 * @returns {{ valid: boolean, rejection: object|null }}
 */
export function validateCandidate(candidate, destination, provider = '') {
  if (!candidate || !destination) {
    return {
      valid: false,
      rejection: createRejection(
        'Missing candidate or destination',
        candidate || {},
        destination || { name: '', city: '', state: '', country: '', latitude: 0, longitude: 0, radiusKm: 0 },
        provider
      ),
    };
  }

  // ── Rule 1: Coordinate boundary check (strongest signal) ──
  const radiusCheck = isWithinRadius(candidate, destination);
  if (radiusCheck !== null && !radiusCheck.within) {
    return {
      valid: false,
      rejection: createRejection(
        `Coordinates are ${radiusCheck.distanceKm.toFixed(1)}km from destination (max ${destination.radiusKm}km)`,
        candidate,
        destination,
        provider,
      ),
    };
  }

  // ── Rule 2: Country mismatch (hard reject) ──
  const countryOk = countryMatches(candidate, destination);
  if (countryOk === false) {
    return {
      valid: false,
      rejection: createRejection(
        `Country mismatch: candidate is in "${candidate.country || 'unknown'}", destination is in "${destination.country}"`,
        candidate,
        destination,
        provider,
      ),
    };
  }

  // ── Rule 3: City mismatch (reject ONLY when coordinates are also missing or outside) ──
  const cityOk = cityMatches(candidate, destination);

  // ── Rule 4: Name/address contains obviously wrong location ──
  const wrongCity = nameContainsDifferentLocation(candidate, destination);
  if (wrongCity) {
    return {
      valid: false,
      rejection: createRejection(
        `Name/address references distant location "${wrongCity}"`,
        candidate,
        destination,
        provider,
      ),
    };
  }

  // ── Rule 5: No coordinates AND city mismatch → reject ──
  if (radiusCheck === null && cityOk === false) {
    return {
      valid: false,
      rejection: createRejection(
        'No coordinates to verify and city does not match — cannot confirm location',
        candidate,
        destination,
        provider,
      ),
    };
  }

  // ── Rule 6: No coordinates AND no city data → reject (cannot confirm) ──
  if (radiusCheck === null && cityOk === null) {
    return {
      valid: false,
      rejection: createRejection(
        'No coordinates and no city data — cannot confirm location belongs to destination',
        candidate,
        destination,
        provider,
      ),
    };
  }

  // ── Rule 7: Coordinates are within radius but city mismatches → warn but allow ──
  // Coordinates are the strongest signal; if they confirm proximity, city data
  // discrepancies (e.g. suburb name vs city name) should not block the candidate.
  if (radiusCheck !== null && radiusCheck.within && cityOk === false) {
    logger.warn(`[destinationLock] Candidate "${candidate.name}" city mismatch but coordinates confirm proximity (${radiusCheck.distanceKm.toFixed(1)}km) — allowing`);
  }

  return { valid: true, rejection: null };
}

/**
 * Filter an array of candidates against the destination boundary.
 * Returns only valid candidates and logs all rejections.
 *
 * @param {Array} candidates - Array of candidate objects
 * @param {object} destination - Canonical destination from resolveDestination()
 * @param {string} [provider] - Provider name for logging
 * @returns {{ accepted: Array, rejected: Array, rejectionLog: Array }}
 */
export function filterCandidates(candidates, destination, provider = '') {
  const accepted = [];
  const rejected = [];
  const rejectionLog = [];

  for (const candidate of (candidates || [])) {
    const { valid, rejection } = validateCandidate(candidate, destination, provider);
    if (valid) {
      accepted.push(candidate);
    } else {
      rejected.push(candidate);
      rejectionLog.push(rejection);
    }
  }

  if (rejected.length > 0) {
    logger.info(
      `[destinationLock] ${provider || 'Provider'}: ${accepted.length} accepted, ${rejected.length} rejected out of ${(candidates || []).length} candidates`
    );
    for (const r of rejectionLog) {
      logger.warn(
        `[destinationLock] REJECTED: "${r.candidate.name}" — ${r.reason} (provider: ${r.provider})`
      );
    }
  }

  return { accepted, rejected, rejectionLog };
}

/**
 * Validate and filter Google place results (attractions, restaurants, etc.).
 * Handles both the Google mapResult shape and the normalized candidate shape.
 *
 * @param {Array} places - Array of place objects from Google providers
 * @param {object} destination - Canonical destination
 * @param {string} [provider] - Provider name
 * @returns {{ accepted: Array, rejected: Array, rejectionLog: Array }}
 */
export function filterPlaces(places, destination, provider = 'google') {
  // Normalize Google shape to candidate shape for validation
  const candidates = (places || []).map((p) => ({
    name: p.name || '',
    address: p.address || '',
    city: p.city || p.suburb || p.district || '',
    state: p.state || '',
    country: p.country || '',
    latitude: p.coordinates?.lat ?? p.latitude ?? null,
    longitude: p.coordinates?.lng ?? p.longitude ?? null,
    provider: p.provider || provider,
    providerId: p.placeId || p.id || '',
    // Preserve original fields
    _original: p,
  }));

  const result = filterCandidates(candidates, destination, provider);

  // Map back to original place objects
  result.accepted = result.accepted.map((c) => c._original);
  result.rejected = result.rejected.map((c) => c._original);

  return result;
}

/**
 * Get a summary of the destination lock configuration.
 * Useful for logging and debugging.
 */
export function getDestinationLockSummary(destination) {
  if (!destination) return { configured: false };
  return {
    configured: true,
    destination: destination.name,
    city: destination.city,
    country: destination.country,
    latitude: destination.latitude,
    longitude: destination.longitude,
    radiusKm: destination.radiusKm,
    isMetro: destination.isMetro,
    metro: destination.metro ? {
      allowedSuburbs: destination.metro.allowedSuburbs,
    } : null,
  };
}

export default {
  resolveDestination,
  validateCandidate,
  filterCandidates,
  filterPlaces,
  normalizeDestinationName,
  getDestinationLockSummary,
  METRO_AREAS,
  DEFAULT_RADIUS_KM,
};
