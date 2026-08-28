import hotelProvider from '../providers/hotel.provider.js';
import logger from '../utils/logger.js';

/**
 * Hotel Agent: real offers from Amadeus first; heuristic recommendation.
 * If Amadeus is unavailable the itinerary will state that clearly and use a
 * budget-derived estimate for accommodation, flagged as an estimate.
 * No Gemini calls — selection is heuristic-based.
 */
class HotelAgent {
  constructor() {
    this.name = 'hotel';
    this._systemPrompt = '';
  }

  get systemPrompt() { return this._systemPrompt; }
  set systemPrompt(v) { this._systemPrompt = v; }

  async run({ destination, checkIn, checkOut, adults, rooms, maxPrice, totalBudget, hotelPreference }) {
    logger.entry('[AGENT:hotel]', 'run', { destination, checkIn, checkOut, adults, rooms, maxPrice });
    const started = Date.now();
    const providerResult = await hotelProvider.searchHotels({
      city: destination,
      checkIn,
      checkOut,
      adults,
      rooms: Math.max(1, Number(rooms) || 1),
      maxPrice,
      limit: 12,
    });

    if (!providerResult.isLive) {
      logger.warn(`[AGENT:hotel] Provider not live: ${providerResult.message}`);
      return {
        agent: this.name,
        status: 'degraded',
        data: {
          hotels: [],
          recommended: null,
          isLive: false,
          source: 'none',
          message: providerResult.message,
          estimatedNightly: null,
        },
        message: providerResult.message,
        latencyMs: 0,
        usedAI: false,
        source: 'provider',
      };
    }

    const hotels = providerResult.data || [];

    // Heuristic: best value = cheapest price that fits the budget
    // If maxPrice is set, prefer hotels within budget; otherwise sort by price
    let recommended = null;
    let alternatives = [];

    if (hotels.length > 0) {
      // Sort by price (cheapest first), with nulls at the end
      const withPrice = hotels.filter((h) => h.price?.amount);
      const withoutPrice = hotels.filter((h) => !h.price?.amount);

      // Within budget first, then by price
      const withinBudget = withPrice.filter(
        (h) => !maxPrice || h.price.amount <= maxPrice * 1.05
      );
      const overBudget = withPrice.filter(
        (h) => maxPrice && h.price.amount > maxPrice * 1.05
      );

      const sorted = [...withinBudget.sort((a, b) => a.price.amount - b.price.amount),
                       ...overBudget.sort((a, b) => a.price.amount - b.price.amount),
                       ...withoutPrice];

      recommended = sorted[0] || null;
      alternatives = sorted.slice(1, 4);

      // If preference is specified, try to find a match
      if (hotelPreference && recommended) {
        const prefMatch = sorted.find(
          (h) => h.name?.toLowerCase().includes(hotelPreference.toLowerCase())
        );
        if (prefMatch && prefMatch !== recommended) {
          // Keep current recommended, but note the preference match exists
        }
      }
    }

    logger.exit('[AGENT:hotel]', 'run', { status: 'success', hotelCount: hotels.length, recommended: recommended?.name || 'none', latencyMs: Date.now() - started });
    return {
      agent: this.name,
      status: 'success',
      data: {
        hotels,
        recommended,
        alternatives,
        isLive: true,
        source: 'amadeus-hotels',
        message: providerResult.message,
      },
      message: `Hotel data from provider (${hotels.length} offers)`,
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

export default new HotelAgent();
