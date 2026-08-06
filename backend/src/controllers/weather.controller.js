import ApiResponse from '../utils/ApiResponse.js';
import asyncHandler from '../utils/asyncHandler.js';
import weatherProvider from '../providers/weather.provider.js';

export const current = asyncHandler(async (req, res) => {
  const { city, lat, lng, units } = req.query;
  const result = await weatherProvider.currentWeather({
    city,
    lat: lat ? Number(lat) : null,
    lng: lng ? Number(lng) : null,
    units: units || 'metric',
  });
  res.json(ApiResponse.ok(result.message, { weather: result.data, isLive: result.isLive }));
});

export const forecast = asyncHandler(async (req, res) => {
  const { city, lat, lng, units, days } = req.query;
  const result = await weatherProvider.forecast({
    city,
    lat: lat ? Number(lat) : null,
    lng: lng ? Number(lng) : null,
    units: units || 'metric',
    days: days ? Number(days) : 7,
  });
  res.json(ApiResponse.ok(result.message, { forecast: result.data, isLive: result.isLive }));
});

export default { current, forecast };
