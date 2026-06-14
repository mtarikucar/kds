import { describe, it, expect } from 'vitest';
import { pillClass, formatAge } from './healthFormat';

/**
 * Unit spec for the extracted HealthPage helpers (were module-private):
 * health-pill colour mapping and human-readable age bucketing.
 */
describe('pillClass', () => {
  const base = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium';

  it('green pill maps to green classes', () => {
    expect(pillClass('green')).toBe(`${base} bg-green-100 text-green-800`);
  });

  it('yellow pill maps to amber classes', () => {
    expect(pillClass('yellow')).toBe(`${base} bg-amber-100 text-amber-800`);
  });

  it('red pill maps to red classes', () => {
    expect(pillClass('red')).toBe(`${base} bg-red-100 text-red-800`);
  });
});

describe('formatAge', () => {
  it('null -> em-dash', () => {
    expect(formatAge(null)).toBe('—');
  });

  it('sub-minute -> <1m', () => {
    expect(formatAge(0)).toBe('<1m');
    expect(formatAge(0.4)).toBe('<1m');
  });

  it('minutes under an hour are rounded and suffixed m', () => {
    expect(formatAge(1)).toBe('1m');
    expect(formatAge(59.4)).toBe('59m');
  });

  it('an hour up to a day rounds to whole hours', () => {
    expect(formatAge(60)).toBe('1h');
    expect(formatAge(150)).toBe('3h'); // 2.5h rounds to 3
  });

  it('a day or more rounds to whole days', () => {
    expect(formatAge(24 * 60)).toBe('1d');
    expect(formatAge(3 * 24 * 60)).toBe('3d');
  });
});
