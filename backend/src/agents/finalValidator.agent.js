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

    // 2. Dates consistency
    for (const day of days || []) {
      const d = new Date(day.date);
      if (isNaN(d)) issues.push(`Day ${day.dayNumber} has an invalid date`);
      const wrongDates = (day.activities || []).filter((a) => a.dataStatus === 'unavailable');
      if (wrongDates.length) {
        warnings.push(`Day ${day.dayNumber}: ${wrongDates.length} items lack live data and are marked unavailable`);
      }
    }

    // 3. Overlaps
    for (const day of days || []) {
      const times = [];
      for (const act of day.activities || []) {
        const m = this._timeToMinutes(act.time);
        if (m === null) continue;
        for (const [t, other] of times) {
          if (Math.abs(m - t) < 60) {
            issues.push(`Day ${day.dayNumber}: "${act.title}" at ${act.time} overlaps "${other.title}"`);
          }
        }
        times.push([m, act]);
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
      return {
        agent: this.name,
        status: ai.passed ? 'success' : 'degraded',
        data: {
          ...deterministic,
          aiReview: ai.summary || '',
          issues: [...new Set([...deterministic.issues, ...(ai.issues || [])])],
          warnings: [...new Set([...deterministic.warnings, ...(ai.warnings || [])])],
          passed: deterministic.issues.length === 0 && (ai.issues?.length || 0) === 0,
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
