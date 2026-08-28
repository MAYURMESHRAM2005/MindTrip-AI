import placesProvider from '../providers/places.provider.js';
import logger from '../utils/logger.js';

/**
 * Attraction Agent: real Places attractions from Geoapify.
 * Now purely provider-based — no Gemini calls. Attractions are returned
 * directly from the provider.
 */
class AttractionAgent {
  constructor() {
    this.name = 'attraction';
    this._systemPrompt = '';
  }

  get systemPrompt() { return this._systemPrompt; }
  set systemPrompt(v) { this._systemPrompt = v; }

  async run({ destination, interests, activityLevel }) {
    logger.entry('[AGENT:attraction]', 'run', { destination, interests, activityLevel });
    const started = Date.now();
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
        latencyMs: 0,
        usedAI: false,
        source: 'provider',
      };
    }

    const attractions = providerResult.data || [];
    logger.exit('[AGENT:attraction]', 'run', { status: 'success', count: attractions.length, latencyMs: Date.now() - started });

    return {
      agent: this.name,
      status: 'success',
      data: {
        attractions,
        isLive: true,
        dailyPlan: [],
        notes: `Attraction data from Geoapify (${attractions.length} options)`,
      },
      message: `Attraction data from provider (${attractions.length} options)`,
      latencyMs: Date.now() - started,
      usedAI: false,
      source: 'provider',
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

export default new AttractionAgent();
