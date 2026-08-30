import geminiService from './gemini.service.js';
import groqService from './groq.service.js';
import env from '../config/env.js';

/**
 * Centralized Itinerary Generator Service with AI Fallback.
 *
 * Makes EXACTLY ONE Gemini API request with the complete structured travel
 * context. If Gemini fails (API error, timeout, rate limit, quota, invalid
 * JSON, etc.), automatically falls back to Groq with the SAME context.
 *
 * Design principles:
 *  - Gemini is always tried FIRST (primary provider)
 *  - Groq is called ONLY when Gemini fails (fallback)
 *  - Same normalized context is reused — no re-collection of travel data
 *  - One AI provider is called at a time (sequential, not parallel)
 *  - Schema validation catches malformed output from either provider
 *  - Timeout is configurable via environment variables
 */

const GEMINI_TIMEOUT_MS = env.GEMINI_TIMEOUT_MS || 45000;

let geminiRequestCount = 0;

// ── Allowed enum values ───────────────────────────────────────────────
const VALID_CATEGORIES = new Set([
  'transport', 'hotel', 'restaurant', 'attraction', 'activity', 'nightlife',
  'flight', 'train', 'bus', 'free', 'other',
]);
const VALID_SLOTS = new Set([
  'transport', 'hotel', 'breakfast', 'morning', 'lunch', 'afternoon',
  'evening', 'dinner', 'night', 'free', 'other',
]);
const VALID_DATA_STATUSES = new Set(['live', 'estimate', 'unavailable']);
const VALID_COST_CURRENCIES = new Set(['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'JPY']);

// ══════════════════════════════════════════════════════════════════════
//  SCHEMA VALIDATION
// ══════════════════════════════════════════════════════════════════════

/**
 * Validate the Gemini response against the expected itinerary schema.
 * Returns { valid: true, data } or { valid: false, errors: [...] }.
 */
function validateItinerarySchema(raw) {
  const errors = [];

  // ── Top-level wrapper ──────────────────────────────────────────────
  if (!raw || typeof raw !== 'object') {
    return { valid: false, errors: ['Response is not an object'] };
  }

  // Gemini sometimes wraps in { itinerary: {...} }, sometimes returns flat
  const root = raw.itinerary && typeof raw.itinerary === 'object' ? raw.itinerary : raw;

  // ── itinerary.destination ──────────────────────────────────────────
  if (typeof root.destination !== 'string' || !root.destination.trim()) {
    errors.push('itinerary.destination is missing or empty');
  }

  // ── itinerary.summary ─────────────────────────────────────────────
  if (typeof root.summary !== 'string') {
    errors.push('itinerary.summary is missing or not a string');
  }

  // ── itinerary.days ────────────────────────────────────────────────
  if (!Array.isArray(root.days)) {
    return { valid: false, errors: [...errors, 'itinerary.days is not an array'] };
  }
  if (root.days.length === 0) {
    return { valid: false, errors: [...errors, 'itinerary.days is empty'] };
  }

  // ── Per-day validation ────────────────────────────────────────────
  const seenSlotsPerDay = [];
  for (let di = 0; di < root.days.length; di++) {
    const day = root.days[di];
    const dayLabel = `days[${di}]`;
    const seenSlots = new Set();
    seenSlotsPerDay.push(seenSlots);

    // Required day fields
    if (day.dayNumber == null) {
      errors.push(`${dayLabel}.dayNumber is missing`);
    } else if (typeof day.dayNumber !== 'number') {
      errors.push(`${dayLabel}.dayNumber is not a number (got ${typeof day.dayNumber})`);
    }
    if (typeof day.date !== 'string') {
      errors.push(`${dayLabel}.date is missing or not a string`);
    }
    if (typeof day.area !== 'string') {
      errors.push(`${dayLabel}.area is missing or not a string`);
    }

    // Activities array
    if (!Array.isArray(day.activities)) {
      errors.push(`${dayLabel}.activities is not an array`);
      continue;
    }
    if (day.activities.length === 0) {
      errors.push(`${dayLabel}.activities is empty`);
    }

    // Day cost
    if (typeof day.dayCost !== 'number') {
      errors.push(`${dayLabel}.dayCost is missing or not a number`);
    }

    // costBreakdown
    if (day.costBreakdown && typeof day.costBreakdown !== 'object') {
      errors.push(`${dayLabel}.costBreakdown is not an object`);
    }

    // ── Per-activity validation ──────────────────────────────────────
    for (let ai = 0; ai < day.activities.length; ai++) {
      const act = day.activities[ai];
      const actLabel = `${dayLabel}.activities[${ai}]`;

      // Required fields
      if (typeof act.time !== 'string') {
        errors.push(`${actLabel}.time is missing or not a string`);
      }
      if (typeof act.title !== 'string' || !act.title.trim()) {
        errors.push(`${actLabel}.title is missing or empty`);
      }
      if (typeof act.place !== 'string') {
        errors.push(`${actLabel}.place is missing or not a string`);
      }
      if (typeof act.description !== 'string') {
        errors.push(`${actLabel}.description is missing or not a string`);
      }

      // Category enum
      if (!VALID_CATEGORIES.has(act.category)) {
        errors.push(`${actLabel}.category "${act.category}" is not valid (expected one of: ${[...VALID_CATEGORIES].join(', ')})`);
      }

      // Slot enum
      if (act.slot && !VALID_SLOTS.has(act.slot)) {
        errors.push(`${actLabel}.slot "${act.slot}" is not valid (expected one of: ${[...VALID_SLOTS].join(', ')})`);
      }

      // dataStatus enum
      if (act.dataStatus && !VALID_DATA_STATUSES.has(act.dataStatus)) {
        errors.push(`${actLabel}.dataStatus "${act.dataStatus}" is not valid`);
      }

      // isLive boolean
      if (act.isLive !== undefined && typeof act.isLive !== 'boolean') {
        errors.push(`${actLabel}.isLive is not a boolean`);
      }

      // priority number
      if (act.priority !== undefined && typeof act.priority !== 'number') {
        errors.push(`${actLabel}.priority is not a number`);
      }

      // ── cost object ───────────────────────────────────────────────
      if (!act.cost || typeof act.cost !== 'object') {
        errors.push(`${actLabel}.cost is missing or not an object`);
        continue;
      }
      if (typeof act.cost.amount !== 'number') {
        errors.push(`${actLabel}.cost.amount is missing or not a number`);
      }
      if (act.cost.amount < 0) {
        errors.push(`${actLabel}.cost.amount is negative (${act.cost.amount})`);
      }
      if (typeof act.cost.currency !== 'string' || !act.cost.currency.trim()) {
        errors.push(`${actLabel}.cost.currency is missing or empty`);
      }
      if (typeof act.cost.isEstimate !== 'boolean') {
        errors.push(`${actLabel}.cost.isEstimate is not a boolean`);
      }

      // ── coordinates (optional but must be valid when present) ─────
      if (act.coordinates != null) {
        if (typeof act.coordinates !== 'object') {
          errors.push(`${actLabel}.coordinates is not an object`);
        } else {
          if (typeof act.coordinates.lat !== 'number') {
            errors.push(`${actLabel}.coordinates.lat is not a number`);
          } else if (act.coordinates.lat < -90 || act.coordinates.lat > 90) {
            errors.push(`${actLabel}.coordinates.lat is out of range (${act.coordinates.lat})`);
          }
          if (typeof act.coordinates.lng !== 'number') {
            errors.push(`${actLabel}.coordinates.lng is not a number`);
          } else if (act.coordinates.lng < -180 || act.coordinates.lng > 180) {
            errors.push(`${actLabel}.coordinates.lng is out of range (${act.coordinates.lng})`);
          }
        }
      }

      // ── Slot time overlap detection ───────────────────────────────
      if (act.slot && act.time) {
        if (seenSlots.has(act.slot) && !['activity', 'attraction'].includes(act.slot)) {
          // Allow multiple activities/attractions per day, but warn on duplicate slots
          errors.push(`${actLabel}.slot "${act.slot}" duplicates an earlier slot on the same day`);
        }
        seenSlots.add(act.slot);
      }
    }
  }

  // ── transportPlan (optional but validate shape if present) ─────────
  if (root.transportPlan != null) {
    if (typeof root.transportPlan !== 'object') {
      errors.push('itinerary.transportPlan is not an object');
    } else {
      if (root.transportPlan.outbound !== undefined && typeof root.transportPlan.outbound !== 'string') {
        errors.push('itinerary.transportPlan.outbound is not a string');
      }
      if (root.transportPlan.return !== undefined && typeof root.transportPlan.return !== 'string') {
        errors.push('itinerary.transportPlan.return is not a string');
      }
      if (root.transportPlan.local !== undefined && typeof root.transportPlan.local !== 'string') {
        errors.push('itinerary.transportPlan.local is not a string');
      }
    }
  }

  // ── budgetBreakdown (optional but validate shape if present) ───────
  if (root.budgetBreakdown != null) {
    if (typeof root.budgetBreakdown !== 'object') {
      errors.push('itinerary.budgetBreakdown is not an object');
    } else {
      const bb = root.budgetBreakdown;
      if (bb.totalBudget !== undefined && typeof bb.totalBudget !== 'number') {
        errors.push('itinerary.budgetBreakdown.totalBudget is not a number');
      }
      if (bb.estimatedCost !== undefined && typeof bb.estimatedCost !== 'number') {
        errors.push('itinerary.budgetBreakdown.estimatedCost is not a number');
      }
      if (bb.remaining !== undefined && typeof bb.remaining !== 'number') {
        errors.push('itinerary.budgetBreakdown.remaining is not a number');
      }
      if (bb.byCategory != null && typeof bb.byCategory !== 'object') {
        errors.push('itinerary.budgetBreakdown.byCategory is not an object');
      }
    }
  }

  // ── tips / warnings / safetyNotes (optional arrays/strings) ────────
  if (root.tips !== undefined && !Array.isArray(root.tips)) {
    errors.push('itinerary.tips is not an array');
  }
  if (root.warnings !== undefined && !Array.isArray(root.warnings)) {
    errors.push('itinerary.warnings is not an array');
  }
  if (root.safetyNotes !== undefined && typeof root.safetyNotes !== 'string') {
    errors.push('itinerary.safetyNotes is not a string');
  }
  if (root.hotelSummary !== undefined && typeof root.hotelSummary !== 'string') {
    errors.push('itinerary.hotelSummary is not a string');
  }

  // ── Result ────────────────────────────────────────────────────────
  if (errors.length > 0) {
    return { valid: false, errors };
  }
  return { valid: true, data: root };
}

// ══════════════════════════════════════════════════════════════════════
//  SANITIZATION — fix common Gemini mistakes before validation
// ══════════════════════════════════════════════════════════════════════

/**
 * Attempt to coerce a Gemini response into the expected shape.
 * Fixes common issues: wrong types, missing fields, extra nesting.
 */
function sanitizeItinerary(raw) {
  if (!raw || typeof raw !== 'object') return null;

  // Unwrap if Gemini wrapped in { itinerary: {...} }
  let root = raw.itinerary && typeof raw.itinerary === 'object' ? raw.itinerary : { ...raw };

  // Ensure days is an array
  if (!Array.isArray(root.days)) {
    root.days = [];
  }

  // Ensure destination and summary are strings
  root.destination = String(root.destination || '').trim() || 'Unknown destination';
  root.summary = String(root.summary || '').trim() || 'Trip itinerary';

  // Sanitize each day
  for (let di = 0; di < root.days.length; di++) {
    const day = root.days[di];
    if (!day || typeof day !== 'object') {
      root.days[di] = { dayNumber: di + 1, date: '', area: '', activities: [], dayCost: 0 };
      continue;
    }

    // Ensure required day fields
    if (day.dayNumber == null) day.dayNumber = di + 1;
    day.dayNumber = Number(day.dayNumber) || di + 1;
    day.date = String(day.date || '').trim();
    day.area = String(day.area || '').trim();
    day.theme = String(day.theme || '').trim();

    if (!Array.isArray(day.activities)) day.activities = [];
    if (typeof day.dayCost !== 'number') day.dayCost = 0;

    // costBreakdown
    if (!day.costBreakdown || typeof day.costBreakdown !== 'object') {
      day.costBreakdown = {};
    }

    // Sanitize each activity
    for (let ai = 0; ai < day.activities.length; ai++) {
      const act = day.activities[ai];
      if (!act || typeof act !== 'object') {
        day.activities[ai] = {
          time: '12:00', title: 'Activity', place: '', description: '',
          category: 'activity', cost: { amount: 0, currency: 'INR', isEstimate: true },
          isLive: false, dataStatus: 'unavailable', priority: 3,
        };
        continue;
      }

      // Coerce required strings
      act.time = String(act.time || '12:00').trim();
      act.title = String(act.title || '').trim() || 'Activity';
      act.place = String(act.place || '').trim();
      act.description = String(act.description || '').trim();
      act.address = String(act.address || '').trim();

      // Category — clamp to valid values
      if (!VALID_CATEGORIES.has(act.category)) {
        act.category = 'activity';
      }

      // Slot — clamp to valid values
      if (act.slot && !VALID_SLOTS.has(act.slot)) {
        act.slot = 'other';
      }

      // dataStatus — clamp to valid values
      if (!VALID_DATA_STATUSES.has(act.dataStatus)) {
        act.dataStatus = 'estimate';
      }

      // isLive boolean
      act.isLive = Boolean(act.isLive);

      // priority number
      act.priority = Number(act.priority) || 1;

      // fetchedAt — data source transparency
      if (!act.fetchedAt) act.fetchedAt = new Date().toISOString();

      // Coordinates — ensure valid shape
      if (act.coordinates != null && typeof act.coordinates === 'object') {
        const lat = Number(act.coordinates.lat);
        const lng = Number(act.coordinates.lng);
        if (Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
          act.coordinates = { lat, lng };
        } else {
          act.coordinates = null;
        }
      } else {
        act.coordinates = null;
      }

      // Cost — ensure valid shape
      if (!act.cost || typeof act.cost !== 'object') {
        act.cost = { amount: 0, currency: 'INR', isEstimate: true };
      }
      act.cost.amount = Number(act.cost.amount) || 0;
      if (act.cost.amount < 0) act.cost.amount = 0;
      act.cost.currency = String(act.cost.currency || 'INR').trim().toUpperCase();
      if (!VALID_COST_CURRENCIES.has(act.cost.currency)) {
        act.cost.currency = 'INR';
      }
      act.cost.isEstimate = Boolean(act.cost.isEstimate);
    }
  }

  // Ensure optional sections have valid shapes
  if (root.transportPlan && typeof root.transportPlan !== 'object') {
    root.transportPlan = {};
  }
  if (root.budgetBreakdown && typeof root.budgetBreakdown !== 'object') {
    root.budgetBreakdown = {};
  }
  if (!Array.isArray(root.tips)) root.tips = [];
  if (!Array.isArray(root.warnings)) root.warnings = [];
  if (typeof root.safetyNotes !== 'string') root.safetyNotes = '';
  if (typeof root.hotelSummary !== 'string') root.hotelSummary = '';

  return root;
}

// ══════════════════════════════════════════════════════════════════════
//  CONTEXT BUILDERS
// ══════════════════════════════════════════════════════════════════════

/**
 * Build the structured travel context sent to Gemini.
 * Raw API responses are normalized and minimized to reduce tokens.
 */
function buildContext(data) {
  const {
    userPreferences = {},
    destination,
    origin,
    startDate,
    endDate,
    travelers = {},
    totalBudget,
    currency = 'INR',
    weather = {},
    accommodation = {},
    transport = {},
    attractions = [],
    restaurants = [],
    nightlife = [],
    traffic = {},
    guide = {},
    safety = {},
    events = null,
    budgetAllocation = {},
    totalEstimatedCost = 0,
    isOverBudget = false,
    existingDaysPlan = null,
    daysCount = 1,
    nightsCount = 0,
  } = data;

  return {
    trip: {
      origin: origin || '',
      destination,
      startDate,
      endDate,
      daysCount,
      nightsCount,
      travelers: {
        adults: travelers.adults || 1,
        children: travelers.children || 0,
        total: (travelers.adults || 1) + (travelers.children || 0),
      },
      travelStyle: userPreferences.travelStyle || 'standard',
      activityLevel: userPreferences.activityLevel || 'moderate',
      interests: (userPreferences.interests || []).slice(0, 8),
      foodPreference: userPreferences.foodPreference || '',
      hotelPreference: userPreferences.hotelPreference || '',
      transportPreference: userPreferences.transportPreference || '',
      accessibility: (userPreferences.accessibility || []).slice(0, 4),
      familyWithKids: userPreferences.familyWithKids || false,
    },
    budget: {
      totalBudget,
      currency,
      totalEstimatedCost,
      isOverBudget,
      allocation: {
        transport: budgetAllocation.transport?.amount || 0,
        hotels: budgetAllocation.hotels?.amount || 0,
        food: budgetAllocation.food?.amount || 0,
        activities: budgetAllocation.activities?.amount || 0,
        misc: budgetAllocation.misc?.amount || 0,
      },
    },
    weather: normalizeWeather(weather),
    accommodation: normalizeAccommodation(accommodation),
    transport: normalizeTransport(transport),
    attractions: (attractions || []).slice(0, 12).map((a) => ({
      name: a.name || '', placeId: a.placeId || '', type: (a.types || []).join(', '), address: a.address || '',
      rating: a.rating, priceLevel: a.priceLevel, coordinates: a.coordinates,
      distanceMeters: a.distanceMeters, source: a.entryFee?.source || 'geoapify',
      entryFee: a.entryFee || null,
      viatorPricing: a.viatorPricing || null,
      note: a.entryFee ? `Real entry fee from Viator: ${a.entryFee.currency} ${a.entryFee.amount}` : 'Entry fees are estimates — no live pricing from provider',
    })),
    restaurants: (restaurants || []).slice(0, 10).map((r) => ({
      name: r.name || '', placeId: r.placeId || '', type: (r.types || []).join(', '), address: r.address || '',
      rating: r.rating, priceLevel: r.priceLevel, coordinates: r.coordinates,
      source: r.zomatoData ? 'zomato' : 'geoapify',
      averageCostPerPerson: r.averageCostPerPerson || r.zomatoData?.averageCostPerPerson || null,
      averageCostForTwo: r.averageCostForTwo || r.zomatoData?.averageCostForTwo || null,
      zomatoRating: r.zomatoData?.rating || null,
      zomatoVotes: r.zomatoData?.votes || null,
      cuisines: r.cuisines || r.zomatoData?.cuisines || null,
      note: r.zomatoData
        ? `Real average meal cost from Zomato: ${r.zomatoData.averageCostPerPerson}/person (${r.zomatoData.ratingText || 'rated'} ${r.zomatoData.rating ?? ''})`
        : 'Menu prices not available — costs are estimates based on priceLevel',
    })),
    nightlife: (nightlife || []).slice(0, 8).map((n) => ({
      name: n.name || '', placeId: n.placeId || '', type: (n.types || []).join(', '), address: n.address || '',
      coordinates: n.coordinates, source: 'geoapify',
    })),
    traffic: {
      isLive: traffic.isLive || false,
      transitNotes: traffic.transitNotes || '',
      suggestions: traffic.suggestions || [],
      riskyLegs: traffic.riskyLegs || [],
    },
    events: normalizeEvents(events),
    guide: {
      localTips: (guide.localTips || []).slice(0, 6),
      etiquette: (guide.etiquette || []).slice(0, 4),
      hiddenGems: (guide.hiddenGems || []).slice(0, 4),
      languagePhrases: (guide.languagePhrases || []).slice(0, 6),
      paymentNotes: guide.paymentNotes || '',
    },
    safety: {
      safetyTips: (safety.safetyTips || []).slice(0, 6),
      scamAlerts: (safety.scamAlerts || []).slice(0, 4),
      healthNotes: safety.healthNotes || '',
      emergencyAdvice: safety.emergencyAdvice || '',
    },
    existingPlan: existingDaysPlan
      ? { summary: 'A deterministic plan is provided as reference.' }
      : null,
  };
}

function normalizeWeather(weather) {
  if (!weather || !weather.data) return { available: false, message: 'Weather data unavailable' };
  const d = weather.data;
  return {
    available: true,
    provider: d.provider || 'unavailable',
    current: d.current ? {
      temp: d.current.temp, condition: d.current.condition,
      description: d.current.description, humidity: d.current.humidity,
      windSpeed: d.current.windSpeed,
    } : null,
    forecast: (d.forecast || []).slice(0, 7).map((f) => ({
      date: f.date, tempMin: f.tempMin, tempMax: f.tempMax,
      condition: f.condition, description: f.description,
      rainProbability: f.rainProbability, humidity: f.humidity, windSpeed: f.windSpeed,
    })),
  };
}

function normalizeAccommodation(accommodation) {
  if (!accommodation || !accommodation.data) return { available: false, message: 'Hotel data unavailable' };
  const d = accommodation.data;
  return {
    available: true, isLive: d.isLive || false, source: d.source || 'unavailable',
    hotelCount: (d.hotels || []).length,
    recommended: d.recommended ? {
      name: d.recommended.name, address: d.recommended.address,
      price: d.recommended.price, rating: d.recommended.rating,
    } : null,
    topOptions: (d.hotels || []).slice(0, 5).map((h) => ({
      name: h.name, price: h.price, rating: h.rating, address: h.address,
    })),
  };
}

function normalizeTransport(transport) {
  if (!transport || !transport.data) return { available: false, mode: 'unknown', message: 'Transport data unavailable' };
  const d = transport.data;
  const mode = transport.mode || 'unknown';
  return {
    available: true, mode, isLive: d.isLive || false,
    selected: d.selected ? {
      name: d.selected.airline || d.selected.trainName || d.selected.operator || '',
      flightNumber: d.selected.flightNumber || '',
      departure: d.selected.departAt || d.selected.departure || '',
      arrival: d.selected.arriveAt || d.selected.arrival || '',
      duration: d.selected.duration || '', stops: d.selected.stops, price: d.selected.price,
    } : null,
    alternatives: (d.offers || []).slice(0, 3).map((o) => ({
      name: o.airline || o.trainName || o.operator || '',
      departure: o.departAt || o.departure || '',
      arrival: o.arriveAt || o.arrival || '',
      price: o.price, duration: o.duration,
    })),
  };
}

function normalizeEvents(events) {
  if (!events || !events.events?.length) {
    return { available: false, totalEvents: 0, message: 'No cultural events found for trip dates' };
  }
  return {
    available: true,
    totalEvents: events.totalEvents || events.events.length,
    daysWithEvents: events.daysWithEvents || 0,
    categories: events.categories || [],
    events: (events.events || []).slice(0, 15).map((e) => ({
      name: e.name || '',
      date: e.date || '',
      time: e.time || '',
      venue: e.venueName || '',
      address: e.venueAddress || '',
      city: e.venueCity || '',
      category: e.category || '',
      genre: e.genre || '',
      priceRange: e.priceRange || null,
      isFree: e.isFree || false,
      url: e.url || '',
      imageUrl: e.imageUrl || '',
    })),
    daysMap: events.daysMap || {},
    note: events.note || `Found ${events.totalEvents} real events from Ticketmaster`,
  };
}

// ══════════════════════════════════════════════════════════════════════
//  MAIN GENERATION FUNCTION
// ══════════════════════════════════════════════════════════════════════

/**
 * Validate a raw LLM response into a usable itinerary.
 * Sanitize → schema validate → enforce data integrity → recalculate costs.
 * Shared by both Gemini and Groq paths.
 *
 * @returns {{ valid: boolean, itinerary: object|null, errors: string[] }}
 */
function validateAndPrepareItinerary(raw, context) {
  const sanitized = sanitizeItinerary(raw);
  if (!sanitized) {
    return { valid: false, itinerary: null, errors: ['Response could not be sanitized into valid structure'] };
  }
  const validation = validateItinerarySchema(sanitized);
  if (!validation.valid) {
    return { valid: false, itinerary: null, errors: validation.errors };
  }
  const itinerary = validation.data;
  enforceDataIntegrity(itinerary, context);
  recalculateDayCosts(itinerary);
  return { valid: true, itinerary, errors: [] };
}

/**
 * Generate the final personalized day-wise itinerary from complete context.
 * Tries Gemini FIRST. If Gemini fails, automatically falls back to Groq
 * with the SAME normalized context.
 *
 * @param {object} data - Complete aggregated travel context
 * @returns {object} - { success, itinerary, provider, fallbackUsed, error, geminiRequestCount, latencyMs, validationErrors }
 */
export async function generateItinerary(data) {
  const started = Date.now();
  const requestNumber = ++geminiRequestCount;
  const userId = data.userId || null;

  console.log(`[itineraryGenerator] Request #${requestNumber} starting at ${new Date().toISOString()}`);

  // 1. Build normalized context ONCE (reused for both providers)
  const context = buildContext(data);

  // 2. Construct prompts ONCE (reused for both providers)
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(context, data);

  // ══════════════════════════════════════════════════════════════════
  //  STEP 1: Try Gemini (primary)
  // ══════════════════════════════════════════════════════════════════
  let geminiFailed = false;
  let geminiError = null;

  console.log('[AI] Trying Gemini');
  const geminiStarted = Date.now();
  const geminiResult = await callLLMWithTimeout({
    service: geminiService,
    prompt: userPrompt,
    system: systemPrompt,
    agent: 'itinerary-generator',
    action: 'generateItinerary',
    userId,
    timeoutMs: GEMINI_TIMEOUT_MS,
    providerName: 'Gemini',
  });
  const geminiLatencyMs = Date.now() - geminiStarted;

  if (geminiResult.success && geminiResult.data) {
    const checked = validateAndPrepareItinerary(geminiResult.data, context);
    if (checked.valid) {
      const totalLatencyMs = Date.now() - started;
      console.log(`[AI] Gemini success (${geminiLatencyMs}ms)`);
      return {
        success: true,
        itinerary: checked.itinerary,
        provider: 'gemini',
        fallbackUsed: false,
        error: null,
        geminiRequestCount: requestNumber,
        latencyMs: totalLatencyMs,
        validationErrors: [],
      };
    }
    // Gemini returned data but it failed validation
    geminiFailed = true;
    geminiError = `Gemini validation failed: ${checked.errors[0]}`;
    console.warn(`[AI] Gemini failed: ${geminiError}`);
  } else {
    // Gemini returned an error or no data
    geminiFailed = true;
    geminiError = geminiResult.message || 'Gemini request failed';
    console.warn(`[AI] Gemini failed: ${geminiError}`);
  }

  // ══════════════════════════════════════════════════════════════════
  //  STEP 2: Fallback to Groq (same context, sequential)
  // ══════════════════════════════════════════════════════════════════
  console.log('[AI] Falling back to Groq');
  const groqStarted = Date.now();
  const groqResult = await callLLMWithTimeout({
    service: groqService,
    prompt: userPrompt,
    system: systemPrompt,
    agent: 'itinerary-generator',
    action: 'generateItinerary',
    userId,
    timeoutMs: env.GROQ_TIMEOUT_MS || 60000,
    providerName: 'Groq',
  });
  const groqLatencyMs = Date.now() - groqStarted;

  if (groqResult.success && groqResult.data) {
    const checked = validateAndPrepareItinerary(groqResult.data, context);
    if (checked.valid) {
      const totalLatencyMs = Date.now() - started;
      console.log(`[AI] Groq success (${groqLatencyMs}ms)`);
      return {
        success: true,
        itinerary: checked.itinerary,
        provider: 'groq',
        fallbackUsed: true,
        error: null,
        geminiRequestCount: requestNumber,
        latencyMs: totalLatencyMs,
        validationErrors: [],
      };
    }
    // Groq returned data but it failed validation
    const totalLatencyMs = Date.now() - started;
    console.warn(`[AI] Groq returned invalid itinerary: ${checked.errors[0]}`);
    return {
      success: false,
      itinerary: null,
      provider: 'groq',
      fallbackUsed: true,
      error: `Both Gemini and Groq failed. Groq validation: ${checked.errors[0]}. Gemini error: ${geminiError}`,
      geminiRequestCount: requestNumber,
      latencyMs: totalLatencyMs,
      validationErrors: checked.errors,
    };
  }

  // Both providers failed
  const totalLatencyMs = Date.now() - started;
  const groqError = groqResult.message || 'Groq request failed';
  console.error(`[AI] Both Gemini and Groq failed. Gemini: ${geminiError} | Groq: ${groqError}`);
  return {
    success: false,
    itinerary: null,
    provider: null,
    fallbackUsed: true,
    error: 'Unable to generate itinerary at the moment. Please try again.',
    geminiRequestCount: requestNumber,
    latencyMs: totalLatencyMs,
    validationErrors: [],
  };
}

// ══════════════════════════════════════════════════════════════════════
//  DATA INTEGRITY ENFORCEMENT
// ══════════════════════════════════════════════════════════════════════

/**
 * Post-validation: mark any Gemini-invented data as unavailable.
 * Also ensures every activity has proper metadata (fetchedAt, source, cost fields).
 */
function enforceDataIntegrity(itinerary, context) {
  const availableRestaurants = new Set(
    (context.restaurants || []).map((r) => r.name?.toLowerCase())
  );
  const availableAttractions = new Set(
    (context.attractions || []).map((a) => a.name?.toLowerCase())
  );
  const hasLiveWeather = context.weather?.available && context.weather?.current;
  const hasLiveHotels = context.accommodation?.available && context.accommodation?.isLive;
  const hasLiveTransport = context.transport?.available && context.transport?.isLive;
  const now = new Date().toISOString();

  // ═══ Cross-day uniqueness enforcement ═══
  // Track used attraction and restaurant names across all days.
  // If Gemini introduced duplicates, mark the later ones as unavailable.
  const usedAttractionNames = new Set();
  const usedRestaurantNames = new Set();

  for (const day of itinerary.days || []) {
    if (!hasLiveWeather && day.weather) {
      day.weather = {
        ...day.weather,
        condition: 'unknown',
        description: 'Weather data unavailable — check local forecasts',
        rainProbability: null,
        isLive: false,
      };
    }

    for (const activity of day.activities || []) {
      // Ensure every activity has fetchedAt metadata
      if (!activity.fetchedAt) activity.fetchedAt = now;

      if (activity.category === 'restaurant') {
        const name = (activity.place || activity.title || '').toLowerCase();
        if (name && !availableRestaurants.has(name)) {
          activity.dataStatus = 'unavailable';
          activity.isLive = false;
          activity.description = `${activity.description || 'Restaurant'} (unverified — not in live data)`;
        }
        // Cross-day restaurant deduplication
        if (name && activity.dataStatus !== 'unavailable') {
          if (usedRestaurantNames.has(name)) {
            // Duplicate restaurant across days — mark as unavailable
            activity.dataStatus = 'unavailable';
            activity.isLive = false;
            activity.description = `${activity.description || 'Restaurant'} (removed — duplicate across days)`;
          } else {
            usedRestaurantNames.add(name);
          }
        }
        // Restaurant costs from Geoapify are ALWAYS estimates (no real menu prices)
        if (activity.cost) {
          activity.cost.isEstimate = true;
          if (!activity.cost.estimateNote) {
            activity.cost.estimateNote = 'Estimated based on restaurant price level — actual menu prices not available from provider';
          }
        }
      }

      if (activity.category === 'attraction' || activity.category === 'activity') {
        const name = (activity.place || activity.title || '').toLowerCase();
        if (name && name !== 'explore' && !availableAttractions.has(name)) {
          const isGeneric = /^(explore|visit|see|enjoy|discover|free time|leisure)/i.test(name);
          if (!isGeneric && availableAttractions.size > 0) {
            activity.dataStatus = 'unavailable';
            activity.isLive = false;
            activity.description = `${activity.description || 'Activity'} (unverified — not in live data)`;
          }
        }
        // Cross-day attraction deduplication
        if (name && activity.dataStatus !== 'unavailable') {
          const isGeneric = /^(explore|visit|see|enjoy|discover|free time|leisure)/i.test(name);
          if (!isGeneric) {
            if (usedAttractionNames.has(name)) {
              // Duplicate attraction across days — mark as unavailable
              activity.dataStatus = 'unavailable';
              activity.isLive = false;
              activity.description = `${activity.description || 'Activity'} (removed — duplicate across days)`;
            } else {
              usedAttractionNames.add(name);
            }
          }
        }
        // Attraction entry fees: preserve Viator real pricing, mark others as estimates
        if (activity.cost) {
          if (activity.cost.source === 'viator') {
            // Viator provides real pricing — keep isEstimate = false
            activity.dataStatus = 'live';
            activity.isLive = true;
          } else if (!activity.cost.isEstimate) {
            // Cost was not from Viator and not marked as estimate — force estimate
            activity.cost.isEstimate = true;
            if (!activity.cost.estimateNote) {
              activity.cost.estimateNote = 'Estimated entry fee — no live pricing available from provider';
            }
          }
        }
      }

      if (activity.category === 'hotel' && !hasLiveHotels) {
        const hotelName = activity.place || '';
        const recommendedName = context.accommodation?.recommended?.name || '';
        if (hotelName && recommendedName && hotelName !== recommendedName) {
          activity.dataStatus = 'estimate';
          activity.isLive = false;
        }
      }

      if (['transport', 'flight', 'train', 'bus'].includes(activity.category) && !hasLiveTransport) {
        if (activity.dataStatus === 'live') {
          activity.dataStatus = 'unavailable';
          activity.isLive = false;
        }
      }

      // Ensure cost has required fields
      if (!activity.cost) {
        activity.cost = { amount: 0, currency: context.budget?.currency || 'INR', isEstimate: true };
      }
      if (activity.cost.currency === undefined) {
        activity.cost.currency = context.budget?.currency || 'INR';
      }
    }
  }
}

/**
 * Recalculate dayCost and costBreakdown from activities to ensure consistency.
 */
function recalculateDayCosts(itinerary) {
  for (const day of itinerary.days || []) {
    let totalDay = 0;
    const breakdown = { accommodation: 0, food: 0, transport: 0, activities: 0 };

    for (const act of day.activities || []) {
      const amt = act.cost?.amount || 0;
      totalDay += amt;
      if (act.category === 'hotel') breakdown.accommodation += amt;
      else if (act.category === 'restaurant') breakdown.food += amt;
      else if (['transport', 'flight', 'train', 'bus'].includes(act.category)) breakdown.transport += amt;
      else breakdown.activities += amt;
    }

    day.dayCost = Math.round(totalDay * 100) / 100;
    day.costBreakdown = {
      accommodation: Math.round(breakdown.accommodation * 100) / 100,
      food: Math.round(breakdown.food * 100) / 100,
      transport: Math.round(breakdown.transport * 100) / 100,
      activities: Math.round(breakdown.activities * 100) / 100,
    };
  }
}

/**
 * Count total activities across all days.
 */
function countActivities(itinerary) {
  return (itinerary.days || []).reduce((sum, day) => sum + (day.activities?.length || 0), 0);
}

// ══════════════════════════════════════════════════════════════════════
//  PROMPTS
// ══════════════════════════════════════════════════════════════════════

/** System prompt — instructs Gemini to ONLY use provided data. */
function buildSystemPrompt() {
  return `You are TravelMind AI's Itinerary Generator. You create a personalized day-wise travel itinerary using ONLY the verified travel data provided in the input JSON.

═══ CRITICAL ANTI-HALLUCINATION RULES ═══
You are STRICTLY FORBIDDEN from inventing ANY of the following:
- Hotel names, prices, or availability
- Restaurant names, menu items, or prices
- Attraction names, entry fees, or opening hours
- Flight numbers, airline names, departure/arrival times, or prices
- Train numbers, train names, or ticket prices
- Bus operator names or ticket prices
- Airport names or IATA codes
- Weather conditions or temperatures
- Distances or travel durations
- Any price, cost, or monetary value
- Any schedule, timetable, or timing
- Any availability, booking status, or reservation

If the provided data does not contain information for a required field, use:
- "Not available" for missing text fields
- 0 with isEstimate: true for missing prices
- null for missing coordinates

═══ WHAT YOU ARE ALLOWED TO DO ═══
1. ORGANIZE the provided data into a day-by-day schedule
2. RANK and SELECT from the provided options (best hotel, best restaurants, etc.)
3. ASSIGN geographic areas to days based on coordinate proximity
4. CREATE descriptions and summaries using the provided data
5. CALCULATE daily costs using provided prices (never invent prices)
6. GENERATE travel tips using general knowledge (always note: "General advice — verify locally")
7. SUGGEST meal times and activity sequences
8. PROVIDE cultural context for the destination
9. SCHEDULE real cultural events on their specific dates (from EVENT DATA) — these are confirmed events, not invented

═══ STRUCTURAL RULES ═══
- Every attraction must appear on ONLY ONE day (no repeats across days)
- Hotels CAN repeat across days (same hotel for multi-night stay)
- Restaurants should NOT repeat across days when enough options exist
- Every day must have: breakfast, morning activity, lunch, afternoon activity, evening activity, dinner
- Arrival day: start with transport + check-in
- Departure day: check-out + return transport (no sightseeing)
- Never schedule two activities at the same time
- Never schedule an attraction after 20:00 (most close by then)
- Every activity must have a cost entry with isEstimate flag
- Use provided coordinates for all places — never invent coordinates

═══ COST RULES ═══
- Use EXACT prices from the provided data when available
- For attractions: use entryFee from Viator when provided (isEstimate: false) — these are REAL prices
- For restaurants: use averageCostPerPerson from Zomato when provided (isEstimate: false) — these are REAL data
- For restaurants without Zomato data: use priceLevel-based estimates (always mark isEstimate: true)
- For transport: use provided prices or mark as estimate
- NEVER change an API-provided price
- Total daily cost must equal sum of activity costs

═══ OUTPUT FORMAT ═══
Return a JSON object with this exact structure:
{
  "itinerary": {
    "destination": "...",
    "summary": "A brief trip summary",
    "days": [
      {
        "dayNumber": 1,
        "date": "YYYY-MM-DD",
        "area": "Geographic area or neighborhood",
        "theme": "Day theme (e.g. 'Arrival & Old City')",
        "activities": [
          {
            "time": "HH:MM",
            "title": "Activity title",
            "place": "Place name (from real data only)",
            "description": "Brief description",
            "category": "transport|hotel|restaurant|attraction|activity|nightlife",
            "address": "Real address from provided data",
            "coordinates": {"lat": N, "lng": N} or null,
            "cost": {"amount": N, "currency": "...", "isEstimate": true|false},
            "isLive": true|false,
            "dataStatus": "live|estimate|unavailable",
            "priority": 1,
            "slot": "transport|hotel|breakfast|morning|lunch|afternoon|evening|dinner|night"
          }
        ],
        "weather": {"tempMin": N, "tempMax": N, "condition": "...", "rainProbability": N, "indoorPlan": false},
        "dayCost": N,
        "costBreakdown": {"accommodation": N, "food": N, "transport": N, "activities": N}
      }
    ],
    "transportPlan": {
      "outbound": "Summary of outbound transport",
      "return": "Summary of return transport",
      "local": "Local transport tips"
    },
    "hotelSummary": "Summary of accommodation",
    "budgetBreakdown": {
      "totalBudget": N,
      "estimatedCost": N,
      "remaining": N,
      "byCategory": {"transport": N, "accommodation": N, "food": N, "activities": N}
    },
    "tips": ["Tip 1", "Tip 2"],
    "warnings": ["Warning 1"],
    "safetyNotes": "Safety summary"
  }
}`;
}

/** Build the user prompt with the complete context. */
function buildUserPrompt(context, rawData) {
  // Build a data-source summary so Gemini knows which items are real vs estimated
  const viatorEnrichedCount = (rawData.attractions || []).filter((a) => a.entryFee?.source === 'viator').length;
  const zomatoEnrichedCount = (rawData.restaurants || []).filter((r) => r.zomatoData && r.zomatoData.averageCostPerPerson > 0).length;
  const dataSourceSummary = {
    weatherSource: rawData.weather?.data?.provider || 'unavailable',
    hotelSource: rawData.accommodation?.data?.source || 'unavailable',
    hotelIsLive: rawData.accommodation?.data?.isLive || false,
    flightSource: rawData.transport?.data?.isLive ? (rawData.transport?.data?.selected?.provider || 'live') : 'unavailable',
    attractionCount: (rawData.attractions || []).length,
    attractionSource: viatorEnrichedCount > 0 ? `viator+geoapify (${viatorEnrichedCount} with real pricing)` : 'geoapify',
    restaurantCount: (rawData.restaurants || []).length,
    restaurantSource: zomatoEnrichedCount > 0 ? `zomato+geoapify (${zomatoEnrichedCount} with real pricing)` : 'geoapify',
    nightlifeCount: (rawData.nightlife || []).length,
    note: [
      viatorEnrichedCount > 0 ? `Attraction entry fees from Viator are REAL prices.` : '',
      zomatoEnrichedCount > 0 ? `Restaurant average costs from Zomato are REAL data. Use averageCostPerPerson for meal pricing.` : '',
      viatorEnrichedCount === 0 && zomatoEnrichedCount === 0 ? 'All prices from Geoapify are estimates based on priceLevel. Actual menu prices and entry fees are NOT available from this provider.' : '',
    ].filter(Boolean).join(' '),
  };

  return `You are the final itinerary planner for TravelMind AI. Create a personalized day-wise travel itinerary using ONLY the verified travel data provided below.

═══ CRITICAL: YOU MUST NOT INVENT ANY DATA ═══
The following items MUST come EXACTLY from the provided data. If not in the data, use "Not available":
- Hotel names → use ONLY from HOTEL DATA section
- Restaurant names → use ONLY from RESTAURANT DATA section
- Attraction names → use ONLY from PLACES DATA section
- Flight details → use ONLY from TRANSPORT DATA section
- Prices → use ONLY from provided data; if missing, use 0 with isEstimate=true
- Weather → use ONLY from WEATHER DATA section
- Distances/times → use ONLY from ROUTE DATA or provided coordinates

═══ STRUCTURAL RULES ═══
- Every attraction appears on ONLY ONE day — check placeId to prevent duplicates
- Hotels CAN repeat (same hotel for multi-night stay)
- Restaurants should NOT repeat when enough options exist
- Budget limit: ${context.budget.totalBudget} ${context.budget.currency}
- Each day needs: breakfast, morning, lunch, afternoon, evening, dinner, night
- Arrival day: transport + check-in first
- Departure day: check-out + return transport only
- No overlapping activities
- No attractions scheduled after 20:00

═══ COST RULES ═══
- Use exact prices from provided data
- Attraction entry fees with source='viator' are REAL prices (isEstimate: false) — use them as-is
- Restaurant costs with source='zomato' are REAL data (isEstimate: false) — use averageCostPerPerson for meal pricing
- Geoapify restaurant costs without Zomato data are ESTIMATES (mark isEstimate=true)
- Transport prices come from provider when available
- Total daily cost = sum of activity costs
- Never modify an API-provided price

DATA SOURCE TRANSPARENCY:
${JSON.stringify(dataSourceSummary, null, 2)}

The input contains:

USER DATA:
${JSON.stringify(context.trip, null, 2)}

BUDGET DATA:
${JSON.stringify(context.budget, null, 2)}

WEATHER DATA:
${JSON.stringify(context.weather, null, 2)}

HOTEL DATA:
${JSON.stringify(context.accommodation, null, 2)}

TRANSPORT DATA:
${JSON.stringify(context.transport, null, 2)}

PLACES DATA (Attractions):
${JSON.stringify(context.attractions, null, 2)}

RESTAURANT DATA:
${JSON.stringify(context.restaurants, null, 2)}

NIGHTLIFE DATA:
${JSON.stringify(context.nightlife, null, 2)}

ROUTE DATA:
${JSON.stringify(context.traffic, null, 2)}

LOCAL GUIDE DATA:
${JSON.stringify(context.guide, null, 2)}

SAFETY DATA:
${JSON.stringify(context.safety, null, 2)}

EVENT DATA (real events from Ticketmaster — schedule on their specific dates):
${JSON.stringify(context.events, null, 2)}

${context.existingPlan ? `EXISTING DETERMINISTIC PLAN (use as reference, do not override):\n${JSON.stringify(context.existingPlan, null, 2)}` : ''}

Generate the best feasible itinerary based on this information. Return ONLY the JSON object, no other text.`;
}

// ══════════════════════════════════════════════════════════════════════
//  GENERIC LLM CALL HELPER (works with Gemini or Groq)
// ══════════════════════════════════════════════════════════════════════

/**
 * Call any LLM service (Gemini or Groq) with a configurable timeout.
 * The service must implement generateJSON({ prompt, system, agent, action, userId }).
 */
async function callLLMWithTimeout({ service, prompt, system, agent, action, userId, timeoutMs, providerName }) {
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`${providerName} request timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  try {
    const result = await Promise.race([
      service.generateJSON({ prompt, system, agent, action, userId }),
      timeoutPromise,
    ]);
    return result;
  } catch (err) {
    console.error(`[itineraryGenerator] ${providerName} error: ${err.message}`);
    return { success: false, data: null, message: err.message || `${providerName} request failed` };
  }
}

// ══════════════════════════════════════════════════════════════════════
//  EXPORTS
// ══════════════════════════════════════════════════════════════════════

export function getRequestCount() {
  return geminiRequestCount;
}

export default { generateItinerary, getRequestCount };
