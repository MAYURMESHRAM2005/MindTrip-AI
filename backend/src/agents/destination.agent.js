/**
 * Destination Agent: suggests a destination or validates the provided one.
 * Now purely deterministic — no Gemini calls. Uses a curated list of real
 * destinations by travel style.
 */
import logger from '../utils/logger.js';

class DestinationAgent {
  constructor() {
    this.name = 'destination';
    this._systemPrompt = '';
  }

  get systemPrompt() { return this._systemPrompt; }
  set systemPrompt(v) { this._systemPrompt = v; }

  /** Curated real destinations by travel style. */
  static CURATED = {
    romantic: 'Udaipur, India',
    adventure: 'Manali, India',
    family: 'Goa, India',
    budget: 'Pondicherry, India',
    backpacker: 'Rishikesh, India',
    business: 'Mumbai, India',
    luxury: 'Dubai, UAE',
    standard: 'Jaipur, India',
  };

  async suggest({ prefs, request }) {
    logger.entry('[AGENT:destination]', 'suggest', { destination: request.destination, travelStyle: prefs?.travelStyle, suggestDestination: request.suggestDestination });
    // If a specific destination was provided and it's non-empty, use it
    if (request.destination && !request.suggestDestination) {
      logger.exit('[AGENT:destination]', 'suggest', { status: 'success', destination: request.destination, source: 'user-provided' });
      return {
        agent: this.name,
        status: 'success',
        data: {
          destination: request.destination,
          reason: `Destination provided: ${request.destination}`,
          highlights: [],
        },
        message: `Destination provided: ${request.destination}`,
        latencyMs: 0,
        usedAI: false,
        source: 'deterministic',
      };
    }

    // Otherwise, suggest from curated list based on travel style
    const curated = DestinationAgent.CURATED;
    const destination = curated[prefs.travelStyle] || curated.standard;

    logger.exit('[AGENT:destination]', 'suggest', { status: 'success', destination, source: 'curated' });
    return {
      agent: this.name,
      status: 'success',
      data: {
        destination,
        reason: `Suggested from curated list based on ${prefs.travelStyle || 'standard'} travel style`,
        highlights: [],
      },
      message: `Destination suggested: ${destination}`,
      latencyMs: 0,
      usedAI: false,
      source: 'deterministic',
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

export default new DestinationAgent();
