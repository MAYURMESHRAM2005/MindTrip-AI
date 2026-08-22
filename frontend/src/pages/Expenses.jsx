import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  BarChart3, PieChart as PieChartIcon, Plus, Trash2, Receipt, Sparkles,
  Edit3, CreditCard, MapPin, Tag, Filter, AlertTriangle, Clock,
} from 'lucide-react';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import PageHeader from '../components/ui/PageHeader';
import StatCard from '../components/ui/StatCard';
import TripSelect from '../components/TripSelect';
import Modal from '../components/ui/Modal';
import { Input, Select } from '../components/ui/Input';
import Button from '../components/ui/Button';
import { expensesApi } from '../services/apiClient';
import { EXPENSE_CATEGORIES, CURRENCIES } from '../constants';
import { formatCurrency, formatDate } from '../utils/format';
import { PageLoader } from '../components/ui/Spinner';
import EmptyState from '../components/ui/EmptyState';
import toast from 'react-hot-toast';
import { errorMessage } from '../services/api';
import { useI18n } from '../utils/i18n';

const COLORS = ['#3b82f6', '#8b5cf6', '#f43f5e', '#f59e0b', '#10b981', '#06b6d4', '#64748b'];

const CATEGORY_ICONS = {
  food: '🍽️',
  hotel: '🏨',
  transport: '🚗',
  shopping: '🛍️',
  tickets: '🎫',
  activities: '🎯',
  other: '📦',
};

const PAYMENT_METHODS = [
  { value: '', label: 'Select…' },
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'upi', label: 'UPI' },
  { value: 'netbanking', label: 'Net Banking' },
  { value: 'wallet', label: 'Wallet' },
  { value: 'other', label: 'Other' },
];

const EMPTY_FORM = {
  category: 'food',
  amount: '',
  description: '',
  date: new Date().toISOString().slice(0, 10),
  location: '',
  currency: 'INR',
  paymentMethod: '',
  isEstimate: false,
};

export default function Expenses() {
  const { t } = useI18n();
  const [tripId, setTripId] = useState(() => new URLSearchParams(window.location.search).get('trip') || '');
  const [modalOpen, setModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [editForm, setEditForm] = useState({ ...EMPTY_FORM });
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [confirmDelete, setConfirmDelete] = useState(null);
  const queryClient = useQueryClient();

  // ── Queries ──
  const { data: summaryData, isLoading: summaryLoading, isError: summaryError } = useQuery({
    queryKey: ['expense-summary', tripId],
    queryFn: () => expensesApi.summary({ tripId: tripId || undefined }).then((r) => r.data.data),
  });

  const { data: expensesData, isLoading: expensesLoading, isError: expensesError } = useQuery({
    queryKey: ['expenses', tripId],
    queryFn: () => expensesApi.list({ tripId: tripId || undefined }).then((r) => r.data.data),
  });

  // ── Mutations ──
  const addMutation = useMutation({
    mutationFn: (payload) => expensesApi.add(payload),
    onSuccess: () => {
      toast.success(t('Expense added'));
      setModalOpen(false);
      setForm({ ...EMPTY_FORM, date: new Date().toISOString().slice(0, 10) });
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['expense-summary'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }) => expensesApi.update(id, payload),
    onSuccess: () => {
      toast.success(t('Expense updated'));
      setEditModalOpen(false);
      setEditingExpense(null);
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['expense-summary'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => expensesApi.remove(id),
    onSuccess: () => {
      toast.success(t('Expense deleted'));
      setConfirmDelete(null);
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['expense-summary'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  // ── Derived data ──
  const allExpenses = expensesData?.expenses || [];
  const expenses = categoryFilter === 'all' ? allExpenses : allExpenses.filter((e) => e.category === categoryFilter);
  const s = summaryData;
  const pieData = Object.entries(s?.byCategory || {}).map(([name, value]) => ({ name, value }));
  const barData = Object.entries(s?.byDay || {}).map(([date, spent]) => ({ date: formatDate(date), spent })).slice(-14);

  // Category counts for filter badges
  const categoryCounts = {};
  allExpenses.forEach((e) => {
    categoryCounts[e.category] = (categoryCounts[e.category] || 0) + 1;
  });

  const remaining = (s?.plannedBudget || 0) - (s?.actualSpending || 0);

  // ── Handlers ──
  const openEditModal = (expense) => {
    setEditingExpense(expense);
    setEditForm({
      category: expense.category,
      amount: expense.amount,
      description: expense.description,
      date: new Date(expense.date).toISOString().slice(0, 10),
      location: expense.location || '',
      currency: expense.currency || 'INR',
      paymentMethod: expense.paymentMethod || '',
      isEstimate: expense.isEstimate || false,
    });
    setEditModalOpen(true);
  };

  if (summaryLoading) return <PageLoader />;

  return (
    <div>
      <PageHeader
        icon={Receipt}
        title={t('Expense Tracker')}
        subtitle={t('Planned budget vs actual spending, stored in MongoDB.')}
        actions={
          <>
            <TripSelect value={tripId} onChange={(id) => setTripId(id || '')} allowAll />
            <Button icon={Plus} onClick={() => { setForm({ ...EMPTY_FORM, date: new Date().toISOString().slice(0, 10) }); setModalOpen(true); }}>
              {t('Add expense')}
            </Button>
          </>
        }
      />

      {/* ── Summary Stats ── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={BarChart3} label={t('Planned budget')} value={formatCurrency(s?.plannedBudget || 0, s?.currency || 'INR')} tone="blue" />
        <StatCard icon={PieChartIcon} label={t('Actual spending')} value={formatCurrency(s?.actualSpending || 0, s?.currency || 'INR')} tone="amber" />
        <StatCard
          icon={Receipt}
          label={t('Remaining')}
          value={formatCurrency(remaining, s?.currency || 'INR')}
          tone={remaining >= 0 ? 'green' : 'rose'}
          sub={remaining < 0 ? t('Over budget!') : undefined}
        />
        <StatCard
          icon={Tag}
          label={t('Total expenses')}
          value={allExpenses.length}
          tone="violet"
          sub={allExpenses.length > 0 ? `${t('across')} ${Object.keys(categoryCounts).length} ${t('categories')}` : t('No entries yet')}
        />
      </div>

      {/* ── Charts ── */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="card p-5">
          <h3 className="mb-4 text-sm font-extrabold text-slate-900 dark:text-white">{t('Category breakdown')}</h3>
          {pieData.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-400">{t('No expenses recorded yet.')}</p>
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
          <h3 className="mb-4 text-sm font-extrabold text-slate-900 dark:text-white">{t('Daily spending')}</h3>
          {barData.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-400">{t('No daily data yet.')}</p>
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

      {/* ── Category Detail Breakdown ── */}
      {Object.keys(categoryCounts).length > 0 && (
        <div className="mt-6 card p-5">
          <h3 className="mb-3 text-sm font-extrabold text-slate-900 dark:text-white">{t('Spending by category')}</h3>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(s?.byCategory || {}).map(([cat, amt]) => (
              <div key={cat} className="flex items-center gap-3 rounded-xl bg-slate-50 px-3.5 py-2.5 dark:bg-slate-800/60">
                <span className="text-lg">{CATEGORY_ICONS[cat] || '📦'}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-slate-800 dark:text-slate-100 capitalize">{cat}</p>
                  <p className="text-[11px] text-slate-400">
                    {categoryCounts[cat] || 0} {t('expense')}{(categoryCounts[cat] || 0) !== 1 ? 's' : ''}
                  </p>
                </div>
                <p className="text-sm font-extrabold text-slate-900 dark:text-white">{formatCurrency(amt, s?.currency || 'INR')}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Expense List ── */}
      <div className="card mt-6 p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-extrabold text-slate-900 dark:text-white">
            {t('Recent expenses')} ({expenses.length}{categoryFilter !== 'all' ? ` / ${allExpenses.length}` : ''})
          </h3>
          <div className="flex items-center gap-2">
            <button
              onClick={() => expensesApi.analyze({ tripId: tripId || undefined }).then(({ data }) => toast(data.data.analysis.analysis || t('Analysis done'), { icon: '🤖' }))}
              className="btn-secondary px-3 py-1.5 text-xs"
            >
              <Sparkles className="h-3.5 w-3.5" /> {t('AI analysis')}
            </button>
          </div>
        </div>

        {/* Category filter tabs */}
        {allExpenses.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-1.5">
            <button
              onClick={() => setCategoryFilter('all')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
                categoryFilter === 'all'
                  ? 'bg-brand-100 text-brand-700 dark:bg-brand-950 dark:text-brand-300'
                  : 'bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700'
              }`}
            >
              <Filter className="h-3 w-3" /> {t('All')} ({allExpenses.length})
            </button>
            {EXPENSE_CATEGORIES.filter((c) => categoryCounts[c.value]).map((c) => (
              <button
                key={c.value}
                onClick={() => setCategoryFilter(categoryFilter === c.value ? 'all' : c.value)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
                  categoryFilter === c.value
                    ? 'bg-brand-100 text-brand-700 dark:bg-brand-950 dark:text-brand-300'
                    : 'bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700'
                }`}
              >
                {CATEGORY_ICONS[c.value]} {c.label} ({categoryCounts[c.value]})
              </button>
            ))}
          </div>
        )}

        {/* Loading */}
        {expensesLoading && (
          <div className="py-8 text-center text-sm text-slate-400">
            <Clock className="mx-auto mb-2 h-5 w-5 animate-spin" /> {t('Loading expenses…')}
          </div>
        )}

        {/* Error */}
        {expensesError && (
          <div className="flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            {t('Failed to load expenses. Please try again.')}
          </div>
        )}

        {/* Empty */}
        {!expensesLoading && !expensesError && expenses.length === 0 && (
          <EmptyState
            icon={Receipt}
            title={categoryFilter !== 'all' ? t('No expenses in this category') : t('No expenses yet')}
            message={categoryFilter !== 'all' ? t('Try selecting a different category or add a new expense.') : t('Add your first expense to see the breakdown.')}
          />
        )}

        {/* Expense rows */}
        {!expensesLoading && !expensesError && expenses.length > 0 && (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {expenses.map((e) => (
              <div key={e._id} className="group flex items-start gap-3 py-3 transition-colors hover:bg-slate-50/50 dark:hover:bg-slate-800/20 -mx-2 px-2 rounded-lg">
                {/* Category icon */}
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-lg dark:bg-slate-800">
                  {CATEGORY_ICONS[e.category] || '📦'}
                </span>

                {/* Main info */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-bold text-slate-900 dark:text-white">{e.description}</p>
                    {e.isEstimate && (
                      <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                        {t('est.')}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-400">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatDate(e.date)}
                    </span>
                    <span className="inline-flex items-center gap-1 capitalize">
                      <Tag className="h-3 w-3" />
                      {e.category}
                    </span>
                    {e.location && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {e.location}
                      </span>
                    )}
                    {e.paymentMethod && (
                      <span className="inline-flex items-center gap-1 capitalize">
                        <CreditCard className="h-3 w-3" />
                        {e.paymentMethod}
                      </span>
                    )}
                    {e.currency && e.currency !== 'INR' && (
                      <span className="rounded bg-slate-200 px-1 py-0.5 text-[10px] font-bold dark:bg-slate-700">{e.currency}</span>
                    )}
                  </div>
                </div>

                {/* Amount + actions */}
                <div className="flex shrink-0 items-center gap-2">
                  <p className="text-sm font-extrabold text-slate-900 dark:text-white">{formatCurrency(e.amount, e.currency)}</p>
                  <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      onClick={() => openEditModal(e)}
                      className="rounded-lg p-1.5 text-slate-300 hover:bg-blue-50 hover:text-blue-500 dark:text-slate-600 dark:hover:bg-blue-950"
                      title={t('Edit')}
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => setConfirmDelete(e)}
                      className="rounded-lg p-1.5 text-slate-300 hover:bg-rose-50 hover:text-rose-500 dark:text-slate-600 dark:hover:bg-rose-950"
                      title={t('Delete')}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Add Expense Modal ── */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={t('Add expense')}>
        <div className="space-y-4">
          <Select
            label={t('Category')}
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            options={EXPENSE_CATEGORIES.map((c) => ({ value: c.value, label: `${CATEGORY_ICONS[c.value]} ${c.label}` }))}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('Amount')} type="number" min={0} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            <Select
              label={t('Currency')}
              value={form.currency}
              onChange={(e) => setForm({ ...form, currency: e.target.value })}
              options={CURRENCIES.map((c) => ({ value: c, label: c }))}
            />
          </div>
          <Input label={t('Description')} placeholder={t('Dinner at restaurant')} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <Input label={t('Date')} type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          <Input label={t('Location (optional)')} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder={t('e.g. Near Gateway of India')} />
          <Select
            label={t('Payment method (optional)')}
            value={form.paymentMethod}
            onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}
            options={PAYMENT_METHODS}
          />
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={form.isEstimate}
              onChange={(e) => setForm({ ...form, isEstimate: e.target.checked })}
              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            />
            {t('This is an estimated amount')}
          </label>
          <Button
            className="w-full"
            disabled={!form.amount || !form.description || !form.date}
            onClick={() => addMutation.mutate({ ...form, amount: Number(form.amount), trip: tripId || null })}
          >
            {t('Save expense')}
          </Button>
        </div>
      </Modal>

      {/* ── Edit Expense Modal ── */}
      <Modal open={editModalOpen} onClose={() => { setEditModalOpen(false); setEditingExpense(null); }} title={t('Edit expense')}>
        <div className="space-y-4">
          <Select
            label={t('Category')}
            value={editForm.category}
            onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
            options={EXPENSE_CATEGORIES.map((c) => ({ value: c.value, label: `${CATEGORY_ICONS[c.value]} ${c.label}` }))}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('Amount')} type="number" min={0} value={editForm.amount} onChange={(e) => setEditForm({ ...editForm, amount: e.target.value })} />
            <Select
              label={t('Currency')}
              value={editForm.currency}
              onChange={(e) => setEditForm({ ...editForm, currency: e.target.value })}
              options={CURRENCIES.map((c) => ({ value: c, label: c }))}
            />
          </div>
          <Input label={t('Description')} value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} />
          <Input label={t('Date')} type="date" value={editForm.date} onChange={(e) => setEditForm({ ...editForm, date: e.target.value })} />
          <Input label={t('Location (optional)')} value={editForm.location} onChange={(e) => setEditForm({ ...editForm, location: e.target.value })} />
          <Select
            label={t('Payment method (optional)')}
            value={editForm.paymentMethod}
            onChange={(e) => setEditForm({ ...editForm, paymentMethod: e.target.value })}
            options={PAYMENT_METHODS}
          />
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={editForm.isEstimate}
              onChange={(e) => setEditForm({ ...editForm, isEstimate: e.target.checked })}
              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            />
            {t('This is an estimated amount')}
          </label>
          <Button
            className="w-full"
            disabled={!editForm.amount || !editForm.description || !editForm.date}
            onClick={() => updateMutation.mutate({ id: editingExpense?._id, payload: { ...editForm, amount: Number(editForm.amount) } })}
          >
            {t('Update expense')}
          </Button>
        </div>
      </Modal>

      {/* ── Delete Confirmation Modal ── */}
      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title={t('Delete expense')}>
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {t('Are you sure you want to delete')} "<strong>{confirmDelete?.description}</strong>"?
          </p>
          <p className="text-sm font-bold text-slate-900 dark:text-white">
            {formatCurrency(confirmDelete?.amount || 0, confirmDelete?.currency)}
          </p>
          <div className="flex gap-3">
            <Button className="flex-1" variant="secondary" onClick={() => setConfirmDelete(null)}>
              {t('Cancel')}
            </Button>
            <Button
              className="flex-1"
              variant="danger"
              onClick={() => confirmDelete && deleteMutation.mutate(confirmDelete._id)}
            >
              {t('Delete')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
