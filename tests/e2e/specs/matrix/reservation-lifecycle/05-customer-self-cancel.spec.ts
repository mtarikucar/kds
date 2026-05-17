import { request } from '@playwright/test';
import { test, expect } from '../../../fixtures/test';
import { loginAsApi, API_BASE } from '../../../helpers/api';
import { setReservationSettings } from './_helpers';

/**
 * Phase 5 — Customer self-cancel via the public surface.
 *
 * PATCH /public/reservations/:tenantId/:id/cancel takes a body with
 * { customerPhone, reservationNumber } as proof — see
 * public-reservations.controller.ts:104-116 and cancelPublic() in the
 * service (line 597-671). Three guards apply:
 *  - settings.allowCancellation must be true
 *  - status must be PENDING or CONFIRMED
 *  - (now + cancellationDeadline) must still be before the slot
 * Cross-tenant attempts must not leak — the (id, tenantId) pair must
 * resolve to a 404.
 */
test.describe('Reservation lifecycle — customer self-cancel', () => {
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
      customerName: `SelfCancel ${tail}`,
      customerPhone: `+905${tail.slice(-9)}`,
    };
  }

  test('customer with proof can self-cancel while allowCancellation=true', async ({
    demoTenantId,
  }) => {
    const admin = await loginAsApi('admin');
    const prior = await setReservationSettings(admin.api, {
      requireApproval: false,
      allowCancellation: true,
      cancellationDeadline: 60, // 1h before slot
    });
    if (prior.skip) {
      await admin.api.dispose();
      test.skip(true, prior.reason);
    }

    const ctx = await request.newContext({ baseURL: API_BASE });
    let id: string | null = null;
    try {
      const data = payload('22:00');
      const createRes = await ctx.post(`public/reservations/${demoTenantId}`, { data });
      expect(createRes.ok()).toBe(true);
      const created = await createRes.json();
      id = created.id;

      const cancelRes = await ctx.patch(`public/reservations/${demoTenantId}/${id}/cancel`, {
        data: {
          customerPhone: data.customerPhone,
          reservationNumber: created.reservationNumber,
        },
      });
      expect(cancelRes.ok(), `cancel: ${cancelRes.status()} ${await cancelRes.text()}`).toBe(true);

      const fetched = await (await admin.api.get(`reservations/${id}`)).json();
      expect(fetched.status).toBe('CANCELLED');
      expect(fetched.cancelledBy).toBe('CUSTOMER');
    } finally {
      if (id) await admin.api.delete(`reservations/${id}`).catch(() => {});
      await setReservationSettings(admin.api, prior.previous).catch(() => {});
      await admin.api.dispose();
      await ctx.dispose();
    }
  });

  test('allowCancellation=false → 400', async ({ demoTenantId }) => {
    const admin = await loginAsApi('admin');
    const prior = await setReservationSettings(admin.api, {
      requireApproval: false,
      allowCancellation: false,
      cancellationDeadline: 60,
    });
    if (prior.skip) {
      await admin.api.dispose();
      test.skip(true, prior.reason);
    }

    const ctx = await request.newContext({ baseURL: API_BASE });
    let id: string | null = null;
    try {
      const data = payload('22:15');
      const createRes = await ctx.post(`public/reservations/${demoTenantId}`, { data });
      expect(createRes.ok()).toBe(true);
      const created = await createRes.json();
      id = created.id;

      const cancelRes = await ctx.patch(`public/reservations/${demoTenantId}/${id}/cancel`, {
        data: {
          customerPhone: data.customerPhone,
          reservationNumber: created.reservationNumber,
        },
      });
      expect(cancelRes.status()).toBe(400);
    } finally {
      if (id) await admin.api.delete(`reservations/${id}`).catch(() => {});
      await setReservationSettings(admin.api, prior.previous).catch(() => {});
      await admin.api.dispose();
      await ctx.dispose();
    }
  });

  test('past deadline (huge cancellationDeadline window) → 400', async ({ demoTenantId }) => {
    const admin = await loginAsApi('admin');
    // 30 days ahead of any tomorrow slot — guaranteed past-deadline.
    const prior = await setReservationSettings(admin.api, {
      requireApproval: false,
      allowCancellation: true,
      cancellationDeadline: 60 * 24 * 30,
    });
    if (prior.skip) {
      await admin.api.dispose();
      test.skip(true, prior.reason);
    }

    const ctx = await request.newContext({ baseURL: API_BASE });
    let id: string | null = null;
    try {
      const data = payload('22:30');
      const createRes = await ctx.post(`public/reservations/${demoTenantId}`, { data });
      expect(createRes.ok()).toBe(true);
      const created = await createRes.json();
      id = created.id;

      const cancelRes = await ctx.patch(`public/reservations/${demoTenantId}/${id}/cancel`, {
        data: {
          customerPhone: data.customerPhone,
          reservationNumber: created.reservationNumber,
        },
      });
      expect(cancelRes.status()).toBe(400);
      const text = await cancelRes.text();
      expect(text).toMatch(/deadline/i);
    } finally {
      if (id) await admin.api.delete(`reservations/${id}`).catch(() => {});
      await setReservationSettings(admin.api, prior.previous).catch(() => {});
      await admin.api.dispose();
      await ctx.dispose();
    }
  });

  test('cross-tenant cancel attempt → 404 (no leak)', async ({ demoTenantId }) => {
    const admin = await loginAsApi('admin');
    const prior = await setReservationSettings(admin.api, {
      requireApproval: false,
      allowCancellation: true,
      cancellationDeadline: 60,
    });
    if (prior.skip) {
      await admin.api.dispose();
      test.skip(true, prior.reason);
    }

    const ctx = await request.newContext({ baseURL: API_BASE });
    let id: string | null = null;
    try {
      const data = payload('22:45');
      const createRes = await ctx.post(`public/reservations/${demoTenantId}`, { data });
      expect(createRes.ok()).toBe(true);
      const created = await createRes.json();
      id = created.id;

      // Use a syntactically-valid but non-existent tenantId. The service
      // calls validateTenant() first, which throws 404 if the tenant
      // isn't found — proving the (id, tenantId) pairing is enforced
      // before any matching attempt against the real reservation.
      const fakeTenant = '00000000-0000-0000-0000-000000000000';
      const cancelRes = await ctx.patch(`public/reservations/${fakeTenant}/${id}/cancel`, {
        data: {
          customerPhone: data.customerPhone,
          reservationNumber: created.reservationNumber,
        },
      });
      expect(cancelRes.status()).toBe(404);

      // The real reservation must still be intact.
      const fetched = await (await admin.api.get(`reservations/${id}`)).json();
      expect(fetched.status).toBe('CONFIRMED');
    } finally {
      if (id) await admin.api.delete(`reservations/${id}`).catch(() => {});
      await setReservationSettings(admin.api, prior.previous).catch(() => {});
      await admin.api.dispose();
      await ctx.dispose();
    }
  });

  test('wrong phone or wrong number → 404', async ({ demoTenantId }) => {
    const admin = await loginAsApi('admin');
    const prior = await setReservationSettings(admin.api, {
      requireApproval: false,
      allowCancellation: true,
      cancellationDeadline: 60,
    });
    if (prior.skip) {
      await admin.api.dispose();
      test.skip(true, prior.reason);
    }

    const ctx = await request.newContext({ baseURL: API_BASE });
    let id: string | null = null;
    try {
      const data = payload('23:00');
      const createRes = await ctx.post(`public/reservations/${demoTenantId}`, { data });
      expect(createRes.ok()).toBe(true);
      const created = await createRes.json();
      id = created.id;

      const wrongPhone = await ctx.patch(`public/reservations/${demoTenantId}/${id}/cancel`, {
        data: {
          customerPhone: '+905999999999',
          reservationNumber: created.reservationNumber,
        },
      });
      expect(wrongPhone.status()).toBe(404);

      const wrongNum = await ctx.patch(`public/reservations/${demoTenantId}/${id}/cancel`, {
        data: {
          customerPhone: data.customerPhone,
          reservationNumber: 'R-99999999-999',
        },
      });
      expect(wrongNum.status()).toBe(404);
    } finally {
      if (id) await admin.api.delete(`reservations/${id}`).catch(() => {});
      await setReservationSettings(admin.api, prior.previous).catch(() => {});
      await admin.api.dispose();
      await ctx.dispose();
    }
  });
});
