import flightProvider from '../providers/flight.provider.js';
import logger from '../utils/logger.js';

/**
 * Flight Agent: Ignav real prices first; AviationStack fallback for live tracking.
 * Heuristic-based selection — no Gemini calls. Provider data is fetched and
 * the best option is selected by price (or duration when prices unavailable).
 */
class FlightAgent {
  constructor() {
    this.name = 'flight';
    this._systemPrompt = '';
  }

  get systemPrompt() { return this._systemPrompt; }
  set systemPrompt(v) { this._systemPrompt = v; }

  async run({ origin, destination, departDate, returnDate, adults, travelClass }) {
    logger.entry('[AGENT:flight]', 'run', { origin, destination, departDate, returnDate, adults, travelClass });
    const started = Date.now();
    const providerResult = await flightProvider.searchFlights({
      origin,
      destination,
      departDate,
      returnDate,
      adults,
      travelClass,
    });

    if (!providerResult.isLive) {
      logger.warn(`[AGENT:flight] Provider not live: ${providerResult.message}`);
      return {
        agent: this.name,
        status: 'degraded',
        data: { flights: [], selectedFlight: null, isLive: false, message: providerResult.message },
        message: providerResult.message,
        latencyMs: Date.now() - started,
        usedAI: false,
        source: 'provider',
      };
    }

    const flights = providerResult.data || [];
    logger.info(`[AGENT:flight] Got ${flights.length} flights from ${providerResult.source}`);
    const hasPrices = flights.some((f) => f.price?.amount);

    // Heuristic selection: cheapest by price, or shortest by duration
    let sorted;
    if (hasPrices) {
      sorted = [...flights].sort((a, b) => (a.price?.amount ?? Infinity) - (b.price?.amount ?? Infinity));
    } else {
      // Sort by duration string (rough heuristic)
      sorted = [...flights].sort((a, b) => {
        const durA = parseDurationMin(a.duration);
        const durB = parseDurationMin(b.duration);
        return durA - durB;
      });
    }

    const selected = sorted[0] || null;
    const alternatives = sorted.slice(1, 4);
    const cheapest = hasPrices ? sorted[0]?.price?.amount : null;

    logger.exit('[AGENT:flight]', 'run', { status: 'success', flightCount: flights.length, cheapest, hasPrices, latencyMs: Date.now() - started });
    return {
      agent: this.name,
      status: 'success',
      data: {
        flights,
        selectedFlight: selected,
        alternatives,
        recommendation: selected
          ? `Best option: ${selected.airline || ''} ${selected.flightNumber || ''} — ${hasPrices ? `${selected.price?.amount} ${selected.price?.currency || ''}` : 'no price available'}`
          : 'No flights available',
        isLive: true,
        cheapest,
      },
      message: `Flight data from provider (${flights.length} options)`,
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

/** Parse a duration string like "2h 30m" or "135" into minutes. */
function parseDurationMin(dur) {
  if (typeof dur === 'number') return dur;
  if (!dur) return Infinity;
  const str = String(dur);
  const h = parseInt(str.match(/(\d+)\s*h/i)?.[1] || '0', 10);
  const m = parseInt(str.match(/(\d+)\s*m/i)?.[1] || '0', 10);
  return h * 60 + m || Infinity;
}

export default new FlightAgent();
