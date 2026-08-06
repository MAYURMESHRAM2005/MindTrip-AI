import { BaseAgent } from './base.agent.js';
import { DESTINATION_AGENT_PROMPT } from '../prompts/agentPrompts.js';

/**
 * Suggests a destination when the user asked for one, otherwise validates the
 * provided destination.
 */
class DestinationAgent extends BaseAgent {
  constructor() {
    super('destination');
    this.systemPrompt = DESTINATION_AGENT_PROMPT;
  }

  async suggest({ prefs, request, userId }) {
    const result = await this.think({
      prompt: `Suggest a destination for this traveler:
Travel style: ${prefs.travelStyle}
Interests: ${prefs.interests?.join(', ') || 'general'}
Budget: ${request.totalBudget} ${request.currency}
Days: ${this._days(request)}
Food preference: ${prefs.foodPreference || 'any'}
Origin: ${request.origin || 'not specified'}
Only suggest real destinations.`,
      userId,
      action: 'suggestDestination',
    });

    if (result.status === 'success' && result.data?.destination) {
      return result;
    }
    // Deterministic fallback: curated real destinations by style
    const curated = {
      romantic: 'Udaipur, India',
      adventure: 'Manali, India',
      family: 'Goa, India',
      budget: 'Pondicherry, India',
      backpacker: 'Rishikesh, India',
      business: 'Mumbai, India',
      luxury: 'Dubai, UAE',
      standard: 'Jaipur, India',
    };
    result.status = 'degraded';
    result.data = {
      destination: curated[prefs.travelStyle] || 'Jaipur, India',
      reason: 'Suggested from curated destination list (Gemini unavailable).',
      highlights: [],
    };
    result.message = 'Destination suggested from curated list (AI unavailable)';
    return result;
  }

  _days(request) {
    const start = new Date(request.startDate);
    const end = new Date(request.endDate);
    if (isNaN(start) || isNaN(end)) return 3;
    return Math.max(1, Math.round((end - start) / 86400000));
  }
}

export default new DestinationAgent();
