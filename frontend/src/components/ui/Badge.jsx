import React from 'react';
import { useI18n } from '../../utils/i18n';
import { cn } from '../../utils/format';

const TONES = {
  green: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
  blue: 'bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-400',
  amber: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
  rose: 'bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-400',
  slate: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  violet: 'bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-400',
};

export default function Badge({ tone = 'slate', className, children }) {
  return <span className={cn('badge', TONES[tone] || TONES.slate, className)}>{children}</span>;
}

/**
 * Data-status pill: live / estimate / unavailable.
 */
export function DataStatusBadge({ status }) {
  const { t } = useI18n();
  if (status === 'live') return <Badge tone="green">● {t('Live data')}</Badge>;
  if (status === 'estimate') return <Badge tone="amber">≈ {t('Estimate')}</Badge>;
  return <Badge tone="rose">{t('Live data unavailable')}</Badge>;
}

export function ProviderStatusBadge({ configured }) {
  const { t } = useI18n();
  return configured ? <Badge tone="green">● {t('Configured')}</Badge> : <Badge tone="rose">{t('Not configured')}</Badge>;
}

/**
 * Data-source transparency pill: shows whether data is from a live API,
 * an estimate, or unavailable. Includes source name and timestamp.
 */
export function DataSourceBadge({ source, isEstimate, fetchedAt }) {
  const { t } = useI18n();
  if (isEstimate) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-amber-500">
        ≈ {t('Estimate')}{source ? ` · ${source}` : ''}
      </span>
    );
  }
  if (source && source !== 'none' && source !== 'unavailable') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-emerald-500">
        ● {t('Live data')}{source ? ` · ${source}` : ''}
        {fetchedAt && <span className="text-slate-400">({new Date(fetchedAt).toLocaleTimeString()})</span>}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-rose-400">
      ✕ {t('Data unavailable')}
    </span>
  );
}
