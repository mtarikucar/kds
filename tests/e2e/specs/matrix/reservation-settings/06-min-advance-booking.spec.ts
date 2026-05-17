import { test, expect } from '../../../fixtures/test';
import { request } from '@playwright/test';
import { loginAsApi, API_BASE } from '../../../helpers/api';
import { setReservationSettings } from '../../../helpers/factories';

/**
 * Matrix: `minAdvanceBooking` (minutes).
 *
 * Service: rejects when (slotDateTime - now) < minAdvanceBooking minutes.
 * We pick a booking slot ~30min from now (inside the window) and
 * ~4h from now (outside) with a 120-minute floor; only the latter
 * should succeed.
 *
 * Caveat: the booking-form spans 90 minutes (start→end). If "now" is
 * very late at night the close-of-day rules + same-day flow could
 * make the inside-window booking fail for a reason OTHER than the
 * minAdvance check; running this against a fresh tenant during
 * daytime hours is the assumed env.
 */
const FLOOR_MINUTES = 120;

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

test.describe('Reservation settings — minAdvanceBooking', () => {
  test(`booking inside ${FLOOR_MINUTES}min window rejected; well outside accepted`, async ({
    demoTenantId,
  }) => {
    const { api } = await loginAsApi('admin');
    try {
      await setReservationSettings(api, {
        isEnabled: true,
        requireApproval: false,
        minAdvanceBooking: FLOOR_MINUTES,
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

      const publicCtx = await request.newContext({ baseURL: API_BASE });
      try {
        const now = new Date();
        const ts = Date.now();

        // Inside window: 30 min from now → reject
        const insideStart = new Date(now.getTime() + 30 * 60_000);
        const insideEnd = new Date(insideStart.getTime() + 60 * 60_000);
        const insideRes = await publicCtx.post(`public/reservations/${demoTenantId}`, {
          data: {
            date: ymd(insideStart),
            startTime: hhmm(insideStart),
            endTime: hhmm(insideEnd),
            guestCount: 2,
            customerName: 'E2E MinAdvance Inside',
            customerPhone: `+9057${String(ts).slice(-8)}`,
          },
        });
        expect(insideRes.status()).toBe(400);
        const insideBody = await insideRes.text();
        expect(insideBody).toMatch(/too soon|advance/i);

        // Outside window: 4h from now → accept
        const outsideStart = new Date(now.getTime() + 4 * 60 * 60_000);
        const outsideEnd = new Date(outsideStart.getTime() + 60 * 60_000);
        const outsideRes = await publicCtx.post(`public/reservations/${demoTenantId}`, {
          data: {
            date: ymd(outsideStart),
            startTime: hhmm(outsideStart),
            endTime: hhmm(outsideEnd),
            guestCount: 2,
            customerName: 'E2E MinAdvance Outside',
            customerPhone: `+9057${String(ts + 1).slice(-8)}`,
          },
        });
        expect(outsideRes.ok(), await outsideRes.text()).toBeTruthy();
      } finally {
        await publicCtx.dispose();
      }
    } finally {
      await setReservationSettings(api, {
        minAdvanceBooking: 60,
        requireApproval: true,
      });
      await api.dispose();
    }
  });
});
