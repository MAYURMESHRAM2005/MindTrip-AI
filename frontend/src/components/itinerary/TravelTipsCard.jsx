import React from 'react';
import { Lightbulb, Luggage, ShieldAlert, UtensilsCrossed, Siren, PiggyBank, Clock, Ban, Check } from 'lucide-react';
import Card, { CardHeader } from '../ui/Card';

function TipList({ icon: Icon, title, items, accent }) {
  if (!items?.length) return null;
  return (
    <div className={`rounded-2xl border border-slate-100 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-900/40 ${accent || ''}`}>
      <p className="mb-2 inline-flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white text-brand-600 shadow-sm dark:bg-slate-800 dark:text-brand-400">
          <Icon className="h-4 w-4" />
        </span>
        {title}
      </p>
      <ul className="space-y-1.5">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function TravelTipsCard({ tips }) {
  if (!tips) return null;
  const lists = [
    { icon: Luggage, title: 'Packing checklist', items: tips.packingChecklist, span: 'sm:col-span-1' },
    { icon: ShieldAlert, title: 'Safety tips', items: tips.safetyTips, span: 'sm:col-span-1' },
    { icon: UtensilsCrossed, title: 'Local foods to try', items: tips.localFoods, span: 'sm:col-span-1' },
    { icon: Siren, title: 'Emergency numbers', items: tips.emergencyNumbers, span: 'sm:col-span-1' },
    { icon: PiggyBank, title: 'Money saving tips', items: tips.moneySavingTips, span: 'sm:col-span-1' },
    { icon: Clock, title: 'Best times', items: tips.bestTimes, span: 'sm:col-span-1' },
    { icon: Ban, title: 'Things to avoid', items: tips.thingsToAvoid, span: 'sm:col-span-1' },
  ];
  return (
    <Card className="mb-6">
      <CardHeader icon={Lightbulb} title="Travel tips" subtitle="Practical advice from the Local Guide & Safety agents" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {lists.map((l, i) => <div key={i} className={l.span}><TipList icon={l.icon} title={l.title} items={l.items} /></div>)}
      </div>
    </Card>
  );
}
