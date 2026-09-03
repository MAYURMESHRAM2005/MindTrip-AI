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

  // Attractions (from Geoapify + Viator enrichment)
  for (const a of attractions || []) {
    candidates.push({
      id: `geoapify:${a.placeId || a.name}`,
      provider: 'geoapify',
      providerId: a.placeId || a.name,
      type: 'attraction',
      name: a.name || '',
      description: (a.types || []).join(', '),
      latitude: a.coordinates?.lat || null,
      longitude: a.coordinates?.lng || null,
      price: a.entryFee?.amount || 0,
      currency: a.entryFee?.currency || 'INR',
      rating: a.rating || null,
      priceLevel: a.priceLevel || null,
      openingHours: a.openingHours || null,
      duration: a.estimatedVisitHours || null,
      availability: a.dataStatus || 'estimate',
      bookingUrl: a.bookingUrl || '',
      imageUrl: a.imageUrl || '',
      source: 'geoapify',
      isLive: Boolean(a.isLive),
      isEstimate: Boolean(a.entryFee?.isEstimate ?? true),
      // Preserve enriched fields
      viatorPricing: a.viatorPricing || null,
      entryFee: a.entryFee || null,
      types: a.types || [],
      address: a.address || '',
      suburb: a.suburb || '',
      district: a.district || '',
    });
  }

  // Restaurants (from Geoapify + Zomato enrichment)
  for (const r of restaurants || []) {
    candidates.push({
      id: `geoapify:${r.placeId || r.name}`,
      provider: 'geoapify',
      providerId: r.placeId || r.name,
      type: 'restaurant',
      name: r.name || '',
      description: (r.cuisines || r.types || []).join(', '),
      latitude: r.coordinates?.lat || null,
      longitude: r.coordinates?.lng || null,
      price: r.averageCostPerPerson || 0,
      currency: 'INR',
      rating: r.rating || null,
      priceLevel: r.priceLevel || null,
      openingHours: r.openingHours || null,
      duration: null,
      availability: r.dataStatus || 'estimate',
      bookingUrl: r.bookingUrl || '',
      imageUrl: r.imageUrl || '',
      source: 'geoapify',
      isLive: Boolean(r.isLive),
      isEstimate: Boolean(r.zomatoData?.averageCostPerPerson ? false : true),
      // Preserve Zomato enrichment
      zomatoData: r.zomatoData || null,
      averageCostPerPerson: r.averageCostPerPerson || r.zomatoData?.averageCostPerPerson || null,
      averageCostForTwo: r.averageCostForTwo || r.zomatoData?.averageCostForTwo || null,
      cuisines: r.cuisines || r.zomatoData?.cuisines || [],
      types: r.types || [],
      address: r.address || '',
      suburb: r.suburb || '',
    });
  }

  // Nightlife
  for (const n of nightlife || []) {
    candidates.push({
      id: `geoapify:${n.placeId || n.name}`,
      provider: 'geoapify',
      providerId: n.placeId || n.name,
      type: 'nightlife',
      name: n.name || '',
      description: (n.types || []).join(', '),
      latitude: n.coordinates?.lat || null,
      longitude: n.coordinates?.lng || null,
      price: 0,
      currency: 'INR',
      rating: n.rating || null,
      openingHours: null,
      duration: null,
      availability: 'estimate',
      bookingUrl: '',
      imageUrl: '',
      source: 'geoapify',
      isLive: Boolean(n.isLive),
      isEstimate: true,
      types: n.types || [],
      address: n.address || '',
    });
  }

  // Hotel (from Amadeus)
  const hotel = hotelResult?.data?.recommended;
  if (hotel) {
    candidates.push({
      id: `amadeus:${hotel.name}`,
      provider: 'amadeus',
      providerId: hotel.name || 'recommended-hotel',
      type: 'hotel',
      name: hotel.name || '',
      description: hotel.address || '',
      latitude: hotel.latitude || null,
      longitude: hotel.longitude || null,
      price: hotel.price?.amount || 0,
      pricePerNight: hotel.price?.amount || 0,
      currency: hotel.price?.currency || 'INR',
      rating: hotel.rating || null,
      openingHours: null,
      duration: null,
      availability: hotelResult.data.isLive ? 'live' : 'estimate',
      bookingUrl: hotel.bookingUrl || '',
      imageUrl: hotel.imageUrl || '',
      source: 'amadeus-hotels',
      isLive: Boolean(hotelResult.data.isLive),
      isEstimate: Boolean(!hotelResult.data.isLive),
      amenities: hotel.amenities || [],
      address: hotel.address || '',
    });
  }
  // Additional hotels from the list
  for (const h of (hotelResult?.data?.hotels || []).slice(0, 10)) {
    if (h.name === hotel?.name) continue; // Skip duplicate
    candidates.push({
      id: `amadeus:${h.name}`,
      provider: 'amadeus',
      providerId: h.name || `hotel-${Math.random()}`,
      type: 'hotel',
      name: h.name || '',
      description: h.address || '',
      latitude: h.latitude || null,
      longitude: h.longitude || null,
      price: h.price?.amount || 0,
      pricePerNight: h.price?.amount || 0,
      currency: h.price?.currency || 'INR',
      rating: h.rating || null,
      openingHours: null,
      duration: null,
      availability: hotelResult.data.isLive ? 'live' : 'estimate',
      bookingUrl: h.bookingUrl || '',
      imageUrl: h.imageUrl || '',
      source: 'amadeus-hotels',
      isLive: Boolean(hotelResult.data.isLive),
      isEstimate: Boolean(!hotelResult.data.isLive),
      amenities: h.amenities || [],
      address: h.address || '',
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
      price: transportSelected.price?.amount || 0,
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
      price: offer.price?.amount || 0,
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
      price: e.priceRange?.min || 0,
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
  let unresolvedCount = 0;

  for (const day of aiDays || []) {
    const resolvedDay = {
      dayNumber: resolved.length + 1,
      date: day.date || '',
      theme: day.theme || '',
      area: day.theme || '',
      activities: [],
    };

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
    activity: 'activity',
  };
  return typeMap[type] || 'activity';
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
  // Hotels: nightly rate from candidate
  if (type === 'hotel') {
    if (candidate.pricePerNight > 0) {
      return {
        amount: candidate.pricePerNight,
        currency: candidate.currency || 'INR',
        isEstimate: Boolean(candidate.isEstimate),
        source: candidate.source || candidate.provider,
      };
    }
    return { amount: 0, currency: 'INR', isEstimate: true, source: 'budget-estimate' };
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
    return { amount: 0, currency: 'INR', isEstimate: true, source: 'budget-estimate' };
  }

  // Attractions: entry fee from candidate
  if (type === 'attraction') {
    if (candidate.price > 0) {
      return {
        amount: candidate.price,
        currency: candidate.currency || 'INR',
        isEstimate: Boolean(candidate.isEstimate),
        source: candidate.source || candidate.provider,
        estimateNote: candidate.isEstimate ? `Estimated from ${candidate.provider}` : `Real price from ${candidate.provider}`,
      };
    }
    return { amount: 0, currency: 'INR', isEstimate: true, source: 'estimate', estimateNote: 'Free / unknown entry fee' };
  }

  // Restaurants: average cost from candidate
  if (type === 'restaurant') {
    const cost = candidate.averageCostPerPerson || candidate.price || 0;
    if (cost > 0) {
      return {
        amount: cost,
        currency: candidate.currency || 'INR',
        isEstimate: Boolean(candidate.isEstimate),
        source: candidate.source || candidate.provider,
        estimateNote: candidate.hasZomatoData
          ? `Real average from Zomato × party size`
          : `Estimated from ${candidate.provider} priceLevel`,
      };
    }
    return { amount: 0, currency: 'INR', isEstimate: true, source: 'budget-estimate' };
  }

  // Events: price from candidate
  if (type === 'event') {
    if (candidate.price > 0) {
      return {
        amount: candidate.price,
        currency: candidate.currency || 'INR',
        isEstimate: Boolean(candidate.isEstimate),
        source: candidate.source || candidate.provider,
      };
    }
    if (candidate.isFree) {
      return { amount: 0, currency: 'INR', isEstimate: false, source: 'ticketmaster' };
    }
    return { amount: 0, currency: 'INR', isEstimate: true, source: 'estimate' };
  }

  // Nightlife: typically free or cover charge
  return { amount: 0, currency: 'INR', isEstimate: true, source: 'estimate' };
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
    isOverBudget, existingDaysPlan, userId, routeCache,
  } = opts;

  const started = Date.now();
  logger.info('[AI-PLANNING] Starting AI planning pipeline');

  // ═══ STEP 1: Normalize candidates ═══
  const candidates = normalizeCandidates({
    attractions, restaurants, nightlife, hotelResult, transportResult, eventsResult,
  });

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

    // ═══ STEP 4b: Deterministic validation with candidates ═══
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
      // ═══ Validation passed! ═══
      logger.info(`[AI-PLANNING] Validation PASSED on attempt ${attempt} (${aiResult.provider}, ${resolvedTotalCost} ${currency})`);
      finalDays = resolved;
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
