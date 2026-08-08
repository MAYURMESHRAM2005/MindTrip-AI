import { BaseAgent } from './base.agent.js';
import { WEATHER_AGENT_PROMPT } from '../prompts/agentPrompts.js';
import weatherProvider from '../providers/weather.provider.js';

/**
 * Fetches real weather FIRST (forecast + current, for sunrise/sunset), then
 * lets Gemini advise on how to adapt the itinerary. When the provider or AI
 * is unavailable the result degrades gracefully - never invented weather.
 */
class WeatherAgent extends BaseAgent {
  constructor() {
    super('weather');
    this.systemPrompt = WEATHER_AGENT_PROMPT;
  }

  async run({ destination, startDate, endDate, userId }) {
    const [providerResult, currentResult] = await Promise.all([
      weatherProvider.forecast({ city: destination }),
      weatherProvider.currentWeather({ city: destination }),
    ]);

    const base = {
      provider: providerResult.isLive ? 'live' : 'unavailable',
      providerMessage: providerResult.message,
      forecast: providerResult.data || null,
      current: currentResult.isLive ? currentResult.data : null,
    };

    if (!providerResult.isLive) {
      return {
        agent: this.name,
        status: 'degraded',
        data: {
          ...base,
          summary: 'Weather forecast unavailable - plan flexible indoor/outdoor options.',
          advice: [],
          packing: [],
          warnings: [],
        },
        message: providerResult.message,
        usedAI: false,
        source: 'provider',
      };
    }

    const result = await this.think({
      prompt: `Destination: ${destination}
Trip dates: ${startDate} to ${endDate}
Real forecast data:
${JSON.stringify(providerResult.data, null, 2)}
Advise per-day adjustments, packing and warnings based ONLY on this data.`,
      userId,
      action: 'weatherAdvice',
      data: base,
    });

    if (result.status === 'success') {
      result.data = { ...result.data, provider: 'live', providerMessage: providerResult.message, forecast: providerResult.data };
    } else {
      result.status = 'degraded';
      result.data = {
        ...base,
        summary: 'Live forecast retrieved; AI advice unavailable.',
        perDay: [],
        packing: [],
        warnings: [],
      };
    }
    return result;
  }
}

export default new WeatherAgent();
