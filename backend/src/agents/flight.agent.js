import { BaseAgent } from './base.agent.js';
import { FLIGHT_AGENT_PROMPT } from '../prompts/agentPrompts.js';
import flightProvider from '../providers/flight.provider.js';

/**
 * Flight Agent: real Amadeus offers first; Gemini selects the best option.
 * No AI output is ever treated as a real schedule or price.
 */
class FlightAgent extends BaseAgent {
  constructor() {
    super('flight');
    this.systemPrompt = FLIGHT_AGENT_PROMPT;
  }

  async run({ origin, destination, departDate, returnDate, adults, travelClass, userId }) {
    const providerResult = await flightProvider.searchFlights({
      origin,
      destination,
      departDate,
      returnDate,
      adults,
      travelClass,
    });

    if (!providerResult.isLive) {
      return {
        agent: this.name,
        status: 'degraded',
        data: { flights: [], selectedFlight: null, isLive: false, message: providerResult.message },
        message: providerResult.message,
        usedAI: false,
        source: 'provider',
      };
    }

    const result = await this.think({
      prompt: `Route: ${origin} → ${destination}, depart ${departDate}${returnDate ? `, return ${returnDate}` : ''}, ${adults} adult(s), class ${travelClass}.
Real flight offers from Amadeus:
${JSON.stringify(providerResult.data, null, 2)}
Select the best offer and list alternatives from this data only.`,
      userId,
      action: 'flightSelect',
      data: { flights: providerResult.data },
    });

    if (result.status === 'success') {
      result.data = { ...result.data, flights: providerResult.data, isLive: true };
    } else {
      result.status = 'degraded';
      result.data = {
        flights: providerResult.data,
        selectedFlight: providerResult.data[0] || null,
        alternatives: providerResult.data.slice(1, 3),
        isLive: true,
      };
    }
    return result;
  }
}

export default new FlightAgent();
