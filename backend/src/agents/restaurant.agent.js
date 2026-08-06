import { BaseAgent } from './base.agent.js';
import { RESTAURANT_AGENT_PROMPT } from '../prompts/agentPrompts.js';
import placesProvider from '../providers/places.provider.js';

/**
 * Restaurant Agent: real Google Places results first; Gemini builds a meal
 * plan from the provided list only.
 */
class RestaurantAgent extends BaseAgent {
  constructor() {
    super('restaurant');
    this.systemPrompt = RESTAURANT_AGENT_PROMPT;
  }

  async run({ destination, foodPreference, userId }) {
    const providerResult = await placesProvider.textSearch({
      query: `${destination} best restaurants`,
      type: 'restaurant',
      limit: 12,
    });

    if (!providerResult.isLive) {
      return {
        agent: this.name,
        status: 'degraded',
        data: { restaurants: [], recommendations: [], isLive: false, message: providerResult.message },
        message: providerResult.message,
        usedAI: false,
        source: 'provider',
      };
    }

    const result = await this.think({
      prompt: `Destination: ${destination}
Food preference: ${foodPreference || 'any'}
Real restaurant data from Google Places:
${JSON.stringify(providerResult.data, null, 2)}
Recommend restaurants matching the preference from this list only.`,
      userId,
      action: 'restaurantRecommend',
      data: { restaurants: providerResult.data },
    });

    if (result.status === 'success') {
      result.data = { ...result.data, restaurants: providerResult.data, isLive: true };
    } else {
      result.status = 'degraded';
      result.data = {
        restaurants: providerResult.data,
        recommendations: providerResult.data.slice(0, 4).map((r) => ({ name: r.name, rating: r.rating, priceLevel: r.priceLevel })),
        isLive: true,
      };
    }
    return result;
  }
}

export default new RestaurantAgent();
