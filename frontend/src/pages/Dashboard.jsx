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

export default function Dashboard() {
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
        title={`Welcome back, ${user?.name?.split(' ')[0] || 'Traveler'} 👋`}
        subtitle="Here's what your AI travel system has been up to."
        actions={
          <Link to="/planner" className="btn-primary">
            <Compass className="h-4 w-4" /> Plan a trip
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Plane} label="Trips planned" value={trips.length} tone="blue" sub={`${trips.length ? formatCurrency(totalBudget, 'INR') : ''} total budget`} />
        <StatCard icon={Wallet} label="Planned budget" value={formatCurrency(expenseData?.plannedBudget ?? totalBudget, expenseData?.currency || 'INR')} tone="green" />
        <StatCard icon={Receipt} label="Actual spending" value={formatCurrency(expenseData?.actualSpending ?? 0, expenseData?.currency || 'INR')} tone="amber" sub={expenseData?.remainingBudget != null ? `${formatCurrency(expenseData.remainingBudget, expenseData.currency || 'INR')} remaining` : ''} />
        <StatCard icon={AlertTriangle} label="Over budget" value={overBudgetCount} tone="rose" sub="Trips needing optimization" />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-extrabold text-slate-900 dark:text-white">Your trips</h2>
            <Link to="/saved-trips" className="text-sm font-bold text-brand-600 hover:underline dark:text-brand-400">
              View all
            </Link>
          </div>
          {trips.length === 0 ? (
            <EmptyState
              icon={Plane}
              title="No trips yet"
              message="Tell the AI agents where you want to go and how much you want to spend."
              action={
                <Link to="/planner" className="btn-primary mt-2">
                  <Compass className="h-4 w-4" /> Start planning
                </Link>
              }
            />
          ) : (
            <div className="space-y-3">
              {trips.slice(0, 5).map((t, i) => (
                <motion.div key={t._id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                  <Link to={`/itinerary/${t._id}`} className="card flex items-center gap-4 p-4 transition-all hover:-translate-y-0.5 hover:shadow-card">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-white">
                      <CalendarDays className="h-6 w-6" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-bold text-slate-900 dark:text-white">{t.title}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {t.destination} · {formatDate(t.startDate)} – {formatDate(t.endDate)}
                      </p>
                      <div className="mt-1.5 flex items-center gap-3 text-xs">
                        <span className={cn('font-bold', t.isOverBudget ? 'text-rose-500' : 'text-emerald-500')}>
                          {formatCurrency(t.totalEstimatedCost, t.budget.currency)} estimated
                        </span>
                        {t.isOverBudget && <span className="badge bg-rose-50 text-rose-600 dark:bg-rose-950 dark:text-rose-400">Over budget</span>}
                        {t.moneySaved > 0 && (
                          <span className="badge bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400">
                            Saved {formatCurrency(t.moneySaved, t.budget.currency)}
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
            <h2 className="text-base font-extrabold text-slate-900 dark:text-white">Quick actions</h2>
          </div>
          <div className="card space-y-1 p-3">
            {[
              { to: '/planner', icon: Compass, label: 'Plan a new trip', desc: 'Multi-agent generation' },
              { to: latest ? `/itinerary/${latest._id}` : '/itinerary', icon: CalendarDays, label: 'View latest itinerary', desc: latest ? latest.title : 'No trip yet' },
              { to: '/budget', icon: Wallet, label: 'Optimize budget', desc: 'Cheaper alternatives' },
              { to: '/chat', icon: Bot, label: 'Ask the AI chatbot', desc: 'Contextual assistance' },
              { to: '/agents', icon: TrendingUp, label: 'Agent pipeline', desc: '17 agents explained' },
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
