import { request } from '@playwright/test';
import { test, expect } from '../../../fixtures/test';
import { loginAsApi, API_BASE } from '../../../helpers/api';
import { setReservationSettings } from './_helpers';

/**
 * Phase 4 — Terminal states from CONFIRMED.
 *
 * Two terminal transitions are reachable from CONFIRMED:
 *   CONFIRMED → NO_SHOW   (noShow(): line 546-558, accepts PENDING|CONFIRMED)
 *   CONFIRMED → CANCELLED (cancel(): line 560-595)
 * Both are admin/manager-only. Once a reservation is COMPLETED /
 * CANCELLED / NO_SHOW the cancel guard rejects further mutation.
 */
test.describe('Reservation lifecycle — no-show & cancel', () => {
  function tomorrowISO(): string {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }

  function payload(startTime: string) {
    const tail = String(Date.now()).slice(-9) + Math.floor(Math.random() * 100);
    return {
      date: tomorrowISO(),
      startTime,
      endTime: '23:30',
      guestCount: 2,
      customerName: `NoShow E2E ${tail}`,
      customerPhone: `+905${tail.slice(-9)}`,
    };
  }

  test('CONFIRMED → no-show → NO_SHOW', async ({ demoTenantId }) => {
    const admin = await loginAsApi('admin');
    const prior = await setReservationSettings(admin.api, { requireApproval: false });
    if (prior.skip) {
      await admin.api.dispose();
      test.skip(true, prior.reason);
    }

    const ctx = await request.newContext({ baseURL: API_BASE });
    let id: string | null = null;
    try {
      const createRes = await ctx.post(`public/reservations/${demoTenantId}`, {
        data: payload('20:00'),
      });
      expect(createRes.ok()).toBe(true);
      const created = await createRes.json();
      id = created.id;
      expect(created.status).toBe('CONFIRMED');

      const nsRes = await admin.api.patch(`reservations/${id}/no-show`);
      expect(nsRes.ok(), `no-show: ${nsRes.status()} ${await nsRes.text()}`).toBe(true);
      const fetched = await (await admin.api.get(`reservations/${id}`)).json();
      expect(fetched.status).toBe('NO_SHOW');
    } finally {
      if (id) await admin.api.delete(`reservations/${id}`).catch(() => {});
      await setReservationSettings(admin.api, prior.previous).catch(() => {});
      await admin.api.dispose();
      await ctx.dispose();
    }
  });

  test('CONFIRMED → admin cancel → CANCELLED', async ({ demoTenantId }) => {
    const admin = await loginAsApi('admin');
    const prior = await setReservationSettings(admin.api, { requireApproval: false });
    if (prior.skip) {
      await admin.api.dispose();
      test.skip(true, prior.reason);
    }

    const ctx = await request.newContext({ baseURL: API_BASE });
    let id: string | null = null;
    try {
      const createRes = await ctx.post(`public/reservations/${demoTenantId}`, {
        data: payload('20:30'),
      });
      expect(createRes.ok()).toBe(true);
      const created = await createRes.json();
      id = created.id;

      const cancelRes = await admin.api.patch(`reservations/${id}/cancel`);
      expect(cancelRes.ok(), `cancel: ${cancelRes.status()} ${await cancelRes.text()}`).toBe(true);
      const fetched = await (await admin.api.get(`reservations/${id}`)).json();
      expect(fetched.status).toBe('CANCELLED');
      expect(fetched.cancelledAt).toBeTruthy();
    } finally {
      if (id) await admin.api.delete(`reservations/${id}`).catch(() => {});
      await setReservationSettings(admin.api, prior.previous).catch(() => {});
      await admin.api.dispose();
      await ctx.dispose();
    }
  });

  test('CANCELLED reservation cannot be cancelled again (4xx)', async ({ demoTenantId }) => {
    const admin = await loginAsApi('admin');
    const prior = await setReservationSettings(admin.api, { requireApproval: false });
    if (prior.skip) {
      await admin.api.dispose();
      test.skip(true, prior.reason);
    }

    const ctx = await request.newContext({ baseURL: API_BASE });
    let id: string | null = null;
    try {
      const createRes = await ctx.post(`public/reservations/${demoTenantId}`, {
        data: payload('21:00'),
      });
      expect(createRes.ok()).toBe(true);
      id = (await createRes.json()).id;
      await admin.api.patch(`reservations/${id}/cancel`);

      const reCancel = await admin.api.patch(`reservations/${id}/cancel`);
      expect(reCancel.status()).toBeGreaterThanOrEqual(400);
      expect(reCancel.status()).toBeLessThan(500);
    } finally {
      if (id) await admin.api.delete(`reservations/${id}`).catch(() => {});
      await setReservationSettings(admin.api, prior.previous).catch(() => {});
      await admin.api.dispose();
      await ctx.dispose();
    }
  });

  test('waiter cannot mark no-show or cancel (403)', async ({ demoTenantId }) => {
    const admin = await loginAsApi('admin');
    const waiter = await loginAsApi('waiter');
    const prior = await setReservationSettings(admin.api, { requireApproval: false });
    if (prior.skip) {
      await admin.api.dispose();
      await waiter.api.dispose();
      test.skip(true, prior.reason);
    }

    const ctx = await request.newContext({ baseURL: API_BASE });
    let id: string | null = null;
    try {
      const createRes = await ctx.post(`public/reservations/${demoTenantId}`, {
        data: payload('21:30'),
      });
      expect(createRes.ok()).toBe(true);
      id = (await createRes.json()).id;

      expect((await waiter.api.patch(`reservations/${id}/no-show`)).status()).toBe(403);
      expect((await waiter.api.patch(`reservations/${id}/cancel`)).status()).toBe(403);
    } finally {
      if (id) await admin.api.delete(`reservations/${id}`).catch(() => {});
      await setReservationSettings(admin.api, prior.previous).catch(() => {});
      await admin.api.dispose();
      await waiter.api.dispose();
      await ctx.dispose();
    }
  });
});
