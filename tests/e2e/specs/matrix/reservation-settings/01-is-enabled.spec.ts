import { test, expect } from '../../../fixtures/test';
import { request } from '@playwright/test';
import { loginAsApi, API_BASE } from '../../../helpers/api';
import { setReservationSettings } from '../../../helpers/factories';

/**
 * Matrix: `isEnabled` true vs false on ReservationSettings.
 *
 * Service-level guard lives in `createPublicReservation`:
 *
 *   if (!settings.isEnabled) {
 *     throw new BadRequestException('Reservation system is not enabled');
 *   }
 *
 * We hit the public POST endpoint directly (no auth) and assert the
 * HTTP shape, then flip back so subsequent specs see the default ON.
 *
 * NOTE: Sidebar visibility is gated on the plan feature
 * `reservationSystem`, not the ReservationSettings.isEnabled flag —
 * so this spec verifies the backend rule only.
 */
const SAMPLE_PAYLOAD = (suffix: string) => ({
  date: (() => {
    const d = new Date();
    d.setDate(d.getDate() + 3);
    return d.toISOString().slice(0, 10);
  })(),
  startTime: '19:00',
  endTime: '20:30',
  guestCount: 2,
  customerName: `E2E IsEnabled ${suffix}`,
  customerPhone: `+9055${suffix.slice(-8).padStart(8, '0')}`,
});

test.describe('Reservation settings — isEnabled gate', () => {
  test('isEnabled=false → public POST is rejected; isEnabled=true → succeeds', async () => {
    const { api } = await loginAsApi('admin');
    const { user } = await loginAsApi('admin');
    const tenantId = user.tenantId;

    try {
      // Flip OFF
      await setReservationSettings(api, { isEnabled: false });

      const publicCtx = await request.newContext({ baseURL: API_BASE });
      try {
        const ts = Date.now().toString();
        const offRes = await publicCtx.post(`public/reservations/${tenantId}`, {
          data: SAMPLE_PAYLOAD(ts),
        });
        expect(offRes.ok()).toBeFalsy();
        expect(offRes.status()).toBeGreaterThanOrEqual(400);
        expect(offRes.status()).toBeLessThan(500);
        const body = await offRes.text();
        expect(body.toLowerCase()).toContain('not enabled');

        // Flip ON and retry the same payload shape (different phone to
        // avoid the duplicate-reservation guard inside the service)
        await setReservationSettings(api, { isEnabled: true });

        const ts2 = (Date.now() + 1).toString();
        const onRes = await publicCtx.post(`public/reservations/${tenantId}`, {
          data: SAMPLE_PAYLOAD(ts2),
        });
        expect(onRes.ok()).toBeTruthy();
        const created = await onRes.json();
        expect(created.reservationNumber).toMatch(/^R-\d{8}-\d{3}$/);
      } finally {
        await publicCtx.dispose();
      }
    } finally {
      // Restore baseline
      await setReservationSettings(api, { isEnabled: true });
      await api.dispose();
    }
  });
});
