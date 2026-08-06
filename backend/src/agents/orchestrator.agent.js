import { BaseAgent } from './base.agent.js';
import { ORCHESTRATOR_PROMPT } from '../prompts/agentPrompts.js';

/**
 * Orchestrator Agent: receives the raw trip request, produces the structured
 * summary consumed by all other agents, and coordinates the pipeline via
 * tripOrchestrator. This agent runs first.
 */
class OrchestratorAgent extends BaseAgent {
  constructor() {
    super('orchestrator');
    this.systemPrompt = ORCHESTRATOR_PROMPT;
  }

  computeDays(request) {
    const start = new Date(request.startDate);
    const end = new Date(request.endDate);
    if (isNaN(start) || isNaN(end)) return 1;
    return Math.max(1, Math.round((end - start) / 86400000) + 1);
  }

  async run({ request, userId }) {
    const days = this.computeDays(request);
    const result = await this.think({
      prompt: `Raw trip request:
${JSON.stringify(request, null, 2)}
Produce the coordination summary.`,
      userId,
      action: 'orchestrate',
    });

    if (result.status !== 'success') {
      result.status = 'degraded';
      result.data = {
        summary: {
          tripTitle: request.title || `${request.destination || 'Trip'} • ${days} days`,
          days,
          travelers: { adults: request.adults || 1, children: request.children || 0 },
          estimatedDurationDays: days,
        },
        focusAreas: ['budget', 'itinerary', 'safety'],
        notes: 'Orchestrator summary computed deterministically (AI unavailable)',
      };
    }
    result.data.summary = {
      ...result.data.summary,
      days: days || result.data.summary?.days,
      travelers: { adults: request.adults || 1, children: request.children || 0 },
    };
    return result;
  }
}

export default new OrchestratorAgent();
