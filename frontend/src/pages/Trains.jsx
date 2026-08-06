import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TrainFront, Search, Clock } from 'lucide-react';
import PageHeader from '../components/ui/PageHeader';
import { Input } from '../components/ui/Input';
import Button from '../components/ui/Button';
import ProviderNotice from '../components/ProviderNotice';
import { trainsApi } from '../services/apiClient';
import { Spinner } from '../components/ui/Spinner';
import { formatCurrency } from '../utils/format';

export default function Trains() {
  const [params, setParams] = useState({ from: '', to: '', date: '', passengers: 1 });
  const [search, setSearch] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['trains', search],
    queryFn: () => trainsApi.search(search).then((r) => r.data.data),
    enabled: Boolean(search),
  });

  return (
    <div>
      <PageHeader icon={TrainFront} title="Trains" subtitle="Live schedules from a configured train provider." />

      <div className="card mb-6 p-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input label="From" placeholder="Mumbai" value={params.from} onChange={(e) => setParams({ ...params, from: e.target.value })} />
          <Input label="To" placeholder="Goa" value={params.to} onChange={(e) => setParams({ ...params, to: e.target.value })} />
          <Input label="Date" type="date" value={params.date} onChange={(e) => setParams({ ...params, date: e.target.value })} />
          <Input label="Passengers" type="number" min={1} value={params.passengers} onChange={(e) => setParams({ ...params, passengers: Number(e.target.value) || 1 })} />
        </div>
        <Button
          className="mt-4"
          icon={Search}
          disabled={!params.from || !params.to || !params.date}
          onClick={() => setSearch({ ...params })}
        >
          Search trains
        </Button>
      </div>

      {isLoading && <div className="flex justify-center py-12"><Spinner size="lg" /></div>}

      {data && !data.isLive && (
        <ProviderNotice
          title="Live train data unavailable"
          message={data.message || 'Train provider not configured.'}
          externalSources={data.externalSources || [{ name: 'IRCTC', url: 'https://www.irctc.co.in' }]}
        />
      )}

      {data?.isLive && (
        <div className="space-y-3">
          <p className="text-xs font-semibold text-emerald-600">● Live schedules from configured provider</p>
          {data.trains.length === 0 && <div className="card p-8 text-center text-sm text-slate-500">No trains found.</div>}
          {data.trains.map((t, i) => (
            <div key={i} className="card flex flex-wrap items-center gap-4 p-5">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-50 text-cyan-600 dark:bg-cyan-950 dark:text-cyan-400">
                <TrainFront className="h-6 w-6" />
              </div>
              <div className="flex-1">
                <p className="font-extrabold text-slate-900 dark:text-white">{t.trainName || t.name || 'Train'}</p>
                <p className="text-xs text-slate-500">{t.trainNumber || t.number || ''} · {params.from} → {params.to}</p>
              </div>
              <div className="text-sm text-slate-600 dark:text-slate-300">
                {t.departureTime || t.departure} → {t.arrivalTime || t.arrival}
              </div>
              <span className="inline-flex items-center gap-1 text-sm font-semibold text-slate-600 dark:text-slate-300">
                <Clock className="h-4 w-4 text-slate-400" /> {t.duration || '—'}
              </span>
              <p className="text-lg font-extrabold text-slate-900 dark:text-white">
                {t.price ? formatCurrency(t.price.amount, t.price.currency || 'INR') : '—'}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
