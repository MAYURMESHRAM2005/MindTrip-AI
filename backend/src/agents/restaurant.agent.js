import placesProvider from '../providers/places.provider.js';
import logger from '../utils/logger.js';

/**
 * Restaurant Agent: real Geoapify Places results.
 * Now purely provider-based — no Gemini calls. Restaurants are returned
 * directly from the provider, sorted by relevance.
 */
class RestaurantAgent {
  constructor() {
    this.name = 'restaurant';
    this._systemPrompt = '';
  }

  get systemPrompt() { return this._systemPrompt; }
  set systemPrompt(v) { this._systemPrompt = v; }

  async run({ destination, foodPreference }) {
    logger.entry('[AGENT:restaurant]', 'run', { destination, foodPreference });
    const started = Date.now();
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
        latencyMs: 0,
        usedAI: false,
        source: 'provider',
      };
    }

    const restaurants = providerResult.data || [];
    logger.info(`[AGENT:restaurant] Got ${restaurants.length} restaurants from Geoapify`);

    // Deterministic: return restaurants directly, create simple recommendations
    const recommendations = restaurants.slice(0, 6).map((r) => ({
      name: r.name,
      rating: r.rating,
      priceLevel: r.priceLevel,
      address: r.address,
      types: r.types,
    }));

    logger.exit('[AGENT:restaurant]', 'run', { status: 'success', count: restaurants.length, latencyMs: Date.now() - started });
    return {
      agent: this.name,
      status: 'success',
      data: {
        restaurants,
        recommendations,
        isLive: true,
        mealPlan: [],
        notes: `Restaurant data from Geoapify (${restaurants.length} options)`,
      },
      message: `Restaurant data from provider (${restaurants.length} options)`,
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

export default new RestaurantAgent();
