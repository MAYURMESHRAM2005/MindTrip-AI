/**
 * Final Validator Agent: runs the mandatory checklist.
 * Now purely deterministic — no Gemini calls. The deterministic checks
 * (budget, dates, overlaps, labelling) run in code; AI review is removed
 * since the itinerary builder already enforces budget constraints.
 */
import logger from '../utils/logger.js';

class FinalValidatorAgent {
  constructor() {
    this.name = 'finalValidator';
    this._systemPrompt = '';
  }

  get systemPrompt() { return this._systemPrompt; }
  set systemPrompt(v) { this._systemPrompt = v; }

  _timeToMinutes(t) {
    if (!t || !t.includes(':')) return null;
    const [h, m] = t.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return null;
    return h * 60 + m;
  }

  runDeterministic({ days, budget, totalEstimatedCost, destination, origin, prefs }) {
    const issues = [];
    const warnings = [];

    // 1. Budget check
    if (totalEstimatedCost > budget) {
      issues.push(`Estimated cost (${totalEstimatedCost}) exceeds budget (${budget})`);
    }

    // 1b. Duplicate places / restaurants / costs across days
    const seenAttractions = new Map();
    const seenRestaurants = new Map();
    const attractionCosts = new Map();
    const duplicatePlaces = [];
    const duplicateRestaurants = [];
    let duplicateCosts = 0;
    for (const day of days || []) {
      for (const act of day.activities || []) {
        const title = String(act.title || '').trim();
        const name = String(act.place || '').trim();
        if (!name) continue;
        if (act.category === 'attraction' || act.category === 'activity') {
          if (seenAttractions.has(name)) {
            duplicatePlaces.push(`${name} (Day ${seenAttractions.get(name)} & Day ${day.dayNumber})`);
          } else {
            seenAttractions.set(name, day.dayNumber);
          }
        }
        if (act.category === 'restaurant') {
          if (seenRestaurants.has(name)) {
            duplicateRestaurants.push(`${name} (Day ${seenRestaurants.get(name)} & Day ${day.dayNumber})`);
          } else {
            seenRestaurants.set(name, day.dayNumber);
          }
        }
        const amt = act.cost?.amount;
        if ((act.category === 'attraction' || act.category === 'activity') && typeof amt === 'number' && amt > 0) {
          if (!attractionCosts.has(amt)) attractionCosts.set(amt, new Set());
          attractionCosts.get(amt).add(title);
        }
      }
    }
    for (const titles of attractionCosts.values()) {
      if (titles.size > 1) duplicateCosts += 1;
    }
    if (duplicatePlaces.length) {
      warnings.push(`Duplicate attractions/activities across days: ${duplicatePlaces.slice(0, 4).join(', ')}`);
    }
    if (duplicateRestaurants.length) {
      warnings.push(`Duplicate restaurants across days: ${duplicateRestaurants.slice(0, 4).join(', ')}`);
    }
    if (duplicateCosts > 0) {
      warnings.push(`${duplicateCosts} activity cost(s) identical across different items - verify estimates`);
    }

    // 2. Dates consistency
    for (const day of days || []) {
      const d = new Date(day.date);
      if (isNaN(d)) issues.push(`Day ${day.dayNumber} has an invalid date`);
      const wrongDates = (day.activities || []).filter((a) => a.dataStatus === 'unavailable');
      if (wrongDates.length) {
        warnings.push(`Day ${day.dayNumber}: ${wrongDates.length} items lack live data and are marked unavailable`);
      }
    }

    // 3. Overlaps - duration-aware
    const DURATION_MIN = {
      transport: 30, flight: 30, train: 30, bus: 30,
      restaurant: 60, attraction: 120, activity: 90,
      free: 60, other: 45,
      hotel: 0, weather: 0, safety: 0,
    };
    const OVERLAP_BUFFER = 10;
    for (const day of days || []) {
      const blocks = [];
      for (const act of day.activities || []) {
        const start = this._timeToMinutes(act.time);
        if (start === null) continue;
        const duration = DURATION_MIN[act.category] ?? 45;
        if (duration <= 0) continue;
        const end = start + duration;
        for (const b of blocks) {
          if (start < b.end - OVERLAP_BUFFER && b.start < end - OVERLAP_BUFFER) {
            issues.push(`Day ${day.dayNumber}: "${act.title}" at ${act.time} overlaps "${b.title}"`);
          }
        }
        blocks.push({ start, end, title: act.title });
      }
    }

    // 4. Hotel matches destination
    if (days?.length && days[0]?.activities?.length) {
      const hotelActs = days[0].activities.filter((a) => a.category === 'hotel' || a.place === destination);
      if (!hotelActs.length) warnings.push('No accommodation entry found on day 1');
    }

    // 5. Transport matches route
    const transportActs = (days?.[0]?.activities || []).filter((a) =>
      ['flight', 'train', 'bus', 'transport'].includes(a.category)
    );
    if (origin && transportActs.length === 0) {
      warnings.push('No outbound transport entry found - verify your route');
    }

    // 6. Restaurants match preferences
    if (prefs?.foodPreference) {
      const restaurantActs = days?.flatMap((d) => d.activities).filter((a) => a.category === 'restaurant') || [];
      const mismatched = restaurantActs.filter((a) => a.dataStatus === 'unavailable' && !a.notes?.includes('estimate'));
      if (mismatched.length) {
        warnings.push('Some restaurant choices could not be verified against live data');
      }
    }

    // 7. Labelling checks
    const estimates = days?.flatMap((d) => d.activities).filter((a) => a.cost?.isEstimate === true) || [];
    if (estimates.length) warnings.push(`${estimates.length} costs are estimates (flagged)`);

    const passed = issues.length === 0;

    return {
      passed,
      issues,
      warnings,
      summary: issues.length
        ? `Validation failed with ${issues.length} issue(s)`
        : `Validation passed with ${warnings.length} warning(s)`,
      fixesApplied: [],
      duplicatePlaces,
      duplicateRestaurants,
      duplicateCosts,
      duplicatesFound: duplicatePlaces.length > 0 || duplicateRestaurants.length > 0 || duplicateCosts > 0,
    };
  }

  async run({ days, budget, totalEstimatedCost, destination, origin, prefs, userId }) {
    logger.entry('[AGENT:finalValidator]', 'run', { dayCount: days?.length || 0, budget, totalEstimatedCost, destination });
    const deterministic = this.runDeterministic({ days, budget, totalEstimatedCost, destination, origin, prefs });
    logger.exit('[AGENT:finalValidator]', 'run', { status: deterministic.passed ? 'success' : 'degraded', issues: deterministic.issues.length, warnings: deterministic.warnings.length, passed: deterministic.passed, duplicatesFound: deterministic.duplicatesFound });

    return {
      agent: this.name,
      status: deterministic.passed ? 'success' : 'degraded',
      data: { ...deterministic, aiReview: 'Deterministic validation only — AI review removed for performance' },
      message: `Validated by deterministic checks (${deterministic.issues.length} issues, ${deterministic.warnings.length} warnings)`,
      latencyMs: 0,
      usedAI: false,
      source: 'deterministic',
    };
  }

  report(result) {
    return {
      agent: this.name,
      status: result.status,
      message: result.message,
      latencyMs: result.latencyMs,
      usedAI: result.usedAI,
    };
  }
}

export default new FinalValidatorAgent();
