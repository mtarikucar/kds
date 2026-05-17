import { test, expect } from '../../../fixtures/test';
import { request } from '@playwright/test';
import { loginAsApi, API_BASE } from '../../../helpers/api';
import { setReservationSettings } from '../../../helpers/factories';

/**
 * Matrix: `maxAdvanceDays`.
 *
 * Service:
 *   maxDate = today + maxAdvanceDays;
 *   if (reservationDate > maxDate)
 *     throw 'Cannot book more than X days in advance'
 *
 * Booking at the boundary (exactly maxAdvanceDays out) must succeed;
 * booking at maxAdvanceDays + 5 must reject with the message.
 */
const MAX_DAYS = 30;

function ymd(daysAhead: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}

test.describe('Reservation settings — maxAdvanceDays', () => {
  test(`booking > ${MAX_DAYS} days out rejected; within accepted`, async ({ demoTenantId }) => {
    const { api } = await loginAsApi('admin');
    try {
      await setReservationSettings(api, {
        isEnabled: true,
        requireApproval: false,
        maxAdvanceDays: MAX_DAYS,
      });

      const publicCtx = await request.newContext({ baseURL: API_BASE });
      try {
        const ts = Date.now();

        // Far past max — reject
        const farRes = await publicCtx.post(`public/reservations/${demoTenantId}`, {
          data: {
            date: ymd(MAX_DAYS + 10),
            startTime: '19:00',
            endTime: '20:00',
            guestCount: 2,
            customerName: 'E2E MaxAdvance Far',
            customerPhone: `+9058${String(ts).slice(-8)}`,
          },
        });
        expect(farRes.status()).toBe(400);
        const farBody = await farRes.text();
        expect(farBody).toMatch(/more than \d+ days/i);

        // Comfortably inside the window — accept
        const okRes = await publicCtx.post(`public/reservations/${demoTenantId}`, {
          data: {
            date: ymd(7),
            startTime: '19:30',
            endTime: '20:30',
            guestCount: 2,
            customerName: 'E2E MaxAdvance OK',
            customerPhone: `+9058${String(ts + 1).slice(-8)}`,
          },
        });
        expect(okRes.ok(), await okRes.text()).toBeTruthy();
      } finally {
        await publicCtx.dispose();
      }
    } finally {
      await setReservationSettings(api, {
        maxAdvanceDays: 90,
        requireApproval: true,
      });
      await api.dispose();
    }
  });
});
