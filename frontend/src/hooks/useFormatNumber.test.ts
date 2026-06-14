import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// Mock useLocale so intlLocale is deterministic across CI environments.
// We exercise the real Intl.NumberFormat against a fixed 'en-US' locale.
const intlLocaleRef = { value: 'en-US' };
vi.mock('./useLocale', () => ({
  useLocale: () => ({ intlLocale: intlLocaleRef.value }),
}));

import { useFormatNumber } from './useFormatNumber';

/**
 * useFormatNumber exposes four formatters. The real logic lives in the
 * conditional paths: formatPercent/formatNumber branch on whether
 * caller-supplied options/decimals are present (cached formatter vs a
 * fresh one), and formatDecimal defaults to 2 fraction digits. We assert
 * concrete en-US output so a regression in the option plumbing fails.
 */
describe('useFormatNumber (en-US)', () => {
  beforeEach(() => {
    intlLocaleRef.value = 'en-US';
  });

  it('formatNumber uses the cached decimal formatter (grouping separators)', () => {
    const { result } = renderHook(() => useFormatNumber());
    expect(result.current.formatNumber(1234567.89)).toBe('1,234,567.89');
  });

  it('formatNumber honours explicit Intl options over the cached formatter', () => {
    const { result } = renderHook(() => useFormatNumber());
    expect(
      result.current.formatNumber(5, {
        minimumIntegerDigits: 3,
      }),
    ).toBe('005');
  });

  it('formatPercent without decimals uses 0..2 fraction digits', () => {
    const { result } = renderHook(() => useFormatNumber());
    // 0.75 -> 75% (no trailing zeros), 0.1234 -> 12.34%
    expect(result.current.formatPercent(0.75)).toBe('75%');
    expect(result.current.formatPercent(0.1234)).toBe('12.34%');
  });

  it('formatPercent with an explicit decimal count pins the fraction digits', () => {
    const { result } = renderHook(() => useFormatNumber());
    expect(result.current.formatPercent(0.5, 2)).toBe('50.00%');
  });

  it('formatCompact uses short compact notation', () => {
    const { result } = renderHook(() => useFormatNumber());
    expect(result.current.formatCompact(1234)).toBe('1.2K');
    expect(result.current.formatCompact(2_500_000)).toBe('2.5M');
  });

  it('formatDecimal defaults to exactly 2 fraction digits', () => {
    const { result } = renderHook(() => useFormatNumber());
    expect(result.current.formatDecimal(3)).toBe('3.00');
  });

  it('formatDecimal respects a custom decimal count', () => {
    const { result } = renderHook(() => useFormatNumber());
    expect(result.current.formatDecimal(3.14159, 3)).toBe('3.142');
  });

  it('switches separators when the locale changes (Turkish grouping)', () => {
    intlLocaleRef.value = 'tr-TR';
    const { result } = renderHook(() => useFormatNumber());
    // tr-TR uses '.' for thousands and ',' for the decimal point.
    expect(result.current.formatNumber(1234.56)).toBe('1.234,56');
  });
});
