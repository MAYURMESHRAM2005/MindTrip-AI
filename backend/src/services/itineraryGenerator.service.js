import geminiService from './gemini.service.js';
import groqService from './groq.service.js';
import env from '../config/env.js';
import trustedDatasetBuilder from './trustedDatasetBuilder.service.js';
import geminiResponseValidator from './geminiResponseValidator.service.js';

/**
 * Itinerary Generator Service — ANTI-HALLUCINATION AI PLANNER MODE
 *
 * The AI acts purely as a PLANNER and SELECTOR:
 *   - Receives a TRUSTED candidate dataset from verified provider data
 *   - Selects and arranges candidates into a personalized itinerary
 *   - Returns ONLY lightweight planning decisions:
 *     { provider, providerId, type, startTime, endTime, reason }
 *   - NEVER returns prices, coordinates, ratings, opening hours, etc.
 *
 * ANTI-HALLUCINATION ARCHITECTURE:
 *   1. Build trusted dataset from normalized candidates
 *   2. Send ONLY trusted data to Gemini
 *   3. Validate Gemini response against trusted dataset
 *   4. Reject any item not in trusted dataset
 *   5. Backend resolves all factual data from trusted dataset
 *
 * Architecture:
 *   Trusted dataset → Gemini selects → Schema validation →
 *   Trusted dataset validation → Reject hallucinations →
 *   Backend resolves provider IDs → Deterministic validation
 */

const GEMINI_TIMEOUT_MS = env.GEMINI_TIMEOUT_MS || 45000;

let geminiRequestCount = 0;

// ══════════════════════════════════════════════════════════════════════
//  SANITIZATION
// ══════════════════════════════════════════════════════════════════════

function sanitizeItinerary(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.itinerary || raw.days) return raw;
  if (typeof raw === 'string') {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try { return JSON.parse(jsonMatch[0]); } catch { return null; }
    }
    return null;
  }
  return raw;
}

// ══════════════════════════════════════════════════════════════════════
//  SCHEMA VALIDATION — Lightweight planner output
// ══════════════════════════════════════════════════════════════════════

/**
 * Validate the AI planner response.
 * Expected format:
 * {
 *   "days": [
 *     {
 *       "date": "YYYY-MM-DD",
 *       "theme": "...",
 *       "items": [
 *         {
 *           "type": "attraction|restaurant|hotel|event|transport|nightlife",
 *           "provider": "google|amadeus|ticketmaster|transport-intelligence",
 *           "providerId": "exact id from candidate dataset",
 *           "startTime": "HH:MM",
 *           "endTime": "HH:MM",
 *           "reason": "why this candidate was selected"
 *         }
 *       ]
 *     }
 *   ]
 * }
 */
function validatePlannerSchema(raw) {
  const errors = [];
  if (!raw || typeof raw !== 'object') {
    return { valid: false, errors: ['Response is not an object'] };
  }

  const root = raw;

  if (!Array.isArray(root.days)) {
    return { valid: false, errors: ['days is not an array'] };
  }
  if (root.days.length === 0) {
    return { valid: false, errors: ['days is empty'] };
  }

  const VALID_TYPES = new Set(['attraction', 'restaurant', 'hotel', 'event', 'transport', 'nightlife', 'activity', 'flight', 'train', 'bus']);
  const VALID_PROVIDERS = new Set(['google', 'amadeus', 'ticketmaster', 'transport-intelligence']);

  for (let di = 0; di < root.days.length; di++) {
    const day = root.days[di];
    const dayLabel = `days[${di}]`;

    if (typeof day.date !== 'string' || !day.date.trim()) {
      errors.push(`${dayLabel}.date is missing or empty`);
    }
    if (typeof day.theme !== 'string' || !day.theme.trim()) {
      errors.push(`${dayLabel}.theme is missing or empty`);
    }
    if (!Array.isArray(day.items)) {
      errors.push(`${dayLabel}.items is not an array`);
      continue;
    }
    if (day.items.length === 0) {
      errors.push(`${dayLabel}.items is empty`);
    }

    for (let ii = 0; ii < day.items.length; ii++) {
      const item = day.items[ii];
      const itemLabel = `${dayLabel}.items[${ii}]`;

      // type is required
      if (!item.type || !VALID_TYPES.has(item.type)) {
        errors.push(`${itemLabel}.type "${item.type}" is not valid (expected one of: ${[...VALID_TYPES].join(', ')})`);
      }

      // provider is required
      if (!item.provider || !VALID_PROVIDERS.has(item.provider)) {
        errors.push(`${itemLabel}.provider "${item.provider}" is not valid (expected one of: ${[...VALID_PROVIDERS].join(', ')})`);
      }

      // providerId is required
      if (typeof item.providerId !== 'string' || !item.providerId.trim()) {
        errors.push(`${itemLabel}.providerId is missing or empty`);
      }

      // startTime is required
      if (typeof item.startTime !== 'string' || !/^\d{2}:\d{2}$/.test(item.startTime)) {
        errors.push(`${itemLabel}.startTime must be HH:MM format`);
      }

      // endTime is required
      if (typeof item.endTime !== 'string' || !/^\d{2}:\d{2}$/.test(item.endTime)) {
        errors.push(`${itemLabel}.endTime must be HH:MM format`);
      }

      // reason is required
      if (typeof item.reason !== 'string' || !item.reason.trim()) {
        errors.push(`${itemLabel}.reason is missing or empty`);
      }

      // Validate startTime < endTime
      if (item.startTime && item.endTime && item.startTime >= item.endTime) {
        errors.push(`${itemLabel}.startTime (${item.startTime}) must be before endTime (${item.endTime})`);
      }

      // No factual fields should be present
      const FORBIDDEN_FIELDS = ['price', 'cost', 'coordinates', 'rating', 'openingHours', 'availability', 'bookingUrl', 'imageUrl', 'duration', 'address'];
      for (const field of FORBIDDEN_FIELDS) {
        if (item[field] !== undefined) {
          errors.push(`${itemLabel}.${field} should not be present — backend resolves this from the candidate dataset`);
        }
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, data: root, errors: [] };
}

// ══════════════════════════════════════════════════════════════════════
//  CONTEXT BUILDERS
// ══════════════════════════════════════════════════════════════════════

/**
 * Build the context for the AI planner using the trusted dataset.
 * The trusted dataset contains ONLY verified provider data.
 * Gemini can ONLY select from this dataset.
 */
function buildPlannerContext(data) {
  const {
    userPreferences = {},
    destination,
    origin,
    startDate,
    endDate,
    travelers = {},
    totalBudget,
    currency = 'INR',
    daysCount = 1,
    nightsCount = 0,
    attractions = [],
    restaurants = [],
    nightlife = [],
    weather = {},
    accommodation = {},
    transport = {},
    events = null,
    guide = {},
    safety = {},
    budgetAllocation = {},
    // Anti-hallucination: pre-built trusted candidates from orchestrator
    normalizedCandidates = [],
    geoClusters = null,
    dayAwareContext = null,
    replanErrors = undefined,
    previousPlan = undefined,
  } = data;

  // ═══ ANTI-HALLUCINATION: Build trusted dataset from normalized candidates ═══
  // If normalizedCandidates are provided, use them to build the trusted dataset.
  // Otherwise, fall back to building from raw provider data (legacy path).
  let trustedDataset;
  let candidates;
  let trustedLookup;

  if (normalizedCandidates.length > 0) {
    // Primary path: build trusted dataset from pre-normalized candidates
    trustedDataset = trustedDatasetBuilder.buildTrustedDataset({
      candidates: normalizedCandidates,
      weather,
      guide,
      safety,
      geoClusters,
      dayAwareContext,
    });
    candidates = trustedDataset.candidates;
    trustedLookup = trustedDatasetBuilder.buildTrustedLookup(trustedDataset);
  } else {
    // Legacy path: build candidates from raw provider data
    candidates = buildLegacyCandidates({ attractions, restaurants, nightlife, accommodation, transport, events });
    trustedDataset = { candidates, weather: { available: false, forecast: [] }, guide: {}, safety: {}, _meta: { totalCandidates: candidates.length } };
    trustedLookup = new Map();
    for (const c of candidates) {
      const key = `${c.provider}|${c.providerId}`;
      if (key !== '|') trustedLookup.set(key, c);
      if (c.name) trustedLookup.set(`name|${c.name.toLowerCase()}`, c);
    }
  }

  // Weather summary
  const weatherSummary = {
    available: weather?.data?.provider === 'live',
    forecast: (weather?.data?.forecast || []).slice(0, daysCount).map(f => ({
      date: f.date,
      condition: f.condition || '',
      rainProbability: f.rainProbability ?? null,
      tempMin: f.tempMin ?? null,
      tempMax: f.tempMax ?? null,
    })),
  };

  // Replanning context — enriched errors with alternatives
  let replanSection = '';
  if (replanErrors && replanErrors.length > 0) {
    const formattedErrors = replanErrors.map(err => {
      const errObj = typeof err === 'string' ? { type: 'UNKNOWN', message: err } : err;
      const parts = [`  Type: ${errObj.type || 'UNKNOWN'}`];
      if (errObj.day != null) parts.push(`  Day: ${errObj.day}`);
      if (errObj.providerId) parts.push(`  Provider: ${errObj.provider || 'unknown'} / ID: ${errObj.providerId}`);
      parts.push(`  Error: ${errObj.message || 'Unknown error'}`);
      if (errObj.availableAlternatives && errObj.availableAlternatives.length > 0) {
        parts.push(`  Available alternatives (${errObj.availableAlternatives.length}):`);
        for (const alt of errObj.availableAlternatives.slice(0, 5)) {
          parts.push(`    - provider: ${alt.provider}, providerId: ${alt.providerId}, name: ${alt.name}, rating: ${alt.rating ?? 'N/A'}, price: ${alt.price ?? 'N/A'}, suburb: ${alt.suburb || 'N/A'}`);
        }
      }
      return parts.join('\n');
    });

    replanSection = `\n═══ PREVIOUS PLAN FAILED VALIDATION — FIX THESE ERRORS ═══\nEach error below includes AVAILABLE ALTERNATIVES you can choose from.\nReplace the invalid item with one of the listed alternatives.\n\n${formattedErrors.join('\n\n')}\n\nRULES FOR FIXING:\n- Replace any item in DUPLICATE errors with a DIFFERENT candidate from its availableAlternatives or the CANDIDATES list\n- Replace any item in PROVIDER_ID_NOT_FOUND with a VALID candidate from its availableAlternatives or the CANDIDATES list\n- Fix OPENING_HOURS errors by choosing a different time or using an alternative candidate\n- Fix BUDGET errors by selecting cheaper candidates from the availableAlternatives\n- Fix OVERLAP errors by adjusting start/end times or choosing alternatives\n- Fix MEAL_TIMING errors by selecting restaurants with appropriate meal slots\n- Never re-use candidates that caused errors\n- Each replacement MUST use the candidate's exact provider and providerId from the list\n`;
  }

  let previousPlanSection = '';
  if (previousPlan?.days) {
    previousPlanSection = `\n═══ PREVIOUS PLAN (reference — do NOT repeat its errors) ═══\n${JSON.stringify(previousPlan.days.map(d => ({
      date: d.date,
      theme: d.theme,
      items: (d.items || []).map(i => ({
        type: i.type, provider: i.provider, providerId: i.providerId,
        startTime: i.startTime, endTime: i.endTime,
      })),
    })), null, 2)}\n`;
  }

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
      allocation: {
        transport: budgetAllocation.transport?.amount || 0,
        hotels: budgetAllocation.hotels?.amount || 0,
        food: budgetAllocation.food?.amount || 0,
        activities: budgetAllocation.activities?.amount || 0,
      },
    },
    candidates,
    weather: weatherSummary,
    guide: {
      localTips: (guide.localTips || []).slice(0, 6),
      etiquette: (guide.etiquette || []).slice(0, 4),
    },
    safety: {
      safetyTips: (safety.safetyTips || []).slice(0, 4),
    },
    _replanSection: replanSection,
    _previousPlanSection: previousPlanSection,
  };
}

// ══════════════════════════════════════════════════════════════════════
//  MAIN GENERATION FUNCTION
// ══════════════════════════════════════════════════════════════════════

/**
 * Validate and prepare the AI planner response.
 */
function validateAndPrepare(raw, context) {
  const sanitized = sanitizeItinerary(raw);
  if (!sanitized) {
    return { valid: false, itinerary: null, errors: ['Response could not be sanitized'] };
  }

  // Use the full anti-hallucination validation pipeline
  if (context.trustedLookup) {
    const result = geminiResponseValidator.validateGeminiResponse(sanitized, context.trustedLookup);
    return {
      valid: result.valid,
      itinerary: result.data,
      errors: result.errors,
      warnings: result.warnings,
      summary: result.summary,
    };
  }

  // Fallback: basic schema validation only
  const validation = validatePlannerSchema(sanitized);
  if (!validation.valid) {
    return { valid: false, itinerary: null, errors: validation.errors };
  }
  return { valid: true, itinerary: validation.data, errors: [] };
}

/**
 * Generate a personalized itinerary plan from complete travel context.
 * The AI returns ONLY planning decisions (provider references + time slots).
 * The backend resolves all factual data from the candidate dataset.
 *
 * Tries Gemini FIRST. Falls back to Groq on failure.
 *
 * @param {object} data - Complete aggregated travel context
 * @returns {{ success, itinerary, provider, fallbackUsed, error, geminiRequestCount, latencyMs, validationErrors }}
 */
export async function generateItinerary(data) {
  const started = Date.now();
  const requestNumber = ++geminiRequestCount;
  const userId = data.userId || null;

  console.log(`[itineraryGenerator] Request #${requestNumber} starting at ${new Date().toISOString()}`);

  // 1. Build planner context (flat candidate list + constraints)
  const context = buildPlannerContext(data);

  // 2. Build prompts
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(context);

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
    const checked = validateAndPrepare(geminiResult.data, context);
    if (checked.valid) {
      const totalLatencyMs = Date.now() - started;
      console.log(`[AI] Gemini success (${geminiLatencyMs}ms) — ${checked.summary?.validated || 0} items validated, ${checked.summary?.rejected || 0} rejected`);
      return {
        success: true,
        itinerary: checked.itinerary,
        provider: 'gemini',
        fallbackUsed: false,
        error: null,
        geminiRequestCount: requestNumber,
        latencyMs: totalLatencyMs,
        validationErrors: [],
        validationWarnings: checked.warnings || [],
        validationSummary: checked.summary || null,
        trustedLookup: context.trustedLookup || null,
      };
    }
    geminiFailed = true;
    geminiError = `Gemini validation failed: ${checked.errors[0]}`;
    console.warn(`[AI] Gemini failed: ${geminiError}`);
  } else {
    geminiFailed = true;
    geminiError = geminiResult.message || 'Gemini request failed';
    console.warn(`[AI] Gemini failed: ${geminiError}`);
  }

  // ══════════════════════════════════════════════════════════════════
  //  STEP 2: Fallback to Groq
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
    const checked = validateAndPrepare(groqResult.data, context);
    if (checked.valid) {
      const totalLatencyMs = Date.now() - started;
      console.log(`[AI] Groq success (${groqLatencyMs}ms) — ${checked.summary?.validated || 0} items validated`);
      return {
        success: true,
        itinerary: checked.itinerary,
        provider: 'groq',
        fallbackUsed: true,
        error: null,
        geminiRequestCount: requestNumber,
        latencyMs: totalLatencyMs,
        validationErrors: [],
        validationWarnings: checked.warnings || [],
        validationSummary: checked.summary || null,
        trustedLookup: context.trustedLookup || null,
      };
    }
    const totalLatencyMs = Date.now() - started;
    console.warn(`[AI] Groq returned invalid plan: ${checked.errors[0]}`);
    return {
      success: false,
      itinerary: null,
      provider: 'groq',
      fallbackUsed: true,
      error: `Both Gemini and Groq failed. Groq: ${checked.errors[0]}. Gemini: ${geminiError}`,
      geminiRequestCount: requestNumber,
      latencyMs: totalLatencyMs,
      validationErrors: checked.errors,
    };
  }

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
//  LEGACY CANDIDATE BUILDER (fallback when normalized candidates not provided)
// ══════════════════════════════════════════════════════════════════════

function buildLegacyCandidates({ attractions, restaurants, nightlife, accommodation, transport, events }) {
  const candidates = [];

  for (const a of (attractions || []).slice(0, 15)) {
    candidates.push({
      id: `google|${a.placeId || a.name}`,
      provider: 'google',
      providerId: a.placeId || a.name,
      type: 'attraction',
      name: a.name || '',
      tags: (a.types || []).join(', '),
      rating: a.rating ?? null,
      priceLevel: a.priceLevel ?? null,
      address: a.address || '',
      suburb: a.suburb || a.district || '',
      latitude: a.coordinates?.lat ?? null,
      longitude: a.coordinates?.lng ?? null,
      hasOpeningHours: Boolean(a.openingHours?.periods?.length),
      dataStatus: a.dataStatus || 'estimate',
      source: 'google',
      isEstimate: Boolean(a.isEstimate),
    });
  }

  for (const r of (restaurants || []).slice(0, 12)) {
    candidates.push({
      id: `restaurant|${r.placeId || r.name}`,
      provider: r.provider || r.source || 'google',
      providerId: r.placeId || r.name,
      type: 'restaurant',
      name: r.name || '',
      tags: (r.cuisines || r.types || []).join(', '),
      rating: r.rating ?? null,
      priceLevel: r.priceLevel ?? null,
      address: r.address || '',
      suburb: r.suburb || '',
      latitude: r.coordinates?.lat ?? null,
      longitude: r.coordinates?.lng ?? null,
      hasOpeningHours: Boolean(r.openingHours?.periods?.length),
      averageCostPerPerson: r.averageCostPerPerson || r.zomatoData?.averageCostPerPerson || null,
      dataStatus: r.dataStatus || 'estimate',
      source: r.source || 'google',
      isEstimate: Boolean(r.isEstimate),
    });
  }

  for (const n of (nightlife || []).slice(0, 8)) {
    candidates.push({
      id: `nightlife|${n.placeId || n.name}`,
      provider: 'google',
      providerId: n.placeId || n.name,
      type: 'nightlife',
      name: n.name || '',
      tags: (n.types || []).join(', '),
      address: n.address || '',
      latitude: n.coordinates?.lat ?? null,
      longitude: n.coordinates?.lng ?? null,
      dataStatus: 'estimate',
      source: 'google',
      isEstimate: true,
    });
  }

  const hotelRec = accommodation?.data?.recommended;
  if (hotelRec?.name && hotelRec?.price?.amount > 0) {
    candidates.push({
      id: `hotel|${hotelRec.name}`,
      provider: 'amadeus',
      providerId: hotelRec.name || 'recommended-hotel',
      type: 'hotel',
      name: hotelRec.name || '',
      tags: hotelRec.amenities?.join(', ') || '',
      rating: hotelRec.rating ?? null,
      pricePerNight: hotelRec.price?.amount ?? null,
      address: hotelRec.address || '',
      dataStatus: accommodation?.data?.isLive ? 'live' : 'unavailable',
      source: 'amadeus',
      isEstimate: Boolean(!accommodation?.data?.isLive),
    });
  }
  for (const h of (accommodation?.data?.hotels || []).slice(0, 5)) {
    if (h.name === hotelRec?.name || !h.name || !h.price?.amount) continue;
    candidates.push({
      id: `hotel|${h.name}`,
      provider: 'amadeus',
      providerId: h.name,
      type: 'hotel',
      name: h.name || '',
      tags: h.amenities?.join(', ') || '',
      rating: h.rating ?? null,
      pricePerNight: h.price?.amount ?? null,
      address: h.address || '',
      dataStatus: 'unavailable',
      source: 'amadeus',
      isEstimate: true,
    });
  }

  const transportSel = transport?.data?.selected;
  if (transportSel) {
    candidates.push({
      id: `transport|${transportSel.flightNumber || transportSel.trainNumber || transportSel.operator || 'selected'}`,
      provider: 'transport-intelligence',
      providerId: transportSel.flightNumber || transportSel.trainNumber || transportSel.operator || 'selected',
      type: transport.mode || 'transport',
      name: `${transportSel.airline || ''} ${transportSel.flightNumber || ''} ${transportSel.trainName || ''} ${transportSel.operator || ''}`.trim(),
      departure: transportSel.departAt || transportSel.departure || '',
      arrival: transportSel.arriveAt || transportSel.arrival || '',
      duration: transportSel.duration || '',
      price: transportSel.price?.amount ?? null,
      dataStatus: transport?.data?.isLive ? 'live' : 'unavailable',
      source: 'transport-intelligence',
      isEstimate: Boolean(!transport?.data?.isLive),
    });
  }
  for (const offer of (transport?.data?.offers || []).slice(0, 4)) {
    candidates.push({
      id: `transport|${offer.flightNumber || offer.trainNumber || offer.operator || `alt-${candidates.length}`}`,
      provider: 'transport-intelligence',
      providerId: offer.flightNumber || offer.trainNumber || offer.operator || `alt-${candidates.length}`,
      type: offer.mode || transport?.mode || 'transport',
      name: `${offer.airline || ''} ${offer.trainName || ''} ${offer.operator || ''}`.trim(),
      departure: offer.departAt || offer.departure || '',
      arrival: offer.arriveAt || offer.arrival || '',
      duration: offer.duration || '',
      price: offer.price?.amount ?? null,
      dataStatus: offer.isLive ? 'live' : 'estimate',
      source: 'transport-intelligence',
      isEstimate: Boolean(!offer.isLive),
    });
  }

  for (const e of (events?.events || events?.data?.events || []).slice(0, 10)) {
    candidates.push({
      id: `event|${e.id || e.name}`,
      provider: 'ticketmaster',
      providerId: e.id || e.name,
      type: 'event',
      name: e.name || '',
      tags: `${e.category || ''} ${e.genre || ''}`.trim(),
      eventDate: e.date || '',
      eventTime: e.time || '',
      venue: e.venueName || '',
      isFree: e.isFree || false,
      dataStatus: e.isAvailable !== false ? 'live' : 'unavailable',
      source: 'ticketmaster',
      isEstimate: Boolean(e.priceRange?.isEstimate),
    });
  }

  return candidates;
}

// ══════════════════════════════════════════════════════════════════════
//  PROMPTS — AI as PLANNER, not data generator
// ══════════════════════════════════════════════════════════════════════

/**
 * System prompt — positions AI as a planner that selects and arranges candidates.
 * The AI MUST NOT return any factual data (prices, coordinates, ratings, etc.)
 */
function buildSystemPrompt() {
  return `You are TravelMind AI's Itinerary Planner.

Your job is to SELECT and ARRANGE pre-verified travel candidates into a personalized multi-day itinerary.

You are a PLANNER, not a data generator. You do NOT create, invent, or fabricate any factual information.

═══ ANTI-HALLUCINATION ARCHITECTURE ═══

You receive a TRUSTED DATASET of verified candidates from real travel providers.
Every candidate has a unique "candidateId" (e.g., "google-goi-123").
You MUST return ONLY candidate IDs. The backend hydrates the full data.

If a candidate is NOT in the TRUSTED DATASET, it CANNOT appear in your output.
Your response will be validated against the trusted dataset. Any unknown candidateId will be REJECTED.

═══ CRITICAL RULES ═══

1. You receive a CANDIDATES list. Each candidate has a "candidateId". You MUST select ONLY from this list.

2. Every item you include MUST contain:
   - "candidateId": the candidateId EXACTLY as shown in the candidate's "candidateId" field
   - "type": the candidate's type (attraction, restaurant, hotel, event, transport, nightlife)
   - "time": the planned time in HH:MM format
   - "reason": why this candidate was selected

3. NEVER return any of the following as factual entities:
   - Place names, restaurant names, hotel names
   - Prices, costs, or monetary values
   - Ratings or reviews
   - Coordinates or addresses
   - Opening hours or availability
   - Provider names or provider IDs (use candidateId instead)
   - Any factual data whatsoever

4. If the CANDIDATES list lacks something needed for a time slot, omit that time slot — do NOT invent a placeholder.

5. DO NOT include any factual fields in your output.
The backend hydrates ALL factual data from the trusted dataset after you select candidate IDs.

═══ WHAT YOU OPTIMIZE ═══

You should consider ALL of the following when making selections:

- User interests and travel style
- Budget constraints (from BUDGET section)
- Variety — don't repeat the same type of activity every day
- Geographic proximity — keep nearby candidates on the same day
- Opening hours — only schedule attractions during likely open hours
- Activity duration — fit activities within time slots realistically
- Travel time between candidates (use suburb/address proximity as a guide)
- Weather — if rain is likely, prefer indoor attractions (museums, galleries, shopping)
- Event dates — only schedule events on their actual eventDate
- Meal timing — breakfast (07:00-10:00), lunch (12:00-14:00), dinner (18:00-21:00)
- Hotel location — prefer candidates near the hotel for each day
- No duplicate attractions across days (use candidateId to track)

═══ STRUCTURAL RULES ═══

- Each day MUST have: breakfast (restaurant), morning activity, lunch (restaurant), afternoon activity, evening activity, dinner (restaurant)
- Arrival day: outbound transport → hotel check-in → sightseeing
- Departure day: hotel check-out → return transport (no sightseeing)
- No overlapping time slots within a day
- Every attraction/activity must appear on ONLY ONE day (no repeats)
- Hotels CAN repeat across nights (same hotel for multi-night stay)
- Restaurants should be diverse when enough options exist
- Never schedule attractions after 20:00 (most close by then)

═══ OUTPUT FORMAT ═══

Return ONLY a JSON object with this exact structure:

{
  "days": [
    {
      "dayNumber": 1,
      "date": "YYYY-MM-DD",
      "areaId": "area-1",
      "theme": "Brief theme for the day (e.g. 'South Mumbai Heritage')",
      "items": [
        {
          "candidateId": "EXACT candidateId from CANDIDATES list",
          "type": "attraction|restaurant|hotel|event|transport|nightlife",
          "time": "HH:MM",
          "reason": "Brief reason for this selection"
        }
      ]
    }
  ]
}

Rules for the output:
- "candidateId" must match EXACTLY from the CANDIDATES list
- "type" must match the candidate's type
- "time" must be in HH:MM format
- "reason" explains WHY this candidate was selected
- Do NOT include any fields other than the ones listed above
- Do NOT include names, prices, coordinates, ratings, addresses, or any factual data
- The backend hydrates all factual data from the trusted dataset`;
}

/**
 * Build the user prompt with candidate list and constraints.
 */
function buildUserPrompt(context) {
  return `You are TravelMind AI's Itinerary Planner. Plan a ${context.trip.daysCount}-day trip to ${context.trip.destination}.

═══ TRIP DETAILS ═══
${JSON.stringify(context.trip, null, 2)}

═══ BUDGET ═══
${JSON.stringify(context.budget, null, 2)}

═══ CANDIDATES (select ONLY from this list) ═══
Every item you include must reference a candidate by its "candidateId" field — the EXACT candidateId string shown on the candidate (e.g. "google-chij-abc"). Do NOT use provider/providerId — responses without a valid candidateId are rejected.
${JSON.stringify(context.candidates, null, 2)}

═══ WEATHER ═══
${JSON.stringify(context.weather, null, 2)}

═══ LOCAL GUIDE ═══
${JSON.stringify(context.guide, null, 2)}

═══ SAFETY ═══
${JSON.stringify(context.safety, null, 2)}
${context._replanSection || ''}
${context._previousPlanSection || ''}

Plan the best itinerary by selecting and arranging candidates from the CANDIDATES list.
Return ONLY the JSON object — no prose, no explanations outside the JSON.`;
}

// ══════════════════════════════════════════════════════════════════════
//  GENERIC LLM CALL HELPER
// ══════════════════════════════════════════════════════════════════════

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
