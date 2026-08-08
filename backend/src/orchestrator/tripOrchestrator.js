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
import placesProvider from '../providers/places.provider.js';
import mapsProvider from '../providers/maps.provider.js';
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
 * Full Multi-Agent trip generation pipeline.
 * Agents with external providers fetch REAL data first; Gemini only reasons
 * over that data. Every step records a status into the agent report.
 */
export async function generateTrip({ user, request }) {
  const userId = user._id.toString();
  const report = [];
  const started = Date.now();
  const currency = request.currency || user.preferredCurrency || 'INR';
  const totalBudget = request.totalBudget;

  // 1. Orchestrator Agent
  const orchestration = await orchestratorAgent.run({ request, userId });
  report.push(orchestratorAgent.report(orchestration));
  const daysCount = orchestration.data?.summary?.days || 1;

  // 2. User Preference Agent
  const prefsResult = await userPreferenceAgent.run({ user, request });
  report.push(userPreferenceAgent.report(prefsResult));
  const prefs = prefsResult.data;

  // 3. Destination Agent
  let destination = request.destination;
  let destinationResult = null;
  if (request.suggestDestination || !destination) {
    destinationResult = await destinationAgent.suggest({ prefs, request, userId });
    destination = destinationResult.data?.destination || 'Suggested destination';
  }
  report.push(destinationAgent.report(destinationResult || { status: 'success', message: `Destination provided: ${destination}` }));

  // 4. Weather Agent (provider first)
  const weatherResult = await weatherAgent.run({ destination, startDate: fmtDate(request.startDate), endDate: fmtDate(request.endDate), userId });
  report.push(weatherAgent.report(weatherResult));

  // 5. Transport Agents in parallel (real data first)
  const transportMode = inferTransportMode({ origin: request.origin, destination, transportPreference: prefs.transportPreference });
  const transportResult = { mode: transportMode, data: { isLive: false, selected: null } };
  if (transportMode === 'flight' && request.origin) {
    const f = await flightAgent.run({ origin: request.origin, destination, departDate: fmtDate(request.startDate), returnDate: fmtDate(request.endDate), adults: request.adults, travelClass: 'ECONOMY', userId });
    report.push(flightAgent.report(f));
    if (f.data?.isLive) {
      transportResult.mode = 'flight';
      transportResult.data = { isLive: true, selected: f.data.selectedFlight || f.data.flights?.[0] || null, offers: f.data.flights };
    } else {
      transportResult.data = { isLive: false, selected: null, message: f.data?.message || '' };
    }
  } else if (transportMode === 'train') {
    const t = await trainAgent.run({ from: request.origin, to: destination, date: fmtDate(request.startDate), passengers: request.adults + request.children, trainClass: '', userId });
    report.push(trainAgent.report(t));
    if (t.data?.isLive) transportResult.data = { isLive: true, selected: t.data.trains?.[0] || null, offers: t.data.trains };
  } else if (transportMode === 'bus') {
    const b = await busAgent.run({ from: request.origin, to: destination, date: fmtDate(request.startDate), passengers: request.adults + request.children, userId });
    report.push(busAgent.report(b));
    if (b.data?.isLive) transportResult.data = { isLive: true, selected: b.data.buses?.[0] || null, offers: b.data.buses };
  } else if (request.origin) {
    // Default: try flight, fall back to train/bus status
    const f = await flightAgent.run({ origin: request.origin, destination, departDate: fmtDate(request.startDate), returnDate: fmtDate(request.endDate), adults: request.adults, travelClass: 'ECONOMY', userId });
    report.push(flightAgent.report(f));
    if (f.data?.isLive) transportResult.data = { isLive: true, selected: f.data.selectedFlight || f.data.flights?.[0] || null, offers: f.data.flights };
    else transportResult.data = { isLive: false, selected: null, message: f.data?.message || 'Transport live data unavailable' };
  }

  // 6. Hotel Agent — search is budget-aware so returned offers already fit
  //    the accommodation allocation (maxPrice = hotel budget for the stay).
  const allocation = budgetService.allocationForStyle(prefs.travelStyle || 'standard', totalBudget);
  const rooms = budgetService.roomsForParty({ adults: request.adults, children: request.children });
  const hotelResult = await hotelAgent.run({
    destination,
    checkIn: fmtDate(request.startDate),
    checkOut: fmtDate(request.endDate),
    adults: request.adults,
    rooms,
    maxPrice: allocation.hotels?.amount,
    totalBudget,
    hotelPreference: prefs.hotelPreference,
    userId,
  });
  report.push(hotelAgent.report(hotelResult));

  // 7. Attraction + Restaurant Agents (Places provider) in parallel
  const [attractionResult, restaurantResult] = await Promise.all([
    attractionAgent.run({ destination, interests: prefs.interests, activityLevel: prefs.activityLevel, userId }),
    restaurantAgent.run({ destination, foodPreference: prefs.foodPreference, userId }),
  ]);
  report.push(attractionAgent.report(attractionResult));
  report.push(restaurantAgent.report(restaurantResult));

  // 7b. Real nightlife near the destination (bars, clubs, night markets).
  //     Geocoding is guarded - a failure simply yields an empty nightlife pool
  //     and the itinerary falls back to local attractions, never invented data.
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
  report.push({
    agent: 'nightlife',
    status: nightlifeData.length ? 'success' : 'degraded',
    message: nightlifeData.length ? `${nightlifeData.length} real nightlife places found` : 'Nightlife data unavailable - local attractions used instead',
    usedAI: false,
  });

  // 8. Budget Agent (deterministic allocation + AI reasoning)
  const budgetResult = await budgetAgent.run({
    allocation,
    totalBudget,
    currency,
    travelStyle: prefs.travelStyle,
    providerReport: {
      hotelsLive: hotelResult.data?.isLive,
      flightsLive: transportResult.data?.isLive,
      weatherLive: weatherResult.data?.provider === 'live',
    },
    userId,
  });
  report.push(budgetAgent.report(budgetResult));

  // 9. Build deterministic day-by-day itinerary. The builder enforces the
  //    user's budget as a HARD constraint - it trims the plan (drops optional
  //    items, reduces flexible costs) so the stored total never exceeds it.
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
    attractions: attractionResult.data?.attractions || [],
    restaurants: restaurantResult.data?.restaurants || [],
    nightlife: nightlifeData,
    budgetAllocation: allocation,
    totalBudget,
    currency,
  });
  const days = plan.days;

  const totalEstimatedCost = itineraryService.computeItineraryCost(days);
  const isOverBudget = totalEstimatedCost > totalBudget;

  // 10. Traffic / Local Guide / Safety Agents
  const [trafficResult, guideResult, safetyResult] = await Promise.all([
    trafficAgent.run({ destination, hotelName: hotelResult.data?.recommended?.name || '', userId }),
    localGuideAgent.run({ destination, travelStyle: prefs.travelStyle, userId }),
    safetyAgent.run({ destination, userId }),
  ]);
  report.push(trafficAgent.report(trafficResult));
  report.push(localGuideAgent.report(guideResult));
  report.push(safetyAgent.report(safetyResult));

  // 11. Final Validator Agent
  const validation = await finalValidatorAgent.run({
    days,
    budget: totalBudget,
    totalEstimatedCost,
    destination,
    origin: request.origin,
    prefs,
    userId,
  });
  report.push(finalValidatorAgent.report(validation));

  // 12. The itinerary builder already enforces the budget; expose its result
  //     (non-null when trimming was actually needed) or the healthy totals.
  let optimized = plan.optimized;
  if (optimized && allocation.emergencyReserve) {
    optimized = { ...optimized, emergencyReserve: allocation.emergencyReserve.amount };
  }

  // 12b. Enriched itinerary sections (trip summary, budget planning, nearby
  //      places, transport plan, weather, tips, recommendations, map data)
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

  // 13. Persist
  const trip = await Trip.create({
    user: userId,
    title: request.title || orchestration.data?.summary?.tripTitle || `${destination} Trip`,
    origin: request.origin,
    destination,
    startDate: request.startDate,
    endDate: request.endDate,
    travelers: { adults: request.adults, children: request.children },
    budget: { total: totalBudget, currency },
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

  await Itinerary.create({
    trip: trip._id,
    user: userId,
    days,
    summary: validation.data?.summary || `Planned trip to ${destination}`,
    currency,
    totalEstimatedCost,
    transport: {
      mode: transportResult.mode,
      details: transportResult.data?.selected || null,
      isLive: transportResult.data?.isLive === true,
    },
    accommodation: hotelResult.data?.recommended
      ? {
          name: hotelResult.data.recommended.name,
          address: hotelResult.data.recommended.address || '',
          pricePerNight: hotelResult.data.recommended.price?.amount ?? null,
          isLive: hotelResult.data.isLive === true,
          source: 'amadeus-hotels',
        }
      : { name: '', isLive: false, source: 'unavailable' },
    safetyNotes: safetyResult.data?.safetyTips?.join(' • ') || '',
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

  await notifyTripPlanned(userId, trip._id, trip.title);
  if (optimized) await notifyBudgetOptimized(userId, trip._id, optimized.saved);

  const itinerary = await Itinerary.findOne({ trip: trip._id });
  const budgetSummary = budgetService.budgetUtilization({
    total: totalBudget,
    spent: optimized?.optimized ?? totalEstimatedCost,
  });

  return {
    trip,
    itinerary,
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
    pipelineMs: Date.now() - started,
    dataAvailability: {
      weatherLive: weatherResult.data?.provider === 'live',
      flightsLive: transportResult.data?.isLive,
      hotelsLive: hotelResult.data?.isLive,
      attractionsLive: attractionResult.data?.isLive,
      restaurantsLive: restaurantResult.data?.isLive,
      nightlifeLive: nightlifeData.length > 0,
    },
  };
}

/**
 * Re-run budget optimization for an existing trip.
 */
export async function optimizeTripBudget({ trip, itinerary, user }) {
  const currency = trip.budget.currency || 'INR';
  const items = itineraryService.toCostItems(itinerary.days, currency);
  const allocation = budgetService.allocationForStyle(
    trip.preferences?.travelStyle || 'standard',
    trip.budget.total
  );
  const opt = budgetService.optimizeCosts(items, trip.budget.total, {
    emergencyReserve: allocation.emergencyReserve.amount,
  });

  // Apply optimized costs back into the itinerary (flagged as estimates).
  // Index-based ids keep duplicate titles from colliding.
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
  // Keep per-day costs consistent with the optimized activities
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
  // Mixed fields aren't diff-tracked by Mongoose - mark them explicitly so
  // the persisted document reflects the optimized breakdowns.
  for (const day of itinerary.days) {
    if (typeof day.markModified === 'function') day.markModified('costBreakdown');
  }
  await itinerary.save();

  trip.totalOptimizedCost = opt.optimized;
  trip.moneySaved = opt.saved;
  trip.isOverBudget = !opt.withinBudget;
  await trip.save();

  await notifyBudgetOptimized(user._id.toString(), trip._id, opt.saved);
  return { ...opt, allocation, currency };
}

export default { generateTrip, optimizeTripBudget };
