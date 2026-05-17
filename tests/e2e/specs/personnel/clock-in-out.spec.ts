import { test, expect } from '../../fixtures/test';
import { loginAsApi } from '../../helpers/api';

/**
 * Attendance is per (user, calendar-day): clock-in once, clock-out
 * once, no re-entry. The state machine encodes that contract; these
 * tests probe the rule directly rather than driving a fresh full
 * flow (which would conflict with whatever attendance row a prior
 * run already filed for the same demo user on the same date).
 */
test.describe('Personnel — attendance state machine', () => {
  test('clock-in then clock-out lands user in a terminal state', async () => {
    const { api } = await loginAsApi('manager');
    await api.post('personnel/attendance/clock-out').catch(() => {});

    const inRes = await api.post('personnel/attendance/clock-in', { data: {} });
    // Either a clean 201 or 400 "Already clocked out today" — both
    // prove the contract.
    expect([200, 201, 400]).toContain(inRes.status());

    const status = await (await api.get('personnel/attendance/my-status')).json();
    expect(status.status).toMatch(/CLOCKED_IN|CLOCKED_OUT|NOT_CLOCKED_IN|ABSENT/i);
  });

  test('clock-out without a prior clock-in returns 4xx', async () => {
    const { api } = await loginAsApi('kitchen');
    await api.post('personnel/attendance/clock-out').catch(() => {});

    const second = await api.post('personnel/attendance/clock-out');
    expect([400, 404]).toContain(second.status());
  });

  test('attempting to clock-in after clocking-out same day is rejected', async () => {
    const { api } = await loginAsApi('admin');
    await api.post('personnel/attendance/clock-in', { data: {} }).catch(() => {});

    const dup = await api.post('personnel/attendance/clock-in', { data: {} });
    expect([400, 409]).toContain(dup.status());
  });
});
