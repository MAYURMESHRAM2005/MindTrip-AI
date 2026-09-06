import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Plane, TrainFront, Bus, Hotel, UtensilsCrossed, Landmark, Activity,
  CloudSun, AlertTriangle, MapPin, Navigation, Moon, Wallet,
  RefreshCw, Database, ChevronDown, ChevronUp,
} from 'lucide-react';
import { DataStatusBadge } from './ui/Badge';
import PriceBadge from './ui/PriceBadge';
import DistanceBadge from './ui/DistanceBadge';
import { formatCurrency, formatDateShort, formatDateHeader } from '../utils/format';
import { useI18n } from '../utils/i18n';
import { logItineraryWarnings } from '../utils/itineraryValidator';

const CATEGORY_ICON = {
  flight: Plane, train: TrainFront, bus: Bus, hotel: Hotel, restaurant: UtensilsCrossed,
  attraction: Landmark, activity: Activity, weather: CloudSun, transport: Plane,
};

const CATEGORY_COLOR = {
  flight: 'bg-sky-100 text-sky-600 dark:bg-sky-950 dark:text-sky-400',
  train: 'bg-cyan-100 text-cyan-600 dark:bg-cyan-950 dark:text-cyan-400',
  bus: 'bg-lime-100 text-lime-600 dark:bg-lime-950 dark:text-lime-400',
  hotel: 'bg-indigo-100 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400',
  restaurant: 'bg-rose-100 text-rose-600 dark:bg-rose-950 dark:text-rose-400',
  attraction: 'bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-400',
  activity: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400',
  transport: 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
};

function ActivityRow({ activity, currency }) {
  const { t } = useI18n();
  const [showMeta, setShowMeta] = useState(false);
  const Icon = CATEGORY_ICON[activity.category] || Activity;
  const color = CATEGORY_COLOR[activity.category] || CATEGORY_COLOR.transport;

  // Determine if there's any provenance data to show
  const hasProvider = !!(activity.provider || activity.providerId);
  const hasMeta = hasProvider || activity.fetchedAt || activity.source || activity.cost?.estimateNote;

  // Price status indicator
  const costStatus = activity.cost?.dataStatus || activity.dataStatus;
  const isPriceLive = costStatus === 'live';
  const isPriceEstimate = costStatus === 'estimate';
  const isPriceUnavailable = costStatus === 'unavailable' || (activity.cost?.amount == null && activity.cost?.dataStatus === 'unavailable');

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      className="relative flex gap-3 rounded-xl px-3 py-3 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50"
    >
      <div className="flex w-14 shrink-0 flex-col items-center pt-0.5">
        <span className="text-xs font-bold text-slate-700 dark:text-slate-200">{activity.time || '--:--'}</span>
      </div>
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${color}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-bold text-slate-900 dark:text-white">{activity.title}</p>
          <DataStatusBadge status={activity.dataStatus} provider={activity.provider} showProvider={hasProvider} provenance={activity.provenance} />
          {hasMeta && (
            <button
              onClick={() => setShowMeta(!showMeta)}
              className="inline-flex items-center gap-0.5 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 transition-colors hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
              title={t('Data source info')}
            >
              <Database className="h-2.5 w-2.5" />
              {showMeta ? <ChevronUp className="h-2.5 w-2.5" /> : <ChevronDown className="h-2.5 w-2.5" />}
            </button>
          )}
        </div>

        {/* Data source metadata panel (toggle) */}
        {showMeta && (
          <div className="mt-1.5 rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/40">
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[10px] text-slate-500 dark:text-slate-400">
              {activity.provider && (
                <span className="inline-flex items-center gap-1">
                  <Database className="h-3 w-3" /> {t('Provider')}: <b>{activity.provider}</b>
                </span>
              )}
              {activity.providerId && (
                <span className="inline-flex items-center gap-1">
                  🆔 {t('Provider ID')}: <b className="font-mono">{activity.providerId}</b>
                </span>
              )}
              {activity.source && (
                <span className="inline-flex items-center gap-1">
                  <Database className="h-3 w-3" /> {t('Source')}: <b>{activity.source}</b>
                </span>
              )}
              {activity.fetchedAt && (
                <span className="inline-flex items-center gap-1">
                  <RefreshCw className="h-3 w-3" /> {t('Fetched')}: {new Date(activity.fetchedAt).toLocaleString()}
                </span>
              )}
              {/* Provenance block */}
              {activity.provenance && (
                <>
                  <span className="inline-flex items-center gap-1">
                    🔗 {t('Provenance')}: <b>{activity.provenance.sourceType}</b>
                  </span>
                  <span className="inline-flex items-center gap-1">
                    {activity.provenance.dataStatus === 'live' ? '●' : activity.provenance.dataStatus === 'estimated' ? '≈' : '✕'}
                    {t('Status')}: <b>{activity.provenance.dataStatus}</b>
                  </span>
                </>
              )}
              {activity.cost?.estimateNote && (
                <span className="inline-flex items-center gap-1">
                  💰 {activity.cost.estimateNote}
                </span>
              )}
              {/* Price status line */}
              {activity.cost?.amount != null && (
                <span className={`inline-flex items-center gap-1 font-semibold ${
                  isPriceLive ? 'text-emerald-600 dark:text-emerald-400' :
                  isPriceEstimate ? 'text-amber-600 dark:text-amber-400' :
                  'text-slate-500 dark:text-slate-400'
                }`}>
                  {isPriceLive && '●'}
                  {isPriceEstimate && '≈'}
                  {isPriceUnavailable && '✕'}
                  {isPriceLive && ` ${t('Live price')}`}
                  {isPriceEstimate && ` ${t('Estimated price')}`}
                  {!isPriceLive && !isPriceEstimate && !isPriceUnavailable && ` ${t('Price')}`}
                </span>
              )}
              {isPriceUnavailable && activity.cost?.amount == null && (
                <span className="inline-flex items-center gap-1 font-semibold text-rose-500 dark:text-rose-400">
                  ✕ {t('Price unavailable')}
                </span>
              )}
            </div>
          </div>
        )}

        {activity.description && (
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{activity.description}</p>
        )}
        {(activity.address || activity.bookingUrl || activity.travel?.durationMin > 0 || activity.travel?.distanceKm > 0) && (
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
            {activity.address && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3 w-3" /> {activity.address}
              </span>
            )}
            {(activity.travel?.distanceKm > 0 || activity.travel?.durationMin > 0) && (
              <DistanceBadge
                distanceKm={activity.travel?.distanceKm}
                durationMin={activity.travel?.durationMin}
                travelMode={activity.travel?.method}
                isEstimate={activity.travel?.isEstimate}
              />
            )}
            {activity.bookingUrl && (
              <a href={activity.bookingUrl} target="_blank" rel="noreferrer" className="font-semibold text-brand-600 hover:underline dark:text-brand-400">
                {t('Book / source')}
              </a>
            )}
          </div>
        )}
      </div>
      <div className="shrink-0 text-right">
        <PriceBadge
          amount={activity.cost?.amount}
          priceType={activity.priceType || costStatus}
          currency={currency}
          showLabel={true}
          size="sm"
        />
        {activity.cost?.perPerson > 0 && activity.cost?.amount !== activity.cost?.perPerson && (
          <p className="text-[10px] text-slate-400">≈ {formatCurrency(activity.cost.perPerson, currency)}{t('/person')}</p>
        )}
      </div>
    </motion.div>
  );
}

const BREAKDOWN_KEYS = ['accommodation', 'breakfast', 'lunch', 'dinner', 'transport', 'activities', 'evening', 'night'];

const BREAKDOWN_LABEL_KEY = {
  accommodation: 'Accommodation',
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  transport: 'Transport',
  activities: 'Activities',
  evening: 'Evening',
  night: 'Night activity',
};

function DayCostBreakdown({ breakdown, currency }) {
  const { t } = useI18n();
  if (!breakdown || typeof breakdown.dayTotal !== 'number') return null;
  const rows = BREAKDOWN_KEYS.filter((k) => breakdown[k] > 0);
  return (
    <div className="border-t border-slate-100 bg-slate-50/60 px-5 py-4 dark:border-slate-800 dark:bg-slate-900/40">
      <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">
        <Wallet className="h-3.5 w-3.5" /> {t('Day cost breakdown')}
      </p>
      <div className="mt-2.5 grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3">
        {rows.map((k) => (
          <div key={k} className="flex items-baseline justify-between gap-2 text-xs">
            <span className="text-slate-500 dark:text-slate-400">{t(BREAKDOWN_LABEL_KEY[k])}</span>
            <span className="font-bold text-slate-800 dark:text-slate-100">{formatCurrency(breakdown[k], currency)}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 border-t border-slate-200/70 pt-3 dark:border-slate-700/70 sm:grid-cols-4">
        <div>
          <p className="text-[10px] font-semibold uppercase text-slate-400">{t('Day total')}</p>
          <p className="text-sm font-extrabold text-slate-900 dark:text-white">{formatCurrency(breakdown.dayTotal, currency)}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase text-slate-400">{t('Per person')}</p>
          <p className="text-sm font-extrabold text-slate-900 dark:text-white">{formatCurrency(breakdown.perPerson, currency)}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase text-slate-400">{t('Cumulative')}</p>
          <p className="text-sm font-extrabold text-slate-900 dark:text-white">{formatCurrency(breakdown.cumulative, currency)}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase text-slate-400">{t('Remaining budget')}</p>
          <p className={`text-sm font-extrabold ${breakdown.remainingBudget >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
            {breakdown.remainingBudget >= 0
              ? formatCurrency(breakdown.remainingBudget, currency)
              : `${t('Over budget by')} ${formatCurrency(Math.abs(breakdown.remainingBudget), currency)}`
            }
          </p>
        </div>
      </div>
    </div>
  );
}

/** Derive a theme label from a day's activity categories and types. */
function deriveDayTheme(activities = []) {
  const cats = new Set();
  const types = [];
  for (const a of activities) {
    cats.add(a.category);
    if (Array.isArray(a.description)) types.push(...a.description);
    if (typeof a.title === 'string') types.push(a.title.toLowerCase());
  }
  const all = types.join(' ');

  const heritage = /heritage|monument|fort|palace|museum|temple|church|mosque|gurudwara|histor/i.test(all) || cats.has('attraction');
  const waterfront = /waterfront|beach|harbor|harbour|pier|promenade|seafront|marine|coast/i.test(all);
  const nature = /park|garden|lake|hill|viewpoint|nature|botanical|sanctuary/i.test(all);
  const adventure = /adventure|trek|safari|rafting|paragliding|bungee|zip/i.test(all);
  const culture = /art|gallery|theatre|theater|performance|festival|local culture/i.test(all);
  const food = /food|cuisine|culinary|street food|market|bazaar/i.test(all) || cats.has('restaurant');
  const shopping = /shopping|mall|bazaar|market|souk/i.test(all);

  const parts = [];
  if (heritage) parts.push('Heritage');
  if (waterfront) parts.push('Waterfront');
  if (nature) parts.push('Nature');
  if (adventure) parts.push('Adventure');
  if (culture) parts.push('Culture');
  if (food) parts.push('Dining');
  if (shopping) parts.push('Shopping');

  return parts.length ? parts.join(' & ') : '';
}

/** Weather condition emoji. */
function weatherEmoji(condition = '', rainProbability) {
  const c = condition.toLowerCase();
  if (/rain|drizzle|shower|thunder/.test(c) || (rainProbability != null && rainProbability >= 60)) return '🌧';
  if (/cloud|overcast|grey|gray/.test(c)) return '☁️';
  if (/snow|sleet|blizzard|ice/.test(c)) return '❄️';
  if (/storm|thunder/.test(c)) return '⛈';
  if (/fog|haze|mist/.test(c)) return '🌫';
  return '☀️';
}

export default function ItineraryTimeline({ days = [], currency = 'INR' }) {
  const { t } = useI18n();

  // Frontend safety check: detect duplicates across days (dev-mode warnings only)
  useEffect(() => {
    if (days.length > 0) {
      logItineraryWarnings(days);
    }
  }, [days]);

  if (!days.length) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-dashed border-slate-300 p-6 text-sm text-slate-500 dark:border-slate-700">
        <AlertTriangle className="h-5 w-5 text-amber-500" />
        {t('No itinerary generated yet.')}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {days.map((day) => {
        // Compute summary counts from activities
        const acts = day.activities || [];
        const placeCount = acts.filter((a) => a.category === 'attraction' || a.category === 'activity').length;
        const mealCount = acts.filter((a) => a.category === 'restaurant').length;
        const hotelCount = acts.filter((a) => a.category === 'hotel').length;
        const theme = day.theme || deriveDayTheme(acts);
        const w = day.weather || {};
        const weatherLabel = w.condition || '';
        const rainNote = w.rainProbability > 50 ? ' · Rain expected' : w.indoorPlan ? ' · Indoor plan' : '';

        return (
        <div key={day.dayNumber} className="card overflow-hidden">
          {/* ── Day Header ── */}
          <div className="border-b border-slate-100 bg-gradient-to-r from-brand-50/80 to-transparent px-5 py-4 dark:border-slate-800 dark:from-brand-950/40">
            {/* Row 1: Day number + Area + Date */}
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-sm font-extrabold text-white">
                  {day.dayNumber}
                </span>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-brand-600 dark:text-brand-400">
                    {t('Day')} {day.dayNumber}
                  </p>
                  {day.area && (
                    <p className="text-base font-bold text-slate-900 dark:text-white">
                      {day.area}
                    </p>
                  )}
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {formatDateHeader(day.date) || formatDateShort(day.date)}
                  </p>
                </div>
              </div>
            </div>

            {/* Row 2: Theme (if available) */}
            {theme && (
              <p className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700 dark:bg-brand-950/60 dark:text-brand-300">
                {theme}
              </p>
            )}

            {/* Row 3: Weather · Cost · Counts */}
            <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-600 dark:text-slate-300">
              {weatherLabel && (
                <span className="inline-flex items-center gap-1">
                  {weatherEmoji(weatherLabel, w.rainProbability)}
                  {w.tempMax != null && `${Math.round(w.tempMax)}°C`}
                  {weatherLabel}{rainNote}
                </span>
              )}
              <span className="inline-flex items-center gap-1 font-semibold">
                💰 {formatCurrency(day.dayCost, currency)}
              </span>
              <span className="inline-flex items-center gap-1 text-slate-500 dark:text-slate-400">
                📍 {placeCount} {t('places')} · {mealCount} {t('meals')} · {hotelCount} {t('hotels')}
              </span>
            </div>
          </div>

          {day.overnight && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-100 bg-indigo-50/50 px-5 py-2.5 text-xs dark:border-slate-800 dark:bg-indigo-950/20">
              <span className="inline-flex items-center gap-1.5 font-bold text-indigo-700 dark:text-indigo-300">
                <Moon className="h-3.5 w-3.5" /> {t('Overnight')}: {day.overnight.name}
              </span>
              {day.overnight.area && <span className="text-slate-500 dark:text-slate-400">· {day.overnight.area}</span>}
              {/* Hotel data status */}
              {day.overnight.isLive ? (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">● {t('live')}</span>
              ) : day.overnight.name ? (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-700 dark:bg-amber-950 dark:text-amber-300">≈ {t('estimated')}</span>
              ) : (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">● {t('planned')}</span>
              )}
              {/* Provider info */}
              {day.overnight.provider && (
                <span className="text-slate-500 dark:text-slate-400">· {day.overnight.provider}</span>
              )}
              {day.overnight.pricePerRoomNight > 0 && (
                <span className="text-slate-500 dark:text-slate-400">
                  · {formatCurrency(day.overnight.pricePerRoomNight, currency)}{t('/room/night')} × {day.overnight.rooms} {t('room(s)')}
                  {day.overnight.nights > 0 ? ` × ${day.overnight.nights} ${t('night(s)')}` : ''} ={' '}
                  <b className="text-slate-800 dark:text-slate-100">{formatCurrency(day.overnight.total, currency)}</b>
                </span>
              )}
              {day.overnight.pricePerRoomNight == null && day.overnight.name && (
                <span className="text-slate-400 dark:text-slate-500">· {t('Book separately')}</span>
              )}
            </div>
          )}

          <div className="divide-y divide-slate-100 dark:divide-slate-800/70">
            {day.activities.map((activity, i) => (
              <ActivityRow key={activity._id || i} activity={activity} currency={currency} />
            ))}
          </div>

          <DayCostBreakdown breakdown={day.costBreakdown} currency={currency} />
        </div>
        );
      })}
    </div>
  );
}
