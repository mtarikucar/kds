import { test, expect } from '../../../fixtures/test';
import { request } from '@playwright/test';
import { loginAsApi, API_BASE } from '../../../helpers/api';
import { setReservationSettings } from '../../../helpers/factories';
import { createPublicReservation } from '../../../helpers/factories/reservations';

/**
 * Matrix: `allowCancellation`.
 *
 * Public cancellation endpoint: `PATCH /public/reservations/:tenantId/:id/cancel`
 * (body = { customerPhone, reservationNumber }).
 *
 * Service check (in order):
 *   1. if (!settings.allowCancellation) → 'Cancellation is not allowed'
 *   2. status must be PENDING or CONFIRMED
 *   3. cancellationDeadline window
 *
 * So we book a reservation far in advance, then attempt cancellation
 * with the flag OFF (must reject) and ON (must succeed). Distinct
 * reservations per case so the "true" leg starts from a fresh
 * PENDING/CONFIRMED row.
 */
function plusDays(d: number): string {
  const dt = new Date();
  dt.setDate(dt.getDate() + d);
  return dt.toISOString().slice(0, 10);
}

test.describe('Reservation settings — allowCancellation', () => {
  test('false rejects with "not allowed"; true cancels successfully', async ({ demoTenantId }) => {
    const { api } = await loginAsApi('admin');
    try {
      // Baseline so the bookings themselves succeed.
      await setReservationSettings(api, {
        isEnabled: true,
        requireApproval: false,
        cancellationDeadline: 60,
        allowCancellation: true,
      });

      // Two well-future reservations so deadline check can't fire.
      const resA = await createPublicReservation(demoTenantId, {
        date: plusDays(10),
        startTime: '12:00',
        endTime: '13:00',
        customerName: 'E2E CancelOff',
      });
      const resB = await createPublicReservation(demoTenantId, {
        date: plusDays(10),
        startTime: '13:30',
        endTime: '14:30',
        customerName: 'E2E CancelOn',
      });

      const publicCtx = await request.newContext({ baseURL: API_BASE });
      try {
        // allowCancellation=false → 4xx with "not allowed"
        await setReservationSettings(api, { allowCancellation: false });
        const offRes = await publicCtx.patch(
          `public/reservations/${demoTenantId}/${resA.id}/cancel`,
          {
            data: {
              customerPhone: resA.customerPhone,
              reservationNumber: resA.reservationNumber,
            },
          },
        );
        expect(offRes.status()).toBe(400);
        const offBody = await offRes.text();
        expect(offBody.toLowerCase()).toContain('not allowed');

        // allowCancellation=true → 200
        await setReservationSettings(api, { allowCancellation: true });
        const onRes = await publicCtx.patch(
          `public/reservations/${demoTenantId}/${resB.id}/cancel`,
          {
            data: {
              customerPhone: resB.customerPhone,
              reservationNumber: resB.reservationNumber,
            },
          },
        );
        expect(onRes.ok(), await onRes.text()).toBeTruthy();
        const cancelled = await onRes.json();
        expect(cancelled.status).toBe('CANCELLED');
      } finally {
        await publicCtx.dispose();
      }
    } finally {
      await setReservationSettings(api, {
        allowCancellation: true,
        requireApproval: true,
      });
      await api.dispose();
    }
  });
});
