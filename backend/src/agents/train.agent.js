import { BaseAgent } from './base.agent.js';
import { TRAIN_AGENT_PROMPT } from '../prompts/agentPrompts.js';
import trainProvider from '../providers/train.provider.js';

/**
 * Train Agent: real schedules from the configured provider. If the provider
 * is not configured, it returns an explicit "Live data unavailable" result
 * with provider status - it never fabricates schedules.
 */
class TrainAgent extends BaseAgent {
  constructor() {
    super('train');
    this.systemPrompt = TRAIN_AGENT_PROMPT;
  }

  async run({ from, to, date, passengers, trainClass, userId }) {
    const providerResult = await trainProvider.searchTrains({ from, to, date, passengers, trainClass });

    if (!providerResult.isLive) {
      return {
        agent: this.name,
        status: 'degraded',
        data: {
          trains: [],
          isLive: false,
          message: providerResult.message,
          providerStatus: trainProvider.providerStatus(),
        },
        message: providerResult.message,
        usedAI: false,
        source: 'provider',
      };
    }

    const result = await this.think({
      prompt: `Route: ${from} → ${to}, date ${date}, ${passengers} passenger(s).
Real train data from configured provider:
${JSON.stringify(providerResult.data, null, 2)}
Recommend options from this data only.`,
      userId,
      action: 'trainSelect',
      data: { trains: providerResult.data },
    });

    if (result.status === 'success') {
      result.data = { ...result.data, trains: providerResult.data, isLive: true };
    } else {
      result.status = 'degraded';
      result.data = { trains: providerResult.data, isLive: true };
    }
    return result;
  }
}

export default new TrainAgent();
