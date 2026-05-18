import { describe, it, expect } from 'vitest';
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
});

describe('formatTime', () => {
  it('renders 14:30 as "2:30 PM"', () => {
    expect(formatTime('14:30')).toBe('2:30 PM');
  });

  it('renders 09:00 as "9:00 AM"', () => {
    expect(formatTime('09:00')).toBe('9:00 AM');
  });

  it('renders 00:00 as "12:00 AM"', () => {
    expect(formatTime('00:00')).toBe('12:00 AM');
  });

  it('returns malformed input unchanged (no NaN:undefined PM)', () => {
    expect(formatTime('xxx')).toBe('xxx');
  });

  it('returns empty for null/undefined/empty', () => {
    expect(formatTime(null)).toBe('');
    expect(formatTime(undefined)).toBe('');
    expect(formatTime('')).toBe('');
  });
});

describe('formatTimeRange', () => {
  it('joins start and end with em-dash', () => {
    expect(formatTimeRange('14:30', '16:00')).toBe('2:30 PM — 4:00 PM');
  });

  it('falls back to start only when end missing', () => {
    expect(formatTimeRange('14:30')).toBe('2:30 PM');
    expect(formatTimeRange('14:30', null)).toBe('2:30 PM');
    expect(formatTimeRange('14:30', '')).toBe('2:30 PM');
  });
});
