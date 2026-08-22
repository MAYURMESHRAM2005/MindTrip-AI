import React from 'react';
import { useI18n } from '../../utils/i18n';
import { cn } from '../../utils/format';

export function Spinner({ className, size = 'md' }) {
  const dims = size === 'sm' ? 'h-4 w-4' : size === 'lg' ? 'h-10 w-10' : 'h-6 w-6';
  return (
    <span
      className={cn(
        'inline-block animate-spin rounded-full border-[3px] border-brand-200 border-t-brand-600 dark:border-slate-700 dark:border-t-brand-400',
        dims,
        className
      )}
    />
  );
}

export function PageLoader({ label }) {
  const { t } = useI18n();
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3">
      <Spinner size="lg" />
      <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{label || t('Loading…')}</p>
    </div>
  );
}

export default Spinner;
