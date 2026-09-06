/**
 * orchestratorAIPlanning.js — AI Planning Pipeline
 *
 * Architecture:
 *   REAL API DATA → NORMALIZED CANDIDATES → AI PROPOSED PLAN →
 *   RESOLVE PROVIDER IDs → DETERMINISTIC VALIDATION → REPLAN IF INVALID →
 *   FINAL VERIFIED ITINERARY
 *
 * The AI plans OVER real data (not inventing it). The backend resolves
 * AI-referenced provider IDs against the verified candidate dataset
 * and populates factual information.
 */
import logger from '../utils/logger.js';
import { generateItinerary, getRequestCount } from '../services/itineraryGenerator.service.js';
import finalValidatorAgent from '../agents/finalValidator.agent.js';
import { haversineKm } from '../utils/geo.js';
import destinationLock from '../services/destinationLock.service.js';
import candidateQuality from '../services/candidateQuality.service.js';
import restaurantPipeline from '../services/restaurantCandidatePipeline.service.js';
import hotelPipeline from '../services/hotelCandidatePipeline.service.js';
import uniquenessEngine from '../services/uniquenessEngine.service.js';
import dayAwareProvider from '../services/dayAwareProvider.service.js';
import geoClustering from '../services/geographicClustering.service.js';

const MAX_REPLAN_ATTEMPTS = 3;

// ══════════════════════════════════════════════════════════════════════
//  1. NORMALIZE CANDIDATES
// ══════════════════════════════════════════════════════════════════════

/**
 * Normalize all provider data into a unified candidate dataset.
 * Every candidate contains: id, provider, providerId, type, name,
 * description, latitude, longitude, price, currency, rating,
 * openingHours, duration, availability, bookingUrl, imageUrl,
 * source, isLive, isEstimate.
 */
export function normalizeCandidates({ attractions, restaurants, nightlife, hotelResult, transportResult, eventsResult }) {
  const candidates = [];

  // Attractions (from Google + Viator enrichment)
  for (const a of attractions || []) {
    const entryFee = a.entryFee || null;
    // A provider-reported fee of exactly ₹0 (not estimated) is a verified free
    // entry. An absent fee or an estimated fee is UNKNOWN — never assume free.
    const providerFree = Boolean(
      entryFee && typeof entryFee.amount === 'number' && entryFee.amount === 0
      && entryFee.isEstimate === false
    );
    candidates.push({
      id: `google:${a.placeId || a.name}`,
      provider: 'google',
      providerId: a.placeId || a.name,
      type: 'attraction',
      name: a.name || '',
      description: (a.types || []).join(', '),
      latitude: a.coordinates?.lat || null,
      longitude: a.coordinates?.lng || null,
      price: entryFee && typeof entryFee.amount === 'number' ? entryFee.amount : null,
      isFree: Boolean(a.entryFee?.isFree) || providerFree,
      currency: a.entryFee?.currency || 'INR',
      rating: a.rating || null,
      priceLevel: a.priceLevel || null,
      openingHours: a.openingHours || null,
      duration: a.estimatedVisitHours || null,
      availability: a.dataStatus || 'estimate',
      bookingUrl: a.bookingUrl || '',
      imageUrl: a.imageUrl || '',
      source: 'google',
      isLive: Boolean(a.isLive),
      isEstimate: Boolean(a.entryFee?.isEstimate ?? true),
      // Preserve enriched fields
      viatorPricing: a.viatorPricing || null,
      entryFee: entryFee,
      types: a.types || [],
      address: a.address || '',
      suburb: a.suburb || '',
      district: a.district || '',
    });
  }

  // Restaurants — run through strict restaurant pipeline first
  const restaurantPipelineResult = restaurantPipeline.runRestaurantPipeline(restaurants || []);
  if (restaurantPipelineResult.rejected.length > 0) {
    logger.info(`[AI-PLANNING] Restaurant pipeline: ${restaurantPipelineResult.accepted.length} accepted, ${restaurantPipelineResult.rejected.length} rejected`);
    for (const r of restaurantPipelineResult.rejectionLog) {
      logger.warn(`[AI-PLANNING] Restaurant REJECTED: "${r.name}" — ${r.rejection}`);
    }
  }
  for (const r of restaurantPipelineResult.accepted) {
    candidates.push({
      id: `restaurant:${r.providerId || r.canonicalName}`,
      provider: r.provider,
      providerId: r.providerId,
      type: 'restaurant',
      name: r.canonicalName,
      description: (r.cuisine || []).join(', '),
      latitude: r.latitude,
      longitude: r.longitude,
      price: r.averageCostPerPerson ?? null,
      currency: 'INR',
      rating: r.rating,
      priceLevel: r.priceLevel,
      openingHours: r.openingHours,
      duration: null,
      availability: r.dataStatus,
      bookingUrl: '',
      imageUrl: '',
      source: r.source,
      isLive: r.dataStatus === 'live',
      isEstimate: r.isEstimate,
      averageCostPerPerson: r.averageCostPerPerson,
      cuisines: r.cuisine,
      types: [],
      address: r.address,
      suburb: r.city || '',
      // Pipeline metadata
      _pipelineNormalized: true,
      _dataStatus: r.dataStatus,
    });
  }

  // Nightlife
  for (const n of nightlife || []) {
    candidates.push({
      id: `google:${n.placeId || n.name}`,
      provider: 'google',
      providerId: n.placeId || n.name,
      type: 'nightlife',
      name: n.name || '',
      description: (n.types || []).join(', '),
      latitude: n.coordinates?.lat || null,
      longitude: n.coordinates?.lng || null,
      price: null,
      isFree: Boolean(n.isFree),
      currency: 'INR',
      rating: n.rating || null,
      openingHours: null,
      duration: null,
      availability: 'estimate',
      bookingUrl: '',
      imageUrl: '',
      source: 'google',
      isLive: Boolean(n.isLive),
      isEstimate: true,
      types: n.types || [],
      address: n.address || '',
    });
  }

  // Hotels — run through strict hotel pipeline
  const allHotelRaw = [];
  const hotelRecommended = hotelResult?.data?.recommended;
  if (hotelRecommended && hotelRecommended.name) {
    allHotelRaw.push(hotelRecommended);
  }
  for (const h of (hotelResult?.data?.hotels || []).slice(0, 10)) {
    if (h.name && h.name !== hotelRecommended?.name) {
      allHotelRaw.push(h);
    }
  }
  const hotelPipelineResult = hotelPipeline.runHotelPipeline(allHotelRaw, {
    checkIn: '', checkOut: '', rooms: 1, destination: '',
  });
  if (hotelPipelineResult.rejected.length > 0) {
    logger.info(`[AI-PLANNING] Hotel pipeline: ${hotelPipelineResult.accepted.length} accepted, ${hotelPipelineResult.rejected.length} rejected`);
    for (const r of hotelPipelineResult.rejectionLog) {
      logger.warn(`[AI-PLANNING] Hotel REJECTED: "${r.name}" — ${r.rejection}`);
    }
  }
  for (const h of hotelPipelineResult.accepted) {
    candidates.push({
      id: `hotel:${h.hotelId || h.hotelName}`,
      provider: h.provider,
      providerId: h.hotelId || h.hotelName,
      type: 'hotel',
      name: h.hotelName,
      description: h.address || '',
      latitude: h.latitude,
      longitude: h.longitude,
      price: h.pricePerNight ?? null,
      pricePerNight: h.pricePerNight ?? null,
      currency: h.currency || 'INR',
      rating: h.rating,
      openingHours: null,
      duration: null,
      availability: h.dataStatus,
      bookingUrl: '',
      imageUrl: '',
      source: h.source,
      isLive: h.dataStatus === 'live',
      isEstimate: h.isEstimate,
      amenities: [],
      address: h.address,
      // Pipeline metadata
      _pipelineNormalized: true,
      _dataStatus: h.dataStatus,
      _totalPrice: h.totalPrice,
      _checkIn: h.checkIn,
      _checkOut: h.checkOut,
      _rooms: h.rooms,
    });
  }

  // Transport options
  const transportSelected = transportResult?.data?.selected;
  if (transportSelected) {
    candidates.push({
      id: `transport:${transportResult.mode}:${transportSelected.airline || transportSelected.trainName || transportSelected.operator || 'selected'}`,
      provider: 'transport-intelligence',
      providerId: transportSelected.flightNumber || transportSelected.trainNumber || transportSelected.operator || 'selected-transport',
      type: transportResult.mode || 'transport',
      name: `${transportSelected.airline || ''} ${transportSelected.flightNumber || ''} ${transportSelected.trainName || ''} ${transportSelected.operator || ''}`.trim() || 'Transport',
      description: `${transportResult.mode} from origin to destination`,
      latitude: null,
      longitude: null,
      price: transportSelected.price?.amount ?? null,
      currency: transportSelected.price?.currency || 'INR',
      rating: null,
      openingHours: null,
      duration: null,
      availability: transportResult.data.isLive ? 'live' : 'unavailable',
      bookingUrl: '',
      imageUrl: '',
      source: transportSelected.provider || 'transport-intelligence',
      isLive: Boolean(transportResult.data.isLive),
      isEstimate: Boolean(!transportResult.data.isLive),
    });
  }

  // Transport alternatives
  for (const offer of (transportResult?.data?.offers || []).slice(0, 6)) {
    candidates.push({
      id: `transport:${offer.mode || transportResult?.mode}:${offer.airline || offer.trainName || offer.operator || 'alt'}`,
      provider: 'transport-intelligence',
      providerId: offer.flightNumber || offer.trainNumber || offer.operator || `alt-${Math.random()}`,
      type: offer.mode || transportResult?.mode || 'transport',
      name: `${offer.airline || ''} ${offer.flightNumber || ''} ${offer.trainName || ''} ${offer.operator || ''}`.trim() || 'Transport alternative',
      description: `Alternative ${offer.mode || 'transport'} option`,
      latitude: null,
      longitude: null,
      price: offer.price?.amount ?? null,
      currency: offer.price?.currency || 'INR',
      rating: null,
      openingHours: null,
      duration: null,
      availability: offer.isLive ? 'live' : 'estimate',
      bookingUrl: '',
      imageUrl: '',
      source: offer.source || 'transport-intelligence',
      isLive: Boolean(offer.isLive),
      isEstimate: Boolean(!offer.isLive),
    });
  }

  // Cultural events (from Ticketmaster)
  for (const e of (eventsResult?.events || eventsResult?.data?.events || []).slice(0, 15)) {
    candidates.push({
      id: `ticketmaster:${e.id || e.name}`,
      provider: 'ticketmaster',
      providerId: e.id || e.name,
      type: 'event',
      name: e.name || '',
      description: `${e.category || ''} ${e.genre || ''}`.trim(),
      latitude: e.venueLatitude || null,
      longitude: e.venueLongitude || null,
      price: e.priceRange?.min ?? null,
      currency: e.priceRange?.currency || 'INR',
      rating: null,
      openingHours: null,
      duration: null,
      availability: e.isAvailable !== false ? 'live' : 'unavailable',
      bookingUrl: e.url || '',
      imageUrl: e.imageUrl || '',
      source: 'ticketmaster',
      isLive: true,
      isEstimate: Boolean(e.priceRange?.isEstimate),
      // Event-specific fields
      eventDate: e.date || '',
      eventTime: e.time || '',
      venueName: e.venueName || '',
      venueAddress: e.venueAddress || '',
      isFree: e.isFree || false,
    });
  }

  logger.info(`[AI-PLANNING] Normalized ${candidates.length} candidates: ${candidates.filter(c => c.type === 'attraction').length} attractions, ${candidates.filter(c => c.type === 'restaurant').length} restaurants, ${candidates.filter(c => c.type === 'hotel').length} hotels, ${candidates.filter(c => c.type === 'event').length} events, ${candidates.filter(c => c.type === 'nightlife').length} nightlife`);

  return candidates;
}

// ══════════════════════════════════════════════════════════════════════
//  2. RESOLVE PROVIDER IDs
// ══════════════════════════════════════════════════════════════════════

/**
 * Resolve AI planning decisions against the candidate dataset.
 *
 * The AI returns lightweight decisions: { type, provider, providerId, startTime, endTime, reason }
 * This function resolves each decision against the candidate list and builds
 * the full activity objects the rest of the system expects.
 *
 * Every factual field (price, coordinates, address, rating, openingHours, etc.)
 * comes from the candidate dataset, NEVER from AI output.
 */
export function resolveProviderIds(aiDays, candidates) {
  const candidateMap = new Map();
  for (const c of candidates) {
    const key = `${c.provider}|${c.providerId}`;
    if (key !== '|') candidateMap.set(key, c);
    if (c.name) candidateMap.set(`name:${c.name.toLowerCase()}`, c);
  }

  const now = new Date().toISOString();
  const resolved = [];
  let resolvedCount = 0;
  let unresolvedCount = 0;    for (const day of aiDays || []) {
    const resolvedDay = {
      dayNumber: day.dayNumber || (resolved.length + 1),
      date: day.date || '',
      theme: day.theme || '',
      area: day.theme || '',
      activities: [],
    };

    const dayNumber = resolved.length + 1;

    for (const item of day.items || []) {
      let candidate = null;

      // Match by provider + providerId
      if (item.provider && item.providerId) {
        candidate = candidateMap.get(`${item.provider}|${item.providerId}`);
      }

      // Fallback: match by name (providerId might be a name)
      if (!candidate && item.providerId) {
        candidate = candidateMap.get(`name:${item.providerId.toLowerCase()}`);
      }

      if (!candidate) {
        unresolvedCount++;
        logger.warn(`[AI-PLANNING] Could not resolve candidate for ${item.provider}:${item.providerId}`);
        continue;
      }

      // Enforce day availability on the backend — never rely on the prompt alone.
      // If a candidate carries _availableDays (day-aware pipeline output) and the
      // current day is not in it, the candidate MUST NOT be scheduled today.
      if (Array.isArray(candidate._availableDays) && candidate._availableDays.length > 0
        && !candidate._availableDays.includes(dayNumber)) {
        unresolvedCount++;
        logger.warn(`[AI-PLANNING] Candidate ${candidate.provider}:${candidate.providerId} "${candidate.name}" not available on Day ${dayNumber} (available days: [${candidate._availableDays.join(', ')}]) — rejected by backend`);
        continue;
      }

      // Build full activity from candidate data
      const act = {
        // Time (from AI planning decision)
        time: item.startTime || '09:00',
        slot: mapTimeSlot(item.startTime, item.type),
        period: mapPeriod(item.startTime),

        // Identity (from AI planning decision, validated against candidate)
        title: candidate.name,
        place: candidate.name,
        description: item.reason || `${candidate.name} — selected by AI planner`,

        // Category (from candidate type)
        category: mapCategory(item.type, candidate),

        // Provider reference (validated against candidate)
        provider: candidate.provider,
        providerId: candidate.providerId,

        // Address (always from candidate)
        address: candidate.address || '',

        // Coordinates (always from candidate)
        coordinates: (candidate.latitude != null && candidate.longitude != null)
          ? { lat: candidate.latitude, lng: candidate.longitude }
          : null,

        // Cost (always from candidate)
        cost: buildCostFromCandidate(candidate, item.type),

        // Data status (always from candidate)
        source: candidate.source || candidate.provider,
        isLive: Boolean(candidate.isLive),
        dataStatus: candidate.isLive ? 'live' : (candidate.isEstimate ? 'estimate' : 'unavailable'),
        fetchedAt: now,
        bookingUrl: candidate.bookingUrl || '',
        rating: candidate.rating ?? null,
        openingHours: candidate.openingHours || null,
        priority: item.type === 'hotel' ? 1 : 2,

        // AI planner metadata
        _resolvedFrom: candidate.id,
        _plannerReason: item.reason || '',
        _plannerEndTime: item.endTime || '',
      };

      resolvedDay.activities.push(act);
      resolvedCount++;
    }

    resolved.push(resolvedDay);
  }

  logger.info(`[AI-PLANNING] Resolved ${resolvedCount} items, ${unresolvedCount} unresolved`);
  return { resolved, resolvedCount, unresolvedCount };
}

/** Map candidate type to activity category. */
function mapCategory(type, candidate) {
  const typeMap = {
    attraction: 'attraction',
    restaurant: 'restaurant',
    hotel: 'hotel',
    event: 'activity',
    nightlife: 'nightlife',
    transport: 'transport',
    flight: 'flight',
    train: 'train',
    bus: 'bus',
    road: 'transport',
    activity: 'activity',
  };
  // Road trips (self-drive / cab) map to the DB's plain 'transport' category.
  if (type === 'road') return 'transport';
  return typeMap[type] || (candidate && candidate.isLive ? 'activity' : 'activity');
}

/** Map start time to a time slot label. */
function mapTimeSlot(startTime, type) {
  if (type === 'transport' || type === 'flight' || type === 'train' || type === 'bus') return 'transport';
  if (type === 'hotel') return 'hotel';
  if (!startTime) return 'morning';
  const h = parseInt(startTime.split(':')[0], 10);
  if (h < 11) return 'morning';
  if (h < 15) return 'lunch';
  if (h < 18) return 'afternoon';
  if (h < 21) return 'evening';
  return 'night';
}

/** Map start time to a period label. */
function mapPeriod(startTime) {
  if (!startTime) return 'day';
  const h = parseInt(startTime.split(':')[0], 10);
  if (h < 11) return 'morning';
  if (h < 15) return 'lunch';
  if (h < 18) return 'afternoon';
  if (h < 21) return 'evening';
  return 'night';
}

/** Build cost object from candidate data. */
function buildCostFromCandidate(candidate, type) {
  // Hotels: nightly rate from candidate — never fabricate a price
  if (type === 'hotel') {
    const pricePerNight = candidate.pricePerNight || candidate.price || 0;
    if (pricePerNight > 0) {
      const isEstimate = Boolean(candidate.isEstimate);
      const dataStatus = candidate._dataStatus || candidate.availability || (candidate.isLive ? 'live' : (isEstimate ? 'estimate' : 'unavailable'));
      return {
        amount: pricePerNight,
        currency: candidate.currency || 'INR',
        isEstimate,
        source: candidate.source || candidate.provider,
        dataStatus,
        estimateNote: dataStatus === 'live'
          ? `Live price from ${candidate.source || candidate.provider}`
          : `Price from ${candidate.source || candidate.provider}`,
      };
    }
    // No provider price available — do NOT invent a price
    return {
      amount: null,
      currency: candidate.currency || 'INR',
      isEstimate: false,
      source: candidate.source || candidate.provider || 'unavailable',
      dataStatus: 'unavailable',
      estimateNote: 'No provider price available — not fabricated',
    };
  }

  // Transport: price from candidate
  if (type === 'transport' || type === 'flight' || type === 'train' || type === 'bus') {
    if (candidate.price > 0) {
      return {
        amount: candidate.price,
        currency: candidate.currency || 'INR',
        isEstimate: Boolean(candidate.isEstimate),
        source: candidate.source || candidate.provider,
      };
    }
    // No provider price available — do NOT fabricate a price
    return {
      amount: null,
      currency: candidate.currency || 'INR',
      isEstimate: false,
      source: candidate.source || candidate.provider || 'unavailable',
      dataStatus: 'unavailable',
      estimateNote: 'No provider price available — not fabricated',
    };
  }

  // Attractions: entry fee from candidate — unknown must stay null, never ₹0.
  if (type === 'attraction') {
    if (candidate.price > 0) {
      return {
        amount: candidate.price,
        currency: candidate.currency || 'INR',
        isEstimate: Boolean(candidate.isEstimate),
        source: candidate.source || candidate.provider,
        dataStatus: candidate.isEstimate ? 'estimate' : 'live',
        estimateNote: candidate.isEstimate ? `Estimated from ${candidate.provider}` : `Real price from ${candidate.provider}`,
      };
    }
    if (candidate.isFree) {
      return { amount: 0, currency: 'INR', isEstimate: false, source: candidate.source || 'provider', dataStatus: 'live', estimateNote: 'Verified free entry' };
    }
    return { amount: null, currency: 'INR', isEstimate: false, source: 'unavailable', dataStatus: 'unavailable', estimateNote: 'Entry fee unknown — not fabricated' };
  }

  // Restaurants: average cost from candidate
  // Price rule: use provider value if available; if not, price=null, dataStatus=unavailable
  if (type === 'restaurant') {
    const cost = candidate.averageCostPerPerson || candidate.price || 0;
    if (cost > 0) {
      const isEstimate = Boolean(candidate.isEstimate);
      const dataStatus = candidate._dataStatus || candidate.availability || (candidate.isLive ? 'live' : (isEstimate ? 'estimate' : 'unavailable'));
      return {
        amount: cost,
        currency: candidate.currency || 'INR',
        isEstimate,
        source: candidate.source || candidate.provider,
        dataStatus,
        estimateNote: dataStatus === 'live'
          ? `Real price from ${candidate.source || candidate.provider}`
          : isEstimate
            ? `Estimated from ${candidate.provider} priceLevel — labeled as estimate`
            : `Price from ${candidate.source || candidate.provider}`,
      };
    }
    // No provider price available — do NOT invent a price
    return {
      amount: null,
      currency: candidate.currency || 'INR',
      isEstimate: false,
      source: candidate.source || candidate.provider || 'unavailable',
      dataStatus: 'unavailable',
      estimateNote: 'No provider price available — not fabricated',
    };
  }

  // Events: price from candidate — unknown stays null, never ₹0.
  if (type === 'event') {
    if (candidate.price > 0) {
      return {
        amount: candidate.price,
        currency: candidate.currency || 'INR',
        isEstimate: Boolean(candidate.isEstimate),
        source: candidate.source || candidate.provider,
        dataStatus: candidate.isEstimate ? 'estimate' : 'live',
      };
    }
    if (candidate.isFree) {
      return { amount: 0, currency: 'INR', isEstimate: false, source: 'ticketmaster', dataStatus: 'live' };
    }
    return { amount: null, currency: 'INR', isEstimate: false, source: 'unavailable', dataStatus: 'unavailable', estimateNote: 'Event price unknown — not fabricated' };
  }

  // Nightlife: only ₹0 when the provider confirms it is free; otherwise unavailable.
  if (type === 'nightlife') {
    if (candidate.isFree) {
      return { amount: 0, currency: 'INR', isEstimate: false, source: candidate.source || 'provider', dataStatus: 'live', estimateNote: 'Verified free entry' };
    }
    return { amount: null, currency: 'INR', isEstimate: false, source: 'unavailable', dataStatus: 'unavailable', estimateNote: 'Cover charge unknown — not fabricated' };
  }

  return { amount: null, currency: 'INR', isEstimate: false, source: 'unavailable', dataStatus: 'unavailable', estimateNote: 'Price unknown — not fabricated' };
}

// ══════════════════════════════════════════════════════════════════════
//  3. REBUILD COSTS FROM RESOLVED DATA
// ══════════════════════════════════════════════════════════════════════

/**
 * Recalculate day costs and cumulative totals from resolved activity data.
 * This ensures costs come from provider data, not AI hallucinations.
 */
export function rebuildCosts(days, { partySize = 1, totalBudget = 0, currency = 'INR' } = {}) {
  let cumulative = 0;

  for (const day of days) {
    let dayTotal = 0;
    const breakdown = { accommodation: 0, breakfast: 0, lunch: 0, dinner: 0, transport: 0, activities: 0, evening: 0, night: 0, misc: 0 };

    for (const act of day.activities || []) {
      const amt = act.cost?.amount || 0;
      dayTotal += amt;

      const slot = act.slot || act.period;
      if (act.category === 'hotel') breakdown.accommodation += amt;
      else if (act.category === 'restaurant' && slot === 'breakfast') breakdown.breakfast += amt;
      else if (act.category === 'restaurant' && slot === 'lunch') breakdown.lunch += amt;
      else if (act.category === 'restaurant') breakdown.dinner += amt;
      else if (act.category === 'transport') breakdown.transport += amt;
      else if (slot === 'evening') breakdown.evening += amt;
      else if (slot === 'night') breakdown.night += amt;
      else if (act.category === 'attraction' || act.category === 'activity') breakdown.activities += amt;
      else breakdown.misc += amt;

      // Update per-person cost
      if (act.cost && typeof act.cost.amount === 'number' && act.cost.amount > 0 && act.cost.perPerson == null) {
        act.cost.perPerson = Math.round((act.cost.amount / partySize) * 100) / 100;
      }
    }

    dayTotal = Math.round(dayTotal * 100) / 100;
    cumulative = Math.round((cumulative + dayTotal) * 100) / 100;

    day.dayCost = dayTotal;
    day.costBreakdown = {
      ...breakdown,
      dayTotal,
      perPerson: Math.round((dayTotal / partySize) * 100) / 100,
      cumulative,
      remainingBudget: totalBudget > 0 ? Math.round((totalBudget - cumulative) * 100) / 100 : null,
    };
    day.cumulativeCost = cumulative;
    day.remainingBudget = totalBudget > 0 ? Math.round((totalBudget - cumulative) * 100) / 100 : null;
  }

  return days;
}

// ══════════════════════════════════════════════════════════════════════
//  4. AI PLANNING PIPELINE
// ══════════════════════════════════════════════════════════════════════

/**
 * Run the full AI planning pipeline:
 *   1. Normalize candidates from provider data
 *   2. Call AI planner with candidates and context
 *   3. Resolve provider IDs against candidate dataset
 *   4. Run deterministic validation with candidates
 *   5. If validation fails, replan with errors (max 3 attempts)
 *   6. Return final verified itinerary (or null if all attempts fail)
 *
 * @param {object} opts
 * @param {Array} opts.attractions - Provider attraction data
 * @param {Array} opts.restaurants - Provider restaurant data
 * @param {Array} opts.nightlife - Nightlife data
 * @param {object} opts.hotelResult - Hotel provider result
 * @param {object} opts.transportResult - Transport result
 * @param {object} opts.eventsResult - Events result
 * @param {object} opts.weatherResult - Weather data
 * @param {object} opts.trafficResult - Traffic data
 * @param {object} opts.guideResult - Local guide data
 * @param {object} opts.safetyResult - Safety data
 * @param {object} opts.prefs - User preferences
 * @param {string} opts.destination - Destination
 * @param {string} opts.origin - Origin
 * @param {string} opts.startDate - Start date
 * @param {string} opts.endDate - End date
 * @param {object} opts.travelers - { adults, children }
 * @param {number} opts.totalBudget - Total budget
 * @param {string} opts.currency - Currency
 * @param {number} opts.daysCount - Number of days
 * @param {number} opts.nightsCount - Number of nights
 * @param {object} opts.allocation - Budget allocation
 * @param {number} opts.totalEstimatedCost - Current estimated cost
 * @param {boolean} opts.isOverBudget - Whether currently over budget
 * @param {Array} opts.existingDaysPlan - Deterministic fallback plan
 * @param {string} opts.userId - User ID
 * @param {Map} opts.routeCache - Pre-fetched route cache
 */
export async function runAIPlanningPipeline(opts) {
  const {
    attractions, restaurants, nightlife, hotelResult, transportResult,
    eventsResult, weatherResult, trafficResult, guideResult, safetyResult,
    prefs, destination, origin, startDate, endDate, travelers, totalBudget,
    currency, daysCount, nightsCount, allocation, totalEstimatedCost,
    isOverBudget, existingDaysPlan, userId, routeCache, destLock,
  } = opts;

  const started = Date.now();
  logger.info('[AI-PLANNING] Starting AI planning pipeline');

  // ═══ STEP 1: Normalize candidates ═══
  let candidates = normalizeCandidates({
    attractions, restaurants, nightlife, hotelResult, transportResult, eventsResult,
  });

  // ═══ STEP 1b: Destination Lock — filter candidates against boundary ═══
  if (destLock && candidates.length) {
    const beforeCount = candidates.length;
    const { accepted, rejected, rejectionLog } = destinationLock.filterCandidates(
      candidates, destLock, 'ai-planning'
    );
    candidates = accepted;
    if (rejected.length > 0) {
      logger.info(`[DESTINATION-LOCK] AI Planning candidates: ${accepted.length} accepted, ${rejected.length} rejected (from ${beforeCount})`);
      for (const r of rejectionLog) {
        logger.warn(`[DESTINATION-LOCK] AI REJECTED: "${r.candidate.name}" — ${r.reason}`);
      }
    }
  }

  // ═══ STEP 1c: Candidate Quality — filter low-quality candidates ═══
  if (candidates.length) {
    const beforeCount = candidates.length;
    const qualityFiltered = [];
    const qualityRejections = [];
    // Group candidates by type and filter each group
    const byType = new Map();
    for (const c of candidates) {
      const t = c.type || 'attraction';
      if (!byType.has(t)) byType.set(t, []);
      byType.get(t).push(c);
    }
    for (const [type, group] of byType) {
      const { accepted, rejected, rejectionLog } = candidateQuality.filterByQuality(
        group, type, 'ai-planning'
      );
      qualityFiltered.push(...accepted);
      qualityRejections.push(...rejectionLog);
    }
    candidates = qualityFiltered;
    if (qualityRejections.length > 0) {
      logger.info(`[CANDIDATE-QUALITY] AI Planning: ${candidates.length} accepted, ${qualityRejections.length} rejected (from ${beforeCount})`);
    }
  }

  // ═══ STEP 1d: Uniqueness Engine — build global candidate pool and deduplicate ═══
  const candidatePool = uniquenessEngine.buildCandidatePool({
    attractions: candidates.filter(c => c.type === 'attraction'),
    restaurants: candidates.filter(c => c.type === 'restaurant'),
    events: candidates.filter(c => c.type === 'event'),
    nightlife: candidates.filter(c => c.type === 'nightlife'),
  });

  // Replace candidates with deduplicated pool + hotels + transport
  candidates = [
    ...candidatePool.attractions,
    ...candidatePool.restaurants,
    ...candidatePool.events,
    ...candidatePool.nightlife,
    ...candidates.filter(c => c.type === 'hotel' || c.type === 'transport' || c.type === 'flight' || c.type === 'train' || c.type === 'bus'),
  ];
  logger.info(`[UNIQUENESS-ENGINE] After dedup: ${candidates.length} candidates (${candidatePool.attractions.length} attractions, ${candidatePool.restaurants.length} restaurants, ${candidatePool.events.length} events)`);

  // ═══ STEP 1e: Day-Aware Data Collection ═══
  // Build date-specific candidate pools for each day of the trip.
  // Ensures weather, events, opening hours are day-specific.
  const dayAwareResult = dayAwareProvider.runDayAwarePipeline({
    startDate,
    endDate,
    attractions: candidates.filter(c => c.type === 'attraction'),
    restaurants: candidates.filter(c => c.type === 'restaurant'),
    events: candidates.filter(c => c.type === 'event'),
    nightlife: candidates.filter(c => c.type === 'nightlife'),
    weatherForecast: weatherResult?.data?.forecast || null,
    prefs,
    logPipeline: true,
  });

  // Enrich candidates with day availability metadata
  candidates = dayAwareProvider.enrichCandidatesWithDayAvailability(
    candidates, dayAwareResult.dayPools
  );

  logger.info(`[DAY-AWARE] Pipeline: ${dayAwareResult.summary.totalDays} days, ` +
    `avg ${dayAwareResult.summary.avgAttractionsPerDay} attractions/day, ` +
    `${dayAwareResult.summary.daysWithEvents} days with events`);

  // ═══ STEP 1f: Geographic Area Clustering ═══
  // Cluster candidates into geographic zones for day-wise planning.
  // Each day gets a distinct geographic area to minimize travel.
  const geoClusterResult = geoClustering.runGeographicClustering({
    attractions: candidates.filter(c => c.type === 'attraction'),
    restaurants: candidates.filter(c => c.type === 'restaurant'),
    nightlife: candidates.filter(c => c.type === 'nightlife'),
    events: candidates.filter(c => c.type === 'event'),
    daysCount,
    destination,
    hotelCentroid: null,
    logPipeline: true,
  });

  logger.info(`[GEO-CLUSTER] Pipeline: ${geoClusterResult.summary.clustersCreated} clusters, ` +
    `${geoClusterResult.summary.avgAttractionsPerDay} avg attractions/day, ` +
    `${geoClusterResult.summary.avgRouteDistanceKm}km avg route distance`);

  // ═══ STEP 2-5: AI planning with replanning loop ═══
  let lastAIResult = null;
  let lastValidation = null;
  let validationErrors = [];
  let finalDays = null;
  let attemptsLog = [];

  for (let attempt = 1; attempt <= MAX_REPLAN_ATTEMPTS; attempt++) {
    logger.info(`[AI-PLANNING] Attempt ${attempt}/${MAX_REPLAN_ATTEMPTS}`);

    // Call AI planner
    let aiResult;
    try {
      aiResult = await generateItinerary({
        userPreferences: prefs,
        destination,
        origin,
        startDate,
        endDate,
        travelers,
        totalBudget,
        currency,
        daysCount,
        nightsCount,
        weather: weatherResult,
        accommodation: hotelResult,
        transport: transportResult,
        attractions,
        restaurants,
        nightlife,
        traffic: trafficResult?.data || {},
        guide: guideResult?.data || {},
        safety: safetyResult?.data || {},
        events: eventsResult?.data || null,
        budgetAllocation: allocation,
        totalEstimatedCost,
        isOverBudget,
        existingDaysPlan,
        userId,
        // Anti-hallucination: pass normalized candidates for trusted dataset
        normalizedCandidates: candidates,
        // Day-aware context: per-day weather, events, and filtered candidates
        dayAwareContext: dayAwareResult?.dayContexts || null,
        daySelections: dayAwareResult?.daySelections || null,
        // Geographic clustering: per-day zones with attraction/restaurant pools
        geoClusters: geoClusterResult?.dayAssignments || null,
        // Pass replanning context
        replanErrors: validationErrors.length > 0 ? validationErrors : undefined,
        previousPlan: lastAIResult?.itinerary?.days ? { days: lastAIResult.itinerary.days } : undefined,
      });
    } catch (err) {
      logger.warn(`[AI-PLANNING] AI call failed on attempt ${attempt}: ${err.message}`);
      attemptsLog.push({ attempt, status: 'error', error: err.message });
      continue;
    }

    lastAIResult = aiResult;

    if (!aiResult?.success || !aiResult?.itinerary?.days) {
      logger.warn(`[AI-PLANNING] AI returned no valid itinerary on attempt ${attempt}`);
      attemptsLog.push({ attempt, status: 'no-itinerary', provider: aiResult?.provider });
      continue;
    }

    // ═══ STEP 3: Resolve provider IDs ═══
    const { resolved, resolvedCount, unresolvedCount } = resolveProviderIds(
      aiResult.itinerary.days,
      candidates
    );

    // ═══ STEP 4: Rebuild costs from resolved data ═══
    const partySize = Math.max(1, (travelers?.adults || 1) + (travelers?.children || 0));
    rebuildCosts(resolved, { partySize, totalBudget, currency });

    const resolvedTotalCost = resolved.reduce((sum, d) => sum + (d.dayCost || 0), 0);

    // ═══ STEP 4b: Hard validation gate + enhanced validation ═══
    const validation = await finalValidatorAgent.run({
      days: resolved,
      budget: totalBudget,
      totalEstimatedCost: resolvedTotalCost,
      destination,
      origin,
      prefs,
      userId,
      candidates,
      weather: weatherResult,
      transportResult,
      hotelResult,
      routeCache,
      destLock,
      destCentroid: geoClusterResult?.clusterInfo?.centroid || null,
      currency,
      partySize,
    });

    lastValidation = validation;

    attemptsLog.push({
      attempt,
      status: validation.data.passed ? 'passed' : 'failed',
      provider: aiResult.provider,
      issues: validation.data.issues.length,
      warnings: validation.data.warnings.length,
      resolvedCount,
      unresolvedCount,
      totalCost: resolvedTotalCost,
    });

    if (validation.data.passed) {
      // ═══ Validation passed! Use repaired days if available ═══
      finalDays = validation.data.repairedDays || resolved;
      logger.info(`[AI-PLANNING] Validation PASSED on attempt ${attempt} (${aiResult.provider}, ${resolvedTotalCost} ${currency}, ${validation.data.repairCount || 0} repairs)`);
      break;
    }

    // ═══ STEP 5: Collect structured errors for replanning ═══
    validationErrors = validation.data.structuredErrors || validation.data.issues || [];
    
    // Enrich errors with available alternatives for each failed item
    validationErrors = validationErrors.map(err => {
      if (err.providerId && err.type !== 'BUDGET' && err.type !== 'MEAL_TIMING') {
        const errorType = err.type?.toLowerCase() || '';
        const failedCandidate = candidates.find(c => c.providerId === err.providerId);
        if (failedCandidate) {
          const alternatives = candidates.filter(c =>
            c.type === failedCandidate.type &&
            c.providerId !== err.providerId &&
            c.name !== failedCandidate.name
          ).slice(0, 5).map(c => ({
            provider: c.provider,
            providerId: c.providerId,
            name: c.name,
            rating: c.rating,
            price: c.price,
            suburb: c.suburb || '',
          }));
          return { ...err, availableAlternatives: alternatives };
        }
      }
      return err;
    });
    
    logger.info(`[AI-PLANNING] Validation FAILED on attempt ${attempt}: ${validationErrors.length} issues`);

    // If this was the last attempt, we'll use what we have
    if (attempt === MAX_REPLAN_ATTEMPTS) {
      logger.warn(`[AI-PLANNING] Max replanning attempts reached. Using best available plan.`);
      finalDays = resolved; // Use the best attempt
    }
  }

  // ═══ If all AI attempts failed, return null (caller will use deterministic fallback) ═══
  if (!finalDays) {
    logger.warn('[AI-PLANNING] All AI planning attempts failed — returning null for deterministic fallback');
    return {
      success: false,
      days: null,
      provider: lastAIResult?.provider || null,
      validation: lastValidation?.data || null,
      attempts: attemptsLog,
      latencyMs: Date.now() - started,
    };
  }

  const latencyMs = Date.now() - started;
  logger.info(`[AI-PLANNING] Pipeline complete in ${latencyMs}ms: ${finalDays.length} days, provider=${lastAIResult?.provider}, validation=${lastValidation?.data?.passed ? 'passed' : 'degraded'}`);

  return {
    success: true,
    days: finalDays,
    provider: lastAIResult?.provider || null,
    fallbackUsed: lastAIResult?.fallbackUsed || false,
    validation: lastValidation?.data || null,
    attempts: attemptsLog,
    latencyMs,
    geminiRequestCount: getRequestCount(),
  };
}

export default {
  normalizeCandidates,
  resolveProviderIds,
  rebuildCosts,
  runAIPlanningPipeline,
};
