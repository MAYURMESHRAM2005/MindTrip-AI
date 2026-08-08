import { DEFAULT_BUDGET_SPLIT } from '../utils/constants.js';

/**
 * Deterministic budget engine. All arithmetic here is plain code - the LLM
 * never computes money. Testable and predictable.
 */

/** Default percentage split across broad categories. */
export const DEFAULT_ALLOCATION = {
  transport: 0.28,
  hotels: 0.3,
  food: 0.2,
  activities: 0.1,
  misc: 0.07,
  emergencyReserve: 0.05,
};

/**
 * Allocate a total budget across categories.
 * @returns allocation with amounts and percentages
 */
export function allocateBudget(total, split = DEFAULT_ALLOCATION) {
  if (!Number.isFinite(total) || total < 0) throw new Error('Invalid budget');
  const out = {};
  let used = 0;
  for (const [key, pct] of Object.entries(split)) {
    const amount = Math.round(total * pct * 100) / 100;
    out[key] = { pct: Math.round(pct * 1000) / 10, amount };
    used += amount;
  }
  // Adjust for rounding drift so the parts always sum to the total.
  const diff = Math.round((total - used) * 100) / 100;
  out.emergencyReserve.amount = Math.round((out.emergencyReserve.amount + diff) * 100) / 100;
  return out;
}

/**
 * Travel-style aware allocation. Different styles shift weight between
 * categories (e.g. luxury spends more on hotels, adventure on activities).
 */
export function allocationForStyle(style, total) {
  const base = { ...DEFAULT_ALLOCATION };
  const shifts = {
    luxury: { hotels: 0.38, food: 0.24, activities: 0.08, transport: 0.2, misc: 0.06, emergencyReserve: 0.04 },
    budget: { hotels: 0.2, food: 0.25, activities: 0.12, transport: 0.3, misc: 0.08, emergencyReserve: 0.05 },
    backpacker: { hotels: 0.16, food: 0.28, activities: 0.14, transport: 0.3, misc: 0.07, emergencyReserve: 0.05 },
    family: { hotels: 0.34, food: 0.22, activities: 0.1, transport: 0.22, misc: 0.07, emergencyReserve: 0.05 },
    business: { hotels: 0.36, food: 0.18, activities: 0.04, transport: 0.3, misc: 0.08, emergencyReserve: 0.04 },
    adventure: { hotels: 0.2, food: 0.2, activities: 0.22, transport: 0.26, misc: 0.07, emergencyReserve: 0.05 },
    romantic: { hotels: 0.34, food: 0.24, activities: 0.1, transport: 0.2, misc: 0.08, emergencyReserve: 0.04 },
    standard: DEFAULT_ALLOCATION,
  };
  return allocateBudget(total, shifts[style] || base);
}

/**
 * Number of hotel rooms a party needs. 2 adults per room; children share
 * their parents' rooms; solo groups always get at least 1 room.
 * Deterministic so hotel math is consistent everywhere.
 */
export function roomsForParty({ adults = 1, children = 0 } = {}) {
  const a = Math.max(0, Number(adults) || 0);
  const c = Math.max(0, Number(children) || 0);
  if (a <= 0 && c <= 0) return 1;
  const adultRooms = Math.ceil(a / 2);
  // Children occupy a room only when there are no adults to share with.
  const childRooms = a === 0 ? Math.ceil(c / 2) : 0;
  return Math.max(1, adultRooms + childRooms);
}

/**
 * Budget utilization report — the headline numbers shown on the itinerary.
 * { total, spent, remaining, usedPct, withinBudget }
 */
export function budgetUtilization({ total, spent }) {
  const totalN = Math.max(0, Number(total) || 0);
  const spentN = Math.max(0, Number(spent) || 0);
  const remaining = Math.round((totalN - spentN) * 100) / 100;
  const usedPct = totalN > 0 ? Math.min(100, Math.round((spentN / totalN) * 1000) / 10) : 0;
  return { total: totalN, spent: spentN, remaining, usedPct, withinBudget: spentN <= totalN };
}

/**
 * Spread each category's allocation across the trip as a daily envelope.
 * Hotels are spread across nights (not days), food across days, and the
 * transport budget across the trip (intercity legs use half each).
 * Returns { perDay, totals } where perDay is the daily envelope map.
 */
export function planDailyBudgets({ allocation, daysCount = 1, nights = 0, rooms = 1 }) {
  const alloc = allocation || {};
  const safeDays = Math.max(1, Number(daysCount) || 1);
  const safeNights = Math.max(0, Number(nights) || 0);
  const safeRooms = Math.max(1, Number(rooms) || 1);
  const amt = (k) => Math.round((alloc[k]?.amount || 0) * 100) / 100;
  const perDay = {
    food: Math.round((amt('food') / safeDays) * 100) / 100,
    activities: Math.round((amt('activities') / safeDays) * 100) / 100,
    misc: Math.round((amt('misc') / safeDays) * 100) / 100,
    transport: Math.round((amt('transport') / Math.max(1, safeDays)) * 100) / 100,
    hotelPerRoomNight: safeNights > 0 ? Math.round((amt('hotels') / safeNights / safeRooms) * 100) / 100 : 0,
  };
  const totals = {
    food: perDay.food * safeDays,
    activities: perDay.activities * safeDays,
    misc: perDay.misc * safeDays,
    transport: amt('transport'),
    hotels: amt('hotels'),
  };
  return { perDay, totals };
}

/**
 * Sum a list of cost items.
 */
export function sumCosts(items) {
  return items.reduce((sum, i) => sum + (Number(i?.amount) || 0), 0);
}

/**
 * Optimize an itinerary's estimated costs down to fit a budget.
 *
 * @param items       array of {id, category, amount, droppable, priority}
 * @param budget      total budget (number)
 * @param options     { emergencyReserve } amount that must remain untouched
 * @returns {original, optimized, saved, remaining, dropped, reductions, withinBudget}
 */
export function optimizeCosts(items, budget, { emergencyReserve = 0 } = {}) {
  const original = sumCosts(items);
  const target = Math.max(0, budget - emergencyReserve);
  let current = original;
  const reductions = [];
  const dropped = [];

  // 1. Drop droppable low-priority items first (priority = higher dropped first)
  const droppable = items
    .filter((i) => i.droppable)
    .sort((a, b) => (b.priority || 1) - (a.priority || 1));

  for (const item of droppable) {
    if (current <= target) break;
    current -= Number(item.amount) || 0;
    dropped.push(item);
  }

  // 2. If still over, apply a proportional reduction to flexible items so the
  //    plan converges to the target budget (reductions stay flagged as estimates)
  const flexible = items.filter((i) => !dropped.includes(i) && i.flexible);
  if (current > target && flexible.length) {
    const over = current - target;
    const flexibleTotal = sumCosts(flexible);
    if (flexibleTotal > 0) {
      const factor = Math.max(0, Math.min(1, (flexibleTotal - over) / flexibleTotal));
      for (const item of flexible) {
        const newAmount = Math.round(Number(item.amount) * factor);
        reductions.push({
          id: item.id,
          category: item.category,
          from: item.amount,
          to: newAmount,
          note: `Reduced ${item.category} cost to fit budget`,
        });
      }
      current =
        sumCosts(flexible.map((i) => ({ amount: i.amount * factor }))) +
        sumCosts(items.filter((i) => !dropped.includes(i) && !flexible.includes(i)));
    }
  }

  const saved = Math.max(0, original - current);
  return {
    original: Math.round(original * 100) / 100,
    optimized: Math.round(current * 100) / 100,
    saved: Math.round(saved * 100) / 100,
    remaining: Math.round(Math.max(0, budget - current) * 100) / 100,
    dropped: dropped.map((d) => ({ id: d.id, category: d.category, amount: d.amount })),
    reductions,
    withinBudget: current <= budget,
  };
}

/**
 * Build a full budget report from an itinerary and user budget.
 */
export function buildBudgetReport({ totalBudget, currency, allocation, categories, totalEstimatedCost, optimized }) {
  return {
    totalBudget,
    currency,
    allocation,
    categories,
    totalEstimatedCost,
    optimized,
    remainingBudget: Math.round((totalBudget - totalEstimatedCost) * 100) / 100,
  };
}

export default {
  DEFAULT_ALLOCATION,
  allocateBudget,
  allocationForStyle,
  roomsForParty,
  budgetUtilization,
  planDailyBudgets,
  sumCosts,
  optimizeCosts,
  buildBudgetReport,
};
