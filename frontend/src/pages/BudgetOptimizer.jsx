import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Wallet, TrendingDown, PiggyBank, AlertTriangle, Wand2, CheckCircle2, RefreshCw,
} from 'lucide-react';
import PageHeader from '../components/ui/PageHeader';
import TripSelect from '../components/TripSelect';
import { tripApi } from '../services/apiClient';
import { errorMessage } from '../services/api';
import { PageLoader } from '../components/ui/Spinner';
import EmptyState from '../components/ui/EmptyState';
import toast from 'react-hot-toast';
import { formatCurrency } from '../utils/format';

const CATEGORY_LABELS = {
  transport: 'Transportation', flights: 'Flights', train: 'Train', bus: 'Bus',
  hotels: 'Hotels', food: 'Food', localTransport: 'Local transport', activities: 'Activities',
  tickets: 'Tickets', shopping: 'Shopping', misc: 'Miscellaneous', emergencyReserve: 'Emergency reserve',
};

function AllocationBar({ label, amount, total, color, isEstimate }) {
  const pct = total > 0 ? Math.round((amount / total) * 100) : 0;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-semibold text-slate-600 dark:text-slate-300">{label} {isEstimate && <span className="text-amber-500">(est.)</span>}</span>
        <span className="font-bold text-slate-800 dark:text-slate-100">{formatCurrency(amount)} <span className="text-slate-400">· {pct}%</span></span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6 }}
          className={`h-full rounded-full bg-gradient-to-r ${color}`}
        />
      </div>
    </div>
  );
}

export default function BudgetOptimizer() {
  const navigate = useNavigate();
  const [tripId, setTripId] = useState(() => new URLSearchParams(window.location.search).get('trip') || '');
  const [optimizing, setOptimizing] = useState(false);
  const [optimizeResult, setOptimizeResult] = useState(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['itinerary', tripId],
    queryFn: () => tripApi.itinerary(tripId).then((r) => r.data.data),
    enabled: Boolean(tripId),
  });

  const allocation = useMemo(() => {
    if (!data) return null;
    const { trip } = data;
    // Deterministic re-allocation from the same percentages used by the backend
    const total = trip.budget.total;
    const split = { transport: 0.28, hotels: 0.3, food: 0.2, activities: 0.1, misc: 0.07, emergencyReserve: 0.05 };
    const styles = {
      luxury: { hotels: 0.38, food: 0.24, activities: 0.08, transport: 0.2, misc: 0.06, emergencyReserve: 0.04 },
      budget: { hotels: 0.2, food: 0.25, activities: 0.12, transport: 0.3, misc: 0.08, emergencyReserve: 0.05 },
      backpacker: { hotels: 0.16, food: 0.28, activities: 0.14, transport: 0.3, misc: 0.07, emergencyReserve: 0.05 },
      family: { hotels: 0.34, food: 0.22, activities: 0.1, transport: 0.22, misc: 0.07, emergencyReserve: 0.05 },
      business: { hotels: 0.36, food: 0.18, activities: 0.04, transport: 0.3, misc: 0.08, emergencyReserve: 0.04 },
      adventure: { hotels: 0.2, food: 0.2, activities: 0.22, transport: 0.26, misc: 0.07, emergencyReserve: 0.05 },
      romantic: { hotels: 0.34, food: 0.24, activities: 0.1, transport: 0.2, misc: 0.08, emergencyReserve: 0.04 },
    };
    const s = styles[trip.preferences?.travelStyle] || split;
    return Object.entries(s).map(([key, pct]) => ({ key, pct, amount: Math.round(total * pct * 100) / 100 }));
  }, [data]);

  const runOptimize = async () => {
    setOptimizing(true);
    try {
      const { data } = await tripApi.optimizeBudget(tripId);
      setOptimizeResult(data.data.result);
      toast.success(data.data.result.saved > 0 ? `Saved ${formatCurrency(data.data.result.saved, data.data.result.currency)}!` : 'Budget verified within limits');
      refetch();
    } catch (e) {
      toast.error(errorMessage(e, 'Optimization failed'));
    } finally {
      setOptimizing(false);
    }
  };

  if (isLoading) return <PageLoader />;

  if (!tripId || !data) {
    return (
      <div>
        <PageHeader icon={Wallet} title="Budget Optimizer" subtitle="Allocate, verify and optimize your trip budget." />
        <EmptyState
          icon={Wallet}
          title="Select a trip to optimize"
          message="Your trip budget gets allocated across transport, hotels, food, activities and an emergency reserve."
        >
          <div className="mt-4"><TripSelect value={tripId} onChange={(id) => id && navigate(`/budget?trip=${id}`)} /></div>
        </EmptyState>
      </div>
    );
  }

  const { trip, itinerary } = data;
  const currency = trip.budget.currency || 'INR';
  const estimated = trip.totalEstimatedCost;
  const remaining = trip.budget.total - estimated;
  const over = remaining < 0;

  return (
    <div>
      <PageHeader
        icon={Wallet}
        title="Budget Optimizer"
        subtitle={`${trip.title} · ${trip.destination}`}
        actions={
          <TripSelect value={trip._id} onChange={(id) => id && navigate(`/budget?trip=${id}`)} />
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Allocation */}
        <div className="card p-6">
          <h3 className="mb-4 text-base font-extrabold text-slate-900 dark:text-white">Smart allocation</h3>
          <div className="space-y-3.5">
            {allocation.map((a) => (
              <AllocationBar
                key={a.key}
                label={CATEGORY_LABELS[a.key] || a.key}
                amount={a.amount}
                total={trip.budget.total}
                isEstimate
                color={a.key === 'emergencyReserve' ? 'from-rose-400 to-rose-600' : 'from-brand-400 to-brand-600'}
              />
            ))}
          </div>
          <div className={`mt-5 rounded-xl p-3.5 text-sm ${over ? 'bg-rose-50 dark:bg-rose-950/50' : 'bg-emerald-50 dark:bg-emerald-950/50'}`}>
            <div className="flex items-center justify-between font-bold">
              <span>{over ? 'Over budget' : 'Within budget'}</span>
              <span className={over ? 'text-rose-600' : 'text-emerald-600'}>
                {over ? formatCurrency(-remaining, currency) + ' over' : formatCurrency(remaining, currency) + ' left'}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Total budget {formatCurrency(trip.budget.total, currency)} · Estimated {formatCurrency(estimated, currency)} (estimates flagged)
            </p>
          </div>
          <button onClick={runOptimize} disabled={optimizing} className="btn-primary mt-4 w-full">
            {optimizing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
            {optimizing ? 'Optimizing…' : 'Run Budget Agent optimization'}
          </button>
        </div>

        {/* Optimization results */}
        <div className="space-y-4">
          {optimizeResult ? (
            <>
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="card p-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-500 dark:bg-emerald-950">
                    <PiggyBank className="h-6 w-6" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-900 dark:text-white">Optimization complete</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">Original {formatCurrency(optimizeResult.original, currency)} → Optimized {formatCurrency(optimizeResult.optimized, currency)}</p>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-3 text-center">
                  <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
                    <p className="text-[11px] font-semibold uppercase text-slate-400">Money saved</p>
                    <p className="text-lg font-extrabold text-emerald-500">{formatCurrency(optimizeResult.saved, currency)}</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
                    <p className="text-[11px] font-semibold uppercase text-slate-400">Remaining</p>
                    <p className="text-lg font-extrabold text-slate-900 dark:text-white">{formatCurrency(optimizeResult.remaining, currency)}</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
                    <p className="text-[11px] font-semibold uppercase text-slate-400">Status</p>
                    <p className={`text-lg font-extrabold ${optimizeResult.withinBudget ? 'text-emerald-500' : 'text-rose-500'}`}>
                      {optimizeResult.withinBudget ? 'In budget' : 'Over'}
                    </p>
                  </div>
                </div>
              </motion.div>

              {optimizeResult.dropped?.length > 0 && (
                <div className="card p-5">
                  <p className="mb-2 flex items-center gap-2 text-sm font-extrabold text-slate-900 dark:text-white">
                    <TrendingDown className="h-4 w-4 text-rose-500" /> Removed to fit budget
                  </p>
                  <ul className="space-y-1 text-sm text-slate-600 dark:text-slate-300">
                    {optimizeResult.dropped.map((d, i) => (
                      <li key={i} className="flex justify-between rounded-lg bg-rose-50 px-3 py-1.5 dark:bg-rose-950/40">
                        <span>{d.category} item</span>
                        <span className="font-bold">−{formatCurrency(d.amount, currency)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {optimizeResult.reductions?.length > 0 && (
                <div className="card p-5">
                  <p className="mb-2 flex items-center gap-2 text-sm font-extrabold text-slate-900 dark:text-white">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" /> Reduced costs
                  </p>
                  <ul className="space-y-1.5 text-sm text-slate-600 dark:text-slate-300">
                    {optimizeResult.reductions.slice(0, 6).map((r, i) => (
                      <li key={i} className="rounded-lg bg-emerald-50 px-3 py-1.5 dark:bg-emerald-950/40">
                        <span className="font-semibold">{r.category}:</span> {formatCurrency(r.from, currency)} → {formatCurrency(r.to, currency)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {!optimizeResult.withinBudget && (
                <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm dark:border-amber-900 dark:bg-amber-950/40">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
                  <p className="text-amber-800 dark:text-amber-300">
                    Even after optimization this trip exceeds the budget. Try cheaper dates, a nearer destination,
                    or ask the chatbot to “make my trip cheaper”.
                  </p>
                </div>
              )}
            </>
          ) : (
            <div className="card flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
              <PiggyBank className="h-12 w-12 text-slate-300 dark:text-slate-600" />
              <p className="max-w-xs text-sm text-slate-500 dark:text-slate-400">
                Run the optimizer to see the original vs optimized cost, money saved and remaining budget.
              </p>
            </div>
          )}

          <LinkToItinerary tripId={trip._id} />
        </div>
      </div>
    </div>
  );
}

function LinkToItinerary({ tripId }) {
  return (
    <Link to={`/itinerary/${tripId}`} className="btn-secondary w-full">
      View updated itinerary
    </Link>
  );
}
