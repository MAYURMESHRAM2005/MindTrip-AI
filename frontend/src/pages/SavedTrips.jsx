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
import { useI18n } from '../utils/i18n';

const STATUS_TONES = { planned: 'blue', confirmed: 'green', draft: 'slate', completed: 'violet', cancelled: 'rose' };

export default function SavedTrips() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['trips'], queryFn: () => tripApi.list().then((r) => r.data.data) });

  const deleteTrip = useMutation({
    mutationFn: (id) => tripApi.remove(id),
    onSuccess: () => {
      toast.success(t('Trip deleted'));
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
        title={t('Saved Trips')}
        subtitle={t('All trips planned by your AI agents, persisted in MongoDB.')}
        actions={<Link to="/planner" className="btn-primary"><Compass className="h-4 w-4" /> {t('New trip')}</Link>}
      />

      {trips.length === 0 ? (
        <EmptyState icon={Bookmark} title={t('No saved trips')} message={t('Generate your first trip and it will be saved here automatically.')} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {trips.map((trip) => (
            <div key={trip._id} className="card overflow-hidden transition-all hover:-translate-y-0.5 hover:shadow-card">
              <div className="bg-gradient-to-br from-brand-600 to-brand-900 p-5 text-white">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-base font-extrabold">{trip.title}</p>
                    <p className="mt-0.5 text-sm text-brand-100">
                      {trip.origin ? `${trip.origin} → ` : ''}{trip.destination}
                    </p>
                  </div>
                  <select
                    value={trip.status}
                    onChange={(e) => setStatus.mutate({ id: trip._id, status: e.target.value })}
                    className="rounded-lg border border-white/30 bg-white/15 px-2 py-1 text-xs font-bold text-white outline-none"
                  >
                    {['draft', 'planned', 'confirmed', 'completed', 'cancelled'].map((s) => (
                      <option key={s} value={s} className="text-slate-900">{s}</option>
                    ))}
                  </select>
                </div>
                <p className="mt-2 flex items-center gap-1.5 text-xs text-brand-100">
                  <CalendarDays className="h-3.5 w-3.5" />
                  {formatDate(trip.startDate)} – {formatDate(trip.endDate)} · {trip.travelers?.adults || 1} {t('adult(s)')}
                </p>
              </div>
              <div className="space-y-1 p-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500 dark:text-slate-400">{t('Budget')}</span>
                  <span className="font-extrabold text-slate-900 dark:text-white">{formatCurrency(trip.budget.total, trip.budget.currency)}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500 dark:text-slate-400">{t('Estimated')}</span>
                  <span className={`font-extrabold ${trip.isOverBudget ? 'text-rose-500' : 'text-emerald-500'}`}>
                    {formatCurrency(trip.totalEstimatedCost, trip.budget.currency)}
                  </span>
                </div>
                {trip.moneySaved > 0 && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500 dark:text-slate-400">{t('Optimized savings')}</span>
                    <span className="font-extrabold text-emerald-500">{formatCurrency(trip.moneySaved, trip.budget.currency)}</span>
                  </div>
                )}
                <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                  <Link to={`/itinerary/${trip._id}`} className="btn-primary flex-1 py-2 text-xs">
                    {t('Itinerary')} <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                  <Link to={`/budget?trip=${trip._id}`} className="btn-secondary px-3 py-2 text-xs">
                    <Wallet className="h-3.5 w-3.5" />
                  </Link>
                  <a href={tripApi.pdfUrl(trip._id)} target="_blank" rel="noreferrer" className="btn-secondary px-3 py-2 text-xs">
                    <Download className="h-3.5 w-3.5" />
                  </a>
                  <button onClick={() => deleteTrip.mutate(trip._id)} className="btn-secondary px-3 py-2 text-xs text-rose-500">
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
