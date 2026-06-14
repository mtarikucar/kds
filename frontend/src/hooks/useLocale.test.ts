import { describe, it, expect } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import i18next from 'i18next';
import {
  useLocale,
  useNumberFormat,
  useDateTimeFormat,
  useRelativeTimeFormat,
} from './useLocale';

// The test harness (src/test/setup.ts) bootstraps i18next with lng='en',
// so useLocale resolves against the real localeMap 'en' entry.
describe('useLocale', () => {
  it('reports the active language and its Intl locale', () => {
    const { result } = renderHook(() => useLocale());
    expect(result.current.language).toBe('en');
    expect(result.current.intlLocale).toBe('en-US');
    expect(result.current.isRTL).toBe(false);
    expect(result.current.defaultCurrency).toBe('USD');
  });

  it('loads the date-fns locale asynchronously', async () => {
    const { result } = renderHook(() => useLocale());
    expect(result.current.dateFnsLocale).toBeUndefined();
    await waitFor(() =>
      expect(result.current.dateFnsLocale).toBeDefined(),
    );
  });

  it('reacts to a language change', async () => {
    await act(async () => {
      await i18next.changeLanguage('tr');
    });
    const { result } = renderHook(() => useLocale());
    expect(result.current.language).toBe('tr');
    expect(result.current.intlLocale).toBe('tr-TR');
    expect(result.current.defaultCurrency).toBe('TRY');
    await act(async () => {
      await i18next.changeLanguage('en');
    });
  });
});

describe('useNumberFormat', () => {
  it('returns an Intl.NumberFormat bound to the active locale', () => {
    const { result } = renderHook(() =>
      useNumberFormat({ minimumFractionDigits: 2 }),
    );
    expect(result.current.format(1234.5)).toBe('1,234.50');
  });
});

describe('useDateTimeFormat', () => {
  it('returns an Intl.DateTimeFormat bound to the active locale', () => {
    const { result } = renderHook(() =>
      useDateTimeFormat({ year: 'numeric', month: '2-digit', day: '2-digit' }),
    );
    const out = result.current.format(new Date(Date.UTC(2024, 0, 5)));
    // en-US is M/D/Y ordering
    expect(out).toMatch(/01\/0[45]\/2024/);
  });
});

describe('useRelativeTimeFormat', () => {
  it('defaults to numeric:auto so -1 day reads as "yesterday"', () => {
    const { result } = renderHook(() => useRelativeTimeFormat());
    expect(result.current.format(-1, 'day')).toBe('yesterday');
  });
});
