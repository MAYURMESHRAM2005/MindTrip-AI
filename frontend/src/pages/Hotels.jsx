import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Hotel, Search, Star, MapPin } from 'lucide-react';
import PageHeader from '../components/ui/PageHeader';
import { Input, Select } from '../components/ui/Input';
import PlaceAutocomplete from '../components/PlaceAutocomplete';
import Button from '../components/ui/Button';
import ProviderNotice from '../components/ProviderNotice';
import { hotelsApi } from '../services/apiClient';
import { Spinner } from '../components/ui/Spinner';
import { formatCurrency, todayISO } from '../utils/format';
import Badge from '../components/ui/Badge';
import { useI18n } from '../utils/i18n';

function hotelsFromQuery() {
  const sp = new URLSearchParams(window.location.search);
  const checkIn = sp.get('checkIn') || todayISO();
  const checkOut = sp.get('checkOut') || (() => {
    const d = new Date(checkIn);
    d.setDate(d.getDate() + 2);
    return d.toISOString().slice(0, 10);
  })();
  return {
    city: sp.get('city') || '', checkIn, checkOut, adults: 2, rooms: 1, maxPrice: '', minRating: '',
  };
}

export default function Hotels() {
  const { t } = useI18n();
  const [params, setParams] = useState(hotelsFromQuery);
  // Topbar search (?city=Goa) auto-runs the search on mount.
  const [search, setSearch] = useState(() => {
    const sp = new URLSearchParams(window.location.search);
    return sp.get('city') ? hotelsFromQuery() : null;
  });

  const { data, isLoading } = useQuery({
    queryKey: ['hotels', search],
    queryFn: () => hotelsApi.search(search).then((r) => r.data.data),
    enabled: Boolean(search),
  });

  return (
    <div>
      <PageHeader icon={Hotel} title={t('Hotels')} subtitle={t('Live offers from Amadeus, with Geoapify Places fallback.')} />

      <div className="card mb-6 p-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <PlaceAutocomplete label={t('City / destination')} placeholder="Goa" value={params.city} onChange={(city) => setParams({ ...params, city })} />
          <Input label={t('Check-in')} type="date" min={todayISO()} value={params.checkIn} onChange={(e) => setParams({ ...params, checkIn: e.target.value })} />
          <Input label={t('Check-out')} type="date" min={params.checkIn || todayISO()} value={params.checkOut} onChange={(e) => setParams({ ...params, checkOut: e.target.value })} />
          <Input label={t('Guests')} type="number" min={1} value={params.adults} onChange={(e) => setParams({ ...params, adults: Number(e.target.value) || 1 })} />
          <Input label={t('Max price / night')} type="number" placeholder="5000" value={params.maxPrice} onChange={(e) => setParams({ ...params, maxPrice: e.target.value })} />
          <Select label={t('Min rating')} value={params.minRating} onChange={(e) => setParams({ ...params, minRating: e.target.value })} options={[{ value: '', label: t('Any') }, { value: '3', label: '3+' }, { value: '4', label: '4+' }, { value: '4.5', label: '4.5+' }]} />
        </div>
        <Button className="mt-4" icon={Search} disabled={!params.city || !params.checkIn || !params.checkOut} onClick={() => setSearch({ ...params })}>
          {t('Search hotels')}
        </Button>
      </div>

      {isLoading && <div className="flex justify-center py-12"><Spinner size="lg" /></div>}

      {data && !data.isLive && (
        <ProviderNotice
          title={t('Live hotel data unavailable')}
          message={data.message || t('Hotel providers are not configured.')}
          externalSources={[{ name: 'Booking.com', url: 'https://www.booking.com' }, { name: 'MakeMyTrip', url: 'https://www.makemytrip.com' }]}
        />
      )}

      {data?.isLive && (
        <div className="space-y-3">
          <p className="text-xs font-semibold text-emerald-600">
            ● {data.provider === 'amadeus' ? t('Live offers from Amadeus') : t('Live listings from Geoapify Places')}
            {data.note && <span className="text-slate-400"> · {data.note}</span>}
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.hotels.map((h, i) => (
              <div key={h.id || i} className="card flex flex-col p-5 transition-all hover:-translate-y-0.5 hover:shadow-card">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-extrabold text-slate-900 dark:text-white">{h.name || 'Hotel'}</h3>
                    {h.rating != null && (
                      <p className="mt-1 inline-flex items-center gap-1 text-xs font-bold text-amber-500">
                        <Star className="h-3.5 w-3.5 fill-current" /> {h.rating}
                      </p>
                    )}
                  </div>
                  <Badge tone="green">Live</Badge>
                </div>
                {h.address && (
                  <p className="mb-2 flex items-start gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                    <MapPin className="mt-0.5 h-3 w-3 shrink-0" /> {h.address}
                  </p>
                )}
                {h.priceLevel != null && <p className="text-xs text-slate-400">{'₹'.repeat(h.priceLevel + 1) || ''} {t('price level')}</p>}
                <div className="mt-auto flex items-center justify-between pt-3">
                  <p className="text-lg font-extrabold text-slate-900 dark:text-white">
                    {h.price?.amount ? formatCurrency(h.price.amount, h.price.currency || 'INR') : t('Price on request')}
                    {h.price?.amount && <span className="text-xs font-medium text-slate-400"> {t('/night')}</span>}
                  </p>
                  {h.bookingUrl && (
                    <a href={h.bookingUrl} target="_blank" rel="noreferrer" className="btn-secondary px-3 py-1.5 text-xs">
                      {t('Book')}
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
