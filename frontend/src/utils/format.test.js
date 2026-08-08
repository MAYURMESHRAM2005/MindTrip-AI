import { describe, it, expect } from 'vitest';
import { formatCurrency, formatDate, daysBetween, initials, cn, toQueryString, todayISO } from './format';

describe('formatCurrency', () => {
  it('formats INR amounts', () => {
    expect(formatCurrency(50000, 'INR')).toMatch(/₹/);
    expect(formatCurrency(50000, 'INR')).toContain('50,000');
  });
  it('handles null and undefined', () => {
    expect(formatCurrency(null)).toBe('—');
    expect(formatCurrency(undefined)).toBe('—');
    expect(formatCurrency(NaN)).toBe('—');
  });
});

describe('todayISO', () => {
  it('returns today as YYYY-MM-DD in local time', () => {
    const value = todayISO();
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const d = new Date(value);
    expect(Number.isNaN(d.getTime())).toBe(false);
  });
});

describe('formatDate', () => {
  it('formats valid dates', () => {
    expect(formatDate('2026-01-10')).not.toBe('—');
  });
  it('returns dash for invalid input', () => {
    expect(formatDate('')).toBe('—');
    expect(formatDate('not-a-date')).toBe('—');
  });
});

describe('daysBetween', () => {
  it('counts inclusive days', () => {
    expect(daysBetween('2026-01-10', '2026-01-14')).toBe(5);
    expect(daysBetween('2026-01-10', '2026-01-10')).toBe(1);
  });
  it('handles invalid dates', () => {
    expect(daysBetween('bad', '2026-01-14')).toBe(0);
  });
});

describe('initials', () => {
  it('produces up to two initials', () => {
    expect(initials('Aarav Sharma')).toBe('AS');
    expect(initials('Buffy')).toBe('B');
    expect(initials('')).toBe('?');
  });
});

describe('cn', () => {
  it('joins truthy classes', () => {
    expect(cn('a', '', false && 'b', 'c')).toBe('a c');
  });
});

describe('toQueryString', () => {
  it('skips empty values', () => {
    expect(toQueryString({ a: 1, b: '', c: null, d: undefined })).toBe('?a=1');
  });
  it('returns empty string when nothing', () => {
    expect(toQueryString({ a: '' })).toBe('');
  });
});
