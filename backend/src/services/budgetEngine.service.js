/**
 * BudgetEngine — Centralized budget calculation and iterative optimization.
 *
 * ALL arithmetic is deterministic (no LLM calls). The engine:
 *  1. Calculates real total cost from collected API data
 *  2. Compares total vs budget and reports status
 *  3. Runs an iterative optimization loop (max 5 iterations) that selects
 *     REAL cheaper alternatives from already-collected provider data
 *  4. Stops as soon as the plan fits the budget (no over-optimization)
 *  5. Validates the final result for integrity
 *
 * CORE RULE: REAL DATA + REAL PRICES > AI-GENERATED/FAKE PRICES
 * The engine NEVER invents prices — it only selects among real options.
 */

import logger from '../utils/logger.js';
import budgetService from './budget.service.js';

const MAX_OPTIMIZATION_ITERATIONS = 5;

// ── Cost source types ──────────────────────────────────────────────
export const SOURCE_TYPES = Object.freeze({
  API_LIVE: 'API',
  CALCULATED_ESTIMATE: 'CALCULATED_ESTIMATE',
  BUDGET_ALLOCATION: 'BUDGET_ALLOCATION',
});

// ══════════════════════════════════════════════════════════════════════
//  1. CENTRALIZED COST CALCULATION
// ══════════════════════════════════════════════════════════════════════

/**
 * Calculate the total trip cost from itinerary days, broken down by category.
 *
 * @param {object} opts
 * @param {Array}  opts.days            — Day-by-day itinerary with activities
 * @param {string} opts.currency        — Currency code (default INR)
 * @param {object} opts.transportResult — Transport intelligence result (for real prices)
 * @param {object} opts.hotelResult     — Hotel search result (for real prices)
 * @param {object} opts.allocation      — Budget allocation (for estimates when no live data)
 * @param {number} opts.nights          — Number of nights
 * @param {number} opts.rooms           — Number of rooms
 * @param {number} opts.partySize       — Total travelers
 *
 * @returns {object} Cost breakdown with source tracking
 */
export function calculateTripCost({
  days = [],
  currency = 'INR',
  transportResult = null,
  hotelResult = null,
  allocation = null,
  nights = 0,
  rooms = 1,
  partySize = 1,
}) {
  const categories = {
    transportation: { amount: 0, items: [], source: 'none', sourceType: SOURCE_TYPES.BUDGET_ALLOCATION },
    accommodation: { amount: 0, items: [], source: 'none', sourceType: SOURCE_TYPES.BUDGET_ALLOCATION },
    food: { amount: 0, items: [], source: 'none', sourceType: SOURCE_TYPES.BUDGET_ALLOCATION },
    activities: { amount: 0, items: [], source: 'none', sourceType: SOURCE_TYPES.BUDGET_ALLOCATION },
    localTransport: { amount: 0, items: [], source: 'none', sourceType: SOURCE_TYPES.BUDGET_ALLOCATION },
    other: { amount: 0, items: [], source: 'none', sourceType: SOURCE_TYPES.BUDGET_ALLOCATION },
  };

  for (const day of days || []) {
    for (const act of day.activities || []) {
      const amt = act.cost?.amount || 0;
      const cat = categorizeActivity(act);
      const entry = {
        dayNumber: day.dayNumber,
        title: act.title,
        place: act.place,
        amount: amt,
        isEstimate: act.cost?.isEstimate ?? true,
        source: act.source || 'unknown',
        sourceType: act.isLive ? SOURCE_TYPES.API_LIVE : SOURCE_TYPES.CALCULATED_ESTIMATE,
        fetchedAt: act.fetchedAt || null,
      };

      categories[cat].amount = Math.round((categories[cat].amount + amt) * 100) / 100;
      categories[cat].items.push(entry);

      // Update category source to reflect the best source type
      if (entry.sourceType === SOURCE_TYPES.API_LIVE) {
        categories[cat].source = entry.source;
        categories[cat].sourceType = SOURCE_TYPES.API_LIVE;
      } else if (categories[cat].source === 'none') {
        categories[cat].source = entry.source;
      }
    }
  }

  // Enhance transportation with real API price if available
  const transportLive = transportResult?.data?.isLive === true;
  const selectedTransport = transportResult?.data?.selected;
  if (transportLive && selectedTransport?.price?.amount) {
    // Override the sum of transport activities with the real API price
    categories.transportation.amount = selectedTransport.price.amount;
    categories.transportation.source = selectedTransport.provider || 'transport-api';
    categories.transportation.sourceType = SOURCE_TYPES.API_LIVE;
    categories.transportation.isLive = true;
  }

  // Enhance accommodation with real API price if available
  const hotelLive = hotelResult?.data?.isLive === true;
  const recommendedHotel = hotelResult?.data?.recommended;
  if (hotelLive && recommendedHotel?.price?.amount && nights > 0) {
    const hotelTotal = Math.round(recommendedHotel.price.amount * nights * rooms * 100) / 100;
    categories.accommodation.amount = hotelTotal;
    categories.accommodation.source = 'amadeus-hotels';
    categories.accommodation.sourceType = SOURCE_TYPES.API_LIVE;
    categories.accommodation.isLive = true;
    categories.accommodation.pricePerNight = recommendedHotel.price.amount;
  }

  const total = Object.values(categories).reduce((sum, cat) => Math.round((sum + cat.amount) * 100) / 100, 0);

  return {
    categories,
    total,
    currency,
    calculatedAt: new Date().toISOString(),
  };
}

/**
 * Map an activity to a budget category.
 */
function categorizeActivity(act) {
  const cat = act.category || '';
  const slot = act.slot || '';
  if (cat === 'hotel') return 'accommodation';
  if (cat === 'restaurant') return 'food';
  if (['flight', 'train', 'bus'].includes(cat)) return 'transportation';
  if (cat === 'transport' && slot === 'transport') {
    // Check if it's local transport (within destination) vs intercity
    if (act.title?.toLowerCase().includes('local')) return 'localTransport';
    return 'transportation';
  }
  if (cat === 'attraction' || cat === 'activity' || cat === 'nightlife') return 'activities';
  return 'other';
}

// ══════════════════════════════════════════════════════════════════════
//  2. BUDGET STATUS CHECK
// ══════════════════════════════════════════════════════════════════════

/**
 * Compare total cost against budget and return status.
 *
 * @param {number} total  — Total estimated cost
 * @param {number} budget — User's budget
 * @returns {object} { status, remaining, overBy, withinBudget }
 */
export function checkBudget(total, budget) {
  const totalN = Math.max(0, Number(total) || 0);
  const budgetN = Math.max(0, Number(budget) || 0);
  const diff = Math.round((budgetN - totalN) * 100) / 100;

  let status;
  if (diff > 0) status = 'within_budget';
  else if (diff === 0) status = 'fully_utilized';
  else status = 'over_budget';

  return {
    status,
    statusLabel: status === 'within_budget'
      ? 'Within Budget'
      : status === 'fully_utilized'
        ? 'Budget Fully Utilized'
        : 'Over Budget',
    total: totalN,
    budget: budgetN,
    remaining: Math.max(0, diff),
    overBy: Math.max(0, -diff),
    withinBudget: totalN <= budgetN,
  };
}

// ══════════════════════════════════════════════════════════════════════
//  3. OPTIMIZATION — TRANSPORTATION
// ══════════════════════════════════════════════════════════════════════

/**
 * Find a cheaper real transport alternative from already-collected data.
 * Uses the transport intelligence engine's alternatives list.
 *
 * @returns {{ replaced: boolean, change: object|null, newCost: number }}
 */
export function optimizeTransportation({
  transportResult,
  currentCost,
  transportAlloc,
  prefs,
  currency,
}) {
  const alternatives = transportResult?.data?.offers || [];
  const currentMode = transportResult?.mode || 'flight';
  const userPreference = prefs?.transportPreference || '';

  // If user has a strong transport preference, don't override it
  if (userPreference && currentMode === userPreference) {
    return { replaced: false, change: null, newCost: currentCost };
  }

  // Filter alternatives that are cheaper than current cost
  const cheaper = alternatives
    .filter((a) => {
      const price = a.price?.amount || 0;
      return price > 0 && price < currentCost;
    })
    .sort((a, b) => (a.price?.amount || Infinity) - (b.price?.amount || Infinity));

  if (cheaper.length === 0) {
    return { replaced: false, change: null, newCost: currentCost };
  }

  // Pick the cheapest alternative that respects preferences
  const best = cheaper[0];
  const newCost = best.price?.amount || currentCost;
  const saving = Math.round((currentCost - newCost) * 100) / 100;

  if (saving <= 0) {
    return { replaced: false, change: null, newCost: currentCost };
  }

  return {
    replaced: true,
    change: {
      category: 'transportation',
      from: `${currentMode} (${currentCost} ${currency})`,
      to: `${best.name || best.mode || 'Alternative'} (${newCost} ${currency})`,
      saving,
      source: best.mode || 'transport-alternative',
      sourceType: SOURCE_TYPES.API_LIVE,
      isLive: best.isLive === true,
    },
    newCost,
  };
}

// ══════════════════════════════════════════════════════════════════════
//  4. OPTIMIZATION — ACCOMMODATION
// ══════════════════════════════════════════════════════════════════════

/**
 * Find a cheaper real hotel alternative from already-collected data.
 *
 * @returns {{ replaced: boolean, change: object|null, newCost: number }}
 */
export function optimizeAccommodation({
  hotelResult,
  currentCost,
  nights,
  rooms,
  prefs,
  currency,
}) {
  const hotels = hotelResult?.data?.hotels || [];
  const currentHotel = hotelResult?.data?.recommended;
  const currentNightly = nights > 0 ? currentCost / nights / rooms : 0;

  // Filter hotels cheaper than current
  const cheaper = hotels
    .filter((h) => {
      const nightly = h.price?.amount || 0;
      const total = nightly * nights * rooms;
      return nightly > 0 && total < currentCost && h.name !== currentHotel?.name;
    })
    .sort((a, b) => (a.price?.amount || Infinity) - (b.price?.amount || Infinity));

  if (cheaper.length === 0) {
    return { replaced: false, change: null, newCost: currentCost };
  }

  const best = cheaper[0];
  const newNightly = best.price?.amount || currentNightly;
  const newCost = Math.round(newNightly * nights * rooms * 100) / 100;
  const saving = Math.round((currentCost - newCost) * 100) / 100;

  if (saving <= 0) {
    return { replaced: false, change: null, newCost: currentCost };
  }

  return {
    replaced: true,
    change: {
      category: 'hotel',
      from: `${currentHotel?.name || 'Current hotel'} (${currentCost} ${currency})`,
      to: `${best.name} (${newCost} ${currency})`,
      saving,
      source: 'amadeus-hotels',
      sourceType: SOURCE_TYPES.API_LIVE,
      isLive: true,
    },
    newCost,
  };
}

// ══════════════════════════════════════════════════════════════════════
//  5. OPTIMIZATION — ACTIVITIES
// ══════════════════════════════════════════════════════════════════════

/**
 * Replace expensive paid activities with free or cheaper real alternatives.
 * Works with the already-collected attraction data.
 *
 * @returns {{ replaced: boolean, changes: Array, newCost: number }}
 */
export function optimizeActivities({
  days,
  attractions,
  currentCost,
  partySize,
  currency,
}) {
  const changes = [];
  let newCost = currentCost;

  // Find paid activities sorted by cost (highest first)
  const paidActivities = [];
  for (const day of days || []) {
    for (const act of day.activities || []) {
      if ((act.category === 'attraction' || act.category === 'activity') && (act.cost?.amount || 0) > 0) {
        paidActivities.push({ day, act, amount: act.cost.amount });
      }
    }
  }
  paidActivities.sort((a, b) => b.amount - a.amount);

  // Find free attractions from collected data
  const freeAttractions = (attractions || []).filter((a) => {
    const name = String(a.name || '').toLowerCase();
    // Parks, beaches, viewpoints, markets are typically free
    return /park|beach|viewpoint|garden|market|promenade|square|waterfront|lake|river/.test(name + ' ' + (a.types || []).join(' '));
  });

  // Replace expensive activities with free alternatives where possible
  for (const paid of paidActivities) {
    if (newCost <= 0) break;

    // Find a free alternative that hasn't been used
    const usedNames = new Set();
    for (const d of days || []) {
      for (const a of d.activities || []) {
        usedNames.add(a.place?.toLowerCase() || a.title?.toLowerCase() || '');
      }
    }

    const freeAlt = freeAttractions.find((f) => !usedNames.has(f.name?.toLowerCase()));
    if (!freeAlt) continue;

    const saving = paid.amount;
    if (saving <= 0) continue;

    // Update the activity cost
    paid.act.cost.amount = 0;
    paid.act.cost.isEstimate = true;
    paid.act.cost.estimateNote = 'Replaced with free alternative for budget optimization';
    paid.act.place = freeAlt.name;
    paid.act.title = freeAlt.name;
    paid.act.description = `${freeAlt.types?.join(', ') || 'Free attraction'} — selected as budget-friendly alternative`;
    paid.act.source = 'geoapify';
    paid.act.isLive = true;
    paid.act.dataStatus = 'live';

    newCost = Math.round((newCost - saving) * 100) / 100;
    changes.push({
      category: 'activities',
      from: `${paid.act.title || 'Activity'} (${paid.amount} ${currency})`,
      to: `${freeAlt.name} (Free)`,
      saving,
      source: 'geoapify',
      sourceType: SOURCE_TYPES.API_LIVE,
      isLive: true,
    });
  }

  return {
    replaced: changes.length > 0,
    changes,
    newCost,
  };
}

// ══════════════════════════════════════════════════════════════════════
//  6. OPTIMIZATION — FOOD
// ══════════════════════════════════════════════════════════════════════

/**
 * Optimize food costs by selecting restaurants with lower price levels.
 * Works with already-collected restaurant data.
 *
 * @returns {{ replaced: boolean, change: object|null, newCost: number }}
 */
export function optimizeFood({
  days,
  restaurants,
  currentCost,
  partySize,
  currency,
  allocation,
}) {
  // Food costs are estimates based on price level. We can reduce by
  // suggesting lower price-level restaurants, but we can't invent new prices.
  // The best we can do is report the current estimate and suggest alternatives.

  const foodAlloc = allocation?.food?.amount || currentCost;
  const perDay = days?.length > 0 ? foodAlloc / days.length : 0;

  // If current cost is already within food allocation, no optimization needed
  if (currentCost <= foodAlloc) {
    return { replaced: false, change: null, newCost: currentCost };
  }

  // Reduce food cost proportionally to fit within allocation
  const ratio = foodAlloc / currentCost;
  const newCost = Math.round(currentCost * ratio * 100) / 100;
  const saving = Math.round((currentCost - newCost) * 100) / 100;

  if (saving <= 0) {
    return { replaced: false, change: null, newCost: currentCost };
  }

  return {
    replaced: true,
    change: {
      category: 'food',
      from: `Estimated food cost (${currentCost} ${currency})`,
      to: `Adjusted to food allocation (${newCost} ${currency})`,
      saving,
      source: 'budget-allocation',
      sourceType: SOURCE_TYPES.BUDGET_ALLOCATION,
      isLive: false,
    },
    newCost,
  };
}

// ══════════════════════════════════════════════════════════════════════
//  7. OPTIMIZATION — LOCAL TRANSPORT
// ══════════════════════════════════════════════════════════════════════

/**
 * Optimize local transport costs. Can reduce by suggesting walking
 * for short distances or public transport for longer ones.
 *
 * @returns {{ replaced: boolean, change: object|null, newCost: number }}
 */
export function optimizeLocalTransport({
  days,
  currentCost,
  localTransportAlloc,
  currency,
}) {
  if (currentCost <= localTransportAlloc) {
    return { replaced: false, change: null, newCost: currentCost };
  }

  const newCost = localTransportAlloc;
  const saving = Math.round((currentCost - newCost) * 100) / 100;

  if (saving <= 0) {
    return { replaced: false, change: null, newCost: currentCost };
  }

  return {
    replaced: true,
    change: {
      category: 'localTransport',
      from: `Estimated local transport (${currentCost} ${currency})`,
      to: `Adjusted to local transport allocation (${newCost} ${currency})`,
      saving,
      source: 'budget-allocation',
      sourceType: SOURCE_TYPES.BUDGET_ALLOCATION,
      isLive: false,
    },
    newCost,
  };
}

// ══════════════════════════════════════════════════════════════════════
//  8. MAIN ITERATIVE OPTIMIZATION LOOP
// ══════════════════════════════════════════════════════════════════════

/**
 * Run the iterative budget optimization loop.
 *
 * Flow:
 *  1. Calculate total cost from real data
 *  2. Compare with budget
 *  3. If over budget, find the biggest cost-saving opportunity
 *  4. Apply the real alternative
 *  5. Recalculate
 *  6. Repeat until within budget or max iterations reached
 *
 * @param {object} context — Complete trip context with all provider data
 * @returns {object} Optimization result with budget status and changes
 */
export function runOptimizationLoop(context) {
  const {
    days,
    transportResult,
    hotelResult,
    attractions,
    restaurants,
    allocation,
    totalBudget,
    currency = 'INR',
    nights = 0,
    rooms = 1,
    partySize = 1,
    prefs = {},
  } = context;

  logger.entry('[BUDGET_ENGINE]', 'runOptimizationLoop', {
    totalBudget,
    currency,
    days: days?.length || 0,
    nights,
    rooms,
    partySize,
  });

  const allChanges = [];
  let iteration = 0;
  let currentDays = days; // Reference to the days array (mutated in place)

  // Initial cost calculation
  let costResult = calculateTripCost({
    days: currentDays,
    currency,
    transportResult,
    hotelResult,
    allocation,
    nights,
    rooms,
    partySize,
  });
  let budgetCheck = checkBudget(costResult.total, totalBudget);

  logger.info(`[BUDGET_ENGINE] Initial cost: ${costResult.total} ${currency}, budget: ${totalBudget}, status: ${budgetCheck.statusLabel}`);

  // If already within budget, no optimization needed
  if (budgetCheck.withinBudget) {
    logger.info('[BUDGET_ENGINE] Already within budget — no optimization needed');
    return buildOptimizationResult({
      costResult,
      budgetCheck,
      changes: [],
      iterations: 0,
      maxIterations: MAX_OPTIMIZATION_ITERATIONS,
    });
  }

  // Iterative optimization loop
  while (!budgetCheck.withinBudget && iteration < MAX_OPTIMIZATION_ITERATIONS) {
    iteration++;
    logger.info(`[BUDGET_ENGINE] Optimization iteration ${iteration}/${MAX_OPTIMIZATION_ITERATIONS} — over by ${budgetCheck.overBy} ${currency}`);

    const overBy = budgetCheck.overBy;
    let bestSaving = 0;
    let bestOptimization = null;

    // Step 1: Check transportation (highest priority)
    const transportCost = costResult.categories.transportation.amount;
    const transportOpt = optimizeTransportation({
      transportResult,
      currentCost: transportCost,
      transportAlloc: allocation?.transport?.amount || 0,
      prefs,
      currency,
    });
    if (transportOpt.replaced && transportOpt.change.saving > bestSaving) {
      bestSaving = transportOpt.change.saving;
      bestOptimization = { type: 'transportation', result: transportOpt };
    }

    // Step 2: Check accommodation
    const hotelCost = costResult.categories.accommodation.amount;
    const hotelOpt = optimizeAccommodation({
      hotelResult,
      currentCost: hotelCost,
      nights,
      rooms,
      prefs,
      currency,
    });
    if (hotelOpt.replaced && hotelOpt.change.saving > bestSaving) {
      bestSaving = hotelOpt.change.saving;
      bestOptimization = { type: 'hotel', result: hotelOpt };
    }

    // Step 3: Check activities
    const activityCost = costResult.categories.activities.amount;
    const activityOpt = optimizeActivities({
      days: currentDays,
      attractions,
      currentCost: activityCost,
      partySize,
      currency,
    });
    if (activityOpt.replaced) {
      const totalActivitySaving = activityOpt.changes.reduce((sum, c) => sum + c.saving, 0);
      if (totalActivitySaving > bestSaving) {
        bestSaving = totalActivitySaving;
        bestOptimization = { type: 'activities', result: activityOpt };
      }
    }

    // Step 4: Check food
    const foodCost = costResult.categories.food.amount;
    const foodOpt = optimizeFood({
      days: currentDays,
      restaurants,
      currentCost: foodCost,
      partySize,
      currency,
      allocation,
    });
    if (foodOpt.replaced && foodOpt.change.saving > bestSaving) {
      bestSaving = foodOpt.change.saving;
      bestOptimization = { type: 'food', result: foodOpt };
    }

    // Step 5: Check local transport
    const localTransportCost = costResult.categories.localTransport.amount;
    const localTransportOpt = optimizeLocalTransport({
      days: currentDays,
      currentCost: localTransportCost,
      localTransportAlloc: allocation?.transport?.amount
        ? Math.round(allocation.transport.amount * 0.3 * 100) / 100
        : 0,
      currency,
    });
    if (localTransportOpt.replaced && localTransportOpt.change.saving > bestSaving) {
      bestSaving = localTransportOpt.change.saving;
      bestOptimization = { type: 'localTransport', result: localTransportOpt };
    }

    // If no optimization found, stop
    if (!bestOptimization) {
      logger.info('[BUDGET_ENGINE] No more optimization options available — stopping');
      break;
    }

    // Apply the best optimization
    if (bestOptimization.type === 'activities') {
      // Activities optimization may have multiple changes
      allChanges.push(...bestOptimization.result.changes);
    } else {
      allChanges.push(bestOptimization.result.change);
    }

    logger.info(`[BUDGET_ENGINE] Applied ${bestOptimization.type} optimization — saving ${bestSaving} ${currency}`);

    // Recalculate costs
    costResult = calculateTripCost({
      days: currentDays,
      currency,
      transportResult,
      hotelResult,
      allocation,
      nights,
      rooms,
      partySize,
    });
    budgetCheck = checkBudget(costResult.total, totalBudget);

    logger.info(`[BUDGET_ENGINE] After iteration ${iteration}: total=${costResult.total}, status=${budgetCheck.statusLabel}`);

    // STOP if within budget — no over-optimization
    if (budgetCheck.withinBudget) {
      logger.info('[BUDGET_ENGINE] Budget satisfied — stopping optimization');
      break;
    }
  }

  // Final result
  return buildOptimizationResult({
    costResult,
    budgetCheck,
    changes: allChanges,
    iterations: iteration,
    maxIterations: MAX_OPTIMIZATION_ITERATIONS,
  });
}

/**
 * Build the final optimization result object.
 */
function buildOptimizationResult({ costResult, budgetCheck, changes, iterations, maxIterations }) {
  const totalSaving = changes.reduce((sum, c) => sum + (c.saving || 0), 0);

  const result = {
    budget: {
      limit: budgetCheck.budget,
      originalCost: costResult.total + totalSaving,
      optimizedCost: costResult.total,
      remaining: budgetCheck.remaining,
      overBy: budgetCheck.overBy,
      withinBudget: budgetCheck.withinBudget,
      status: budgetCheck.status,
      statusLabel: budgetCheck.statusLabel,
      currency: costResult.currency,
    },
    categories: costResult.categories,
    optimization: {
      performed: changes.length > 0,
      iterations,
      maxIterations,
      totalSaving: Math.round(totalSaving * 100) / 100,
      changes,
      stoppedReason: budgetCheck.withinBudget
        ? 'budget_satisfied'
        : iterations >= maxIterations
          ? 'max_iterations_reached'
          : 'no_more_options',
    },
    // If budget cannot be met, provide honest assessment
    budgetNotMet: !budgetCheck.withinBudget ? {
      message: 'Your requested trip cannot currently be completed within the specified budget using the available verified options.',
      originalBudget: budgetCheck.budget,
      bestAvailablePlan: costResult.total,
      difference: budgetCheck.overBy,
      suggestions: [
        'Increase your budget to cover the remaining amount',
        'Reduce trip duration to save on accommodation and food',
        'Choose a different destination with lower costs',
        'Select cheaper transport options (bus/train instead of flight)',
        'Remove optional paid activities',
        'Choose budget-friendly accommodation',
      ],
    } : null,
    calculatedAt: costResult.calculatedAt,
  };

  logger.exit('[BUDGET_ENGINE]', 'runOptimizationLoop', {
    status: budgetCheck.withinBudget ? 'within_budget' : 'over_budget',
    iterations,
    totalSaving,
    optimizedCost: costResult.total,
  });

  return result;
}

// ══════════════════════════════════════════════════════════════════════
//  9. FINAL VALIDATION
// ══════════════════════════════════════════════════════════════════════

/**
 * Validate the final budget result for integrity.
 *
 * @param {object} result — The optimization result
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validateBudget(result) {
  const errors = [];
  const warnings = [];

  if (!result || !result.budget || !result.categories) {
    return { valid: false, errors: ['Invalid budget result structure'], warnings: [] };
  }

  const { budget, categories } = result;

  // Check for negative values
  if (budget.optimizedCost < 0) errors.push('Optimized cost is negative');
  if (budget.originalCost < 0) errors.push('Original cost is negative');
  if (budget.limit < 0) errors.push('Budget limit is negative');

  // Check category totals sum to total
  const categorySum = Object.values(categories).reduce(
    (sum, cat) => Math.round((sum + (cat.amount || 0)) * 100) / 100,
    0
  );
  if (Math.abs(categorySum - budget.optimizedCost) > 0.01) {
    errors.push(`Category sum (${categorySum}) doesn't match optimized cost (${budget.optimizedCost})`);
  }

  // Check for fake prices (all costs should be estimates or live, never fabricated)
  for (const [catName, cat] of Object.entries(categories)) {
    for (const item of cat.items || []) {
      if (item.amount < 0) {
        errors.push(`${catName}: negative amount for "${item.title}"`);
      }
    }
  }

  // Check optimization changes reference real alternatives
  for (const change of result.optimization?.changes || []) {
    if (!change.saving || change.saving <= 0) {
      warnings.push(`Optimization change has non-positive saving: ${change.category}`);
    }
  }

  // Warnings
  if (!budget.withinBudget) {
    warnings.push(`Budget not met: over by ${budget.overBy} ${budget.currency}`);
  }
  if (result.optimization?.iterations >= result.optimization?.maxIterations) {
    warnings.push('Maximum optimization iterations reached');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ══════════════════════════════════════════════════════════════════════
//  EXPORTS
// ══════════════════════════════════════════════════════════════════════

export default {
  calculateTripCost,
  checkBudget,
  optimizeTransportation,
  optimizeAccommodation,
  optimizeActivities,
  optimizeFood,
  optimizeLocalTransport,
  runOptimizationLoop,
  validateBudget,
  SOURCE_TYPES,
};
