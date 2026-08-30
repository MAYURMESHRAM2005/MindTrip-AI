import placesProvider from '../providers/places.provider.js';
import zomatoProvider from '../providers/zomato.provider.js';
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
      limit: 20,
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

    // Enrich restaurants with Zomato real ratings and average meal costs
    let withZomatoData = 0;
    try {
      const restaurantNames = restaurants.map((r) => r.name).filter(Boolean);
      const zomatoMap = await zomatoProvider.enrichRestaurants(destination, restaurantNames, { maxSearches: 5 });
      for (const r of restaurants) {
        const lowerName = (r.name || '').toLowerCase();
        const zomato = zomatoMap.get(lowerName);
        if (zomato) {
          // Use Zomato's real ratings (replace null Geoapify ratings)
          if (zomato.rating != null) r.rating = zomato.rating;
          if (zomato.votes) r.reviewCount = zomato.votes;
          // Use Zomato's real average cost for two (replaces priceLevel estimate)
          if (zomato.averageCostForTwo > 0) {
            r.averageCostForTwo = zomato.averageCostForTwo;
            r.averageCostPerPerson = zomato.averageCostPerPerson;
            r.priceRange = zomato.priceRange;
          }
          // Merge cuisine data (Zomato is more specific)
          if (zomato.cuisines?.length) r.cuisines = zomato.cuisines;
          // Store Zomato source info
          r.zomatoData = {
            rating: zomato.rating,
            votes: zomato.votes,
            ratingText: zomato.ratingText,
            averageCostForTwo: zomato.averageCostForTwo,
            averageCostPerPerson: zomato.averageCostPerPerson,
            priceRange: zomato.priceRange,
            cuisines: zomato.cuisines,
            phone: zomato.phone,
            menuUrl: zomato.menuUrl,
            fetchedAt: zomato.fetchedAt,
          };
          withZomatoData++;
        }
      }
      logger.info(`[AGENT:restaurant] Enriched ${withZomatoData}/${restaurants.length} restaurants with Zomato data`);
    } catch (err) {
      logger.warn(`[AGENT:restaurant] Zomato enrichment failed: ${err.message}`);
    }

    // Deterministic: return restaurants directly, create simple recommendations
    const recommendations = restaurants.slice(0, 6).map((r) => ({
      name: r.name,
      rating: r.rating,
      priceLevel: r.priceLevel,
      priceRange: r.priceRange,
      averageCostPerPerson: r.averageCostPerPerson,
      cuisines: r.cuisines,
      address: r.address,
      types: r.types,
    }));

    logger.exit('[AGENT:restaurant]', 'run', { status: 'success', count: restaurants.length, withZomato: withZomatoData, latencyMs: Date.now() - started });
    return {
      agent: this.name,
      status: 'success',
      data: {
        restaurants,
        recommendations,
        isLive: true,
        mealPlan: [],
        notes: `Restaurant data from Geoapify (${restaurants.length} options, ${withZomatoData} with Zomato real pricing)`,
        zomatoEnriched: withZomatoData,
      },
      message: `Restaurant data from provider (${restaurants.length} options, ${withZomatoData} with real pricing)`,
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
