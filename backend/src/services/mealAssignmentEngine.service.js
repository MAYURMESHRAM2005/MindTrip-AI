/**
 * mealAssignmentEngine.service.js — Deterministic Meal Assignment Engine
 *
 * Assigns real, validated restaurants to breakfast, lunch, and dinner slots
 * for each itinerary day using a strict priority-based selection system.
 *
 * Selection priority:
 *   destination validity → restaurant validity → opening hours →
 *   food preference → geographic proximity → uniqueness → rating → price/budget
 *
 * Never invents restaurant names or prices.
 */

import { haversineKm } from '../utils/geo.js';
import { isPlaceOpenAtHour, isPlaceOpenOnDay } from './dayAwareProvider.service.js';
import logger from '../utils/logger.js';
import { createProviderProvenance, createEstimatedProvenance, createUnavailableProvenance } from '../validators/provenanceValidator.js';

// ══════════════════════════════════════════════════════════════════════
//  CONSTANTS
// ══════════════════════════════════════════════════════════════════════

/** Default meal time slots (hour in 24h format). */
export const MEAL_TIMES = {
  breakfast: { hour: 8, label: '08:00', tolerance: 2 },   // 06:00–10:00
  lunch:     { hour: 13, label: '13:00', tolerance: 2 },   // 11:00–15:00
  dinner:    { hour: 20, label: '20:00', tolerance: 2 },   // 18:00–22:00
};

/** Day-of-week abbreviations used by opening hours. */
const DAY_ABBREVS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

/** Maximum distance (km) to consider a restaurant "nearby" for a meal. */
const MAX_PROXIMITY_KM = 14;

/** Weight multipliers for scoring. */
const SCORE_WEIGHTS = {
  openingHours: 30,   // Must be open — highest priority after validity
  foodPref: 20,       // Matches user preference
  proximity: 15,      // Close to previous/next activity
  rating: 20,         // Higher rating preferred
  priceBudget: 15,    // Within budget preferred
};

// ══════════════════════════════════════════════════════════════════════
//  RESTAURANT VALIDITY CHECKS
// ══════════════════════════════════════════════════════════════════════

/**
 * Check if a restaurant candidate is valid for meal assignment.
 * Returns { valid, reason }.
 */
export function isRestaurantValid(restaurant) {
  if (!restaurant) return { valid: false, reason: 'null candidate' };

  // Must have a name
  const name = restaurant.name || restaurant.canonicalName || '';
  if (!name || name.length < 2) {
    return { valid: false, reason: 'no name' };
  }

  // Reject generic/placeholder names
  const lower = name.toLowerCase();
  const genericPatterns = [
    /^breakfast$/, /^lunch$/, /^dinner$/, /^meal$/,
    /^restaurant$/, /^cafe$/, /^food$/,
    /^accommodation in/i, /^overnight in/i, /^lodging/i,
    /^demo/, /^test/, /^sample/, /^placeholder/,
  ];
  for (const p of genericPatterns) {
    if (p.test(lower)) return { valid: false, reason: `generic name: "${name}"` };
  }

  // Must have a provider ID. The Google provider emits placeId as the
  // canonical identifier; pipeline-normalized candidates carry providerId.
  if (!restaurant.providerId && !restaurant.placeId && !restaurant.id) {
    return { valid: false, reason: 'no provider ID' };
  }

  // Must have valid coordinates (optional but preferred)
  const lat = restaurant.latitude ?? restaurant.coordinates?.lat;
  const lng = restaurant.longitude ?? restaurant.coordinates?.lng;
  if (lat != null && lng != null) {
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return { valid: false, reason: 'invalid coordinates' };
    }
    if (lat === 0 && lng === 0) {
      return { valid: false, reason: 'null island coordinates' };
    }
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return { valid: false, reason: 'coordinates out of range' };
    }
  }

  return { valid: true, reason: '' };
}

// ══════════════════════════════════════════════════════════════════════
//  OPENING HOURS CHECK
// ══════════════════════════════════════════════════════════════════════

/**
 * Check if a restaurant is open at a given meal time on a given date.
 * Uses the day-aware provider's opening hours parser.
 *
 * @param {object} restaurant - restaurant candidate
 * @param {string} mealType - 'breakfast', 'lunch', or 'dinner'
 * @param {string} dateStr - ISO date string (e.g., '2025-06-01')
 * @returns {boolean} true if open (or no data available — assume open)
 */
export function isOpenForMeal(restaurant, mealType, dateStr) {
  const meal = MEAL_TIMES[mealType];
  if (!meal) return true;

  const openingHours = restaurant.openingHours;
  if (!openingHours?.periods?.length) {
    // No opening hours data — assume open (best effort)
    return true;
  }

  // Determine day of week from date (0=Sun..6=Sat)
  const dayOfWeek = getDayOfWeek(dateStr);
  if (dayOfWeek < 0) return true; // Unknown day — assume open

  // Check if open on this day of week (null = no data = assume open)
  const openOnDay = isPlaceOpenOnDay(restaurant, dayOfWeek);
  if (openOnDay === false) return false; // Explicitly closed
  // openOnDay === null means no data — continue to hour check

  // Check if open at the meal hour (null = no data = assume open)
  const openAtHour = isPlaceOpenAtHour(restaurant, dayOfWeek, meal.hour);
  if (openAtHour === true) return true;
  if (openAtHour === false) {
    // Not open at exact hour — check tolerance range
    for (let h = meal.hour - meal.tolerance; h <= meal.hour + meal.tolerance; h++) {
      if (h >= 0 && h <= 23) {
        const result = isPlaceOpenAtHour(restaurant, dayOfWeek, h);
        if (result === true) return true;
      }
    }
    return false;
  }
  // openAtHour === null — no data, assume open
  return true;
}

/**
 * Get day of week number (0=Sun..6=Sat) from date string.
 * Returns -1 if invalid.
 * @param {string} dateStr - ISO date string
 * @returns {number} day of week 0-6
 */
function getDayOfWeek(dateStr) {
  if (!dateStr) return -1;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return -1;
  return d.getDay();
}

// ══════════════════════════════════════════════════════════════════════
//  FOOD PREFERENCE MATCHING
// ══════════════════════════════════════════════════════════════════════

/**
 * Check if a restaurant matches the user's food preference.
 * Returns a score from 0 to 1 (1 = perfect match, 0 = no match).
 *
 * @param {object} restaurant - restaurant candidate
 * @param {string} foodPreference - user's food preference (e.g., 'vegetarian', 'seafood')
 * @returns {number} match score 0–1
 */
export function foodPreferenceScore(restaurant, foodPreference) {
  if (!foodPreference) return 1; // No preference = accept all

  const pref = foodPreference.toLowerCase();
  const cuisines = (restaurant.cuisine || restaurant.cuisines || [])
    .map((c) => String(c).toLowerCase());
  const name = (restaurant.name || restaurant.canonicalName || '').toLowerCase();
  const types = (restaurant.types || restaurant.categories || [])
    .map((t) => String(t).toLowerCase());

  // Direct cuisine match
  for (const c of cuisines) {
    if (c.includes(pref) || pref.includes(c)) return 1;
  }

  // Name match
  if (name.includes(pref)) return 0.9;

  // Type match
  for (const t of types) {
    if (t.includes(pref) || pref.includes(t)) return 0.8;
  }

  // Partial keyword match
  const prefWords = pref.split(/\s+/);
  for (const word of prefWords) {
    if (word.length < 3) continue;
    for (const c of cuisines) {
      if (c.includes(word)) return 0.7;
    }
  }

  return 0.3; // Default: low match but not zero
}

// ══════════════════════════════════════════════════════════════════════
//  PROXIMITY SCORING
// ══════════════════════════════════════════════════════════════════════

/**
 * Score a restaurant based on proximity to a reference point.
 * Returns a score from 0 to 1 (1 = closest, 0 = too far).
 *
 * @param {object} restaurant - restaurant candidate
 * @param {object|null} refPoint - { latitude, longitude } reference point
 * @returns {number} proximity score 0–1
 */
export function proximityScore(restaurant, refPoint) {
  if (!refPoint?.latitude || !refPoint?.longitude) return 0.5; // No reference = neutral

  const rLat = restaurant.latitude ?? restaurant.coordinates?.lat;
  const rLng = restaurant.longitude ?? restaurant.coordinates?.lng;
  if (rLat == null || rLng == null) return 0.3; // No coords = low score

  const km = haversineKm(refPoint.latitude, refPoint.longitude, rLat, rLng);
  if (km > MAX_PROXIMITY_KM) return 0.1;
  if (km <= 0.5) return 1.0;
  if (km <= 2) return 0.9;
  if (km <= 5) return 0.7;
  if (km <= 10) return 0.5;
  return 0.3;
}

// ══════════════════════════════════════════════════════════════════════
//  RATING SCORING
// ══════════════════════════════════════════════════════════════════════

/**
 * Score a restaurant based on rating.
 * Returns a score from 0 to 1.
 */
export function ratingScore(restaurant) {
  const rating = restaurant.rating;
  if (rating == null || rating === 0) return 0.4; // Unknown = moderate
  if (rating >= 4.5) return 1.0;
  if (rating >= 4.0) return 0.9;
  if (rating >= 3.5) return 0.7;
  if (rating >= 3.0) return 0.5;
  return 0.3;
}

// ══════════════════════════════════════════════════════════════════════
//  PRICE / BUDGET SCORING
// ══════════════════════════════════════════════════════════════════════

/**
 * Score a restaurant based on price vs budget.
 * Returns a score from 0 to 1.
 *
 * @param {object} restaurant - restaurant candidate
 * @param {number} mealBudget - per-person budget for this meal
 */
export function priceBudgetScore(restaurant, mealBudget) {
  if (!mealBudget || mealBudget <= 0) return 0.5; // No budget = neutral

  const cost = restaurant.averageCostPerPerson || 0;
  if (cost <= 0) return 0.4; // No price data = moderate

  const ratio = cost / mealBudget;
  if (ratio <= 0.8) return 1.0;   // Well under budget
  if (ratio <= 1.0) return 0.9;   // Within budget
  if (ratio <= 1.2) return 0.6;   // Slightly over
  if (ratio <= 1.5) return 0.3;   // Over budget
  return 0.1;                      // Way over budget
}

// ══════════════════════════════════════════════════════════════════════
//  COMPOSITE SCORING
// ══════════════════════════════════════════════════════════════════════

/**
 * Compute composite score for a restaurant candidate for a specific meal.
 *
 * @param {object} restaurant - restaurant candidate
 * @param {object} opts - scoring options
 * @param {string} opts.mealType - 'breakfast', 'lunch', 'dinner'
 * @param {string} opts.dateStr - ISO date string
 * @param {string} opts.foodPreference - user's food preference
 * @param {object} opts.refPoint - { latitude, longitude } reference point
 * @param {number} opts.mealBudget - per-person meal budget
 * @returns {object} { score, breakdown, open }
 */
export function scoreRestaurant(restaurant, opts) {
  const { mealType, dateStr, foodPreference, refPoint, mealBudget } = opts;

  const open = isOpenForMeal(restaurant, mealType, dateStr);
  const foodScore = foodPreferenceScore(restaurant, foodPreference);
  const proxScore = proximityScore(restaurant, refPoint);
  const rateScore = ratingScore(restaurant);
  const priceScore = priceBudgetScore(restaurant, mealBudget);

  // If not open, zero out the score
  const openScore = open ? 1.0 : 0.0;

  const breakdown = {
    openingHours: openScore * SCORE_WEIGHTS.openingHours,
    foodPref: foodScore * SCORE_WEIGHTS.foodPref,
    proximity: proxScore * SCORE_WEIGHTS.proximity,
    rating: rateScore * SCORE_WEIGHTS.rating,
    priceBudget: priceScore * SCORE_WEIGHTS.priceBudget,
  };

  const score = Object.values(breakdown).reduce((s, v) => s + v, 0);

  return { score, breakdown, open };
}

// ══════════════════════════════════════════════════════════════════════
//  MEAL ASSIGNMENT
// ══════════════════════════════════════════════════════════════════════

/**
 * Assign restaurants to breakfast, lunch, and dinner for a single day.
 *
 * @param {object} opts
 * @param {Array}  opts.restaurants - restaurant candidates for this day
 * @param {Set}    opts.usedRestaurants - set of already-used restaurant keys
 * @param {string} opts.dateStr - ISO date string for this day
 * @param {string} opts.foodPreference - user's food preference
 * @param {object} opts.previousActivity - { latitude, longitude } of preceding activity
 * @param {object} opts.nextActivity - { latitude, longitude } of following activity
 * @param {number} opts.mealBudget - per-person meal budget
 * @param {string} opts.dayOfWeek - day abbreviation (Mo, Tu, etc.)
 * @returns {object} { breakfast, lunch, dinner, usedKeys }
 *   Each meal is { restaurant, title, description, cost, source, isLive, dataStatus }
 *   or null if no valid restaurant found.
 */
export function assignMealsForDay({
  restaurants = [],
  usedRestaurants = new Set(),
  dateStr = '',
  dayNumber = null,
  foodPreference = '',
  previousActivity = null,
  nextActivity = null,
  mealBudget = 0,
  partySize = 1,
} = {}) {
  const result = { breakfast: null, lunch: null, dinner: null, usedKeys: new Set() };

  if (!restaurants.length) {
    return result;
  }

  // Filter to valid restaurants only
  const valid = [];
  for (const r of restaurants) {
    const { valid: isValid, reason } = isRestaurantValid(r);
    if (isValid) valid.push(r);
  }

  if (!valid.length) return result;

  // Score and rank restaurants for each meal
  const meals = ['breakfast', 'lunch', 'dinner'];
  const mealContext = {
    breakfast: { refPoint: previousActivity }, // Near hotel/start of day
    lunch:     { refPoint: previousActivity }, // Near morning activity
    dinner:    { refPoint: nextActivity },     // Near evening activity/hotel
  };

  for (const mealType of meals) {
    const ctx = mealContext[mealType];

    // Score all valid, unused restaurants
    const scored = [];
    for (const r of valid) {
      const key = restaurantKey(r);
      if (usedRestaurants.has(key) || result.usedKeys.has(key)) continue;

      // Backend enforcement of day availability — never rely on prompts alone.
      // If the candidate carries _availableDays (opening-hours aware) and this
      // day is not in it, it MUST NOT be scheduled today.
      if (dayNumber != null && Array.isArray(r._availableDays) && r._availableDays.length > 0
        && !r._availableDays.includes(dayNumber)) {
        continue;
      }

      const { score, breakdown, open } = scoreRestaurant(r, {
        mealType,
        dateStr,
        foodPreference,
        refPoint: ctx.refPoint,
        mealBudget,
      });

      // Only consider open restaurants (score > 0 for openingHours)
      if (!open) continue;

      scored.push({ restaurant: r, score, breakdown });
    }

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    if (scored.length > 0) {
      const best = scored[0];
      const key = restaurantKey(best.restaurant);
      result.usedKeys.add(key);

      // Build cost (per-person × party size)
      const cost = buildMealCost(best.restaurant, mealType, mealBudget, partySize);      // Create provenance block for this meal assignment
      const restaurantProvider = best.restaurant.source || best.restaurant.provider || 'restaurant-engine';
      const restaurantId = best.restaurant.providerId || best.restaurant.id || best.restaurant.name || `restaurant-${Date.now()}`;
      let provenance;
      if (cost.dataStatus === 'live') {
        provenance = createProviderProvenance(restaurantProvider, restaurantId, 'live');
      } else if (cost.dataStatus === 'estimated') {
        provenance = createEstimatedProvenance(restaurantProvider, restaurantId);
      } else {
        provenance = createUnavailableProvenance(restaurantProvider, 'No reliable restaurant data available');
      }

      result[mealType] = {
        restaurant: best.restaurant,
        title: `${capitalize(mealType)} at ${best.restaurant.name || best.restaurant.canonicalName}`,
        place: best.restaurant.name || best.restaurant.canonicalName,
        description: buildMealDescription(best.restaurant, mealType, foodPreference, best.breakdown),
        category: 'restaurant', address: best.restaurant.address || '', coordinates: extractCoordinates(best.restaurant),
        cost,
        source: best.restaurant.source || best.restaurant.provider || 'restaurant-engine',
        isLive: cost.dataStatus === 'live',
        dataStatus: cost.dataStatus,
        rating: best.restaurant.rating ?? null,
        openingHours: best.restaurant.openingHours || null,
        scoreBreakdown: best.breakdown,
        provenance,
      };
    }
  }

  return result;
}

// ══════════════════════════════════════════════════════════════════════
//  COST BUILDING
// ══════════════════════════════════════════════════════════════════════

/**
 * Build cost object for a meal from restaurant data.
 * Price rules: use provider value if available; if not, price=null, dataStatus=unavailable.
 */
function buildMealCost(restaurant, mealType, mealBudget, partySize = 1) {
  const perPerson = restaurant.averageCostPerPerson || 0;
  const currency = restaurant.currency || 'INR';

  if (perPerson > 0) {
    // Use real provider price × party size
    const isEstimate = Boolean(restaurant.isEstimate);
    const dataStatus = restaurant.dataStatus || (isEstimate ? 'estimate' : 'live');
    const amount = Math.round(perPerson * partySize * 100) / 100;
    return {
      amount,
      perPerson,
      currency,
      isEstimate,
      source: restaurant.source || restaurant.provider || 'restaurant-engine',
      dataStatus,
      estimateNote: dataStatus === 'live'
        ? `Real price from ${restaurant.source || restaurant.provider} × ${partySize} traveller(s)`
        : isEstimate
          ? `Estimated from ${restaurant.provider} priceLevel — labeled as estimate × ${partySize} traveller(s)`
          : `Price from ${restaurant.source || restaurant.provider} × ${partySize} traveller(s)`,
    };
  }

  // No provider price — do NOT invent a price
  return {
    amount: null,
    currency,
    isEstimate: false,
    source: restaurant.source || restaurant.provider || 'unavailable',
    dataStatus: 'unavailable',
    estimateNote: 'No provider price available — not fabricated',
  };
}

// ══════════════════════════════════════════════════════════════════════
//  DESCRIPTION BUILDING
// ══════════════════════════════════════════════════════════════════════

function buildMealDescription(restaurant, mealType, foodPreference, breakdown) {
  const parts = [];

  const name = restaurant.name || restaurant.canonicalName;
  parts.push(`${capitalize(mealType)} at ${name}`);

  // Rating
  if (restaurant.rating) {
    parts.push(`Rating: ${restaurant.rating}/5`);
  }

  // Cuisine
  const cuisine = restaurant.cuisine || restaurant.cuisines;
  if (cuisine?.length) {
    parts.push(`Cuisine: ${Array.isArray(cuisine) ? cuisine.join(', ') : cuisine}`);
  }

  // Food preference match
  if (foodPreference) {
    const matchScore = foodPreferenceScore(restaurant, foodPreference);
    if (matchScore >= 0.7) {
      parts.push(`Matches ${foodPreference} preference`);
    }
  }

  // Price info
  if (restaurant.averageCostPerPerson > 0) {
    parts.push(`~₹${restaurant.averageCostPerPerson}/person`);
  } else {
    parts.push('Price unavailable');
  }

  return parts.join(' · ');
}

// ══════════════════════════════════════════════════════════════════════
//  UNAVAILABLE FALLBACK
// ══════════════════════════════════════════════════════════════════════

/**
 * Build a fallback meal entry when no validated restaurant is available.
 * Never invents a restaurant name.
 */
export function buildUnavailableMeal(mealType, destination) {
  const label = capitalize(mealType);
  const provenance = createUnavailableProvenance('none', `No validated restaurant available for ${label.toLowerCase()} in this area`);
  return {
    restaurant: null,
    title: `${label} at a local restaurant`,
    place: destination || '',
    description: `Recommended ${label.toLowerCase()} spot in the area.`,
    category: 'restaurant',
    address: '',
    coordinates: null,
    cost: {
      amount: null,
      currency: 'INR',
      isEstimate: false,
      source: 'unavailable',
      dataStatus: 'unavailable',
      estimateNote: 'No provider price available',
    },
    source: 'unavailable',
    isLive: false,
    dataStatus: 'unavailable',
    rating: null,
    openingHours: null,
    scoreBreakdown: null,
    provenance,
  };
}

// ══════════════════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════════════════

function restaurantKey(r) {
  return `${r.provider || r.source || ''}|${r.providerId || r.placeId || r.id || r.name || ''}`;
}

function extractCoordinates(r) {
  const lat = r.latitude ?? r.coordinates?.lat;
  const lng = r.longitude ?? r.coordinates?.lng;
  if (lat != null && lng != null) return { lat, lng };
  return null;
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

// ══════════════════════════════════════════════════════════════════════
//  PIPELINE: ASSIGN MEALS FOR ALL DAYS
// ══════════════════════════════════════════════════════════════════════

/**
 * Assign meals for all days of an itinerary.
 *
 * @param {object} opts
 * @param {Array}  opts.days - array of day objects with { date, attractionPool, restaurantPool }
 * @param {string} opts.foodPreference - user's food preference
 * @param {number} opts.mealBudget - per-person meal budget
 * @param {boolean} opts.logPipeline - whether to log results
 * @returns {object} { dayMeals, summary }
 */
export function assignMealsForAllDays({
  days = [],
  foodPreference = '',
  mealBudget = 0,
  logPipeline = true,
} = {}) {
  const globalUsed = new Set();
  const dayMeals = [];

  for (const day of days) {
    const restaurants = day.restaurantPool || day.restaurants || [];
    const dateStr = day.date || '';

    // Reference points from the day's activities
    const prevActivity = day.attractionPool?.[0] || null;
    const nextActivity = day.attractionPool?.[day.attractionPool.length - 1] || null;

    const meals = assignMealsForDay({
      restaurants,
      usedRestaurants: globalUsed,
      dateStr,
      dayNumber: day.dayNumber,
      foodPreference,
      previousActivity: prevActivity,
      nextActivity,
      mealBudget,
    });

    // Track used restaurants globally
    for (const key of meals.usedKeys) {
      globalUsed.add(key);
    }

    // Build fallbacks for missing meals
    const breakfast = meals.breakfast || buildUnavailableMeal('breakfast', day.zone || '');
    const lunch = meals.lunch || buildUnavailableMeal('lunch', day.zone || '');
    const dinner = meals.dinner || buildUnavailableMeal('dinner', day.zone || '');

    dayMeals.push({
      dayNumber: day.dayNumber,
      breakfast,
      lunch,
      dinner,
    });

    if (logPipeline) {
      const bName = breakfast.restaurant?.name || 'unavailable';
      const lName = lunch.restaurant?.name || 'unavailable';
      const dName = dinner.restaurant?.name || 'unavailable';
      logger.info(`[MEAL-ENGINE] Day ${day.dayNumber}: Breakfast="${bName}", Lunch="${lName}", Dinner="${dName}"`);
    }
  }

  // Summary
  const totalMeals = dayMeals.length * 3;
  const assigned = dayMeals.reduce((s, d) =>
    s + (d.breakfast.restaurant ? 1 : 0) + (d.lunch.restaurant ? 1 : 0) + (d.dinner.restaurant ? 1 : 0), 0);
  const unavailable = totalMeals - assigned;

  const summary = {
    totalDays: dayMeals.length,
    totalMeals,
    assigned,
    unavailable,
    uniqueRestaurants: globalUsed.size,
  };

  if (logPipeline) {
    logger.info(`[MEAL-ENGINE] Pipeline: ${assigned}/${totalMeals} meals assigned, ${globalUsed.size} unique restaurants`);
  }

  return { dayMeals, summary };
}

// ══════════════════════════════════════════════════════════════════════
//  EXPORTS
// ══════════════════════════════════════════════════════════════════════

export default {
  isRestaurantValid,
  isOpenForMeal,
  foodPreferenceScore,
  proximityScore,
  ratingScore,
  priceBudgetScore,
  scoreRestaurant,
  assignMealsForDay,
  assignMealsForAllDays,
  buildUnavailableMeal,
  MEAL_TIMES,
};
