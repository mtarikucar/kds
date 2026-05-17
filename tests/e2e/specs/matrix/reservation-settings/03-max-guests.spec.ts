import { test, expect } from '../../../fixtures/test';
import { request } from '@playwright/test';
import { loginAsApi, API_BASE } from '../../../helpers/api';
import { setReservationSettings } from '../../../helpers/factories';

/**
 * Matrix: `maxGuestsPerReservation`.
 *
 * Service check:
 *   if (dto.guestCount > settings.maxGuestsPerReservation) {
 *     throw new BadRequestException(`Maximum guests per reservation is ...`);
 *   }
 *
 * Boundary case: guestCount === max must succeed (strict `>` in the
 * service). guestCount === max + 1 must be rejected with the violation
 * message in the body.
 */
const MAX = 8;

function tomorrow(): string {
  const d = new Date();
  d.setDate(d.getDate() + 2);
  return d.toISOString().slice(0, 10);
}

test.describe('Reservation settings — maxGuestsPerReservation', () => {
  test(`guestCount > ${MAX} rejected; guestCount === ${MAX} accepted`, async ({
    demoTenantId,
  }) => {
    const { api } = await loginAsApi('admin');
    try {
      await setReservationSettings(api, {
        maxGuestsPerReservation: MAX,
        requireApproval: false,
      });

      const publicCtx = await request.newContext({ baseURL: API_BASE });
      try {
        const baseTs = Date.now();

        // Over the limit
        const overRes = await publicCtx.post(`public/reservations/${demoTenantId}`, {
          data: {
            date: tomorrow(),
            startTime: '18:00',
            endTime: '19:30',
            guestCount: MAX + 1,
            customerName: 'E2E MaxGuests Over',
            customerPhone: `+9055${String(baseTs).slice(-8)}`,
          },
        });
        expect(overRes.status()).toBe(400);
        const overBody = await overRes.text();
        expect(overBody).toMatch(/maximum guests/i);

        // At the limit (boundary should succeed)
        const okRes = await publicCtx.post(`public/reservations/${demoTenantId}`, {
          data: {
            date: tomorrow(),
            startTime: '18:30',
            endTime: '20:00',
            guestCount: MAX,
            customerName: 'E2E MaxGuests OK',
            customerPhone: `+9055${String(baseTs + 1).slice(-8)}`,
          },
        });
        expect(okRes.ok()).toBeTruthy();
      } finally {
        await publicCtx.dispose();
      }
    } finally {
      await setReservationSettings(api, {
        maxGuestsPerReservation: 20,
        requireApproval: true,
      });
      await api.dispose();
    }
  });
});
