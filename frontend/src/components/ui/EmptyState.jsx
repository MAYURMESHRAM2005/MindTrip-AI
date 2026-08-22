import React from 'react';
import { Inbox } from 'lucide-react';
import { useI18n } from '../../utils/i18n';

export default function EmptyState({ icon: Icon = Inbox, title, message, action }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 px-6 py-14 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500">
        <Icon className="h-7 w-7" />
      </div>
      <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">{title || t('Nothing here yet')}</h3>
      {message && <p className="max-w-sm text-sm text-slate-500 dark:text-slate-400">{message}</p>}
      {action}
    </div>
  );
}
