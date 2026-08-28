import React, { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Plane, Search, Clock, MapPin, ExternalLink, DollarSign } from 'lucide-react';
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
import toast from 'react-hot-toast';

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

function BookingLinksButton({ ignavId }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['booking-links', ignavId],
    queryFn: () => flightsApi.bookingLinks(ignavId).then((r) => r.data.data),
    enabled: open && Boolean(ignavId),
  });

  if (!ignavId) return null;

  return (
    <div>
      {!open ? (
        <button onClick={() => setOpen(true)} className="text-xs font-bold text-brand-600 hover:underline dark:text-brand-400">
          {t('Show booking links')} →
        </button>
      ) : isLoading ? (
        <div className="flex items-center gap-1.5 text-xs text-slate-400">
          <Spinner size="sm" /> {t('Loading links…')}
        </div>
      ) : data?.links?.length > 0 ? (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {data.links.slice(0, 4).map((link, i) => (
            <a
              key={i}
              href={link.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              <ExternalLink className="h-3 w-3" />
              {link.provider}
              {link.price?.amount && (
                <span className="text-emerald-600 dark:text-emerald-400">
                  {formatCurrency(link.price.amount, link.price.currency)}
                </span>
              )}
            </a>
          ))}
        </div>
      ) : (
        <a
          href="https://www.google.com/travel/flights"
          target="_blank"
          rel="noreferrer"
          className="text-xs font-bold text-brand-600 hover:underline dark:text-brand-400"
        >
          {t('Search on Google Flights')} →
        </a>
      )}
    </div>
  );
}

export default function Flights() {
  const { t } = useI18n();
  const [params, setParams] = useState(flightsFromQuery);
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

  const hasPrices = data?.flights?.some((f) => f.price?.amount);

  return (
    <div>
      <PageHeader
        icon={Plane}
        title={t('Flights')}
        subtitle={hasPrices ? t('Real prices from Ignav with booking links.') : t('Live flight data with real-time tracking.')}
      />

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
          message={data.message || t('No flight API is returning live data. Set IGNAV_API_KEY (real prices) or AVIATIONSTACK_API_KEY in backend/.env.')}
          externalSources={[{ name: 'Google Flights', url: 'https://www.google.com/travel/flights' }, { name: 'Skyscanner', url: 'https://www.skyscanner.net' }]}
        />
      )}

      {data?.isLive && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold text-emerald-600">
              ● {t('Live from')} {data.provider === 'ignav-flights' ? 'Ignav' : data.provider === 'aviationstack-flights' ? 'AviationStack' : data.provider}
            </p>
            {hasPrices && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                <DollarSign className="h-3 w-3" /> {t('Real prices')}
              </span>
            )}
          </div>
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
                    {f.segments && f.segments.length > 1 && (
                      <p className="text-xs text-slate-400">
                        {f.segments.map((s) => `${s.from}→${s.to}`).join(' · ')}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <span className="inline-flex items-center gap-1.5 font-semibold text-slate-700 dark:text-slate-200">
                    <Clock className="h-4 w-4 text-slate-400" />
                    {f.departAt ? new Date(f.departAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                  </span>
                  <Badge tone={f.stops === 0 ? 'green' : 'amber'}>{f.stops === 0 ? t('Non-stop') : `${f.stops} ${t('stop(s)')}`}</Badge>
                </div>
                <div className="text-right min-w-[120px]">
                  {f.price?.amount ? (
                    <>
                      <p className="text-lg font-extrabold text-slate-900 dark:text-white">
                        {formatCurrency(f.price.amount, f.price.currency)}
                      </p>
                      {f.price.perPerson && (
                        <p className="text-[10px] font-semibold text-slate-400 dark:text-slate-500">{t('per person')}</p>
                      )}
                    </>
                  ) : (
                    <p className="text-sm text-slate-400">{t('Price on request')}</p>
                  )}
                  <BookingLinksButton ignavId={f.ignavId} />
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
