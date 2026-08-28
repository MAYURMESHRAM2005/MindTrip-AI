/**
 * Safety Agent: practical safety guidance using general knowledge.
 * Now purely deterministic — no Gemini calls.
 */
import logger from '../utils/logger.js';

class SafetyAgent {
  constructor() {
    this.name = 'safety';
    this._systemPrompt = '';
  }

  get systemPrompt() { return this._systemPrompt; }
  set systemPrompt(v) { this._systemPrompt = v; }

  async run({ destination }) {
    logger.entry('[AGENT:safety]', 'run', { destination });
    const result = {
      agent: this.name,
      status: 'success',
      data: {
        safetyTips: [
          'Save your hotel address and share it with someone you trust',
          'Use the Emergency Center page for nearby hospitals, police and pharmacies',
          'Keep digital and physical copies of important documents',
          'Use registered taxis or ride-sharing apps for transport',
          'Keep valuables in a secure bag and be aware of your surroundings',
        ],
        scamAlerts: [
          'Be cautious of unlicensed tour guides offering unsolicited help',
          'Verify prices before accepting services from street vendors',
        ],
        healthNotes: 'Drink bottled water and check local health advisories before traveling.',
        emergencyAdvice: 'Use the Emergency Center for verified contacts — do not rely on unofficial sources',
        insuranceAdvice: 'Consider travel insurance covering medical emergencies and trip cancellation.',
      },
      message: 'Safety guidance generated from general knowledge',
      latencyMs: 0,
      usedAI: false,
      source: 'deterministic',
    };
    logger.exit('[AGENT:safety]', 'run', { status: 'success', safetyTips: result.data.safetyTips.length, scamAlerts: result.data.scamAlerts.length });
    return result;
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

export default new SafetyAgent();
