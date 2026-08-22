import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck, Trash2, Plane, Wallet, CloudSun, Shield, MessageSquare } from 'lucide-react';
import PageHeader from '../components/ui/PageHeader';
import { notificationsApi } from '../services/apiClient';
import { timeAgo } from '../utils/format';
import { PageLoader } from '../components/ui/Spinner';
import EmptyState from '../components/ui/EmptyState';
import toast from 'react-hot-toast';
import { useI18n } from '../utils/i18n';

const ICONS = { trip: Plane, budget: Wallet, weather: CloudSun, safety: Shield, chat: MessageSquare, system: Bell };

export default function Notifications() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => notificationsApi.list().then((r) => r.data.data),
    refetchInterval: 60000,
  });
  const notifications = data?.notifications || [];

  const markAll = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const markOne = useMutation({
    mutationFn: (id) => notificationsApi.markRead(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const clearAll = useMutation({
    mutationFn: () => notificationsApi.clear(),
    onSuccess: () => {
      toast.success(t('Notifications cleared'));
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  if (isLoading) return <PageLoader />;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        icon={Bell}
        title={t('Notifications')}
        subtitle={`${data?.unreadCount || 0} ${t('unread')}`}
        actions={
          <>
            <button onClick={() => markAll.mutate()} className="btn-secondary"><CheckCheck className="h-4 w-4" /> {t('Mark all read')}</button>
            <button onClick={() => clearAll.mutate()} className="btn-ghost text-rose-500"><Trash2 className="h-4 w-4" /> {t('Clear')}</button>
          </>
        }
      />

      {notifications.length === 0 ? (
        <EmptyState icon={Bell} title={t('All caught up')} message={t('Trip, budget, weather and safety notifications appear here.')} />
      ) : (
        <div className="space-y-2">
          {notifications.map((n) => {
            const Icon = ICONS[n.type] || Bell;
            const content = (
              <div className={`card flex items-start gap-3 p-4 transition-colors ${n.read ? 'opacity-60' : 'border-brand-200 dark:border-brand-900'}`}>
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-950 dark:text-brand-400">
                  <Icon className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-slate-900 dark:text-white">{n.title}</p>
                  <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{n.message}</p>
                  <p className="mt-1 text-xs text-slate-400">{timeAgo(n.createdAt)}</p>
                </div>
                {!n.read && <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-brand-500" />}
              </div>
            );
            return n.link ? (
              <Link key={n._id} to={n.link} onClick={() => !n.read && markOne.mutate(n._id)}>
                {content}
              </Link>
            ) : (
              <div key={n._id} onClick={() => !n.read && markOne.mutate(n._id)}>{content}</div>
            );
          })}
        </div>
      )}
    </div>
  );
}
