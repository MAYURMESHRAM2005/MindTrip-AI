import { weatherApi } from './apiClient';

/**
 * Frontend weather service — a thin proxy over the backend.
 *
 * All OpenWeatherMap calls (current weather and forecast) happen on the
 * backend via /api/weather/current and /api/weather/forecast. The frontend
 * never talks to OpenWeatherMap directly and never holds an API key.
 *
 * Every method resolves to a `{ ...payload, isLive, message }` object and never
 * rejects for provider/network failures — the UI decides what to show.
 */

function errMessage(err, fallback) {
  return err?.response?.data?.message || err?.message || fallback;
}

export async function getCurrentWeather({ city, lat, lng, units = 'metric' } = {}) {
  try {
    const res = await weatherApi.current({ city, lat, lng, units });
    const payload = res.data?.data;
    return {
      weather: payload?.weather ?? null,
      isLive: Boolean(payload?.isLive),
      message: res.data?.message || payload?.message || (payload?.isLive ? 'Live weather from OpenWeatherMap' : 'Weather service unavailable'),
    };
  } catch (err) {
    return { weather: null, isLive: false, message: errMessage(err, 'Weather service unavailable') };
  }
}

export async function getForecast({ city, lat, lng, units = 'metric', days = 7 } = {}) {
  try {
    const res = await weatherApi.forecast({ city, lat, lng, units, days });
    const payload = res.data?.data;
    return {
      forecast: payload?.forecast ?? [],
      isLive: Boolean(payload?.isLive),
      message: res.data?.message || payload?.message || (payload?.isLive ? 'Live forecast from OpenWeatherMap' : 'Forecast service unavailable'),
    };
  } catch (err) {
    return { forecast: [], isLive: false, message: errMessage(err, 'Forecast service unavailable') };
  }
}

/**
 * Format an OpenWeather unix timestamp plus the city's UTC-offset (seconds)
 * into the local 24h "HH:MM" time. Returns "—" for missing/invalid input.
 */
export function formatSunTime(epochSeconds, tzSeconds = 0) {
  if (!epochSeconds) return '—';
  const d = new Date((epochSeconds + (tzSeconds || 0)) * 1000);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toISOString().substring(11, 16);
}

/** Public OpenWeather icon CDN (static asset, no API key required). */
export function weatherIconUrl(icon) {
  return icon ? `https://openweathermap.org/img/wn/${icon}@2x.png` : null;
}

export const weatherService = { getCurrentWeather, getForecast, formatSunTime, weatherIconUrl };

export default weatherService;
