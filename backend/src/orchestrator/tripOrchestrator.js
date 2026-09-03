import env from '../config/env.js';
import logger from '../utils/logger.js';
import Trip from '../models/Trip.js';
import Itinerary from '../models/Itinerary.js';
import orchestratorAgent from '../agents/orchestrator.agent.js';
import userPreferenceAgent from '../agents/userPreference.agent.js';
import destinationAgent from '../agents/destination.agent.js';
import budgetAgent from '../agents/budget.agent.js';
import flightAgent from '../agents/flight.agent.js';
import trainAgent from '../agents/train.agent.js';
import busAgent from '../agents/bus.agent.js';
import hotelAgent from '../agents/hotel.agent.js';
import restaurantAgent from '../agents/restaurant.agent.js';
import attractionAgent from '../agents/attraction.agent.js';
import weatherAgent from '../agents/weather.agent.js';
import trafficAgent from '../agents/traffic.agent.js';
import localGuideAgent from '../agents/localGuide.agent.js';
import safetyAgent from '../agents/safety.agent.js';
import culturalEventsAgent from '../agents/culturalEvents.agent.js';
import finalValidatorAgent from '../agents/finalValidator.agent.js';
import budgetService from '../services/budget.service.js';
import budgetEngine from '../services/budgetEngine.service.js';
import itineraryService, { setRouteCache } from '../services/itinerary.service.js';
import { generateItinerary, getRequestCount } from '../services/itineraryGenerator.service.js';
import { runAIPlanningPipeline } from './orchestratorAIPlanning.js';
import placesProvider from '../providers/places.provider.js';
import mapsProvider from '../providers/maps.provider.js';
import transportIntel from '../services/transportIntelligence.service.js';
import { notifyTripPlanned, notifyBudgetOptimized } from '../services/notification.service.js';

function fmtDate(d) {
  const date = new Date(d);
  return date.toISOString().slice(0, 10);
}

function inferTransportMode({ origin, destination, transportPreference }) {
  if (transportPreference) return transportPreference;
  return 'flight';
}

/**
 * Pre-fetch real driving routes between all activity coordinate pairs.
 * Returns a Map of "lat1,lng1|lat2,lng2" → { distanceKm, durationMin, method }.
 * This allows the day builder to use real routes instead of haversine estimates.
 * All route requests run in parallel for performance.
 */
async function prefetchActivityRoutes({ attractions, restaurants, hotelResult, destination }) {
  const routeCache = new Map();
  if (!env.GEOAPIFY_API_KEY) return routeCache;

  // Collect all unique coordinate pairs that will need routes
  const coords = [];

  // Hotel coordinates
  const hotel = hotelResult?.data?.recommended;
  if (hotel?.latitude != null && hotel?.longitude != null) {
    coords.push({ lat: Number(hotel.latitude), lng: Number(hotel.longitude), label: 'hotel' });
  }

  // Attraction coordinates
  for (const a of attractions || []) {
    if (a.coordinates?.lat != null && a.coordinates?.lng != null) {
      coords.push({ ...a.coordinates, label: 'attraction', name: a.name });
    }
  }

  // Restaurant coordinates
  for (const r of restaurants || []) {
    if (r.coordinates?.lat != null && r.coordinates?.lng != null) {
      coords.push({ ...r.coordinates, label: 'restaurant', name: r.name });
    }
  }

  if (coords.length < 2) return routeCache;

  // Build unique pairs (hotel↔each place, and adjacent places)
  const pairs = [];
  const hotelCoord = coords.find((c) => c.label === 'hotel');
  const placeCoords = coords.filter((c) => c.label !== 'hotel');

  // Hotel ↔ each place
  if (hotelCoord) {
    for (const place of placeCoords) {
      pairs.push([hotelCoord, place]);
    }
  }

  // Adjacent places (for consecutive activities)
  for (let i = 0; i < placeCoords.length - 1; i++) {
    pairs.push([placeCoords[i], placeCoords[i + 1]]);
  }

  // Deduplicate pairs
  const seen = new Set();
  const uniquePairs = [];
  for (const [a, b] of pairs) {
    const key = `${a.lat},${a.lng}|${b.lat},${b.lng}`;
    const revKey = `${b.lat},${b.lng}|${a.lat},${a.lng}`;
    if (!seen.has(key) && !seen.has(revKey)) {
      seen.add(key);
      uniquePairs.push([a, b]);
    }
  }

  // Fetch routes in parallel (batches of 10 to avoid rate limits)
  const BATCH_SIZE = 10;
  for (let i = 0; i < uniquePairs.length; i += BATCH_SIZE) {
    const batch = uniquePairs.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(([a, b]) =>
        mapsProvider.directions(`${a.lat},${a.lng}`, `${b.lat},${b.lng}`, 'driving', false)
          .then((result) => ({ a, b, result }))
      )
    );

    for (const settled of results) {
      if (settled.status !== 'fulfilled') continue;
      const { a, b, result } = settled.value;
      if (result?.isLive && result.data?.routes?.length) {
        const route = result.data.routes[0];
        const km = route.distanceKm || 0;
        const min = route.durationMin || 0;
        // Determine method based on distance
        const method = km < 1.5 ? 'walking' : km < 12 ? 'taxi/auto' : 'bus/metro';
        const forwardKey = `${a.lat},${a.lng}|${b.lat},${b.lng}`;
        const reverseKey = `${b.lat},${b.lng}|${a.lat},${a.lng}`;
        const entry = { distanceKm: km, durationMin: min, method, source: 'geoapify-routes' };
        routeCache.set(forwardKey, entry);
        routeCache.set(reverseKey, entry);
      }
    }
  }

  logger.info(`[ORCHESTRATOR] Pre-fetched ${routeCache.size / 2} real routes for intra-day travel`);
  return routeCache;
}

/**
 * Build an ordered list of transport modes to try for a given route.
 * The preferred mode is tried first, then alternatives cascade through
 * train → bus → flight (or similar). This ensures we never fabricate
 * a transport option that doesn't actually exist.
 */
export function buildTransportFallbackOrder(preferredMode, userPreference) {
  const allModes = ['flight', 'train', 'bus'];
  const primary = preferredMode || userPreference || 'flight';
  // Ensure primary is valid
  const ordered = [primary];
  for (const m of allModes) {
    if (!ordered.includes(m)) ordered.push(m);
  }
  return ordered;
}

/**
 * Full Multi-Agent trip generation pipeline.
 *
 * Architecture (post-refactor):
 *  1. Deterministic agents run instantly (no Gemini)
 *  2. External providers run in parallel via Promise.all
 *  3. ONE Gemini call generates the final itinerary from collected data
 *  4. Deterministic day-by-day plan is built from real data
 *  5. Results are persisted to MongoDB
 *
 * Agents do NOT call Gemini independently. Only the itineraryGenerator
 * service makes ONE Gemini API request with complete travel context.
 */
export async function generateTrip({ user, request }) {
  const userId = user._id.toString();
  const report = [];
  const started = Date.now();
  const currency = request.currency || user.preferredCurrency || 'INR';
  const totalBudget = request.totalBudget;
  logger.entry('[ORCHESTRATOR]', 'generateTrip', { userId, destination: request.destination, origin: request.origin, startDate: request.startDate, endDate: request.endDate, totalBudget, currency, travelStyle: request.travelStyle });

  // ══════════════════════════════════════════════════════════════════════
  // BATCH 1: Deterministic agents (no API calls, no Gemini) — instant
  // ══════════════════════════════════════════════════════════════════════
  logger.info('[ORCHESTRATOR] ═══ BATCH 1: Deterministic agents ═══');
  const orchestration = await orchestratorAgent.run({ request });
  report.push(orchestratorAgent.report(orchestration));
  const daysCount = orchestration.data?.summary?.days || 1;

  const prefsResult = await userPreferenceAgent.run({ user, request });
  report.push(userPreferenceAgent.report(prefsResult));
  const prefs = prefsResult.data;

  let destination = request.destination;
  let destinationResult = null;
  if (request.suggestDestination || !destination) {
    destinationResult = await destinationAgent.suggest({ prefs, request });
    destination = destinationResult.data?.destination || 'Suggested destination';
  }
  report.push(destinationAgent.report(destinationResult || { status: 'success', message: `Destination provided: ${destination}` }));

  const allocation = budgetService.allocationForStyle(prefs.travelStyle || 'standard', totalBudget);
  logger.info(`[ORCHESTRATOR] Budget allocation for style '${prefs.travelStyle || 'standard'}': ${JSON.stringify(Object.keys(allocation))}`);
  const rooms = budgetService.roomsForParty({ adults: request.adults, children: request.children });
  logger.info(`[ORCHESTRATOR] Rooms needed: ${rooms}, Days: ${daysCount}, Destination: ${destination}`);

  // ══════════════════════════════════════════════════════════════════════
  // BATCH 2: All external provider API calls in PARALLEL via Promise.all
  // This is the main performance improvement — all providers run concurrently.
  // ══════════════════════════════════════════════════════════════════════
  const runWithTimeout = (fn, name) =>
    Promise.race([
      fn().catch((err) => {
        console.warn(`[${name}] Error: ${err.message}`);
        return null;
      }),
      new Promise((resolve) => setTimeout(() => {
        console.warn(`[${name}] Timed out`);
        resolve(null);
      }, 20000)),
    ]);

  logger.info('[ORCHESTRATOR] ═══ BATCH 2: All external provider API calls in PARALLEL ═══');
  const [
    weatherResult,
    hotelResult,
    attractionResult,
    restaurantResult,
    guideResult,
    safetyResult,
    eventsResult,
  ] = await Promise.all([
    runWithTimeout(
      () => weatherAgent.run({ destination, startDate: fmtDate(request.startDate), endDate: fmtDate(request.endDate), userId }),
      'weather'
    ),
    runWithTimeout(
      () => hotelAgent.run({
        destination,
        checkIn: fmtDate(request.startDate),
        checkOut: fmtDate(request.endDate),
        adults: request.adults,
        rooms,
        maxPrice: allocation.hotels?.amount,
        totalBudget,
        hotelPreference: prefs.hotelPreference,
        userId,
      }),
      'hotel'
    ),
    runWithTimeout(
      () => attractionAgent.run({ destination, interests: prefs.interests, activityLevel: prefs.activityLevel, userId }),
      'attraction'
    ),
    runWithTimeout(
      () => restaurantAgent.run({ destination, foodPreference: prefs.foodPreference, userId }),
      'restaurant'
    ),
    runWithTimeout(
      () => localGuideAgent.run({ destination, travelStyle: prefs.travelStyle, userId }),
      'localGuide'
    ),
    runWithTimeout(
      () => safetyAgent.run({ destination, userId }),
      'safety'
    ),
    runWithTimeout(
      () => culturalEventsAgent.run({
        destination,
        startDate: fmtDate(request.startDate),
        endDate: fmtDate(request.endDate),
        interests: prefs.interests || [],
        userId,
      }),
      'culturalEvents'
    ),
  ]);

  // Traffic agent runs after hotelResult is available (needs hotel name)
  const trafficResult = await runWithTimeout(
    () => trafficAgent.run({ destination, hotelName: hotelResult?.data?.recommended?.name || '', userId }),
    'traffic'
  );

  // Record agent reports (skip nulls from timeouts/errors)
  if (weatherResult) { report.push(weatherAgent.report(weatherResult)); logger.agent('weather', 'run', { status: weatherResult.status, isLive: weatherResult.data?.provider === 'live' }); }
  if (hotelResult) { report.push(hotelAgent.report(hotelResult)); logger.agent('hotel', 'run', { status: hotelResult.status, isLive: hotelResult.data?.isLive, hotelCount: hotelResult.data?.hotels?.length }); }
  if (attractionResult) { report.push(attractionAgent.report(attractionResult)); logger.agent('attraction', 'run', { status: attractionResult.status, count: attractionResult.data?.attractions?.length }); }
  if (restaurantResult) { report.push(restaurantAgent.report(restaurantResult)); logger.agent('restaurant', 'run', { status: restaurantResult.status, count: restaurantResult.data?.restaurants?.length }); }
  if (trafficResult) { report.push(trafficAgent.report(trafficResult)); logger.agent('traffic', 'run', { status: trafficResult.status, isLive: trafficResult.data?.isLive }); }
  if (guideResult) { report.push(localGuideAgent.report(guideResult)); logger.agent('localGuide', 'run', { status: guideResult.status }); }
  if (safetyResult) { report.push(safetyAgent.report(safetyResult)); logger.agent('safety', 'run', { status: safetyResult.status }); }
  if (eventsResult) { report.push(culturalEventsAgent.report(eventsResult)); logger.agent('culturalEvents', 'run', { status: eventsResult.status, eventCount: eventsResult.data?.totalEvents || 0, daysWithEvents: eventsResult.data?.daysWithEvents || 0 }); }
  logger.info('[ORCHESTRATOR] Batch 2 results: weather=' + (weatherResult?.status || 'null') + ', hotel=' + (hotelResult?.status || 'null') + ', attractions=' + (attractionResult?.data?.attractions?.length || 0) + ', restaurants=' + (restaurantResult?.data?.restaurants?.length || 0) + ', events=' + (eventsResult?.data?.totalEvents || 0));

  logger.info('[ORCHESTRATOR] ═══ BATCH 2b: Nightlife (geocoding + nearby search) ═══');
  // ══════════════════════════════════════════════════════════════════════
  // BATCH 2b: Nightlife (depends on geocoding, run after main providers)
  // ══════════════════════════════════════════════════════════════════════
  let nightlifeData = [];
  try {
    const geo = await mapsProvider.geocode(destination);
    if (geo.isLive && geo.data?.lat != null) {
      const nl = await placesProvider.nearbySearch({
        lat: geo.data.lat,
        lng: geo.data.lng,
        type: 'nightlife',
        radius: 20000,
        limit: 10,
      });
      if (nl.isLive) nightlifeData = nl.data || [];
    }
  } catch {
    nightlifeData = [];
  }
  logger.agent('nightlife', 'search', { status: nightlifeData.length ? 'success' : 'degraded', count: nightlifeData.length });
  report.push({
    agent: 'nightlife',
    status: nightlifeData.length ? 'success' : 'degraded',
    message: nightlifeData.length ? `${nightlifeData.length} real nightlife places found` : 'Nightlife data unavailable - local attractions used instead',
    usedAI: false,
  });

  logger.info('[ORCHESTRATOR] ═══ BATCH 3: Transport Intelligence Engine ═══');
  const transportMode = inferTransportMode({ origin: request.origin, destination, transportPreference: prefs.transportPreference });
  logger.info(`[ORCHESTRATOR] Transport mode: ${transportMode}, origin: ${request.origin || 'none'}`);
  const transportResult = { mode: transportMode, data: { isLive: false, selected: null } };

  // ── Transport Intelligence Engine ────────────────────────────────────
  // Uses the Transport Intelligence service to:
  //  1. Geocode origin + destination
  //  2. Find nearby airports, railway stations, bus terminals
  //  3. Check real availability for each mode (parallel)
  //  4. Build multi-modal journeys (ground transfer + main transport)
  //  5. Rank all options by preference, time, cost, convenience
  // ─────────────────────────────────────────────────────────────────────
  let transportIntelResult = null;
  if (request.origin) {
    try {
      transportIntelResult = await transportIntel.findTransportOptions({
        origin: request.origin,
        destination,
        departDate: fmtDate(request.startDate),
        returnDate: fmtDate(request.endDate),
        adults: request.adults,
        children: request.children,
        preference: prefs.transportPreference || transportMode,
        budget: allocation.transport?.amount || 0,
        currency,
      });
      logger.info(`[ORCHESTRATOR] Transport Intelligence: ${transportIntelResult.options?.length || 0} options found, recommended: ${transportIntelResult.recommended?.name || 'none'}`);

      // Use the recommended option for the main transport result
      if (transportIntelResult.recommended) {
        const rec = transportIntelResult.recommended;
        transportResult.mode = rec.mode || transportMode;
        transportResult.data = {
          isLive: rec.isLive === true,
          selected: {
            // Normalize to the shape the rest of the system expects
            airline: rec.mainTransport?.airline || '',
            flightNumber: rec.mainTransport?.flightNumber || '',
            trainName: rec.mainTransport?.trainName || '',
            trainNumber: rec.mainTransport?.trainNumber || '',
            operator: rec.mainTransport?.operator || '',
            departAt: rec.mainTransport?.departure || '',
            arriveAt: rec.mainTransport?.arrival || '',
            departure: rec.mainTransport?.departure || '',
            arrival: rec.mainTransport?.arrival || '',
            duration: rec.mainTransport?.duration || rec.totalDuration || '',
            price: rec.mainTransport?.price || (rec.totalCost ? { amount: rec.totalCost, currency } : null),
            provider: rec.mainTransport?.provider || rec.source || 'transport-intelligence',
            stops: rec.mainTransport?.stops,
            status: rec.mainTransport?.status || 'scheduled',
          },
          offers: transportIntelResult.options.map((o) => ({
            name: o.name,
            mode: o.mode,
            type: o.type,
            price: o.mainTransport?.price || (o.totalCost ? { amount: o.totalCost, currency } : null),
            duration: o.totalDuration,
            isLive: o.isLive,
            groundTransfer: o.groundTransfer,
            recommendation: o.recommendation,
          })),
          // Multi-modal journey details
          groundTransfer: rec.groundTransfer || null,
          destinationTransfer: rec.destinationTransfer || null,
          totalDuration: rec.totalDuration || '',
          totalCost: rec.totalCost || null,
          recommendation: rec.recommendation || '',
          // Origin/destination geo for display
          originGeo: transportIntelResult.originGeo || null,
          destGeo: transportIntelResult.destGeo || null,
        };
        report.push({
          agent: 'transport-intelligence',
          status: 'success',
          message: `Found ${transportIntelResult.options.length} transport option(s). Recommended: ${rec.name} (${rec.mode})`,
          latencyMs: transportIntelResult.summary?.latencyMs || 0,
          usedAI: false,
        });
      } else {
        // No options found at all
        transportResult.data = {
          isLive: false,
          selected: null,
          message: transportIntelResult.summary?.message || `No transport options found from ${request.origin} to ${destination}`,
          modesChecked: transportIntelResult.summary?.modesChecked || [],
        };
        report.push({
          agent: 'transport-intelligence',
          status: 'degraded',
          message: transportIntelResult.summary?.message || 'No transport options available',
          usedAI: false,
        });
      }
    } catch (err) {
      logger.warn(`[ORCHESTRATOR] Transport Intelligence error: ${err.message}`);
      // Fallback to legacy agent-based approach
      transportResult.data = {
        isLive: false,
        selected: null,
        message: `Transport intelligence unavailable: ${err.message}. Book via your preferred provider.`,
      };
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // BATCH 3b: Return transport search (destination → origin)
  // Runs after outbound transport so transportMode is defined.
  // ══════════════════════════════════════════════════════════════════════
  let returnTransportResult = null;
  if (request.origin) {
    try {
      returnTransportResult = await transportIntel.findTransportOptions({
        origin: destination,
        destination: request.origin,
        departDate: fmtDate(request.endDate),
        returnDate: fmtDate(request.endDate),
        adults: request.adults,
        children: request.children,
        preference: prefs.transportPreference || transportMode,
        budget: allocation.transport?.amount || 0,
        currency,
      });
      if (returnTransportResult?.recommended) {
        logger.info(`[ORCHESTRATOR] Return transport: ${returnTransportResult.recommended.name} (${returnTransportResult.recommended.mode})`);
      } else {
        logger.info('[ORCHESTRATOR] Return transport: no live options found');
      }
    } catch (err) {
      logger.warn(`[ORCHESTRATOR] Return transport search failed: ${err.message}`);
    }
  }

  logger.info('[ORCHESTRATOR] ═══ BATCH 4: Deterministic budget agent ═══');
  const budgetResult = await budgetAgent.run({
    allocation,
    totalBudget,
    currency,
    travelStyle: prefs.travelStyle,
    providerReport: {
      hotelsLive: hotelResult?.data?.isLive,
      flightsLive: transportResult.data?.isLive,
      weatherLive: weatherResult?.data?.provider === 'live',
    },
    userId,
  });
  report.push(budgetAgent.report(budgetResult));
  logger.agent('budget', 'run', { status: budgetResult.status, suggestions: budgetResult.data?.suggestions?.length || 0, risks: budgetResult.data?.risks?.length || 0 });

  logger.info('[ORCHESTRATOR] ═══ BATCH 4b: Pre-fetch real routes for intra-day travel ═══');
  const routeCache = await prefetchActivityRoutes({
    attractions: attractionResult?.data?.attractions || [],
    restaurants: restaurantResult?.data?.restaurants || [],
    hotelResult,
    destination,
  });
  setRouteCache(routeCache);

  logger.info('[ORCHESTRATOR] ═══ BATCH 5: Build deterministic day-by-day itinerary ═══');
  const plan = itineraryService.buildDaysPlan({
    origin: request.origin,
    destination,
    startDate: request.startDate,
    endDate: request.endDate,
    travelers: { adults: request.adults, children: request.children },
    prefs,
    hotelResult,
    transportResult,
    returnTransportResult,
    weatherResult,
    attractions: attractionResult?.data?.attractions || [],
    restaurants: restaurantResult?.data?.restaurants || [],
    nightlife: nightlifeData,
    budgetAllocation: allocation,
    totalBudget,
    currency,
  });
  const days = plan.days;
  let totalEstimatedCost = itineraryService.computeItineraryCost(days);
  let isOverBudget = totalEstimatedCost > totalBudget;
  logger.info(`[ORCHESTRATOR] Itinerary built: ${days.length} days, estimated cost: ${totalEstimatedCost}, budget: ${totalBudget}, overBudget: ${isOverBudget}`);

  // ══════════════════════════════════════════════════════════════════════
  // BATCH 5b: Budget Engine — iterative optimization with real alternatives
  // ══════════════════════════════════════════════════════════════════════
  logger.info('[ORCHESTRATOR] ═══ BATCH 5b: Budget Engine optimization ═══');
  const nightsCount = Math.max(0, daysCount - 1);
  const partySize = Math.max(1, (request.adults || 1) + (request.children || 0));
  const hotelRooms = budgetService.roomsForParty({ adults: request.adults, children: request.children });

  const budgetEngineResult = budgetEngine.runOptimizationLoop({
    days,
    transportResult,
    hotelResult,
    attractions: attractionResult?.data?.attractions || [],
    restaurants: restaurantResult?.data?.restaurants || [],
    allocation,
    totalBudget,
    currency,
    nights: nightsCount,
    rooms: hotelRooms,
    partySize,
    prefs,
  });

  // Apply budget engine optimizations to the itinerary
  if (budgetEngineResult.optimization?.performed) {
    // Recalculate costs after budget engine modifications
    itineraryService.finalizeDayCosts(days, { partySize, totalBudget });
    totalEstimatedCost = itineraryService.computeItineraryCost(days);
    isOverBudget = totalEstimatedCost > totalBudget;
    logger.info(`[ORCHESTRATOR] Budget engine applied ${budgetEngineResult.optimization.iterations} optimization(s), saving ${budgetEngineResult.optimization.totalSaving} ${currency}`);
  }

  // Validate budget result
  const budgetValidation = budgetEngine.validateBudget(budgetEngineResult);
  if (!budgetValidation.valid) {
    logger.warn(`[ORCHESTRATOR] Budget validation failed: ${budgetValidation.errors.join(', ')}`);
  }
  report.push({
    agent: 'budget-engine',
    status: budgetEngineResult.budget.withinBudget ? 'success' : 'degraded',
    message: budgetEngineResult.budget.withinBudget
      ? `Budget optimized: ${budgetEngineResult.budget.optimizedCost} ${currency} (saved ${budgetEngineResult.optimization.totalSaving} ${currency})`
      : `Budget not fully met: ${budgetEngineResult.budget.optimizedCost} ${currency} (over by ${budgetEngineResult.budget.overBy} ${currency})`,
    latencyMs: 0,
    usedAI: false,
  });
  logger.agent('budget-engine', 'run', {
    status: budgetEngineResult.budget.withinBudget ? 'success' : 'degraded',
    optimizedCost: budgetEngineResult.budget.optimizedCost,
    overBy: budgetEngineResult.budget.overBy,
    iterations: budgetEngineResult.optimization.iterations,
    changes: budgetEngineResult.optimization.changes.length,
  });

  logger.info('[ORCHESTRATOR] ═══ BATCH 6: Final Validator ═══');
  const validation = await finalValidatorAgent.run({
    days,
    budget: totalBudget,
    totalEstimatedCost,
    destination,
    origin: request.origin,
    prefs,
    userId,
  });
  report.push({
    agent: 'finalValidator',
    status: validation.status,
    message: validation.message,
    latencyMs: validation.latencyMs,
    usedAI: false,
  });
  logger.agent('finalValidator', 'run', { status: validation.status, issues: validation.data?.issues?.length || 0, warnings: validation.data?.warnings?.length || 0, passed: validation.data?.passed });

  // ══════════════════════════════════════════════════════════════════════
  // BATCH 7: AI Planning Pipeline (normalize → AI plan → resolve → validate → replan)
  // ══════════════════════════════════════════════════════════════════════
  logger.info('[ORCHESTRATOR] ═══ BATCH 7: AI Planning Pipeline ═══');
  const aiPlanningStarted = Date.now();
  logger.info(`[ORCHESTRATOR] Calling AI planning pipeline: ${daysCount} days, ${currency} ${totalBudget} budget`);

  let aiPlanningResult = null;
  try {
    aiPlanningResult = await runAIPlanningPipeline({
      attractions: attractionResult?.data?.attractions || [],
      restaurants: restaurantResult?.data?.restaurants || [],
      nightlife: nightlifeData,
      hotelResult,
      transportResult,
      eventsResult,
      weatherResult,
      trafficResult,
      guideResult,
      safetyResult,
      prefs,
      destination,
      origin: request.origin,
      startDate: fmtDate(request.startDate),
      endDate: fmtDate(request.endDate),
      travelers: { adults: request.adults, children: request.children },
      totalBudget,
      currency,
      daysCount,
      nightsCount: Math.max(0, daysCount - 1),
      allocation,
      totalEstimatedCost,
      isOverBudget,
      existingDaysPlan: days,
      userId,
      routeCache,
    });
  } catch (err) {
    console.error(`[orchestratorAIPlanning] Unexpected error: ${err.message}`);
    aiPlanningResult = { success: false, error: err.message };
  }

  const aiPlanningLatencyMs = Date.now() - aiPlanningStarted;
  const aiPlanSuccess = aiPlanningResult?.success === true;
  const aiProvider = aiPlanningResult?.provider || null;
  const aiFallbackUsed = aiPlanningResult?.fallbackUsed || false;
  const providerLabel = aiProvider ? (aiProvider === 'gemini' ? 'Gemini' : 'Groq') : 'none';
  const statusLabel = aiPlanSuccess ? `${providerLabel} SUCCESS` : 'FAILED';
  console.log(`[orchestrator] AI planning: ${statusLabel} in ${aiPlanningLatencyMs}ms (provider: ${providerLabel}, attempts: ${aiPlanningResult?.attempts?.length || 0})`);

  // Use AI-generated days when available; fall back to deterministic plan
  const finalDays = aiPlanSuccess ? aiPlanningResult.days : days;
  const usedAIPlan = aiPlanSuccess;

  logger.info(`[ORCHESTRATOR] AI planning result: ${statusLabel}, using ${usedAIPlan ? 'AI' : 'deterministic'} plan (${finalDays.length} days)`);
  report.push({
    agent: 'ai-planning-pipeline',
    status: aiPlanSuccess ? 'success' : 'degraded',
    message: aiPlanSuccess
      ? `AI planning pipeline completed by ${providerLabel}${aiFallbackUsed ? ' (fallback)' : ''} in ${aiPlanningLatencyMs}ms (${aiPlanningResult.attempts?.length || 1} attempt(s), validation ${aiPlanningResult.validation?.passed ? 'passed' : 'degraded'})`
      : `AI planning failed after ${(aiPlanningResult?.attempts?.length || 0)} attempt(s): ${aiPlanningResult?.error || 'unknown error'} — using deterministic plan as fallback`,
    latencyMs: aiPlanningLatencyMs,
    usedAI: aiPlanSuccess,
  });

  logger.info('[ORCHESTRATOR] ═══ BATCH 8: Enriched sections ═══');
  // ══════════════════════════════════════════════════════════════════════
  // BATCH 8: Enriched itinerary sections (budget engine already ran)
  // ══════════════════════════════════════════════════════════════════════
  let optimized = budgetEngineResult.optimization?.performed ? {
    original: budgetEngineResult.budget.originalCost,
    optimized: budgetEngineResult.budget.optimizedCost,
    saved: budgetEngineResult.optimization.totalSaving,
    remaining: budgetEngineResult.budget.remaining,
    withinBudget: budgetEngineResult.budget.withinBudget,
    iterations: budgetEngineResult.optimization.iterations,
    changes: budgetEngineResult.optimization.changes,
    emergencyReserve: allocation.emergencyReserve?.amount || 0,
    notes: budgetEngineResult.budget.withinBudget
      ? `Optimized by Budget Engine in ${budgetEngineResult.optimization.iterations} iteration(s)`
      : `Budget not fully met after ${budgetEngineResult.optimization.iterations} iteration(s). Best plan: ${budgetEngineResult.budget.optimizedCost} ${currency}`,
  } : plan.optimized;
  if (optimized && allocation.emergencyReserve && !optimized.emergencyReserve) {
    optimized = { ...optimized, emergencyReserve: allocation.emergencyReserve.amount };
  }

  const extras = itineraryService.buildItineraryExtras({
    request,
    prefs,
    days: finalDays,
    totalBudget,
    currency,
    allocation,
    totalEstimatedCost,
    hotelResult,
    restaurantResult,
    attractionResult,
    transportResult,
    weatherResult,
    guideResult,
    safetyResult,
    optimized,
    destinationHint: destinationResult?.data || null,
  });

  logger.info('[ORCHESTRATOR] ═══ BATCH 9: Persist to MongoDB ═══');
  const trip = await Trip.create({
    user: userId,
    title: request.title || orchestration.data?.summary?.tripTitle || `${destination} Trip`,
    origin: request.origin,
    destination,
    startDate: request.startDate,
    endDate: request.endDate,
    travelers: { adults: request.adults, children: request.children, numTravelers: request.numTravelers || request.adults, travelerType: request.travelerType || 'solo' },
    budget: { total: totalBudget, currency, accommodationType: request.accommodationType || 'budget' },
    preferences: {
      travelStyle: prefs.travelStyle,
      interests: prefs.interests,
      foodPreference: prefs.foodPreference,
      hotelPreference: prefs.hotelPreference,
      transportPreference: prefs.transportPreference,
      activityLevel: prefs.activityLevel,
      accessibility: prefs.accessibility,
    },
    totalEstimatedCost,
    totalOptimizedCost: optimized?.optimized ?? totalEstimatedCost,
    moneySaved: optimized?.saved ?? 0,
    isOverBudget,
  });

  logger.info(`[ORCHESTRATOR] Trip saved: ${trip._id}`);
  let itinerary;
  try {
  itinerary = await Itinerary.create({
    trip: trip._id,
    user: userId,
    days: finalDays || [],
    summary: usedAIPlan
      ? `AI-verified itinerary for ${destination} (validated by ${providerLabel})`
      : (validation.data?.summary || `Planned trip to ${destination}`),
    currency,
    totalEstimatedCost,
    transport: {
      mode: transportResult.mode,
      details: transportResult.data?.selected || null,
      isLive: transportResult.data?.isLive === true,
      alternatives: transportResult.data?.offers || [],
      modesChecked: transportResult.data?.modesChecked || [],
      message: transportResult.data?.message || '',
      groundTransfer: transportResult.data?.groundTransfer || null,
      destinationTransfer: transportResult.data?.destinationTransfer || null,
      totalDuration: transportResult.data?.totalDuration || '',
      totalCost: transportResult.data?.totalCost || null,
      recommendation: transportResult.data?.recommendation || '',
      originGeo: transportResult.data?.originGeo || null,
      destGeo: transportResult.data?.destGeo || null,
    },
    accommodation: hotelResult?.data?.recommended
      ? {
          name: hotelResult.data.recommended.name,
          address: hotelResult.data.recommended.address || '',
          pricePerNight: hotelResult.data.recommended.price?.amount ?? null,
          isLive: hotelResult.data.isLive === true,
          source: 'amadeus-hotels',
        }
      : { name: '', isLive: false, source: 'unavailable' },
    safetyNotes: safetyResult?.data?.safetyTips?.join(' • ') || '',
    emergencyInfo: null,
    agentReport: report,
    validation: {
      passed: usedAIPlan ? (aiPlanningResult.validation?.passed ?? validation.data?.passed) : validation.data?.passed,
      issues: usedAIPlan ? (aiPlanningResult.validation?.issues || validation.data?.issues || []) : validation.data?.issues || [],
      warnings: usedAIPlan ? (aiPlanningResult.validation?.warnings || validation.data?.warnings || []) : validation.data?.warnings || [],
      validatedAt: new Date(),
      usedAIPlan,
      aiProvider: usedAIPlan ? aiProvider : null,
      replanAttempts: aiPlanningResult?.attempts?.length || 0,
    },
    optimizedBudget: optimized,
    budgetAllocation: allocation,
    extras,
  });
  } catch (itinErr) {
    logger.warn(`[ORCHESTRATOR] Itinerary.create() failed: ${itinErr.message} — retrying with sanitized days`);
    // Sanitize days: strip any fields that might cause validation errors
    const safeDays = (finalDays || []).map((d) => ({
      dayNumber: d.dayNumber,
      date: d.date,
      area: String(d.area || ''),
      activities: (d.activities || []).map((a) => ({
        time: String(a.time || ''),
        slot: String(a.slot || ''),
        title: String(a.title || 'Activity'),
        place: String(a.place || ''),
        description: String(a.description || ''),
        category: ['transport', 'flight', 'train', 'bus', 'hotel', 'restaurant', 'attraction', 'activity', 'nightlife', 'free', 'other'].includes(a.category) ? a.category : 'activity',
        address: String(a.address || ''),
        cost: { amount: Number(a.cost?.amount) || 0, currency: String(a.cost?.currency || 'INR'), isEstimate: Boolean(a.cost?.isEstimate ?? true) },
        source: String(a.source || 'ai-generated'),
        isLive: Boolean(a.isLive),
        dataStatus: ['live', 'estimate', 'unavailable'].includes(a.dataStatus) ? a.dataStatus : 'estimate',
        priority: Number(a.priority) || 1,
      })),
      dayCost: Number(d.dayCost) || 0,
    }));
    itinerary = await Itinerary.create({
      trip: trip._id,
      user: userId,
      days: safeDays,
      summary: validation.data?.summary || `Planned trip to ${destination}`,
      currency,
      totalEstimatedCost,
      transport: {
        mode: transportResult.mode,
        details: transportResult.data?.selected || null,
        isLive: transportResult.data?.isLive === true,
        alternatives: transportResult.data?.offers || [],
        modesChecked: transportResult.data?.modesChecked || [],
        message: transportResult.data?.message || '',
      },
      accommodation: { name: '', isLive: false, source: 'unavailable' },
      safetyNotes: '',
      emergencyInfo: null,
      agentReport: report,
      validation: { passed: false, issues: ['Itinerary sanitized due to validation error'], warnings: [], validatedAt: new Date() },
      optimizedBudget: optimized,
      budgetAllocation: allocation,
      extras,
    });
  }

  await notifyTripPlanned(userId, trip._id, trip.title);
  if (optimized) await notifyBudgetOptimized(userId, trip._id, optimized.saved);
  logger.info(`[ORCHESTRATOR] Notifications sent for trip: ${trip._id}`);

  if (!itinerary) {
    itinerary = await Itinerary.findOne({ trip: trip._id });
  }
  logger.info(`[ORCHESTRATOR] Itinerary retrieved: ${itinerary?._id}`);
  const budgetSummary = budgetService.budgetUtilization({
    total: totalBudget,
    spent: optimized?.optimized ?? totalEstimatedCost,
  });

  const pipelineMs = Date.now() - started;    logger.exit('[ORCHESTRATOR]', 'generateTrip', {
    status: 'success',
    latencyMs: pipelineMs,
    geminiRequests: getRequestCount(),
    tripId: trip._id.toString(),
    destination,
    days: finalDays.length,
    usedAIPlan,
    totalEstimatedCost,
    isOverBudget,
  });

  return {
    trip,
    itinerary,
    // AI provider metadata
    aiProvider: usedAIPlan ? aiProvider : null,
    usedAIPlan,
    aiPlanningAttempts: aiPlanningResult?.attempts || [],
    fallbackUsed: aiFallbackUsed || false,
    agentReport: report,
    budget: {
      allocation,
      totalBudget,
      currency,
      totalEstimatedCost,
      remainingBudget: budgetSummary.remaining,
      budgetUsedPct: budgetSummary.usedPct,
      withinBudget: budgetSummary.withinBudget,
      optimized,
    },
    // Budget engine result
    budgetEngine: budgetEngineResult,
    budgetSummary,
    validation: usedAIPlan ? aiPlanningResult.validation || validation.data : validation.data,
    pipelineMs,
    geminiRequestCount: getRequestCount(),
    dataAvailability: {
      weatherLive: weatherResult?.data?.provider === 'live',
      flightsLive: transportResult.data?.isLive && transportResult.mode === 'flight',
      trainsLive: transportResult.data?.isLive && transportResult.mode === 'train',
      busesLive: transportResult.data?.isLive && transportResult.mode === 'bus',
      hotelsLive: hotelResult?.data?.isLive,
      attractionsLive: attractionResult?.data?.isLive,
      restaurantsLive: restaurantResult?.data?.isLive,
      nightlifeLive: nightlifeData.length > 0,
      eventsLive: eventsResult?.status === 'success',
      eventsCount: eventsResult?.data?.totalEvents || 0,
      transportModesChecked: transportIntelResult?.summary?.modesChecked || transportResult.data?.modesChecked || [],
      transportAlternatives: transportIntelResult?.options?.length || 0,
      originGeo: transportIntelResult?.originGeo || null,
      destGeo: transportIntelResult?.destGeo || null,
    },
  };
}

/**
 * Re-run budget optimization for an existing trip.
 */
export async function optimizeTripBudget({ trip, itinerary, user }) {
  logger.entry('[ORCHESTRATOR]', 'optimizeTripBudget', { tripId: trip._id, destination: trip.destination, budget: trip.budget.total });
  const currency = trip.budget.currency || 'INR';
  const allocation = budgetService.allocationForStyle(
    trip.preferences?.travelStyle || 'standard',
    trip.budget.total
  );
  const partySize = Math.max(1, Number(trip.travelers?.adults) + Number(trip.travelers?.children) || 1);
  const nights = Math.max(0, Math.ceil((new Date(trip.endDate) - new Date(trip.startDate)) / (1000 * 60 * 60 * 24)));
  const rooms = budgetService.roomsForParty({ adults: trip.travelers?.adults, children: trip.travelers?.children });

  // Use the Budget Engine for re-optimization
  const budgetEngineResult = budgetEngine.runOptimizationLoop({
    days: itinerary.days,
    transportResult: null, // No fresh transport data for re-optimization
    hotelResult: null, // No fresh hotel data for re-optimization
    attractions: [],
    restaurants: [],
    allocation,
    totalBudget: trip.budget.total,
    currency,
    nights,
    rooms,
    partySize,
    prefs: trip.preferences || {},
  });

  // Apply budget engine optimizations
  if (budgetEngineResult.optimization?.performed) {
    itineraryService.finalizeDayCosts(itinerary.days, { partySize, totalBudget: trip.budget.total });
  }

  itinerary.totalEstimatedCost = budgetEngineResult.budget.optimizedCost;
  itinerary.budgetAllocation = allocation;
  itinerary.optimizedBudget = {
    original: budgetEngineResult.budget.originalCost,
    optimized: budgetEngineResult.budget.optimizedCost,
    saved: budgetEngineResult.optimization.totalSaving,
    remaining: budgetEngineResult.budget.remaining,
    withinBudget: budgetEngineResult.budget.withinBudget,
    iterations: budgetEngineResult.optimization.iterations,
    changes: budgetEngineResult.optimization.changes,
    emergencyReserve: allocation.emergencyReserve.amount,
    notes: `Optimized by Budget Engine in ${budgetEngineResult.optimization.iterations} iteration(s)`,
  };
  for (const day of itinerary.days) {
    if (typeof day.markModified === 'function') day.markModified('costBreakdown');
  }
  await itinerary.save();

  trip.totalOptimizedCost = budgetEngineResult.budget.optimizedCost;
  trip.moneySaved = budgetEngineResult.optimization.totalSaving;
  trip.isOverBudget = !budgetEngineResult.budget.withinBudget;
  await trip.save();

  await notifyBudgetOptimized(user._id.toString(), trip._id, budgetEngineResult.optimization.totalSaving);
  logger.exit('[ORCHESTRATOR]', 'optimizeTripBudget', { status: 'success', saved: budgetEngineResult.optimization.totalSaving, optimized: budgetEngineResult.budget.optimizedCost, withinBudget: budgetEngineResult.budget.withinBudget });
  return { ...budgetEngineResult.budget, allocation, currency, optimization: budgetEngineResult.optimization };
}

export default { generateTrip, optimizeTripBudget };
