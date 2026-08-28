import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Plane, Wallet, Receipt, Bot, Compass, ArrowRight, CalendarDays, TrendingUp, AlertTriangle,
} from 'lucide-react';
import PageHeader from '../components/ui/PageHeader';
import StatCard from '../components/ui/StatCard';
import { tripApi, expensesApi } from '../services/apiClient';
import { useAuthStore } from '../store/authStore';
import { formatCurrency, formatDate, cn } from '../utils/format';
import { PageLoader } from '../components/ui/Spinner';
import EmptyState from '../components/ui/EmptyState';
import { useI18n } from '../utils/i18n';

export default function Dashboard() {
  const { t } = useI18n();
  const user = useAuthStore((s) => s.user);
  const { data: tripsData, isLoading } = useQuery({
    queryKey: ['trips'],
    queryFn: () => tripApi.list().then((r) => r.data.data),
  });
  const { data: expenseData } = useQuery({
    queryKey: ['expense-summary', 'all'],
    queryFn: () => expensesApi.summary({}).then((r) => r.data.data),
  });

  const trips = tripsData?.trips || [];
  const latest = trips[0];
  const totalBudget = trips.reduce((s, t) => s + t.budget.total, 0);
  const overBudgetCount = trips.filter((t) => t.isOverBudget).length;

  if (isLoading) return <PageLoader />;

  return (
    <div>
      <PageHeader
        title={`${t('Welcome back')}, ${user?.name?.split(' ')[0] || t('Traveler')} 👋`}
        subtitle={t("Here's what your AI travel system has been up to.")}
        actions={
          <Link to="/planner" className="btn-primary">
            <Compass className="h-4 w-4" /> {t('Plan a trip')}
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Plane} label={t('Trips planned')} value={trips.length} tone="blue" sub={`${trips.length ? formatCurrency(totalBudget, 'INR') : ''} ${t('total budget')}`} />
        <StatCard icon={Wallet} label={t('Planned budget')} value={formatCurrency(expenseData?.plannedBudget ?? totalBudget, expenseData?.currency || 'INR')} tone="green" />
        <StatCard icon={Receipt} label={t('Actual spending')} value={formatCurrency(expenseData?.actualSpending ?? 0, expenseData?.currency || 'INR')} tone="amber" sub={expenseData?.remainingBudget != null ? `${formatCurrency(expenseData.remainingBudget, expenseData.currency || 'INR')} ${t('remaining')}` : ''} />
        <StatCard icon={AlertTriangle} label={t('Over budget')} value={overBudgetCount} tone="rose" sub={t('Trips needing optimization')} />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-extrabold text-slate-900 dark:text-white">{t('Your trips')}</h2>
            <Link to="/saved-trips" className="text-sm font-bold text-brand-600 hover:underline dark:text-brand-400">
              {t('View all')}
            </Link>
          </div>
          {trips.length === 0 ? (
            <EmptyState
              icon={Plane}
              title={t('No trips yet')}
              message={t('Tell the AI agents where you want to go and how much you want to spend.')}
              action={
                <Link to="/planner" className="btn-primary mt-2">
                  <Compass className="h-4 w-4" /> {t('Start planning')}
                </Link>
              }
            />
          ) : (
            <div className="space-y-3">
              {trips.slice(0, 5).map((trip, i) => (
                <motion.div key={trip._id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                  <Link to={`/itinerary/${trip._id}`} className="card flex items-center gap-4 p-4 transition-all hover:-translate-y-0.5 hover:shadow-card">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-white">
                      <CalendarDays className="h-6 w-6" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-bold text-slate-900 dark:text-white">{trip.title}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {trip.destination} · {formatDate(trip.startDate)} – {formatDate(trip.endDate)}
                      </p>
                      <div className="mt-1.5 flex items-center gap-3 text-xs">
                        <span className={cn('font-bold', trip.isOverBudget ? 'text-rose-500' : 'text-emerald-500')}>
                          {formatCurrency(trip.totalEstimatedCost, trip.budget.currency)} {t('estimated')}
                        </span>
                        {trip.isOverBudget && <span className="badge bg-rose-50 text-rose-600 dark:bg-rose-950 dark:text-rose-400">{t('Over budget')}</span>}
                        {trip.moneySaved > 0 && (
                          <span className="badge bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400">
                            {t('Saved')} {formatCurrency(trip.moneySaved, trip.budget.currency)}
                          </span>
                        )}
                      </div>
                    </div>
                    <ArrowRight className="h-5 w-5 shrink-0 text-slate-300 dark:text-slate-600" />
                  </Link>
                </motion.div>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-extrabold text-slate-900 dark:text-white">{t('Quick actions')}</h2>
          </div>
          <div className="card space-y-1 p-3">
            {[
              { to: '/planner', icon: Compass, label: t('Plan a new trip'), desc: t('Multi-agent generation') },
              { to: latest ? `/itinerary/${latest._id}` : '/itinerary', icon: CalendarDays, label: t('View latest itinerary'), desc: latest ? latest.title : t('No trip yet') },
              { to: '/budget', icon: Wallet, label: t('Optimize budget'), desc: t('Cheaper alternatives') },
              { to: '/chat', icon: Bot, label: t('Ask the AI chatbot'), desc: t('Contextual assistance') },
              { to: '/agents', icon: TrendingUp, label: t('Agent pipeline'), desc: t('Agents explained') },
            ].map((a) => (
              <Link key={a.label} to={a.to} className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  <a.icon className="h-4.5 w-4.5" />
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{a.label}</p>
                  <p className="text-xs text-slate-400">{a.desc}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
