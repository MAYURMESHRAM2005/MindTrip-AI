import weatherProvider from '../providers/weather.provider.js';
import logger from '../utils/logger.js';

/**
 * Weather Agent: real OpenWeatherMap forecast + current weather.
 * Now purely provider-based — no Gemini calls. Weather data is returned
 * directly from the provider with a deterministic summary.
 */
class WeatherAgent {
  constructor() {
    this.name = 'weather';
    this._systemPrompt = '';
  }

  get systemPrompt() { return this._systemPrompt; }
  set systemPrompt(v) { this._systemPrompt = v; }

  async run({ destination, startDate, endDate }) {
    logger.entry('[AGENT:weather]', 'run', { destination, startDate, endDate });
    const started = Date.now();
    const [providerResult, currentResult] = await Promise.all([
      weatherProvider.forecast({ city: destination }),
      weatherProvider.currentWeather({ city: destination }),
    ]);

    const base = {
      provider: providerResult.isLive ? 'live' : 'unavailable',
      providerMessage: providerResult.message,
      forecast: providerResult.data || null,
      current: currentResult.isLive ? currentResult.data : null,
    };

    if (!providerResult.isLive) {
      logger.warn(`[AGENT:weather] Provider not live: ${providerResult.message}`);
      return {
        agent: this.name,
        status: 'degraded',
        data: {
          ...base,
          summary: 'Weather forecast unavailable — plan flexible indoor/outdoor options.',
          advice: [],
          packing: [],
          warnings: [],
        },
        message: providerResult.message,
        latencyMs: 0,
        usedAI: false,
        source: 'provider',
      };
    }

    // Deterministic summary from forecast data
    const forecast = providerResult.data || [];
    const hasRain = forecast.some((f) => f.rainProbability >= 50);
    const maxTemp = Math.max(...forecast.map((f) => f.tempMax ?? 0));
    const minTemp = Math.min(...forecast.map((f) => f.tempMin ?? 100));

    const advice = [];
    const packing = [];
    const warnings = [];

    if (hasRain) {
      advice.push('Rain expected on some days — carry an umbrella and plan indoor alternatives');
      packing.push('Umbrella or rain jacket');
      warnings.push('Heavy rain possible — check local conditions before outdoor activities');
    }
    if (maxTemp > 35) {
      advice.push('High temperatures expected — stay hydrated and avoid midday sun');
      packing.push('Sunscreen, hat, and water bottle');
    }
    if (minTemp < 10) {
      advice.push('Cool mornings — layer up for early activities');
      packing.push('Light jacket or sweater');
    }
    packing.push('Comfortable walking shoes');
    packing.push('Reusable water bottle');

    const summary = `Weather for ${destination}: ${forecast.length} days forecast available. ` +
      `Temperature range: ${minTemp}°C – ${maxTemp}°C. ` +
      (hasRain ? 'Rain expected on some days.' : 'Mostly clear conditions expected.');

    logger.exit('[AGENT:weather]', 'run', { status: 'success', forecastDays: forecast.length, hasRain, maxTemp, minTemp, latencyMs: Date.now() - started });
    return {
      agent: this.name,
      status: 'success',
      data: {
        ...base,
        summary,
        advice,
        packing,
        warnings,
      },
      message: `Weather data from OpenWeatherMap (${forecast.length} days)`,
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

export default new WeatherAgent();
