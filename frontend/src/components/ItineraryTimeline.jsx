import React, { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Plane, TrainFront, Bus, Hotel, UtensilsCrossed, Landmark, Activity,
  CloudSun, AlertTriangle, Clock, MapPin, Navigation, Map, Moon, Wallet,
  RefreshCw, Database, ChevronDown, ChevronUp,
} from 'lucide-react';
import { DataStatusBadge } from './ui/Badge';
import { formatCurrency, formatDateShort } from '../utils/format';
import { useI18n } from '../utils/i18n';

const CATEGORY_ICON = {
  flight: Plane, train: TrainFront, bus: Bus, hotel: Hotel, restaurant: UtensilsCrossed,
  attraction: Landmark, activity: Activity, weather: CloudSun, transport: Plane,
};

const CATEGORY_COLOR = {
  flight: 'bg-sky-100 text-sky-600 dark:bg-sky-950 dark:text-sky-400',
  train: 'bg-cyan-100 text-cyan-600 dark:bg-cyan-950 dark:text-cyan-400',
  bus: 'bg-lime-100 text-lime-600 dark:bg-lime-950 dark:text-lime-400',
  hotel: 'bg-indigo-100 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400',
  restaurant: 'bg-rose-100 text-rose-600 dark:bg-rose-950 dark:text-rose-400',
  attraction: 'bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-400',
  activity: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400',
  transport: 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
};

function ActivityRow({ activity, currency }) {
  const { t } = useI18n();
  const [showMeta, setShowMeta] = useState(false);
  const Icon = CATEGORY_ICON[activity.category] || Activity;
  const color = CATEGORY_COLOR[activity.category] || CATEGORY_COLOR.transport;
  const hasMeta = activity.fetchedAt || activity.source || activity.cost?.estimateNote;
  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      className="relative flex gap-3 rounded-xl px-3 py-3 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50"
    >
      <div className="flex w-14 shrink-0 flex-col items-center pt-0.5">
        <span className="text-xs font-bold text-slate-700 dark:text-slate-200">{activity.time || '--:--'}</span>
      </div>
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${color}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-bold text-slate-900 dark:text-white">{activity.title}</p>
          <DataStatusBadge status={activity.dataStatus} />
          {hasMeta && (
            <button
              onClick={() => setShowMeta(!showMeta)}
              className="inline-flex items-center gap-0.5 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 transition-colors hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
              title={t('Data source info')}
            >
              <Database className="h-2.5 w-2.5" />
              {showMeta ? <ChevronUp className="h-2.5 w-2.5" /> : <ChevronDown className="h-2.5 w-2.5" />}
            </button>
          )}
        </div>

        {/* Data source metadata panel (toggle) */}
        {showMeta && hasMeta && (
          <div className="mt-1.5 rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/40">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-500 dark:text-slate-400">
              {activity.source && (
                <span className="inline-flex items-center gap-1">
                  <Database className="h-3 w-3" /> {t('Source')}: <b>{activity.source}</b>
                </span>
              )}
              {activity.fetchedAt && (
                <span className="inline-flex items-center gap-1">
                  <RefreshCw className="h-3 w-3" /> {t('Fetched')}: {new Date(activity.fetchedAt).toLocaleString()}
                </span>
              )}
              {activity.cost?.estimateNote && (
                <span className="inline-flex items-center gap-1">
                  💰 {activity.cost.estimateNote}
                </span>
              )}
            </div>
          </div>
        )}

        {activity.description && (
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{activity.description}</p>
        )}
        {(activity.address || activity.bookingUrl || activity.travel?.durationMin > 0 || activity.travel?.distanceKm > 0) && (
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
            {activity.address && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3 w-3" /> {activity.address}
              </span>
            )}
            {(activity.travel?.distanceKm > 0 || activity.travel?.durationMin > 0) && (
              <span className="inline-flex items-center gap-1">
                <Navigation className="h-3 w-3" />
                {activity.travel.distanceKm > 0 && `${activity.travel.distanceKm} km · `}
                {activity.travel.durationMin} min {activity.travel.method}
                {activity.travel.isEstimate && ` (${t('est.')})`}
              </span>
            )}
            {activity.bookingUrl && (
              <a href={activity.bookingUrl} target="_blank" rel="noreferrer" className="font-semibold text-brand-600 hover:underline dark:text-brand-400">
                {t('Book / source')}
              </a>
            )}
          </div>
        )}
      </div>
      <div className="shrink-0 text-right">
        <p className="text-sm font-extrabold text-slate-900 dark:text-white">
          {activity.cost?.amount ? formatCurrency(activity.cost.amount, currency) : '—'}
        </p>
        {activity.cost?.isEstimate && activity.cost?.amount > 0 && (
          <p className="text-[10px] font-medium uppercase tracking-wide text-amber-500">{t('estimate')}</p>
        )}
        {activity.cost?.perPerson > 0 && (
          <p className="text-[10px] text-slate-400">≈ {formatCurrency(activity.cost.perPerson, currency)}{t('/person')}</p>
        )}
      </div>
    </motion.div>
  );
}

const BREAKDOWN_KEYS = ['accommodation', 'breakfast', 'lunch', 'dinner', 'transport', 'activities', 'evening', 'night'];

const BREAKDOWN_LABEL_KEY = {
  accommodation: 'Accommodation',
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  transport: 'Transport',
  activities: 'Activities',
  evening: 'Evening',
  night: 'Night activity',
};

function DayCostBreakdown({ breakdown, currency }) {
  const { t } = useI18n();
  if (!breakdown || typeof breakdown.dayTotal !== 'number') return null;
  const rows = BREAKDOWN_KEYS.filter((k) => breakdown[k] > 0);
  return (
    <div className="border-t border-slate-100 bg-slate-50/60 px-5 py-4 dark:border-slate-800 dark:bg-slate-900/40">
      <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">
        <Wallet className="h-3.5 w-3.5" /> {t('Day cost breakdown')}
      </p>
      <div className="mt-2.5 grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3">
        {rows.map((k) => (
          <div key={k} className="flex items-baseline justify-between gap-2 text-xs">
            <span className="text-slate-500 dark:text-slate-400">{t(BREAKDOWN_LABEL_KEY[k])}</span>
            <span className="font-bold text-slate-800 dark:text-slate-100">{formatCurrency(breakdown[k], currency)}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 border-t border-slate-200/70 pt-3 dark:border-slate-700/70 sm:grid-cols-4">
        <div>
          <p className="text-[10px] font-semibold uppercase text-slate-400">{t('Day total')}</p>
          <p className="text-sm font-extrabold text-slate-900 dark:text-white">{formatCurrency(breakdown.dayTotal, currency)}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase text-slate-400">{t('Per person')}</p>
          <p className="text-sm font-extrabold text-slate-900 dark:text-white">{formatCurrency(breakdown.perPerson, currency)}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase text-slate-400">{t('Cumulative')}</p>
          <p className="text-sm font-extrabold text-slate-900 dark:text-white">{formatCurrency(breakdown.cumulative, currency)}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase text-slate-400">{t('Remaining budget')}</p>
          <p className={`text-sm font-extrabold ${breakdown.remainingBudget >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
            {formatCurrency(breakdown.remainingBudget, currency)}
          </p>
        </div>
      </div>
    </div>
  );
}

export default function ItineraryTimeline({ days = [], currency = 'INR' }) {
  const { t } = useI18n();
  if (!days.length) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-dashed border-slate-300 p-6 text-sm text-slate-500 dark:border-slate-700">
        <AlertTriangle className="h-5 w-5 text-amber-500" />
        {t('No itinerary generated yet.')}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {days.map((day) => (
        <div key={day.dayNumber} className="card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-gradient-to-r from-brand-50 to-transparent px-5 py-3.5 dark:border-slate-800 dark:from-brand-950/40">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-sm font-extrabold text-white">
                {day.dayNumber}
              </span>
              <div>
                <p className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
                  {t('Day')} {day.dayNumber}
                  {day.area && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-700 dark:bg-brand-950 dark:text-brand-300">
                      <Map className="h-3 w-3" /> {day.area}
                    </span>
                  )}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{formatDateShort(day.date)}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs">
              {day.weather?.condition && (
                <span className="inline-flex items-center gap-1 rounded-lg bg-sky-50 px-2 py-1 font-semibold text-sky-700 dark:bg-sky-950 dark:text-sky-300">
                  <CloudSun className="h-3.5 w-3.5" />
                  {day.weather.tempMax != null && `${Math.round(day.weather.tempMax)}°C `}
                  {day.weather.condition}
                  {day.weather.rainProbability > 40 && ` 🌧 ${day.weather.rainProbability}%`}
                  {day.weather.indoorPlan && ` · 🏠 ${t('indoor')}`}
                </span>
              )}
              <span className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                <Clock className="h-3.5 w-3.5" />
                {formatCurrency(day.dayCost, currency)}
              </span>
            </div>
          </div>

          {day.overnight && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-100 bg-indigo-50/50 px-5 py-2.5 text-xs dark:border-slate-800 dark:bg-indigo-950/20">
              <span className="inline-flex items-center gap-1.5 font-bold text-indigo-700 dark:text-indigo-300">
                <Moon className="h-3.5 w-3.5" /> {t('Overnight')}: {day.overnight.name}
              </span>
              {day.overnight.area && <span className="text-slate-500 dark:text-slate-400">· {day.overnight.area}</span>}
              {day.overnight.pricePerRoomNight > 0 && (
                <span className="text-slate-500 dark:text-slate-400">
                  · {formatCurrency(day.overnight.pricePerRoomNight, currency)}{t('/room/night')} × {day.overnight.rooms} {t('room(s)')}
                  {day.overnight.nights > 0 ? ` × ${day.overnight.nights} ${t('night(s)')}` : ''} ={' '}
                  <b className="text-slate-800 dark:text-slate-100">{formatCurrency(day.overnight.total, currency)}</b>
                </span>
              )}
              {day.overnight.isLive ? (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">{t('live')}</span>
              ) : (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-700 dark:bg-amber-950 dark:text-amber-300">{t('estimated')}</span>
              )}
            </div>
          )}

          <div className="divide-y divide-slate-100 dark:divide-slate-800/70">
            {day.activities.map((activity, i) => (
              <ActivityRow key={activity._id || i} activity={activity} currency={currency} />
            ))}
          </div>

          <DayCostBreakdown breakdown={day.costBreakdown} currency={currency} />
        </div>
      ))}
    </div>
  );
}
