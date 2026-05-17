import { request } from '@playwright/test';
import { test, expect } from '../../../fixtures/test';
import { loginAsApi, API_BASE } from '../../../helpers/api';

/**
 * Phase 1 — Public booking + lookup.
 *
 * POST /public/reservations/:tenantId creates a reservation and returns
 * the `reservationNumber`. GET /public/reservations/:tenantId/lookup
 * round-trips by (customerPhone, reservationNumber) — see
 * public-reservations.controller.ts:91-101. Required-field validation is
 * enforced by class-validator on CreateReservationDto.
 *
 * Note: the lookup endpoint takes `phone` + `reservationNumber` query
 * params (not a single `code`); the task spec's "?code=..." paraphrases
 * the same fixed-shape lookup.
 */
test.describe('Reservation lifecycle — public booking', () => {
  function tomorrowISO(): string {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }

  function uniquePhone(): string {
    const tail = String(Date.now()).slice(-9);
    return `+905${tail}`;
  }

  function basePayload(overrides: Record<string, unknown> = {}) {
    return {
      date: tomorrowISO(),
      startTime: '19:00',
      endTime: '20:30',
      guestCount: 2,
      customerName: `Public Book ${Date.now()}`,
      customerPhone: uniquePhone(),
      ...overrides,
    };
  }

  test('POST creates a reservation; GET lookup round-trips by phone + number', async ({
    demoTenantId,
  }) => {
    const ctx = await request.newContext({ baseURL: API_BASE });
    const admin = await loginAsApi('admin');
    const created: { id: string; reservationNumber: string; customerPhone: string } = await (async () => {
      const payload = basePayload();
      const res = await ctx.post(`public/reservations/${demoTenantId}`, { data: payload });
      if (res.status() === 403) {
        const body = await res.text();
        test.skip(
          /reservationSystem|feature/i.test(body),
          `Reservation system not enabled for demo tenant: ${body}`,
        );
      }
      expect(res.ok(), `create failed: ${res.status()} ${await res.text()}`).toBe(true);
      return res.json();
    })();

    try {
      expect(created.id).toBeTruthy();
      expect(created.reservationNumber).toMatch(/^R-\d{8}-\d{3}$/);

      const lookup = await ctx.get(
        `public/reservations/${demoTenantId}/lookup?phone=${encodeURIComponent(
          created.customerPhone,
        )}&reservationNumber=${encodeURIComponent(created.reservationNumber)}`,
      );
      expect(lookup.ok(), `lookup failed: ${lookup.status()} ${await lookup.text()}`).toBe(true);
      const fetched = await lookup.json();
      expect(fetched.id).toBe(created.id);
      expect(fetched.reservationNumber).toBe(created.reservationNumber);
    } finally {
      await admin.api.delete(`reservations/${created.id}`).catch(() => {});
      await admin.api.dispose();
      await ctx.dispose();
    }
  });

  test('missing customerName → 400', async ({ demoTenantId }) => {
    const ctx = await request.newContext({ baseURL: API_BASE });
    try {
      const { customerName: _, ...without } = basePayload() as Record<string, unknown>;
      const res = await ctx.post(`public/reservations/${demoTenantId}`, { data: without });
      if (res.status() === 403) {
        test.skip(true, 'Reservation system disabled (plan feature)');
      }
      expect(res.status()).toBe(400);
    } finally {
      await ctx.dispose();
    }
  });

  test('missing customerPhone → 400', async ({ demoTenantId }) => {
    const ctx = await request.newContext({ baseURL: API_BASE });
    try {
      const { customerPhone: _, ...without } = basePayload() as Record<string, unknown>;
      const res = await ctx.post(`public/reservations/${demoTenantId}`, { data: without });
      if (res.status() === 403) test.skip(true, 'Reservation system disabled');
      expect(res.status()).toBe(400);
    } finally {
      await ctx.dispose();
    }
  });

  test('invalid phone format → 400', async ({ demoTenantId }) => {
    const ctx = await request.newContext({ baseURL: API_BASE });
    try {
      const res = await ctx.post(`public/reservations/${demoTenantId}`, {
        data: basePayload({ customerPhone: 'not-a-phone' }),
      });
      if (res.status() === 403) test.skip(true, 'Reservation system disabled');
      expect(res.status()).toBe(400);
    } finally {
      await ctx.dispose();
    }
  });

  test('missing date → 400', async ({ demoTenantId }) => {
    const ctx = await request.newContext({ baseURL: API_BASE });
    try {
      const { date: _, ...without } = basePayload() as Record<string, unknown>;
      const res = await ctx.post(`public/reservations/${demoTenantId}`, { data: without });
      if (res.status() === 403) test.skip(true, 'Reservation system disabled');
      expect(res.status()).toBe(400);
    } finally {
      await ctx.dispose();
    }
  });

  test('missing guestCount → 400', async ({ demoTenantId }) => {
    const ctx = await request.newContext({ baseURL: API_BASE });
    try {
      const { guestCount: _, ...without } = basePayload() as Record<string, unknown>;
      const res = await ctx.post(`public/reservations/${demoTenantId}`, { data: without });
      if (res.status() === 403) test.skip(true, 'Reservation system disabled');
      expect(res.status()).toBe(400);
    } finally {
      await ctx.dispose();
    }
  });

  test('endTime <= startTime → 400', async ({ demoTenantId }) => {
    const ctx = await request.newContext({ baseURL: API_BASE });
    try {
      const res = await ctx.post(`public/reservations/${demoTenantId}`, {
        data: basePayload({ startTime: '19:00', endTime: '18:00' }),
      });
      if (res.status() === 403) test.skip(true, 'Reservation system disabled');
      expect(res.status()).toBe(400);
    } finally {
      await ctx.dispose();
    }
  });
});
