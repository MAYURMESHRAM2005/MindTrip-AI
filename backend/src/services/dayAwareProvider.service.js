/**
 * Day-Aware Provider Service
 *
 * Collects date-specific data for each day of a multi-day itinerary.
 * Ensures weather, events, opening hours, and routes are day-specific
 * rather than duplicating the same generic data for every day.
 *
 * Architecture:
 *   Trip dates → Day-specific data collection → Candidate normalization →
 *   Per-day filtering → Logging
 *
 * Data categories:
 *   - Weather: use the forecast corresponding to each day
 *   - Events: filter by exact date/range
 *   - Opening hours: evaluate the day of week
 *   - Restaurants: check operating hours for the specific day/time
 *   - Attractions: check opening hours for that date
 *   - Routes: calculate routes between selected day-specific locations
 *
 * Caching:
 *   - Static data (attractions, restaurants) is cached per trip
 *   - Date-sensitive data (weather, events) is cached per date
 *   - Route data is cached per coordinate pair
 */

import logger from '../utils/logger.js';

// ══════════════════════════════════════════════════════════════════════
//  DATE UTILITIES
// ══════════════════════════════════════════════════════════════════════

/**
 * Generate an array of trip day objects from start and end dates.
 * Each day contains: date, dayNumber, dayOfWeek, isWeekend, dateKey
 */
export function generateTripDays(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const days = [];
  let dayNumber = 1;
  const cursor = new Date(start);

  while (cursor <= end) {
    const dayOfWeek = cursor.getDay(); // 0=Sun, 6=Sat
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const dateKey = cursor.toISOString().slice(0, 10); // YYYY-MM-DD
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    days.push({
      date: new Date(cursor),
      dateKey,
      dayNumber,
      dayOfWeek,
      dayName: dayNames[dayOfWeek],
      isWeekend,
      month: cursor.getMonth() + 1,
      dayOfMonth: cursor.getDate(),
    });

    dayNumber++;
    cursor.setDate(cursor.getDate() + 1);
  }

  return days;
}

/**
 * Get the day of week abbreviation (Mo, Tu, We, etc.) for opening hours parsing.
 */
export function getDayAbbreviation(dayOfWeek) {
  const abbrs = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  return abbrs[dayOfWeek] || '';
}

// ══════════════════════════════════════════════════════════════════════
//  OPENING HOURS FILTER
// ══════════════════════════════════════════════════════════════════════

/**
 * Check if a place is likely open on a given day of week.
 * Uses parsed openingHours from Google when available.
 *
 * @param {object} place - Place with optional openingHours
 * @param {number} dayOfWeek - 0=Sun, 6=Sat
 * @returns {boolean} - true if likely open, false if closed, null if unknown
 */
export function isPlaceOpenOnDay(place, dayOfWeek) {
  if (!place?.openingHours?.periods?.length) {
    return null; // No data — cannot determine
  }

  const dayAbbr = getDayAbbreviation(dayOfWeek);

  for (const period of place.openingHours.periods) {
    // Check if this period applies to the given day
    const days = period.days || [];
    if (days.includes('all') || days.includes(dayAbbr)) {
      return true;
    }
  }

  // If we have periods but none match this day, assume closed
  if (place.openingHours.periods.length > 0) {
    return false;
  }

  return null;
}

/**
 * Check if a place is likely open at a specific hour on a given day.
 *
 * @param {object} place - Place with optional openingHours
 * @param {number} dayOfWeek - 0=Sun, 6=Sat
 * @param {number} hour - 0-23
 * @returns {boolean} - true if likely open, false if closed, null if unknown
 */
export function isPlaceOpenAtHour(place, dayOfWeek, hour) {
  if (!place?.openingHours?.periods?.length) {
    return null;
  }

  const dayAbbr = getDayAbbreviation(dayOfWeek);
  const prevDayAbbr = getDayAbbreviation(dayOfWeek === 0 ? 6 : dayOfWeek - 1);

  for (const period of place.openingHours.periods) {
    const days = period.days || [];

    // Parse open/close times
    const openTime = period.open || '00:00';
    const closeTime = period.close || '23:59';
    const [openH, openM] = openTime.split(':').map(Number);
    const [closeH, closeM] = closeTime.split(':').map(Number);

    const openMinutes = openH * 60 + (openM || 0);
    const closeMinutes = closeH * 60 + (closeM || 0);
    const checkMinutes = hour * 60;

    // Handle overnight hours (e.g., 22:00-06:00)
    if (closeMinutes < openMinutes) {
      // Period spans midnight. Check if this day's period covers the check hour.
      // If check hour is in the evening (>= open time), it belongs to this day's period.
      if (checkMinutes >= openMinutes) {
        if (days.includes('all') || days.includes(dayAbbr)) return true;
      }
      // If check hour is in the early morning (< close time), it belongs to the previous day's period.
      if (checkMinutes < closeMinutes) {
        if (days.includes('all') || days.includes(prevDayAbbr)) return true;
      }
    } else {
      // Normal hours (e.g., 09:00-18:00)
      if (checkMinutes >= openMinutes && checkMinutes < closeMinutes) {
        if (days.includes('all') || days.includes(dayAbbr)) return true;
      }
    }
  }

  return false;
}

// ══════════════════════════════════════════════════════════════════════
//  DAY-SPECIFIC DATA COLLECTION
// ══════════════════════════════════════════════════════════════════════

/**
 * Filter weather forecast to get the forecast for a specific day.
 *
 * @param {Array} forecast - Full weather forecast array
 * @param {string} dateKey - YYYY-MM-DD
 * @returns {object|null} - Weather forecast for that day, or null
 */
export function getWeatherForDay(forecast, dateKey) {
  if (!forecast || !Array.isArray(forecast) || !dateKey) return null;

  return forecast.find((f) => f.date === dateKey || f.date?.slice(0, 10) === dateKey) || null;
}

/**
 * Filter events to get events happening on a specific date.
 *
 * @param {Array} events - Full events array
 * @param {string} dateKey - YYYY-MM-DD
 * @returns {Array} - Events for that date
 */
export function getEventsForDay(events, dateKey) {
  if (!events || !Array.isArray(events) || !dateKey) return [];

  return events.filter((e) => {
    const eventDate = e.date || e.eventDate || e.dateTime?.slice(0, 10);
    return eventDate === dateKey;
  });
}

/**
 * Filter candidates by opening hours for a specific day.
 * Returns only candidates that are likely open on that day.
 *
 * @param {Array} candidates - Candidate array
 * @param {number} dayOfWeek - 0=Sun, 6=Sat
 * @returns {{ open: Array, closed: Array, unknown: Array }}
 */
export function filterByOpeningHours(candidates, dayOfWeek) {
  const open = [];
  const closed = [];
  const unknown = [];

  for (const c of candidates || []) {
    const status = isPlaceOpenOnDay(c, dayOfWeek);
    if (status === true) {
      open.push(c);
    } else if (status === false) {
      closed.push(c);
    } else {
      unknown.push(c);
    }
  }

  return { open, closed, unknown };
}

/**
 * Filter candidates by opening hours for a specific day and time slot.
 *
 * @param {Array} candidates - Candidate array
 * @param {number} dayOfWeek - 0=Sun, 6=Sat
 * @param {string} timeSlot - 'morning' | 'lunch' | 'afternoon' | 'evening' | 'night'
 * @returns {{ suitable: Array, unsuitable: Array, unknown: Array }}
 */
export function filterByTimeSlot(candidates, dayOfWeek, timeSlot) {
  const hourMap = {
    morning: 9,
    lunch: 12,
    afternoon: 15,
    evening: 18,
    night: 21,
  };
  const hour = hourMap[timeSlot] || 12;

  const suitable = [];
  const unsuitable = [];
  const unknown = [];

  for (const c of candidates || []) {
    const status = isPlaceOpenAtHour(c, dayOfWeek, hour);
    if (status === true) {
      suitable.push(c);
    } else if (status === false) {
      unsuitable.push(c);
    } else {
      unknown.push(c);
    }
  }

  return { suitable, unsuitable, unknown };
}

// ══════════════════════════════════════════════════════════════════════
//  CANDIDATE POOL BUILDER
// ══════════════════════════════════════════════════════════════════════

/**
 * Build day-specific candidate pools for each day of the trip.
 * This is the core function that ensures each day gets its own
 * filtered, date-appropriate candidate list.
 *
 * @param {object} opts
 * @param {Array} opts.tripDays - From generateTripDays()
 * @param {Array} opts.attractions - All attraction candidates
 * @param {Array} opts.restaurants - All restaurant candidates
 * @param {Array} opts.events - All event candidates
 * @param {Array} opts.nightlife - All nightlife candidates
 * @param {object} opts.weatherForecast - Full weather forecast
 * @param {object} opts.prefs - User preferences
 * @returns {Array} - Array of day-specific candidate pools
 */
export function buildDaySpecificPools({
  tripDays,
  attractions = [],
  restaurants = [],
  events = [],
  nightlife = [],
  weatherForecast = null,
  prefs = {},
}) {
  const pools = [];

  for (const day of tripDays) {
    const dayPool = {
      dayNumber: day.dayNumber,
      dateKey: day.dateKey,
      dayName: day.dayName,
      dayOfWeek: day.dayOfWeek,
      isWeekend: day.isWeekend,
      weather: getWeatherForDay(weatherForecast, day.dateKey),
      attractions: [],
      restaurants: [],
      events: [],
      nightlife: [],
      _logging: {
        totalAttractions: attractions.length,
        totalRestaurants: restaurants.length,
        totalEvents: events.length,
        totalNightlife: nightlife.length,
        filteredAttractions: 0,
        filteredRestaurants: 0,
        filteredEvents: 0,
        filteredNightlife: 0,
      },
    };

    // ── Attractions: filter by opening hours for this day ──
    const attractionFilter = filterByOpeningHours(attractions, day.dayOfWeek);
    dayPool.attractions = [...attractionFilter.open, ...attractionFilter.unknown];
    dayPool._logging.filteredAttractions = dayPool.attractions.length;

    // ── Restaurants: filter by operating hours ──
    const restaurantFilter = filterByOpeningHours(restaurants, day.dayOfWeek);
    dayPool.restaurants = [...restaurantFilter.open, ...restaurantFilter.unknown];
    dayPool._logging.filteredRestaurants = dayPool.restaurants.length;

    // ── Events: filter by exact date ──
    dayPool.events = getEventsForDay(events, day.dateKey);
    dayPool._logging.filteredEvents = dayPool.events.length;

    // ── Nightlife: filter by opening hours ──
    const nightlifeFilter = filterByOpeningHours(nightlife, day.dayOfWeek);
    dayPool.nightlife = [...nightlifeFilter.open, ...nightlifeFilter.unknown];
    dayPool._logging.filteredNightlife = dayPool.nightlife.length;

    pools.push(dayPool);
  }

  return pools;
}

// ══════════════════════════════════════════════════════════════════════
//  ENRICHED DAY CONTEXT
// ══════════════════════════════════════════════════════════════════════

/**
 * Build enriched day context for the AI planner.
 * Each day gets its own weather, events, and filtered candidates.
 *
 * @param {object} opts
 * @param {Array} opts.dayPools - From buildDaySpecificPools()
 * @param {object} opts.prefs - User preferences
 * @returns {Array} - Enriched day contexts for the AI planner
 */
export function buildEnrichedDayContexts({ dayPools, prefs = {} }) {
  return dayPools.map((pool) => ({
    dayNumber: pool.dayNumber,
    date: pool.dateKey,
    dayName: pool.dayName,
    isWeekend: pool.isWeekend,

    // Weather for this specific day
    weather: pool.weather ? {
      condition: pool.weather.condition || pool.weather.description || '',
      tempMin: pool.weather.tempMin ?? null,
      tempMax: pool.weather.tempMax ?? null,
      rainProbability: pool.weather.rainProbability ?? null,
      humidity: pool.weather.humidity ?? null,
    } : null,

    // Candidates filtered for this day
    attractionCount: pool.attractions.length,
    restaurantCount: pool.restaurants.length,
    eventCount: pool.events.length,
    nightlifeCount: pool.nightlife.length,

    // Events specific to this day
    events: pool.events.map((e) => ({
      name: e.name,
      category: e.category,
      time: e.time,
      venue: e.venueName || e.venue,
    })),

    // Preferences that affect this day
    foodPreference: prefs.foodPreference || null,
    activityLevel: prefs.activityLevel || null,
  }));
}

// ══════════════════════════════════════════════════════════════════════
//  LOGGING
// ══════════════════════════════════════════════════════════════════════

/**
 * Log the day-aware pipeline results.
 * Shows provider candidates → filtered candidates → selected candidates
 * for each day.
 */
export function logDayAwarePipeline(dayPools) {
  for (const pool of dayPools) {
    const weatherLabel = pool.weather
      ? `${pool.weather.condition || 'N/A'}, ${pool.weather.tempMin ?? '?'}°-${pool.weather.tempMax ?? '?'}°C, rain: ${pool.weather.rainProbability ?? '?'}%`
      : 'No forecast';

    const eventNames = pool.events.length > 0
      ? pool.events.slice(0, 3).map((e) => e.name).join(', ') + (pool.events.length > 3 ? ` +${pool.events.length - 3} more` : '')
      : 'None';

    logger.info(
      `[DAY-AWARE] Day ${pool.dayNumber} (${pool.dateKey}, ${pool.dayName}${pool.isWeekend ? ', weekend' : ''}): ` +
      `Weather: ${weatherLabel} | ` +
      `Attractions: ${pool._logging.filteredAttractions}/${pool._logging.totalAttractions} | ` +
      `Restaurants: ${pool._logging.filteredRestaurants}/${pool._logging.totalRestaurants} | ` +
      `Events: ${pool._logging.filteredEvents}/${pool._logging.totalEvents} (${eventNames}) | ` +
      `Nightlife: ${pool._logging.filteredNightlife}/${pool._logging.totalNightlife}`
    );
  }
}

// ══════════════════════════════════════════════════════════════════════
//  DAY-AWARE CANDIDATE SELECTION
// ══════════════════════════════════════════════════════════════════════

/**
 * Select the best candidates for a specific day based on weather,
 * preferences, and opening hours.
 *
 * @param {object} dayPool - Single day pool from buildDaySpecificPools()
 * @param {object} opts
 * @param {number} opts.maxAttractions - Max attractions per day
 * @param {number} opts.maxRestaurants - Max restaurants per day
 * @param {number} opts.maxEvents - Max events per day
 * @param {object} opts.prefs - User preferences
 * @returns {object} - Selected candidates for the day
 */
export function selectDayCandidates(dayPool, opts = {}) {
  const {
    maxAttractions = 4,
    maxRestaurants = 3,
    maxEvents = 2,
    prefs = {},
  } = opts;

  const badWeather = isBadWeather(dayPool.weather);

  // ── Attractions ──
  let selectedAttractions = dayPool.attractions.slice(0, maxAttractions);

  // If bad weather, prefer indoor attractions
  if (badWeather && selectedAttractions.length > 0) {
    const indoor = selectedAttractions.filter((a) => isIndoorAttraction(a));
    const outdoor = selectedAttractions.filter((a) => !isIndoorAttraction(a));
    if (indoor.length > 0) {
      selectedAttractions = [...indoor, ...outdoor].slice(0, maxAttractions);
    }
  }

  // ── Restaurants ──
  const selectedRestaurants = dayPool.restaurants.slice(0, maxRestaurants);

  // ── Events ──
  let selectedEvents = dayPool.events.slice(0, maxEvents);

  // Filter events by user interests if available
  if (prefs.interests?.length && selectedEvents.length > 0) {
    const relevant = selectedEvents.filter((e) => {
      const eventText = `${e.name} ${e.category} ${e.genre || ''}`.toLowerCase();
      return prefs.interests.some((i) => eventText.includes(i.toLowerCase()));
    });
    if (relevant.length > 0) {
      selectedEvents = relevant.slice(0, maxEvents);
    }
  }

  // ── Nightlife ──
  const selectedNightlife = dayPool.nightlife.slice(0, 2);

  return {
    dayNumber: dayPool.dayNumber,
    dateKey: dayPool.dateKey,
    attractions: selectedAttractions,
    restaurants: selectedRestaurants,
    events: selectedEvents,
    nightlife: selectedNightlife,
    weather: dayPool.weather,
  };
}

/**
 * Check if weather is bad (rain likely).
 */
function isBadWeather(weather) {
  if (!weather) return false;
  return (weather.rainProbability ?? 0) >= 50;
}

/**
 * Check if an attraction is likely indoor.
 */
function isIndoorAttraction(attraction) {
  const types = (attraction.types || []).join(' ').toLowerCase();
  const name = (attraction.name || '').toLowerCase();
  return /museum|gallery|indoor|theatre|theater|cinema|aquarium|shopping|market/i.test(types + ' ' + name);
}

// ══════════════════════════════════════════════════════════════════════
//  MERGE INTO AI PLANNER CONTEXT
// ══════════════════════════════════════════════════════════════════════

/**
 * Merge day-specific pools into the candidate list for the AI planner.
 * This adds day metadata to each candidate so the planner knows
 * which days each candidate is suitable for.
 *
 * @param {Array} candidates - Normalized candidate list
 * @param {Array} dayPools - Day-specific pools
 * @returns {Array} - Candidates enriched with day availability
 */
export function enrichCandidatesWithDayAvailability(candidates, dayPools) {
  // Build a map: candidateId → Set of dayNumbers where it's available
  const availabilityMap = new Map();

  for (const pool of dayPools) {
    const allDayCandidates = [
      ...pool.attractions,
      ...pool.restaurants,
      ...pool.nightlife,
    ];

    for (const c of allDayCandidates) {
      const id = c.id || c.placeId || c.name;
      if (!id) continue;
      if (!availabilityMap.has(id)) availabilityMap.set(id, new Set());
      availabilityMap.get(id).add(pool.dayNumber);
    }
  }

  // Enrich each candidate with day availability
  return candidates.map((c) => {
    const id = c.id || c.providerId || c.name;
    const availableDays = availabilityMap.get(id);

    return {
      ...c,
      _availableDays: availableDays ? Array.from(availableDays) : null,
      _daySpecific: true,
    };
  });
}

// ══════════════════════════════════════════════════════════════════════
//  PIPELINE ORCHESTRATOR
// ══════════════════════════════════════════════════════════════════════

/**
 * Run the full day-aware data collection pipeline.
 * This is the main entry point for the service.
 *
 * @param {object} opts
 * @param {string} opts.startDate - Trip start date (YYYY-MM-DD)
 * @param {string} opts.endDate - Trip end date (YYYY-MM-DD)
 * @param {Array} opts.attractions - All attraction candidates
 * @param {Array} opts.restaurants - All restaurant candidates
 * @param {Array} opts.events - All event candidates
 * @param {Array} opts.nightlife - All nightlife candidates
 * @param {object} opts.weatherForecast - Full weather forecast
 * @param {object} opts.prefs - User preferences
 * @param {boolean} opts.logPipeline - Whether to log the pipeline results
 * @returns {object} - Day-aware data with pools and enriched contexts
 */
export function runDayAwarePipeline({
  startDate,
  endDate,
  attractions = [],
  restaurants = [],
  events = [],
  nightlife = [],
  weatherForecast = null,
  prefs = {},
  logPipeline = true,
}) {
  const started = Date.now();

  // Step 1: Generate trip days
  const tripDays = generateTripDays(startDate, endDate);
  logger.info(`[DAY-AWARE] Generated ${tripDays.length} trip days: ${tripDays[0]?.dateKey} → ${tripDays[tripDays.length - 1]?.dateKey}`);

  // Step 2: Build day-specific pools
  const dayPools = buildDaySpecificPools({
    tripDays,
    attractions,
    restaurants,
    events,
    nightlife,
    weatherForecast,
    prefs,
  });

  // Step 3: Log pipeline results
  if (logPipeline) {
    logDayAwarePipeline(dayPools);
  }

  // Step 4: Build enriched day contexts for the AI planner
  const dayContexts = buildEnrichedDayContexts({ dayPools, prefs });

  // Step 5: Select candidates for each day
  const daySelections = dayPools.map((pool) => selectDayCandidates(pool, { prefs }));

  const latencyMs = Date.now() - started;
  logger.info(`[DAY-AWARE] Pipeline complete in ${latencyMs}ms: ${tripDays.length} days processed`);

  return {
    tripDays,
    dayPools,
    dayContexts,
    daySelections,
    summary: {
      totalDays: tripDays.length,
      totalAttractions: attractions.length,
      totalRestaurants: restaurants.length,
      totalEvents: events.length,
      totalNightlife: nightlife.length,
      avgAttractionsPerDay: dayPools.length > 0
        ? Math.round(dayPools.reduce((s, p) => s + p.attractions.length, 0) / dayPools.length)
        : 0,
      avgRestaurantsPerDay: dayPools.length > 0
        ? Math.round(dayPools.reduce((s, p) => s + p.restaurants.length, 0) / dayPools.length)
        : 0,
      totalEventsAcrossDays: dayPools.reduce((s, p) => s + p.events.length, 0),
      daysWithEvents: dayPools.filter((p) => p.events.length > 0).length,
    },
    latencyMs,
  };
}

export default {
  generateTripDays,
  getWeatherForDay,
  getEventsForDay,
  filterByOpeningHours,
  filterByTimeSlot,
  isPlaceOpenOnDay,
  isPlaceOpenAtHour,
  buildDaySpecificPools,
  buildEnrichedDayContexts,
  selectDayCandidates,
  enrichCandidatesWithDayAvailability,
  runDayAwarePipeline,
  logDayAwarePipeline,
  getDayAbbreviation,
};
