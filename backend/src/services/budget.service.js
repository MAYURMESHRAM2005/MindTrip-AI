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
  sumCosts,
  optimizeCosts,
  buildBudgetReport,
};
