import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { BarChart3, PieChart as PieChartIcon, Plus, Trash2, Receipt, Sparkles } from 'lucide-react';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import PageHeader from '../components/ui/PageHeader';
import StatCard from '../components/ui/StatCard';
import TripSelect from '../components/TripSelect';
import Modal from '../components/ui/Modal';
import { Input, Select, Textarea } from '../components/ui/Input';
import Button from '../components/ui/Button';
import { expensesApi } from '../services/apiClient';
import { EXPENSE_CATEGORIES } from '../constants';
import { formatCurrency, formatDate } from '../utils/format';
import { PageLoader } from '../components/ui/Spinner';
import EmptyState from '../components/ui/EmptyState';
import toast from 'react-hot-toast';
import { errorMessage } from '../services/api';

const COLORS = ['#3b82f6', '#8b5cf6', '#f43f5e', '#f59e0b', '#10b981', '#06b6d4', '#64748b'];

export default function Expenses() {
  const [tripId, setTripId] = useState(() => new URLSearchParams(window.location.search).get('trip') || '');
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({ category: 'food', amount: '', description: '', date: new Date().toISOString().slice(0, 10), location: '' });
  const queryClient = useQueryClient();

  const { data: summaryData, isLoading: summaryLoading } = useQuery({
    queryKey: ['expense-summary', tripId],
    queryFn: () => expensesApi.summary({ tripId: tripId || undefined }).then((r) => r.data.data),
  });
  const { data: expensesData, isLoading: expensesLoading } = useQuery({
    queryKey: ['expenses', tripId],
    queryFn: () => expensesApi.list({ tripId: tripId || undefined }).then((r) => r.data.data),
  });

  const addMutation = useMutation({
    mutationFn: (payload) => expensesApi.add(payload),
    onSuccess: () => {
      toast.success('Expense added');
      setModalOpen(false);
      setForm({ category: 'food', amount: '', description: '', date: new Date().toISOString().slice(0, 10), location: '' });
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['expense-summary'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => expensesApi.remove(id),
    onSuccess: () => {
      toast.success('Expense deleted');
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['expense-summary'] });
    },
  });

  const expenses = expensesData?.expenses || [];
  const s = summaryData;
  const pieData = Object.entries(s?.byCategory || {}).map(([name, value]) => ({ name, value }));
  const barData = Object.entries(s?.byDay || {}).map(([date, spent]) => ({ date: formatDate(date), spent })).slice(-14);

  if (summaryLoading) return <PageLoader />;

  return (
    <div>
      <PageHeader
        icon={Receipt}
        title="Expense Tracker"
        subtitle="Planned budget vs actual spending, stored in MongoDB."
        actions={
          <>
            <TripSelect value={tripId} onChange={(id) => setTripId(id || '')} allowAll />
            <Button icon={Plus} onClick={() => setModalOpen(true)}>Add expense</Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard icon={BarChart3} label="Planned budget" value={formatCurrency(s?.plannedBudget || 0, s?.currency || 'INR')} tone="blue" />
        <StatCard icon={PieChartIcon} label="Actual spending" value={formatCurrency(s?.actualSpending || 0, s?.currency || 'INR')} tone="amber" />
        <StatCard icon={Receipt} label="Remaining" value={formatCurrency(s?.remainingBudget ?? 0, s?.currency || 'INR')} tone={s?.remainingBudget >= 0 ? 'green' : 'rose'} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="card p-5">
          <h3 className="mb-4 text-sm font-extrabold text-slate-900 dark:text-white">Category breakdown</h3>
          {pieData.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-400">No expenses recorded yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={(e) => e.name}>
                  {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v) => formatCurrency(Number(v), s?.currency || 'INR')} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="card p-5">
          <h3 className="mb-4 text-sm font-extrabold text-slate-900 dark:text-white">Daily spending</h3>
          {barData.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-400">No daily data yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={barData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v) => formatCurrency(Number(v), s?.currency || 'INR')} />
                <Bar dataKey="spent" fill="#257aeb" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="card mt-6 p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-extrabold text-slate-900 dark:text-white">Recent expenses ({expenses.length})</h3>
          <button onClick={() => expensesApi.analyze({ tripId: tripId || undefined }).then(({ data }) => toast(data.data.analysis.analysis || 'Analysis done', { icon: '🤖' }))} className="btn-secondary px-3 py-1.5 text-xs">
            <Sparkles className="h-3.5 w-3.5" /> AI analysis
          </button>
        </div>
        {expenses.length === 0 ? (
          <EmptyState icon={Receipt} title="No expenses yet" message="Add your first expense to see the breakdown." />
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {expenses.map((e) => (
              <div key={e._id} className="flex items-center gap-3 py-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                  {e.category[0]?.toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-slate-900 dark:text-white">{e.description}</p>
                  <p className="text-xs text-slate-400">{formatDate(e.date)} · {e.category}{e.location ? ` · ${e.location}` : ''}</p>
                </div>
                <p className="font-extrabold text-slate-900 dark:text-white">{formatCurrency(e.amount, e.currency)}</p>
                <button onClick={() => deleteMutation.mutate(e._id)} className="rounded-lg p-1.5 text-slate-300 hover:bg-rose-50 hover:text-rose-500 dark:text-slate-600 dark:hover:bg-rose-950">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Add expense">
        <div className="space-y-4">
          <Select label="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} options={EXPENSE_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))} />
          <Input label="Amount" type="number" min={0} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          <Input label="Description" placeholder="Dinner at restaurant" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <Input label="Date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          <Input label="Location (optional)" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
          <Button
            className="w-full"
            disabled={!form.amount || !form.description || !form.date}
            onClick={() => addMutation.mutate({ ...form, amount: Number(form.amount), trip: tripId || null })}
          >
            Save expense
          </Button>
        </div>
      </Modal>
    </div>
  );
}
