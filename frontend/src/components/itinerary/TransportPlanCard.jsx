import React, { useState } from 'react';
import {
  Plane, TrainFront, Bus, Car, Clock, Fuel, BadgeIndianRupee, Navigation,
  ExternalLink, AlertTriangle, CheckCircle2, Info, RefreshCw, ChevronDown,
  ChevronUp, MapPin, ArrowRight, Star, Route,
} from 'lucide-react';
import Card, { CardHeader } from '../ui/Card';
import Badge, { DataSourceBadge } from '../ui/Badge';
import { formatCurrency } from '../../utils/format';
import { useI18n } from '../../utils/i18n';

const MODE_META = {
  flight: { icon: Plane, labelKey: 'Flight', color: 'bg-sky-50 text-sky-600 dark:bg-sky-950 dark:text-sky-400' },
  train: { icon: TrainFront, labelKey: 'Train', color: 'bg-cyan-50 text-cyan-600 dark:bg-cyan-950 dark:text-cyan-400' },
  bus: { icon: Bus, labelKey: 'Bus', color: 'bg-lime-50 text-lime-600 dark:bg-lime-950 dark:text-lime-400' },
  road: { icon: Car, labelKey: 'Car / Road', color: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400' },
};

const MODE_ICONS = { flight: Plane, train: TrainFront, bus: Bus, road: Car };

/* ── Multi-modal Journey Display ────────────────────────────────────── */

function MultiModalJourney({ plan, currency }) {
  const { t } = useI18n();
  const hasGroundTransfer = plan.groundTransfer && plan.groundTransfer.distanceKm > 0;
  const hasDestTransfer = plan.destinationTransfer && plan.destinationTransfer.distanceKm > 0;

  if (!hasGroundTransfer && !hasDestTransfer) return null;

  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-gradient-to-r from-slate-50 to-blue-50/30 p-4 dark:border-slate-700 dark:from-slate-800/60 dark:to-blue-950/20">
      <div className="flex items-center gap-2 mb-3">
        <Route className="h-4 w-4 text-blue-500" />
        <p className="text-xs font-bold uppercase tracking-wide text-blue-600 dark:text-blue-400">
          {t('Multi-modal Journey')}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        {/* Origin */}
        <div className="flex items-center gap-2 text-sm">
          <MapPin className="h-4 w-4 shrink-0 text-slate-400" />
          <span className="font-semibold text-slate-800 dark:text-slate-200">{plan.origin || 'Origin'}</span>
        </div>

        {/* Ground transfer: origin → airport/station */}
        {hasGroundTransfer && (
          <>
            <div className="ml-1 border-l-2 border-dashed border-slate-300 pl-4 py-1 dark:border-slate-600">
              <div className="flex items-center gap-2 text-xs">
                <Car className="h-3 w-3 text-amber-500" />
                <span className="font-medium text-slate-600 dark:text-slate-300">
                  {t('Ground transfer')}: {plan.groundTransfer.from} → {plan.groundTransfer.to}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                <span>{plan.groundTransfer.distanceKm} km</span>
                <span>·</span>
                <span>~{plan.groundTransfer.durationMin} min</span>
                {plan.groundTransfer.fare && (
                  <>
                    <span>·</span>
                    <span className={plan.groundTransfer.fare.isEstimate ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}>
                      {formatCurrency(plan.groundTransfer.fare.amount, currency)}
                      {plan.groundTransfer.fare.isEstimate && ` ${t('(estimate)')}`}
                    </span>
                  </>
                )}
              </div>
            </div>
            <div className="ml-1 flex items-center gap-1 text-slate-400">
              <ArrowRight className="h-3 w-3" />
              <span className="text-[10px]">{t('Transfer complete')}</span>
            </div>
          </>
        )}

        {/* Main transport: flight/train/bus */}
        <div className="ml-1 border-l-2 border-blue-400 pl-4 py-1 dark:border-blue-500">
          <div className="flex items-center gap-2 text-xs">
            {React.createElement(MODE_ICONS[plan.mode] || Plane, { className: 'h-3 w-3 text-blue-500' })}
            <span className="font-medium text-slate-600 dark:text-slate-300">
              {plan.mainTransportLabel || plan.mode}
            </span>
            {plan.mainTransportDetail && (
              <span className="text-slate-500 dark:text-slate-400">— {plan.mainTransportDetail}</span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-slate-500 dark:text-slate-400">
            {plan.duration && <span>{plan.duration}</span>}
            {plan.estimatedFare != null && (
              <>
                <span>·</span>
                <span className={plan.isLive ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>
                  {formatCurrency(plan.estimatedFare, currency)}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Destination transfer: airport → final destination */}
        {hasDestTransfer && (
          <>
            <div className="ml-1 flex items-center gap-1 text-slate-400">
              <ArrowRight className="h-3 w-3" />
              <span className="text-[10px]">{t('Transfer to destination')}</span>
            </div>
            <div className="ml-1 border-l-2 border-dashed border-slate-300 pl-4 py-1 dark:border-slate-600">
              <div className="flex items-center gap-2 text-xs">
                <Car className="h-3 w-3 text-amber-500" />
                <span className="font-medium text-slate-600 dark:text-slate-300">
                  {t('Destination transfer')}: {plan.destinationTransfer.from} → {plan.destinationTransfer.to}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                <span>{plan.destinationTransfer.distanceKm} km</span>
                <span>·</span>
                <span>~{plan.destinationTransfer.durationMin} min</span>
                {plan.destinationTransfer.fare && (
                  <>
                    <span>·</span>
                    <span className={plan.destinationTransfer.fare.isEstimate ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}>
                      {formatCurrency(plan.destinationTransfer.fare.amount, currency)}
                      {plan.destinationTransfer.fare.isEstimate && ` ${t('(estimate)')}`}
                    </span>
                  </>
                )}
              </div>
            </div>
          </>
        )}

        {/* Destination */}
        <div className="flex items-center gap-2 text-sm">
          <MapPin className="h-4 w-4 shrink-0 text-emerald-500" />
          <span className="font-semibold text-slate-800 dark:text-slate-200">{plan.destination || 'Destination'}</span>
        </div>
      </div>

      {/* Total journey summary */}
      {plan.totalCost != null && (
        <div className="mt-3 rounded-lg bg-white/60 px-3 py-2 dark:bg-slate-800/60">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-600 dark:text-slate-300">{t('Total journey cost')}</span>
            <span className="font-bold text-slate-900 dark:text-white">
              {formatCurrency(plan.totalCost, currency)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Alternatives List ──────────────────────────────────────────────── */

function TransportAlternatives({ alternatives, currency, currentMode }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);

  if (!alternatives?.length) return null;

  return (
    <div className="mt-4">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-left transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/40 dark:hover:bg-slate-800/60"
      >
        <div className="flex items-center gap-2">
          <Info className="h-4 w-4 text-slate-400" />
          <span className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {t('All transport options')} ({alternatives.length})
          </span>
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-slate-400" />
        ) : (
          <ChevronDown className="h-4 w-4 text-slate-400" />
        )}
      </button>

      {expanded && (
        <div className="mt-2 space-y-2">
          {alternatives.map((opt, i) => {
            const ModeIcon = MODE_ICONS[opt.mode] || Car;
            const isRecommended = i === 0;
            return (
              <div
                key={i}
                className={`rounded-xl border p-3 transition ${
                  isRecommended
                    ? 'border-blue-300 bg-blue-50/50 dark:border-blue-700 dark:bg-blue-950/20'
                    : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800/40'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <ModeIcon className="h-4 w-4 text-slate-500 dark:text-slate-400" />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                          {opt.name || opt.mode}
                        </span>
                        {isRecommended && (
                          <span className="inline-flex items-center gap-0.5 rounded-md bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-blue-700 dark:bg-blue-950 dark:text-blue-400">
                            <Star className="h-2.5 w-2.5" /> {t('RECOMMENDED')}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                        {opt.recommendation}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    {opt.price?.amount != null && (
                      <p className="text-sm font-bold text-slate-900 dark:text-white">
                        {formatCurrency(opt.price.amount, currency)}
                      </p>
                    )}
                    {opt.duration && (
                      <p className="text-[11px] text-slate-500">{opt.duration}</p>
                    )}
                  </div>
                </div>
                {/* Ground transfer info for multi-modal options */}
                {opt.groundTransfer && opt.groundTransfer.distanceKm > 0 && (
                  <div className="mt-2 rounded-lg bg-slate-50 px-2.5 py-1.5 dark:bg-slate-800/60">
                    <p className="text-[10px] text-slate-500 dark:text-slate-400">
                      🚗 {t('Ground transfer')}: {opt.groundTransfer.distanceKm} km · ~{opt.groundTransfer.durationMin} min
                      {opt.groundTransfer.fare && ` · ${formatCurrency(opt.groundTransfer.fare.amount, currency)}${opt.groundTransfer.fare.isEstimate ? ` ${t('(est)')}` : ''}`}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Transport Fallback Info ────────────────────────────────────────── */

function TransportFallbackInfo({ plan }) {
  const { t } = useI18n();
  const modesChecked = plan.modesChecked || [];
  const fallbackMessage = plan.fallbackMessage || '';
  const alternativesCount = plan.alternativesCount || 0;

  if (!modesChecked.length && !fallbackMessage) return null;

  const MODE_LABELS = { flight: t('Flights'), train: t('Trains'), bus: t('Buses'), road: t('Road') };

  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-700 dark:bg-slate-800/40">
      <div className="flex items-start gap-2">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {t('Transport availability check')}
          </p>

          {/* Modes checked with status */}
          {modesChecked.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {modesChecked.map((mode) => {
                const modeObj = typeof mode === 'string' ? { mode, count: 0, live: false } : mode;
                const modeName = modeObj.mode || mode;
                const isAvailable = modeObj.live || (plan.isLive && plan.mode === modeName);
                const count = modeObj.count || 0;
                return (
                  <span
                    key={modeName}
                    className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold ${
                      isAvailable
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400'
                        : 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400'
                    }`}
                  >
                    {isAvailable ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                    {MODE_LABELS[modeName] || modeName}
                    {isAvailable && count > 0 && ` (${count})`}
                  </span>
                );
              })}
            </div>
          )}

          {/* Fallback message */}
          {fallbackMessage && (
            <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">{fallbackMessage}</p>
          )}

          {/* Alternatives count */}
          {alternativesCount > 0 && (
            <p className="mt-1.5 text-[11px] text-slate-400">
              {alternativesCount} {t('alternative option(s) found')}
            </p>
          )}

          {/* Fetched at */}
          {plan.fetchedAt && (
            <p className="mt-1.5 flex items-center gap-1 text-[10px] text-slate-400">
              <RefreshCw className="h-3 w-3" />
              {t('Data fetched')}: {new Date(plan.fetchedAt).toLocaleString()}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Main Transport Plan Card ───────────────────────────────────────── */

export default function TransportPlanCard({ plan, currency }) {
  const { t } = useI18n();
  if (!plan) return null;
  const meta = MODE_META[plan.mode] || MODE_META.road;
  const Icon = meta.icon;

  return (
    <Card className="mb-6">
      <CardHeader
        icon={Icon}
        title={`${t('Transport')} — ${t(meta.labelKey)}`}
        subtitle={plan.recommendation || t('Mode-matched travel plan with estimated costs')}
        action={<Badge tone={plan.isLive ? 'green' : 'amber'}>{plan.isLive ? `● ${t('Live options')}` : t('Estimate')}</Badge>}
      />

      {/* Key stats */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-900/40">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            {plan.totalCost != null ? t('Total cost') : t('Estimated fare')}
          </p>
          <p className="mt-1 text-xl font-extrabold text-slate-900 dark:text-white">
            {plan.totalCost != null
              ? formatCurrency(plan.totalCost, currency)
              : plan.estimatedFare != null
                ? formatCurrency(plan.estimatedFare, currency)
                : '—'}
          </p>
          <p className="text-[11px] text-slate-400">
            {plan.totalCost != null ? t('all legs included') : t('per direction')}
          </p>
        </div>
        {(plan.duration || plan.totalDuration) && (
          <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-900/40">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t('Travel duration')}</p>
            <p className="mt-1 inline-flex items-center gap-1 text-xl font-extrabold text-slate-900 dark:text-white">
              <Clock className="h-4 w-4 text-slate-400" /> {plan.totalDuration || plan.duration}
            </p>
          </div>
        )}
        {plan.fuelCost != null && (
          <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-900/40">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t('Fuel cost')}</p>
            <p className="mt-1 inline-flex items-center gap-1 text-xl font-extrabold text-slate-900 dark:text-white">
              <Fuel className="h-4 w-4 text-slate-400" /> {formatCurrency(plan.fuelCost, currency)}
            </p>
          </div>
        )}
        {plan.drivingHours != null && (
          <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-900/40">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t('Driving time')}</p>
            <p className="mt-1 inline-flex items-center gap-1 text-xl font-extrabold text-slate-900 dark:text-white">
              <Navigation className="h-4 w-4 text-slate-400" /> {plan.drivingHours}h
            </p>
          </div>
        )}
      </div>

      {/* Multi-modal journey visualization */}
      <MultiModalJourney plan={plan} currency={currency} />

      {/* Transport fallback info — which modes were checked */}
      <TransportFallbackInfo plan={plan} />

      {/* All alternatives */}
      <TransportAlternatives
        alternatives={plan.alternatives}
        currency={currency}
        currentMode={plan.mode}
      />

      {plan.suggestions?.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">{t('Tips')}</p>
          <div className="flex flex-wrap gap-2">
            {plan.suggestions.map((s, i) => (
              <span key={i} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                {s}
              </span>
            ))}
          </div>
        </div>
      )}

      <p className="mt-4 inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
        <ExternalLink className="h-3.5 w-3.5" /> {plan.bookingAdvice || t('Book via your preferred provider')}
      </p>
    </Card>
  );
}
