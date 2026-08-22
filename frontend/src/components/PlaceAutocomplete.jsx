import React, { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MapPin, Loader2 } from 'lucide-react';
import { mapsApi } from '../services/apiClient';
import { Field } from './ui/Input';
import { cn } from '../utils/format';
import { useI18n } from '../utils/i18n';

/**
 * City / place autocomplete input — "Nag" → suggests "Nagpur".
 *
 * Debounces typing, queries the backend /maps/autocomplete endpoint (Geoapify)
 * and shows a keyboard-navigable suggestions dropdown. Works both as a labelled
 * field (like <Input>) and bare (e.g. inside a <Field>).
 *
 * Props mirror <Input>: label, hint, placeholder, value, onChange(string),
 * plus optional onSelect(suggestion), disabled, minChars and an onKeyDown
 * passthrough that still fires when no suggestion is highlighted.
 */
export default function PlaceAutocomplete({
  label,
  hint,
  placeholder,
  value,
  onChange,
  onSelect,
  onKeyDown,
  disabled,
  minChars = 2,
  type = '',
  limit = 6,
  className,
  wrapperClassName,
  ...rest
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [debounced, setDebounced] = useState('');
  const blurTimer = useRef(null);

  // Debounce the input before hitting the backend.
  useEffect(() => {
    const t = setTimeout(() => setDebounced((value || '').trim()), 250);
    return () => clearTimeout(t);
  }, [value]);

  useEffect(() => () => clearTimeout(blurTimer.current), []);

  const { data, isFetching } = useQuery({
    queryKey: ['place-autocomplete', type, debounced],
    queryFn: () => mapsApi.autocomplete({ q: debounced, type, limit }).then((r) => r.data.data),
    enabled: debounced.length >= minChars,
    staleTime: 60_000,
  });

  const suggestions = data?.isLive ? data.suggestions || [] : [];

  const pick = (s) => {
    onChange(s.name || s.formatted || '');
    onSelect?.(s);
    setOpen(false);
    setHighlight(-1);
  };

  const handleKeyDown = (e) => {
    if (open && suggestions.length) {
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
        pick(suggestions[highlight]);
        return;
      }
    }
    onKeyDown?.(e);
  };

  const input = (
    <div className={cn('relative', wrapperClassName)}>
      <input
        className={cn('input', className)}
        placeholder={placeholder}
        value={value || ''}
        disabled={disabled}
        onChange={(e) => {
          setHighlight(-1);
          onChange(e.target.value);
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
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        {...rest}
      />
      {open && debounced.length >= minChars && (
        <div
          role="listbox"
          className="absolute z-30 mt-1 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card dark:border-slate-700 dark:bg-slate-900"
        >
          {isFetching ? (
            <p className="flex items-center gap-2 px-3.5 py-3 text-xs text-slate-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('Searching places…')}
            </p>
          ) : suggestions.length === 0 ? (
            <p className="px-3.5 py-3 text-xs text-slate-400">{t('No matching places. Keep typing or press Enter.')}</p>
          ) : (
            <ul>
              {suggestions.map((s, i) => (
                <li key={s.placeId || i}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pick(s);
                    }}
                    onMouseEnter={() => setHighlight(i)}
                    className={cn(
                      'flex w-full items-start gap-2.5 px-3.5 py-2.5 text-left transition-colors',
                      i === highlight && 'bg-slate-100 dark:bg-slate-800'
                    )}
                  >
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
                        {s.name}
                      </span>
                      <span className="block truncate text-xs text-slate-400">
                        {s.formatted || [s.city, s.state, s.country].filter(Boolean).join(', ')}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );

  if (!label) return input;
  return (
    <Field label={label} hint={hint}>
      {input}
    </Field>
  );
}
