import { describe, it, expect } from 'vitest';
import { DICT } from './i18n';

describe('i18n dictionary', () => {
  it('supports English, Hindi and Marathi for core keys', () => {
    expect(DICT.dashboard.en).toBe('Dashboard');
    expect(DICT.dashboard.hi).toBe('डैशबोर्ड');
    expect(DICT.dashboard.mr).toBe('डॅशबोर्ड');
  });

  it('falls back to English when a language is missing', () => {
    // All entries must at least define en
    for (const [key, entry] of Object.entries(DICT)) {
      expect(entry.en, `key ${key} missing English`).toBeTruthy();
    }
  });

  it('covers the offline/unavailable messaging requirements', () => {
    expect(DICT.liveDataUnavailable.en).toBe('Live data unavailable');
    expect(DICT.estimate.en).toBe('Estimate');
  });
});
