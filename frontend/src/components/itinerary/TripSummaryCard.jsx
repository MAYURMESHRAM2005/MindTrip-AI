import React from 'react';
import {
  MapPin, CalendarRange, Users, Wallet, Palette, BedDouble, UtensilsCrossed,
  Plane, Sun, CloudSun, Clock, Wind, Droplets,
} from 'lucide-react';
import Card, { CardHeader } from '../ui/Card';
import Badge from '../ui/Badge';
import { formatCurrency } from '../../utils/format';

function Field({ icon: Icon, label, value, sub }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-slate-100 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-900/40">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-brand-600 shadow-sm dark:bg-slate-800 dark:text-brand-400">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
        <p className="mt-0.5 text-sm font-bold text-slate-900 dark:text-white">{value || '—'}</p>
        {sub && <p className="text-xs text-slate-500 dark:text-slate-400">{sub}</p>}
      </div>
    </div>
  );
}

function weatherEmoji(icon) {
  const map = {
    '01': '☀️', '02': '🌤️', '03': '⛅', '04': '☁️', '09': '🌧️',
    '10': '🌦️', '11': '⛈️', '13': '❄️', '50': '🌫️',
  };
  return map[String(icon || '').slice(0, 2)] || '🌡️';
}

export default function TripSummaryCard({ summary, currency }) {
  if (!summary) return null;
  const w = summary.currentWeather;

  return (
    <Card className="mb-6">
      <CardHeader
        icon={MapPin}
        title="Trip summary"
        subtitle="Your trip at a glance"
        action={summary.destination ? <Badge tone="violet">{summary.destination}</Badge> : null}
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field icon={CalendarRange} label="Duration" value={summary.durationDays ? `${summary.durationDays} day${summary.durationDays > 1 ? 's' : ''}` : '—'} />
        <Field
          icon={Users}
          label="Travellers"
          value={summary.travellers?.total ? `${summary.travellers.total} people` : '—'}
          sub={`${summary.travellers?.adults || 0} adults · ${summary.travellers?.children || 0} children`}
        />
        <Field icon={Wallet} label="Budget" value={formatCurrency(summary.budget?.total, currency)} />
        <Field icon={Palette} label="Travel style" value={summary.travelStyle} />
        <Field icon={BedDouble} label="Hotel category" value={summary.hotelCategory} />
        <Field icon={UtensilsCrossed} label="Food preference" value={summary.foodPreference} />
        <Field icon={Plane} label="Transport mode" value={summary.transportMode} />
        <Field icon={Sun} label="Best time to visit" value={summary.bestTimeToVisit} />
      </div>
      {w && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-sky-100 bg-sky-50/70 p-3 dark:border-sky-900/60 dark:bg-sky-950/30">
          <span className="text-2xl">{weatherEmoji(w.icon)}</span>
          <span className="inline-flex items-center gap-1.5 text-sm font-bold text-sky-800 dark:text-sky-200">
            <CloudSun className="h-4 w-4" /> {w.temp != null ? `${Math.round(w.temp)}°C` : '—'} {w.condition}
          </span>
          {w.humidity != null && (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 dark:text-sky-300">
              <Droplets className="h-3.5 w-3.5" /> {w.humidity}% humidity
            </span>
          )}
          {w.windSpeed != null && (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 dark:text-sky-300">
              <Wind className="h-3.5 w-3.5" /> {w.windSpeed} m/s
            </span>
          )}
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 dark:text-sky-300">
            <Clock className="h-3.5 w-3.5" /> {w.isLive ? 'Live weather' : 'Weather estimate'}
          </span>
        </div>
      )}
    </Card>
  );
}
