import { request } from '@playwright/test';
import { test, expect } from '../../../fixtures/test';
import { loginAsApi, API_BASE } from '../../../helpers/api';
import { setReservationSettings } from './_helpers';

/**
 * Phase 2 — Admin approval flow.
 *
 * With requireApproval=true, the service stamps PENDING on public
 * bookings (reservations.service.ts:140-141). PATCH /reservations/:id/
 * confirm transitions PENDING→CONFIRMED; PATCH /reservations/:id/reject
 * transitions PENDING|CONFIRMED→REJECTED. Both endpoints are gated to
 * ADMIN/MANAGER only (reservations.controller.ts:67-79); WAITER must
 * receive 403.
 */
test.describe('Reservation lifecycle — admin approval', () => {
  function tomorrowISO(): string {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }

  function newPayload(opts: { startTime?: string } = {}) {
    const tail = String(Date.now()).slice(-9);
    return {
      date: tomorrowISO(),
      startTime: opts.startTime ?? '19:00',
      endTime: '20:30',
      guestCount: 2,
      customerName: `Approve E2E ${tail}`,
      customerPhone: `+905${tail}`,
    };
  }

  test('requireApproval=true → public booking is PENDING', async ({ demoTenantId }) => {
    const admin = await loginAsApi('admin');
    const prior = await setReservationSettings(admin.api, { requireApproval: true });
    if (prior.skip) {
      await admin.api.dispose();
      test.skip(true, prior.reason);
    }

    const ctx = await request.newContext({ baseURL: API_BASE });
    let created: { id: string; status: string } | null = null;
    try {
      const res = await ctx.post(`public/reservations/${demoTenantId}`, {
        data: newPayload({ startTime: '19:15' }),
      });
      expect(res.ok(), `create: ${res.status()} ${await res.text()}`).toBe(true);
      created = await res.json();
      expect(created!.status).toBe('PENDING');

      const list = await admin.api.get('reservations?status=PENDING&limit=100');
      expect(list.ok()).toBe(true);
      const body = await list.json();
      const ids: string[] = (body.data ?? []).map((r: { id: string }) => r.id);
      expect(ids).toContain(created!.id);
    } finally {
      if (created) await admin.api.delete(`reservations/${created.id}`).catch(() => {});
      await setReservationSettings(admin.api, prior.previous).catch(() => {});
      await admin.api.dispose();
      await ctx.dispose();
    }
  });

  test('PENDING → confirm transitions to CONFIRMED', async ({ demoTenantId }) => {
    const admin = await loginAsApi('admin');
    const prior = await setReservationSettings(admin.api, { requireApproval: true });
    if (prior.skip) {
      await admin.api.dispose();
      test.skip(true, prior.reason);
    }

    const ctx = await request.newContext({ baseURL: API_BASE });
    let id: string | null = null;
    try {
      const createRes = await ctx.post(`public/reservations/${demoTenantId}`, {
        data: newPayload({ startTime: '19:30' }),
      });
      expect(createRes.ok()).toBe(true);
      const created = await createRes.json();
      id = created.id;
      expect(created.status).toBe('PENDING');

      const confirmRes = await admin.api.patch(`reservations/${id}/confirm`);
      expect(confirmRes.ok(), `confirm: ${confirmRes.status()} ${await confirmRes.text()}`).toBe(
        true,
      );
      const fetched = await (await admin.api.get(`reservations/${id}`)).json();
      expect(fetched.status).toBe('CONFIRMED');
    } finally {
      if (id) await admin.api.delete(`reservations/${id}`).catch(() => {});
      await setReservationSettings(admin.api, prior.previous).catch(() => {});
      await admin.api.dispose();
      await ctx.dispose();
    }
  });

  test('PENDING → reject transitions to REJECTED', async ({ demoTenantId }) => {
    const admin = await loginAsApi('admin');
    const prior = await setReservationSettings(admin.api, { requireApproval: true });
    if (prior.skip) {
      await admin.api.dispose();
      test.skip(true, prior.reason);
    }

    const ctx = await request.newContext({ baseURL: API_BASE });
    let id: string | null = null;
    try {
      const createRes = await ctx.post(`public/reservations/${demoTenantId}`, {
        data: newPayload({ startTime: '19:45' }),
      });
      expect(createRes.ok()).toBe(true);
      const created = await createRes.json();
      id = created.id;
      expect(created.status).toBe('PENDING');

      const rejRes = await admin.api.patch(`reservations/${id}/reject`, {
        data: { rejectionReason: 'fully booked' },
      });
      expect(rejRes.ok(), `reject: ${rejRes.status()} ${await rejRes.text()}`).toBe(true);
      const fetched = await (await admin.api.get(`reservations/${id}`)).json();
      expect(fetched.status).toBe('REJECTED');
    } finally {
      if (id) await admin.api.delete(`reservations/${id}`).catch(() => {});
      await setReservationSettings(admin.api, prior.previous).catch(() => {});
      await admin.api.dispose();
      await ctx.dispose();
    }
  });

  test('waiter cannot confirm or reject (403)', async ({ demoTenantId }) => {
    const admin = await loginAsApi('admin');
    const waiter = await loginAsApi('waiter');
    const prior = await setReservationSettings(admin.api, { requireApproval: true });
    if (prior.skip) {
      await admin.api.dispose();
      await waiter.api.dispose();
      test.skip(true, prior.reason);
    }

    const ctx = await request.newContext({ baseURL: API_BASE });
    let id: string | null = null;
    try {
      const createRes = await ctx.post(`public/reservations/${demoTenantId}`, {
        data: newPayload({ startTime: '20:00' }),
      });
      expect(createRes.ok()).toBe(true);
      const created = await createRes.json();
      id = created.id;

      const confirmRes = await waiter.api.patch(`reservations/${id}/confirm`);
      expect(confirmRes.status()).toBe(403);

      const rejRes = await waiter.api.patch(`reservations/${id}/reject`, {
        data: { rejectionReason: 'nope' },
      });
      expect(rejRes.status()).toBe(403);
    } finally {
      if (id) await admin.api.delete(`reservations/${id}`).catch(() => {});
      await setReservationSettings(admin.api, prior.previous).catch(() => {});
      await admin.api.dispose();
      await waiter.api.dispose();
      await ctx.dispose();
    }
  });
});
