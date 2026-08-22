import React from 'react';
import { Wallet, PieChart, TrendingUp, PiggyBank, AlertTriangle } from 'lucide-react';
import Card, { CardHeader } from '../ui/Card';
import Badge from '../ui/Badge';
import { formatCurrency } from '../../utils/format';
import { useI18n } from '../../utils/i18n';

const ROW_COLORS = {
  hotel: 'bg-indigo-500',
  food: 'bg-rose-500',
  transport: 'bg-sky-500',
  sightseeing: 'bg-amber-500',
  shopping: 'bg-emerald-500',
  emergency: 'bg-violet-500',
  taxes: 'bg-slate-400',
};

function Row({ row, total, currency }) {
  const pct = row.pct ?? (total > 0 ? Math.round((row.amount / total) * 1000) / 10 : 0);
  const width = total > 0 ? Math.min(100, Math.round((row.amount / total) * 100)) : 0;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2 text-sm">
        <span className="font-semibold text-slate-700 dark:text-slate-200">{row.label}</span>
        <span className="font-bold text-slate-900 dark:text-white">
          {formatCurrency(row.amount, currency)}
          <span className="ml-1.5 text-xs font-medium text-slate-400">{pct}%</span>
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div className={`h-full rounded-full transition-all duration-700 ${ROW_COLORS[row.key] || 'bg-slate-400'}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

export default function BudgetPlanningCard({ planning, currency }) {
  const { t } = useI18n();
  if (!planning) return null;
  const { rows = [], totalBudget, totalEstimatedCost, remainingBudget, allocatedTotal, optimized, budgetUsedPct, withinBudget } = planning;
  const remaining = remainingBudget ?? totalBudget - totalEstimatedCost;
  const within = withinBudget ?? remaining >= 0;
  const saved = optimized?.saved || 0;
  const usedPct = budgetUsedPct ?? (totalBudget > 0 ? Math.min(100, Math.round((totalEstimatedCost / totalBudget) * 1000) / 10) : 0);

  return (
    <Card className="mb-6">
      <CardHeader
        icon={PieChart}
        title={t('Budget planning')}
        subtitle={t('How your travel budget is allocated — every cost stays within it')}
        action={<Badge tone={within ? 'green' : 'rose'}>{within ? `✓ ${t('In budget')}` : t('Over budget')}</Badge>}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-900/40">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t('Total budget')}</p>
          <p className="mt-1 text-xl font-extrabold text-slate-900 dark:text-white">{formatCurrency(totalBudget, currency)}</p>
        </div>
        <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-900/40">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t('Estimated trip cost')}</p>
          <p className="mt-1 text-xl font-extrabold text-slate-900 dark:text-white">{formatCurrency(totalEstimatedCost, currency)}</p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200/70 dark:bg-slate-800">
            <div
              className={`h-full rounded-full transition-all duration-700 ${within ? 'bg-emerald-500' : 'bg-rose-500'}`}
              style={{ width: `${Math.min(100, usedPct)}%` }}
            />
          </div>
          <p className={`mt-1 text-[11px] font-bold ${within ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
            {usedPct}% {t('of budget used')}
          </p>
        </div>
        <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-900/40">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t('Remaining budget')}</p>
          <p className={`mt-1 text-xl font-extrabold ${within ? 'text-emerald-500' : 'text-rose-500'}`}>
            {formatCurrency(remaining, currency)}
          </p>
          <p className="mt-1 text-[11px] text-slate-400">
            {optimized ? `${optimized.dropped?.length || 0} ${t('item(s) trimmed')} · ${formatCurrency(saved, currency)} ${t('saved')}` : t('within your entered budget')}
          </p>
        </div>
      </div>

      <div className="mt-5 space-y-3">
        {rows.map((row) => (
          <Row key={row.key} row={row} total={allocatedTotal || totalBudget} currency={currency} />
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
        <span className="inline-flex items-center gap-1"><Wallet className="h-3.5 w-3.5" /> {t('Allocated')}: {formatCurrency(allocatedTotal, currency)}</span>
        {saved > 0 && (
          <span className="inline-flex items-center gap-1 font-semibold text-emerald-600 dark:text-emerald-400">
            <TrendingUp className="h-3.5 w-3.5" /> {t('Optimizer saved')} {formatCurrency(saved, currency)}
          </span>
        )}
        {optimized && (
          <span className="inline-flex items-center gap-1"><PiggyBank className="h-3.5 w-3.5" /> {optimized.notes || t('Budget optimized')}</span>
        )}
        {!within && (
          <span className="inline-flex items-center gap-1 font-semibold text-rose-500"><AlertTriangle className="h-3.5 w-3.5" /> {t('Use “Optimize budget” to fit')}</span>
        )}
      </div>
    </Card>
  );
}
