/**
 * Budget Agent: deterministic allocation + reasoning.
 * Now purely deterministic — no Gemini calls. The budget.service already
 * handles all arithmetic. This agent just produces suggestions.
 */
import logger from '../utils/logger.js';

class BudgetAgent {
  constructor() {
    this.name = 'budget';
    this._systemPrompt = '';
  }

  get systemPrompt() { return this._systemPrompt; }
  set systemPrompt(v) { this._systemPrompt = v; }

  async run({ allocation, totalBudget, currency, travelStyle, providerReport }) {
    logger.entry('[AGENT:budget]', 'run', { totalBudget, currency, travelStyle, providerReport });
    const suggestions = [];
    const risks = [];

    // Generate suggestions based on travel style and allocation
    if (travelStyle === 'budget' || travelStyle === 'backpacker') {
      suggestions.push('Prefer public transport for local hops to save on transport costs');
      suggestions.push('Book accommodation early for better rates');
    }
    if (travelStyle === 'luxury') {
      suggestions.push('Consider direct flights for comfort even if slightly more expensive');
      suggestions.push('Book premium hotels with flexible cancellation');
    }
    suggestions.push('Keep emergency reserve untouched unless absolutely necessary');
    suggestions.push('Book accommodation early for better rates');

    // Identify risks based on provider data
    if (!providerReport?.hotelsLive) {
      risks.push('Hotel prices are estimates — actual rates may vary at booking');
    }
    if (!providerReport?.flightsLive) {
      risks.push('Flight prices are estimates — check live prices before booking');
    }
    if (!providerReport?.weatherLive) {
      risks.push('Weather data unavailable — plan flexible indoor/outdoor options');
    }

    logger.exit('[AGENT:budget]', 'run', { status: 'success', suggestionCount: suggestions.length, riskCount: risks.length });
    return {
      agent: this.name,
      status: 'success',
      data: {
        suggestions,
        categoryPriorities: ['hotels', 'transport', 'food', 'activities'],
        risks,
        notes: 'Budget reasoning from deterministic engine',
      },
      message: 'Budget analysis completed deterministically',
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

export default new BudgetAgent();
