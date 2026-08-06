import { BaseAgent } from './base.agent.js';
import { LOCAL_GUIDE_AGENT_PROMPT } from '../prompts/agentPrompts.js';

/**
 * Local Guide Agent: cultural and practical tips. Uses general knowledge;
 * never invents specific prices, hours or availability.
 */
class LocalGuideAgent extends BaseAgent {
  constructor() {
    super('localGuide');
    this.systemPrompt = LOCAL_GUIDE_AGENT_PROMPT;
  }

  async run({ destination, travelStyle, userId }) {
    const result = await this.think({
      prompt: `Destination: ${destination}
Travel style: ${travelStyle || 'standard'}
Share genuine local tips, etiquette, hidden gems and useful phrases for this destination.`,
      userId,
      action: 'localGuide',
    });

    if (result.status !== 'success') {
      result.status = 'degraded';
      result.data = {
        localTips: ['Respect local customs and dress codes at religious sites', 'Carry small change for local markets and tips'],
        etiquette: [],
        hiddenGems: [],
        languagePhrases: [],
        paymentNotes: 'Carry a mix of cash and cards.',
      };
    }
    return result;
  }
}

export default new LocalGuideAgent();
