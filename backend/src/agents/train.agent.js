import trainProvider from '../providers/train.provider.js';
import logger from '../utils/logger.js';

/**
 * Train Agent: real schedules from the configured provider.
 * Heuristic-based selection — no Gemini calls.
 */
class TrainAgent {
  constructor() {
    this.name = 'train';
    this._systemPrompt = '';
  }

  get systemPrompt() { return this._systemPrompt; }
  set systemPrompt(v) { this._systemPrompt = v; }

  async run({ from, to, date, passengers, trainClass }) {
    logger.entry('[AGENT:train]', 'run', { from, to, date, passengers, trainClass });
    const started = Date.now();
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
        latencyMs: 0,
        usedAI: false,
        source: 'provider',
      };
    }

    const trains = providerResult.data || [];
    logger.info(`[AGENT:train] Got ${trains.length} train results from ${providerResult.source}`);

    // Heuristic: select the first available train (earliest departure)
    const selected = trains[0] || null;
    const alternatives = trains.slice(1, 4);

    logger.exit('[AGENT:train]', 'run', { status: 'success', trainCount: trains.length, selected: selected?.trainName || selected?.trainNumber || 'none', latencyMs: Date.now() - started });
    return {
      agent: this.name,
      status: 'success',
      data: {
        trains,
        selected,
        alternatives,
        recommendation: selected
          ? `${selected.trainName || selected.trainNumber || 'Train'} — departs ${selected.departure || selected.departureTime || 'N/A'}`
          : 'No trains available',
        isLive: true,
      },
      message: `Train data from provider (${trains.length} options)`,
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

export default new TrainAgent();
