import React from 'react';
import { Hotel, UtensilsCrossed, Landmark, Star, MapPin, Clock, DollarSign, Leaf } from 'lucide-react';
import Card, { CardHeader } from '../ui/Card';
import Badge from '../ui/Badge';
import { formatCurrency } from '../../utils/format';
import { useI18n } from '../../utils/i18n';

const VARIANTS = {
  hotel: {
    icon: Hotel,
    titleKey: 'Recommended hotels',
    subtitleKey: 'Stays near the destination within your budget',
    accent: 'from-indigo-500 to-violet-600',
    iconBg: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400',
    emptyKey: 'Live hotel offers unavailable — the itinerary uses a budget-based accommodation estimate.',
  },
  restaurant: {
    icon: UtensilsCrossed,
    titleKey: 'Recommended restaurants',
    subtitleKey: 'Where to eat — matched to your food preference',
    accent: 'from-rose-500 to-pink-600',
    iconBg: 'bg-rose-50 text-rose-600 dark:bg-rose-950 dark:text-rose-400',
    emptyKey: 'Live restaurant data unavailable — explore the Restaurants page when online.',
  },
  attraction: {
    icon: Landmark,
    titleKey: 'Tourist attractions',
    subtitleKey: 'Top sights, hidden gems and nearby places',
    accent: 'from-amber-500 to-orange-600',
    iconBg: 'bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-400',
    emptyKey: 'Live attraction data unavailable — explore the Maps & Places pages when online.',
  },
};

function Stars({ rating }) {
  const { t } = useI18n();
  if (rating == null) return <span className="text-xs text-slate-400">{t('No rating')}</span>;
  return (
    <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-500">
      <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" /> {rating}
      <span className="font-medium text-slate-400">/ 5</span>
    </span>
  );
}

function PlaceCard({ item, variant, currency }) {
  const { t } = useI18n();
  const Icon = variant === 'hotel' ? Hotel : variant === 'restaurant' ? UtensilsCrossed : Landmark;
  const showPrice =
    variant === 'hotel' ? item.pricePerNight != null : variant === 'restaurant' ? item.averageCost != null : item.entryFee?.amount != null;

  return (
    <div className="group flex flex-col overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
      {/* Gradient banner in place of a photo (providers don't expose images) */}
      <div className={`relative flex h-24 items-center justify-center bg-gradient-to-br ${variant === 'hotel' ? 'from-indigo-500 to-violet-600' : variant === 'restaurant' ? 'from-rose-500 to-pink-600' : 'from-amber-500 to-orange-600'} text-white/90`}>
        <Icon className="h-10 w-10 opacity-90 transition-transform group-hover:scale-110" />
        {item.isLive && <span className="absolute right-2 top-2"><Badge tone="green">● Live</Badge></span>}
        {variant === 'attraction' && item.timeRequired != null && (
          <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-lg bg-black/25 px-2 py-0.5 text-[11px] font-bold text-white backdrop-blur">
            <Clock className="h-3 w-3" /> {item.timeRequired}h
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <p className="text-sm font-extrabold text-slate-900 dark:text-white">{item.name}</p>
        <div className="flex items-center justify-between gap-2">
          <Stars rating={item.rating} />
          {item.distanceLabel && (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              <MapPin className="h-3 w-3" /> {item.distanceLabel}
            </span>
          )}
        </div>

        {variant === 'restaurant' && (
          <div className="flex flex-wrap gap-1">
            {item.veg && <Badge tone="green">{t('Veg')}</Badge>}
            {item.nonVeg && <Badge tone="rose">{t('Non-veg')}</Badge>}
            {item.vegan && <Badge tone="violet"><Leaf className="h-3 w-3" /> {t('Vegan')}</Badge>}
            {item.cuisine && <span className="text-[11px] text-slate-500 dark:text-slate-400">{item.cuisine}</span>}
          </div>
        )}
        {variant === 'hotel' && item.amenities?.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {item.amenities.slice(0, 3).map((a, i) => (
              <span key={i} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{a}</span>
            ))}
          </div>
        )}
        {variant === 'attraction' && item.types?.length > 0 && (
          <span className="text-[11px] capitalize text-slate-500 dark:text-slate-400">{item.types.join(', ')}</span>
        )}

        {showPrice && (
          <div className="mt-auto pt-1">
            <p className="text-sm font-extrabold text-slate-900 dark:text-white">
              {variant === 'hotel' ? (
                <>{formatCurrency(item.pricePerNight, currency)} <span className="text-xs font-medium text-slate-400">{t('/night')}</span></>
              ) : variant === 'restaurant' ? (
                <>{formatCurrency(item.averageCost, currency)} <span className="text-xs font-medium text-slate-400">{t('avg meal')}</span></>
              ) : (
                <>{formatCurrency(item.entryFee.amount, currency)} <span className="text-xs font-medium text-slate-400">{t('entry')}</span></>
              )}
            </p>
            {/* Estimate indicator for restaurant/attraction costs */}
            {variant === 'restaurant' && item.averageCostIsEstimate && (
              <p className="mt-0.5 text-[10px] text-amber-500">≈ {t('estimate')} · {item.averageCostNote || t('Actual prices not available')}</p>
            )}
            {variant === 'attraction' && item.entryFeeIsEstimate && (
              <p className="mt-0.5 text-[10px] text-amber-500">≈ {t('estimate')} · {item.entryFeeNote || t('Confirm entry fee locally')}</p>
            )}
            {/* Live badge for hotels */}
            {variant === 'hotel' && item.isLive && (
              <p className="mt-0.5 text-[10px] text-emerald-500">● {t('Live price from provider')}</p>
            )}
            {/* Fetched at timestamp */}
            {item.fetchedAt && (
              <p className="mt-0.5 text-[9px] text-slate-400">{t('Fetched')}: {new Date(item.fetchedAt).toLocaleString()}</p>
            )}
          </div>
        )}
        {item.address && <p className="text-[11px] text-slate-400">{item.address}</p>}
      </div>
    </div>
  );
}

export default function NearbyPlacesCard({ variant = 'hotel', items = [], currency, note }) {
  const { t } = useI18n();
  const cfg = VARIANTS[variant] || VARIANTS.hotel;
  const title = t(cfg.titleKey);
  const subtitle = t(cfg.subtitleKey);
  if (!items.length) {
    return (
      <Card className="mb-6">
        <CardHeader icon={cfg.icon} title={title} subtitle={subtitle} />
        <p className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-sm text-slate-400 dark:border-slate-700">{note || t(cfg.emptyKey)}</p>
      </Card>
    );
  }
  return (
    <Card className="mb-6">
      <CardHeader icon={cfg.icon} title={title} subtitle={subtitle} action={<Badge tone="blue">{items.length} {t('found')}</Badge>} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item, i) => <PlaceCard key={item.name + i} item={item} variant={variant} currency={currency} />)}
      </div>
    </Card>
  );
}
