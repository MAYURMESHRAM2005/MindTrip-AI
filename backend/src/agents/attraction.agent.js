import { BaseAgent } from './base.agent.js';
import { ATTRACTION_AGENT_PROMPT } from '../prompts/agentPrompts.js';
import placesProvider from '../providers/places.provider.js';

/**
 * Attraction Agent: real Places attractions first; Gemini balances the list
 * around the traveler's interests and activity level.
 */
class AttractionAgent extends BaseAgent {
  constructor() {
    super('attraction');
    this.systemPrompt = ATTRACTION_AGENT_PROMPT;
  }

  async run({ destination, interests, activityLevel, userId }) {
    const providerResult = await placesProvider.textSearch({
      query: `${destination} top tourist attractions`,
      type: 'tourist_attraction',
      limit: 15,
    });

    if (!providerResult.isLive) {
      return {
        agent: this.name,
        status: 'degraded',
        data: { attractions: [], isLive: false, message: providerResult.message },
        message: providerResult.message,
        usedAI: false,
        source: 'provider',
      };
    }

    const result = await this.think({
      prompt: `Destination: ${destination}
Interests: ${interests?.join(', ') || 'general'}
Activity level: ${activityLevel || 'moderate'}
Real attraction data from Geoapify Places:
${JSON.stringify(providerResult.data, null, 2)}
Select a balanced set of must-see attractions from this list only.`,
      userId,
      action: 'attractionPlan',
      data: { attractions: providerResult.data },
    });

    if (result.status === 'success') {
      result.data = { ...result.data, attractions: providerResult.data, isLive: true };
    } else {
      result.status = 'degraded';
      result.data = { attractions: providerResult.data, isLive: true, dailyPlan: [] };
    }
    return result;
  }
}

export default new AttractionAgent();
