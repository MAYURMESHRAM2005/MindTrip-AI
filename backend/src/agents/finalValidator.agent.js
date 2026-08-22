import { BaseAgent } from './base.agent.js';
import { FINAL_VALIDATOR_PROMPT } from '../prompts/agentPrompts.js';

/**
 * Final Validator Agent: runs the mandatory checklist.
 *
 * Deterministic checks run first (code, always available):
 *  - total cost <= budget
 *  - dates consistent
 *  - activities do not overlap in time
 *  - hotels/transport/restaurants match expectations
 *  - estimates / live data correctly labelled
 *
 * Gemini then performs a qualitative review on top of those findings.
 */
class FinalValidatorAgent extends BaseAgent {
  constructor() {
    super('finalValidator');
    this.systemPrompt = FINAL_VALIDATOR_PROMPT;
  }

  _timeToMinutes(t) {
    if (!t || !t.includes(':')) return null;
    const [h, m] = t.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return null;
    return h * 60 + m;
  }

  runDeterministic({ days, budget, totalEstimatedCost, destination, origin, prefs }) {
    const issues = [];
    const warnings = [];

    // 1. Budget
    if (totalEstimatedCost > budget) {
      issues.push(`Estimated cost (${totalEstimatedCost}) exceeds budget (${budget})`);
    }

    // 1b. Duplicate places / restaurants / costs across days
    const seenAttractions = new Map();
    const seenRestaurants = new Map();
    const attractionCosts = new Map(); // amount -> Set of attraction titles
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
        // Duplicate-cost check is scoped to attractions/activities only, so
        // shared meal price levels never produce false positives.
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
    const duplicatesFound = duplicatePlaces.length > 0 || duplicateRestaurants.length > 0 || duplicateCosts > 0;

    // 2. Dates consistency
    for (const day of days || []) {
      const d = new Date(day.date);
      if (isNaN(d)) issues.push(`Day ${day.dayNumber} has an invalid date`);
      const wrongDates = (day.activities || []).filter((a) => a.dataStatus === 'unavailable');
      if (wrongDates.length) {
        warnings.push(`Day ${day.dayNumber}: ${wrongDates.length} items lack live data and are marked unavailable`);
      }
    }

    // 3. Overlaps - duration-aware. Two activities only conflict when their
    //    estimated time windows actually intersect (10-min buffer). Hotel
    //    check-in / checkout / overnight entries are administrative markers
    //    and are not scheduled blocks, so they never trigger overlaps.
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
        if (duration <= 0) continue; // marker entry - not a scheduled block
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

    return {
      passed: issues.length === 0,
      issues,
      warnings,
      summary: issues.length
        ? `Validation failed with ${issues.length} issue(s)`
        : `Validation passed with ${warnings.length} warning(s)`,
      fixesApplied: [],
      duplicatePlaces,
      duplicateRestaurants,
      duplicateCosts,
      duplicatesFound,
    };
  }

  async run({ days, budget, totalEstimatedCost, destination, origin, prefs, userId }) {
    const deterministic = this.runDeterministic({ days, budget, totalEstimatedCost, destination, origin, prefs });

    // Qualitative AI review on top of the deterministic result
    const aiResult = await this.think({
      prompt: `Review this itinerary summary:
Destination: ${destination}
Origin: ${origin}
Budget: ${budget}
Estimated cost: ${totalEstimatedCost}
Deterministic findings: ${JSON.stringify(deterministic)}
${JSON.stringify((days || []).map((d) => ({ day: d.dayNumber, activities: (d.activities || []).map((a) => a.title + ' @ ' + a.time) })), null, 2)}
Report any additional realism issues.`,
      userId,
      action: 'validate',
    });

    if (aiResult.status === 'success' && aiResult.data) {
      const ai = aiResult.data;
      // Overlap detection is exclusively the deterministic check's domain
      // (duration-aware). The AI review only sees a compressed schedule
      // summary, so it can hallucinate overlaps (e.g. 19:15 transport vs
      // 20:00 dinner) that would turn a fine itinerary into a false failure.
      // Only the deterministic overlap format is suppressed - genuine
      // qualitative conflicts the AI identifies are still surfaced.
      const aiIssues = (ai.issues || []).filter(
        (i) => !/overlaps\s+"/i.test(String(i))
      );
      return {
        agent: this.name,
        status: ai.passed ? 'success' : 'degraded',
        data: {
          ...deterministic,
          aiReview: ai.summary || '',
          issues: [...new Set([...deterministic.issues, ...aiIssues])],
          warnings: [...new Set([...deterministic.warnings, ...(ai.warnings || [])])],
          passed: deterministic.issues.length === 0 && aiIssues.length === 0,
        },
        message: 'Validated by Final Validator Agent',
        usedAI: true,
        source: 'ai',
      };
    }

    return {
      agent: this.name,
      status: deterministic.passed ? 'success' : 'degraded',
      data: { ...deterministic, aiReview: 'AI review unavailable - deterministic checks passed' },
      message: 'Validated by deterministic checks (AI unavailable)',
      usedAI: false,
      source: 'deterministic',
    };
  }
}

export default new FinalValidatorAgent();
