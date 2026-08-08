import { BaseAgent } from './base.agent.js';
import { HOTEL_AGENT_PROMPT } from '../prompts/agentPrompts.js';
import hotelProvider from '../providers/hotel.provider.js';

/**
 * Hotel Agent: real offers from Amadeus first; Gemini picks the best fit.
 * If Amadeus is unavailable the itinerary will state that clearly and use a
 * budget-derived estimate for accommodation, flagged as an estimate.
 */
class HotelAgent extends BaseAgent {
  constructor() {
    super('hotel');
    this.systemPrompt = HOTEL_AGENT_PROMPT;
  }

  async run({ destination, checkIn, checkOut, adults, rooms, maxPrice, totalBudget, hotelPreference, userId }) {
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
      return {
        agent: this.name,
        status: 'degraded',
        data: {
          hotels: [],
          recommended: null,
          isLive: false,
          source: 'none',
          message: providerResult.message,
          estimatedNightly: null, // filled by itinerary service from budget
        },
        message: providerResult.message,
        usedAI: false,
        source: 'provider',
      };
    }

    const result = await this.think({
      prompt: `Real hotel offers for ${destination} (${checkIn} to ${checkOut}), ${adults} adults, ${rooms || 1} room(s), max stay price ${maxPrice ?? 'no cap'}, preference: ${hotelPreference || 'any'}:
${JSON.stringify(providerResult.data, null, 2)}
Recommend the best fit from these offers only.`,
      userId,
      action: 'hotelRecommend',
      data: { isLive: true, hotels: providerResult.data },
    });

    if (result.status === 'success') {
      result.data = {
        ...result.data,
        hotels: providerResult.data,
        isLive: true,
        source: 'amadeus-hotels',
        message: providerResult.message,
      };
    } else {
      result.status = 'degraded';
      result.data = {
        hotels: providerResult.data,
        recommended: providerResult.data[0] || null,
        alternatives: providerResult.data.slice(1, 4),
        isLive: true,
        source: 'amadeus-hotels',
        message: 'Live offers retrieved; AI recommendation unavailable.',
      };
    }
    return result;
  }
}

export default new HotelAgent();
