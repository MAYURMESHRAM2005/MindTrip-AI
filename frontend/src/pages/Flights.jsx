import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plane, Search, Clock, MapPin } from 'lucide-react';
import PageHeader from '../components/ui/PageHeader';
import { Input, Select } from '../components/ui/Input';
import Button from '../components/ui/Button';
import ProviderNotice from '../components/ProviderNotice';
import { flightsApi } from '../services/apiClient';
import { formatCurrency } from '../utils/format';
import { Spinner } from '../components/ui/Spinner';
import Badge from '../components/ui/Badge';

export default function Flights() {
  const [params, setParams] = useState({
    origin: 'BOM', destination: 'GOI', departDate: '', returnDate: '',
    adults: 1, travelClass: 'ECONOMY', nonStop: false,
  });
  const [search, setSearch] = useState(null);

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
      <PageHeader icon={Plane} title="Flights" subtitle="Live flight offers from Amadeus when configured." />

      <div className="card mb-6 p-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input label="From (IATA)" placeholder="BOM" value={params.origin} onChange={(e) => setParams({ ...params, origin: e.target.value.toUpperCase() })} />
          <Input label="To (IATA)" placeholder="GOI" value={params.destination} onChange={(e) => setParams({ ...params, destination: e.target.value.toUpperCase() })} />
          <Input label="Departure" type="date" value={params.departDate} onChange={(e) => setParams({ ...params, departDate: e.target.value })} />
          <Input label="Return (optional)" type="date" value={params.returnDate} onChange={(e) => setParams({ ...params, returnDate: e.target.value })} />
          <Input label="Passengers" type="number" min={1} max={9} value={params.adults} onChange={(e) => setParams({ ...params, adults: Number(e.target.value) || 1 })} />
          <Select label="Class" value={params.travelClass} onChange={(e) => setParams({ ...params, travelClass: e.target.value })} options={['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST']} />
          <label className="flex items-end gap-2 pb-2 text-sm font-semibold text-slate-600 dark:text-slate-300">
            <input type="checkbox" checked={params.nonStop} onChange={(e) => setParams({ ...params, nonStop: e.target.checked })} className="h-4 w-4 accent-brand-600" />
            Non-stop only
          </label>
          <Button onClick={doSearch} icon={Search} className="self-end">
            Search flights
          </Button>
        </div>
      </div>

      {isLoading && <div className="flex justify-center py-12"><Spinner size="lg" /></div>}

      {data && !data.isLive && (
        <ProviderNotice
          title="Live flight data unavailable"
          message={data.message || 'The Amadeus flight provider is not configured or returned no results.'}
          externalSources={[{ name: 'Google Flights', url: 'https://www.google.com/travel/flights' }, { name: 'Skyscanner', url: 'https://www.skyscanner.net' }]}
        />
      )}

      {data?.isLive && (
        <div className="space-y-3">
          <p className="text-xs font-semibold text-emerald-600">● Live offers from {data.provider}</p>
          {data.flights.length === 0 ? (
            <div className="card p-8 text-center text-sm text-slate-500">No flights found for this route and date.</div>
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
                      {f.origin} → {f.destination} · {f.duration}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <span className="inline-flex items-center gap-1.5 font-semibold text-slate-700 dark:text-slate-200">
                    <Clock className="h-4 w-4 text-slate-400" />
                    {new Date(f.departAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <Badge tone={f.stops === 0 ? 'green' : 'amber'}>{f.stops === 0 ? 'Non-stop' : `${f.stops} stop${f.stops > 1 ? 's' : ''}`}</Badge>
                </div>
                <div className="text-right">
                  <p className="text-lg font-extrabold text-slate-900 dark:text-white">{formatCurrency(f.price.amount, f.price.currency)}</p>
                  <a href={f.bookingUrl} target="_blank" rel="noreferrer" className="text-xs font-bold text-brand-600 hover:underline dark:text-brand-400">
                    View on provider →
                  </a>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {isError && <div className="card p-8 text-center text-sm text-rose-500">Search failed. Please try again.</div>}
    </div>
  );
}
