import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import {
  Shield, Users, Plane, Bot, AlertTriangle, LayoutDashboard, Activity,
} from 'lucide-react';
import PageHeader from '../components/ui/PageHeader';
import StatCard from '../components/ui/StatCard';
import { adminApi } from '../services/apiClient';
import { PageLoader } from '../components/ui/Spinner';
import Badge, { ProviderStatusBadge } from '../components/ui/Badge';
import toast from 'react-hot-toast';
import { timeAgo, formatCurrency } from '../utils/format';
import { useI18n } from '../utils/i18n';

const TABS = ['Overview', 'Users', 'Trips', 'AI Usage', 'Providers', 'Errors'];

export default function Admin() {
  const { t } = useI18n();
  const [tab, setTab] = useState('Overview');
  const queryClient = useQueryClient();

  const { data: stats, isLoading } = useQuery({ queryKey: ['admin-stats'], queryFn: () => adminApi.stats().then((r) => r.data.data) });
  const { data: usersData } = useQuery({ queryKey: ['admin-users'], queryFn: () => adminApi.users({ limit: 50 }).then((r) => r.data.data), enabled: tab === 'Users' });
  const { data: tripsData } = useQuery({ queryKey: ['admin-trips'], queryFn: () => adminApi.trips().then((r) => r.data.data), enabled: tab === 'Trips' });
  const { data: aiData } = useQuery({ queryKey: ['admin-ai'], queryFn: () => adminApi.aiUsage(30).then((r) => r.data.data), enabled: tab === 'AI Usage' });
  const { data: providersData } = useQuery({ queryKey: ['admin-providers'], queryFn: () => adminApi.providers().then((r) => r.data.data), enabled: tab === 'Providers' });
  const { data: errorsData } = useQuery({ queryKey: ['admin-errors'], queryFn: () => adminApi.errors(7).then((r) => r.data.data), enabled: tab === 'Errors' });
  const { data: analyticsData } = useQuery({ queryKey: ['admin-analytics'], queryFn: () => adminApi.analytics().then((r) => r.data.data), enabled: tab === 'Overview' });

  const updateUser = useMutation({
    mutationFn: ({ id, payload }) => adminApi.updateUser(id, payload),
    onSuccess: () => {
      toast.success(t('User updated'));
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    },
    onError: (e) => toast.error(e.response?.data?.message || e.message),
  });

  if (isLoading) return <PageLoader />;

  const chartData = (analyticsData?.signups || []).map((s) => ({ date: s._id, signups: s.count }));

  return (
    <div>
      <PageHeader icon={Shield} title={t('Admin Dashboard')} subtitle={t('Role-based admin console — protected by RBAC.')} />

      <div className="mb-6 flex gap-1 overflow-x-auto">
        {TABS.map((tabKey, i) => (
          <button
            key={tabKey}
            onClick={() => setTab(tabKey)}
            className={`whitespace-nowrap rounded-xl px-4 py-2 text-sm font-bold transition-all ${tab === tabKey ? 'bg-brand-600 text-white shadow-card' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'}`}
          >
            {t(tabKey)}
          </button>
        ))}
      </div>

      {tab === 'Overview' && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard icon={Users} label={t('Users')} value={stats.users} tone="blue" />
            <StatCard icon={Plane} label={t('Trips')} value={stats.trips} tone="green" />
            <StatCard icon={Bot} label={t('AI calls')} value={stats.aiCalls} tone="violet" />
            <StatCard icon={AlertTriangle} label={t('Total expenses')} value={formatCurrency(stats.totalExpenses)} tone="amber" />
          </div>
          <div className="card mt-6 p-5">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-extrabold text-slate-900 dark:text-white">
              <Activity className="h-4 w-4 text-brand-500" /> {t('New signups (last 60 days)')}
            </h3>
            {chartData.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-400">{t('No signup data yet.')}</p>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Bar dataKey="signups" fill="#257aeb" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60">
                <p className="text-xs font-bold uppercase text-slate-400">{t('Top destinations')}</p>
                {(analyticsData?.tripsByDestination || []).slice(0, 5).map((d) => (
                  <p key={d._id} className="mt-1 text-sm font-semibold text-slate-700 dark:text-slate-200">{d._id} · {d.count} {t('trips')}</p>
                ))}
              </div>
              <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60">
                <p className="text-xs font-bold uppercase text-slate-400">{t('Trips by status')}</p>
                {(analyticsData?.tripsByStatus || []).map((s) => (
                  <p key={s._id} className="mt-1 text-sm font-semibold text-slate-700 dark:text-slate-200">{s._id} · {s.count}</p>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {tab === 'Users' && (
        <div className="card overflow-x-auto p-5">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-xs uppercase text-slate-400 dark:border-slate-800">
                <th className="py-2 pr-4">{t('Name')}</th>
                <th className="py-2 pr-4">{t('Email')}</th>
                <th className="py-2 pr-4">{t('Role')}</th>
                <th className="py-2 pr-4">{t('Verified')}</th>
                <th className="py-2 pr-4">{t('Joined')}</th>
                <th className="py-2">{t('Actions')}</th>
              </tr>
            </thead>
            <tbody>
              {(usersData?.users || []).map((u) => (
                <tr key={u._id} className="border-b border-slate-50 dark:border-slate-800/60">
                  <td className="py-2.5 pr-4 font-bold text-slate-900 dark:text-white">{u.name}</td>
                  <td className="py-2.5 pr-4 text-slate-500">{u.email}</td>
                  <td className="py-2.5 pr-4">
                    <select
                      value={u.role}
                      onChange={(e) => updateUser.mutate({ id: u._id, payload: { role: e.target.value } })}
                      className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-bold dark:border-slate-700 dark:bg-slate-900"
                    >
                      <option value="user">user</option>
                      <option value="admin">admin</option>
                    </select>
                  </td>
                  <td className="py-2.5 pr-4">{u.emailVerified ? <Badge tone="green">yes</Badge> : <Badge tone="rose">no</Badge>}</td>
                  <td className="py-2.5 pr-4 text-slate-500">{timeAgo(u.createdAt)}</td>
                  <td className="py-2.5">
                    <button
                      onClick={() => updateUser.mutate({ id: u._id, payload: { emailVerified: !u.emailVerified } })}
                      className="btn-secondary px-2.5 py-1 text-xs"
                    >
                      {t('Toggle verify')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'Trips' && (
        <div className="card overflow-x-auto p-5">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-xs uppercase text-slate-400 dark:border-slate-800">
                <th className="py-2 pr-4">{t('Title')}</th>
                <th className="py-2 pr-4">{t('User')}</th>
                <th className="py-2 pr-4">{t('Destination')}</th>
                <th className="py-2 pr-4">{t('Budget')}</th>
                <th className="py-2 pr-4">{t('Estimated')}</th>
                <th className="py-2">{t('Status')}</th>
              </tr>
            </thead>
            <tbody>
              {(tripsData?.trips || []).map((trip) => (
                <tr key={trip._id} className="border-b border-slate-50 dark:border-slate-800/60">
                  <td className="py-2.5 pr-4 font-bold text-slate-900 dark:text-white">{trip.title}</td>
                  <td className="py-2.5 pr-4 text-slate-500">{trip.user?.email || '—'}</td>
                  <td className="py-2.5 pr-4">{trip.destination}</td>
                  <td className="py-2.5 pr-4">{formatCurrency(trip.budget.total, trip.budget.currency)}</td>
                  <td className="py-2.5 pr-4">{formatCurrency(trip.totalEstimatedCost, trip.budget.currency)}</td>
                  <td className="py-2.5"><Badge tone={trip.isOverBudget ? 'rose' : 'green'}>{trip.isOverBudget ? t('over budget') : trip.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'AI Usage' && aiData && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="card p-5">
            <p className="text-3xl font-extrabold text-slate-900 dark:text-white">{aiData.summary.total}</p>
            <p className="text-xs font-semibold uppercase text-slate-400">{t('AI calls in last 30 days')}</p>
            <div className="mt-4 space-y-1.5">
              {aiData.summary.byAgent.map((a) => (
                <div key={a._id} className="flex justify-between rounded-lg bg-slate-50 px-3 py-1.5 text-sm dark:bg-slate-800/60">
                  <span className="font-semibold capitalize">{a._id || 'unknown'}</span>
                  <span className="font-bold">{a.count}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="card p-5">
            <p className="mb-2 text-xs font-bold uppercase text-slate-400">{t('Status breakdown')}</p>
            {aiData.summary.byStatus.map((s) => (
              <div key={s._id} className="mb-2 flex items-center justify-between rounded-lg px-3 py-2">
                <Badge tone={s._id === 'success' ? 'green' : s._id === 'error' ? 'rose' : 'amber'}>{s._id}</Badge>
                <span className="font-bold">{s.count}</span>
              </div>
            ))}
            <p className="mt-3 text-xs text-slate-400">{t('Daily latency avg available in logs.')}</p>
          </div>
        </div>
      )}

      {tab === 'Providers' && (
        <div className="card p-5">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-xs uppercase text-slate-400 dark:border-slate-800">
                <th className="py-2 pr-4">{t('Provider')}</th>
                <th className="py-2 pr-4">{t('Kind')}</th>
                <th className="py-2">{t('Status')}</th>
              </tr>
            </thead>
            <tbody>
              {(providersData?.providers || []).map((p) => (
                <tr key={p.name} className="border-b border-slate-50 dark:border-slate-800/60">
                  <td className="py-2.5 pr-4 font-bold text-slate-900 dark:text-white">{p.name}</td>
                  <td className="py-2.5 pr-4"><Badge tone="slate">{p.kind}</Badge></td>
                  <td className="py-2.5">
                    <ProviderStatusBadge configured={p.configured} />
                    {p.message && <span className="ml-2 text-xs text-slate-400">{p.message}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'Errors' && (
        <div className="card p-5">
          {(errorsData?.errors || []).length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-400">{t('No provider errors in the last 7 days')} 🎉</p>
          ) : (
            <div className="space-y-2">
              {errorsData.errors.map((e, i) => (
                <div key={i} className="flex items-start gap-3 rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800/60">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                  <div>
                    <p className="font-bold capitalize text-slate-800 dark:text-slate-100">
                      {e.agent || e.action || 'unknown'} <Badge tone={e.status === 'error' ? 'rose' : 'amber'}>{e.status}</Badge>
                    </p>
                    <p className="text-xs text-slate-500">{e.error}</p>
                    <p className="text-xs text-slate-400">{timeAgo(e.createdAt)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
