import { BaseAgent } from './base.agent.js';
import { TRAFFIC_AGENT_PROMPT } from '../prompts/agentPrompts.js';
import mapsProvider from '../providers/maps.provider.js';

/**
 * Traffic Agent: real Google Directions/Distance Matrix first. When
 * unavailable it clearly marks travel durations as estimates.
 */
class TrafficAgent extends BaseAgent {
  constructor() {
    super('traffic');
    this.systemPrompt = TRAFFIC_AGENT_PROMPT;
  }

  async run({ destination, hotelName, userId }) {
    const providerResult = await mapsProvider.directions(
      hotelName ? `${hotelName}, ${destination}` : destination,
      destination,
      'driving'
    );

    if (!providerResult.isLive) {
      return {
        agent: this.name,
        status: 'degraded',
        data: {
          isLive: false,
          transitNotes: 'Live traffic data unavailable. Travel durations in the itinerary are estimates.',
          suggestions: ['Use public transport during rush hours'],
          message: providerResult.message,
        },
        message: providerResult.message,
        usedAI: false,
        source: 'provider',
      };
    }

    const result = await this.think({
      prompt: `Destination: ${destination}
Real directions data from Google Maps:
${JSON.stringify(providerResult.data, null, 2)}
Advise on realistic transit and risky legs using this data only.`,
      userId,
      action: 'trafficAdvice',
      data: providerResult.data,
    });

    if (result.status === 'success') {
      result.data = { ...result.data, isLive: true, directions: providerResult.data };
    } else {
      result.status = 'degraded';
      result.data = {
        isLive: true,
        directions: providerResult.data,
        transitNotes: 'Live directions retrieved; AI advice unavailable.',
        suggestions: [],
      };
    }
    return result;
  }
}

export default new TrafficAgent();
