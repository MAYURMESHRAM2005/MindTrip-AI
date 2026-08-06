import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bookmark, CalendarDays, Trash2, ArrowRight, Compass, Download, Wallet } from 'lucide-react';
import PageHeader from '../components/ui/PageHeader';
import { tripApi } from '../services/apiClient';
import { formatCurrency, formatDate } from '../utils/format';
import { PageLoader } from '../components/ui/Spinner';
import EmptyState from '../components/ui/EmptyState';
import Badge from '../components/ui/Badge';
import toast from 'react-hot-toast';

const STATUS_TONES = { planned: 'blue', confirmed: 'green', draft: 'slate', completed: 'violet', cancelled: 'rose' };

export default function SavedTrips() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['trips'], queryFn: () => tripApi.list().then((r) => r.data.data) });

  const deleteTrip = useMutation({
    mutationFn: (id) => tripApi.remove(id),
    onSuccess: () => {
      toast.success('Trip deleted');
      queryClient.invalidateQueries({ queryKey: ['trips'] });
    },
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }) => tripApi.update(id, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['trips'] }),
  });

  const trips = data?.trips || [];

  if (isLoading) return <PageLoader />;

  return (
    <div>
      <PageHeader
        icon={Bookmark}
        title="Saved Trips"
        subtitle="All trips planned by your AI agents, persisted in MongoDB."
        actions={<Link to="/planner" className="btn-primary"><Compass className="h-4 w-4" /> New trip</Link>}
      />

      {trips.length === 0 ? (
        <EmptyState icon={Bookmark} title="No saved trips" message="Generate your first trip and it will be saved here automatically." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {trips.map((t) => (
            <div key={t._id} className="card overflow-hidden transition-all hover:-translate-y-0.5 hover:shadow-card">
              <div className="bg-gradient-to-br from-brand-600 to-brand-900 p-5 text-white">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-base font-extrabold">{t.title}</p>
                    <p className="mt-0.5 text-sm text-brand-100">
                      {t.origin ? `${t.origin} → ` : ''}{t.destination}
                    </p>
                  </div>
                  <select
                    value={t.status}
                    onChange={(e) => setStatus.mutate({ id: t._id, status: e.target.value })}
                    className="rounded-lg border border-white/30 bg-white/15 px-2 py-1 text-xs font-bold text-white outline-none"
                  >
                    {['draft', 'planned', 'confirmed', 'completed', 'cancelled'].map((s) => (
                      <option key={s} value={s} className="text-slate-900">{s}</option>
                    ))}
                  </select>
                </div>
                <p className="mt-2 flex items-center gap-1.5 text-xs text-brand-100">
                  <CalendarDays className="h-3.5 w-3.5" />
                  {formatDate(t.startDate)} – {formatDate(t.endDate)} · {t.travelers?.adults || 1} adult(s)
                </p>
              </div>
              <div className="space-y-1 p-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500 dark:text-slate-400">Budget</span>
                  <span className="font-extrabold text-slate-900 dark:text-white">{formatCurrency(t.budget.total, t.budget.currency)}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500 dark:text-slate-400">Estimated</span>
                  <span className={`font-extrabold ${t.isOverBudget ? 'text-rose-500' : 'text-emerald-500'}`}>
                    {formatCurrency(t.totalEstimatedCost, t.budget.currency)}
                  </span>
                </div>
                {t.moneySaved > 0 && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500 dark:text-slate-400">Optimized savings</span>
                    <span className="font-extrabold text-emerald-500">{formatCurrency(t.moneySaved, t.budget.currency)}</span>
                  </div>
                )}
                <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                  <Link to={`/itinerary/${t._id}`} className="btn-primary flex-1 py-2 text-xs">
                    Itinerary <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                  <Link to={`/budget?trip=${t._id}`} className="btn-secondary px-3 py-2 text-xs">
                    <Wallet className="h-3.5 w-3.5" />
                  </Link>
                  <a href={tripApi.pdfUrl(t._id)} target="_blank" rel="noreferrer" className="btn-secondary px-3 py-2 text-xs">
                    <Download className="h-3.5 w-3.5" />
                  </a>
                  <button onClick={() => deleteTrip.mutate(t._id)} className="btn-secondary px-3 py-2 text-xs text-rose-500">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
