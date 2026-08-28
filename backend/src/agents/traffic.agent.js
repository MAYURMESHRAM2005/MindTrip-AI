import mapsProvider from '../providers/maps.provider.js';
import logger from '../utils/logger.js';

/**
 * Traffic Agent: real Geoapify Routing/Matrix data.
 * Now purely provider-based — no Gemini calls. Traffic data is returned
 * directly from the provider with deterministic summaries.
 */
class TrafficAgent {
  constructor() {
    this.name = 'traffic';
    this._systemPrompt = '';
  }

  get systemPrompt() { return this._systemPrompt; }
  set systemPrompt(v) { this._systemPrompt = v; }

  async run({ destination, hotelName }) {
    logger.entry('[AGENT:traffic]', 'run', { destination, hotelName });
    const started = Date.now();
    const providerResult = await mapsProvider.directions(
      hotelName ? `${hotelName}, ${destination}` : destination,
      destination,
      'driving'
    );

    if (!providerResult.isLive) {
      return {
        agent: this.name,
        status: 'degraded',
        data: {
          isLive: false,
          transitNotes: 'Live traffic data unavailable. Travel durations in the itinerary are estimates.',
          suggestions: ['Use public transport during rush hours'],
          riskyLegs: [],
          message: providerResult.message,
        },
        message: providerResult.message,
        latencyMs: 0,
        usedAI: false,
        source: 'provider',
      };
    }

    const directions = providerResult.data;
    const routes = directions?.routes || [];
    logger.info(`[AGENT:traffic] Got ${routes.length} routes from Geoapify`);
    const mainRoute = routes[0] || {};

    // Deterministic suggestions from real routing data
    const suggestions = [];
    if (mainRoute.durationMin > 60) {
      suggestions.push('Long drive expected — consider breaking the journey with a stop');
    }
    if (routes.length > 1) {
      suggestions.push(`Alternative routes available (${routes.length} routes found)`);
    }
    suggestions.push('Use public transport during rush hours to avoid delays');

    const riskyLegs = [];
    if (mainRoute.steps) {
      for (const step of mainRoute.steps) {
        if (step.durationMin > 30) {
          riskyLegs.push({
            instruction: step.instruction,
            durationMin: step.durationMin,
          });
        }
      }
    }

    logger.exit('[AGENT:traffic]', 'run', { status: 'success', routeCount: routes.length, riskyLegs: riskyLegs.length, latencyMs: Date.now() - started });
    return {
      agent: this.name,
      status: 'success',
      data: {
        isLive: true,
        directions,
        transitNotes: mainRoute.summary || 'Driving route available',
        suggestions,
        riskyLegs,
      },
      message: `Traffic data from Geoapify (${routes.length} routes)`,
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

export default new TrafficAgent();
