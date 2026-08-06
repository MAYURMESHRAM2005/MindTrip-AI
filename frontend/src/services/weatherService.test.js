import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

vi.mock('./apiClient', () => ({
  weatherApi: {
    current: vi.fn(),
    forecast: vi.fn(),
  },
}));

import { weatherApi } from './apiClient';

const mockedCurrent = vi.mocked(weatherApi.current);
const mockedForecast = vi.mocked(weatherApi.forecast);

let getCurrentWeather;
let getForecast;

beforeAll(async () => {
  ({ getCurrentWeather, getForecast } = await import('./weatherService'));
});

beforeEach(() => {
  mockedCurrent.mockReset();
  mockedForecast.mockReset();
});

describe('getCurrentWeather (backend proxy)', () => {
  it('returns live weather payload from the backend', async () => {
    mockedCurrent.mockResolvedValue({
      data: {
        message: 'Live weather from OpenWeatherMap',
        data: {
          weather: { temp: 25, city: 'Nagpur', country: 'IN' },
          isLive: true,
        },
      },
    });
    const res = await getCurrentWeather({ city: 'Nagpur' });

    expect(mockedCurrent).toHaveBeenCalledWith({ city: 'Nagpur', lat: undefined, lng: undefined, units: 'metric' });
    expect(res.isLive).toBe(true);
    expect(res.weather.city).toBe('Nagpur');
  });

  it('surfaces the backend message when live data is unavailable', async () => {
    mockedCurrent.mockResolvedValue({
      data: { message: 'Weather lookup failed: city not found', data: { weather: null, isLive: false } },
    });
    const res = await getCurrentWeather({ city: 'Nowhere' });

    expect(res.isLive).toBe(false);
    expect(res.message).toMatch(/city not found/);
  });

  it('never rejects for network failures', async () => {
    mockedCurrent.mockRejectedValue(new Error('Network Error'));
    const res = await getCurrentWeather({ city: 'Goa' });

    expect(res.isLive).toBe(false);
    expect(res.message).toMatch(/Network Error|unavailable/);
  });
});

describe('getForecast (backend proxy)', () => {
  it('returns the backend forecast list', async () => {
    mockedForecast.mockResolvedValue({
      data: {
        message: 'Live forecast from OpenWeatherMap',
        data: {
          forecast: [{ date: '2026-08-07', tempMax: 33, tempMin: 25 }],
          isLive: true,
        },
      },
    });
    const res = await getForecast({ city: 'Nagpur', days: 7 });

    expect(mockedForecast).toHaveBeenCalledWith({ city: 'Nagpur', lat: undefined, lng: undefined, units: 'metric', days: 7 });
    expect(res.isLive).toBe(true);
    expect(res.forecast).toHaveLength(1);
  });

  it('handles unavailable forecast gracefully', async () => {
    mockedForecast.mockResolvedValue({
      data: { message: 'Forecast lookup failed', data: { forecast: [], isLive: false } },
    });
    const res = await getForecast({ city: 'Nowhere' });

    expect(res.isLive).toBe(false);
    expect(res.forecast).toEqual([]);
  });
});
