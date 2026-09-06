import React from 'react';
import { useI18n } from '../../utils/i18n';
import { formatCurrency } from '../../utils/format';
import { cn } from '../../utils/format';

/**
 * PriceBadge — displays a price with its data-status indicator.
 *
 * States:
 *   live     → ₹500  ● Live
 *   cached   → ₹500  ● Verified
 *   estimate → ≈ ₹500  ≈ Estimate
 *   free     → Free
 *   unknown  → (renders nothing — resolved by backend before rendering)
 *
 * @param {object} props
 * @param {number|null} props.amount     - price amount (null = unknown)
 * @param {string}      props.priceType  - 'live'|'cached'|'estimate'|'free'|'unknown'
 * @param {string}      props.currency   - currency code (default 'INR')
 * @param {string}      props.unit       - optional unit suffix (e.g. '/person', '/night')
 * @param {string}      props.className  - additional classes
 * @param {boolean}     props.showLabel  - show status label (default true)
 * @param {string}      props.size       - 'sm' | 'md' (default 'md')
 */
export default function PriceBadge({
  amount,
  priceType = 'unknown',
  currency = 'INR',
  unit = '',
  className = '',
  showLabel = true,
  size = 'md',
}) {
  const { t } = useI18n();

  // Never render unknown prices — the backend should resolve fallbacks before sending to frontend
  if (priceType === 'unknown' || (amount == null && priceType !== 'free')) {
    return null;
  }

  const isSm = size === 'sm';
  const textSize = isSm ? 'text-xs' : 'text-sm';
  const labelText = isSm ? 'text-[9px]' : 'text-[10px]';

  if (priceType === 'free') {
    return (
      <span className={cn('inline-flex items-center gap-1', className)}>
        <span className={cn('font-extrabold text-emerald-600 dark:text-emerald-400', textSize)}>
          Free
        </span>
        {showLabel && (
          <span className={cn('inline-flex items-center rounded-full bg-emerald-100 px-1.5 py-0.5 font-semibold uppercase tracking-wide dark:bg-emerald-950 dark:text-emerald-400', labelText, 'text-emerald-700')}>
            {t('Free')}
          </span>
        )}
      </span>
    );
  }

  if (amount == null) return null;

  const formatted = formatCurrency(amount, currency);

  const typeConfig = {
    live: {
      color: 'text-slate-900 dark:text-white',
      labelBg: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
      labelText: '● Live',
    },
    cached: {
      color: 'text-slate-900 dark:text-white',
      labelBg: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-400',
      labelText: '● Verified',
    },
    estimate: {
      color: 'text-amber-700 dark:text-amber-400',
      labelBg: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
      labelText: '≈ Estimate',
    },
  };

  const config = typeConfig[priceType] || typeConfig.estimate;
  const prefix = priceType === 'estimate' ? '≈ ' : '';

  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <span className={cn('font-extrabold', textSize, config.color)}>
        {prefix}{formatted}{unit ? <span className="font-normal opacity-70">{unit}</span> : ''}
      </span>
      {showLabel && (
        <span className={cn('inline-flex items-center rounded-full px-1.5 py-0.5 font-semibold uppercase tracking-wide', labelText, config.labelBg)}>
          {config.labelText}
        </span>
      )}
    </span>
  );
}
