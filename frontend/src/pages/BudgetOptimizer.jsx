import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Wallet, TrendingDown, PiggyBank, AlertTriangle, Wand2, CheckCircle2, RefreshCw,
  Receipt, Target, Compass, CalendarRange, Download,
} from 'lucide-react';
import PageHeader from '../components/ui/PageHeader';
import TripSelect from '../components/TripSelect';
import StatCard from '../components/ui/StatCard';
import { tripApi, expensesApi } from '../services/apiClient';
import { errorMessage } from '../services/api';
import { PageLoader } from '../components/ui/Spinner';
import EmptyState from '../components/ui/EmptyState';
import toast from 'react-hot-toast';
import { formatCurrency, daysBetween } from '../utils/format';
import useTripId from '../hooks/useTripId';
import { useI18n } from '../utils/i18n';

const CATEGORY_LABELS = {
  transport: 'Transportation', flights: 'Flights', train: 'Train', bus: 'Bus',
  hotels: 'Hotels', food: 'Food', localTransport: 'Local transport', activities: 'Activities',
  tickets: 'Tickets', shopping: 'Shopping', misc: 'Miscellaneous', emergencyReserve: 'Emergency reserve',
};

function catLabel(t, key) {
  return t(CATEGORY_LABELS[key] || key);
}

// Map recorded expense categories back to the allocation buckets so we can
// compare what was planned for a category against what was actually spent.
const EXPENSE_TO_ALLOC = {
  food: 'food',
  hotel: 'hotels',
  transport: 'transport',
  tickets: 'activities',
  activities: 'activities',
  shopping: 'misc',
  other: 'misc',
};

function buildSpentByAlloc(summary) {
  const spentByAlloc = {};
  Object.entries(summary?.byCategory || {}).forEach(([cat, amt]) => {
    const bucket = EXPENSE_TO_ALLOC[cat] || 'misc';
    spentByAlloc[bucket] = (spentByAlloc[bucket] || 0) + amt;
  });
  return spentByAlloc;
}

function AllocationBar({ label, amount, spent, total, color, isEstimate }) {
  const { t } = useI18n();
  const pct = total > 0 ? Math.round((amount / total) * 100) : 0;
  const spentPct = total > 0 && spent > 0 ? Math.round((Math.min(spent, amount) / total) * 100) : 0;
  const overSpent = spent > amount;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-semibold text-slate-600 dark:text-slate-300">
          {label} {isEstimate && <span className="text-amber-500">({t('est.')})</span>}
        </span>
        <span className="font-bold text-slate-800 dark:text-slate-100">
          {formatCurrency(amount)} <span className="text-slate-400">· {pct}%</span>
          {spent > 0 && (
            <span className={`ml-2 ${overSpent ? 'text-rose-500' : 'text-emerald-500'}`}>
              {formatCurrency(spent)} {t('spent')}
            </span>
          )}
        </span>
      </div>
      <div className="relative h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6 }}
          className={`h-full rounded-full bg-gradient-to-r ${color} opacity-40`}
        />
        {spentPct > 0 && (
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${spentPct}%` }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className={`absolute top-0 h-full rounded-full bg-gradient-to-r ${color}`}
            title={`${formatCurrency(spent)} spent`}
          />
        )}
      </div>
    </div>
  );
}

function OptimizationPanel({ result, currency, optimizing, onRun }) {
  const { t } = useI18n();
  if (!result) {
    return (
      <div className="card flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <PiggyBank className="h-12 w-12 text-slate-300 dark:text-slate-600" />
        <p className="max-w-xs text-sm text-slate-500 dark:text-slate-400">
          {t('Run the optimizer to see the original vs optimized cost, money saved and remaining budget.')}
        </p>
        <button onClick={onRun} disabled={optimizing} className="btn-primary mt-2">
          {optimizing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
          {optimizing ? t('Optimizing…') : t('Run Budget Agent optimization')}
        </button>
      </div>
    );
  }

  const { original, optimized, saved, remaining, withinBudget, dropped = [], reductions = [] } = result;
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      <div className="card p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-500 dark:bg-emerald-950">
            <PiggyBank className="h-6 w-6" />
          </div>
          <div>
            <p className="text-sm font-bold text-slate-900 dark:text-white">{t('Optimization complete')}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t('Original')} {formatCurrency(original, currency)} → {t('Optimized')} {formatCurrency(optimized, currency)}
            </p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-3 text-center">
          <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
            <p className="text-[11px] font-semibold uppercase text-slate-400">{t('Money saved')}</p>
            <p className="text-lg font-extrabold text-emerald-500">{formatCurrency(saved, currency)}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
            <p className="text-[11px] font-semibold uppercase text-slate-400">{t('Remaining')}</p>
            <p className="text-lg font-extrabold text-slate-900 dark:text-white">{formatCurrency(remaining, currency)}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
            <p className="text-[11px] font-semibold uppercase text-slate-400">{t('Status')}</p>
            <p className={`text-lg font-extrabold ${withinBudget ? 'text-emerald-500' : 'text-rose-500'}`}>
              {withinBudget ? t('In budget') : t('Over')}
            </p>
          </div>
        </div>
        {result.notes && <p className="mt-3 text-xs text-slate-400">{result.notes}</p>}
      </div>

      {dropped.length > 0 && (
        <div className="card p-5">
          <p className="mb-2 flex items-center gap-2 text-sm font-extrabold text-slate-900 dark:text-white">
            <TrendingDown className="h-4 w-4 text-rose-500" /> {t('Removed to fit budget')}
          </p>
          <ul className="space-y-1 text-sm text-slate-600 dark:text-slate-300">
            {dropped.map((d, i) => (
              <li key={i} className="flex justify-between rounded-lg bg-rose-50 px-3 py-1.5 dark:bg-rose-950/40">
                <span>{catLabel(t, d.category)} {t('item')}</span>
                <span className="font-bold">−{formatCurrency(d.amount, currency)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {reductions.length > 0 && (
        <div className="card p-5">
          <p className="mb-2 flex items-center gap-2 text-sm font-extrabold text-slate-900 dark:text-white">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" /> {t('Reduced costs')}
          </p>
          <ul className="space-y-1.5 text-sm text-slate-600 dark:text-slate-300">
            {reductions.slice(0, 6).map((r, i) => (
              <li key={i} className="rounded-lg bg-emerald-50 px-3 py-1.5 dark:bg-emerald-950/40">
                <span className="font-semibold">{catLabel(t, r.category)}:</span>{' '}
                {formatCurrency(r.from, currency)} → {formatCurrency(r.to, currency)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!withinBudget && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm dark:border-amber-900 dark:bg-amber-950/40">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
          <p className="text-amber-800 dark:text-amber-300">
            {t('Even after optimization this trip exceeds the budget. Try cheaper dates, a nearer destination, or ask the chatbot to “make my trip cheaper”.')}
          </p>
        </div>
      )}

      <button onClick={onRun} disabled={optimizing} className="btn-primary w-full">
        {optimizing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
        {optimizing ? t('Optimizing…') : t('Re-run Budget Agent optimization')}
      </button>
    </motion.div>
  );
}

function SpendingVsPlan({ allocation, summary, currency, tripId }) {
  const { t } = useI18n();
  const spentByAlloc = buildSpentByAlloc(summary);

  const rows = allocation
    .filter((a) => a.key !== 'emergencyReserve')
    .map((a) => ({
      key: a.key,
      label: catLabel(t, a.key),
      allocated: a.amount,
      spent: spentByAlloc[a.key] || 0,
    }));

  const hasSpending = Object.keys(summary?.byCategory || {}).length > 0;
  if (!hasSpending) {
    return (
      <div className="card p-5">
        <h3 className="mb-1 text-sm font-extrabold text-slate-900 dark:text-white">{t('Spending vs plan')}</h3>
        <p className="text-xs text-slate-400">{t('Planned allocation per category.')}</p>
        <EmptyState
          icon={Receipt}
          title={t('No expenses recorded yet')}
          message={t('Add expenses on the Expense Tracker to compare actual spending against this plan.')}
        >
          <Link to={`/expenses?trip=${tripId || ''}`} className="btn-secondary mt-3">
            <Receipt className="h-4 w-4" /> {t('Track expenses')}
          </Link>
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-extrabold text-slate-900 dark:text-white">{t('Spending vs plan')}</h3>          <Link to={`/expenses?trip=${tripId || ''}`} className="text-xs font-bold text-brand-600 hover:underline dark:text-brand-400">
            {t('Open Expense Tracker')} →
          </Link>
      </div>
      <div className="space-y-2.5">
        {rows.map((r) => {
          const delta = r.allocated - r.spent;
          const over = delta < 0;
          const caution = !over && r.spent > r.allocated * 0.9;
          return (
            <div key={r.key} className="flex items-center justify-between rounded-xl bg-slate-50 px-3.5 py-2.5 dark:bg-slate-800/60">
              <div>
                <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{r.label}</p>
                <p className="text-[11px] text-slate-400">
                  {formatCurrency(r.spent, currency)} {t('of')} {formatCurrency(r.allocated, currency)} {t('allocated')}
                </p>
              </div>
              {over ? (
                <span className="badge bg-rose-50 text-rose-600 dark:bg-rose-950 dark:text-rose-400">
                  {formatCurrency(-delta, currency)} {t('over')}
                </span>
              ) : delta === 0 ? (
                <span className="badge bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">{t('On plan')}</span>
              ) : caution ? (
                <span className="badge bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-400">
                  {formatCurrency(delta, currency)} {t('left')}
                </span>
              ) : (
                <span className="badge bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400">
                  {formatCurrency(delta, currency)} {t('left')}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CostByDay({ days, currency }) {
  const { t } = useI18n();
  const max = Math.max(1, ...days.map((d) => d.dayCost || 0));
  return (
    <div className="card p-5">
      <h3 className="mb-1 text-sm font-extrabold text-slate-900 dark:text-white">{t('Cost by day')}</h3>
      <p className="mb-4 text-xs text-slate-400">{t('Estimated cost of each day of the itinerary.')}</p>
      <div className="space-y-2.5">
        {days.map((d) => {
          const pct = max > 0 ? Math.round(((d.dayCost || 0) / max) * 100) : 0;
          return (
            <div key={d.dayNumber} className="flex items-center gap-3 text-xs">
              <span className="w-16 shrink-0 font-semibold text-slate-500 dark:text-slate-400">{t('Day')} {d.dayNumber}</span>
              <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.5 }}
                  className="h-full rounded-full bg-gradient-to-r from-sky-400 to-brand-600"
                />
              </div>
              <span className="w-24 shrink-0 text-right font-bold text-slate-800 dark:text-slate-100">
                {formatCurrency(d.dayCost || 0, currency)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function BudgetOptimizer() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const tripId = useTripId();
  const [optimizing, setOptimizing] = useState(false);
  const [optimizeResult, setOptimizeResult] = useState(null);
  const tripIdRef = useRef(tripId);
  tripIdRef.current = tripId;

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['itinerary', tripId],
    queryFn: () => tripApi.itinerary(tripId).then((r) => r.data.data),
    enabled: Boolean(tripId),
  });

  const { data: summary } = useQuery({
    queryKey: ['expense-summary', tripId],
    queryFn: () => expensesApi.summary({ tripId: tripId || undefined }).then((r) => r.data.data),
    enabled: Boolean(tripId),
  });

  const allocation = useMemo(() => {
    if (!data) return null;
    const { trip, itinerary } = data;
    // Authoritative allocation persisted by the backend, when available.
    if (itinerary?.budgetAllocation) {
      const entries = Object.entries(itinerary.budgetAllocation)
        .filter(([, v]) => v?.pct != null && v?.amount != null)
        .map(([key, v]) => ({ key, pct: v.pct, amount: v.amount }));
      if (entries.length) return entries;
    }
    // Fallback: deterministic re-allocation from the same percentages used by the backend
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

  // Reset in-memory results whenever the selected trip changes.
  useEffect(() => {
    setOptimizeResult(null);
    setOptimizing(false);
  }, [tripId]);

  const runOptimize = async () => {
    setOptimizing(true);
    const currentTrip = tripId;
    try {
      const { data } = await tripApi.optimizeBudget(currentTrip);
      // Trip may have switched while the request was in flight.
      if (tripIdRef.current !== currentTrip) return;
      setOptimizeResult(data.data.result);
      toast.success(data.data.result.saved > 0 ? `${t('Saved')} ${formatCurrency(data.data.result.saved, data.data.result.currency)}!` : t('Budget verified within limits'));
      refetch();
    } catch (e) {
      if (tripIdRef.current !== currentTrip) return;
      toast.error(errorMessage(e, 'Optimization failed'));
    } finally {
      if (tripIdRef.current === currentTrip) setOptimizing(false);
    }
  };

  if (isLoading) return <PageLoader />;

  if (!tripId || !data) {
    return (
      <div>
        <PageHeader icon={Wallet} title={t('Budget Optimizer')} subtitle={t('Allocate, verify and optimize your trip budget.')} />
        <EmptyState
          icon={Wallet}
          title={isError ? t('Could not load this trip') : t('Select a trip to optimize')}
          message={
            isError
              ? t('The selected trip could not be loaded. Pick another trip from the list below.')
              : t('Your trip budget gets allocated across transport, hotels, food, activities and an emergency reserve.')
          }
        >
          <div className="mt-4 flex flex-col items-center gap-3">
            <TripSelect value={tripId || ''} onChange={(id) => id && navigate(`/budget?trip=${id}`)} />
            <Link to="/planner" className="btn-secondary">
              <Compass className="h-4 w-4" /> {t('Plan a new trip')}
            </Link>
          </div>
        </EmptyState>
      </div>
    );
  }

  const { trip, itinerary } = data;
  const currency = trip.budget.currency || 'INR';
  const originalEstimate = trip.totalEstimatedCost;
  const optimizedCost = trip.totalOptimizedCost ?? originalEstimate;
  const hasOptimized = optimizedCost < originalEstimate;
  const estimated = hasOptimized ? optimizedCost : originalEstimate;
  const remaining = trip.budget.total - estimated;
  const over = remaining < 0;
  const savedSoFar = hasOptimized ? originalEstimate - optimizedCost : 0;
  const actualSpent = summary?.actualSpending || 0;
  const remainingPct = trip.budget.total > 0 ? Math.round((Math.max(0, remaining) / trip.budget.total) * 100) : 0;
  const spentByAlloc = buildSpentByAlloc(summary);

  return (
    <div>
      <PageHeader
        icon={Wallet}
        title="Budget Optimizer"
        subtitle={`${trip.title} · ${trip.destination} · ${daysBetween(trip.startDate, trip.endDate)} days`}
        actions={
          <>
            <a href={tripApi.budgetPdfUrl(trip._id)} target="_blank" rel="noreferrer" className="btn-secondary">
              <Download className="h-4 w-4" /> {t('Download budget PDF')}
            </a>
            <TripSelect value={trip._id} onChange={(id) => id && navigate(`/budget?trip=${id}`)} />
          </>
        }
      />

      {/* Overview */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard icon={Wallet} label={t('Total budget')} value={formatCurrency(trip.budget.total, currency)} tone="blue" sub={`${trip.preferences?.travelStyle || 'standard'} ${t('style')}`} />
        <StatCard icon={Target} label={t('Original estimate')} value={formatCurrency(originalEstimate, currency)} tone="violet" sub={t('Before optimization')} />
        <StatCard icon={PiggyBank} label={t('Optimized cost')} value={formatCurrency(optimizedCost, currency)} tone="green" sub={savedSoFar > 0 ? `${t('Saved')} ${formatCurrency(savedSoFar, currency)}` : t('Already minimal')} />
        <StatCard icon={TrendingDown} label={over ? t('Over budget') : t('Remaining')} value={over ? formatCurrency(-remaining, currency) : formatCurrency(remaining, currency)} tone={over ? 'rose' : 'amber'} sub={over ? `${t('Over by')} ${formatCurrency(-remaining, currency)}` : `${remainingPct}% ${t('of budget left')}`} />
        <StatCard icon={Receipt} label={t('Actual spent')} value={formatCurrency(actualSpent, currency)} tone={actualSpent > trip.budget.total ? 'rose' : 'blue'} sub={actualSpent > 0 ? `${t('of')} ${formatCurrency(trip.budget.total, currency)} ${t('planned')}` : t('No expenses yet')} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* Allocation */}
        <div className="card p-6">
          <h3 className="mb-4 text-base font-extrabold text-slate-900 dark:text-white">{t('Smart allocation')}</h3>
          <div className="space-y-3.5">
            {allocation.map((a) => (
              <AllocationBar
                key={a.key}
                label={catLabel(t, a.key)}
                amount={a.amount}
                spent={spentByAlloc[a.key] || 0}
                total={trip.budget.total}
                isEstimate
                color={a.key === 'emergencyReserve' ? 'from-rose-400 to-rose-600' : 'from-brand-400 to-brand-600'}
              />
            ))}
          </div>
          <div className={`mt-5 rounded-xl p-3.5 text-sm ${over ? 'bg-rose-50 dark:bg-rose-950/50' : 'bg-emerald-50 dark:bg-emerald-950/50'}`}>
            <div className="flex items-center justify-between font-bold">
              <span>{over ? t('Over budget') : t('Within budget')}</span>
              <span className={over ? 'text-rose-600' : 'text-emerald-600'}>
                {over ? `${formatCurrency(-remaining, currency)} ${t('over')}` : `${formatCurrency(remaining, currency)} ${t('left')}`}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {t('Total budget')} {formatCurrency(trip.budget.total, currency)} ·{' '}
              {hasOptimized ? (
                <>{t('Optimized')} {formatCurrency(estimated, currency)} ({t('original')} {formatCurrency(originalEstimate, currency)})</>
              ) : (
                <>{t('Estimated')} {formatCurrency(estimated, currency)} ({t('estimates flagged')})</>
              )}
            </p>
          </div>
          {itinerary?.days?.length > 0 && (
            <div className="mt-4">
              <CostByDay days={itinerary.days} currency={currency} />
            </div>
          )}
        </div>

        {/* Optimization results */}
        <div className="space-y-4">
          <OptimizationPanel
            result={optimizeResult || itinerary?.optimizedBudget || null}
            currency={currency}
            optimizing={optimizing}
            onRun={runOptimize}
          />
          <Link to={`/itinerary/${trip._id}`} className="btn-secondary w-full">
            <CalendarRange className="h-4 w-4" /> {t('View updated itinerary')}
          </Link>
        </div>
      </div>

      <div className="mt-6">
        <SpendingVsPlan allocation={allocation} summary={summary} currency={currency} tripId={trip._id} />
      </div>
    </div>
  );
}
