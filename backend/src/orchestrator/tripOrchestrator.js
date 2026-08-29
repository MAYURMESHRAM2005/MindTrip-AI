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
import finalValidatorAgent from '../agents/finalValidator.agent.js';
import budgetService from '../services/budget.service.js';
import itineraryService from '../services/itinerary.service.js';
import { generateItinerary, getRequestCount } from '../services/itineraryGenerator.service.js';
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
  logger.info('[ORCHESTRATOR] Batch 2 results: weather=' + (weatherResult?.status || 'null') + ', hotel=' + (hotelResult?.status || 'null') + ', attractions=' + (attractionResult?.data?.attractions?.length || 0) + ', restaurants=' + (restaurantResult?.data?.restaurants?.length || 0) + ', traffic=' + (trafficResult?.status || 'null'));

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
    weatherResult,
    attractions: attractionResult?.data?.attractions || [],
    restaurants: restaurantResult?.data?.restaurants || [],
    nightlife: nightlifeData,
    budgetAllocation: allocation,
    totalBudget,
    currency,
  });
  const days = plan.days;
  const totalEstimatedCost = itineraryService.computeItineraryCost(days);
  const isOverBudget = totalEstimatedCost > totalBudget;
  logger.info(`[ORCHESTRATOR] Itinerary built: ${days.length} days, estimated cost: ${totalEstimatedCost}, budget: ${totalBudget}, overBudget: ${isOverBudget}`);

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
  // BATCH 7: ONE Gemini API Request — generates personalized itinerary
  // ══════════════════════════════════════════════════════════════════════
  logger.info('[ORCHESTRATOR] ═══ BATCH 7: Gemini itinerary generation ═══');
  let geminiResult = null;
  const geminiStarted = Date.now();
  logger.info(`[ORCHESTRATOR] Calling Gemini with context: ${daysCount} days, ${currency} ${totalBudget} budget`);

  try {
    const nightsCount = Math.max(0, daysCount - 1);
    geminiResult = await generateItinerary({
      userPreferences: prefs,
      destination,
      origin: request.origin,
      startDate: fmtDate(request.startDate),
      endDate: fmtDate(request.endDate),
      travelers: { adults: request.adults, children: request.children },
      totalBudget,
      currency,
      daysCount,
      nightsCount,
      weather: weatherResult,
      accommodation: hotelResult,
      transport: transportResult,
      attractions: attractionResult?.data?.attractions || [],
      restaurants: restaurantResult?.data?.restaurants || [],
      nightlife: nightlifeData,
      traffic: trafficResult?.data || {},
      guide: guideResult?.data || {},
      safety: safetyResult?.data || {},
      budgetAllocation: allocation,
      totalEstimatedCost,
      isOverBudget,
      existingDaysPlan: days,
      userId,
    });
  } catch (err) {
    console.error(`[itineraryGenerator] Unexpected error: ${err.message}`);
    geminiResult = { success: false, error: err.message };
  }

  const geminiLatencyMs = Date.now() - geminiStarted;
  const geminiSuccess = geminiResult?.success === true;
  const geminiQuotaExhausted = geminiResult?.quotaExhausted === true;
  console.log(`[orchestrator] Gemini call: ${geminiSuccess ? 'SUCCESS' : geminiQuotaExhausted ? 'QUOTA_EXHAUSTED' : 'FAILED'} in ${geminiLatencyMs}ms (request #${getRequestCount()})`);

  logger.info(`[ORCHESTRATOR] Gemini result: ${geminiSuccess ? 'SUCCESS' : geminiQuotaExhausted ? 'QUOTA_EXHAUSTED' : 'FAILED'} in ${geminiLatencyMs}ms, days: ${geminiResult?.itinerary?.days?.length || 0}`);
  report.push({
    agent: 'itinerary-generator',
    status: geminiSuccess ? 'success' : 'degraded',
    message: geminiSuccess
      ? `Itinerary generated in ${geminiResult.latencyMs}ms (request #${geminiResult.geminiRequestCount})`
      : geminiQuotaExhausted
        ? `Gemini daily quota exhausted — using deterministic plan as fallback`
        : `Gemini failed: ${geminiResult?.error || 'unknown error'} — using deterministic plan as fallback`,
    latencyMs: geminiLatencyMs,
    usedAI: geminiSuccess,
  });

  logger.info('[ORCHESTRATOR] ═══ BATCH 8: Budget optimization + enriched sections ═══');
  // ══════════════════════════════════════════════════════════════════════
  // BATCH 8: Budget optimization + enriched itinerary sections
  // ══════════════════════════════════════════════════════════════════════
  let optimized = plan.optimized;
  if (optimized && allocation.emergencyReserve) {
    optimized = { ...optimized, emergencyReserve: allocation.emergencyReserve.amount };
  }

  const extras = itineraryService.buildItineraryExtras({
    request,
    prefs,
    days,
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
    days: days || [],
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
      passed: validation.data?.passed,
      issues: validation.data?.issues || [],
      warnings: validation.data?.warnings || [],
      validatedAt: new Date(),
    },
    optimizedBudget: optimized,
    budgetAllocation: allocation,
    extras,
  });
  } catch (itinErr) {
    logger.warn(`[ORCHESTRATOR] Itinerary.create() failed: ${itinErr.message} — retrying with sanitized days`);
    // Sanitize days: strip any fields that might cause validation errors
    const safeDays = (days || []).map((d) => ({
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

  const pipelineMs = Date.now() - started;
  logger.exit('[ORCHESTRATOR]', 'generateTrip', {
    status: 'success',
    latencyMs: pipelineMs,
    geminiRequests: getRequestCount(),
    tripId: trip._id.toString(),
    destination,
    days: days.length,
    totalEstimatedCost,
    isOverBudget,
  });

  return {
    trip,
    itinerary,
    // Include Gemini-generated itinerary if available
    geminiItinerary: geminiResult?.success ? geminiResult.itinerary : null,
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
    budgetSummary,
    validation: validation.data,
    pipelineMs,
    geminiRequestCount: getRequestCount(),
    geminiQuotaExhausted: geminiQuotaExhausted || false,
    dataAvailability: {
      weatherLive: weatherResult?.data?.provider === 'live',
      flightsLive: transportResult.data?.isLive && transportResult.mode === 'flight',
      trainsLive: transportResult.data?.isLive && transportResult.mode === 'train',
      busesLive: transportResult.data?.isLive && transportResult.mode === 'bus',
      hotelsLive: hotelResult?.data?.isLive,
      attractionsLive: attractionResult?.data?.isLive,
      restaurantsLive: restaurantResult?.data?.isLive,
      nightlifeLive: nightlifeData.length > 0,
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
  const items = itineraryService.toCostItems(itinerary.days, currency);
  const allocation = budgetService.allocationForStyle(
    trip.preferences?.travelStyle || 'standard',
    trip.budget.total
  );
  const opt = budgetService.optimizeCosts(items, trip.budget.total, {
    emergencyReserve: allocation.emergencyReserve.amount,
  });

  const dayIndexById = {};
  for (const day of itinerary.days) {
    (day.activities || []).forEach((act, i) => {
      dayIndexById[itineraryService.activityItemId(day.dayNumber, i)] = act;
    });
  }
  for (const r of opt.reductions) {
    const act = dayIndexById[r.id];
    if (act && act.cost) {
      act.cost.amount = r.to;
      act.cost.isEstimate = true;
      act.cost.estimateNote = r.note;
    }
  }
  for (const d of opt.dropped) {
    const act = dayIndexById[d.id];
    if (act) {
      act.notes = 'Removed by Budget Optimizer';
      act.dataStatus = 'unavailable';
      act.cost.amount = 0;
    }
  }
  itineraryService.finalizeDayCosts(itinerary.days, {
    partySize: Math.max(1, Number(trip.travelers?.adults) + Number(trip.travelers?.children) || 1),
    totalBudget: trip.budget.total,
  });
  itinerary.totalEstimatedCost = opt.optimized;
  itinerary.budgetAllocation = allocation;
  itinerary.optimizedBudget = {
    ...opt,
    emergencyReserve: allocation.emergencyReserve.amount,
    notes: 'Optimized by Budget Agent: dropped low-priority items and reduced flexible costs.',
  };
  for (const day of itinerary.days) {
    if (typeof day.markModified === 'function') day.markModified('costBreakdown');
  }
  await itinerary.save();

  trip.totalOptimizedCost = opt.optimized;
  trip.moneySaved = opt.saved;
  trip.isOverBudget = !opt.withinBudget;
  await trip.save();

  await notifyBudgetOptimized(user._id.toString(), trip._id, opt.saved);
  logger.exit('[ORCHESTRATOR]', 'optimizeTripBudget', { status: 'success', saved: opt.saved, optimized: opt.optimized, withinBudget: opt.withinBudget });
  return { ...opt, allocation, currency };
}

export default { generateTrip, optimizeTripBudget };
