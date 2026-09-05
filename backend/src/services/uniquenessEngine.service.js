/**
 * Uniqueness Engine — Cross-day duplicate prevention for itinerary generation.
 *
 * Architecture:
 *   Global candidate pool → Stable identity → Normalized identity →
 *   Used-tracking Sets → Exclusion penalty → Uniqueness enforcement
 *
 * Design rules:
 *   - Every candidate has a stable identity: provider + providerId
 *   - Normalized identity: lowercase, no punctuation, normalized whitespace
 *   - usedAttractions, usedRestaurants, usedEvents track cross-day usage
 *   - Already-used candidates receive a strong exclusion penalty
 *   - Unused candidates are always preferred
 *   - Repetition only allowed for:
 *     * Transport hubs (flight/train/bus endpoints)
 *     * Accommodation (same hotel for multi-night stay)
 *     * User explicitly requests it
 *     * No valid alternative exists (marked internally)
 *   - Gemini does NOT perform final duplicate prevention
 *   - Gemini receives only pre-filtered and allocated candidate groups
 *
 * The engine is used in two places:
 *   1. Before AI planning: pre-filter candidates to enforce uniqueness
 *   2. After resolution: validate cross-day uniqueness in the final itinerary
 */

import logger from '../utils/logger.js';

// ══════════════════════════════════════════════════════════════════════
//  IDENTITY
// ══════════════════════════════════════════════════════════════════════

/**
 * Build a stable identity key from a candidate.
 * Format: "provider|providerId"
 */
export function stableId(candidate) {
  const provider = (candidate.provider || '').toLowerCase();
  const providerId = candidate.providerId || '';
  return `${provider}|${providerId}`;
}

/**
 * Build a normalized identity key from a candidate's name.
 * Normalization: lowercase, remove punctuation, normalize whitespace, remove common suffixes.
 */
export function normalizedId(candidate) {
  const raw = (candidate.name || candidate.place || candidate.title || '').trim();
  let normalized = raw
    .toLowerCase()
    // Remove punctuation (except hyphens in compound words)
    .replace(/[^\w\s-]/g, '')
    // Normalize whitespace (multiple spaces → single space)
    .replace(/\s+/g, ' ')
    // Remove common suffixes that don't affect identity
    .replace(/\s+(museum|fort|palace|temple|church|mosque|garden|park|beach|viewpoint|market|tower|monument|cave|caves|falls|waterfall|lake|hill|point|view|sanctuary|shrine|gate|dargah|masjid|vihara|stupa|cafe|restaurant|hotel|inn|lodge|hostel)$/i, '')
    .trim();
  return normalized;
}

/**
 * Build a composite identity key combining stable + normalized.
 * Used for cross-referencing candidates that might have different provider IDs
 * but refer to the same physical place.
 */
export function compositeId(candidate) {
  return `${stableId(candidate)}::${normalizedId(candidate)}`;
}

// ══════════════════════════════════════════════════════════════════════
//  TRACKING SETS
// ══════════════════════════════════════════════════════════════════════

/**
 * Create a fresh tracking state for a trip.
 * Each Set tracks used identities for a specific category.
 */
export function createTrackingState() {
  return {
    usedAttractions: new Set(),
    usedRestaurants: new Set(),
    usedEvents: new Set(),
    usedNightlife: new Set(),
    // Track normalized names to catch near-duplicates
    usedAttractionNames: new Set(),
    usedRestaurantNames: new Set(),
    usedEventNames: new Set(),
    // Track reasons when repetition is forced
    repetitionReasons: new Map(),
  };
}

// ══════════════════════════════════════════════════════════════════════
//  EXCLUSION CHECK
// ══════════════════════════════════════════════════════════════════════

/**
 * Check if a candidate has already been used in the itinerary.
 *
 * @param {object} candidate - The candidate to check
 * @param {string} category - 'attraction' | 'restaurant' | 'event' | 'nightlife'
 * @param {object} state - Tracking state from createTrackingState()
 * @returns {{ excluded: boolean, reason: string|null }}
 */
export function isExcluded(candidate, category, state) {
  if (!candidate || !state) return { excluded: false, reason: null };

  const sid = stableId(candidate);
  const nid = normalizedId(candidate);

  // Transport and hotel categories are never excluded (legitimate repeats)
  if (category === 'transport' || category === 'flight' || category === 'train' || category === 'bus') {
    return { excluded: false, reason: null };
  }
  if (category === 'hotel') {
    return { excluded: false, reason: null };
  }

  // Check attraction exclusions
  if (category === 'attraction' || category === 'activity') {
    if (state.usedAttractions.has(sid)) {
      return { excluded: true, reason: `Already used as attraction (stable ID: ${sid})` };
    }
    if (nid && state.usedAttractionNames.has(nid)) {
      return { excluded: true, reason: `Already used as attraction (normalized name: ${nid})` };
    }
  }

  // Check restaurant exclusions
  if (category === 'restaurant') {
    if (state.usedRestaurants.has(sid)) {
      return { excluded: true, reason: `Already used as restaurant (stable ID: ${sid})` };
    }
    if (nid && state.usedRestaurantNames.has(nid)) {
      return { excluded: true, reason: `Already used as restaurant (normalized name: ${nid})` };
    }
  }

  // Check event exclusions
  if (category === 'event') {
    if (state.usedEvents.has(sid)) {
      return { excluded: true, reason: `Already used as event (stable ID: ${sid})` };
    }
    if (nid && state.usedEventNames.has(nid)) {
      return { excluded: true, reason: `Already used as event (normalized name: ${nid})` };
    }
  }

  // Check nightlife exclusions
  if (category === 'nightlife') {
    if (state.usedNightlife.has(sid)) {
      return { excluded: true, reason: `Already used as nightlife (stable ID: ${sid})` };
    }
  }

  return { excluded: false, reason: null };
}

// ══════════════════════════════════════════════════════════════════════
//  MARK AS USED
// ══════════════════════════════════════════════════════════════════════

/**
 * Mark a candidate as used in the tracking state.
 *
 * @param {object} candidate - The candidate to mark
 * @param {string} category - 'attraction' | 'restaurant' | 'event' | 'nightlife'
 * @param {object} state - Tracking state from createTrackingState()
 */
export function markAsUsed(candidate, category, state) {
  if (!candidate || !state) return;

  const sid = stableId(candidate);
  const nid = normalizedId(candidate);

  if (category === 'attraction' || category === 'activity') {
    state.usedAttractions.add(sid);
    if (nid) state.usedAttractionNames.add(nid);
  } else if (category === 'restaurant') {
    state.usedRestaurants.add(sid);
    if (nid) state.usedRestaurantNames.add(nid);
  } else if (category === 'event') {
    state.usedEvents.add(sid);
    if (nid) state.usedEventNames.add(nid);
  } else if (category === 'nightlife') {
    state.usedNightlife.add(sid);
  }
}

// ══════════════════════════════════════════════════════════════════════
//  FILTER CANDIDATES
// ══════════════════════════════════════════════════════════════════════

/**
 * Filter a pool of candidates to exclude already-used items.
 * Returns only candidates that haven't been used yet.
 *
 * @param {Array} pool - Candidate pool to filter
 * @param {string} category - Category of candidates
 * @param {object} state - Tracking state
 * @returns {{ available: Array, excludedCount: number }}
 */
export function filterAvailable(pool, category, state) {
  const available = [];
  let excludedCount = 0;

  for (const candidate of pool || []) {
    const { excluded } = isExcluded(candidate, category, state);
    if (excluded) {
      excludedCount++;
    } else {
      available.push(candidate);
    }
  }

  return { available, excludedCount };
}

/**
 * Pick distinct candidates from a pool, enforcing uniqueness.
 * When the pool is exhausted, returns fewer picks rather than repeating.
 *
 * @param {Array} pool - Candidate pool
 * @param {string} category - Category of candidates
 * @param {number} n - Number of candidates to pick
 * @param {object} state - Tracking state (mutated: used items are marked)
 * @param {string} [label] - Label for logging
 * @returns {{ picks: Array, notes: string[] }}
 */
export function pickDistinct(pool, category, n, state, label = 'candidates') {
  const picks = [];
  const notes = [];
  let fresh = 0;

  // First pass: pick truly unused items
  for (const item of pool || []) {
    if (picks.length >= n) break;
    const { excluded } = isExcluded(item, category, state);
    if (!excluded) {
      picks.push(item);
      markAsUsed(item, category, state);
      fresh++;
    }
  }

  // If we didn't get enough, the pool is exhausted for this day
  const remaining = n - picks.length;
  if (remaining > 0) {
    notes.push(`Only ${fresh} distinct ${label} available — ${remaining} slot(s) unfilled to avoid repeats.`);
  } else if (fresh < n) {
    notes.push(`${label}: ${fresh} from pool, ${n - fresh} from nearby areas.`);
  }

  return { picks, notes };
}

// ══════════════════════════════════════════════════════════════════════
//  EXCLUSION PENALTY
// ══════════════════════════════════════════════════════════════════════

/**
 * Calculate an exclusion penalty score for a candidate.
 * Higher penalty = more likely to be excluded.
 *
 * @param {object} candidate - The candidate
 * @param {string} category - Category
 * @param {object} state - Tracking state
 * @returns {number} Penalty score (0 = no penalty, higher = stronger exclusion)
 */
export function exclusionPenalty(candidate, category, state) {
  const { excluded } = isExcluded(candidate, category, state);
  if (!excluded) return 0;

  // Strong exclusion penalty (100+ ensures excluded items are never picked
  // when alternatives exist)
  return 100;
}

// ══════════════════════════════════════════════════════════════════════
//  VALIDATION
// ══════════════════════════════════════════════════════════════════════

/**
 * Validate that no attraction or restaurant repeats across days.
 * Returns structured validation results.
 *
 * @param {Array} days - Itinerary days with activities
 * @param {object} [opts] - Options
 * @param {boolean} [opts.allowHotelRepetition=true] - Allow same hotel across nights
 * @param {boolean} [opts.allowTransportRepetition=true] - Allow transport hub repeats
 * @returns {{ valid: boolean, duplicates: Array, warnings: Array }}
 */
export function validateUniqueness(days, opts = {}) {
  const { allowHotelRepetition = true, allowTransportRepetition = true } = opts;

  const seenAttractions = new Map(); // normalizedId → { dayNumber, name, providerId }
  const seenRestaurants = new Map();
  const seenEvents = new Map();
  const duplicates = [];
  const warnings = [];

  for (const day of days || []) {
    for (const act of day.activities || []) {
      const category = act.category || '';

      // Skip transport — legitimate repeats (same flight/train endpoints)
      if (allowTransportRepetition && (category === 'transport' || category === 'flight' || category === 'train' || category === 'bus')) {
        continue;
      }

      // Skip hotel — same hotel for multi-night stay is expected
      if (allowHotelRepetition && category === 'hotel') {
        continue;
      }

      // Skip unavailable/none entries
      if (act.dataStatus === 'unavailable' || act.source === 'none' || act.source === 'budget-estimate') {
        continue;
      }

      const sid = stableId(act);
      const nid = normalizedId(act);

      // Check attraction duplicates
      if (category === 'attraction' || category === 'activity') {
        const key = nid || sid;
        if (seenAttractions.has(key)) {
          const prev = seenAttractions.get(key);
          duplicates.push({
            type: 'attraction',
            name: act.title || act.place || '',
            providerId: act.providerId || null,
            day1: prev.dayNumber,
            day2: day.dayNumber,
            stableId: sid,
            normalizedId: nid,
            reason: `Attraction "${act.title || act.place}" appears on Day ${prev.dayNumber} and Day ${day.dayNumber}`,
          });
        } else {
          seenAttractions.set(key, {
            dayNumber: day.dayNumber,
            name: act.title || act.place || '',
            providerId: act.providerId || null,
          });
        }
      }

      // Check restaurant duplicates
      if (category === 'restaurant') {
        const key = nid || sid;
        if (seenRestaurants.has(key)) {
          const prev = seenRestaurants.get(key);
          duplicates.push({
            type: 'restaurant',
            name: act.title || act.place || '',
            providerId: act.providerId || null,
            day1: prev.dayNumber,
            day2: day.dayNumber,
            stableId: sid,
            normalizedId: nid,
            reason: `Restaurant "${act.title || act.place}" appears on Day ${prev.dayNumber} and Day ${day.dayNumber}`,
          });
        } else {
          seenRestaurants.set(key, {
            dayNumber: day.dayNumber,
            name: act.title || act.place || '',
            providerId: act.providerId || null,
          });
        }
      }

      // Check event duplicates
      if (category === 'event') {
        const key = nid || sid;
        if (seenEvents.has(key)) {
          const prev = seenEvents.get(key);
          duplicates.push({
            type: 'event',
            name: act.title || act.place || '',
            providerId: act.providerId || null,
            day1: prev.dayNumber,
            day2: day.dayNumber,
            stableId: sid,
            normalizedId: nid,
            reason: `Event "${act.title || act.place}" appears on Day ${prev.dayNumber} and Day ${day.dayNumber}`,
          });
        } else {
          seenEvents.set(key, {
            dayNumber: day.dayNumber,
            name: act.title || act.place || '',
            providerId: act.providerId || null,
          });
        }
      }
    }
  }

  if (duplicates.length > 0) {
    for (const d of duplicates) {
      logger.warn(`[uniquenessEngine] DUPLICATE: ${d.reason}`);
    }
  }

  return {
    valid: duplicates.length === 0,
    duplicates,
    warnings,
    summary: duplicates.length === 0
      ? 'All attractions, restaurants, and events are unique across days'
      : `Found ${duplicates.length} duplicate(s): ${duplicates.map(d => d.reason).join('; ')}`,
  };
}

// ══════════════════════════════════════════════════════════════════════
//  CANDIDATE POOL BUILDER
// ══════════════════════════════════════════════════════════════════════

/**
 * Build a global candidate pool from provider data, deduplicating by
 * both stable ID and normalized name.
 *
 * @param {object} opts
 * @param {Array} opts.attractions
 * @param {Array} opts.restaurants
 * @param {Array} opts.events
 * @param {Array} opts.nightlife
 * @returns {object} Categorized pools with deduplication
 */
export function buildCandidatePool({ attractions = [], restaurants = [], events = [], nightlife = [] }) {
  const pool = {
    attractions: [],
    restaurants: [],
    events: [],
    nightlife: [],
  };

  // Deduplicate attractions
  const attractionIds = new Set();
  const attractionNames = new Set();
  for (const a of attractions) {
    const sid = stableId(a);
    const nid = normalizedId(a);
    if (attractionIds.has(sid) || (nid && attractionNames.has(nid))) {
      continue;
    }
    attractionIds.add(sid);
    if (nid) attractionNames.add(nid);
    pool.attractions.push(a);
  }

  // Deduplicate restaurants
  const restaurantIds = new Set();
  const restaurantNames = new Set();
  for (const r of restaurants) {
    const sid = stableId(r);
    const nid = normalizedId(r);
    if (restaurantIds.has(sid) || (nid && restaurantNames.has(nid))) {
      continue;
    }
    restaurantIds.add(sid);
    if (nid) restaurantNames.add(nid);
    pool.restaurants.push(r);
  }

  // Deduplicate events
  const eventIds = new Set();
  const eventNames = new Set();
  for (const e of events) {
    const sid = stableId(e);
    const nid = normalizedId(e);
    if (eventIds.has(sid) || (nid && eventNames.has(nid))) {
      continue;
    }
    eventIds.add(sid);
    if (nid) eventNames.add(nid);
    pool.events.push(e);
  }

  // Deduplicate nightlife
  const nightlifeIds = new Set();
  for (const n of nightlife) {
    const sid = stableId(n);
    if (nightlifeIds.has(sid)) continue;
    nightlifeIds.add(sid);
    pool.nightlife.push(n);
  }

  logger.info(`[uniquenessEngine] Candidate pool: ${pool.attractions.length} attractions, ${pool.restaurants.length} restaurants, ${pool.events.length} events, ${pool.nightlife.length} nightlife`);

  return pool;
}

// ══════════════════════════════════════════════════════════════════════
//  STATS
// ══════════════════════════════════════════════════════════════════════

/**
 * Get uniqueness statistics for a set of days.
 */
export function getUniquenessStats(days) {
  const attractions = new Set();
  const restaurants = new Set();
  const events = new Set();

  for (const day of days || []) {
    for (const act of day.activities || []) {
      const sid = stableId(act);
      const nid = normalizedId(act);
      const key = nid || sid;

      if (act.category === 'attraction' || act.category === 'activity') {
        attractions.add(key);
      } else if (act.category === 'restaurant') {
        restaurants.add(key);
      } else if (act.category === 'event') {
        events.add(key);
      }
    }
  }

  return {
    uniqueAttractions: attractions.size,
    uniqueRestaurants: restaurants.size,
    uniqueEvents: events.size,
    totalDays: days?.length || 0,
  };
}

export default {
  stableId,
  normalizedId,
  compositeId,
  createTrackingState,
  isExcluded,
  markAsUsed,
  filterAvailable,
  pickDistinct,
  exclusionPenalty,
  validateUniqueness,
  buildCandidatePool,
  getUniquenessStats,
};
