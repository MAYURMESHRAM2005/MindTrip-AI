/**
 * Orchestrator Agent: produces the structured summary consumed by all other
 * agents. This agent is now purely deterministic — no Gemini calls needed.
 * The trip title, days and traveler count are computed from the raw request.
 */
import logger from '../utils/logger.js';

class OrchestratorAgent {
  constructor() {
    this.name = 'orchestrator';
    this._systemPrompt = '';
  }

  get systemPrompt() { return this._systemPrompt; }
  set systemPrompt(v) { this._systemPrompt = v; }

  computeDays(request) {
    const start = new Date(request.startDate);
    const end = new Date(request.endDate);
    if (isNaN(start) || isNaN(end)) return 1;
    return Math.max(1, Math.round((end - start) / 86400000) + 1);
  }

  async run({ request }) {
    const days = this.computeDays(request);
    logger.entry('[AGENT:orchestrator]', 'run', { destination: request.destination, startDate: request.startDate, endDate: request.endDate, days });
    const result = {
      agent: this.name,
      status: 'success',
      data: {
        summary: {
          tripTitle: request.title || `${request.destination || 'Trip'} • ${days} days`,
          days,
          travelers: {
            adults: request.adults || 1,
            children: request.children || 0,
          },
          estimatedDurationDays: days,
        },
        focusAreas: ['budget', 'itinerary', 'safety'],
        notes: 'Orchestrator summary computed deterministically',
      },
      message: 'Orchestration summary computed',
      latencyMs: 0,
      usedAI: false,
      source: 'deterministic',
    };
    logger.exit('[AGENT:orchestrator]', 'run', { status: 'success', days, travelers: result.data?.summary?.travelers });
    return result;
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

export default new OrchestratorAgent();
