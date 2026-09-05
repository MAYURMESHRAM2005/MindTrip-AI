import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useDebouncedValue from './useDebouncedValue';

afterEach(() => {
  vi.useRealTimers();
});

describe('useDebouncedValue', () => {
  it('returns the trimmed value only after the delay elapses', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 400), {
      initialProps: { value: '' },
    });
    expect(result.current).toBe('');

    // Rapid typing: value changes many times, debounced value stays put.
    rerender({ value: 'g' });
    rerender({ value: 'go' });
    rerender({ value: 'goa' });
    act(() => vi.advanceTimersByTime(399));
    expect(result.current).toBe('');

    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe('goa');
  });

  it('restarts the timer on every keystroke (one output per pause, not per key)', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 400), {
      initialProps: { value: '' },
    });

    rerender({ value: 'n' });
    act(() => vi.advanceTimersByTime(300)); // mid-debounce
    rerender({ value: 'na' });
    act(() => vi.advanceTimersByTime(300)); // still mid-debounce
    rerender({ value: 'nag' });
    act(() => vi.advanceTimersByTime(300)); // still mid-debounce
    rerender({ value: 'nagp' });
    act(() => vi.advanceTimersByTime(400));
    expect(result.current).toBe('nagp');
  });

  it('trims surrounding whitespace', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 0), {
      initialProps: { value: '' },
    });
    rerender({ value: '  Goa  ' });
    act(() => vi.runAllTimers());
    expect(result.current).toBe('Goa');
  });
});