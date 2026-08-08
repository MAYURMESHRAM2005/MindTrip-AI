import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bus, Search, Clock } from 'lucide-react';
import PageHeader from '../components/ui/PageHeader';
import { Input } from '../components/ui/Input';
import PlaceAutocomplete from '../components/PlaceAutocomplete';
import Button from '../components/ui/Button';
import ProviderNotice from '../components/ProviderNotice';
import { busesApi } from '../services/apiClient';
import { Spinner } from '../components/ui/Spinner';
import { formatCurrency, todayISO } from '../utils/format';

export default function Buses() {
  const [params, setParams] = useState({ from: '', to: '', date: '', passengers: 1 });
  const [search, setSearch] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['buses', search],
    queryFn: () => busesApi.search(search).then((r) => r.data.data),
    enabled: Boolean(search),
  });

  return (
    <div>
      <PageHeader icon={Bus} title="Buses" subtitle="Live schedules from a configured bus provider." />

      <div className="card mb-6 p-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <PlaceAutocomplete label="From" placeholder="Pune" value={params.from} onChange={(v) => setParams({ ...params, from: v })} />
          <PlaceAutocomplete label="To" placeholder="Goa" value={params.to} onChange={(v) => setParams({ ...params, to: v })} />
          <Input label="Date" type="date" min={todayISO()} value={params.date} onChange={(e) => setParams({ ...params, date: e.target.value })} />
          <Input label="Passengers" type="number" min={1} value={params.passengers} onChange={(e) => setParams({ ...params, passengers: Number(e.target.value) || 1 })} />
        </div>
        <Button className="mt-4" icon={Search} disabled={!params.from || !params.to || !params.date} onClick={() => setSearch({ ...params })}>
          Search buses
        </Button>
      </div>

      {isLoading && <div className="flex justify-center py-12"><Spinner size="lg" /></div>}

      {data && !data.isLive && (
        <ProviderNotice
          title="Live bus data unavailable"
          message={data.message || 'Bus provider not configured.'}
          externalSources={data.externalSources || [{ name: 'RedBus', url: 'https://www.redbus.in' }]}
        />
      )}

      {data?.isLive && (
        <div className="space-y-3">
          <p className="text-xs font-semibold text-emerald-600">● Live schedules from configured provider</p>
          {data.buses.length === 0 && <div className="card p-8 text-center text-sm text-slate-500">No buses found.</div>}
          {data.buses.map((b, i) => (
            <div key={i} className="card flex flex-wrap items-center gap-4 p-5">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-lime-50 text-lime-600 dark:bg-lime-950 dark:text-lime-400">
                <Bus className="h-6 w-6" />
              </div>
              <div className="flex-1">
                <p className="font-extrabold text-slate-900 dark:text-white">{b.operator || b.name || 'Bus'}</p>
                <p className="text-xs text-slate-500">{params.from} → {params.to}</p>
              </div>
              <div className="text-sm text-slate-600 dark:text-slate-300">
                {b.departureTime || b.departure} → {b.arrivalTime || b.arrival}
              </div>
              <span className="inline-flex items-center gap-1 text-sm font-semibold text-slate-600 dark:text-slate-300">
                <Clock className="h-4 w-4 text-slate-400" /> {b.duration || '—'}
              </span>
              <p className="text-lg font-extrabold text-slate-900 dark:text-white">
                {b.price ? formatCurrency(b.price.amount, b.price.currency || 'INR') : '—'}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
