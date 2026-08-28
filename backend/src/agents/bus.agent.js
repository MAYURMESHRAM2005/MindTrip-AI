import busProvider from '../providers/bus.provider.js';
import logger from '../utils/logger.js';

/**
 * Bus Agent: live schedules from Pay2all or configured fallback.
 * Heuristic-based selection — no Gemini calls.
 */
class BusAgent {
  constructor() {
    this.name = 'bus';
    this._systemPrompt = '';
  }

  get systemPrompt() { return this._systemPrompt; }
  set systemPrompt(v) { this._systemPrompt = v; }

  async run({ from, to, date, passengers }) {
    logger.entry('[AGENT:bus]', 'run', { from, to, date, passengers });
    const started = Date.now();
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
        latencyMs: 0,
        usedAI: false,
        source: 'provider',
      };
    }

    const buses = providerResult.data || [];
    logger.info(`[AGENT:bus] Got ${buses.length} bus results from ${providerResult.source}`);

    // Heuristic: select earliest departure
    const selected = buses[0] || null;
    const alternatives = buses.slice(1, 4);
    const cheapest = [...buses]
      .filter((b) => b.price?.amount)
      .sort((a, b) => (a.price?.amount ?? Infinity) - (b.price?.amount ?? Infinity))[0];

    logger.exit('[AGENT:bus]', 'run', { status: 'success', busCount: buses.length, selected: selected?.operator || selected?.name || 'none', latencyMs: Date.now() - started });
    return {
      agent: this.name,
      status: 'success',
      data: {
        buses,
        selected,
        alternatives,
        recommendation: selected
          ? `${selected.operator || selected.name || 'Bus'} — departs ${selected.departure || selected.departureTime || 'N/A'}`
          : 'No buses available',
        cheapest,
        isLive: true,
      },
      message: `Bus data from provider (${buses.length} options)`,
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

export default new BusAgent();
