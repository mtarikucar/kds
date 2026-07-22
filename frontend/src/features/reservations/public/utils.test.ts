import { describe, it, expect, afterEach } from 'vitest';
import i18next from 'i18next';
import { formatReservationDate, formatTime, formatTimeRange } from './utils';

describe('formatReservationDate', () => {
  it('handles a date-only string (YYYY-MM-DD)', () => {
    const out = formatReservationDate('2026-03-01');
    expect(out).not.toContain('Invalid Date');
    expect(out.length).toBeGreaterThan(0);
  });

  it('handles a full ISO datetime (Prisma @db.Date serialization)', () => {
    const out = formatReservationDate('2026-03-01T00:00:00.000Z');
    expect(out).not.toContain('Invalid Date');
    expect(out.length).toBeGreaterThan(0);
  });

  it('handles a tz-offset ISO datetime', () => {
    const out = formatReservationDate('2026-03-01T19:00:00+03:00');
    expect(out).not.toContain('Invalid Date');
    expect(out.length).toBeGreaterThan(0);
  });

  it('returns the input unchanged on truly malformed strings (no "Invalid Date" rendered)', () => {
    const out = formatReservationDate('not a date');
    expect(out).toBe('not a date');
  });

  it('returns empty string for null / undefined / empty', () => {
    expect(formatReservationDate(null)).toBe('');
    expect(formatReservationDate(undefined)).toBe('');
    expect(formatReservationDate('')).toBe('');
  });

  describe('localizes against the active i18n language (not the browser locale)', () => {
    const original = i18next.language;
    afterEach(() => {
      i18next.language = original;
    });

    it('produces different weekday/month names for tr vs en for the same date', () => {
      i18next.language = 'en';
      const en = formatReservationDate('2026-03-01');
      i18next.language = 'tr';
      const tr = formatReservationDate('2026-03-01');
      expect(en).not.toBe(tr);
      // English "March" vs Turkish "Mart"/"Pazar" — the switch changed the
      // rendered locale, proving i18next.language drives the output.
      expect(en.toLowerCase()).toContain('march');
      expect(tr.toLowerCase()).not.toContain('march');
    });
  });
});

describe('formatTime (24h)', () => {
  it('renders 14:30 as "14:30"', () => {
    expect(formatTime('14:30')).toBe('14:30');
  });

  it('zero-pads a single-digit hour: 9:00 -> "09:00"', () => {
    expect(formatTime('9:00')).toBe('09:00');
    expect(formatTime('09:00')).toBe('09:00');
  });

  it('renders midnight as "00:00" (not 12h AM)', () => {
    expect(formatTime('00:00')).toBe('00:00');
  });

  it('renders 23:30 as "23:30"', () => {
    expect(formatTime('23:30')).toBe('23:30');
  });

  it('returns malformed input unchanged (no NaN:undefined)', () => {
    expect(formatTime('xxx')).toBe('xxx');
    expect(formatTime('25:00')).toBe('25:00');
    expect(formatTime('12:99')).toBe('12:99');
  });

  it('returns empty for null/undefined/empty', () => {
    expect(formatTime(null)).toBe('');
    expect(formatTime(undefined)).toBe('');
    expect(formatTime('')).toBe('');
  });
});

describe('formatTimeRange (24h)', () => {
  it('joins start and end with em-dash', () => {
    expect(formatTimeRange('14:30', '16:00')).toBe('14:30 — 16:00');
  });

  it('falls back to start only when end missing', () => {
    expect(formatTimeRange('14:30')).toBe('14:30');
    expect(formatTimeRange('14:30', null)).toBe('14:30');
    expect(formatTimeRange('14:30', '')).toBe('14:30');
  });
});
