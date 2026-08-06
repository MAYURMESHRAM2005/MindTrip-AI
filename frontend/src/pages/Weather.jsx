import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CloudSun, Search, Droplets, Wind, Umbrella, ThermometerSun } from 'lucide-react';
import PageHeader from '../components/ui/PageHeader';
import { Input } from '../components/ui/Input';
import Button from '../components/ui/Button';
import ProviderNotice from '../components/ProviderNotice';
import { weatherApi } from '../services/apiClient';
import { Spinner } from '../components/ui/Spinner';
import { formatDate } from '../utils/format';

export default function Weather() {
  const [city, setCity] = useState('');
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get('city') || 'Goa');

  const { data: current } = useQuery({
    queryKey: ['weather-current', search],
    queryFn: () => weatherApi.current({ city: search }).then((r) => r.data.data),
    enabled: Boolean(search),
  });
  const { data: forecast, isLoading } = useQuery({
    queryKey: ['weather-forecast', search],
    queryFn: () => weatherApi.forecast({ city: search }).then((r) => r.data.data),
    enabled: Boolean(search),
  });

  const w = current?.weather;
  const live = current?.isLive;

  return (
    <div>
      <PageHeader icon={CloudSun} title="Weather" subtitle="Live forecasts from OpenWeatherMap." />

      <div className="mb-6 flex max-w-md gap-2">
        <Input placeholder="City, e.g. Goa" value={city} onKeyDown={(e) => e.key === 'Enter' && setSearch(city)} onChange={(e) => setCity(e.target.value)} />
        <Button icon={Search} onClick={() => setSearch(city)}>Check</Button>
      </div>

      {isLoading && <div className="flex justify-center py-12"><Spinner size="lg" /></div>}

      {!isLoading && !live && (
        <ProviderNotice
          title="Live weather data unavailable"
          message={current?.message || 'OpenWeather API key not configured.'}
          externalSources={[{ name: 'OpenWeatherMap', url: 'https://openweathermap.org' }, { name: 'AccuWeather', url: 'https://www.accuweather.com' }]}
        />
      )}

      {live && w && (
        <>
          <div className="card mb-6 flex flex-wrap items-center justify-between gap-6 bg-gradient-to-br from-brand-600 to-brand-900 p-6 text-white">
            <div>
              <p className="text-sm font-semibold text-brand-100">{w.city}, {w.country}</p>
              <p className="mt-1 text-5xl font-extrabold">{Math.round(w.temp)}°C</p>
              <p className="mt-1 text-brand-100">{w.description}</p>
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
              <div className="rounded-xl bg-white/10 p-3 text-center">
                <ThermometerSun className="mx-auto h-5 w-5 text-amber-300" />
                <p className="mt-1 text-xs text-brand-100">Feels like</p>
                <p className="font-bold">{Math.round(w.feelsLike)}°C</p>
              </div>
              <div className="rounded-xl bg-white/10 p-3 text-center">
                <Droplets className="mx-auto h-5 w-5 text-sky-300" />
                <p className="mt-1 text-xs text-brand-100">Humidity</p>
                <p className="font-bold">{w.humidity}%</p>
              </div>
              <div className="rounded-xl bg-white/10 p-3 text-center">
                <Wind className="mx-auto h-5 w-5 text-teal-300" />
                <p className="mt-1 text-xs text-brand-100">Wind</p>
                <p className="font-bold">{w.windSpeed} m/s</p>
              </div>
              <div className="rounded-xl bg-white/10 p-3 text-center">
                <Umbrella className="mx-auto h-5 w-5 text-indigo-300" />
                <p className="mt-1 text-xs text-brand-100">Rain</p>
                <p className="font-bold">{w.rain ? `${w.rain} mm` : '0 mm'}</p>
              </div>
            </div>
          </div>

          {w.alerts?.length > 0 && (
            <div className="mb-6 rounded-2xl border border-rose-200 bg-rose-50 p-4 dark:border-rose-900 dark:bg-rose-950/40">
              <p className="font-bold text-rose-700 dark:text-rose-300">⚠ Weather warnings</p>
              {w.alerts.map((a, i) => (
                <p key={i} className="mt-1 text-sm text-rose-600 dark:text-rose-400">{a.event}: {a.description}</p>
              ))}
            </div>
          )}

          <h3 className="mb-3 text-base font-extrabold text-slate-900 dark:text-white">7-day forecast</h3>
          {forecast?.isLive && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
              {forecast.forecast.map((d) => (
                <div key={d.date} className="card p-4 text-center">
                  <p className="text-xs font-bold uppercase text-slate-400">{formatDate(d.date)}</p>
                  <p className="mt-1 text-xl font-extrabold text-slate-900 dark:text-white">
                    {Math.round(d.tempMax)}°<span className="text-sm text-slate-400">/{Math.round(d.tempMin)}°</span>
                  </p>
                  <p className="mt-0.5 text-xs font-semibold text-slate-600 dark:text-slate-300">{d.condition}</p>
                  {d.rainProbability > 30 && <p className="mt-1 text-xs font-bold text-sky-500">🌧 {d.rainProbability}%</p>}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
