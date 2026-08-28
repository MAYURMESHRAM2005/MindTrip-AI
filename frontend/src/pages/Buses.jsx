import React, { useState, useCallback, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bus, Search, Clock, Users, ChevronRight, MapPin, RefreshCw } from 'lucide-react';
import PageHeader from '../components/ui/PageHeader';
import { Input } from '../components/ui/Input';
import Button from '../components/ui/Button';
import ProviderNotice from '../components/ProviderNotice';
import { busesApi } from '../services/apiClient';
import { Spinner } from '../components/ui/Spinner';
import { formatCurrency, todayISO } from '../utils/format';
import { useI18n } from '../utils/i18n';

export default function Buses() {
  const { t } = useI18n();
  const [params, setParams] = useState({ from: '', to: '', date: '', passengers: 1 });
  const [search, setSearch] = useState(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['buses', search],
    queryFn: () => busesApi.search(search).then((r) => r.data.data),
    enabled: Boolean(search),
    retry: 1,
    staleTime: 30_000,
  });

  return (
    <div>
      <PageHeader icon={Bus} title={t('Buses')} subtitle={t('Live bus schedules across India via Pay2all.')} />

      {/* Search form */}
      <div className="card mb-6 p-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input
            label={t('From')}
            placeholder="Pune"
            value={params.from}
            onChange={(e) => setParams({ ...params, from: e.target.value })}
          />
          <Input
            label={t('To')}
            placeholder="Goa"
            value={params.to}
            onChange={(e) => setParams({ ...params, to: e.target.value })}
          />
          <Input
            label={t('Date')}
            type="date"
            min={todayISO()}
            value={params.date}
            onChange={(e) => setParams({ ...params, date: e.target.value })}
          />
          <Input
            label={t('Passengers')}
            type="number"
            min={1}
            value={params.passengers}
            onChange={(e) => setParams({ ...params, passengers: Number(e.target.value) || 1 })}
          />
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Button
            icon={Search}
            disabled={!params.from || !params.to || !params.date}
            onClick={() => setSearch({ ...params })}
          >
            {t('Search buses')}
          </Button>
          {search && (
            <Button
              variant="secondary"
              icon={RefreshCw}
              onClick={() => refetch()}
              disabled={isLoading}
            >
              {t('Refresh')}
            </Button>
          )}
        </div>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex flex-col items-center justify-center py-16">
          <Spinner size="lg" />
          <p className="mt-3 text-sm text-slate-500">{t('Searching buses…')}</p>
        </div>
      )}

      {/* No provider */}
      {data && !data.isLive && (
        <ProviderNotice
          title={t('Live bus data unavailable')}
          message={data.message || t('Bus provider not configured.')}
          externalSources={data.externalSources || [{ name: 'RedBus', url: 'https://www.redbus.in' }]}
        />
      )}

      {/* Results */}
      {data?.isLive && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-emerald-600">● {data.buses.length} {t('trips found')}</p>
          </div>

          {data.buses.length === 0 && (
            <div className="card p-8 text-center text-sm text-slate-500">
              {t('No buses found for this route. Try a different date or nearby cities.')}
            </div>
          )}

          {data.buses.map((bus, i) => (
            <BusCard key={bus.id || bus.tripId || i} bus={bus} params={params} t={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function BusCard({ bus, params, t }) {
  const [expanded, setExpanded] = useState(false);

  const fareMin = bus.fareMin || bus.fare_min || bus.price?.amount || 0;
  const fareMax = bus.fareMax || bus.fare_max || fareMin;
  const hasPrice = fareMin > 0;
  const priceDisplay = hasPrice && fareMax !== fareMin
    ? `${formatCurrency(fareMin, 'INR')} – ${formatCurrency(fareMax, 'INR')}`
    : hasPrice
      ? formatCurrency(fareMin, 'INR')
      : '—';

  return (
    <div className="card overflow-hidden transition-shadow hover:shadow-md">
      <div
        className="flex flex-wrap items-center gap-4 p-5 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        {/* Bus icon */}
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-lime-50 text-lime-600 dark:bg-lime-950 dark:text-lime-400">
          <Bus className="h-6 w-6" />
        </div>

        {/* Operator & type */}
        <div className="flex-1 min-w-[140px]">
          <p className="font-extrabold text-slate-900 dark:text-white">
            {bus.operator || 'Bus'}
          </p>
          <p className="text-xs text-slate-500">{bus.busType}</p>
        </div>

        {/* Times */}
        <div className="text-sm text-slate-600 dark:text-slate-300 min-w-[140px]">
          <span className="font-semibold">{bus.departure || '—'}</span>
          <span className="mx-1">→</span>
          <span className="font-semibold">{bus.arrival || '—'}</span>
        </div>

        {/* Duration */}
        <span className="inline-flex items-center gap-1 text-sm text-slate-500">
          <Clock className="h-3.5 w-3.5" /> {bus.duration || '—'}
        </span>

        {/* Available seats */}
        {(bus.seatsAvailable || bus.availableSeats) > 0 && (
          <span className="inline-flex items-center gap-1 text-xs text-slate-500">
            <Users className="h-3.5 w-3.5" /> {bus.seatsAvailable || bus.availableSeats} {t('seats')}
          </span>
        )}

        {/* Price */}
        <p className="text-lg font-extrabold text-slate-900 dark:text-white min-w-[120px] text-right">
          {priceDisplay}
        </p>

        {/* Expand arrow */}
        <ChevronRight
          className={`h-5 w-5 text-slate-400 transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-slate-100 bg-slate-50 px-5 py-4 dark:border-slate-800 dark:bg-slate-900/50">
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Detail label={t('Operator')} value={bus.operator} />
            <Detail label={t('Bus type')} value={bus.busType} />
            <Detail label={t('Departure')} value={bus.departure} />
            <Detail label={t('Arrival')} value={bus.arrival} />
            <Detail label={t('Duration')} value={bus.duration} />
            <Detail label={t('Seats available')} value={(bus.seatsAvailable || bus.availableSeats) > 0 ? (bus.seatsAvailable || bus.availableSeats) : '—'} />
            <Detail label={t('Route')} value={`${params.from} → ${params.to}`} />
            <Detail
              label={t('Price range')}
              value={hasPrice ? priceDisplay : '—'}
              highlight={hasPrice}
            />
          </div>

          {/* CTA */}
          <div className="mt-4 flex gap-2">
            <a
              href={`https://www.redbus.in/results?from=${encodeURIComponent(params.from)}&to=${encodeURIComponent(params.to)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700 transition-colors"
            >
              <MapPin className="h-3.5 w-3.5" /> {t('Book on RedBus')}
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

function Detail({ label, value, highlight }) {
  return (
    <div>
      <p className="text-xs text-slate-400">{label}</p>
      <p className={`font-semibold ${highlight ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-700 dark:text-slate-200'}`}>
        {value || '—'}
      </p>
    </div>
  );
}
