import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { UtensilsCrossed, Search, Star, MapPin } from 'lucide-react';
import PageHeader from '../components/ui/PageHeader';
import { Input } from '../components/ui/Input';
import Button from '../components/ui/Button';
import ProviderNotice from '../components/ProviderNotice';
import { restaurantsApi } from '../services/apiClient';
import { Spinner } from '../components/ui/Spinner';
import Badge from '../components/ui/Badge';
import { cn } from '../utils/format';

export default function Restaurants() {
  const [params, setParams] = useState({ q: '', veg: false, vegan: false, nonVeg: false, minRating: '' });
  const [search, setSearch] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['restaurants', search],
    queryFn: () => restaurantsApi.search(search).then((r) => r.data.data),
    enabled: Boolean(search),
  });

  const toggle = (key) => setParams({ ...params, veg: false, vegan: false, nonVeg: false, [key]: !params[key] });

  return (
    <div>
      <PageHeader icon={UtensilsCrossed} title="Restaurants" subtitle="Real Geoapify Places data with food-preference filters." />

      <div className="card mb-6 p-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <Input
              label="Search restaurants"
              placeholder="Best restaurants in Goa…"
              value={params.q}
              onKeyDown={(e) => e.key === 'Enter' && setSearch({ ...params })}
              onChange={(e) => setParams({ ...params, q: e.target.value })}
            />
          </div>
          <div className="flex flex-wrap gap-2 pb-1">
            {[
              { key: 'veg', label: '🌿 Vegetarian' },
              { key: 'vegan', label: '🥬 Vegan' },
              { key: 'nonVeg', label: '🍗 Non-veg' },
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
              <option value="">Any rating</option>
              <option value="4">4.0+</option>
              <option value="4.5">4.5+</option>
            </select>
          </div>
          <Button icon={Search} onClick={() => setSearch({ ...params })}>Search</Button>
        </div>
      </div>

      {isLoading && <div className="flex justify-center py-12"><Spinner size="lg" /></div>}

      {data && !data.isLive && (
        <ProviderNotice title="Live restaurant data unavailable" message={data.message} externalSources={[{ name: 'OpenStreetMap', url: 'https://www.openstreetmap.org' }, { name: 'Zomato', url: 'https://www.zomato.com' }]} />
      )}

      {data?.isLive && (
        <>
          <p className="mb-3 text-xs font-semibold text-emerald-600">
            ● Live from Geoapify Places
            {data.filterApplied && (
              <span className="text-slate-400"> · diet filter requested (Places may not expose diet labels — check each listing)</span>
            )}
          </p>
          {data.restaurants.length === 0 ? (
            <div className="card p-8 text-center text-sm text-slate-500">
              No matching restaurants. Try clearing the diet filter — diet details aren't always exposed by Places.
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {data.restaurants.map((r, i) => (
                <div key={r.placeId || i} className="card flex flex-col p-5 transition-all hover:-translate-y-0.5 hover:shadow-card">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-extrabold text-slate-900 dark:text-white">{r.name}</h3>
                    {r.openNow != null && (
                      <Badge tone={r.openNow ? 'green' : 'slate'}>{r.openNow ? 'Open' : 'Closed'}</Badge>
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
                  <div className="mt-auto pt-3">
                    <a
                      href={r.coordinates?.lat != null ? `https://www.openstreetmap.org/?mlat=${r.coordinates.lat}&mlon=${r.coordinates.lng}#map=17/${r.coordinates.lat}/${r.coordinates.lng}` : `https://www.openstreetmap.org/search?query=${encodeURIComponent(r.name)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="btn-secondary w-full py-1.5 text-xs"
                    >
                      View on map
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
