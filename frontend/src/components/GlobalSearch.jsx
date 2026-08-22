import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Search, MapPin, Loader2, Compass, Plane, Hotel, UtensilsCrossed,
  CloudSun, Map as MapIcon, CornerDownLeft,
} from 'lucide-react';
import { mapsApi } from '../services/apiClient';
import { cn } from '../utils/format';
import { useI18n } from '../utils/i18n';

/**
 * Global search in the topbar — "Search destinations, hotels, flights…".
 *
 * Debounces typing, queries the backend /maps/autocomplete endpoint (Geoapify)
 * and shows matching places. Every suggestion can be jumped into with a
 * quick action (plan a trip, flights, hotels, restaurants, weather, maps);
 * those pages read the value from their URL query param on mount.
 *
 * Keyboard: ↑/↓ navigate suggestions, Enter runs the highlighted action
 * (or the default "plan a trip" when no suggestion is highlighted), Esc closes.
 */
const QUICK_ACTIONS = [
  { key: 'planTrip', labelKey: 'Plan a trip', icon: Compass, path: (q) => `/planner?destination=${encodeURIComponent(q)}` },
  { key: 'flights', labelKey: 'Flights', icon: Plane, path: (q) => `/flights?to=${encodeURIComponent(q)}` },
  { key: 'hotels', labelKey: 'Hotels', icon: Hotel, path: (q) => `/hotels?city=${encodeURIComponent(q)}` },
  { key: 'restaurants', labelKey: 'Restaurants', icon: UtensilsCrossed, path: (q) => `/restaurants?city=${encodeURIComponent(q)}` },
  { key: 'weather', labelKey: 'Weather', icon: CloudSun, path: (q) => `/weather?city=${encodeURIComponent(q)}` },
  { key: 'maps', labelKey: 'Map', icon: MapIcon, path: (q) => `/maps?destination=${encodeURIComponent(q)}` },
];

function placeName(s) {
  return s?.name || s?.formatted || '';
}

function placeSubtitle(s) {
  return s?.formatted || [s?.city, s?.state, s?.country].filter(Boolean).join(', ');
}

export default function GlobalSearch({ className, autoFocus = false, onNavigated }) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const blurTimer = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => () => clearTimeout(blurTimer.current), []);

  const { data, isFetching } = useQuery({
    queryKey: ['global-search', debounced],
    queryFn: () => mapsApi.autocomplete({ q: debounced, limit: 6 }).then((r) => r.data.data),
    enabled: debounced.length >= 2,
    staleTime: 60_000,
  });

  const suggestions = data?.isLive ? data.suggestions || [] : [];
  const showDropdown = open && debounced.length >= 2;

  const go = (path) => {
    navigate(path);
    setOpen(false);
    setQuery('');
    setDebounced('');
    setHighlight(-1);
    onNavigated?.();
  };

  const jump = (action, place) => go(action.path(placeName(place) || query.trim()));

  const handleKeyDown = (e) => {
    if (showDropdown && suggestions.length) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlight((h) => (h + 1) % suggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === 'Escape') {
        setOpen(false);
        setHighlight(-1);
        return;
      }
      if (e.key === 'Enter' && highlight >= 0) {
        e.preventDefault();
        const place = suggestions[highlight];
        // Enter on a suggestion defaults to planning a trip to that place.
        jump(QUICK_ACTIONS[0], place);
        return;
      }
    }
    if (e.key === 'Enter' && query.trim()) {
      e.preventDefault();
      jump(QUICK_ACTIONS[0], { name: query.trim() });
    }
  };

  return (
    <div className={cn('relative', className)}>
      <div className="flex items-center gap-2.5 rounded-full bg-[#f0f3f8] px-4 py-2.5 text-sm text-[#70757a] transition-all duration-150 hover:bg-[#e9edf5] focus-within:bg-white focus-within:shadow-soft focus-within:ring-2 focus-within:ring-brand-400/50 dark:bg-slate-800/80 dark:text-slate-400 dark:hover:bg-slate-800 dark:focus-within:bg-slate-900">
        <Search className="h-4 w-4 shrink-0" />
        <input
          className="w-full bg-transparent text-sm font-medium text-slate-700 outline-none placeholder:text-[#70757a] dark:text-slate-200 dark:placeholder:text-slate-400"
          placeholder={t('Search destinations, hotels, flights…')}
          value={query}
          autoFocus={autoFocus}
          autoComplete="off"
          role="combobox"
          aria-expanded={showDropdown}
          aria-haspopup="listbox"
          onChange={(e) => {
            setHighlight(-1);
            setQuery(e.target.value);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            clearTimeout(blurTimer.current);
            blurTimer.current = setTimeout(() => {
              setOpen(false);
              setHighlight(-1);
            }, 150);
          }}
          onKeyDown={handleKeyDown}
        />
        {isFetching && <Loader2 className="h-4 w-4 shrink-0 animate-spin" />}
      </div>

      {showDropdown && (
        <div
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card dark:border-slate-700 dark:bg-slate-900"
        >
          {isFetching ? (
            <p className="flex items-center gap-2 px-3.5 py-3 text-xs text-slate-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('Searching places…')}
            </p>
          ) : suggestions.length === 0 ? (
            <p className="px-3.5 py-3 text-xs text-slate-400">
              {t('No matching places. Press')} <kbd className="rounded bg-slate-200 px-1 font-mono text-[10px] dark:bg-slate-700">Enter</kbd> {t('to plan a trip to')} “{query.trim()}”.
            </p>
          ) : (
            <ul>
              {suggestions.map((s, i) => (
                <li key={s.placeId || i}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      jump(QUICK_ACTIONS[0], s);
                    }}
                    onMouseEnter={() => setHighlight(i)}
                    className={cn(
                      'flex w-full items-start gap-2.5 px-3.5 py-2.5 text-left transition-colors',
                      i === highlight && 'bg-slate-100 dark:bg-slate-800'
                    )}
                  >
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{placeName(s)}</span>
                      <span className="block truncate text-xs text-slate-400">{placeSubtitle(s)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {suggestions.length > 0 && (
            <>
              <div className="border-t border-slate-100 px-3.5 pb-1.5 pt-2.5 dark:border-slate-800">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  {highlight >= 0 && suggestions[highlight] ? `${t('Go to')} ${placeName(suggestions[highlight])}` : t('Jump to place')}
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1.5 pb-1">
                  {QUICK_ACTIONS.map((a) => {
                    const Icon = a.icon;
                    const active = highlight >= 0 && suggestions[highlight];
                    const place = active ? suggestions[highlight] : { name: query.trim() };
                    return (
                      <button
                        key={a.key}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          jump(a, place);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs font-bold text-slate-600 transition-colors hover:bg-brand-50 hover:text-brand-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-brand-950 dark:hover:text-brand-300"
                      >
                        <Icon className="h-3.5 w-3.5" /> {t(a.labelKey)}
                      </button>
                    );
                  })}
                </div>
              </div>
              <p className="flex items-center gap-1.5 border-t border-slate-100 px-3.5 py-2 text-[10px] text-slate-400 dark:border-slate-800">
                <CornerDownLeft className="h-3 w-3" /> {t('Enter plans a trip · ↑↓ to navigate · Esc to close')}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
