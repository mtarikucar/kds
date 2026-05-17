import { request } from '@playwright/test';
import { test, expect } from '../../../fixtures/test';
import { loginAsApi, API_BASE } from '../../../helpers/api';
import { setReservationSettings } from './_helpers';

/**
 * Phase 3 — Seating flow.
 *
 * The service enforces a strict state machine:
 *   CONFIRMED → SEATED       (seat(): line 494-519)
 *   SEATED    → COMPLETED    (complete(): line 521-544)
 * Any transition that bypasses SEATED (e.g. CONFIRMED → COMPLETED)
 * must return 400 with "Only seated reservations can be completed".
 */
test.describe('Reservation lifecycle — seating', () => {
  function tomorrowISO(): string {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }

  function payload(startTime: string) {
    const tail = String(Date.now()).slice(-9);
    return {
      date: tomorrowISO(),
      startTime,
      endTime: addMinutes(startTime, 90),
      guestCount: 2,
      customerName: `Seat E2E ${tail}`,
      customerPhone: `+905${tail}`,
    };
  }

  function addMinutes(hhmm: string, mins: number): string {
    const [h, m] = hhmm.split(':').map(Number);
    const t = h * 60 + m + mins;
    const eh = Math.floor(t / 60) % 24;
    const em = t % 60;
    return `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`;
  }

  test('CONFIRMED → seat → SEATED → complete → COMPLETED', async ({ demoTenantId }) => {
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
        data: payload('18:00'),
      });
      expect(createRes.ok(), `create: ${createRes.status()} ${await createRes.text()}`).toBe(true);
      const created = await createRes.json();
      id = created.id;
      expect(created.status).toBe('CONFIRMED');

      const seatRes = await admin.api.patch(`reservations/${id}/seat`);
      expect(seatRes.ok(), `seat: ${seatRes.status()} ${await seatRes.text()}`).toBe(true);
      const afterSeat = await (await admin.api.get(`reservations/${id}`)).json();
      expect(afterSeat.status).toBe('SEATED');

      const completeRes = await admin.api.patch(`reservations/${id}/complete`);
      expect(completeRes.ok(), `complete: ${completeRes.status()}`).toBe(true);
      const afterComplete = await (await admin.api.get(`reservations/${id}`)).json();
      expect(afterComplete.status).toBe('COMPLETED');
    } finally {
      if (id) await admin.api.delete(`reservations/${id}`).catch(() => {});
      await setReservationSettings(admin.api, prior.previous).catch(() => {});
      await admin.api.dispose();
      await ctx.dispose();
    }
  });

  test('CONFIRMED → complete (skipping SEATED) → 4xx', async ({ demoTenantId }) => {
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
        data: payload('18:30'),
      });
      expect(createRes.ok()).toBe(true);
      const created = await createRes.json();
      id = created.id;
      expect(created.status).toBe('CONFIRMED');

      const skipRes = await admin.api.patch(`reservations/${id}/complete`);
      expect(skipRes.status()).toBeGreaterThanOrEqual(400);
      expect(skipRes.status()).toBeLessThan(500);

      const fetched = await (await admin.api.get(`reservations/${id}`)).json();
      expect(fetched.status).toBe('CONFIRMED');
    } finally {
      if (id) await admin.api.delete(`reservations/${id}`).catch(() => {});
      await setReservationSettings(admin.api, prior.previous).catch(() => {});
      await admin.api.dispose();
      await ctx.dispose();
    }
  });

  test('SEATED → seat (re-seat) → 4xx', async ({ demoTenantId }) => {
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
        data: payload('19:00'),
      });
      expect(createRes.ok()).toBe(true);
      id = (await createRes.json()).id;

      await admin.api.patch(`reservations/${id}/seat`);
      const reSeat = await admin.api.patch(`reservations/${id}/seat`);
      expect(reSeat.status()).toBeGreaterThanOrEqual(400);
      expect(reSeat.status()).toBeLessThan(500);
    } finally {
      if (id) await admin.api.delete(`reservations/${id}`).catch(() => {});
      await setReservationSettings(admin.api, prior.previous).catch(() => {});
      await admin.api.dispose();
      await ctx.dispose();
    }
  });
});
