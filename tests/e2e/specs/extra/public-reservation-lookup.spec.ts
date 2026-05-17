import { test, expect } from '../../fixtures/test';
import { request } from '@playwright/test';
import { API_BASE } from '../../helpers/api';
import { createPublicReservation } from '../../helpers/factories';

/**
 * Public reservation lookup uses phone + reservationNumber as the
 * "key" — no auth at all (the customer doesn't have an account).
 * Cancel by the same key revokes the booking.
 */
test.describe('Public reservations — lookup + cancel', () => {
  test('cancel-by-phone-and-number refuses a wrong-phone combination', async ({
    demoTenantId,
  }) => {
    const r = await createPublicReservation(demoTenantId);

    const ctx = await request.newContext({ baseURL: API_BASE });
    const res = await ctx.patch(`public/reservations/${demoTenantId}/${r.id}/cancel`, {
      data: {
        customerPhone: '+905550000000', // not the booking phone
        reservationNumber: r.reservationNumber,
      },
    });
    await ctx.dispose();
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });

  test('cancel-by-phone-and-number succeeds with the booking pair', async ({ demoTenantId }) => {
    const r = await createPublicReservation(demoTenantId);
    const ctx = await request.newContext({ baseURL: API_BASE });
    const res = await ctx.patch(`public/reservations/${demoTenantId}/${r.id}/cancel`, {
      data: {
        customerPhone: r.customerPhone,
        reservationNumber: r.reservationNumber,
      },
    });
    await ctx.dispose();
    expect(res.ok()).toBeTruthy();
  });
});
