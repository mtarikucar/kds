import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { enUS } from 'date-fns/locale';

// Control which branch (date-fns vs Intl fallback) runs by toggling whether
// useLocale reports a loaded date-fns locale. useDateTimeFormat stays real so
// the Intl fallback formats against the fixed 'en-US' locale deterministically.
const localeState: { dateFns: typeof enUS | undefined } = { dateFns: enUS };
vi.mock('./useLocale', () => ({
  useLocale: () => ({
    dateFnsLocale: localeState.dateFns,
    intlLocale: 'en-US',
  }),
  useDateTimeFormat: (options?: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-US', options),
}));

import { useFormatDate } from './useFormatDate';

/**
 * useFormatDate's branches: (a) date-fns pattern when its locale is loaded,
 * (b) Intl fallback while it's still loading, (c) Intl fallback when a bad
 * date-fns pattern throws, and (d) formatDateIntl bypassing date-fns. We use
 * UTC-noon to dodge timezone day-rollover and assert concrete strings.
 */
describe('useFormatDate', () => {
  const d = new Date('2026-12-24T12:00:00.000Z');

  beforeEach(() => {
    localeState.dateFns = enUS;
  });

  it('formats with a custom date-fns pattern when the locale is loaded', () => {
    const { result } = renderHook(() => useFormatDate());
    expect(result.current.formatDate(d, 'yyyy-MM-dd')).toBe('2026-12-24');
  });

  it('formatTime uses the date-fns short time token', () => {
    const { result } = renderHook(() => useFormatDate());
    // 'p' -> localized short time; en-US uses 12-hour with AM/PM.
    expect(result.current.formatTime(d)).toMatch(/\d{1,2}:\d{2}\s?(AM|PM)/i);
  });

  it('falls back to the Intl long-date formatter when date-fns is not loaded', () => {
    localeState.dateFns = undefined;
    const { result } = renderHook(() => useFormatDate());
    // year/month-long/day Intl formatter -> "December 24, 2026"
    expect(result.current.formatDate(d)).toBe('December 24, 2026');
  });

  it('falls back to Intl when the date-fns pattern string is invalid', () => {
    localeState.dateFns = enUS;
    const { result } = renderHook(() => useFormatDate());
    // An unescaped literal token makes date-fns throw -> Intl long-date.
    expect(result.current.formatDate(d, 'qqqqq-invalid-XXX-zzzz')).toContain(
      '2026',
    );
  });

  it('coerces an ISO string input to a Date before formatting', () => {
    const { result } = renderHook(() => useFormatDate());
    expect(result.current.formatDate('2026-12-24T12:00:00.000Z', 'yyyy-MM-dd')).toBe(
      '2026-12-24',
    );
  });

  it('formatDateIntl uses pure Intl with caller options regardless of date-fns', () => {
    const { result } = renderHook(() => useFormatDate());
    expect(
      result.current.formatDateIntl(d, { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC' }),
    ).toBe('12/24/2026');
  });
});
