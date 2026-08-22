import React from 'react';
import { Sparkles, MapPin, UtensilsCrossed, Coffee, ShoppingBag, Users, Gem } from 'lucide-react';
import Card, { CardHeader } from '../ui/Card';
import Badge from '../ui/Badge';
import { useI18n } from '../../utils/i18n';

function ChipList({ icon: Icon, title, items, tone }) {
  if (!items?.length) return null;
  const tones = {
    violet: 'bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300',
    rose: 'bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300',
    amber: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
    emerald: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
    sky: 'bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
  };
  return (
    <div>
      <p className="mb-2 inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">
        <Icon className="h-3.5 w-3.5" /> {title}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item, i) => (
          <span key={i} className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${tones[tone] || tones.violet}`}>
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function RecommendationsCard({ recommendations }) {
  const { t } = useI18n();
  if (!recommendations) return null;
  const hasAny = Object.values(recommendations).some((v) => Array.isArray(v) && v.length);
  if (!hasAny) return null;

  return (
    <Card className="mb-6">
      <CardHeader
        icon={Sparkles}
        title={t('AI recommendations')}
        subtitle={t('Curated highlights for your trip')}
        action={<Badge tone="violet">{t('AI curated')}</Badge>}
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <ChipList icon={MapPin} title={t('Must-visit places')} items={recommendations.mustVisitPlaces} tone="violet" />
        <ChipList icon={UtensilsCrossed} title={t('Best restaurants')} items={recommendations.bestRestaurants} tone="rose" />
        <ChipList icon={Coffee} title={t('Best cafes')} items={recommendations.bestCafes} tone="amber" />
        <ChipList icon={ShoppingBag} title={t('Shopping areas')} items={recommendations.bestShoppingAreas} tone="emerald" />
        <ChipList icon={Users} title={t('Family friendly')} items={recommendations.familyFriendlyAttractions} tone="sky" />
        <ChipList icon={Gem} title={t('Hidden gems')} items={recommendations.hiddenGems} tone="violet" />
      </div>
    </Card>
  );
}
