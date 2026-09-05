/**
 * trustedDatasetBuilder.service.js — Anti-Hallucination Trusted Dataset
 *
 * Builds a strict, normalized "trusted candidate dataset" that Gemini receives.
 * Every factual field is sourced from verified provider data.
 *
 * Architecture:
 *   raw provider data → normalized candidates → trusted dataset → Gemini
 *
 * Gemini ONLY returns candidate IDs. Backend hydrates the full data.
 *
 *   Gemini selects candidateId → Backend finds trusted candidate →
 *   Backend copies real provider data → Final itinerary
 */

import logger from '../utils/logger.js';

// ══════════════════════════════════════════════════════════════════════
//  TRUSTED CANDIDATE SCHEMA
// ══════════════════════════════════════════════════════════════════════

/**
 * Canonical trusted candidate shape.
 * Every field is sourced from provider data — never invented.
 *
 * @typedef {object} TrustedCandidate
 * @property {string} candidateId - unique identifier (e.g., "google-123")
 * @property {string} provider - provider name (google, amadeus, ticketmaster, etc.)
 * @property {string} providerId - provider's unique ID for this candidate
 * @property {string} type - candidate type (attraction, restaurant, hotel, event, transport, nightlife)
 * @property {string} name - real name from provider
 * @property {string} tags - categories/tags from provider
 * @property {number|null} rating - provider rating (null if unavailable)
 * @property {number|null} priceLevel - provider price level (null if unavailable)
 * @property {string} address - full address from provider
 * @property {string} suburb - locality/suburb from provider
 * @property {string} city - city from provider
 * @property {string} country - country from provider
 * @property {number|null} latitude - provider coordinate
 * @property {number|null} longitude - provider coordinate
 * @property {boolean} hasOpeningHours - whether opening hours data exists
 * @property {string|null} dataStatus - live, estimate, unavailable
 * @property {string} source - data source identifier
 * @property {boolean} isEstimate - whether this is an estimated value
 */

// ══════════════════════════════════════════════════════════════════════
//  CANDIDATE ID GENERATION
// ══════════════════════════════════════════════════════════════════════

/**
 * Generate a stable candidateId from provider and providerId.
 * Format: "provider-providerId" (lowercase, sanitized)
 *
 * @param {string} provider - provider name
 * @param {string} providerId - provider's unique ID
 * @returns {string} candidateId
 */
export function generateCandidateId(provider, providerId) {
  const safeProvider = (provider || 'unknown').toLowerCase().replace(/[^a-z0-9]/g, '-');
  const safeId = (providerId || 'unknown').toLowerCase().replace(/[^a-z0-9]/g, '-');
  return `${safeProvider}-${safeId}`;
}

// ══════════════════════════════════════════════════════════════════════
//  TRUSTED CANDIDATE BUILDERS
// ══════════════════════════════════════════════════════════════════════

/**
 * Build a trusted attraction candidate from normalized data.
 */
function buildTrustedAttraction(a) {
  const provider = a.provider || 'google';
  const providerId = a.providerId || a.id || '';
  return {
    candidateId: generateCandidateId(provider, providerId),
    provider,
    providerId,
    type: 'attraction',
    name: a.name || '',
    tags: (a.types || a.description || '').toString().substring(0, 200),
    rating: typeof a.rating === 'number' ? a.rating : null,
    priceLevel: typeof a.priceLevel === 'number' ? a.priceLevel : null,
    address: a.address || '',
    suburb: a.suburb || a.district || '',
    city: a.city || '',
    country: a.country || '',
    latitude: typeof a.latitude === 'number' ? a.latitude : (a.coordinates?.lat ?? null),
    longitude: typeof a.longitude === 'number' ? a.longitude : (a.coordinates?.lng ?? null),
    hasOpeningHours: Boolean(a.openingHours?.periods?.length),
    estimatedVisitHours: typeof a.duration === 'number' ? a.duration : null,
    dataStatus: a.dataStatus || a.availability || 'estimate',
    source: a.source || a.provider || 'google',
    isEstimate: Boolean(a.isEstimate),
  };
}

/**
 * Build a trusted restaurant candidate from normalized data.
 */
function buildTrustedRestaurant(r) {
  const provider = r.provider || r.source || 'restaurant-engine';
  const providerId = r.providerId || r.id || '';
  const cost = r.averageCostPerPerson || r.price || null;
  return {
    candidateId: generateCandidateId(provider, providerId),
    provider,
    providerId,
    type: 'restaurant',
    name: r.name || r.canonicalName || '',
    tags: (r.cuisine || r.cuisines || r.types || []).toString().substring(0, 200),
    rating: typeof r.rating === 'number' ? r.rating : null,
    priceLevel: typeof r.priceLevel === 'number' ? r.priceLevel : null,
    address: r.address || '',
    suburb: r.suburb || r.city || '',
    city: r.city || '',
    country: r.country || '',
    latitude: typeof r.latitude === 'number' ? r.latitude : (r.coordinates?.lat ?? null),
    longitude: typeof r.longitude === 'number' ? r.longitude : (r.coordinates?.lng ?? null),
    hasOpeningHours: Boolean(r.openingHours?.periods?.length),
    averageCostPerPerson: typeof cost === 'number' && cost > 0 ? cost : null,
    dataStatus: r.dataStatus || r._dataStatus || 'estimate',
    source: r.source || r.provider || 'restaurant-engine',
    isEstimate: Boolean(r.isEstimate),
  };
}

/**
 * Build a trusted hotel candidate from normalized data.
 */
function buildTrustedHotel(h) {
  const provider = h.provider || 'amadeus';
  const providerId = h.providerId || h.hotelId || h.name || '';
  return {
    candidateId: generateCandidateId(provider, providerId),
    provider,
    providerId,
    type: 'hotel',
    name: h.name || h.hotelName || '',
    tags: (h.amenities || []).toString().substring(0, 200),
    rating: typeof h.rating === 'number' ? h.rating : null,
    address: h.address || '',
    city: h.city || '',
    country: h.country || '',
    latitude: typeof h.latitude === 'number' ? h.latitude : null,
    longitude: typeof h.longitude === 'number' ? h.longitude : null,
    pricePerNight: typeof h.pricePerNight === 'number' ? h.pricePerNight : (h.price?.amount ?? null),
    roomType: h.roomType || '',
    dataStatus: h.dataStatus || 'unavailable',
    source: h.source || h.provider || 'amadeus',
    isEstimate: Boolean(h.isEstimate),
  };
}

/**
 * Build a trusted event candidate from normalized data.
 */
function buildTrustedEvent(e) {
  const provider = e.provider || 'ticketmaster';
  const providerId = e.providerId || e.id || '';
  return {
    candidateId: generateCandidateId(provider, providerId),
    provider,
    providerId,
    type: 'event',
    name: e.name || '',
    tags: (e.description || e.tags || '').toString().substring(0, 200),
    eventDate: e.eventDate || e.date || '',
    eventTime: e.eventTime || e.time || '',
    venue: e.venueName || e.venue || '',
    isFree: Boolean(e.isFree),
    price: typeof e.price === 'number' ? e.price : (e.priceRange?.min ?? null),
    dataStatus: e.dataStatus || e.availability || 'live',
    source: e.source || e.provider || 'ticketmaster',
    isEstimate: Boolean(e.isEstimate),
  };
}

/**
 * Build a trusted transport candidate from normalized data.
 */
function buildTrustedTransport(t) {
  const provider = t.provider || 'transport-intelligence';
  const providerId = t.providerId || t.id || '';
  return {
    candidateId: generateCandidateId(provider, providerId),
    provider,
    providerId,
    type: t.type || t.mode || 'transport',
    name: t.name || '',
    departure: t.departure || t.departAt || '',
    arrival: t.arrival || t.arriveAt || '',
    duration: t.duration || '',
    price: typeof t.price === 'number' ? t.price : null,
    dataStatus: t.dataStatus || t.availability || 'unavailable',
    source: t.source || t.provider || 'transport-intelligence',
    isEstimate: Boolean(t.isEstimate),
  };
}

/**
 * Build a trusted nightlife candidate from normalized data.
 */
function buildTrustedNightlife(n) {
  const provider = n.provider || 'google';
  const providerId = n.providerId || n.id || '';
  return {
    candidateId: generateCandidateId(provider, providerId),
    provider,
    providerId,
    type: 'nightlife',
    name: n.name || '',
    tags: (n.types || n.description || '').toString().substring(0, 200),
    address: n.address || '',
    latitude: typeof n.latitude === 'number' ? n.latitude : (n.coordinates?.lat ?? null),
    longitude: typeof n.longitude === 'number' ? n.longitude : (n.coordinates?.lng ?? null),
    dataStatus: 'estimate',
    source: n.source || n.provider || 'google',
    isEstimate: true,
  };
}

// ══════════════════════════════════════════════════════════════════════
//  MAIN BUILDER
// ══════════════════════════════════════════════════════════════════════

/**
 * Build the trusted candidate dataset from normalized candidates.
 * This is the ONLY data Gemini receives.
 *
 * @param {object} opts
 * @param {Array}  opts.candidates - normalized candidates from orchestrator
 * @param {object} opts.weather - weather data
 * @param {object} opts.guide - local guide data
 * @param {object} opts.safety - safety data
 * @param {object} opts.geoClusters - geographic clustering data
 * @param {object} opts.dayAwareContext - day-aware context data
 * @returns {object} trusted dataset for Gemini
 */
export function buildTrustedDataset({
  candidates = [],
  weather = null,
  guide = null,
  safety = null,
  geoClusters = null,
  dayAwareContext = null,
} = {}) {
  const trustedCandidates = [];

  for (const c of (candidates || [])) {
    let trusted = null;
    switch (c.type) {
      case 'attraction':
        trusted = buildTrustedAttraction(c);
        break;
      case 'restaurant':
        trusted = buildTrustedRestaurant(c);
        break;
      case 'hotel':
        trusted = buildTrustedHotel(c);
        break;
      case 'event':
        trusted = buildTrustedEvent(c);
        break;
      case 'transport':
      case 'flight':
      case 'train':
      case 'bus':
        trusted = buildTrustedTransport(c);
        break;
      case 'nightlife':
        trusted = buildTrustedNightlife(c);
        break;
      default:
        continue;
    }
    if (trusted) {
      trustedCandidates.push(trusted);
    }
  }

  // Build weather summary
  const weatherSummary = {
    available: Boolean(weather?.data?.forecast?.length),
    forecast: (weather?.data?.forecast || []).slice(0, 10).map((f) => ({
      date: f.date || '',
      condition: f.condition || '',
      rainProbability: typeof f.rainProbability === 'number' ? f.rainProbability : null,
      tempMin: typeof f.tempMin === 'number' ? f.tempMin : null,
      tempMax: typeof f.tempMax === 'number' ? f.tempMax : null,
    })),
  };

  // Build day-aware context for Gemini
  const dayContext = dayAwareContext
    ? dayAwareContext.map((ctx) => ({
        dayNumber: ctx.dayNumber,
        date: ctx.date || '',
        weather: ctx.weather || null,
        attractionCount: ctx.attractionCount || 0,
        restaurantCount: ctx.restaurantCount || 0,
        eventCount: ctx.eventCount || 0,
      }))
    : null;

  // Build geographic zones for Gemini
  const geoZones = geoClusters
    ? geoClusters.map((z) => ({
        dayNumber: z.dayNumber,
        zone: z.zone || '',
        candidateCount: z.candidateCount || (z.attractionPool?.length || 0),
      }))
    : null;

  const dataset = {
    candidates: trustedCandidates,
    weather: weatherSummary,
    guide: {
      localTips: (guide?.localTips || guide?.data?.localTips || []).slice(0, 6),
      etiquette: (guide?.etiquette || guide?.data?.etiquette || []).slice(0, 4),
    },
    safety: {
      safetyTips: (safety?.safetyTips || safety?.data?.safetyTips || []).slice(0, 4),
    },
    dayContext,
    geoZones,
    _meta: {
      totalCandidates: trustedCandidates.length,
      byType: {
        attractions: trustedCandidates.filter((c) => c.type === 'attraction').length,
        restaurants: trustedCandidates.filter((c) => c.type === 'restaurant').length,
        hotels: trustedCandidates.filter((c) => c.type === 'hotel').length,
        events: trustedCandidates.filter((c) => c.type === 'event').length,
        transport: trustedCandidates.filter((c) => c.type === 'transport' || c.type === 'flight' || c.type === 'train' || c.type === 'bus').length,
        nightlife: trustedCandidates.filter((c) => c.type === 'nightlife').length,
      },
      builtAt: new Date().toISOString(),
    },
  };

  logger.info(`[TRUSTED-DATASET] Built: ${dataset._meta.totalCandidates} candidates (${dataset._meta.byType.attractions} attractions, ${dataset._meta.byType.restaurants} restaurants, ${dataset._meta.byType.hotels} hotels)`);

  return dataset;
}

/**
 * Build a lookup map from the trusted dataset for fast candidate resolution.
 * Key: candidateId → TrustedCandidate
 */
export function buildTrustedLookup(trustedDataset) {
  const lookup = new Map();
  for (const c of trustedDataset.candidates || []) {
    if (c.candidateId) lookup.set(c.candidateId, c);
    // Also index by provider|providerId for backwards compatibility
    const ppKey = `${c.provider}|${c.providerId}`;
    if (ppKey !== '|') lookup.set(ppKey, c);
    // Also index by name for fallback lookup
    if (c.name) lookup.set(`name|${c.name.toLowerCase()}`, c);
  }
  return lookup;
}

/**
 * Validate that a Gemini response item exists in the trusted dataset.
 * Returns { valid, trustedCandidate, reason }.
 */
export function validateItemAgainstTrustedDataset(item, trustedLookup) {
  if (!item || !trustedLookup) {
    return { valid: false, trustedCandidate: null, reason: 'missing item or lookup' };
  }

  // Try candidateId lookup first (new strict schema)
  if (item.candidateId) {
    const trusted = trustedLookup.get(item.candidateId);
    if (trusted) {
      if (trusted.type !== item.type) {
        return { valid: false, trustedCandidate: trusted, reason: `type mismatch: response "${item.type}" vs trusted "${trusted.type}"` };
      }
      return { valid: true, trustedCandidate: trusted, reason: '' };
    }
    return { valid: false, trustedCandidate: null, reason: `candidateId not found: "${item.candidateId}"` };
  }

  // Fallback: provider|providerId lookup (legacy schema)
  const key = `${item.provider}|${item.providerId}`;
  let trusted = trustedLookup.get(key);

  // Fallback: name lookup
  if (!trusted && item.name) {
    trusted = trustedLookup.get(`name|${item.name.toLowerCase()}`);
  }

  if (!trusted) {
    return { valid: false, trustedCandidate: null, reason: `candidate not found in trusted dataset: ${key}` };
  }

  // Verify type matches
  if (trusted.type !== item.type) {
    return { valid: false, trustedCandidate: trusted, reason: `type mismatch: response "${item.type}" vs trusted "${trusted.type}"` };
  }

  return { valid: true, trustedCandidate: trusted, reason: '' };
}

// ══════════════════════════════════════════════════════════════════════
//  HYDRATION — Resolve candidateIds to full trusted data
// ══════════════════════════════════════════════════════════════════════

/**
 * Hydrate a Gemini response item with full trusted candidate data.
 * Copies all factual fields from the trusted candidate.
 *
 * @param {object} item - Gemini response item (with candidateId)
 * @param {Map} trustedLookup - lookup map from buildTrustedLookup()
 * @returns {object} hydrated item with full trusted data
 */
export function hydrateItem(item, trustedLookup) {
  if (!item || !trustedLookup) return null;

  // Find the trusted candidate
  let trusted = null;
  if (item.candidateId) {
    trusted = trustedLookup.get(item.candidateId);
  }
  if (!trusted && item.provider && item.providerId) {
    trusted = trustedLookup.get(`${item.provider}|${item.providerId}`);
  }
  if (!trusted && item.name) {
    trusted = trustedLookup.get(`name|${item.name.toLowerCase()}`);
  }

  if (!trusted) return null;

  // Hydrate: copy all factual fields from trusted candidate
  return {
    // Gemini's planning decisions
    time: item.time || item.startTime || '',
    reason: item.reason || '',
    areaId: item.areaId || '',
    // Trusted factual data
    candidateId: trusted.candidateId,
    provider: trusted.provider,
    providerId: trusted.providerId,
    type: trusted.type,
    name: trusted.name,
    tags: trusted.tags || '',
    rating: trusted.rating ?? null,
    priceLevel: trusted.priceLevel ?? null,
    address: trusted.address || '',
    suburb: trusted.suburb || '',
    city: trusted.city || '',
    country: trusted.country || '',
    latitude: trusted.latitude ?? null,
    longitude: trusted.longitude ?? null,
    hasOpeningHours: Boolean(trusted.hasOpeningHours),
    estimatedVisitHours: trusted.estimatedVisitHours ?? null,
    averageCostPerPerson: trusted.averageCostPerPerson ?? null,
    pricePerNight: trusted.pricePerNight ?? null,
    price: trusted.price ?? null,
    eventDate: trusted.eventDate || '',
    eventTime: trusted.eventTime || '',
    venue: trusted.venue || '',
    isFree: Boolean(trusted.isFree),
    departure: trusted.departure || '',
    arrival: trusted.arrival || '',
    duration: trusted.duration || '',
    dataStatus: trusted.dataStatus || 'unavailable',
    source: trusted.source || 'unknown',
    isEstimate: Boolean(trusted.isEstimate),
    // Mark as hydrated
    _hydrated: true,
    _trustedCandidateId: trusted.candidateId,
  };
}

/**
 * Hydrate an entire Gemini response with trusted candidate data.
 *
 * @param {object} response - Gemini's parsed response (with candidateIds)
 * @param {Map} trustedLookup - lookup map from buildTrustedLookup()
 * @returns {{ hydratedDays, hydratedCount, rejectedCount, errors }}
 */
export function hydrateResponse(response, trustedLookup) {
  const errors = [];
  const hydratedDays = [];
  let hydratedCount = 0;
  let rejectedCount = 0;

  if (!response?.days || !trustedLookup) {
    return { hydratedDays: [], hydratedCount: 0, rejectedCount: 0, errors: ['Missing response or trusted lookup'] };
  }

  for (let di = 0; di < response.days.length; di++) {
    const day = response.days[di];
    const hydratedItems = [];

    for (let ii = 0; ii < (day.items || []).length; ii++) {
      const item = day.items[ii];
      const hydrated = hydrateItem(item, trustedLookup);

      if (hydrated) {
        hydratedItems.push(hydrated);
        hydratedCount++;
      } else {
        rejectedCount++;
        errors.push(`Day ${di + 1} item ${ii}: candidateId "${item.candidateId}" not found in trusted dataset`);
        logger.warn(`[HYDRATION] REJECTED: Day ${di + 1} item ${ii} — candidateId "${item.candidateId}" not found`);
      }
    }

    hydratedDays.push({
      ...day,
      items: hydratedItems,
    });
  }

  logger.info(`[HYDRATION] Hydrated ${hydratedCount} items, rejected ${rejectedCount} items`);

  return { hydratedDays, hydratedCount, rejectedCount, errors };
}

// ══════════════════════════════════════════════════════════════════════
//  EXPORTS
// ══════════════════════════════════════════════════════════════════════

export default {
  generateCandidateId,
  buildTrustedDataset,
  buildTrustedLookup,
  validateItemAgainstTrustedDataset,
  hydrateItem,
  hydrateResponse,
  buildTrustedAttraction,
  buildTrustedRestaurant,
  buildTrustedHotel,
  buildTrustedEvent,
  buildTrustedTransport,
  buildTrustedNightlife,
};
