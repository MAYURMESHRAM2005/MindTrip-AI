import { BaseAgent } from './base.agent.js';
import { SAFETY_AGENT_PROMPT } from '../prompts/agentPrompts.js';

/**
 * Safety Agent: practical guidance. Deliberately does NOT invent emergency
 * phone numbers - it points users to the Emergency Center instead.
 */
class SafetyAgent extends BaseAgent {
  constructor() {
    super('safety');
    this.systemPrompt = SAFETY_AGENT_PROMPT;
  }

  async run({ destination, userId }) {
    const result = await this.think({
      prompt: `Destination: ${destination}
Provide practical safety tips for this destination. Do not invent emergency phone numbers; tell the user to check the Emergency Center for verified contacts.`,
      userId,
      action: 'safety',
    });

    if (result.status !== 'success') {
      result.status = 'degraded';
      result.data = {
        safetyTips: [
          'Save your hotel address and share it with someone you trust',
          'Use the Emergency Center page for nearby hospitals, police and pharmacies',
          'Keep digital and physical copies of important documents',
        ],
        scamAlerts: [],
        healthNotes: 'Drink bottled water and check local health advisories.',
        emergencyAdvice: 'Use the Emergency Center for verified contacts',
        insuranceAdvice: 'Consider travel insurance covering medical emergencies.',
      };
    }
    return result;
  }
}

export default new SafetyAgent();
