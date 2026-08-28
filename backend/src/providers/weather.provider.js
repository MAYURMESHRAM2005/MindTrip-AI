import env from '../config/env.js';
import { live, unavailable, axiosGet } from './base.provider.js';
import logger from '../utils/logger.js';

const BASE = 'https://api.openweathermap.org/data/2.5';

function mapCurrent(d) {
  return {
    temp: d.main.temp,
    feelsLike: d.main.feels_like,
    humidity: d.main.humidity,
    pressure: d.main.pressure,
    windSpeed: d.wind.speed,
    windDeg: d.wind.deg,
    condition: d.weather?.[0]?.main || '',
    description: d.weather?.[0]?.description || '',
    icon: d.weather?.[0]?.icon || '',
    rain: d.rain?.['1h'] || 0,
    visibility: d.visibility,
    cloudiness: d.clouds?.all,
    city: d.name,
    country: d.sys?.country,
    coordinates: { lat: d.coord?.lat, lng: d.coord?.lon },
    sunrise: d.sys?.sunrise ?? null,
    sunset: d.sys?.sunset ?? null,
    timezone: d.timezone ?? 0,
    alerts: (d.alerts || []).map((a) => ({
      event: a.event,
      description: a.description,
      start: a.start,
      end: a.end,
    })),
  };
}

export async function currentWeather({ city, lat, lng, units = 'metric' }) {
  logger.entry('[PROVIDER:weather]', 'currentWeather', { city, lat, lng });
  const started = Date.now();
  if (!env.OPENWEATHER_API_KEY) {
    return unavailable('openweather', 'OpenWeather API key not configured');
  }
  try {
    let url = `${BASE}/weather?units=${units}&appid=${env.OPENWEATHER_API_KEY}`;
    if (lat != null && lng != null) url += `&lat=${lat}&lon=${lng}`;
    else url += `&q=${encodeURIComponent(city)}`;
    const data = await axiosGet(url, {}, 6000);
    if (data.cod !== 200) {
      return unavailable('openweather', `Weather lookup failed: ${data.message || data.cod}`);
    }
    logger.provider('openweather', 'currentWeather', { isLive: true, latencyMs: Date.now() - started, temp: data.main?.temp });
    return live('openweather', mapCurrent(data), 'Live weather from OpenWeatherMap');
  } catch (err) {
    logger.error(`[PROVIDER:weather] currentWeather error: ${err.message}`);
    return unavailable('openweather', `Live data unavailable: ${err.message}`);
  }
}

export async function forecast({ city, lat, lng, units = 'metric', days = 7 }) {
  logger.entry('[PROVIDER:weather]', 'forecast', { city, lat, lng, days });
  const started = Date.now();
  if (!env.OPENWEATHER_API_KEY) {
    return unavailable('openweather', 'OpenWeather API key not configured');
  }
  try {
    let url = `${BASE}/forecast?units=${units}&appid=${env.OPENWEATHER_API_KEY}`;
    if (lat != null && lng != null) url += `&lat=${lat}&lon=${lng}`;
    else url += `&q=${encodeURIComponent(city)}`;
    const data = await axiosGet(url, {}, 7000);
    if (data.cod !== '200') {
      return unavailable('openweather', `Forecast lookup failed: ${data.message || data.cod}`);
    }
    const byDay = {};
    for (const item of data.list) {
      const dateStr = item.dt_txt.slice(0, 10);
      if (!byDay[dateStr]) {
        byDay[dateStr] = {
          date: dateStr,
          tempMin: item.main.temp_min,
          tempMax: item.main.temp_max,
          condition: item.weather?.[0]?.main || '',
          description: item.weather?.[0]?.description || '',
          icon: item.weather?.[0]?.icon || '',
          rainProbability: item.pop ? Math.round(item.pop * 100) : 0,
          humidity: item.main.humidity,
          windSpeed: item.wind.speed,
          entries: 1,
        };
      } else {
        const d = byDay[dateStr];
        d.tempMin = Math.min(d.tempMin, item.main.temp_min);
        d.tempMax = Math.max(d.tempMax, item.main.temp_max);
        d.rainProbability = Math.max(d.rainProbability, item.pop ? Math.round(item.pop * 100) : 0);
        d.entries += 1;
      }
    }
    const forecastData = Object.values(byDay).slice(0, days).map(({ entries, ...rest }) => rest);
    logger.provider('openweather', 'forecast', { isLive: true, count: forecastData.length, latencyMs: Date.now() - started });
    return live(
      'openweather',
      forecastData,
      'Live forecast from OpenWeatherMap'
    );
  } catch (err) {
    logger.error(`[PROVIDER:weather] forecast error: ${err.message}`);
    return unavailable('openweather', `Live data unavailable: ${err.message}`);
  }
}

export default { currentWeather, forecast };
