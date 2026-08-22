import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Map as MapIcon, Navigation, Locate, RotateCw, ThermometerSun, Droplets, Wind, Gauge, Eye, Sunrise, Sunset, Umbrella } from 'lucide-react';
import PageHeader from '../components/ui/PageHeader';
import { Input } from '../components/ui/Input';
import PlaceAutocomplete from '../components/PlaceAutocomplete';
import Button from '../components/ui/Button';
import ProviderNotice from '../components/ProviderNotice';
import { Spinner } from '../components/ui/Spinner';
import { geoapifyService, NEARBY_CATEGORIES } from '../services/geoapifyService';
import { getCurrentWeather, formatSunTime, weatherIconUrl } from '../services/weatherService';
import { useI18n } from '../utils/i18n';

const MapView = React.lazy(() => import('../components/MapView'));

function WeatherStat({ icon: Icon, color, label, value }) {
  return (
    <div className="rounded-xl bg-white/10 p-3 text-center">
      <Icon className={`mx-auto h-4 w-4 ${color}`} />
      <p className="mt-1 text-[11px] text-brand-100">{label}</p>
      <p className="text-sm font-bold">{value}</p>
    </div>
  );
}

export default function Maps() {
  const { t } = useI18n();
  const queryDest = () => new URLSearchParams(window.location.search).get('destination') || '';
  const [destination, setDestination] = useState(queryDest() || 'Goa');
  const [origin, setOrigin] = useState('');
  // Topbar search (?destination=Goa) auto-loads the map on mount.
  const [search, setSearch] = useState(() => queryDest() || null);
  const [nearby, setNearby] = useState({ results: {}, isLive: false, loading: false });
  const [route, setRoute] = useState({ loading: false, isLive: false, message: '' });

  // Geocode the destination (cached by react-query → no duplicate requests)
  const { data: geocode, isLoading: geocoding, refetch: refetchGeocode } = useQuery({
    queryKey: ['geoapify-geocode', search],
    queryFn: () => geoapifyService.geocode(search),
    enabled: Boolean(search),
  });

  // Weather for the destination — same query key as the Weather page, so the cache is shared
  const { data: weather, isLoading: weatherLoading, refetch: refetchWeather } = useQuery({
    queryKey: ['weather-current', search],
    queryFn: () => getCurrentWeather({ city: search }),
    enabled: Boolean(search),
  });

  const center = geocode?.isLive ? { lat: geocode.lat, lng: geocode.lng } : null;
  const w = weather?.weather;

  // A new destination invalidates any previously drawn route
  useEffect(() => {
    setRoute({ loading: false, isLive: false, message: '' });
  }, [search]);

  // Auto-load nearby places once the destination resolves
  useEffect(() => {
    if (!center) return;
    setNearby((n) => ({ ...n, loading: true }));
    geoapifyService.getNearby({ lat: center.lat, lng: center.lng, radius: 6000 }).then((r) => setNearby({ ...r, loading: false }));
  }, [center?.lat, center?.lng]);

  const markers = useMemo(() => {
    const list = [];
    if (center) {
      list.push({ name: geocode.address || destination, address: geocode.address, coordinates: center, type: 'destination', color: '#6366f1', emphasis: true });
    }
    if (route.originPoint && route.originPoint.lat != null) {
      list.push({ name: origin, coordinates: route.originPoint, type: 'origin', color: '#64748b', emphasis: true });
    }
    for (const cat of NEARBY_CATEGORIES) {
      for (const p of nearby.results?.[cat.key] || []) {
        if (p.coordinates?.lat && p.coordinates?.lng) {
          list.push({ ...p, type: cat.label, color: cat.color });
        }
      }
    }
    return list;
  }, [center, geocode, destination, origin, route.originPoint, nearby]);

  const getRoute = async () => {
    if (!origin || !search) return;
    setRoute({ loading: true, isLive: false, message: '' });
    const result = await geoapifyService.getRoute(origin, search, 'drive');
    setRoute({ ...result, loading: false });
  };

  const clearRoute = () => setRoute({ loading: false, isLive: false, message: '' });

  return (
    <div>
      <PageHeader icon={MapIcon} title={t('Maps & Traffic')} subtitle={t('Geoapify geocoding, routing and nearby places on an OpenStreetMap base.')} />

      <div className="card mb-6 flex flex-wrap items-end gap-3 p-5">
        <div className="min-w-[200px] flex-1">
          <PlaceAutocomplete label={t('Destination')} value={destination} onKeyDown={(e) => e.key === 'Enter' && setSearch(destination)} onChange={setDestination} onSelect={(s) => setSearch(s.name || s.formatted || '')} />
        </div>
        <div className="min-w-[200px] flex-1">
          <Input label={t('Starting point (for route)')} placeholder="e.g. Hotel Taj, Goa" value={origin} onChange={(e) => setOrigin(e.target.value)} />
        </div>
        <Button icon={Locate} onClick={() => setSearch(destination)}>{nearby.loading ? t('Loading…') : t('Show map')}</Button>
        <Button variant="secondary" icon={Navigation} onClick={getRoute} disabled={!origin || !search} loading={route.loading}>
          {t('Route')}
        </Button>
      </div>

      {geocoding && <div className="flex justify-center py-12"><Spinner size="lg" /></div>}

      {!geocoding && search && !geocode?.isLive && (
        <ProviderNotice
          title={t('Map data unavailable')}
          message={geocode?.message || t('Could not geocode this destination.')}
          externalSources={[{ name: 'Geoapify', url: 'https://www.geoapify.com' }, { name: 'OpenStreetMap', url: 'https://www.openstreetmap.org' }]}
          action={search ? { label: t('Retry'), onClick: () => refetchGeocode() } : null}
        />
      )}

      {/* Location details: address, latitude, longitude */}
      {center && (
        <div className="card mb-6 flex flex-wrap items-center gap-x-6 gap-y-2 p-4 text-sm">
          <p className="min-w-0 flex-1 truncate font-semibold text-slate-800 dark:text-slate-100">
            📍 {geocode?.address || destination}
          </p>
          <p className="font-mono text-xs text-slate-500">
            Lat: {Number(center.lat).toFixed(5)} · Lng: {Number(center.lng).toFixed(5)}
          </p>
          <span className="badge bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400">{t('Live')}</span>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800">
        {center ? (
          <React.Suspense fallback={<div className="h-[520px] bg-slate-100 dark:bg-slate-900" />}>
            <MapView center={[center.lat, center.lng]} markers={markers} route={route.isLive ? route.route : []} />
          </React.Suspense>
        ) : (
          <div className="flex h-[320px] items-center justify-center bg-slate-100 text-sm text-slate-400 dark:bg-slate-900">
            {search ? t('Map will appear once the destination is located.') : t('Search a destination to see the interactive map.')}
          </div>
        )}
      </div>

      {nearby.loading && (
        <p className="mt-3 flex items-center gap-2 text-xs text-slate-400">
          <Spinner size="sm" /> {t('Loading nearby places…')}
        </p>
      )}
      {!nearby.loading && center && !nearby.isLive && (
        <p className="mt-3 text-xs text-slate-400">{nearby.message || t('No nearby places found for this area.')}</p>
      )}

      {/* Legend */}
      <div className="mt-4 flex flex-wrap gap-2 text-xs">
        {NEARBY_CATEGORIES.map((cat) => (
          <span key={cat.key} className="inline-flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1 font-semibold text-slate-600 shadow-sm dark:bg-slate-900 dark:text-slate-300">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: cat.color }} />
            {cat.label}
          </span>
        ))}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {/* Route info */}
        <div className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-extrabold text-slate-900 dark:text-white">{t('Route')}</h3>
            {route.isLive && (
              <button onClick={clearRoute} className="text-xs font-semibold text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">{t('Clear')}</button>
            )}
          </div>
          {route.loading ? (
            <div className="flex items-center gap-2 py-4 text-sm text-slate-400"><Spinner size="sm" /> {t('Calculating route…')}</div>
          ) : route.isLive ? (
            <div className="space-y-3">
              <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60">
                <p className="font-bold text-slate-800 dark:text-slate-100">{t('Distance')}: {route.distanceKm} km</p>
                <p className="mt-1 text-sm text-slate-500">{t('Estimated travel time')}: ~{route.durationMin} min</p>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
                  <p className="font-semibold text-slate-400">{t('Origin')}</p>
                  <p className="mt-1 font-mono text-slate-700 dark:text-slate-200">
                    {route.originPoint.lat.toFixed(5)}, {route.originPoint.lng.toFixed(5)}
                  </p>
                </div>
                <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
                  <p className="font-semibold text-slate-400">{t('Destination')}</p>
                  <p className="mt-1 font-mono text-slate-700 dark:text-slate-200">
                    {route.destinationPoint.lat.toFixed(5)}, {route.destinationPoint.lng.toFixed(5)}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="py-4 text-sm text-slate-500">
              {route.message || t('Enter a starting point and click Route to draw the path, distance and travel time.')}
              {search && origin && (
                <button onClick={getRoute} className="ml-2 inline-flex items-center gap-1 text-xs font-bold text-brand-600 hover:underline">
                  <RotateCw className="h-3 w-3" /> {t('Retry')}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Weather in destination */}
        <div className="card bg-gradient-to-br from-brand-600 to-brand-900 p-5 text-white">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-extrabold">
            <ThermometerSun className="h-4 w-4 text-amber-300" /> {t('Weather')} {search ? `${t('in')} ${search}` : ''}
          </h3>
          {weatherLoading ? (
            <div className="flex items-center gap-2 py-4 text-sm text-brand-100"><Spinner size="sm" /> {t('Loading weather…')}</div>
          ) : w && weather?.isLive ? (
            <>
              <div className="flex items-center gap-4">
                {w.icon && <img src={weatherIconUrl(w.icon)} alt={w.description} className="h-16 w-16 drop-shadow-lg" loading="lazy" />}
                <div>
                  <p className="text-4xl font-extrabold">{Math.round(w.temp)}°C</p>
                  <p className="text-sm capitalize text-brand-100">{w.description}</p>
                  <p className="text-xs text-brand-100">{w.city}{w.country ? `, ${w.country}` : ''}</p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <WeatherStat icon={ThermometerSun} color="text-amber-300" label={t('Feels like')} value={`${Math.round(w.feelsLike)}°C`} />
                <WeatherStat icon={Droplets} color="text-sky-300" label={t('Humidity')} value={`${w.humidity ?? '—'}%`} />
                <WeatherStat icon={Wind} color="text-teal-300" label={t('Wind')} value={`${w.windSpeed ?? '—'} m/s`} />
                <WeatherStat icon={Gauge} color="text-rose-300" label={t('Pressure')} value={w.pressure != null ? `${w.pressure} hPa` : '—'} />
                <WeatherStat icon={Eye} color="text-emerald-300" label={t('Visibility')} value={w.visibility != null ? `${(w.visibility / 1000).toFixed(1)} km` : '—'} />
                <WeatherStat icon={Umbrella} color="text-indigo-300" label={t('Rain')} value={w.rain ? `${w.rain} mm` : '0 mm'} />
                <WeatherStat icon={Sunrise} color="text-amber-200" label={t('Sunrise')} value={formatSunTime(w.sunrise, w.timezone)} />
                <WeatherStat icon={Sunset} color="text-orange-300" label={t('Sunset')} value={formatSunTime(w.sunset, w.timezone)} />
              </div>
            </>
          ) : (
            <p className="py-2 text-sm text-brand-100">
              {weather?.message || t('Weather unavailable for this destination.')}
              {search && (
                <button onClick={() => refetchWeather()} className="ml-2 inline-flex items-center gap-1 text-xs font-bold text-white underline">
                  <RotateCw className="h-3 w-3" /> {t('Retry')}
                </button>
              )}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
