import placesProvider from '../providers/places.provider.js';
import viatorProvider from '../providers/viator.provider.js';
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
      limit: 30,
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

    let attractions = providerResult.data || [];

    // Fetch opening hours for ALL attractions with valid placeIds.
    // The batchPlaceDetails function uses an in-memory cache (24h TTL) so
    // previously-fetched places return instantly with zero API credits.
    const placeIds = attractions.map((a) => a.placeId).filter(Boolean);
    if (placeIds.length > 0) {
      try {
        const detailsMap = await placesProvider.batchPlaceDetails(placeIds, { concurrency: 8 });
        // Merge opening hours into attractions
        for (const attr of attractions) {
          const details = detailsMap.get(attr.placeId);
          if (details?.openingHours) {
            attr.openingHours = details.openingHours;
            attr.openingHoursRaw = details.openingHoursRaw;
          }
        }
        const withHours = attractions.filter((a) => a.openingHours).length;
        const cacheSize = placesProvider.getDetailsCacheSize();
        logger.info(`[AGENT:attraction] Enriched ${withHours}/${placeIds.length} attractions with opening hours (cache: ${cacheSize} entries)`);
      } catch (err) {
        logger.warn(`[AGENT:attraction] Failed to fetch opening hours: ${err.message}`);
      }
    }

    // Enrich attractions with Viator real pricing (entry fees, tour prices)
    let withViatorPricing = 0;
    try {
      const attractionNames = attractions.map((a) => a.name).filter(Boolean);
      const viatorMap = await viatorProvider.enrichAttractionsWithPricing(
        destination,
        attractionNames,
        'INR',
        { maxPerAttraction: 2, maxTotal: 8 },
      );
      for (const attr of attractions) {
        const lowerName = (attr.name || '').toLowerCase();
        const viatorProducts = viatorMap.get(lowerName);
        if (viatorProducts?.length) {
          // Pick the best-priced product as the entry fee reference
          const withPrice = viatorProducts.filter((p) => p.fromPrice?.amount > 0);
          const cheapest = withPrice.sort((a, b) => a.fromPrice.amount - b.fromPrice.amount)[0];
          if (cheapest) {
            attr.entryFee = {
              amount: cheapest.fromPrice.amount,
              currency: cheapest.fromPrice.currency || 'INR',
              isEstimate: false,
              source: 'viator',
              productCode: cheapest.productCode,
              productTitle: cheapest.title,
              fetchedAt: cheapest.fetchedAt,
            };
            attr.viatorPricing = viatorProducts.map((p) => ({
              productCode: p.productCode,
              title: p.title,
              fromPrice: p.fromPrice,
              rating: p.rating,
              reviewCount: p.reviewCount,
              duration: p.duration,
              url: `https://www.viator.com/tours/${p.productCode}`,
            }));
            withViatorPricing++;
          }
        }
      }
      logger.info(`[AGENT:attraction] Enriched ${withViatorPricing}/${attractions.length} attractions with Viator pricing`);
    } catch (err) {
      logger.warn(`[AGENT:attraction] Viator pricing enrichment failed: ${err.message}`);
    }

    logger.exit('[AGENT:attraction]', 'run', { status: 'success', count: attractions.length, withOpeningHours: attractions.filter((a) => a.openingHours).length, latencyMs: Date.now() - started });

    return {
      agent: this.name,
      status: 'success',
      data: {
        attractions,
        isLive: true,
        dailyPlan: [],
        notes: `Attraction data from Geoapify (${attractions.length} options, ${attractions.filter((a) => a.openingHours).length} with opening hours, ${withViatorPricing} with Viator pricing)`,
        viatorEnriched: withViatorPricing,
      },
      message: `Attraction data from provider (${attractions.length} options, ${withViatorPricing} with real pricing)`,
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
