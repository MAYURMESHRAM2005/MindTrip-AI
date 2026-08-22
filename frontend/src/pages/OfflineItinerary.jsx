import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { WifiOff, Wifi, Database, Download, CheckCircle2 } from 'lucide-react';
import PageHeader from '../components/ui/PageHeader';
import useOnline from '../hooks/useOnline';
import ItineraryTimeline from '../components/ItineraryTimeline';
import { tripApi } from '../services/apiClient';
import { PageLoader } from '../components/ui/Spinner';
import Badge from '../components/ui/Badge';
import { useI18n } from '../utils/i18n';

/**
 * Offline itinerary via the service worker cache. When online we pre-cache
 * itinerary data; when offline, cached trips remain viewable.
 */
export default function OfflineItinerary() {
  const { t } = useI18n();
  const online = useOnline();
  const [cachedTrips, setCachedTrips] = useState([]);
  const [selected, setSelected] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const swSupported = 'serviceWorker' in navigator && 'caches' in window;

  const { data: tripsData } = useQuery({
    queryKey: ['trips'],
    queryFn: () => tripApi.list().then((r) => r.data.data),
  });
  const trips = tripsData?.trips || [];

  const listCacheKeys = async () => {
    if (!swSupported) return;
    const cache = await caches.open('travelmind-itinerary-cache');
    const keys = await cache.keys();
    const tripIds = keys
      .map((k) => k.url.match(/\/api\/trips\/([a-f0-9]{24})\/itinerary/)?.[1])
      .filter(Boolean);
    setCachedTrips([...new Set(tripIds)]);
  };

  useEffect(() => {
    listCacheKeys();
  }, [online]);

  const cacheItinerary = async (id) => {
    setLoading(true);
    try {
      const { data } = await tripApi.itinerary(id);
      setData(data.data);
      setSelected(id);
      await listCacheKeys();
    } finally {
      setLoading(false);
    }
  };

  const loadCached = async (id) => {
    setSelected(id);
    const cache = await caches.open('travelmind-itinerary-cache');
    const keys = await cache.keys();
    const key = keys.find((k) => k.url.includes(`/api/trips/${id}/itinerary`));
    if (!key) return;
    const res = await cache.match(key);
    if (!res) return;
    const json = await res.json();
    if (json?.data) setData(json.data);
  };

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        icon={WifiOff}
        title={t('Offline Itinerary')}
        subtitle={t('PWA + service worker keeps essential trip info available offline.')}
      />

      <div className={`mb-6 flex items-center gap-3 rounded-2xl border p-4 ${online ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40' : 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40'}`}>
        {online ? <Wifi className="h-5 w-5 text-emerald-500" /> : <WifiOff className="h-5 w-5 text-amber-500" />}
        <div>
          <p className="text-sm font-bold text-slate-900 dark:text-white">{online ? t('You are online') : t('You are offline')}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {online
              ? t('Open an itinerary while online to cache it for offline viewing.')
              : t('Live features show "Live data unavailable". Cached itineraries below still work.')}
          </p>
        </div>
      </div>

      <div className="card mb-6 p-5">
        <p className="mb-3 flex items-center gap-2 text-sm font-extrabold text-slate-900 dark:text-white">
          <Database className="h-4 w-4 text-brand-500" /> {t('Cached itineraries')}
          {!swSupported && <Badge tone="amber">{t('service worker unsupported')}</Badge>}
        </p>
        {cachedTrips.length === 0 && !loading && (
          <p className="py-4 text-center text-sm text-slate-400">
            {t('Nothing cached yet. While online, open a trip below — it gets stored automatically.')}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {cachedTrips.map((id) => (
            <button key={id} onClick={() => loadCached(id)} className={`btn ${selected === id ? 'btn-primary' : 'btn-secondary'}`}>
              <CheckCircle2 className="h-4 w-4" /> {t('Trip')} {id.slice(-6)}
            </button>
          ))}
        </div>
      </div>

      <div className="card p-5">
        <p className="mb-3 flex items-center gap-2 text-sm font-extrabold text-slate-900 dark:text-white">
          <Download className="h-4 w-4 text-brand-500" /> {t('Pre-cache a trip for offline')}
        </p>
        {trips.length === 0 ? (
          <p className="text-sm text-slate-400">{t('No trips available to cache.')}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {trips.map((t) => (
              <button key={t._id} onClick={() => cacheItinerary(t._id)} className="btn-secondary text-xs">
                📌 {t.title}
              </button>
            ))}
          </div>
        )}
      </div>

      {loading && <PageLoader label={t('Caching itinerary…')} />}
      {data && <div className="mt-6"><ItineraryTimeline days={data.itinerary.days} currency={data.trip.budget.currency} /></div>}
    </div>
  );
}
