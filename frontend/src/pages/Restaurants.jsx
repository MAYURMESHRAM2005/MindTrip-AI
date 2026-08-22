import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { UtensilsCrossed, Search, Star, MapPin, Navigation, LocateFixed } from 'lucide-react';
import PageHeader from '../components/ui/PageHeader';
import { Input } from '../components/ui/Input';
import PlaceAutocomplete from '../components/PlaceAutocomplete';
import Button from '../components/ui/Button';
import ProviderNotice from '../components/ProviderNotice';
import { restaurantsApi } from '../services/apiClient';
import { Spinner } from '../components/ui/Spinner';
import Badge from '../components/ui/Badge';
import { cn } from '../utils/format';
import { haversineKm } from '../utils/geo';
import toast from 'react-hot-toast';
import { useI18n } from '../utils/i18n';

/** Distance from the search city center (Geoapify reports it from the bias point). */
function distanceFromCenterKm(restaurant, center) {
  if (!center || !restaurant?.coordinates) return null;
  if (restaurant.distanceMeters != null) return restaurant.distanceMeters / 1000;
  return haversineKm(center.lat, center.lng, restaurant.coordinates.lat, restaurant.coordinates.lng);
}

function formatDistanceKm(km) {
  if (km == null) return null;
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

function restaurantsFromQuery() {
  return { city: new URLSearchParams(window.location.search).get('city') || '', q: '', veg: false, vegan: false, nonVeg: false, minRating: '' };
}

export default function Restaurants() {
  const { t } = useI18n();
  const [params, setParams] = useState(restaurantsFromQuery);
  // Topbar search (?city=Goa) auto-runs the search on mount.
  const [search, setSearch] = useState(() => {
    const sp = new URLSearchParams(window.location.search);
    return sp.get('city') ? restaurantsFromQuery() : null;
  });
  const [nearby, setNearby] = useState(false);
  const [locating, setLocating] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['restaurants', search],
    queryFn: () => restaurantsApi.search(search).then((r) => r.data.data),
    enabled: Boolean(search),
  });

  const toggle = (key) => setParams({ ...params, veg: false, vegan: false, nonVeg: false, [key]: !params[key] });

  // A regular city/keyword search replaces any nearby-location results.
  const runSearch = (payload) => {
    setNearby(false);
    setSearch(payload);
  };

  /** Search restaurants around the user's current location (browser geolocation). */
  const locateNearby = () => {
    if (!navigator.geolocation) {
      toast.error(t('Geolocation is not supported by this browser'));
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setNearby(true);
        setSearch({ ...params, city: '', lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      (err) => {
        setLocating(false);
        toast.error(
          err.code === 1
            ? t('Location permission denied — allow access or search by city instead')
            : t('Could not get your location')
        );
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );
  };

  return (
    <div>
      <PageHeader icon={UtensilsCrossed} title={t('Restaurants')} subtitle={t('Real Geoapify Places data with food-preference filters.')} />

      <div className="card mb-6 p-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[180px] flex-1">
            <PlaceAutocomplete
              label={t('City / place')}
              placeholder="Goa, Pondicherry…"
              value={params.city}
              onKeyDown={(e) => e.key === 'Enter' && (params.city || params.q) && runSearch({ ...params })}
              onChange={(city) => setParams({ ...params, city })}
              onSelect={(s) => runSearch({ ...params, city: s.name || s.formatted || '' })}
            />
          </div>
          <div className="min-w-[180px] flex-1">
            <Input
              label={t('Search within (optional)')}
              placeholder="seafood, rooftop, cafes…"
              value={params.q}
              onKeyDown={(e) => e.key === 'Enter' && (params.city || params.q) && runSearch({ ...params })}
              onChange={(e) => setParams({ ...params, q: e.target.value })}
            />
          </div>
          <div className="flex flex-wrap gap-2 pb-1">
            {[
              { key: 'veg', label: `🌿 ${t('Vegetarian')}` },
              { key: 'vegan', label: `🥬 ${t('Vegan')}` },
              { key: 'nonVeg', label: `🍗 ${t('Non-veg')}` },
            ].map((f) => (
              <button
                key={f.key}
                onClick={() => toggle(f.key)}
                className={cn('rounded-full border px-3 py-1.5 text-xs font-bold transition-all', params[f.key] ? 'border-brand-500 bg-brand-600 text-white' : 'border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-300')}
              >
                {f.label}
              </button>
            ))}
            <select className="input w-auto py-1.5 text-xs" value={params.minRating} onChange={(e) => setParams({ ...params, minRating: e.target.value })}>
              <option value="">{t('Any rating')}</option>
              <option value="4">4.0+</option>
              <option value="4.5">4.5+</option>
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-2 pb-1">
            <Button icon={Search} disabled={!params.city && !params.q} onClick={() => runSearch({ ...params })}>{t('Search restaurants')}</Button>
            <Button variant="outline" icon={LocateFixed} loading={locating} disabled={locating} onClick={locateNearby}>
              {locating ? t('Locating…') : t('Near me')}
            </Button>
          </div>
        </div>
      </div>

      {isLoading && <div className="flex justify-center py-12"><Spinner size="lg" /></div>}

      {data && !data.isLive && (
        <ProviderNotice title={t('Live restaurant data unavailable')} message={data.message} externalSources={[{ name: 'OpenStreetMap', url: 'https://www.openstreetmap.org' }, { name: 'Zomato', url: 'https://www.zomato.com' }]} />
      )}

      {data?.isLive && (
        <>
          <p className="mb-3 text-xs font-semibold text-emerald-600">
            ● {t('Live from Geoapify Places')}
            {nearby ? (
              <span className="text-slate-500"> · {t('near your location')}</span>
            ) : data.searchedCity ? (
              <span className="text-slate-500"> · {t('near')} {data.searchedCity}</span>
            ) : null}
            {data.filterApplied && (
              <span className="text-slate-400"> · {t('diet filter requested (Places may not expose diet labels — check each listing)')}</span>
            )}
          </p>
          {nearby && (
            <div className="mb-3 flex items-center gap-2">
              <LocateFixed className="h-4 w-4 text-emerald-600" />
              <h3 className="text-base font-extrabold text-slate-900 dark:text-white">{t('Nearby restaurants')}</h3>
              <span className="text-xs text-slate-400">{t('within 5 km of your location')}</span>
            </div>
          )}
          {data.restaurants.length === 0 ? (
            <div className="card p-8 text-center text-sm text-slate-500">
              {t("No matching restaurants. Try clearing the diet filter — diet details aren't always exposed by Places.")}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {data.restaurants.map((r, i) => {
                const distKm = distanceFromCenterKm(r, data.coordinates);
                return (
                  <div key={r.placeId || i} className="card flex flex-col p-5 transition-all hover:-translate-y-0.5 hover:shadow-card">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-extrabold text-slate-900 dark:text-white">{r.name}</h3>
                    {r.openNow != null && (
                      <Badge tone={r.openNow ? 'green' : 'slate'}>{r.openNow ? t('Open') : t('Closed')}</Badge>
                    )}
                  </div>
                  <div className="mt-1.5 flex items-center gap-2 text-xs">
                    {r.rating != null && (
                      <span className="inline-flex items-center gap-1 font-bold text-amber-500">
                        <Star className="h-3.5 w-3.5 fill-current" /> {r.rating}
                        {r.userRatingsTotal ? ` (${r.userRatingsTotal})` : ''}
                      </span>
                    )}
                    {r.priceLevel != null && <span className="text-slate-400">{'₹'.repeat(r.priceLevel + 1)}</span>}
                  </div>
                  {r.address && (
                    <p className="mt-2 flex items-start gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                      <MapPin className="mt-0.5 h-3 w-3 shrink-0" /> {r.address}
                    </p>
                  )}
                  {distKm != null && (
                    <p className="mt-1 flex items-center gap-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400">
                      <Navigation className="h-3 w-3 shrink-0" /> {formatDistanceKm(distKm)} {nearby ? t('from your location') : t('from city center')}
                    </p>
                  )}
                    <div className="mt-auto pt-3">
                      <a
                        href={r.coordinates?.lat != null ? `https://www.openstreetmap.org/?mlat=${r.coordinates.lat}&mlon=${r.coordinates.lng}#map=17/${r.coordinates.lat}/${r.coordinates.lng}` : `https://www.openstreetmap.org/search?query=${encodeURIComponent(r.name)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="btn-secondary w-full py-1.5 text-xs"
                      >
                        {t('View on map')}
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
