import { test, expect } from '../../../fixtures/test';
import { loginAsApi } from '../../../helpers/api';
import { setReservationSettings } from '../../../helpers/factories';
import { createPublicReservation } from '../../../helpers/factories/reservations';

/**
 * Matrix: `requireApproval` true vs false.
 *
 * In createPublicReservation:
 *   const status = settings.requireApproval
 *     ? ReservationStatus.PENDING
 *     : ReservationStatus.CONFIRMED;
 *
 * So a fresh public booking lands as PENDING when the flag is on, and
 * auto-CONFIRMED when off. We verify the returned status field directly.
 */
test.describe('Reservation settings — requireApproval', () => {
  test('requireApproval=true → new public reservation is PENDING', async ({ demoTenantId }) => {
    const { api } = await loginAsApi('admin');
    try {
      await setReservationSettings(api, { requireApproval: true });

      const created = await createPublicReservation(demoTenantId);
      expect(created.status).toBe('PENDING');
    } finally {
      await setReservationSettings(api, { requireApproval: true });
      await api.dispose();
    }
  });

  test('requireApproval=false → new public reservation is CONFIRMED', async ({
    demoTenantId,
  }) => {
    const { api } = await loginAsApi('admin');
    try {
      await setReservationSettings(api, { requireApproval: false });

      const created = await createPublicReservation(demoTenantId);
      expect(created.status).toBe('CONFIRMED');
    } finally {
      // Default in seed is requireApproval=true — restore that so other
      // suites see the same baseline.
      await setReservationSettings(api, { requireApproval: true });
      await api.dispose();
    }
  });
});
