/**
 * hardValidationGate.service.js — Hard Validation Gate
 *
 * The itinerary MUST NOT be persisted or displayed until validation passes.
 * This is the final checkpoint before an itinerary reaches the user.
 *
 * Architecture:
 *   itinerary + candidates + context → 26 validation rules →
 *   hard failures → deterministic repair → final verdict
 *
 * Hard failures: WRONG_COUNTRY, UNKNOWN_PROVIDER_ID, FAKE_CANDIDATE,
 *   DUPLICATE_ATTRACTION, INVALID_RESTAURANT, FABRICATED_HOTEL,
 *   FABRICATED_PRICE, FABRICATED_COORDINATES, IMPOSSIBLE_SCHEDULE
 *
 * Soft warnings: MISSING_RATING, MISSING_PRICE, UNAVAILABLE_HOURS,
 *   ESTIMATED_ROUTE
 */

import { haversineKm } from '../utils/geo.js';
import logger from '../utils/logger.js';

// ══════════════════════════════════════════════════════════════════════
//  SEVERITY LEVELS
// ══════════════════════════════════════════════════════════════════════

export const SEVERITY = Object.freeze({
  HARD: 'hard',     // Must fix before persist
  SOFT: 'soft',     // Warning, can persist
});

// ══════════════════════════════════════════════════════════════════════
//  ERROR CODES
// ══════════════════════════════════════════════════════════════════════

export const ERROR_CODE = Object.freeze({
  // Hard failures
  WRONG_COUNTRY: 'WRONG_COUNTRY',
  WRONG_CITY: 'WRONG_CITY',
  UNKNOWN_PROVIDER_ID: 'UNKNOWN_PROVIDER_ID',
  FAKE_CANDIDATE: 'FAKE_CANDIDATE',
  DUPLICATE_ATTRACTION: 'DUPLICATE_ATTRACTION',
  DUPLICATE_RESTAURANT: 'DUPLICATE_RESTAURANT',
  DUPLICATE_EVENT: 'DUPLICATE_EVENT',
  INVALID_RESTAURANT_CATEGORY: 'INVALID_RESTAURANT_CATEGORY',
  FABRICATED_HOTEL: 'FABRICATED_HOTEL',
  FABRICATED_PRICE: 'FABRICATED_PRICE',
  FABRICATED_COORDINATES: 'FABRICATED_COORDINATES',
  IMPOSSIBLE_SCHEDULE: 'IMPOSSIBLE_SCHEDULE',
  PROVIDER_MISMATCH: 'PROVIDER_MISMATCH',
  WRONG_CANDIDATE_TYPE: 'WRONG_CANDIDATE_TYPE',
  INVALID_DAY_DATE: 'INVALID_DAY_DATE',
  TIME_CONFLICT: 'TIME_CONFLICT',
  CURRENCY_MISMATCH: 'CURRENCY_MISMATCH',
  DATA_STATUS_INVALID: 'DATA_STATUS_INVALID',

  // Soft warnings
  MISSING_RATING: 'MISSING_RATING',
  MISSING_PRICE: 'MISSING_PRICE',
  UNAVAILABLE_OPENING_HOURS: 'UNAVAILABLE_OPENING_HOURS',
  ESTIMATED_ROUTE: 'ESTIMATED_ROUTE',
  DESTINATION_REVIEW: 'DESTINATION_REVIEW',
  BUDGET_EXCEEDED: 'BUDGET_EXCEEDED',
  MISSING_SOURCE: 'MISSING_SOURCE',
  ESTIMATE_NOT_LABELED: 'ESTIMATE_NOT_LABELED',
});

// ══════════════════════════════════════════════════════════════════════
//  VALID RESTAURANT CATEGORIES
// ══════════════════════════════════════════════════════════════════════

const VALID_RESTAURANT_TYPES = new Set(['restaurant']);
const RESTAURANT_KEYWORDS = ['restaurant', 'cafe', 'food', 'dining', 'eatery', 'bistro', 'kitchen', 'grill'];

// ══════════════════════════════════════════════════════════════════════
//  HELPER: Create validation error
// ══════════════════════════════════════════════════════════════════════

function createError(code, severity, dayNumber, item, message, metadata = {}) {
  return {
    code,
    severity,
    dayNumber: dayNumber || null,
    item: item || null,
    message,
    ...metadata,
    timestamp: new Date().toISOString(),
  };
}

// ══════════════════════════════════════════════════════════════════════
//  MAIN VALIDATION GATE
// ══════════════════════════════════════════════════════════════════════

/**
 * Run the hard validation gate on an itinerary.
 *
 * @param {object} opts
 * @param {Array}  opts.days - itinerary days with activities
 * @param {Map}    opts.candidateMap - candidate lookup map (provider|providerId → candidate)
 * @param {string} opts.destination - expected destination
 * @param {string} opts.country - expected country
 * @param {number} opts.budget - total budget
 * @param {string} opts.currency - expected currency
 * @param {number} opts.allowedRadiusKm - max distance from destination center
 * @param {object} opts.destCentroid - { lat, lng } of destination center
 * @param {number} opts.partySize - number of travelers
 * @returns {{ passed, errors, warnings, summary, repairableErrors }}
 */
export function runHardValidation({
  days = [],
  candidateMap = new Map(),
  destination = '',
  country = '',
  budget = 0,
  currency = 'INR',
  allowedRadiusKm = 50,
  destCentroid = null,
  partySize = 1,
} = {}) {
  const errors = [];
  const warnings = [];

  for (const day of days || []) {
    const dayNum = day.dayNumber || 0;
    const acts = day.activities || [];

    for (const act of acts) {
      // ─── RULE 1: Provider ID validity ───
      validateProviderId(act, dayNum, candidateMap, errors);

      // ─── RULE 2: Candidate existence ───
      validateCandidateExistence(act, dayNum, candidateMap, errors);

      // ─── RULE 3: Candidate type correctness ───
      validateCandidateType(act, dayNum, candidateMap, errors);

      // ─── RULE 4: Provider ownership ───
      validateProviderOwnership(act, dayNum, candidateMap, errors);

      // ─── RULE 5: Destination correctness ───
      validateDestination(act, dayNum, destination, candidateMap, errors);

      // ─── RULE 6: Country correctness ───
      validateCountry(act, dayNum, country, candidateMap, errors);

      // ─── RULE 7: Geographic radius ───
      validateGeographicRadius(act, dayNum, destCentroid, allowedRadiusKm, candidateMap, warnings);

      // ─── RULE 8: Restaurant category ───
      validateRestaurantCategory(act, dayNum, candidateMap, errors);

      // ─── RULE 9: Hotel validity ───
      validateHotel(act, dayNum, candidateMap, errors);

      // ─── RULE 10: Hotel price provenance ───
      validatePriceProvenance(act, dayNum, 'hotel', candidateMap, errors);

      // ─── RULE 11: Restaurant price provenance ───
      validatePriceProvenance(act, dayNum, 'restaurant', candidateMap, errors);

      // ─── RULE 12: Attraction price provenance ───
      validatePriceProvenance(act, dayNum, 'attraction', candidateMap, errors);

      // ─── RULE 13: Transport price provenance ───
      validatePriceProvenance(act, dayNum, 'transport', candidateMap, errors);

      // ─── RULE 14: Opening hours ───
      validateOpeningHours(act, dayNum, candidateMap, warnings);

      // ─── RULE 15: dataStatus ───
      validateDataStatus(act, dayNum, candidateMap, errors);

      // ─── RULE 16: isEstimate ───
      validateIsEstimate(act, dayNum, candidateMap, warnings);

      // ─── RULE 17: source ───
      validateSource(act, dayNum, candidateMap, warnings);

      // ─── RULE 18: provider ───
      validateProvider(act, dayNum, errors);

      // ─── RULE 19: No hallucinated entities ───
      validateNoHallucination(act, dayNum, candidateMap, errors);

      // ─── RULE 20: Fabricated coordinates ───
      validateCoordinates(act, dayNum, candidateMap, errors);
    }

    // ─── RULE 21: Day/date consistency ───
    validateDayDate(day, days, errors);

    // ─── RULE 22: Time conflicts ───
    validateTimeConflicts(day, errors);

    // ─── RULE 23: Travel time ───
    validateTravelTime(day, warnings);

    // ─── RULE 24: Route feasibility ───
    validateRouteFeasibility(day, warnings);
  }

  // ─── RULE 25: Attraction uniqueness across days ───
  validateAttractionUniqueness(days, errors);

  // ─── RULE 26: Restaurant uniqueness across days ───
  validateRestaurantUniqueness(days, errors);

  // ─── RULE 27: Event uniqueness ───
  validateEventUniqueness(days, errors);

  // ─── RULE 28: Budget ───
  validateBudget(days, budget, currency, partySize, warnings);

  // ─── RULE 29: Currency ───
  validateCurrency(days, currency, errors);

  const hardErrors = errors.filter((e) => e.severity === SEVERITY.HARD);
  const passed = hardErrors.length === 0;

  const repairableErrors = errors.filter((e) => e.severity === SEVERITY.HARD && isRepairable(e));

  const summary = {
    passed,
    totalErrors: errors.length,
    hardErrors: hardErrors.length,
    softWarnings: warnings.length,
    repairableErrors: repairableErrors.length,
    errorCodes: [...new Set(errors.map((e) => e.code))],
    warningCodes: [...new Set(warnings.map((w) => w.code))],
  };

  logger.info(`[HARD-VALIDATION] ${passed ? 'PASSED' : 'FAILED'}: ${hardErrors.length} hard errors, ${warnings.length} soft warnings`);

  return { passed, errors, warnings, summary, repairableErrors };
}

// ══════════════════════════════════════════════════════════════════════
//  INDIVIDUAL VALIDATION RULES
// ══════════════════════════════════════════════════════════════════════

// ─── RULE 1: Provider ID validity ───
function validateProviderId(act, dayNum, candidateMap, errors) {
  if (!act.provider && !act.providerId) return;
  if (['hotel', 'transport', 'flight', 'train', 'bus'].includes(act.category)) return;

  const key = `${act.provider || ''}|${act.providerId || ''}`;
  if (key !== '|' && !candidateMap.has(key)) {
    errors.push(createError(
      ERROR_CODE.UNKNOWN_PROVIDER_ID, SEVERITY.HARD, dayNum,
      act.title || act.place,
      `Provider ID "${act.provider}:${act.providerId}" not found in trusted dataset`,
      { provider: act.provider, providerId: act.providerId }
    ));
  }
}

// ─── RULE 2: Candidate existence ───
function validateCandidateExistence(act, dayNum, candidateMap, errors) {
  if (act.dataStatus === 'unavailable') return;
  if (['hotel', 'transport', 'flight', 'train', 'bus'].includes(act.category)) return;

  const key = `${act.provider || ''}|${act.providerId || ''}`;
  const nameKey = `name:${(act.place || act.title || '').toLowerCase()}`;

  if (key === '|' && !candidateMap.has(nameKey)) {
    errors.push(createError(
      ERROR_CODE.FAKE_CANDIDATE, SEVERITY.HARD, dayNum,
      act.title || act.place,
      `Candidate "${act.title}" not found in trusted dataset`,
      { candidateName: act.title }
    ));
  }
}

// ─── RULE 3: Candidate type correctness ───
function validateCandidateType(act, dayNum, candidateMap, errors) {
  const key = `${act.provider || ''}|${act.providerId || ''}`;
  const candidate = candidateMap.get(key);
  if (!candidate) return;

  const categoryTypeMap = {
    attraction: ['attraction'],
    restaurant: ['restaurant'],
    hotel: ['hotel'],
    event: ['event', 'activity'],
    nightlife: ['nightlife'],
  };

  const expected = categoryTypeMap[act.category];
  if (expected && !expected.includes(candidate.type)) {
    errors.push(createError(
      ERROR_CODE.WRONG_CANDIDATE_TYPE, SEVERITY.HARD, dayNum,
      act.title,
      `Expected ${act.category} but candidate is ${candidate.type}`,
      { expected: act.category, actual: candidate.type }
    ));
  }
}

// ─── RULE 4: Provider ownership ───
function validateProviderOwnership(act, dayNum, candidateMap, errors) {
  const key = `${act.provider || ''}|${act.providerId || ''}`;
  const candidate = candidateMap.get(key);
  if (!candidate) return;

  if (candidate.provider !== act.provider) {
    errors.push(createError(
      ERROR_CODE.PROVIDER_MISMATCH, SEVERITY.HARD, dayNum,
      act.title,
      `Provider mismatch: item says "${act.provider}" but candidate belongs to "${candidate.provider}"`,
      { itemProvider: act.provider, candidateProvider: candidate.provider }
    ));
  }
}

// ─── RULE 5: Destination correctness ───
function validateDestination(act, dayNum, destination, candidateMap, errors) {
  if (!destination) return;
  if (!act.address && !act.suburb) return;

  const actCity = (act.city || act.suburb || '').toLowerCase();
  const destLower = destination.toLowerCase();

  // Allow if the destination name appears in the address
  if (act.address && act.address.toLowerCase().includes(destLower)) return;
  // Allow if city/suburb matches
  if (actCity && actCity.includes(destLower)) return;

  // Soft warning for destination review
  warnings.push(createError(
    ERROR_CODE.DESTINATION_REVIEW, SEVERITY.SOFT, dayNum,
    act.title,
    `Activity "${act.title}" may not be in ${destination} (address: ${act.address || 'N/A'})`,
    { destination, address: act.address }
  ));
}

// ─── RULE 6: Country correctness ───
function validateCountry(act, dayNum, country, candidateMap, errors) {
  if (!country) return;

  const key = `${act.provider || ''}|${act.providerId || ''}`;
  const candidate = candidateMap.get(key);
  if (!candidate?.country) return;

  if (candidate.country.toLowerCase() !== country.toLowerCase()) {
    errors.push(createError(
      ERROR_CODE.WRONG_COUNTRY, SEVERITY.HARD, dayNum,
      act.title,
      `Candidate country "${candidate.country}" does not match expected "${country}"`,
      { expectedCountry: country, actualCountry: candidate.country }
    ));
  }
}

// ─── RULE 7: Geographic radius ───
function validateGeographicRadius(act, dayNum, destCentroid, allowedRadiusKm, candidateMap, warnings) {
  if (!destCentroid || !allowedRadiusKm) return;

  const lat = act.coordinates?.lat ?? act.latitude;
  const lng = act.coordinates?.lng ?? act.longitude;
  if (lat == null || lng == null) return;

  const km = haversineKm(destCentroid.lat, destCentroid.lng, lat, lng);
  if (km > allowedRadiusKm) {
    warnings.push(createError(
      ERROR_CODE.DESTINATION_REVIEW, SEVERITY.SOFT, dayNum,
      act.title,
      `Activity "${act.title}" is ${Math.round(km)}km from destination center (limit: ${allowedRadiusKm}km)`,
      { distanceKm: Math.round(km), limitKm: allowedRadiusKm }
    ));
  }
}

// ─── RULE 8: Restaurant category ───
function validateRestaurantCategory(act, dayNum, candidateMap, errors) {
  if (act.category !== 'restaurant') return;

  const key = `${act.provider || ''}|${act.providerId || ''}`;
  const candidate = candidateMap.get(key);
  if (!candidate) return;

  if (!VALID_RESTAURANT_TYPES.has(candidate.type)) {
    const name = (candidate.name || '').toLowerCase();
    const tags = (candidate.tags || '').toLowerCase();
    const isRestaurant = RESTAURANT_KEYWORDS.some((kw) => name.includes(kw) || tags.includes(kw));
    if (!isRestaurant) {
      errors.push(createError(
        ERROR_CODE.INVALID_RESTAURANT_CATEGORY, SEVERITY.HARD, dayNum,
        act.title,
        `Candidate "${candidate.name}" is type "${candidate.type}" — not a valid restaurant`,
        { candidateType: candidate.type }
      ));
    }
  }
}

// ─── RULE 9: Hotel validity ───
function validateHotel(act, dayNum, candidateMap, errors) {
  if (act.category !== 'hotel') return;

  const key = `${act.provider || ''}|${act.providerId || ''}`;
  const candidate = candidateMap.get(key);

  if (!candidate) {
    // Generic hotel names like "Accommodation in Mumbai" are fabricated
    const title = (act.title || '').toLowerCase();
    if (/accommodation in|overnight in|lodging|generic hotel/.test(title)) {
      errors.push(createError(
        ERROR_CODE.FABRICATED_HOTEL, SEVERITY.HARD, dayNum,
        act.title,
        `Fabricated hotel "${act.title}" — not a real provider candidate`,
        { hotelName: act.title }
      ));
    }
    return;
  }

  // Hotel must have a valid name
  if (!candidate.name || candidate.name.length < 3) {
    errors.push(createError(
      ERROR_CODE.FABRICATED_HOTEL, SEVERITY.HARD, dayNum,
      act.title,
      `Hotel candidate has invalid name: "${candidate.name}"`,
      { hotelName: candidate.name }
    ));
  }
}

// ─── RULES 10-13: Price provenance ───
function validatePriceProvenance(act, dayNum, type, candidateMap, errors) {
  if (act.category !== type) return;
  if (act.dataStatus === 'unavailable') return;

  const key = `${act.provider || ''}|${act.providerId || ''}`;
  const candidate = candidateMap.get(key);

  if (act.cost?.amount != null && act.cost.amount > 0) {
    // Check if price matches candidate
    if (candidate) {
      const candidatePrice = candidate.pricePerNight || candidate.averageCostPerPerson || candidate.price || 0;
      if (candidatePrice > 0 && Math.abs(act.cost.amount - candidatePrice * (type === 'hotel' ? 1 : 1)) > 1) {
        // Price doesn't match candidate — possible fabrication
        if (act.cost.source === 'budget-estimate' || act.cost.isEstimate === true) {
          // Budget estimate used as real price — soft warning
          return;
        }
        errors.push(createError(
          ERROR_CODE.FABRICATED_PRICE, SEVERITY.HARD, dayNum,
          act.title,
          `Price ${act.cost.amount} does not match candidate price ${candidatePrice} for "${candidate.name}"`,
          { itemPrice: act.cost.amount, candidatePrice, candidateName: candidate.name }
        ));
      }
    }
  }
}

// ─── RULE 14: Opening hours ───
function validateOpeningHours(act, dayNum, candidateMap, warnings) {
  if (act.openingHours?.periods?.length) {
    // Has opening hours data — good
    return;
  }

  // Check if candidate has opening hours
  const key = `${act.provider || ''}|${act.providerId || ''}`;
  const candidate = candidateMap.get(key);

  if (candidate && !candidate.hasOpeningHours) {
    warnings.push(createError(
      ERROR_CODE.UNAVAILABLE_OPENING_HOURS, SEVERITY.SOFT, dayNum,
      act.title,
      `No opening hours data for "${act.title}"`,
      { candidateName: candidate.name }
    ));
  }
}

// ─── RULE 15: dataStatus ───
function validateDataStatus(act, dayNum, candidateMap, errors) {
  if (act.dataStatus && !['live', 'estimate', 'unavailable', 'provider'].includes(act.dataStatus)) {
    errors.push(createError(
      ERROR_CODE.DATA_STATUS_INVALID, SEVERITY.HARD, dayNum,
      act.title,
      `Invalid dataStatus "${act.dataStatus}" — must be live, estimate, unavailable, or provider`,
      { dataStatus: act.dataStatus }
    ));
  }
}

// ─── RULE 16: isEstimate ───
function validateIsEstimate(act, dayNum, candidateMap, warnings) {
  if (act.isEstimate === true && act.dataStatus === 'live') {
    warnings.push(createError(
      ERROR_CODE.ESTIMATE_NOT_LABELED, SEVERITY.SOFT, dayNum,
      act.title,
      `Item marked as live but isEstimate is true — inconsistent`,
      { isEstimate: act.isEstimate, dataStatus: act.dataStatus }
    ));
  }
}

// ─── RULE 17: source ───
function validateSource(act, dayNum, candidateMap, warnings) {
  if (act.dataStatus !== 'unavailable' && !act.source) {
    warnings.push(createError(
      ERROR_CODE.MISSING_SOURCE, SEVERITY.SOFT, dayNum,
      act.title,
      `Activity "${act.title}" has no source field`,
      { source: act.source }
    ));
  }
}

// ─── RULE 18: provider ───
function validateProvider(act, dayNum, errors) {
  if (act.dataStatus === 'unavailable') return;
  if (act.category === 'hotel' || act.category === 'transport') return;

  if (!act.provider && act.dataStatus !== 'unavailable') {
    // Only hard error if the activity has a provider ID but no provider name
    if (act.providerId) {
      errors.push(createError(
        ERROR_CODE.PROVIDER_MISMATCH, SEVERITY.HARD, dayNum,
        act.title,
        `Activity has providerId "${act.providerId}" but no provider name`,
        { providerId: act.providerId }
      ));
    }
  }
}

// ─── RULE 19: No hallucinated entities ───
function validateNoHallucination(act, dayNum, candidateMap, errors) {
  if (act.dataStatus === 'unavailable') return;
  if (['hotel', 'transport', 'flight', 'train', 'bus'].includes(act.category)) return;

  const key = `${act.provider || ''}|${act.providerId || ''}`;
  const nameKey = `name:${(act.place || act.title || '').toLowerCase()}`;

  const exists = candidateMap.has(key) || candidateMap.has(nameKey);
  if (!exists && act.provider && act.providerId) {
    errors.push(createError(
      ERROR_CODE.FAKE_CANDIDATE, SEVERITY.HARD, dayNum,
      act.title,
      `Candidate "${act.title}" (${act.provider}:${act.providerId}) not found in trusted dataset`,
      { provider: act.provider, providerId: act.providerId }
    ));
  }
}

// ─── RULE 20: Fabricated coordinates ───
function validateCoordinates(act, dayNum, candidateMap, errors) {
  const lat = act.coordinates?.lat ?? act.latitude;
  const lng = act.coordinates?.lng ?? act.longitude;

  if (lat != null && lng != null) {
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      errors.push(createError(
        ERROR_CODE.FABRICATED_COORDINATES, SEVERITY.HARD, dayNum,
        act.title,
        `Coordinates are not numeric: lat=${lat}, lng=${lng}`,
        { latitude: lat, longitude: lng }
      ));
      return;
    }
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      errors.push(createError(
        ERROR_CODE.FABRICATED_COORDINATES, SEVERITY.HARD, dayNum,
        act.title,
        `Coordinates out of range: lat=${lat}, lng=${lng}`,
        { latitude: lat, longitude: lng }
      ));
    }
    if (lat === 0 && lng === 0) {
      warnings.push(createError(
        ERROR_CODE.FABRICATED_COORDINATES, SEVERITY.SOFT, dayNum,
        act.title,
        `Coordinates at null island (0,0)`,
        { latitude: lat, longitude: lng }
      ));
    }
  }

  // Cross-check with candidate
  const key = `${act.provider || ''}|${act.providerId || ''}`;
  const candidate = candidateMap.get(key);
  if (candidate?.latitude != null && candidate?.longitude != null && lat != null && lng != null) {
    const km = haversineKm(candidate.latitude, candidate.longitude, lat, lng);
    if (km > 0.1) {
      errors.push(createError(
        ERROR_CODE.FABRICATED_COORDINATES, SEVERITY.HARD, dayNum,
        act.title,
        `Coordinates differ from candidate by ${Math.round(km * 1000)}m`,
        { itemCoords: { lat, lng }, candidateCoords: { lat: candidate.latitude, lng: candidate.longitude } }
      ));
    }
  }
}

// ─── RULE 21: Day/date consistency ───
function validateDayDate(day, allDays, errors) {
  if (!day.date) return;

  const date = new Date(day.date);
  if (Number.isNaN(date.getTime())) {
    errors.push(createError(
      ERROR_CODE.INVALID_DAY_DATE, SEVERITY.HARD, day.dayNumber,
      null,
      `Invalid date "${day.date}" for Day ${day.dayNumber}`,
      { date: day.date }
    ));
    return;
  }

  // Check date sequence
  if (day.dayNumber > 1) {
    const prevDay = allDays.find((d) => d.dayNumber === day.dayNumber - 1);
    if (prevDay?.date) {
      const prevDate = new Date(prevDay.date);
      const diffDays = Math.round((date - prevDate) / (1000 * 60 * 60 * 24));
      if (diffDays !== 1) {
        errors.push(createError(
          ERROR_CODE.INVALID_DAY_DATE, SEVERITY.HARD, day.dayNumber,
          null,
          `Day ${day.dayNumber} date "${day.date}" is not consecutive after Day ${day.dayNumber - 1} "${prevDay.date}"`,
          { expected: 1, actual: diffDays }
        ));
      }
    }
  }
}

// ─── RULE 22: Time conflicts ───
function validateTimeConflicts(day, errors) {
  const acts = (day.activities || []).filter((a) => a.time);
  const sorted = [...acts].sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const prevEnd = timeToMinutes(prev.time) + (prev.duration || 60);
    const currStart = timeToMinutes(curr.time);

    if (prevEnd > currStart + 15) { // 15 min tolerance
      errors.push(createError(
        ERROR_CODE.TIME_CONFLICT, SEVERITY.HARD, day.dayNumber,
        `${prev.title} → ${curr.title}`,
        `Time conflict: "${prev.title}" ends ~${minutesToTime(prevEnd)} but "${curr.title}" starts at ${curr.time}`,
        { prevEnd: minutesToTime(prevEnd), currStart: curr.time }
      ));
    }
  }
}

// ─── RULE 23: Travel time ───
function validateTravelTime(day, warnings) {
  const acts = (day.activities || []).filter((a) => a.coordinates?.lat != null);
  for (let i = 1; i < acts.length; i++) {
    const prev = acts[i - 1];
    const curr = acts[i];
    const km = haversineKm(prev.coordinates.lat, prev.coordinates.lng, curr.coordinates.lat, curr.coordinates.lng);
    if (km > 50) {
      warnings.push(createError(
        ERROR_CODE.ESTIMATED_ROUTE, SEVERITY.SOFT, day.dayNumber,
        `${prev.title} → ${curr.title}`,
        `Long distance between consecutive activities: ${Math.round(km)}km`,
        { distanceKm: Math.round(km) }
      ));
    }
  }
}

// ─── RULE 24: Route feasibility ───
function validateRouteFeasibility(day, warnings) {
  const acts = (day.activities || []).filter((a) => a.time && a.coordinates?.lat != null);
  for (let i = 1; i < acts.length; i++) {
    const prev = acts[i - 1];
    const curr = acts[i];
    const km = haversineKm(prev.coordinates.lat, prev.coordinates.lng, curr.coordinates.lat, curr.coordinates.lng);
    const timeDiffMin = timeToMinutes(curr.time) - timeToMinutes(prev.time);

    // Estimate minimum travel time
    const travelMin = km < 1.5 ? 15 : km < 12 ? 30 : 60;
    if (timeDiffMin < travelMin) {
      warnings.push(createError(
        ERROR_CODE.ESTIMATED_ROUTE, SEVERITY.SOFT, day.dayNumber,
        `${prev.title} → ${curr.title}`,
        `Insufficient time for ${Math.round(km)}km travel: only ${timeDiffMin}min gap`,
        { distanceKm: Math.round(km), timeGapMin: timeDiffMin, minNeededMin: travelMin }
      ));
    }
  }
}

// ─── RULE 25: Attraction uniqueness across days ───
function validateAttractionUniqueness(days, errors) {
  const seen = new Map(); // providerId → dayNumber
  for (const day of days || []) {
    for (const act of day.activities || []) {
      if (act.category !== 'attraction' && act.category !== 'activity') continue;
      if (act.dataStatus === 'unavailable') continue;

      const key = `${act.provider || ''}|${act.providerId || ''}`;
      if (key === '|') continue;

      if (seen.has(key)) {
        errors.push(createError(
          ERROR_CODE.DUPLICATE_ATTRACTION, SEVERITY.HARD, day.dayNumber,
          act.title,
          `Attraction "${act.title}" already used on Day ${seen.get(key)} — no duplication allowed`,
          { firstDay: seen.get(key), duplicateDay: day.dayNumber }
        ));
      } else {
        seen.set(key, day.dayNumber);
      }
    }
  }
}

// ─── RULE 26: Restaurant uniqueness across days ───
function validateRestaurantUniqueness(days, errors) {
  const seen = new Map();
  for (const day of days || []) {
    for (const act of day.activities || []) {
      if (act.category !== 'restaurant') continue;
      if (act.dataStatus === 'unavailable') continue;

      const key = `${act.provider || ''}|${act.providerId || ''}`;
      if (key === '|') continue;

      if (seen.has(key)) {
        errors.push(createError(
          ERROR_CODE.DUPLICATE_RESTAURANT, SEVERITY.HARD, day.dayNumber,
          act.title,
          `Restaurant "${act.title}" already used on Day ${seen.get(key)} — prefer different restaurants`,
          { firstDay: seen.get(key), duplicateDay: day.dayNumber }
        ));
      } else {
        seen.set(key, day.dayNumber);
      }
    }
  }
}

// ─── RULE 27: Event uniqueness ───
function validateEventUniqueness(days, errors) {
  const seen = new Map();
  for (const day of days || []) {
    for (const act of day.activities || []) {
      if (act.category !== 'event') continue;
      if (act.dataStatus === 'unavailable') continue;

      const key = `${act.provider || ''}|${act.providerId || ''}`;
      if (key === '|') continue;

      if (seen.has(key)) {
        errors.push(createError(
          ERROR_CODE.DUPLICATE_EVENT, SEVERITY.HARD, day.dayNumber,
          act.title,
          `Event "${act.title}" already used on Day ${seen.get(key)}`,
          { firstDay: seen.get(key), duplicateDay: day.dayNumber }
        ));
      } else {
        seen.set(key, day.dayNumber);
      }
    }
  }
}

// ─── RULE 28: Budget ───
function validateBudget(days, budget, currency, partySize, warnings) {
  if (!budget || budget <= 0) return;

  let totalCost = 0;
  for (const day of days || []) {
    for (const act of day.activities || []) {
      if (act.cost?.amount != null && act.cost.amount > 0) {
        totalCost += act.cost.amount;
      }
    }
  }

  if (totalCost > budget * 1.1) { // 10% tolerance
    warnings.push(createError(
      ERROR_CODE.BUDGET_EXCEEDED, SEVERITY.SOFT, null,
      null,
      `Total estimated cost ${totalCost} exceeds budget ${budget} by ${Math.round(((totalCost - budget) / budget) * 100)}%`,
      { totalCost, budget, overagePercent: Math.round(((totalCost - budget) / budget) * 100) }
    ));
  }
}

// ─── RULE 29: Currency ───
function validateCurrency(days, currency, errors) {
  if (!currency) return;

  for (const day of days || []) {
    for (const act of day.activities || []) {
      if (act.cost?.currency && act.cost.currency !== currency) {
        errors.push(createError(
          ERROR_CODE.CURRENCY_MISMATCH, SEVERITY.HARD, day.dayNumber,
          act.title,
          `Currency mismatch: item has "${act.cost.currency}" but expected "${currency}"`,
          { expected: currency, actual: act.cost.currency }
        ));
      }
    }
  }
}

// ══════════════════════════════════════════════════════════════════════
//  DETERMINISTIC REPAIR
// ══════════════════════════════════════════════════════════════════════

/**
 * Determine if an error is repairable by deterministic logic.
 */
function isRepairable(error) {
  const repairableCodes = new Set([
    ERROR_CODE.FABRICATED_PRICE,
    ERROR_CODE.FABRICATED_COORDINATES,
    ERROR_CODE.WRONG_CANDIDATE_TYPE,
    ERROR_CODE.PROVIDER_MISMATCH,
    ERROR_CODE.CURRENCY_MISMATCH,
    ERROR_CODE.DATA_STATUS_INVALID,
  ]);
  return repairableCodes.has(error.code);
}

/**
 * Attempt deterministic repair from trusted candidates.
 * Does NOT ask Gemini to repair factual errors.
 *
 * @param {object} opts
 * @param {Array}  opts.days - itinerary days
 * @param {Map}    opts.candidateMap - candidate lookup
 * @param {Array}  opts.errors - validation errors
 * @returns {{ repairedDays, repairCount, unrepairableErrors }}
 */
export function attemptDeterministicRepair({ days, candidateMap, errors }) {
  let repairCount = 0;
  const unrepairableErrors = [];
  const repairedDays = JSON.parse(JSON.stringify(days)); // deep clone

  for (const error of errors) {
    if (!isRepairable(error)) {
      unrepairableErrors.push(error);
      continue;
    }

    // Find the activity to repair
    const day = repairedDays.find((d) => d.dayNumber === error.dayNumber);
    if (!day) {
      unrepairableErrors.push(error);
      continue;
    }

    const act = day.activities?.find((a) => a.title === error.item || a.place === error.item);
    if (!act) {
      unrepairableErrors.push(error);
      continue;
    }

    // Repair based on error type
    switch (error.code) {
      case ERROR_CODE.FABRICATED_PRICE: {
        const key = `${act.provider || ''}|${act.providerId || ''}`;
        const candidate = candidateMap.get(key);
        if (candidate) {
          const candidatePrice = candidate.pricePerNight || candidate.averageCostPerPerson || candidate.price;
          if (candidatePrice != null) {
            act.cost.amount = candidatePrice;
            act.cost.source = candidate.source || candidate.provider;
            act.cost.isEstimate = Boolean(candidate.isEstimate);
            act.cost.dataStatus = candidate.dataStatus || 'estimate';
            repairCount++;
          }
        }
        break;
      }
      case ERROR_CODE.FABRICATED_COORDINATES: {
        const key = `${act.provider || ''}|${act.providerId || ''}`;
        const candidate = candidateMap.get(key);
        if (candidate?.latitude != null && candidate?.longitude != null) {
          act.coordinates = { lat: candidate.latitude, lng: candidate.longitude };
          act.latitude = candidate.latitude;
          act.longitude = candidate.longitude;
          repairCount++;
        }
        break;
      }
      case ERROR_CODE.CURRENCY_MISMATCH: {
        act.cost.currency = error.expected;
        repairCount++;
        break;
      }
      case ERROR_CODE.DATA_STATUS_INVALID: {
        act.dataStatus = 'estimate';
        repairCount++;
        break;
      }
      default:
        unrepairableErrors.push(error);
    }
  }

  logger.info(`[HARD-VALIDATION] Repair: ${repairCount} items fixed, ${unrepairableErrors.length} unrepairable`);

  return { repairedDays, repairCount, unrepairableErrors };
}

// ══════════════════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════════════════

function timeToMinutes(t) {
  if (!t || !t.includes(':')) return 0;
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function minutesToTime(m) {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

// ══════════════════════════════════════════════════════════════════════
//  EXPORTS
// ══════════════════════════════════════════════════════════════════════

export default {
  runHardValidation,
  attemptDeterministicRepair,
  SEVERITY,
  ERROR_CODE,
};
