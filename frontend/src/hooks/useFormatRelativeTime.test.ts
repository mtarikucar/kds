import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// Drive the Intl fallback path by reporting NO date-fns locale loaded.
// useRelativeTimeFormat stays real so the unit-selection cascade in
// formatWithIntl is exercised against a real Intl.RelativeTimeFormat.
const dateFnsLocaleRef: { value: undefined } = { value: undefined };
vi.mock('./useLocale', () => ({
  useLocale: () => ({
    dateFnsLocale: dateFnsLocaleRef.value,
    intlLocale: 'en-US',
  }),
  useRelativeTimeFormat: () =>
    new Intl.RelativeTimeFormat('en-US', { numeric: 'auto', style: 'long' }),
}));

import { useFormatRelativeTime } from './useFormatRelativeTime';

/**
 * The interesting logic is formatWithIntl: it picks the coarsest unit whose
 * magnitude is below the next threshold (seconds<60, minutes<60, hours<24,
 * days<7, weeks<4, months<12, else years). With date-fns absent, these
 * thresholds decide whether "5 minutes ago" or "in 2 days" renders. We pin
 * a date relative to a fixed base via formatRelative to avoid clock flake.
 */
describe('useFormatRelativeTime (Intl fallback, en-US)', () => {
  const base = new Date('2026-06-14T12:00:00.000Z');

  beforeEach(() => {
    dateFnsLocaleRef.value = undefined;
  });

  function rel(target: Date) {
    const { result } = renderHook(() => useFormatRelativeTime());
    return result.current.formatRelative(target, base);
  }

  it('uses seconds for a sub-minute delta', () => {
    expect(rel(new Date(base.getTime() - 30_000))).toBe('30 seconds ago');
  });

  it('uses minutes between 1 and 59 minutes', () => {
    expect(rel(new Date(base.getTime() - 5 * 60_000))).toBe('5 minutes ago');
  });

  it('uses hours below a day', () => {
    expect(rel(new Date(base.getTime() - 3 * 3600_000))).toBe('3 hours ago');
  });

  it('uses days below a week', () => {
    expect(rel(new Date(base.getTime() - 2 * 86_400_000))).toBe('2 days ago');
  });

  it('uses weeks below a month boundary', () => {
    expect(rel(new Date(base.getTime() - 14 * 86_400_000))).toBe('2 weeks ago');
  });

  it('renders future deltas with the forward suffix', () => {
    expect(rel(new Date(base.getTime() + 2 * 86_400_000))).toBe('in 2 days');
  });

  it('formatRelativeIntl passes value+unit straight to Intl', () => {
    const { result } = renderHook(() => useFormatRelativeTime());
    expect(result.current.formatRelativeIntl(-1, 'day')).toBe('yesterday');
    expect(result.current.formatRelativeIntl(3, 'month')).toBe('in 3 months');
  });

  it('accepts a numeric timestamp as the target', () => {
    const { result } = renderHook(() => useFormatRelativeTime());
    const out = result.current.formatRelative(base.getTime() - 60_000, base);
    expect(out).toBe('1 minute ago');
  });
});
