import { BaseAgent } from './base.agent.js';
import { BUS_AGENT_PROMPT } from '../prompts/agentPrompts.js';
import busProvider from '../providers/bus.provider.js';

/**
 * Bus Agent: real schedules from the configured provider. If the provider is
 * not configured, an explicit "Live data unavailable" result is returned.
 */
class BusAgent extends BaseAgent {
  constructor() {
    super('bus');
    this.systemPrompt = BUS_AGENT_PROMPT;
  }

  async run({ from, to, date, passengers, userId }) {
    const providerResult = await busProvider.searchBuses({ from, to, date, passengers });

    if (!providerResult.isLive) {
      return {
        agent: this.name,
        status: 'degraded',
        data: {
          buses: [],
          isLive: false,
          message: providerResult.message,
          providerStatus: busProvider.providerStatus(),
        },
        message: providerResult.message,
        usedAI: false,
        source: 'provider',
      };
    }

    const result = await this.think({
      prompt: `Route: ${from} → ${to}, date ${date}, ${passengers} passenger(s).
Real bus data from configured provider:
${JSON.stringify(providerResult.data, null, 2)}
Recommend options from this data only.`,
      userId,
      action: 'busSelect',
      data: { buses: providerResult.data },
    });

    if (result.status === 'success') {
      result.data = { ...result.data, buses: providerResult.data, isLive: true };
    } else {
      result.status = 'degraded';
      result.data = { buses: providerResult.data, isLive: true };
    }
    return result;
  }
}

export default new BusAgent();
