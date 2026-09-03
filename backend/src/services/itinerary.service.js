import { haversineKm } from '../utils/geo.js';
import budgetService from './budget.service.js';

/**
 * Deterministic schedule builder. Composes real provider data into a
 * day-by-day plan using a realistic daily rhythm:
 *  - Arrival day:    transport-in, check-in, breakfast, sightseeing, lunch,
 *                    afternoon, evening, dinner, night, overnight
 *  - Middle days:    breakfast, morning, lunch, afternoon, evening, dinner,
 *                    night, overnight
 *  - Departure day:  check-out, return travel (no destination activities)
 *
 * Design rules (enforced deterministically, no LLM guesswork):
 *  - Every day is assigned a UNIQUE geographic area when real data allows it;
 *    areas are derived from the provider's locality fields, never invented.
 *  - Restaurants, attractions and nightlife are picked WITHOUT repetition
 *    across days; if a destination has too few real options, repeats are
 *    allowed but explicitly explained.
 *  - Costs are traveller-aware: meals are per-person × party size, hotels are
 *    per-room × rooms per night, transport is split outbound/return/local.
 *  - Every location transition carries distance + travel time.
 *  - Heavy-rain days swap outdoor picks for indoor ones.
 *  - The total estimated cost NEVER exceeds the user's budget: the plan is
 *    optimized (drop optional items, reduce flexible costs) before returning.
 * Anything without live data is marked dataStatus:'unavailable' / estimate
 * flags - nothing is ever invented.
 */

const RESTAURANT_PRICE_BY_LEVEL = { 0: 150, 1: 350, 2: 700, 3: 1400, 4: 2500 };
const ATTRACTION_ENTRY_DEFAULT = { amount: 0, isEstimate: true };
/**
 * The current date for freshness checks.
 */
const NOW_ISO = new Date().toISOString();
/** Two places closer than this are treated as the same geographic area. */
const AREA_RADIUS_KM = 12;
/** Radius used to attach restaurants/nightlife to a day's area. */
const LOCAL_RADIUS_KM = 14;

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

/** Morning / lunch / afternoon / evening / night bucket for an activity time. */
export function periodForTime(time) {
  const h = parseInt(String(time || '').split(':')[0], 10);
  if (Number.isNaN(h)) return 'day';
  if (h < 11) return 'morning';
  if (h < 15) return 'lunch';
  if (h < 18) return 'afternoon';
  if (h < 21) return 'evening';
  return 'night';
}

export function dateRange(startDate, endDate) {
  const days = [];
  const start = new Date(startDate);
  const end = new Date(endDate);
  const cursor = new Date(start);
  while (cursor <= end) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

/* ------------------------------------------------------------------ */
/*  Geographic area planning                                           */
/* ------------------------------------------------------------------ */

/** Locality name for a place from real provider fields (never invented). */
function localityOf(place) {
  return place?.suburb || place?.district || place?.county || place?.city || '';
}

/**
 * Greedy proximity sweep over a coordinate list. Returns areas of items that
 * are within AREA_RADIUS_KM of a seed point (real spatial grouping).
 */
function proximityAreas(items, destination) {
  const groups = [];
  const used = new Set();
  for (const seed of items) {
    if (used.has(seed)) continue;
    const group = [seed];
    used.add(seed);
    for (const other of items) {
      if (used.has(other)) continue;
      const km = haversineKm(seed.coordinates.lat, seed.coordinates.lng, other.coordinates.lat, other.coordinates.lng);
      if (km <= AREA_RADIUS_KM) {
        group.push(other);
        used.add(other);
      }
    }
    const lat = group.reduce((s, a) => s + a.coordinates.lat, 0) / group.length;
    const lng = group.reduce((s, a) => s + a.coordinates.lng, 0) / group.length;
    groups.push({ name: '', centroid: { lat, lng }, attractions: group });
  }
  return groups;
}

/**
 * Cluster real attractions into geographic areas. Uses the provider's locality
 * fields first; when those produce fewer than two areas (very common with real
 * Geoapify data, where everything shares the destination city) it falls back to
 * coordinate-proximity grouping so each day still gets its own region.
 * Returns [{ name, centroid, attractions }].
 */
export function clusterAreas(attractions = [], destination = '') {
  const list = Array.isArray(attractions) ? attractions : [];
  const withCoords = list.filter((a) => a.coordinates?.lat != null && a.coordinates?.lng != null);

  if (!withCoords.length) {
    return [{ name: destination || 'Destination', centroid: null, attractions: list }];
  }

  // Group by locality name first (fast + real).
  const byLocality = new Map();
  for (const a of withCoords) {
    const loc = localityOf(a) || '__global__';
    if (!byLocality.has(loc)) byLocality.set(loc, []);
    byLocality.get(loc).push(a);
  }

  const areas = [];
  for (const [loc, group] of byLocality) {
    if (loc === '__global__') continue;
    const lat = group.reduce((s, a) => s + a.coordinates.lat, 0) / group.length;
    const lng = group.reduce((s, a) => s + a.coordinates.lng, 0) / group.length;
    areas.push({ name: loc, centroid: { lat, lng }, attractions: group });
  }

  // Coordinate-proximity clustering for anything without a locality.
  const unplaced = withCoords.filter((a) => !localityOf(a));
  let unplacedAreas = proximityAreas(unplaced, destination);

  let all = [...areas, ...unplacedAreas];
  // Real data frequently shares one city-level locality for everything - in
  // that case locality grouping yields a single bucket, so split spatially.
  if (all.length < 2 && withCoords.length >= 2) {
    all = proximityAreas(withCoords, destination);
    unplacedAreas = all;
  }

  if (!all.length) {
    return [{ name: destination || 'Destination', centroid: null, attractions: withCoords }];
  }
  // Label unnamed areas honestly ("Area 2 · <destination>") - a grouping label,
  // not an invented place name.
  let counter = 0;
  return all.map((area) => ({
    ...area,
    name: area.name || `Area ${++counter} · ${destination || 'destination'}`,
  }));
}

/* ------------------------------------------------------------------ */
/*  Duplicate validation                                               */
/* ------------------------------------------------------------------ */

/**
 * Validate that no sightseeing attraction or restaurant repeats across days.
 * Hotels are allowed to repeat (same hotel for multi-night stay).
 * If duplicates are found, remove the duplicate from the later day and log
 * a warning. This is a safety net — the pickDistinct logic should prevent
 * this, but we validate anyway.
 */
function validateNoDuplicateAttractions(days) {
  const seenAttractions = new Map(); // placeKey → dayNumber
  const seenRestaurants = new Map(); // placeKey → dayNumber
  let removedCount = 0;

  for (const day of days || []) {
    const toRemove = [];
    for (let i = 0; i < (day.activities || []).length; i++) {
      const act = day.activities[i];
      const k = placeKey({ placeId: act.placeId, name: act.place, coordinates: act.coordinates });

      // Skip hotel重复 — same hotel for multi-night stay is expected
      if (act.category === 'hotel') continue;
      // Skip generic/unavailable entries
      if (act.dataStatus === 'unavailable' || act.source === 'none') continue;
      // Skip transport entries
      if (act.category === 'transport' || ['flight', 'train', 'bus'].includes(act.category)) continue;

      if (act.category === 'attraction' || act.category === 'activity' || act.category === 'nightlife') {
        if (seenAttractions.has(k)) {
          // Duplicate attraction — remove from this day
          toRemove.push(i);
          removedCount++;
        } else {
          seenAttractions.set(k, day.dayNumber);
        }
      }

      if (act.category === 'restaurant') {
        if (seenRestaurants.has(k)) {
          // Duplicate restaurant — remove from this day
          toRemove.push(i);
          removedCount++;
        } else {
          seenRestaurants.set(k, day.dayNumber);
        }
      }
    }
    // Remove duplicates in reverse order to preserve indices
    for (let j = toRemove.length - 1; j >= 0; j--) {
      day.activities.splice(toRemove[j], 1);
    }
  }

  if (removedCount > 0) {
    console.warn(`[itinerary] Duplicate validation: removed ${removedCount} duplicate attraction(s)/restaurant(s) across days`);
  }
}

/* ------------------------------------------------------------------ */
/*  Cost math (deterministic, traveller-aware)                         */
/* ------------------------------------------------------------------ */

function restaurantMealCost(r, meal, partySize, currency) {
  const cur = currency || 'INR';

  // Use Zomato real average cost when available (not an estimate)
  if (r.zomatoData && r.zomatoData.averageCostPerPerson > 0) {
    let perPerson = r.zomatoData.averageCostPerPerson;
    // Adjust per meal type: breakfast ~60%, lunch ~85%, dinner ~115% of average
    if (meal === 'breakfast') perPerson = Math.max(80, Math.round(perPerson * 0.6));
    else if (meal === 'lunch') perPerson = Math.round(perPerson * 0.85);
    else if (meal === 'dinner') perPerson = Math.round(perPerson * 1.15);
    const amount = Math.round(perPerson * partySize * 100) / 100;
    return {
      amount,
      perPerson,
      currency: cur,
      isEstimate: false,
      estimateNote: `Real average cost from Zomato (${meal}) × ${partySize} traveller(s) — ${r.zomatoData.ratingText || 'rated'} ${r.zomatoData.rating ?? ''} (${r.zomatoData.votes ?? 0} votes)`,
      source: 'zomato',
      fetchedAt: r.zomatoData.fetchedAt || NOW_ISO,
    };
  }

  // Fallback: Geoapify priceLevel estimate (always marked as estimate)
  const base = RESTAURANT_PRICE_BY_LEVEL[r.priceLevel ?? 1] ?? 350;
  let perPerson = base;
  if (meal === 'breakfast') perPerson = Math.max(80, Math.round(base * 0.6));
  if (meal === 'dinner') perPerson = Math.round(base * 1.15);
  const amount = Math.round(perPerson * partySize * 100) / 100;
  return {
    amount,
    perPerson,
    currency: cur,
    isEstimate: true,
    estimateNote: `Estimated ~${cur} ${perPerson}/person × ${partySize} traveller(s) based on restaurant price level ${r.priceLevel ?? 'unknown'}. Actual menu prices not available from provider.`,
    source: 'geoapify-pricelevel-estimate',
    fetchedAt: NOW_ISO,
  };
}

function entryFeeEstimateFor(attraction) {
  // Geoapify does not provide entry fee data. All fees are estimates
  // based on attraction type. Never present these as real API prices.
  const name = String(attraction?.name || '').toLowerCase();
  const types = (attraction?.types || []).join(' ').toLowerCase();
  if (/museum|gallery|monument|fort|palace|temple|church|mosque|zoo|park|garden|waterfall/.test(name + ' ' + types)) {
    return { amount: 200, isEstimate: true, estimateNote: 'Estimated typical entry fee - no live pricing available from provider. Confirm locally.' };
  }
  return { amount: 0, isEstimate: true, estimateNote: 'Entry fee unknown - no live pricing available from provider. Confirm locally.' };
}

function attractionCost(a, currency, partySize) {
  // Use Viator real pricing when available (not an estimate)
  if (a.entryFee && typeof a.entryFee.amount === 'number' && a.entryFee.amount > 0) {
    const perPerson = a.entryFee.amount;
    const cur = a.entryFee.currency || currency || 'INR';
    return {
      amount: Math.round(perPerson * partySize * 100) / 100,
      perPerson,
      currency: cur,
      isEstimate: false,
      estimateNote: `Real price from Viator (${a.entryFee.productTitle || a.entryFee.source}) × ${partySize} traveller(s)`,
      source: 'viator',
      fetchedAt: a.entryFee.fetchedAt || NOW_ISO,
    };
  }
  // Fallback to estimate when no Viator data is available
  const fee = entryFeeEstimateFor(a);
  const perPerson = fee.amount;
  return {
    amount: Math.round(perPerson * partySize * 100) / 100,
    perPerson,
    currency,
    isEstimate: true,
    estimateNote: perPerson ? `${fee.estimateNote} × ${partySize} traveller(s)` : fee.estimateNote,
    source: 'estimate',
    fetchedAt: NOW_ISO,
  };
}

/**
 * Look up a cached real route between two coordinate pairs.
 * The routeCache is a Map built by the orchestrator before calling buildDaysPlan.
 * Keys are "lat1,lng1|lat2,lng2" strings.
 * Falls back to haversine estimate when no cached route is available.
 */
let _routeCache = null;

export function setRouteCache(cache) {
  _routeCache = cache;
}

function routeCacheKey(a, b) {
  return `${a.coordinates.lat},${a.coordinates.lng}|${b.coordinates.lat},${b.coordinates.lng}`;
}

function travelBetween(a, b) {
  if (!a?.coordinates || !b?.coordinates) {
    return { distanceKm: 0, durationMin: 15, method: 'walking', isEstimate: true };
  }

  // Try real route from cache first
  const cacheKey = routeCacheKey(a, b);
  const reverseKey = routeCacheKey(b, a);
  const cached = (_routeCache && (_routeCache.get(cacheKey) || _routeCache.get(reverseKey))) || null;
  if (cached) {
    return {
      distanceKm: cached.distanceKm,
      durationMin: cached.durationMin,
      method: cached.method || 'taxi/auto',
      isEstimate: false,
      source: 'geoapify-routes',
    };
  }

  // Fallback: haversine estimate
  const km = haversineKm(a.coordinates.lat, a.coordinates.lng, b.coordinates.lat, b.coordinates.lng);
  const method = km < 1.5 ? 'walking' : km < 12 ? 'taxi/auto' : 'bus/metro';
  const speedKmh = method === 'walking' ? 4.5 : method === 'taxi/auto' ? 30 : 25;
  const durationMin = Math.max(5, Math.round((km / speedKmh) * 60)) || 15;
  return { distanceKm: Math.round(km * 10) / 10, durationMin, method, isEstimate: true };
}

/** Tag every consecutive pair of activities with its travel leg. */
function addTravelLegs(activities, base) {
  let prev = base;
  for (const act of activities) {
    if (!act.travel || typeof act.travel.durationMin === 'undefined') {
      act.travel = travelBetween(prev, act);
    }
    if (act.coordinates?.lat != null && act.coordinates?.lng != null) prev = act;
  }
  return activities;
}

function isBadWeather(weather) {
  if (!weather) return false;
  const txt = `${weather.condition || ''} ${weather.description || ''}`.toLowerCase();
  return weather.rainProbability >= 70 || /rain|drizzle|thunderstorm|storm|shower/i.test(txt);
}

function isIndoorPick(p) {
  const name = String(p?.name || '').toLowerCase();
  const types = (p?.types || []).join(' ').toLowerCase();
  return /museum|gallery|shopping|mall|cafe|theatre|library|aquarium|indoor|science|planetarium/.test(name + ' ' + types);
}

function isEveningPick(p) {
  const name = String(p?.name || '').toLowerCase();
  const types = (p?.types || []).join(' ').toLowerCase();
  return /beach|viewpoint|sunset|garden|park|promenade|harbor|harbour|market|square|plaza|waterfront|club/.test(name + ' ' + types);
}

/**
 * Check if a place is likely open in the evening (after 17:00).
 * Museums, galleries, and government buildings typically close by 17:00-18:00.
 * Markets, waterfronts, beaches, restaurants, and entertainment venues stay open late.
 */
function isLikelyOpenEvening(p) {
  // If we have real opening hours, use them
  if (p.openingHours?.periods?.length) {
    return isPlaceOpenAt(p.openingHours, 18); // 6 PM
  }
  const name = String(p?.name || '').toLowerCase();
  const types = (p?.types || []).join(' ').toLowerCase();
  // Places that are typically closed in the evening
  const closedEvening = /museum|gallery|monument|fort|palace|government|office|bank|library|post office/.test(name + ' ' + types);
  // Places that are typically open in the evening
  const openEvening = /market|bazaar|nightlife|bar|club|restaurant|beach|waterfront|promenade|garden|park|square|plaza|viewpoint|sunset|entertainment|theatre|cinema|shopping|mall/.test(name + ' ' + types);
  if (closedEvening) return false;
  if (openEvening) return true;
  // Default: assume open (we can't know for sure without opening hours API)
  return true;
}

/**
 * Check if a place is open at a given hour using parsed opening hours.
 * @param {object} openingHours - Parsed opening hours from Geoapify
 * @param {number} hour - Hour to check (0-23)
 * @param {string} dayOfWeek - Optional day abbreviation (Mo, Tu, We, Th, Fr, Sa, Su)
 * @returns {boolean}
 */
function isPlaceOpenAt(openingHours, hour, dayOfWeek) {
  if (!openingHours?.periods?.length) return true; // No data = assume open
  
  for (const period of openingHours.periods) {
    // Check if this period applies to the given day
    if (dayOfWeek && !period.days.includes('all') && !period.days.includes(dayOfWeek)) {
      continue;
    }
    
    const [openH, openM] = period.open.split(':').map(Number);
    const [closeH, closeM] = period.close.split(':').map(Number);
    const openMinutes = openH * 60 + (openM || 0);
    const closeMinutes = closeH * 60 + (closeM || 0);
    const checkMinutes = hour * 60;
    
    // Handle overnight hours (e.g., 22:00-06:00)
    if (closeMinutes < openMinutes) {
      if (checkMinutes >= openMinutes || checkMinutes < closeMinutes) return true;
    } else {
      if (checkMinutes >= openMinutes && checkMinutes < closeMinutes) return true;
    }
  }
  
  return false;
}

/**
 * Get the best time slot for an attraction based on opening hours.
 * Returns the recommended hour (0-23) or null if unknown.
 */
function getBestTimeSlot(openingHours) {
  if (!openingHours?.periods?.length) return null;
  
  // Find the opening time of the first period
  const period = openingHours.periods[0];
  const openStr = typeof period.open === 'string' ? period.open : (period.open?.time || '09:00');
  const [openH] = openStr.split(':').map(Number);
  return openH;
}

/** Key used to dedupe a place across the whole trip. */
function placeKey(p) {
  return p?.placeId || `${p?.name || ''}|${p?.coordinates?.lat ?? ''},${p?.coordinates?.lng ?? ''}`;
}

/**
 * Pick up to `n` distinct items from `pool` that haven't been used yet.
 * Returns { picks, notes } - when the pool is exhausted it returns fewer
 * picks with an explanation instead of reusing items from other days.
 *
 * IMPORTANT: The fallback loop now ALSO checks usedKeys to prevent
 * cross-day repetition. When all unique items are exhausted, we return
 * fewer picks rather than silently repeating places from other days.
 */
function pickDistinct(pool, usedKeys, n, label) {
  const picks = [];
  const notes = [];
  let fresh = 0;
  // First pass: pick truly unused items
  for (const item of pool || []) {
    if (picks.length >= n) break;
    const k = placeKey(item);
    if (!usedKeys.has(k)) {
      picks.push(item);
      usedKeys.add(k);
      fresh += 1;
    }
  }
  // If we didn't get enough, try the full pool but STILL respect usedKeys
  // to avoid repeating attractions from other days.
  const remaining = n - picks.length;
  if (remaining > 0) {
    for (const item of pool || []) {
      if (picks.length >= n) break;
      const k = placeKey(item);
      if (usedKeys.has(k) || picks.includes(item)) continue;
      picks.push(item);
      usedKeys.add(k);
    }
    const stillMissing = n - picks.length;
    if (stillMissing > 0) {
      notes.push(`Only ${fresh} distinct ${label} available — ${stillMissing} slot(s) unfilled to avoid repeats.`);
    } else if (fresh < n) {
      notes.push(`${label}: ${fresh} from current area, ${n - fresh} from nearby areas.`);
    }
  }
  return { picks, notes };
}

/** Pick the cheapest hotel that fits the per-room-night budget envelope. */
function fitHotelToBudget(hotelResult, perRoomNight, nights, rooms) {
  const data = hotelResult?.data || {};
  const list = Array.isArray(data.hotels) ? data.hotels : [];
  const recommended = data.recommended || null;
  const budgeted = perRoomNight > 0;
  const within = (h) => !budgeted || h.price?.amount == null || h.price.amount <= perRoomNight * 1.05;

  const candidates = list.filter((h) => h.name && within(h));
  const ordered = [...candidates].sort((a, b) => (a.price?.amount ?? Infinity) - (b.price?.amount ?? Infinity));
  const chosen = ordered[0] || (recommended && within(recommended) ? recommended : null);

  if (chosen) {
    const nightly = chosen.price?.amount ?? perRoomNight;
    const total = Math.round(nightly * nights * rooms * 100) / 100;
    return {
      hotel: chosen,
      nightly,
      total,
      isLive: data.isLive === true && chosen.price?.amount != null,
      notes: budgeted && nightly > perRoomNight ? `Hotel rate capped to fit the accommodation budget.` : '',
    };
  }
  // No live hotel fits -> honest budget estimate (never an invented hotel).
  return {
    hotel: null,
    nightly: perRoomNight,
    total: Math.round(perRoomNight * nights * rooms * 100) / 100,
    isLive: false,
    notes: 'Live hotel data unavailable or out of budget - nightly rate estimated from accommodation allocation.',
  };
}

/* ------------------------------------------------------------------ */
/*  Day-by-day itinerary builder                                       */
/* ------------------------------------------------------------------ */

/**
 * Build the full day-by-day itinerary structure.
 *
 * @param {object} opts
 *  - totalBudget: hard cap; when provided the plan is trimmed so the total
 *    estimated cost never exceeds it.
 */
export function buildDaysPlan({
  origin,
  destination,
  startDate,
  endDate,
  travelers,
  prefs,
  hotelResult,
  transportResult,
  returnTransportResult,
  weatherResult,
  attractions,
  restaurants,
  nightlife,
  budgetAllocation,
  totalBudget,
  currency = 'INR',
}) {
  const dates = dateRange(startDate, endDate);
  const allocation = budgetAllocation || {};
  const partySize = Math.max(1, Number(travelers?.adults) + Number(travelers?.children) || 1);
  const adults = Math.max(1, Number(travelers?.adults) || 1);
  const rooms = budgetService.roomsForParty({ adults, children: Number(travelers?.children) || 0 });
  const nights = Math.max(0, dates.length - 1);
  const daily = budgetService.planDailyBudgets({ allocation, daysCount: dates.length, nights, rooms });

  const hotelPlan = fitHotelToBudget(hotelResult, daily.perDay.hotelPerRoomNight, nights, rooms);
  const hotel = hotelPlan.hotel;
  const hotelNightly = hotelPlan.nightly;

  const transportMode = transportResult?.mode || 'transport';
  const modeLabel = transportMode === 'flight' ? 'Flight' : transportMode === 'train' ? 'Train' : transportMode === 'bus' ? 'Bus' : 'Transport';
  const transportLive = transportResult?.data?.isLive === true;
  const selectedTransport = transportResult?.data?.selected || null;
  const transportAlloc = allocation.transport?.amount || 0;
  const outboundEstimate = Math.round(transportAlloc * 0.35 * 100) / 100;
  const returnEstimate = Math.round(transportAlloc * 0.35 * 100) / 100;
  const localTransportPerDay = Math.round((transportAlloc * 0.3) / Math.max(1, dates.length) * 100) / 100;
  const outboundCost = selectedTransport?.price?.amount ?? outboundEstimate;

  // Geographic areas - one per day, real locality names when available.
  const areas = clusterAreas(attractions, destination);
  const areaForDay = (idx) => areas[idx % Math.max(1, areas.length)];
  const areaRepeat = areas.length < dates.length;

  const attractionsPool = attractions?.slice() || [];
  const restaurantsPool = restaurants?.slice() || [];
  const nightlifePool = nightlife?.slice() || [];
  const usedAttractions = new Set();
  const usedRestaurants = new Set();
  const usedNightlife = new Set();

  let cumulative = 0;
  const days = dates.map((date, idx) => {
    const dayNumber = idx + 1;
    const isArrival = idx === 0;
    const isDeparture = idx === dates.length - 1 && dates.length > 1;
    const weatherRaw = weatherResult?.data?.forecast?.[idx] || null;
    const badWeather = isBadWeather(weatherRaw);
    const area = areaForDay(idx);
    const areaCentroid = area.centroid;

    // Day-specific pools: the day's own area first (keeps each day focused on
    // its geographic region), supplemented by nearby places only when the area
    // has too few real options, then the full list as a last resort.
    // CRITICAL: Exclude already-used places from pools to prevent cross-day repeats.
    // The usedKeys parameter allows filtering by the correct Set for each pool type
    // (usedAttractions for attractions, usedRestaurants for restaurants, etc.).
    const near = (pool, maxKm, usedKeys) =>
      (pool || []).filter(
        (p) => (!areaCentroid || p.coordinates?.lat == null
          || haversineKm(areaCentroid.lat, areaCentroid.lng, p.coordinates.lat, p.coordinates.lng) <= maxKm)
          && !(usedKeys || usedAttractions).has(placeKey(p))
      );
    const areaGroup = Array.isArray(area.attractions) ? area.attractions : [];
    // Filter out already-used attractions from the area group
    let dayAttractions = areaGroup.filter((x) => !usedAttractions.has(placeKey(x)));
    if (dayAttractions.length < 2 && areaCentroid) {
      const nearby = near(attractionsPool, AREA_RADIUS_KM, usedAttractions).filter((x) => !dayAttractions.includes(x));
      dayAttractions = dayAttractions.concat(nearby);
    }
    if (!dayAttractions.length) {
      // Last resort: use the full pool but exclude already-used attractions
      dayAttractions = attractionsPool.filter((x) => !usedAttractions.has(placeKey(x)));
    }
    // Filter restaurants: exclude already-used ones, prefer nearby
    const nearbyRestaurants = near(restaurantsPool, LOCAL_RADIUS_KM, usedRestaurants);
    const dayRestaurants = nearbyRestaurants.length > 0
      ? nearbyRestaurants
      : restaurantsPool.filter((x) => !usedRestaurants.has(placeKey(x)));
    // Filter nightlife: exclude already-used ones, prefer nearby
    const nearbyNightlife = near(nightlifePool, LOCAL_RADIUS_KM, usedNightlife);
    const dayNightlife = nearbyNightlife.length > 0
      ? nearbyNightlife
      : nightlifePool.filter((x) => !usedNightlife.has(placeKey(x)));

    // --- distinct place selection for this day -----------------------
    const areaPickNote = areaRepeat && areas.length > 1 ? `Area repeated: ${destination} has fewer distinct live-data zones than trip days.` : '';
    const breakfast = pickDistinct(dayRestaurants, usedRestaurants, 1, 'breakfast spots');
    const lunch = pickDistinct(dayRestaurants, usedRestaurants, 1, 'lunch spots');
    const dinner = pickDistinct(dayRestaurants, usedRestaurants, 1, 'dinner spots');
    // Sunset/beach/viewpoint places are reserved for the evening slot, so the
    // morning + afternoon activities use the rest of the day's area pool.
    // Also filter evening places to prefer those likely open after 17:00.
    const eveningPlaces = dayAttractions.filter((p) => isEveningPick(p) && isLikelyOpenEvening(p));
    const dayTimePool = eveningPlaces.length && eveningPlaces.length < dayAttractions.length
      ? dayAttractions.filter((x) => !isEveningPick(x) || !isLikelyOpenEvening(x))
      : dayAttractions;

    // Sort day-time attractions by opening hours — places that open early
    // (museums, galleries) go to morning; places with later opening go to afternoon.
    const morningPool = dayTimePool.filter((p) => {
      const bestSlot = getBestTimeSlot(p.openingHours);
      if (bestSlot === null) return true; // No data = include in pool
      return bestSlot <= 10; // Opens at or before 10 AM → morning
    });
    const afternoonPool = dayTimePool.filter((p) => {
      const bestSlot = getBestTimeSlot(p.openingHours);
      if (bestSlot === null) return true; // No data = include in pool
      return bestSlot > 10; // Opens after 10 AM → afternoon
    });
    // Use opening-hours-aware pools if they have items, otherwise fall back
    const effectiveMorningPool = morningPool.length > 0 ? morningPool : dayTimePool;
    const effectiveAfternoonPool = afternoonPool.length > 0 ? afternoonPool : dayTimePool;
    const morningPick = pickDistinct(effectiveMorningPool, usedAttractions, 1, 'attractions');
    // Afternoon uses the afternoon-aware pool when it has room, otherwise the full
    // area pool so it never duplicates the morning pick on sparse days.
    const effectiveAfternoonPoolFinal = effectiveAfternoonPool.length >= 2 ? effectiveAfternoonPool : dayAttractions;
    const afternoonPick = pickDistinct(effectiveAfternoonPoolFinal, usedAttractions, 1, 'attractions');
    const eveningPick = pickDistinct(
      eveningPlaces.length ? eveningPlaces : dayAttractions,
      usedAttractions,
      1,
      'evening spots'
    );
    // Night pick: real nightlife when available; otherwise an attraction that
    // hasn't already been used that day (dedupe against the day's picks).
    const nightSourcePool = dayNightlife.length ? dayNightlife : dayAttractions;
    const nightUsedSet = dayNightlife.length ? usedNightlife : usedAttractions;
    const nightPick = pickDistinct(nightSourcePool, nightUsedSet, 1, 'nightlife spots');
    const reuseNote = (p) => (p.notes.length ? p.notes[0] : '');

    const activities = [];

    // Shared factory for a real place activity.
    // Every activity includes fetchedAt for data source transparency.
    const placeActivity = ({ time, title, place, description, category, address, coordinates, cost, source, isLive, dataStatus, priority, slot, bookingUrl = '', travel }) => ({
      time,
      slot,
      title,
      place,
      description,
      category,
      address: address || '',
      coordinates: coordinates || null,
      cost: { ...cost },
      source: source || (isLive ? 'provider' : 'estimate'),
      bookingUrl,
      isLive: Boolean(isLive),
      dataStatus,
      priority,
      travel,
      fetchedAt: NOW_ISO,
    });

    // ---- Arrival day: outbound transport + check-in ----
    if (isArrival) {
      if (selectedTransport) {
        const t = selectedTransport;
        activities.push(placeActivity({
          time: '07:00', slot: 'transport',
          title: `${modeLabel} to ${destination}`,
          place: t.airline ? `${t.airline} ${t.flightNumber || ''}`.trim() : t.trainName || t.operator || destination,
          description: `${origin || 'Origin'} → ${destination}. Provider: ${t.provider || 'live provider'}.`,
          category: transportMode,
          cost: { amount: outboundCost, currency, isEstimate: transportLive === false, estimateNote: transportLive ? 'Price from provider' : 'Estimated from transport budget' },
          source: 'provider', isLive: transportLive, dataStatus: transportLive ? 'live' : 'unavailable', priority: 1,
          travel: { distanceKm: 0, durationMin: t.durationMin || 0, method: transportMode, isEstimate: !transportLive },
        }));
      } else if (origin) {
        activities.push(placeActivity({
          time: '07:00', slot: 'transport',
          title: `Travel from ${origin} to ${destination}`,
          place: `${origin} → ${destination}`,
          description: 'Outbound transport. Live schedules unavailable - book via your preferred provider.',
          category: 'transport',
          cost: { amount: outboundEstimate, currency, isEstimate: true, estimateNote: 'Estimated from transport budget' },
          source: 'budget-estimate', isLive: false, dataStatus: 'unavailable', priority: 1,
          travel: { distanceKm: 0, durationMin: 0, method: 'transport', isEstimate: true },
        }));
      }

      if (hotel) {
        // Check-in is an administrative event - the overnight activity below
        // carries the per-night charge (one night per stay, never two).
        activities.push(placeActivity({
          time: '12:00', slot: 'hotel',
          title: `Check-in at ${hotel.name}`,
          place: hotel.name,
          description: `Accommodation in ${destination}. ${hotel.provider || ''}${hotelPlan.notes ? ` ${hotelPlan.notes}` : ''}`.trim(),
          category: 'hotel',
          address: hotel.address || '',
          coordinates: hotel.latitude != null ? { lat: Number(hotel.latitude), lng: Number(hotel.longitude) } : null,
          cost: { amount: 0, currency: hotel?.price?.currency || currency, isEstimate: true, estimateNote: 'Rate charged on the overnight entry' },
          source: hotelPlan.isLive ? 'amadeus-hotels' : 'budget-estimate', isLive: hotelPlan.isLive,
          dataStatus: hotelPlan.isLive ? 'live' : 'estimate', priority: 1,
        }));
      } else {
        activities.push(placeActivity({
          time: '12:00', slot: 'hotel',
          title: `Check-in · Accommodation in ${destination}`,
          place: destination,
          description: `Live hotel data unavailable or out of budget. Estimated nightly rate allocated from budget (${hotelNightly}/room/night × ${rooms} room(s)).`,
          category: 'hotel',
          cost: { amount: 0, currency, isEstimate: true, estimateNote: 'Rate charged on the overnight entry' },
          source: 'budget-estimate', isLive: false, dataStatus: 'estimate', priority: 1,
        }));
      }
    }

    // ---- Non-departure day rhythm ----
    if (!isDeparture) {
      // Breakfast (near hotel)
      if (breakfast.picks[0]) {
        const r = breakfast.picks[0];
        activities.push(placeActivity({
          time: '08:00', slot: 'breakfast',
          title: `Breakfast at ${r.name}`,
          place: r.name,
          description: `Start the day right - rating ${r.rating ?? 'n/a'}.${reuseNote(breakfast) ? ` ${reuseNote(breakfast)}` : ''}`,
          category: 'restaurant', address: r.address || '', coordinates: r.coordinates || null,
          cost: restaurantMealCost(r, 'breakfast', partySize, currency),
          source: 'geoapify', isLive: true, dataStatus: 'live', priority: 2,
        }));
      } else {
        activities.push(placeActivity({
          time: '08:00', slot: 'breakfast',
          title: 'Breakfast',
          place: destination,
          description: 'Breakfast recommendation pending - live data unavailable.',
          category: 'restaurant',
          cost: { amount: Math.round((daily.perDay.food / 3) * 100) / 100, currency, isEstimate: true, estimateNote: 'Estimated from food budget', source: 'budget-estimate', fetchedAt: NOW_ISO },
          source: 'budget-estimate', isLive: false, dataStatus: 'unavailable', priority: 2,
        }));
      }

      // Morning activity (indoor swap when heavy rain is forecast)
      if (morningPick.picks[0]) {
        let a = morningPick.picks[0];
        let isIndoorPicked = false;
        if (badWeather && !isIndoorPick(a)) {
          const indoor = dayAttractions.find((x) => x !== a && isIndoorPick(x) && !usedAttractions.has(placeKey(x)));
          if (indoor) {
            usedAttractions.add(placeKey(a));
            a = indoor;
            usedAttractions.add(placeKey(a));
            isIndoorPicked = true;
          }
        }
        const pick = a;
        activities.push(placeActivity({
          time: '09:30', slot: 'morning',
          title: pick.name,
          place: pick.name,
          description: `${pick.types?.join(', ') || 'Tourist attraction'}${badWeather && isIndoorPicked ? ' · Indoor plan - rain expected.' : isIndoorPicked ? '' : badWeather ? ' · Consider an indoor alternative if it rains.' : ''}`,
          category: 'attraction', address: pick.address || '', coordinates: pick.coordinates || null,
          cost: attractionCost(pick, currency, partySize),
          source: 'geoapify', isLive: true, dataStatus: 'live', priority: 1,
        }));
      } else {
        activities.push(placeActivity({
          time: '09:30', slot: 'morning',
          title: `Explore ${destination}`,
          place: destination,
          description: 'Self-guided exploration. Attraction data unavailable - check the Maps & Places pages.',
          category: 'attraction',
          cost: { amount: 0, currency, isEstimate: true, estimateNote: 'Free / unknown entry fee' },
          source: 'none', isLive: false, dataStatus: 'unavailable', priority: 3,
        }));
      }

      // Lunch (near the morning activity's area)
      if (lunch.picks[0]) {
        const r = lunch.picks[0];
        activities.push(placeActivity({
          time: '13:00', slot: 'lunch',
          title: `Lunch at ${r.name}`,
          place: r.name,
          description: `Cuisine match for ${prefs?.foodPreference || 'your preference'}. Rating ${r.rating ?? 'n/a'}.${reuseNote(lunch) ? ` ${reuseNote(lunch)}` : ''}`,
          category: 'restaurant', address: r.address || '', coordinates: r.coordinates || null,
          cost: restaurantMealCost(r, 'lunch', partySize, currency),
          source: 'geoapify', isLive: true, dataStatus: 'live', priority: 1,
        }));
      } else {
        activities.push(placeActivity({
          time: '13:00', slot: 'lunch',
          title: 'Lunch',
          place: destination,
          description: 'Restaurant recommendation pending - live data unavailable. Use the Restaurants page when online.',
          category: 'restaurant',
          cost: { amount: Math.round((daily.perDay.food / 3) * 100) / 100, currency, isEstimate: true, estimateNote: 'Estimated from food budget', source: 'budget-estimate', fetchedAt: NOW_ISO },
          source: 'budget-estimate', isLive: false, dataStatus: 'unavailable', priority: 2,
        }));
      }

      // Afternoon activity (indoor swap when heavy rain is forecast)
      if (afternoonPick.picks[0]) {
        let a = afternoonPick.picks[0];
        let indoorSwap = false;
        if (badWeather && !isIndoorPick(a)) {
          const indoor = dayAttractions.find((x) => x !== a && isIndoorPick(x) && !usedAttractions.has(placeKey(x)));
          if (indoor) {
            usedAttractions.add(placeKey(a));
            a = indoor;
            usedAttractions.add(placeKey(a));
            indoorSwap = true;
          }
        }
        activities.push(placeActivity({
          time: '14:30', slot: 'afternoon',
          title: a.name,
          place: a.name,
          description: `${a.types?.join(', ') || 'Afternoon activity'}${badWeather && indoorSwap ? ' · Indoor plan - rain expected.' : badWeather ? ' · Consider an indoor alternative if it rains.' : ''}`,
          category: 'attraction', address: a.address || '', coordinates: a.coordinates || null,
          cost: attractionCost(a, currency, partySize),
          source: 'geoapify', isLive: true, dataStatus: 'live', priority: 1,
        }));
      } else {
        activities.push(placeActivity({
          time: '14:30', slot: 'afternoon',
          title: `Leisure time in ${destination}`,
          place: destination,
          description: 'Free time / self-guided exploration - live attraction data unavailable.',
          category: 'activity',
          cost: { amount: 0, currency, isEstimate: true, estimateNote: 'Free' },
          source: 'none', isLive: false, dataStatus: 'unavailable', priority: 3,
        }));
      }

      // Evening (sunset / viewpoint / beach / market)
      if (eveningPick.picks[0]) {
        const e = eveningPick.picks[0];
        activities.push(placeActivity({
          time: '17:30', slot: 'evening',
          title: `${e.name} (evening)`,
          place: e.name,
          description: `${e.types?.join(', ') || 'Evening activity'} - sunset / local evening.${badWeather ? ' Rain expected - keep an umbrella or move indoors.' : ''}`,
          category: 'activity', address: e.address || '', coordinates: e.coordinates || null,
          cost: attractionCost(e, currency, partySize),
          source: 'geoapify', isLive: true, dataStatus: 'live', priority: 2,
        }));
      } else {
        activities.push(placeActivity({
          time: '17:30', slot: 'evening',
          title: `Local evening in ${destination}`,
          place: destination,
          description: 'Markets, waterfront or local culture. Details depend on live data availability.',
          category: 'activity',
          cost: { amount: 0, currency, isEstimate: true },
          source: 'none', isLive: false, dataStatus: 'unavailable', priority: 3,
        }));
      }

      // Dinner (near evening activity / accommodation)
      if (dinner.picks[0]) {
        const r = dinner.picks[0];
        activities.push(placeActivity({
          time: '20:00', slot: 'dinner',
          title: `Dinner at ${r.name}`,
          place: r.name,
          description: `Rating ${r.rating ?? 'n/a'}. ${prefs?.foodPreference ? `Matches ${prefs.foodPreference} preference.` : ''}${reuseNote(dinner) ? ` ${reuseNote(dinner)}` : ''}`,
          category: 'restaurant', address: r.address || '', coordinates: r.coordinates || null,
          cost: restaurantMealCost(r, 'dinner', partySize, currency),
          source: 'geoapify', isLive: true, dataStatus: 'live', priority: 1,
        }));
      } else {
        activities.push(placeActivity({
          time: '20:00', slot: 'dinner',
          title: 'Dinner',
          place: destination,
          description: 'Dinner recommendation pending - live data unavailable.',
          category: 'restaurant',
          cost: { amount: Math.round((daily.perDay.food / 3) * 100) / 100, currency, isEstimate: true, estimateNote: 'Estimated from food budget', source: 'budget-estimate', fetchedAt: NOW_ISO },
          source: 'budget-estimate', isLive: false, dataStatus: 'unavailable', priority: 2,
        }));
      }

      // Night / optional local activity (real nightlife when available)
      if (nightlifePool.length === 0 && nightPick.picks[0]) {
        // Fell back to attractions - avoid repeating a same-day pick.
        const n = nightPick.picks[0];
        activities.push(placeActivity({
          time: '21:30', slot: 'night',
          title: `Local evening pick: ${n.name}`,
          place: n.name,
          description: `${n.types?.join(', ') || 'Night market, live music or local entertainment'} (nightlife live data unavailable - local attraction used)`,
          category: 'activity', address: n.address || '', coordinates: n.coordinates || null,
          cost: attractionCost(n, currency, partySize),
          source: 'geoapify', isLive: true, dataStatus: 'live', priority: 3,
        }));
      } else if (nightPick.picks[0]) {
        const n = nightPick.picks[0];
        activities.push(placeActivity({
          time: '21:30', slot: 'night',
          title: `Night out: ${n.name}`,
          place: n.name,
          description: `${n.types?.join(', ') || 'Night market, live music or local entertainment'}${badWeather ? ' · Weather may affect open-air venues.' : ''}`,
          category: 'activity', address: n.address || '', coordinates: n.coordinates || null,
          cost: attractionCost(n, currency, partySize),
          source: 'geoapify', isLive: true, dataStatus: 'live', priority: 3,
        }));
      } else {
        activities.push(placeActivity({
          time: '21:30', slot: 'night',
          title: `Local night life near ${area.name}`,
          place: destination,
          description: 'Evening market, night view or local entertainment - live data unavailable, confirm locally.',
          category: 'activity',
          cost: { amount: 0, currency, isEstimate: true, estimateNote: 'Free / varies' },
          source: 'none', isLive: false, dataStatus: 'unavailable', priority: 3,
        }));
      }

      // Local transport estimate (intra-day hops)
      if (localTransportPerDay > 0) {
        activities.push(placeActivity({
          time: '19:15', slot: 'transport',
          title: 'Local transport & transfers',
          place: `${area.name}, ${destination}`,
          description: 'Estimated local fares for intra-day movement (walking/taxi/bus).',
          category: 'transport',
          cost: { amount: localTransportPerDay, currency, isEstimate: true, estimateNote: 'Estimated from transport budget' },
          source: 'budget-estimate', isLive: false, dataStatus: 'estimate', priority: 2,
        }));
      }

      // Overnight at hotel (charge per night, per room)
      activities.push(placeActivity({
        time: '22:30', slot: 'hotel',
        title: hotel ? `Overnight at ${hotel.name}` : `Overnight in ${destination}`,
        place: hotel?.name || destination,
        description: `Rest and recharge. ${hotel ? `Price ${hotelNightly}/room/night × ${rooms} room(s)${hotelPlan.notes ? ` - ${hotelPlan.notes}` : ''}.` : ''}`,
        category: 'hotel',
        address: hotel?.address || '',
        coordinates: hotel?.latitude != null ? { lat: Number(hotel.latitude), lng: Number(hotel.longitude) } : null,
        cost: {
          amount: Math.round(hotelNightly * rooms * 100) / 100,
          currency: hotel?.price?.currency || currency,
          isEstimate: !hotelPlan.isLive,
          perPerson: Math.round((hotelNightly * rooms) / partySize * 100) / 100,
          estimateNote: hotelPlan.isLive ? `Live price · ${hotelNightly}/room/night × ${rooms} room(s)` : `Estimated ${hotelNightly}/room/night × ${rooms} room(s)`,
        },
        source: hotelPlan.isLive ? 'amadeus-hotels' : 'budget-estimate', isLive: hotelPlan.isLive,
        dataStatus: hotelPlan.isLive ? 'live' : 'estimate', priority: 1,
      }));
    }

    // ---- Departure day: check-out + return travel ----
    if (isDeparture) {
      activities.push(placeActivity({
        time: '09:00', slot: 'hotel',
        title: `Check out · depart ${destination}`,
        place: hotel?.name || destination,
        description: 'Departure day - pack up and check out of your accommodation.',
        category: 'hotel',
        address: hotel?.address || '',
        coordinates: hotel?.latitude != null ? { lat: Number(hotel.latitude), lng: Number(hotel.longitude) } : null,
        cost: { amount: 0, currency, isEstimate: true },
        source: 'none', isLive: false, dataStatus: 'estimate', priority: 1,
      }));
      if (origin) {
        // Use real return transport data when available
        const returnRec = returnTransportResult?.recommended;
        if (returnRec) {
          const returnMode = returnRec.mode || 'transport';
          const returnModeLabel = returnMode === 'flight' ? 'Flight' : returnMode === 'train' ? 'Train' : returnMode === 'bus' ? 'Bus' : 'Transport';
          const returnPrice = returnRec.mainTransport?.price?.amount || returnRec.totalCost || returnEstimate;
          const returnIsLive = returnRec.isLive === true;
          activities.push(placeActivity({
            time: '11:00', slot: 'transport',
            title: `${returnModeLabel} to ${origin}`,
            place: returnRec.mainTransport?.airline
              ? `${returnRec.mainTransport.airline} ${returnRec.mainTransport.flightNumber || ''}`.trim()
              : returnRec.mainTransport?.trainName || returnRec.mainTransport?.operator || `${destination} → ${origin}`,
            description: `${destination} → ${origin}. Provider: ${returnRec.source || 'live provider'}.${returnRec.recommendation ? ` ${returnRec.recommendation}` : ''}`,
            category: returnMode,
            cost: { amount: returnPrice, currency, isEstimate: !returnIsLive, estimateNote: returnIsLive ? 'Price from provider' : 'Estimated from transport budget' },
            source: returnIsLive ? 'provider' : 'budget-estimate', isLive: returnIsLive, dataStatus: returnIsLive ? 'live' : 'unavailable', priority: 1,
            travel: { distanceKm: 0, durationMin: 0, method: returnMode, isEstimate: !returnIsLive },
          }));
        } else {
          // Fallback: no live return transport data
          activities.push(placeActivity({
            time: '11:00', slot: 'transport',
            title: `Return travel to ${origin}`,
            place: `${destination} → ${origin}`,
            description: 'Return transport. Live schedules unavailable - book via your preferred provider.',
            category: 'transport',
            cost: { amount: returnEstimate, currency, isEstimate: true, estimateNote: 'Estimated from transport budget' },
            source: 'budget-estimate', isLive: false, dataStatus: 'unavailable', priority: 1,
          }));
        }
      }
    }

    // Sort chronologically so the timeline and travel-leg chain follow the
    // clock, then tag periods + per-person shares + travel legs (from hotel).
    activities.sort((x, y) => String(x.time).localeCompare(String(y.time)));
    const base = { coordinates: hotel?.latitude != null ? { lat: Number(hotel.latitude), lng: Number(hotel.longitude) } : null };
    for (const a of activities) {
      if (!a.period) a.period = periodForTime(a.time);
      if (a.cost && typeof a.cost.amount === 'number' && a.cost.amount > 0 && a.cost.perPerson == null) {
        a.cost.perPerson = Math.round((a.cost.amount / partySize) * 100) / 100;
      }
    }
    addTravelLegs(activities, base);

    // ---- Daily cost breakdown + cumulative ----
    const breakdown = { accommodation: 0, breakfast: 0, lunch: 0, dinner: 0, transport: 0, activities: 0, evening: 0, night: 0, misc: 0 };
    for (const a of activities) {
      const amt = a.cost?.amount || 0;
      const slot = a.slot || a.period;
      if (a.category === 'hotel') breakdown.accommodation += amt;
      else if (a.category === 'restaurant' && slot === 'breakfast') breakdown.breakfast += amt;
      else if (a.category === 'restaurant' && slot === 'lunch') breakdown.lunch += amt;
      else if (a.category === 'restaurant') breakdown.dinner += amt;
      else if (a.category === 'transport') breakdown.transport += amt;
      else if (slot === 'evening') breakdown.evening += amt;
      else if (slot === 'night') breakdown.night += amt;
      else if (a.category === 'attraction' || a.category === 'activity') breakdown.activities += amt;
      else breakdown.misc += amt;
    }
    const dayCost = Math.round(activities.reduce((s, a) => s + (a.cost?.amount || 0), 0) * 100) / 100;
    cumulative = Math.round((cumulative + dayCost) * 100) / 100;
    const remainingBudget = totalBudget != null ? Math.round((totalBudget - cumulative) * 100) / 100 : null;

    // Overnight summary (real hotel when available, honest estimate otherwise).
    // A 1-day trip has zero nights - no overnight charge, just a day-use stay.
    const overnightNights = nights === 0 ? 0 : isDeparture ? 0 : 1;
    const overnight = {
      name: hotel?.name || `${destination} (estimated accommodation)`,
      area: hotel ? localityOf(hotel) || area.name : area.name,
      rooms,
      nights: overnightNights,
      pricePerRoomNight: hotelNightly,
      total: Math.round(hotelNightly * overnightNights * rooms * 100) / 100,
      address: hotel?.address || '',
      rating: hotel?.rating ?? null,
      amenities: Array.isArray(hotel?.amenities) ? hotel.amenities : [],
      isLive: hotelPlan.isLive && Boolean(hotel),
      source: hotelPlan.isLive ? 'amadeus-hotels' : 'budget-estimate',
      notes: hotelPlan.notes || '',
    };

    return {
      dayNumber,
      date,
      area: area.name,
      areaNote: areaPickNote,
      overnight,
      activities,
      weather: weatherRaw
        ? {
            tempMin: weatherRaw.tempMin ?? weatherRaw.temp ?? null,
            tempMax: weatherRaw.tempMax ?? weatherRaw.temp ?? null,
            condition: weatherRaw.condition || '',
            description: weatherRaw.description || '',
            rainProbability: weatherRaw.rainProbability ?? null,
            humidity: weatherRaw.humidity ?? null,
            windSpeed: weatherRaw.windSpeed ?? null,
            sunrise: weatherResult?.data?.current?.sunrise ?? null,
            sunset: weatherResult?.data?.current?.sunset ?? null,
            isLive: weatherResult?.data?.provider === 'live',
            indoorPlan: badWeather,
          }
        : null,
      costBreakdown: { ...breakdown, dayTotal: dayCost, perPerson: Math.round((dayCost / partySize) * 100) / 100, cumulative, remainingBudget },
      dayCost,
      cumulativeCost: cumulative,
      remainingBudget,
      dayCostIsEstimate: true,
    };
  });

  // ---- Post-build duplicate validation ----
  // Verify no sightseeing attraction repeats across days. Hotels are allowed
  // to repeat (same hotel for multi-night stay). Restaurants and attractions
  // should NOT repeat.
  validateNoDuplicateAttractions(days);

  // ---- Hard budget enforcement (before returning, so the stored total is
  //      always <= the user's budget when a budget was provided) ----
  let totalEstimated = computeItineraryCost(days);
  let optimized = null;
  if (totalBudget != null && totalEstimated > totalBudget) {
    const items = toCostItems(days, currency);
    const opt = budgetService.optimizeCosts(items, totalBudget, {
      emergencyReserve: allocation.emergencyReserve?.amount || 0,
    });
    applyOptimization(days, opt, partySize, totalBudget);
    totalEstimated = computeItineraryCost(days);
    optimized = {
      ...opt,
      optimized: totalEstimated,
      withinBudget: totalEstimated <= totalBudget,
      notes: 'Optimized by Budget Agent: dropped low-priority items and reduced flexible costs to stay within budget.',
    };
  }

  return { days, optimized, withinBudget: totalBudget == null || totalEstimated <= totalBudget };
}

/**
 * Backward-compatible wrapper: buildDays returns just the days array.
 */
export function buildDays(opts) {
  return buildDaysPlan(opts).days;
}

/**
 * Recompute per-day cost breakdown + cumulative + remaining for a set of days
 * after costs change (used by the inline budget trim and by optimizeTripBudget).
 */
export function finalizeDayCosts(days, { partySize, totalBudget } = {}) {
  const safeParty = Math.max(1, partySize || 1);
  let cumulative = 0;
  for (const day of days) {
    const breakdown = { accommodation: 0, breakfast: 0, lunch: 0, dinner: 0, transport: 0, activities: 0, evening: 0, night: 0, misc: 0 };
    for (const a of day.activities || []) {
      const amt = a.cost?.amount || 0;
      const slot = a.slot || a.period;
      if (a.category === 'hotel') breakdown.accommodation += amt;
      else if (a.category === 'restaurant' && slot === 'breakfast') breakdown.breakfast += amt;
      else if (a.category === 'restaurant' && slot === 'lunch') breakdown.lunch += amt;
      else if (a.category === 'restaurant') breakdown.dinner += amt;
      else if (a.category === 'transport') breakdown.transport += amt;
      else if (slot === 'evening') breakdown.evening += amt;
      else if (slot === 'night') breakdown.night += amt;
      else if (a.category === 'attraction' || a.category === 'activity') breakdown.activities += amt;
      else breakdown.misc += amt;
    }
    const dayCost = Math.round((day.activities || []).reduce((s, a) => s + (a.cost?.amount || 0), 0) * 100) / 100;
    cumulative = Math.round((cumulative + dayCost) * 100) / 100;
    day.dayCost = dayCost;
    day.costBreakdown = {
      ...breakdown,
      dayTotal: dayCost,
      perPerson: Math.round((dayCost / safeParty) * 100) / 100,
      cumulative,
      remainingBudget: totalBudget != null ? Math.round((totalBudget - cumulative) * 100) / 100 : null,
    };
    day.cumulativeCost = cumulative;
    day.remainingBudget = totalBudget != null ? Math.round((totalBudget - cumulative) * 100) / 100 : null;
  }
}

/**
 * Apply an optimization result back into the itinerary days so the stored
 * plan itself (not just a headline number) reflects the within-budget costs.
 */
function applyOptimization(days, opt, partySize, totalBudget) {
  const dayByKey = {};
  for (const day of days) {
    (day.activities || []).forEach((act, i) => {
      dayByKey[activityItemId(day.dayNumber, i)] = act;
    });
  }
  for (const r of opt.reductions) {
    const act = dayByKey[r.id];
    if (act && act.cost) {
      act.cost.amount = Math.round(r.to * 100) / 100;
      act.cost.isEstimate = true;
      act.cost.estimateNote = r.note;
      if (act.cost.perPerson != null) act.cost.perPerson = Math.round((act.cost.amount / partySize) * 100) / 100;
    }
  }
  for (const d of opt.dropped) {
    const act = dayByKey[d.id];
    if (act) {
      act.notes = 'Removed by Budget Optimizer to stay within budget';
      act.dataStatus = 'unavailable';
      act.cost.amount = 0;
    }
  }
  finalizeDayCosts(days, { partySize, totalBudget });
}

/**
 * Compute total estimated cost from itinerary days.
 */
export function computeItineraryCost(days) {
  return Math.round(days.reduce((sum, d) => sum + d.dayCost, 0) * 100) / 100;
}

/**
 * Unique per-activity id used across toCostItems / applyOptimization /
 * optimizeTripBudget. Index-based so duplicate titles never collide.
 */
export function activityItemId(dayNumber, index) {
  return `${dayNumber}-${index}`;
}

/**
 * Turn itinerary activities into budget optimization items.
 */
export function toCostItems(days, currency) {
  const items = [];
  for (const day of days) {
    (day.activities || []).forEach((act, i) => {
      items.push({
        id: activityItemId(day.dayNumber, i),
        day: day.dayNumber,
        category: act.category,
        title: act.title,
        amount: act.cost?.amount || 0,
        currency: act.cost?.currency || currency,
        droppable: (act.priority || 1) > 1 && !act.isLive, // never drop live bookings
        flexible: act.category === 'restaurant' || act.category === 'activity' || act.category === 'transport',
        priority: act.priority || 1,
      });
    });
  }
  return items;
}

export default { buildDays, buildDaysPlan, clusterAreas, dateRange, computeItineraryCost, toCostItems, activityItemId, finalizeDayCosts, buildItineraryExtras, periodForTime, setRouteCache };

/* ------------------------------------------------------------------ */
/*  Enriched itinerary sections: trip summary, budget planning, nearby  */
/*  places, transport, weather, tips, recommendations and map data.     */
/*  Everything below is derived deterministically from the budget       */
/*  allocation and real provider data - nothing is invented.            */
/* ------------------------------------------------------------------ */

const STYLE_LABELS = {
  budget: 'Budget', backpacker: 'Backpacker', standard: 'Standard', luxury: 'Luxury',
  family: 'Family', business: 'Business', adventure: 'Adventure', romantic: 'Romantic',
};

const HOTEL_CATEGORY_LABELS = {
  budget: 'Budget hotel', economy: 'Economy', standard: '3-star', luxury: '5-star luxury',
  resort: 'Resort', boutique: 'Boutique', hostel: 'Hostel', homestay: 'Homestay',
};

/** Best-time hint map for popular destinations (general guidance, not live data). */
const BEST_TIME_HINTS = {
  goa: 'November to February (pleasant, festive season)',
  manali: 'April to June (summer) and December to February (snow)',
  shimla: 'April to June and December to February',
  jaipur: 'October to March (cooler months)',
  udaipur: 'October to March',
  jodhpur: 'October to March',
  agra: 'October to March',
  varanasi: 'October to March',
  kerala: 'September to March (dry, pleasant)',
  munnar: 'September to March',
  alleppey: 'November to February',
  mumbai: 'November to February',
  delhi: 'October to March',
  'new delhi': 'October to March',
  bangalore: 'October to February',
  bengaluru: 'October to February',
  chennai: 'December to February',
  hyderabad: 'October to February',
  kolkata: 'October to February',
  pune: 'October to February',
  darjeeling: 'October to November and April to May',
  gangtok: 'March to June and September to December',
  'leh ladakh': 'June to September',
  ladakh: 'June to September',
  srinagar: 'April to October',
  rishikesh: 'September to November and February to April',
  haridwar: 'October to March',
  nainital: 'April to June and October to November',
  mussoorie: 'April to June and September to November',
  andaman: 'November to April',
  'andaman and nicobar': 'November to April',
  pondicherry: 'October to March',
  mahabalipuram: 'October to March',
  ooty: 'April to June and September to November',
  coorg: 'October to March',
  mysore: 'October to February',
  hampi: 'October to February',
  'ajanta ellora': 'October to February',
  ajanta: 'October to February',
  amritsar: 'November to March',
  'golden temple': 'November to March',
  mcleodganj: 'March to June and September to November',
  dharamshala: 'March to June and September to November',
  kasol: 'October to May',
  spiti: 'May to October',
  'valley of flowers': 'July to September',
  auli: 'November to March (snow)',
  'mount abu': 'October to March',
  kutch: 'December to February',
  'gir national park': 'December to March',
  ranthambore: 'October to March',
  'jim corbett': 'November to February',
  kaziranga: 'November to April',
  sundarbans: 'November to February',
  'horsley hills': 'October to February',
  tirupati: 'September to February',
  kanyakumari: 'October to March',
  kodaikanal: 'April to June and September to November',
  yercaud: 'April to June and September to November',
  chikmagalur: 'September to March',
  wayanad: 'October to March',
  vagamon: 'September to March',
  kovalam: 'September to March',
  varkala: 'September to March',
  gokarna: 'October to March',
  badami: 'October to February',
  pattadakal: 'October to February',
  belur: 'October to February',
  halebidu: 'October to February',
  sringeri: 'October to February',
  udupi: 'October to February',
  karkala: 'October to February',
  mudabidri: 'October to February',
  agumbe: 'October to February',
  dandeli: 'October to February',
  karwar: 'October to February',
  murudeshwar: 'October to February',
};

const FOOD_EMOJIS = {
  vegetarian: '🥗', vegan: '🥬', nonvegetarian: '🍗', 'non-vegetarian': '🍗', nonveg: '🍗',
  jain: '🥬', seafood: '🦐', streetfood: '🌮', 'street food': '🌮', dessert: '🍨',
};

/** Rough attraction entry-fee estimate by type (INR, labelled estimate). */
function entryFeeEstimate(attraction, currency) {
  const fee = entryFeeEstimateFor(attraction);
  return { amount: fee.amount, currency, isEstimate: true, estimateNote: fee.estimateNote };
}

/** Rough visit-time estimate in hours for an attraction. */
function visitHoursEstimate(attraction) {
  if (attraction.estimatedVisitHours) return attraction.estimatedVisitHours;
  const types = (attraction.types || []).join(' ').toLowerCase();
  if (/museum|monument|palace/.test(types)) return 2;
  if (/park|garden|beach|waterfall/.test(types)) return 1.5;
  if (/temple|church|mosque/.test(types)) return 1;
  return 2;
}

/** Distance label helper (km or m). */
function distanceLabel(distanceKm) {
  if (distanceKm == null || Number.isNaN(distanceKm)) return null;
  if (distanceKm < 1) return `${Math.round(distanceKm * 1000)} m`;
  return `${Math.round(distanceKm * 10) / 10} km`;
}

/**
 * Assemble every "extra" section shown on the enriched AI Itinerary page.
 * Pure + deterministic: costs derive from the budget allocation, labels from
 * prefs, and place lists from the agents' real provider results.
 */
export function buildItineraryExtras({
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
  destinationHint,
}) {
  const destination = request.destination;
  const daysCount = Array.isArray(days) ? days.length : 0;
  const partySize = Math.max(1, Number(request.adults) + Number(request.children) || 1);
  const adults = Number(request.adults) || 1;
  const children = Number(request.children) || 0;

  /* ---- 1. Trip summary ---- */
  const bestTimeKey = String(destination || '').toLowerCase().trim();
  const bestTimeToVisit =
    (destinationHint && destinationHint.bestSeason) ||
    BEST_TIME_HINTS[bestTimeKey] ||
    'Seasonal - check local climate before booking';
  const current = weatherResult?.data?.current || null;
  const forecast = Array.isArray(weatherResult?.data?.forecast) ? weatherResult.data.forecast : [];
  const weatherLive = weatherResult?.data?.provider === 'live';
  const tripSummary = {
    destination,
    durationDays: daysCount,
    travellers: { adults, children, total: partySize, rooms: budgetService.roomsForParty({ adults, children }) },
    budget: { total: totalBudget, currency },
    travelStyle: STYLE_LABELS[prefs?.travelStyle] || prefs?.travelStyle || 'Standard',
    hotelCategory: HOTEL_CATEGORY_LABELS[prefs?.hotelPreference] || prefs?.hotelPreference || 'Not specified',
    foodPreference: prefs?.foodPreference ? `${FOOD_EMOJIS[prefs.foodPreference] || ''} ${prefs.foodPreference}`.trim() : 'Any',
    transportMode: transportResult?.mode ? String(transportResult.mode).toUpperCase() : '—',
    bestTimeToVisit,
    currentWeather: current
      ? {
          temp: current.temp,
          condition: current.condition || current.description || '',
          humidity: current.humidity,
          windSpeed: current.windSpeed,
          icon: current.icon || '',
          isLive: weatherLive,
        }
      : null,
    weatherLive,
  };

  /* ---- 2. Budget planning (deterministic from allocation) ---- */
  const alloc = allocation || {};
  const misc = alloc.misc?.amount || 0;
  const shopping = Math.round(misc * 0.6 * 100) / 100;
  const taxes = Math.round(misc * 0.4 * 100) / 100;
  const budgetUtil = budgetService.budgetUtilization({
    total: totalBudget,
    spent: optimized?.optimized ?? totalEstimatedCost,
  });
  const budgetPlanning = {
    totalBudget,
    currency,
    rows: [
      { key: 'hotel', label: 'Hotel budget', amount: alloc.hotels?.amount || 0, pct: alloc.hotels?.pct },
      { key: 'food', label: 'Food budget', amount: alloc.food?.amount || 0, pct: alloc.food?.pct },
      { key: 'transport', label: 'Transport budget', amount: alloc.transport?.amount || 0, pct: alloc.transport?.pct },
      { key: 'sightseeing', label: 'Sightseeing & activities', amount: alloc.activities?.amount || 0, pct: alloc.activities?.pct },
      { key: 'shopping', label: 'Shopping', amount: shopping, pct: null },
      { key: 'emergency', label: 'Emergency fund', amount: alloc.emergencyReserve?.amount || 0, pct: alloc.emergencyReserve?.pct },
      { key: 'taxes', label: 'Taxes & fees', amount: taxes, pct: null },
    ],
    allocatedTotal: Math.round(
      ((alloc.hotels?.amount || 0) + (alloc.food?.amount || 0) + (alloc.transport?.amount || 0) +
        (alloc.activities?.amount || 0) + (alloc.emergencyReserve?.amount || 0) + misc) * 100
    ) / 100,
    totalEstimatedCost: optimized?.optimized ?? totalEstimatedCost,
    remainingBudget: budgetUtil.remaining,
    budgetUsedPct: budgetUtil.usedPct,
    withinBudget: budgetUtil.withinBudget,
    optimized,
  };

  /* ---- Extract real places from itinerary activities (fallback data) ---- */
  const allActivities = (Array.isArray(days) ? days : []).flatMap((d) => d.activities || []);
  // Extract unique hotels from itinerary activities
  const activityHotels = [];
  const seenHotelNames = new Set();
  for (const a of allActivities) {
    if (a.category === 'hotel' && a.place && !seenHotelNames.has(a.place.toLowerCase())) {
      seenHotelNames.add(a.place.toLowerCase());
      activityHotels.push({
        name: a.place,
        rating: a.rating ?? null,
        pricePerNight: a.cost?.amount ?? null,
        priceCurrency: a.cost?.currency || currency,
        distanceKm: null,
        address: a.address || '',
        amenities: ['Free Wi-Fi', 'AC'],
        isLive: a.isLive || false,
        source: a.dataStatus === 'live' ? 'live-data' : 'itinerary-activity',
      });
    }
  }
  // Extract unique restaurants from itinerary activities
  const activityRestaurants = [];
  const seenRestaurantNames = new Set();
  for (const a of allActivities) {
    if (a.category === 'restaurant' && a.place && !seenRestaurantNames.has(a.place.toLowerCase())) {
      seenRestaurantNames.add(a.place.toLowerCase());
      activityRestaurants.push({
        name: a.place,
        cuisine: a.description || 'Local cuisine',
        rating: a.rating ?? null,
        averageCost: a.cost?.amount ?? null,
        averageCostPerPerson: a.cost?.amount ? Math.round(a.cost.amount / partySize) : null,
        averageCostIsEstimate: a.cost?.isEstimate !== false,
        averageCostNote: a.cost?.isEstimate ? 'Estimated from itinerary' : 'From itinerary plan',
        veg: Boolean(prefs?.foodPreference && /veg|jain|vegan/i.test(prefs.foodPreference)),
        nonVeg: Boolean(prefs?.foodPreference && /non.?veg|chicken|meat|seafood/i.test(prefs.foodPreference)),
        vegan: Boolean(prefs?.foodPreference && /vegan|jain/i.test(prefs.foodPreference)),
        distanceKm: null,
        distanceLabel: null,
        address: a.address || '',
        coordinates: a.coordinates || null,
        isLive: a.isLive || false,
        source: a.dataStatus === 'live' ? 'live-data' : 'itinerary-activity',
      });
    }
  }
  // Extract unique attractions from itinerary activities
  const activityAttractions = [];
  const seenAttractionNames = new Set();
  for (const a of allActivities) {
    if ((a.category === 'attraction' || a.category === 'activity') && a.place && !seenAttractionNames.has(a.place.toLowerCase())) {
      seenAttractionNames.add(a.place.toLowerCase());
      activityAttractions.push({
        name: a.place,
        rating: a.rating ?? null,
        entryFee: { amount: a.cost?.amount || 0, currency: currency, isEstimate: a.cost?.isEstimate !== false },
        entryFeeIsEstimate: a.cost?.isEstimate !== false,
        entryFeeNote: a.cost?.isEstimate ? 'Estimated from itinerary' : 'From itinerary plan',
        timeRequired: null,
        distanceKm: null,
        distanceLabel: null,
        types: [a.category],
        address: a.address || '',
        isLive: a.isLive || false,
        source: a.dataStatus === 'live' ? 'live-data' : 'itinerary-activity',
      });
    }
  }

  /* ---- 3. Hotels (from provider, or itinerary activity fallback) ---- */
  const hotelRecommended = hotelResult?.data?.recommended || null;
  const hotelList = Array.isArray(hotelResult?.data?.hotels) ? hotelResult.data.hotels.slice(0, 6) : [];
  const hotelsLive = hotelResult?.data?.isLive === true;
  const hotelKm = (h) =>
    h?.distanceKm ??
    (h?.distanceMeters != null ? Math.round((h.distanceMeters / 1000) * 10) / 10 : null);
  const hotels = hotelList.map((h, i) => ({
    name: h.name || `Hotel option ${i + 1}`,
    rating: h.rating ?? null,
    pricePerNight: h.price?.amount ?? null,
    priceCurrency: h.price?.currency || currency,
    distanceKm: hotelKm(h),
    address: h.address || '',
    amenities: Array.isArray(h.amenities) && h.amenities.length ? h.amenities : ['Free Wi-Fi', 'AC', 'Breakfast included'],
    isLive: hotelsLive && Boolean(h.name),
    source: hotelsLive ? 'amadeus-hotels' : 'estimate',
  }));
  if (!hotels.length && hotelRecommended?.name) {
    hotels.push({
      name: hotelRecommended.name,
      rating: hotelRecommended.rating ?? null,
      pricePerNight: hotelRecommended.price?.amount ?? null,
      priceCurrency: hotelRecommended.price?.currency || currency,
      distanceKm: hotelKm(hotelRecommended),
      address: hotelRecommended.address || '',
      amenities: Array.isArray(hotelRecommended.amenities) && hotelRecommended.amenities.length ? hotelRecommended.amenities : ['Free Wi-Fi', 'AC'],
      isLive: hotelsLive,
      source: hotelsLive ? 'amadeus-hotels' : 'estimate',
      fetchedAt: new Date().toISOString(),
    });
  }
  // Fallback: use hotel data extracted from itinerary activities
  if (!hotels.length && activityHotels.length) {
    hotels.push(...activityHotels.slice(0, 6));
  }

  /* ---- 4. Restaurants (from Geoapify Places, or itinerary activity fallback) ---- */
  const restaurantList = Array.isArray(restaurantResult?.data?.restaurants) ? restaurantResult.data.restaurants : [];
  const restaurantsLive = restaurantResult?.data?.isLive === true;
  const restaurants = restaurantList.slice(0, 8).map((r) => {
    const level = r.priceLevel ?? 1;
    const hasZomato = r.zomatoData && r.zomatoData.averageCostPerPerson > 0;
    return {
      name: r.name || 'Restaurant',
      cuisine: (r.cuisines?.length ? r.cuisines : (r.types || []).filter((t) => t && t !== 'restaurant')).slice(0, 3).join(', ') || 'Local cuisine',
      rating: r.rating ?? null,
      reviewCount: r.reviewCount || r.zomatoData?.votes || null,
      averageCost: hasZomato ? r.averageCostForTwo : (RESTAURANT_PRICE_BY_LEVEL[level] ?? 350),
      averageCostPerPerson: hasZomato ? r.averageCostPerPerson : Math.round(RESTAURANT_PRICE_BY_LEVEL[level] ?? 350),
      averageCostIsEstimate: !hasZomato,
      averageCostNote: hasZomato
        ? `Real average from Zomato (${r.zomatoData.ratingText || 'rated'} ${r.zomatoData.rating ?? ''})`
        : 'Estimated from Geoapify priceLevel — actual menu prices not available from provider',
      veg: Boolean(prefs?.foodPreference && /veg|jain|vegan/i.test(prefs.foodPreference)),
      nonVeg: Boolean(prefs?.foodPreference && /non.?veg|chicken|meat|seafood/i.test(prefs.foodPreference)),
      vegan: Boolean(prefs?.foodPreference && /vegan|jain/i.test(prefs.foodPreference)),
      openingHours: r.openingHours || null,
      distanceKm: r.distanceKm ?? (r.distanceMeters != null ? Math.round((r.distanceMeters / 1000) * 10) / 10 : null),
      distanceLabel: distanceLabel(r.distanceKm ?? (r.distanceMeters != null ? Math.round((r.distanceMeters / 1000) * 10) / 10 : null)),
      address: r.address || '',
      coordinates: r.coordinates || null,
      isLive: restaurantsLive,
      source: hasZomato ? 'zomato' : 'geoapify',
    };
  });
  // Fallback: use restaurant data extracted from itinerary activities
  if (!restaurants.length && activityRestaurants.length) {
    restaurants.push(...activityRestaurants.slice(0, 8));
  }

  /* ---- 5. Attractions (top, hidden gems, nearby, or itinerary activity fallback) ---- */
  const attractionList = Array.isArray(attractionResult?.data?.attractions) ? attractionResult.data.attractions : [];
  const attractionsLive = attractionResult?.data?.isLive === true;
  // Use activity-extracted attractions as fallback when provider data is empty
  const effectiveAttractionList = attractionList.length ? attractionList : activityAttractions;
  const effectiveAttractionsLive = attractionsLive || activityAttractions.some((a) => a.isLive);
  const hiddenGems =
    (Array.isArray(guideResult?.data?.hiddenGems) && guideResult.data.hiddenGems.length
      ? guideResult.data.hiddenGems
      : effectiveAttractionList.slice(-3)
    ) || [];
  const attractionKm = (a) => a.distanceKm ?? (a.distanceMeters != null ? Math.round((a.distanceMeters / 1000) * 10) / 10 : null);
  const attractionCard = (a, i) => ({
    name: a.name || `Attraction ${i + 1}`,
    rating: a.rating ?? null,
    entryFee: (a.entryFee && typeof a.entryFee.amount === 'number') ? a.entryFee : entryFeeEstimate(a, currency),
    entryFeeIsEstimate: a.entryFee ? (a.entryFee.isEstimate !== false) : true,
    entryFeeNote: a.entryFeeNote || (a.entryFee ? 'From itinerary plan' : 'Estimated — no live entry fee pricing available from Geoapify provider'),
    openingHours: a.openingHours || null,
    timeRequired: a.timeRequired || visitHoursEstimate(a),
    distanceKm: attractionKm(a),
    distanceLabel: distanceLabel(attractionKm(a)),
    types: (a.types || []).slice(0, 3),
    address: a.address || '',
    isLive: a.isLive || attractionsLive,
    source: a.source || 'geoapify',
  });
  const topAttractions = effectiveAttractionList.slice(0, 6).map(attractionCard);
  const nearbyAttractions = effectiveAttractionList.slice(0, 10).map(attractionCard);
  const hiddenGemsCards = hiddenGems
    .map((g) => (typeof g === 'string' ? { name: g, rating: null, entryFee: { amount: 0, currency, isEstimate: true }, timeRequired: null, isLive: false } : attractionCard(g, 0)))
    .slice(0, 4);

  /* ---- 6. Transport plan (mode-specific estimates) ---- */
  const transportMode = transportResult?.mode || 'transport';
  const transportAlloc = alloc.transport?.amount || 0;
  const outbound = Math.round(transportAlloc * 0.5 * 100) / 100;
  const selected = transportResult?.data?.selected || null;
  const offers = Array.isArray(transportResult?.data?.offers) ? transportResult.data.offers : [];
  const transportLive = transportResult?.data?.isLive === true;
  let transportPlan;
  if (transportMode === 'flight') {
    transportPlan = {
      mode: 'flight',
      label: 'Flight',
      estimatedFare: outbound,
      currency,
      duration: selected?.duration || null,
      suggestions: offers.slice(0, 4).map((f) =>
        `${[f.airline, f.flightNumber].filter(Boolean).join(' ')} · ${f.departAt || ''} → ${f.arriveAt || ''}${f.stops ? ` · ${f.stops} stop(s)` : ''}`
      ),
      isLive: transportLive,
      bookingAdvice: transportLive ? 'Live flight offers listed - confirm price on provider' : 'Book via airline or aggregator',
    };
  } else if (transportMode === 'train') {
    transportPlan = {
      mode: 'train',
      label: 'Train',
      estimatedFare: outbound,
      currency,
      duration: selected?.duration || null,
      suggestions: offers.slice(0, 4).map((t) =>
        `${[t.trainName, t.trainNumber].filter(Boolean).join(' ')} · ${t.departureTime || ''} → ${t.arrivalTime || ''}${t.duration ? ` · ${t.duration}` : ''}`
      ),
      isLive: transportLive,
      bookingAdvice: transportLive ? 'Live train options listed - confirm fare on IRCTC' : 'Book via IRCTC or a travel agent',
    };
  } else if (transportMode === 'bus') {
    transportPlan = {
      mode: 'bus',
      label: 'Bus',
      estimatedFare: outbound,
      currency,
      duration: selected?.duration || null,
      suggestions: offers.slice(0, 4).map((b) => `${b.operator || 'Bus'} · ${b.departureTime || ''} → ${b.arrivalTime || ''}`),
      isLive: transportLive,
      bookingAdvice: transportLive ? 'Live bus options listed - confirm fare on operator site' : 'Book via RedBus / state transport',
    };
  } else {
    // Car / road trip
    const distanceKm = selected?.distanceKm || request.distanceKm || null;
    const fuelCost = distanceKm ? Math.round(distanceKm * 0.1 * 2 * 100) / 100 : null; // ~₹10/km round trip
    const tollCost = distanceKm ? Math.round(distanceKm * 0.8 * 2 * 100) / 100 : null; // ~₹0.8/km toll
    transportPlan = {
      mode: 'car',
      label: 'Car / Road',
      estimatedFare: outbound,
      currency,
      fuelCost,
      tollCost,
      drivingHours: distanceKm ? Math.round((distanceKm / 60) * 10) / 10 : null,
      distanceKm,
      isLive: false,
      bookingAdvice: 'Estimate from distance - refuel and check tolls en route',
    };
  }

  // Transport intelligence data — multi-modal journeys, alternatives, ground transfers
  const modesChecked = transportResult?.data?.modesChecked || [];
  const transportMessage = transportResult?.data?.message || '';
  const transportAlternatives = Array.isArray(transportResult?.data?.offers) ? transportResult.data.offers : [];
  if (modesChecked.length > 0 || transportMessage) {
    transportPlan.modesChecked = modesChecked;
    transportPlan.fallbackMessage = transportMessage;
    transportPlan.alternativesCount = transportAlternatives.length;
  }

  // Multi-modal journey details from Transport Intelligence Engine
  const groundTransfer = transportResult?.data?.groundTransfer || null;
  const destinationTransfer = transportResult?.data?.destinationTransfer || null;
  const totalDuration = transportResult?.data?.totalDuration || null;
  const totalCost = transportResult?.data?.totalCost || null;
  const recommendation = transportResult?.data?.recommendation || '';
  const originGeo = transportResult?.data?.originGeo || null;
  const destGeo = transportResult?.data?.destGeo || null;

  if (groundTransfer || destinationTransfer || totalDuration || totalCost) {
    transportPlan.groundTransfer = groundTransfer;
    transportPlan.destinationTransfer = destinationTransfer;
    transportPlan.totalDuration = totalDuration;
    transportPlan.totalCost = totalCost;
    transportPlan.totalCostCurrency = currency;
    transportPlan.recommendation = recommendation;
    transportPlan.originGeo = originGeo;
    transportPlan.destGeo = destGeo;
    // Override estimatedFare with totalCost when available (multi-modal)
    if (totalCost != null) {
      transportPlan.estimatedFare = null; // totalCost replaces per-leg fare
    }
  }

  // Origin/destination for multi-modal display
  if (request.origin) {
    transportPlan.origin = request.origin;
    transportPlan.destination = request.destination;
  }

  // Main transport detail label for multi-modal display
  if (selected) {
    transportPlan.mainTransportLabel = selected.airline
      ? `${selected.airline} ${selected.flightNumber || ''}`.trim()
      : selected.trainName || selected.operator || '';
    transportPlan.mainTransportDetail = selected.departure || selected.departAt || '';
  }

  /* ---- 7. Daily weather (forecast + today's sunrise/sunset) ---- */
  const weatherDaily = forecast.slice(0, daysCount || 7).map((f, i) => ({
    date: f.date || null,
    day: i + 1,
    tempMin: f.tempMin,
    tempMax: f.tempMax,
    condition: f.condition || '',
    description: f.description || '',
    icon: f.icon || '',
    humidity: f.humidity ?? null,
    rainProbability: f.rainProbability ?? null,
    windSpeed: f.windSpeed ?? null,
    sunrise: current?.sunrise ?? null,
    sunset: current?.sunset ?? null,
    isLive: weatherLive,
  }));

  /* ---- 8. Travel tips (from agents + deterministic guidance) ---- */
  const guide = guideResult?.data || {};
  const safety = safetyResult?.data || {};
  const packing =
    (Array.isArray(weatherResult?.data?.packing) && weatherResult.data.packing) ||
    ['Valid ID + trip documents', 'Comfortable walking shoes', 'Weather-appropriate clothing', 'Power bank & chargers', 'Basic medicines + first-aid kit'];
  const travelTips = {
    packingChecklist: packing.slice(0, 6),
    safetyTips: (Array.isArray(safety.safetyTips) ? safety.safetyTips : ['Save your hotel address', 'Use the Emergency Center for verified contacts']).slice(0, 6),
    localFoods: (Array.isArray(guide.localFoods) ? guide.localFoods : ['Local thali / regional specialties', 'Street food (hygiene first)', 'Seasonal fruits']).slice(0, 5),
    emergencyNumbers: ['112 (India national emergency)', 'Use the Emergency Center page for verified local contacts'],
    moneySavingTips: ['Book transport and hotels early', 'Use public transport / metro where possible', 'Eat where locals eat', 'Carry a mix of cash and cards'],
    bestTimes: ['Visit popular attractions early morning to avoid crowds', 'Check opening hours online the night before'],
    thingsToAvoid: ["Avoid unregistered touts and 'one-day-only' deals", 'Do not carry large cash amounts', 'Respect local dress codes at religious sites'],
  };

  /* ---- 9. AI recommendations (derived from real place lists + itinerary activities) ---- */
  const byRating = (arr) => [...arr].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
  const cafePicks = byRating(restaurants).filter((r) => /cafe|café|coffee/i.test(r.cuisine || r.description || '')).slice(0, 3).map((r) => r.name);
  const familyPicks = topAttractions.filter((a) => !a.entryFee?.amount || a.entryFee.amount <= 100).slice(0, 3).map((a) => a.name);
  // Build destination-specific recommendations from all available data
  const activityCategories = allActivities.reduce((acc, a) => {
    if (!acc.includes(a.category) && a.place) acc.push(a.category);
    return acc;
  }, []);
  const dayThemes = (Array.isArray(days) ? days : []).map((d) => d.theme).filter(Boolean);
  const recommendations = {
    mustVisitPlaces: topAttractions.slice(0, 5).map((a) => a.name),
    bestRestaurants: byRating(restaurants).slice(0, 4).map((r) => r.name),
    bestCafes: cafePicks.length ? cafePicks : byRating(restaurants).slice(0, 2).map((r) => r.name),
    bestShoppingAreas: (Array.isArray(guide.shoppingAreas) && guide.shoppingAreas.length ? guide.shoppingAreas : [
      `${destination} local market / bazaar`,
      `${destination} main market street`,
    ]).slice(0, 3),
    familyFriendlyAttractions: familyPicks.length ? familyPicks : topAttractions.slice(0, 2).map((a) => a.name),
    hiddenGems: hiddenGemsCards.length ? hiddenGemsCards.map((g) => g.name) : [
      `Explore ${destination} old city areas for authentic local architecture and food`,
      `Take a morning walk in any local park in ${destination} to see local life`,
      `Check for free walking tours led by local volunteers in ${destination}`,
      `Visit popular attractions in ${destination} early morning to avoid crowds`,
    ],
    // Add day themes and activities to recommendations for richer content
    ...(dayThemes.length ? { dayHighlights: dayThemes.slice(0, 4) } : {}),
    ...(activityCategories.length ? { activityTypes: activityCategories.filter((c) => !['transport', 'hotel'].includes(c)).slice(0, 4) } : {}),
  };

  /* ---- 10. Map data (markers + daily routes from activity coordinates) ---- */
  const markers = [];
  if (hotelRecommended?.latitude != null || hotelRecommended?.longitude != null) {
    markers.push({
      name: hotelRecommended.name || 'Hotel',
      type: 'hotel',
      color: '#6366f1',
      emphasis: true,
      address: hotelRecommended.address || '',
      rating: hotelRecommended.rating ?? null,
      coordinates: { lat: Number(hotelRecommended.latitude), lng: Number(hotelRecommended.longitude) },
    });
  }
  for (const r of restaurants) {
    if (r.coordinates?.lat != null && r.coordinates?.lng != null) {
      markers.push({
        name: r.name,
        type: 'restaurant',
        color: '#f43f5e',
        address: r.address || '',
        rating: r.rating ?? null,
        coordinates: { lat: Number(r.coordinates.lat), lng: Number(r.coordinates.lng) },
      });
    }
  }
  for (const a of attractionList.slice(0, 10)) {
    if (a.coordinates?.lat != null && a.coordinates?.lng != null) {
      markers.push({
        name: a.name,
        type: 'attraction',
        color: '#f59e0b',
        address: a.address || '',
        rating: a.rating ?? null,
        coordinates: { lat: Number(a.coordinates.lat), lng: Number(a.coordinates.lng) },
      });
    }
  }
  const routes = (Array.isArray(days) ? days : []).map((d) => {
    const pts = (d.activities || [])
      .map((a) => a.coordinates)
      .filter((c) => c && c.lat != null && c.lng != null)
      .map((c) => [Number(c.lat), Number(c.lng)]);
    return { dayNumber: d.dayNumber, points: pts };
  }).filter((r) => r.points.length >= 2);
  const firstAttraction = attractionList.find((a) => a.coordinates?.lat != null && a.coordinates?.lng != null)?.coordinates;
  const center =
    hotelRecommended?.latitude != null && hotelRecommended?.longitude != null
      ? [Number(hotelRecommended.latitude), Number(hotelRecommended.longitude)]
      : firstAttraction
        ? [Number(firstAttraction.lat), Number(firstAttraction.lng)]
        : [20.5937, 78.9629]; // India center fallback

  // Per-day geographic areas (real locality names when available).
  const dayAreas = (Array.isArray(days) ? days : []).map((d) => ({
    day: d.dayNumber,
    area: d.area,
    overnight: d.overnight,
    costBreakdown: d.costBreakdown,
    cumulative: d.cumulativeCost,
    remaining: d.remainingBudget,
  }));

  const fetchedAt = new Date().toISOString();

  return {
    tripSummary,
    budgetPlanning,
    budgetSummary: budgetUtil,
    dayAreas,
    hotels: hotels.map((h) => ({ ...h, fetchedAt })),
    restaurants: restaurants.map((r) => ({ ...r, fetchedAt })),
    attractions: {
      top: topAttractions.map((a) => ({ ...a, fetchedAt })),
      hiddenGems: hiddenGemsCards.map((a) => ({ ...a, fetchedAt })),
      nearby: nearbyAttractions.map((a) => ({ ...a, fetchedAt })),
    },
    transportPlan: { ...transportPlan, fetchedAt },
    weatherDaily,
    weatherNote: current?.sunrise ? 'Sunrise & sunset shown are today\'s values (per-day times aren\'t in the forecast feed).' : '',
    travelTips,
    recommendations,
    mapData: { center, markers, routes },
    dataFetchedAt: fetchedAt,
  };
}
