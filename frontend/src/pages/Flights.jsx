import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plane, Search, Clock, MapPin } from 'lucide-react';
import PageHeader from '../components/ui/PageHeader';
import { Input, Select } from '../components/ui/Input';
import PlaceAutocomplete from '../components/PlaceAutocomplete';
import Button from '../components/ui/Button';
import ProviderNotice from '../components/ProviderNotice';
import { flightsApi } from '../services/apiClient';
import { formatCurrency, todayISO } from '../utils/format';
import { Spinner } from '../components/ui/Spinner';
import Badge from '../components/ui/Badge';
import { useI18n } from '../utils/i18n';

function flightsFromQuery() {
  const sp = new URLSearchParams(window.location.search);
  const to = sp.get('to') || '';
  return {
    origin: sp.get('from') || '',
    destination: to,
    departDate: sp.get('date') || todayISO(),
    returnDate: sp.get('returnDate') || '',
    adults: 1,
    travelClass: 'ECONOMY',
    nonStop: false,
  };
}

export default function Flights() {
  const { t } = useI18n();
  const [params, setParams] = useState(flightsFromQuery);
  // Topbar search (?to=Goa) should auto-run the search on mount.
  const [search, setSearch] = useState(() => {
    const sp = new URLSearchParams(window.location.search);
    return sp.get('to') || sp.get('from') ? flightsFromQuery() : null;
  });

  const { data, isLoading, isError } = useQuery({
    queryKey: ['flights', search],
    queryFn: () => flightsApi.search(search).then((r) => r.data.data),
    enabled: Boolean(search),
  });

  const doSearch = () => {
    if (!params.origin || !params.destination || !params.departDate) return;
    setSearch({ ...params });
  };

  return (
    <div>
      <PageHeader icon={Plane} title={t('Flights')} subtitle={t('Live flight data from AviationStack.')} />

      <div className="card mb-6 p-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <PlaceAutocomplete label={t('From')} placeholder="Mumbai, Delhi…" value={params.origin} onChange={(v) => setParams({ ...params, origin: v })} />
          <PlaceAutocomplete label={t('To')} placeholder="Goa, Pune…" value={params.destination} onChange={(v) => setParams({ ...params, destination: v })} />
          <Input label={t('Departure')} type="date" min={todayISO()} value={params.departDate} onChange={(e) => setParams({ ...params, departDate: e.target.value })} />
          <Input label={t('Return (optional)')} type="date" min={params.departDate || todayISO()} value={params.returnDate} onChange={(e) => setParams({ ...params, returnDate: e.target.value })} />
          <Input label={t('Passengers')} type="number" min={1} max={9} value={params.adults} onChange={(e) => setParams({ ...params, adults: Number(e.target.value) || 1 })} />
          <Select label={t('Class')} value={params.travelClass} onChange={(e) => setParams({ ...params, travelClass: e.target.value })} options={['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST']} />
          <label className="flex items-end gap-2 pb-2 text-sm font-semibold text-slate-600 dark:text-slate-300">
            <input type="checkbox" checked={params.nonStop} onChange={(e) => setParams({ ...params, nonStop: e.target.checked })} className="h-4 w-4 accent-brand-600" />
            {t('Non-stop only')}
          </label>
          <Button onClick={doSearch} icon={Search} className="self-end">
            {t('Search flights')}
          </Button>
        </div>
      </div>

      {isLoading && <div className="flex justify-center py-12"><Spinner size="lg" /></div>}

      {data && !data.isLive && (
        <ProviderNotice
          title={t('Live flight data unavailable')}
          message={data.message || t('AviationStack is not returning live data. Check that AVIATIONSTACK_API_KEY is set in backend/.env and that your AviationStack plan quota has not been reached.')}
          externalSources={[{ name: 'Google Flights', url: 'https://www.google.com/travel/flights' }, { name: 'Skyscanner', url: 'https://www.skyscanner.net' }]}
        />
      )}

      {data?.isLive && (
        <div className="space-y-3">
          <p className="text-xs font-semibold text-emerald-600">
            ● {t('Live from')} {data.provider === 'aviationstack-flights' ? 'AviationStack' : data.provider}
          </p>
          {data.message && (
            <p className="text-xs text-slate-500 dark:text-slate-400">{data.message}</p>
          )}
          {data.flights.length === 0 ? (
            <div className="card p-8 text-center text-sm text-slate-500">{t('No flights found for this route and date.')}</div>
          ) : (
            data.flights.map((f, i) => (
              <div key={f.id || i} className="card flex flex-wrap items-center gap-4 p-5">
                <div className="flex flex-1 items-center gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-50 text-sky-600 dark:bg-sky-950 dark:text-sky-400">
                    <Plane className="h-6 w-6" />
                  </div>
                  <div>
                    <p className="font-extrabold text-slate-900 dark:text-white">
                      {f.airline} {f.flightNumber}
                    </p>
                    <p className="text-xs text-slate-500">
                      {f.origin} → {f.destination}{f.duration ? ` · ${f.duration}` : ''}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <span className="inline-flex items-center gap-1.5 font-semibold text-slate-700 dark:text-slate-200">
                    <Clock className="h-4 w-4 text-slate-400" />
                    {f.departAt ? new Date(f.departAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                  </span>
                  <Badge tone={f.stops === 0 ? 'green' : 'amber'}>{f.stops === 0 ? t('Non-stop') : `${f.stops} ${t('stop(s)')}`}</Badge>
                </div>
                <div className="text-right">
                  <p className="text-lg font-extrabold text-slate-900 dark:text-white">
                    {f.price?.amount ? formatCurrency(f.price.amount, f.price.currency) : t('Price on request')}
                  </p>
                  <a href={f.bookingUrl} target="_blank" rel="noreferrer" className="text-xs font-bold text-brand-600 hover:underline dark:text-brand-400">
                    {t('View on provider')} →
                  </a>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {isError && <div className="card p-8 text-center text-sm text-rose-500">{t('Search failed. Please try again.')}</div>}
    </div>
  );
}
