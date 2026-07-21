import { describe, it, expect } from 'vitest';
import { todayRange, greetingKey, QUICK_ACTIONS } from './lib';

describe('todayRange', () => {
  it('returns [today, tomorrow) as yyyy-MM-dd', () => {
    const r = todayRange(new Date(2026, 6, 21, 15, 30)); // 21 Jul 2026
    expect(r).toEqual({ startDate: '2026-07-21', endDate: '2026-07-22' });
  });

  it('crosses month boundaries correctly', () => {
    const r = todayRange(new Date(2026, 6, 31));
    expect(r.endDate).toBe('2026-08-01');
  });
});

describe('greetingKey', () => {
  it.each([
    [6, 'dashboard.greetingMorning'],
    [11, 'dashboard.greetingMorning'],
    [12, 'dashboard.greetingAfternoon'],
    [17, 'dashboard.greetingAfternoon'],
    [18, 'dashboard.greetingEvening'],
    [23, 'dashboard.greetingEvening'],
    [3, 'dashboard.greetingEvening'],
  ])('hour %i → %s', (hour, key) => {
    expect(greetingKey(new Date(2026, 6, 21, hour))).toBe(key);
  });
});

describe('QUICK_ACTIONS', () => {
  it('uses consolidated routes (no stale deeplinks)', () => {
    const targets = QUICK_ACTIONS.map((a) => a.to);
    expect(targets).toContain('/admin/team');
    expect(targets).toContain('/admin/settings');
    expect(targets).not.toContain('/admin/users');
    expect(targets).not.toContain('/admin/settings/subscription');
  });

  it('marks POS as the single primary action', () => {
    expect(QUICK_ACTIONS.filter((a) => a.isPrimary).map((a) => a.to)).toEqual(['/pos']);
  });
});
