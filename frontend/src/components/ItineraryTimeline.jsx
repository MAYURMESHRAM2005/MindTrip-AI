import React from 'react';
import { motion } from 'framer-motion';
import {
  Plane, TrainFront, Bus, Hotel, UtensilsCrossed, Landmark, Activity,
  CloudSun, AlertTriangle, Clock, MapPin, Navigation,
} from 'lucide-react';
import { DataStatusBadge } from './ui/Badge';
import { formatCurrency, formatDateShort } from '../utils/format';

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
  const Icon = CATEGORY_ICON[activity.category] || Activity;
  const color = CATEGORY_COLOR[activity.category] || CATEGORY_COLOR.transport;
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
        </div>
        {activity.description && (
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{activity.description}</p>
        )}
        {(activity.address || activity.bookingUrl) && (
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
            {activity.address && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3 w-3" /> {activity.address}
              </span>
            )}
            {activity.travel?.durationMin > 0 && (
              <span className="inline-flex items-center gap-1">
                <Navigation className="h-3 w-3" /> {activity.travel.durationMin} min {activity.travel.method}
                {activity.travel.isEstimate && ' (est.)'}
              </span>
            )}
            {activity.bookingUrl && (
              <a href={activity.bookingUrl} target="_blank" rel="noreferrer" className="font-semibold text-brand-600 hover:underline dark:text-brand-400">
                Book / source
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
          <p className="text-[10px] font-medium uppercase tracking-wide text-amber-500">estimate</p>
        )}
      </div>
    </motion.div>
  );
}

export default function ItineraryTimeline({ days = [], currency = 'INR' }) {
  if (!days.length) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-dashed border-slate-300 p-6 text-sm text-slate-500 dark:border-slate-700">
        <AlertTriangle className="h-5 w-5 text-amber-500" />
        No itinerary generated yet.
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
                <p className="text-sm font-bold text-slate-900 dark:text-white">Day {day.dayNumber}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{formatDateShort(day.date)}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 text-xs">
              {day.weather?.condition && (
                <span className="inline-flex items-center gap-1 rounded-lg bg-sky-50 px-2 py-1 font-semibold text-sky-700 dark:bg-sky-950 dark:text-sky-300">
                  <CloudSun className="h-3.5 w-3.5" />
                  {day.weather.temp != null && `${Math.round(day.weather.temp)}°C `}
                  {day.weather.condition}
                  {day.weather.rainProbability > 40 && ` 🌧 ${day.weather.rainProbability}%`}
                </span>
              )}
              <span className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                <Clock className="h-3.5 w-3.5" />
                {formatCurrency(day.dayCost, currency)}
              </span>
            </div>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800/70">
            {day.activities.map((activity, i) => (
              <ActivityRow key={activity._id || i} activity={activity} currency={currency} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
