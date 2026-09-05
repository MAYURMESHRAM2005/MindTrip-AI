import { useEffect, useState } from 'react';

/**
 * Returns `value` after `delay` ms of no changes.
 *
 * Shared by all autocomplete inputs (PlaceAutocomplete, GlobalSearch) so the
 * debounce behaviour stays identical everywhere: typing fires exactly one
 * backend request per pause, never one per keystroke.
 *
 * @param {string} value - the raw (possibly trailing-space) input value
 * @param {number} [delay=400] - debounce delay in ms
 * @returns {string} trimmed value, updated only after the delay elapses
 */
export default function useDebouncedValue(value, delay = 400) {
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebounced((value || '').trim()), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}