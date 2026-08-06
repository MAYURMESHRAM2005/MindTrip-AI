import React, { useEffect, useMemo, useState } from 'react';
import { Map as MapIcon, Navigation, Locate, Layers } from 'lucide-react';
import PageHeader from '../components/ui/PageHeader';
import { Input } from '../components/ui/Input';
import Button from '../components/ui/Button';
import ProviderNotice from '../components/ProviderNotice';
import { mapsApi } from '../services/apiClient';
import { Spinner } from '../components/ui/Spinner';

const MapView = React.lazy(() => import('../components/MapView'));

const CATEGORY_COLORS = {
  hotel: '#6366f1', restaurant: '#f43f5e', tourist_attraction: '#f59e0b',
  hospital: '#ef4444', police: '#3b82f6', atm: '#10b981', transit_station: '#14b8a6', pharmacy: '#a855f7',
};

export default function Maps() {
  const [destination, setDestination] = useState('Goa');
  const [search, setSearch] = useState(null);
  const [origin, setOrigin] = useState('');
  const [nearby, setNearby] = useState({ results: {}, isLive: false });
  const [directions, setDirections] = useState(null);
  const [loadingNearby, setLoadingNearby] = useState(false);
  const [loadingRoute, setLoadingRoute] = useState(false);

  const { data: geocodeData, isLoading } = useQuery({
    queryKey: ['geocode', search],
    queryFn: () => mapsApi.geocode(search).then((r) => r.data.data),
    enabled: Boolean(search),
  });

  const center = geocodeData?.geocode;

  // Load POIs around the destination
  useEffect(() => {
    if (!center?.lat || !center?.lng) return;
    setLoadingNearby(true);
    mapsApi
      .nearby({ lat: center.lat, lng: center.lng, types: 'hotel,restaurant,tourist_attraction,hospital,police,atm,transit_station', radius: 6000 })
      .then((r) => setNearby(r.data.data))
      .finally(() => setLoadingNearby(false));
  }, [center?.lat, center?.lng]);

  const markers = useMemo(() => {
    const list = [];
    for (const [type, places] of Object.entries(nearby.results || {})) {
      for (const p of places) {
        if (p.coordinates?.lat && p.coordinates?.lng) {
          list.push({ ...p, type, color: CATEGORY_COLORS[type] || '#64748b' });
        }
      }
    }
    return list;
  }, [nearby]);

  const getRoute = async () => {
    if (!origin) return;
    setLoadingRoute(true);
    try {
      const { data } = await mapsApi.directions({ origin, destination: search, mode: 'driving', alternatives: true });
      setDirections(data.data);
    } finally {
      setLoadingRoute(false);
    }
  };

  return (
    <div>
      <PageHeader icon={MapIcon} title="Maps & Traffic" subtitle="Interactive map with routes and traffic-aware directions." />

      <div className="card mb-6 flex flex-wrap items-end gap-3 p-5">
        <div className="min-w-[200px] flex-1">
          <Input label="Destination" value={destination} onKeyDown={(e) => e.key === 'Enter' && setSearch(destination)} onChange={(e) => setDestination(e.target.value)} />
        </div>
        <div className="min-w-[200px] flex-1">
          <Input label="Starting point (for route)" placeholder="e.g. Hotel Taj, Goa" value={origin} onChange={(e) => setOrigin(e.target.value)} />
        </div>
        <Button icon={Locate} onClick={() => setSearch(destination)}>{loadingNearby ? 'Loading…' : 'Show map'}</Button>
        <Button variant="secondary" icon={Navigation} onClick={getRoute} disabled={!origin} loading={loadingRoute}>
          Route
        </Button>
      </div>

      {isLoading && <div className="flex justify-center py-12"><Spinner size="lg" /></div>}

      {!isLoading && !center && (
        <ProviderNotice title="Live map data unavailable" message="Geocoding requires the Google Maps API key. Interactive map still works with approximate coordinates." />
      )}

      <div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800">
        {center?.lat && center?.lng && (
          <React.Suspense fallback={<div className="h-[520px] bg-slate-100 dark:bg-slate-900" />}>
            <MapView
              center={[center.lat, center.lng]}
              markers={markers}
              directions={directions}
              fallbackDistance={directions?.isLive === false ? directions.directions?.routes?.[0] : null}
            />
          </React.Suspense>
        )}
      </div>

      {/* Legend */}
      <div className="mt-4 flex flex-wrap gap-2 text-xs">
        {Object.entries(CATEGORY_COLORS).map(([type, color]) => (
          <span key={type} className="inline-flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1 font-semibold text-slate-600 shadow-sm dark:bg-slate-900 dark:text-slate-300">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
            {type.replace('_', ' ')}
          </span>
        ))}
      </div>

      {directions && (
        <div className="card mt-4 p-5">
          <h3 className="mb-3 text-sm font-extrabold text-slate-900 dark:text-white">
            Route info {directions.isLive ? '(live)' : directions.directions?.routes?.[0]?.isEstimate ? '(approximate)' : ''}
          </h3>
          {directions.isLive ? (
            <div className="space-y-3">
              {directions.directions.routes.map((route, i) => (
                <div key={i} className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60">
                  <p className="font-bold text-slate-800 dark:text-slate-100">
                    Route {i + 1}: {route.summary} {route.trafficAware && <span className="badge bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400">traffic-aware</span>}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    {route.distanceKm} km · {route.durationMin} min
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">
              Live directions unavailable. Straight-line approximation: {directions.directions?.routes?.[0]?.distanceKm ?? '—'} km · ~{directions.directions?.routes?.[0]?.durationMin ?? '—'} min (estimate).
            </p>
          )}
        </div>
      )}
    </div>
  );
}
