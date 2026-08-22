import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CloudSun, Search, Droplets, Wind, Umbrella, ThermometerSun, Gauge, Eye, Sunrise, Sunset } from 'lucide-react';
import PageHeader from '../components/ui/PageHeader';
import PlaceAutocomplete from '../components/PlaceAutocomplete';
import Button from '../components/ui/Button';
import ProviderNotice from '../components/ProviderNotice';
import { Spinner } from '../components/ui/Spinner';
import { formatDate } from '../utils/format';
import { getCurrentWeather, getForecast, formatSunTime, weatherIconUrl } from '../services/weatherService';
import { useI18n } from '../utils/i18n';

function Stat({ icon: Icon, color, label, value }) {
  return (
    <div className="rounded-xl bg-white/10 p-3 text-center">
      <Icon className={`mx-auto h-5 w-5 ${color}`} />
      <p className="mt-1 text-xs text-brand-100">{label}</p>
      <p className="font-bold">{value}</p>
    </div>
  );
}

export default function Weather() {
  const { t } = useI18n();
  const [city, setCity] = useState(() => new URLSearchParams(window.location.search).get('city') || '');
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get('city') || 'Goa');

  const { data: current } = useQuery({
    queryKey: ['weather-current', search],
    queryFn: () => getCurrentWeather({ city: search }),
    enabled: Boolean(search),
  });
  const { data: forecast, isLoading } = useQuery({
    queryKey: ['weather-forecast', search],
    queryFn: () => getForecast({ city: search }),
    enabled: Boolean(search),
  });

  const w = current?.weather;
  const live = current?.isLive;

  return (
    <div>
      <PageHeader icon={CloudSun} title={t('Weather')} subtitle={t('Live forecasts from OpenWeatherMap.')} />

      <div className="mb-6 flex max-w-md gap-2">
        <PlaceAutocomplete placeholder="City, e.g. Goa" value={city} onKeyDown={(e) => e.key === 'Enter' && setSearch(city)} onChange={setCity} onSelect={(s) => setSearch(s.name || s.formatted || '')} />
        <Button icon={Search} onClick={() => setSearch(city)}>{t('Check')}</Button>
      </div>

      {isLoading && <div className="flex justify-center py-12"><Spinner size="lg" /></div>}

      {!isLoading && !live && (
        <ProviderNotice
          title={t('Live weather data unavailable')}
          message={current?.message || t('Live weather is temporarily unavailable.')}
          externalSources={[{ name: 'OpenWeatherMap', url: 'https://openweathermap.org' }, { name: 'AccuWeather', url: 'https://www.accuweather.com' }]}
        />
      )}

      {live && w && (
        <>
          <div className="card mb-6 bg-gradient-to-br from-brand-600 to-brand-900 p-6 text-white">
            <div className="flex flex-wrap items-center justify-between gap-6">
              <div className="flex items-center gap-4">
                {w.icon && (
                  <img src={weatherIconUrl(w.icon)} alt={w.description} className="h-20 w-20 drop-shadow-lg" loading="lazy" />
                )}
                <div>
                  <p className="text-sm font-semibold text-brand-100">{w.city}, {w.country}</p>
                  <p className="mt-1 text-5xl font-extrabold">{Math.round(w.temp)}°C</p>
                  <p className="mt-1 capitalize text-brand-100">{w.description}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
                <Stat icon={ThermometerSun} color="text-amber-300" label={t('Feels like')} value={`${Math.round(w.feelsLike)}°C`} />
                <Stat icon={Droplets} color="text-sky-300" label={t('Humidity')} value={`${w.humidity ?? '—'}%`} />
                <Stat icon={Wind} color="text-teal-300" label={t('Wind speed')} value={`${w.windSpeed ?? '—'} m/s`} />
                <Stat icon={Umbrella} color="text-indigo-300" label={t('Rain')} value={w.rain ? `${w.rain} mm` : '0 mm'} />
                <Stat icon={Gauge} color="text-rose-300" label={t('Pressure')} value={w.pressure != null ? `${w.pressure} hPa` : '—'} />
                <Stat icon={Eye} color="text-emerald-300" label={t('Visibility')} value={w.visibility != null ? `${(w.visibility / 1000).toFixed(1)} km` : '—'} />
                <Stat icon={Sunrise} color="text-amber-200" label={t('Sunrise')} value={formatSunTime(w.sunrise, w.timezone)} />
                <Stat icon={Sunset} color="text-orange-300" label={t('Sunset')} value={formatSunTime(w.sunset, w.timezone)} />
              </div>
            </div>
          </div>

          {w.alerts?.length > 0 && (
            <div className="mb-6 rounded-2xl border border-rose-200 bg-rose-50 p-4 dark:border-rose-900 dark:bg-rose-950/40">
              <p className="font-bold text-rose-700 dark:text-rose-300">⚠ {t('Weather warnings')}</p>
              {w.alerts.map((a, i) => (
                <p key={i} className="mt-1 text-sm text-rose-600 dark:text-rose-400">{a.event}: {a.description}</p>
              ))}
            </div>
          )}

          <h3 className="mb-3 text-base font-extrabold text-slate-900 dark:text-white">{t('7-day forecast')}</h3>
          {forecast?.isLive ? (
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
          ) : (
            forecast && <p className="text-sm text-slate-500">{t('7-day forecast unavailable')}: {forecast.message}</p>
          )}
        </>
      )}
    </div>
  );
}
