import React from 'react';
import { motion } from 'framer-motion';
import { cn } from '../../utils/format';

export default function StatCard({ icon: Icon, label, value, sub, tone = 'blue' }) {
  const tones = {
    blue: 'bg-sky-50 text-sky-600 dark:bg-sky-950 dark:text-sky-400',
    green: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400',
    amber: 'bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-400',
    rose: 'bg-rose-50 text-rose-600 dark:bg-rose-950 dark:text-rose-400',
    violet: 'bg-violet-50 text-violet-600 dark:bg-violet-950 dark:text-violet-400',
  };
  return (
    <motion.div
      whileHover={{ y: -2 }}
      className="card p-5 flex items-start gap-4"
    >
      <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', tones[tone])}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
        <p className="mt-0.5 truncate text-xl font-extrabold text-slate-900 dark:text-white">{value}</p>
        {sub && <p className="text-xs text-slate-500 dark:text-slate-400">{sub}</p>}
      </div>
    </motion.div>
  );
}
