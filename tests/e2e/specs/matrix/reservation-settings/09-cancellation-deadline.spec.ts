import { test, expect } from '../../../fixtures/test';
import { request } from '@playwright/test';
import { loginAsApi, API_BASE } from '../../../helpers/api';
import { setReservationSettings } from '../../../helpers/factories';
import { createPublicReservation } from '../../../helpers/factories/reservations';

/**
 * Matrix: `cancellationDeadline` (minutes before slot).
 *
 * Service check:
 *   const deadlineMs = settings.cancellationDeadline * 60 * 1000;
 *   if (reservationDateTime - now < deadlineMs)
 *     throw 'Cancellation deadline has passed'
 *
 * To exercise both branches with a fixed deadline (120 min), we
 * create two reservations:
 *   A: ~60 min from now → inside deadline → cancel REJECT
 *   B: ~3 hours from now → outside deadline → cancel ACCEPT
 *
 * Both bookings must be allowed first, so we relax minAdvanceBooking
 * for the duration of the test.
 */
const DEADLINE = 120;

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

test.describe('Reservation settings — cancellationDeadline', () => {
  test(`inside ${DEADLINE}min rejected; outside accepted`, async ({ demoTenantId }) => {
    const { api } = await loginAsApi('admin');
    try {
      await setReservationSettings(api, {
        isEnabled: true,
        requireApproval: false,
        allowCancellation: true,
        cancellationDeadline: DEADLINE,
        minAdvanceBooking: 30, // both bookings must clear this floor
        operatingHours: {
          monday: { open: '00:00', close: '23:30', closed: false },
          tuesday: { open: '00:00', close: '23:30', closed: false },
          wednesday: { open: '00:00', close: '23:30', closed: false },
          thursday: { open: '00:00', close: '23:30', closed: false },
          friday: { open: '00:00', close: '23:30', closed: false },
          saturday: { open: '00:00', close: '23:30', closed: false },
          sunday: { open: '00:00', close: '23:30', closed: false },
        },
      });

      const now = new Date();
      // Inside-deadline reservation: 60 min from now (< 120 min)
      const insideStart = new Date(now.getTime() + 60 * 60_000);
      const insideEnd = new Date(insideStart.getTime() + 45 * 60_000);
      // Outside-deadline reservation: 3 hours from now (>> 120 min)
      const outsideStart = new Date(now.getTime() + 3 * 60 * 60_000);
      const outsideEnd = new Date(outsideStart.getTime() + 45 * 60_000);

      const resInside = await createPublicReservation(demoTenantId, {
        date: ymd(insideStart),
        startTime: hhmm(insideStart),
        endTime: hhmm(insideEnd),
        customerName: 'E2E DeadlineInside',
      });
      const resOutside = await createPublicReservation(demoTenantId, {
        date: ymd(outsideStart),
        startTime: hhmm(outsideStart),
        endTime: hhmm(outsideEnd),
        customerName: 'E2E DeadlineOutside',
      });

      const publicCtx = await request.newContext({ baseURL: API_BASE });
      try {
        const insideRes = await publicCtx.patch(
          `public/reservations/${demoTenantId}/${resInside.id}/cancel`,
          {
            data: {
              customerPhone: resInside.customerPhone,
              reservationNumber: resInside.reservationNumber,
            },
          },
        );
        expect(insideRes.status()).toBe(400);
        const insideBody = await insideRes.text();
        expect(insideBody.toLowerCase()).toContain('deadline');

        const outsideRes = await publicCtx.patch(
          `public/reservations/${demoTenantId}/${resOutside.id}/cancel`,
          {
            data: {
              customerPhone: resOutside.customerPhone,
              reservationNumber: resOutside.reservationNumber,
            },
          },
        );
        expect(outsideRes.ok(), await outsideRes.text()).toBeTruthy();
        const cancelled = await outsideRes.json();
        expect(cancelled.status).toBe('CANCELLED');
      } finally {
        await publicCtx.dispose();
      }
    } finally {
      await setReservationSettings(api, {
        cancellationDeadline: 60,
        minAdvanceBooking: 60,
        requireApproval: true,
      });
      await api.dispose();
    }
  });
});
