import { request } from '@playwright/test';
import { test, expect } from '../../../fixtures/test';
import { loginAsApi, API_BASE } from '../../../helpers/api';
import { setReservationSettings } from './_helpers';

/**
 * Phase 6 — Available slots.
 *
 * GET /public/reservations/:tenantId/available-slots?date=YYYY-MM-DD
 * returns an array of `{ time: "HH:mm", available: boolean }` rows
 * (see reservations.service.ts:681-757). The list is bounded by the
 * day's operating hours and the per-slot capacity. When
 * `maxReservationsPerSlot` is set, the Nth booking flips `available`
 * to false for that exact slot.
 */
test.describe('Reservation lifecycle — available slots', () => {
  function pickFutureDate(): string {
    // 7 days out — well above any plausible minAdvanceBooking and
    // safe from "today's slot already started" filtering.
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  }

  function payload(date: string, startTime: string, endTime: string) {
    const tail = String(Date.now()).slice(-9) + Math.floor(Math.random() * 1000);
    return {
      date,
      startTime,
      endTime,
      guestCount: 2,
      customerName: `Slot E2E ${tail}`,
      customerPhone: `+905${tail.slice(-9)}`,
    };
  }

  test('returns a non-empty list of HH:mm slots with boolean availability', async ({
    demoTenantId,
  }) => {
    const ctx = await request.newContext({ baseURL: API_BASE });
    const date = pickFutureDate();
    try {
      const res = await ctx.get(`public/reservations/${demoTenantId}/available-slots?date=${date}`);
      if (res.status() === 403) test.skip(true, 'Reservation system disabled');
      expect(res.ok(), `slots: ${res.status()} ${await res.text()}`).toBe(true);
      const slots: { time: string; available: boolean }[] = await res.json();

      expect(Array.isArray(slots)).toBe(true);
      // operatingHours default 09:00-22:00 with 30m slots → ~24 entries.
      // We only assert "at least one" so the test is robust to settings drift.
      expect(slots.length).toBeGreaterThan(0);
      for (const s of slots) {
        expect(s.time).toMatch(/^([01][0-9]|2[0-3]):[0-5][0-9]$/);
        expect(typeof s.available).toBe('boolean');
      }
    } finally {
      await ctx.dispose();
    }
  });

  test('filling a slot to maxReservationsPerSlot flips that slot to unavailable', async ({
    demoTenantId,
  }) => {
    const admin = await loginAsApi('admin');
    const N = 2;
    const prior = await setReservationSettings(admin.api, {
      requireApproval: false,
      maxReservationsPerSlot: N,
    });
    if (prior.skip) {
      await admin.api.dispose();
      test.skip(true, prior.reason);
    }

    const ctx = await request.newContext({ baseURL: API_BASE });
    const date = pickFutureDate();
    const slotTime = '15:00';
    const createdIds: string[] = [];

    try {
      // Sanity: pre-state has this slot listed as available.
      const before = await ctx.get(
        `public/reservations/${demoTenantId}/available-slots?date=${date}`,
      );
      expect(before.ok()).toBe(true);
      const beforeSlots: { time: string; available: boolean }[] = await before.json();
      const beforeRow = beforeSlots.find((s) => s.time === slotTime);
      // If the demo tenant's operating hours don't cover 15:00 we can't
      // exercise this assertion meaningfully; bail with a skip.
      if (!beforeRow) {
        test.skip(true, `slot ${slotTime} not in operating hours for demo tenant`);
      }
      expect(beforeRow!.available).toBe(true);

      // Fill the slot to capacity.
      for (let i = 0; i < N; i++) {
        const res = await ctx.post(`public/reservations/${demoTenantId}`, {
          data: payload(date, slotTime, '16:30'),
        });
        expect(res.ok(), `create #${i}: ${res.status()} ${await res.text()}`).toBe(true);
        const body = await res.json();
        createdIds.push(body.id);
      }

      // After capacity is reached, the slot must be either absent or
      // marked unavailable.
      const after = await ctx.get(
        `public/reservations/${demoTenantId}/available-slots?date=${date}`,
      );
      expect(after.ok()).toBe(true);
      const afterSlots: { time: string; available: boolean }[] = await after.json();
      const afterRow = afterSlots.find((s) => s.time === slotTime);
      if (afterRow) {
        expect(afterRow.available).toBe(false);
      }

      // The Nth+1 booking must be rejected by the slot-capacity guard.
      const overflow = await ctx.post(`public/reservations/${demoTenantId}`, {
        data: payload(date, slotTime, '16:30'),
      });
      expect(overflow.status()).toBe(400);
      const overflowBody = await overflow.text();
      expect(overflowBody).toMatch(/fully booked|capacity|slot/i);
    } finally {
      for (const id of createdIds) {
        await admin.api.delete(`reservations/${id}`).catch(() => {});
      }
      await setReservationSettings(admin.api, prior.previous).catch(() => {});
      await admin.api.dispose();
      await ctx.dispose();
    }
  });

  test('past date returns empty or filtered slot list (no past-time slots available)', async ({
    demoTenantId,
  }) => {
    const ctx = await request.newContext({ baseURL: API_BASE });
    try {
      // Today: any slot in the past should be `available: false` due to
      // the now+minAdvanceBooking guard in getAvailableSlots().
      const today = new Date().toISOString().slice(0, 10);
      const res = await ctx.get(
        `public/reservations/${demoTenantId}/available-slots?date=${today}`,
      );
      if (res.status() === 403) test.skip(true, 'Reservation system disabled');
      expect(res.ok()).toBe(true);
      const slots: { time: string; available: boolean }[] = await res.json();

      const now = new Date();
      const nowMins = now.getHours() * 60 + now.getMinutes();
      for (const s of slots) {
        const [h, m] = s.time.split(':').map(Number);
        if (h * 60 + m <= nowMins) {
          expect(s.available).toBe(false);
        }
      }
    } finally {
      await ctx.dispose();
    }
  });
});
