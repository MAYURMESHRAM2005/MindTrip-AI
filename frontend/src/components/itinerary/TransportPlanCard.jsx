import React from 'react';
import { Plane, TrainFront, Bus, Car, Clock, Fuel, BadgeIndianRupee, Navigation, ExternalLink } from 'lucide-react';
import Card, { CardHeader } from '../ui/Card';
import Badge from '../ui/Badge';
import { formatCurrency } from '../../utils/format';

const MODE_META = {
  flight: { icon: Plane, label: 'Flight', color: 'bg-sky-50 text-sky-600 dark:bg-sky-950 dark:text-sky-400' },
  train: { icon: TrainFront, label: 'Train', color: 'bg-cyan-50 text-cyan-600 dark:bg-cyan-950 dark:text-cyan-400' },
  bus: { icon: Bus, label: 'Bus', color: 'bg-lime-50 text-lime-600 dark:bg-lime-950 dark:text-lime-400' },
  car: { icon: Car, label: 'Car / Road', color: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400' },
};

export default function TransportPlanCard({ plan, currency }) {
  if (!plan) return null;
  const meta = MODE_META[plan.mode] || MODE_META.car;
  const Icon = meta.icon;

  return (
    <Card className="mb-6">
      <CardHeader
        icon={Icon}
        title={`Transport — ${meta.label}`}
        subtitle="Mode-matched travel plan with estimated costs"
        action={<Badge tone={plan.isLive ? 'green' : 'amber'}>{plan.isLive ? '● Live options' : 'Estimate'}</Badge>}
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-900/40">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Estimated fare</p>
          <p className="mt-1 text-xl font-extrabold text-slate-900 dark:text-white">
            {plan.estimatedFare != null ? formatCurrency(plan.estimatedFare, currency) : '—'}
          </p>
          <p className="text-[11px] text-slate-400">per direction from transport budget</p>
        </div>
        {plan.duration != null && (
          <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-900/40">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Travel duration</p>
            <p className="mt-1 inline-flex items-center gap-1 text-xl font-extrabold text-slate-900 dark:text-white">
              <Clock className="h-4 w-4 text-slate-400" /> {plan.duration}
            </p>
          </div>
        )}
        {plan.fuelCost != null && (
          <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-900/40">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Fuel cost</p>
            <p className="mt-1 inline-flex items-center gap-1 text-xl font-extrabold text-slate-900 dark:text-white">
              <Fuel className="h-4 w-4 text-slate-400" /> {formatCurrency(plan.fuelCost, currency)}
            </p>
          </div>
        )}
        {plan.tollCost != null && (
          <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-900/40">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Toll cost</p>
            <p className="mt-1 inline-flex items-center gap-1 text-xl font-extrabold text-slate-900 dark:text-white">
              <BadgeIndianRupee className="h-4 w-4 text-slate-400" /> {formatCurrency(plan.tollCost, currency)}
            </p>
          </div>
        )}
        {plan.drivingHours != null && (
          <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-900/40">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Driving time</p>
            <p className="mt-1 inline-flex items-center gap-1 text-xl font-extrabold text-slate-900 dark:text-white">
              <Navigation className="h-4 w-4 text-slate-400" /> {plan.drivingHours}h
            </p>
          </div>
        )}
      </div>

      {plan.suggestions?.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Options</p>
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
        <ExternalLink className="h-3.5 w-3.5" /> {plan.bookingAdvice || 'Book via your preferred provider'}
      </p>
    </Card>
  );
}
