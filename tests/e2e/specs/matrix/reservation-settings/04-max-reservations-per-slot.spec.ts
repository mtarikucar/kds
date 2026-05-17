import { test, expect } from '../../../fixtures/test';
import { request } from '@playwright/test';
import { loginAsApi, API_BASE } from '../../../helpers/api';
import { setReservationSettings } from '../../../helpers/factories';

/**
 * Matrix: `maxReservationsPerSlot`.
 *
 * Slot uniqueness is per-(date,startTime); the service counts existing
 * PENDING/CONFIRMED/SEATED bookings in the same slot and rejects with
 * 'This time slot is fully booked' once the cap is hit.
 *
 * We push a unique date well into the future (uses a fresh
 * `date+startTime` slot that no other test will collide with) and use
 * three distinct phone numbers to dodge the duplicate-by-phone guard.
 */
const CAP = 2;

function futureDate(daysAhead: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}

test.describe('Reservation settings — maxReservationsPerSlot', () => {
  test(`first ${CAP} succeed, next in same slot is rejected`, async ({
    demoTenantId,
  }) => {
    const { api } = await loginAsApi('admin');
    try {
      await setReservationSettings(api, {
        maxReservationsPerSlot: CAP,
        requireApproval: false,
      });

      const publicCtx = await request.newContext({ baseURL: API_BASE });
      try {
        // Use a date a few days out + odd time string so this slot is
        // unique to this test run.
        const date = futureDate(5);
        const startTime = '14:15';
        const endTime = '15:15';

        const baseTs = Date.now();

        for (let i = 0; i < CAP; i++) {
          const ok = await publicCtx.post(`public/reservations/${demoTenantId}`, {
            data: {
              date,
              startTime,
              endTime,
              guestCount: 2,
              customerName: `E2E SlotCap ${i}`,
              customerPhone: `+9056${String(baseTs + i).slice(-8)}`,
            },
          });
          expect(ok.ok(), `booking #${i + 1} should succeed`).toBeTruthy();
        }

        const overflow = await publicCtx.post(`public/reservations/${demoTenantId}`, {
          data: {
            date,
            startTime,
            endTime,
            guestCount: 2,
            customerName: 'E2E SlotCap Overflow',
            customerPhone: `+9056${String(baseTs + 99).slice(-8)}`,
          },
        });
        expect(overflow.status()).toBe(400);
        const body = await overflow.text();
        expect(body).toMatch(/fully booked|slot/i);
      } finally {
        await publicCtx.dispose();
      }
    } finally {
      await setReservationSettings(api, {
        maxReservationsPerSlot: 10,
        requireApproval: true,
      });
      await api.dispose();
    }
  });
});
