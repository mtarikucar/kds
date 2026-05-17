import { test, expect } from '../../../fixtures/test';
import { request } from '@playwright/test';
import { loginAsApi, API_BASE } from '../../../helpers/api';
import { setReservationSettings } from '../../../helpers/factories';

/**
 * Matrix: `timeSlotInterval`.
 *
 * `getAvailableSlots` walks from openTime to closeTime stepping by
 * `settings.timeSlotInterval` and emitting one slot per step (as long
 * as the slot + defaultDuration fits before closing). Halving the
 * interval should roughly double the number of slots returned for a
 * fixed (open, close, duration) window.
 */
function futureDate(daysAhead: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}

async function countSlots(
  publicCtx: import('@playwright/test').APIRequestContext,
  tenantId: string,
  date: string,
): Promise<number> {
  const res = await publicCtx.get(`public/reservations/${tenantId}/available-slots?date=${date}`);
  if (!res.ok()) throw new Error(`slots failed: ${res.status()} ${await res.text()}`);
  const slots = (await res.json()) as unknown[];
  return slots.length;
}

test.describe('Reservation settings — timeSlotInterval', () => {
  test('interval=30 yields strictly more slots than interval=60', async ({ demoTenantId }) => {
    const { api } = await loginAsApi('admin');
    try {
      // Pin a known operating window so the math is stable.
      const operatingHours = {
        monday: { open: '10:00', close: '22:00', closed: false },
        tuesday: { open: '10:00', close: '22:00', closed: false },
        wednesday: { open: '10:00', close: '22:00', closed: false },
        thursday: { open: '10:00', close: '22:00', closed: false },
        friday: { open: '10:00', close: '22:00', closed: false },
        saturday: { open: '10:00', close: '22:00', closed: false },
        sunday: { open: '10:00', close: '22:00', closed: false },
      };
      await setReservationSettings(api, {
        isEnabled: true,
        operatingHours,
        defaultDuration: 60,
      });

      const publicCtx = await request.newContext({ baseURL: API_BASE });
      try {
        // Use a date 14d out — avoids min-advance edge cases for the
        // earliest slots of the day.
        const date = futureDate(14);

        await setReservationSettings(api, { timeSlotInterval: 60 });
        const countAt60 = await countSlots(publicCtx, demoTenantId, date);

        await setReservationSettings(api, { timeSlotInterval: 30 });
        const countAt30 = await countSlots(publicCtx, demoTenantId, date);

        expect(countAt60).toBeGreaterThan(0);
        expect(countAt30).toBeGreaterThan(countAt60);
      } finally {
        await publicCtx.dispose();
      }
    } finally {
      await setReservationSettings(api, { timeSlotInterval: 30 });
      await api.dispose();
    }
  });
});
