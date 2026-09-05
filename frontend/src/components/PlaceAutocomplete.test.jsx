import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PlaceAutocomplete from './PlaceAutocomplete';
import { I18nProvider } from '../utils/i18n';
import { mapsApi } from '../services/apiClient';

vi.mock('../services/apiClient', () => ({
  mapsApi: {
    autocomplete: vi.fn(),
  },
}));

const autocompleteMock = vi.mocked(mapsApi.autocomplete);

/** Stateful wrapper — the real pages hold the value in state, so the test
 * must too, otherwise the controlled input never changes. */
function TestHarness() {
  const [value, setValue] = useState('');
  return (
    <PlaceAutocomplete label="Destination" value={value} onChange={setValue} />
  );
}

function renderSearch() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <TestHarness />
      </I18nProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  autocompleteMock.mockReset();
  autocompleteMock.mockResolvedValue({ data: { data: { suggestions: [], isLive: true } } });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('PlaceAutocomplete request behaviour', () => {
  it('does not fire any request below the minimum character count', async () => {
    renderSearch();
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);

    fireEvent.change(input, { target: { value: 'g' } });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(autocompleteMock).not.toHaveBeenCalled();
  });

  it('fires exactly one request after a pause, even when typing quickly', async () => {
    renderSearch();
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);

    // Rapid typing: each keystroke re-renders with a new value, but the
    // 400ms debounce collapses them into a single request for the last value.
    for (const v of ['n', 'na', 'nag', 'nagp', 'nagpu']) {
      fireEvent.change(input, { target: { value: v } });
      await act(async () => vi.advanceTimersByTime(150));
    }
    await act(async () => vi.advanceTimersByTime(400));

    expect(autocompleteMock).toHaveBeenCalledTimes(1);
    const [params] = autocompleteMock.mock.calls[0];
    expect(params.q).toBe('nagpu');
  });

  it('does not re-query the same term while react-query serves it fresh (dedup)', async () => {
    autocompleteMock.mockResolvedValue({
      data: {
        data: {
          suggestions: [{ placeId: 'ChIJNagpur', name: 'Nagpur', formatted: 'Nagpur, Maharashtra, India' }],
          isLive: true,
        },
      },
    });

    renderSearch();
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);

    fireEvent.change(input, { target: { value: 'Nagpur' } });
    await act(async () => vi.advanceTimersByTime(400));
    expect(autocompleteMock).toHaveBeenCalledTimes(1);

    // Same value again — staleTime 60s means react-query serves the cache.
    fireEvent.change(input, { target: { value: 'Nagpur' } });
    await act(async () => vi.advanceTimersByTime(400));
    expect(autocompleteMock).toHaveBeenCalledTimes(1);
  });

  it('passes an AbortSignal so superseded requests can be cancelled', async () => {
    renderSearch();
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);

    fireEvent.change(input, { target: { value: 'mumbai' } });
    await act(async () => vi.advanceTimersByTime(400));

    expect(autocompleteMock).toHaveBeenCalledTimes(1);
    const [, options] = autocompleteMock.mock.calls[0];
    expect(options?.signal instanceof AbortSignal).toBe(true);
  });
});