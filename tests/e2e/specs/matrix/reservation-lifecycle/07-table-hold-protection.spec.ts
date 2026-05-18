import { test, expect } from '../../../fixtures/test';
import { loginAsApi, loginAsSuperAdmin } from '../../../helpers/api';
import { createTable } from '../../../helpers/factories/tables';
import { createCategoryAndProduct } from '../../../helpers/factories/menu';
import { createPublicReservation } from '../../../helpers/factories/reservations';
import { setReservationSettings } from './_helpers';

/**
 * Three integration tests for the table-hold protection introduced in
 * v2.8.64:
 *   1. Walk-in `POST /orders` to a table with a CONFIRMED reservation
 *      starting within the 30-min hold window is rejected 400.
 *   2. Once the reservation is CANCELLED, the same walk-in succeeds.
 *   3. `GET /tables` surfaces the reservation as `upcomingReservation`
 *      so the floor plan / POS can render a banner.
 *
 * The full scheduler tick (auto-RESERVED + release-holds) is a cron
 * job — we exercise its outputs via direct DB state inspection rather
 * than waiting 5 minutes for the @Cron trigger. The lifecycle
 * cleanup path (rejecting a reservation drops the hold immediately)
 * is the path we hit from the API.
 */
test.describe('Reservation lifecycle — table hold protection', () => {
  test('walk-in to a table with imminent reservation is rejected', async ({ demoTenantId }) => {
    const { api } = await loginAsApi('admin');
    const { api: superApi } = await loginAsSuperAdmin();

    const settingsHandle = await setReservationSettings(api, {
      isEnabled: true,
      requireApproval: false,
      operatingHours: {
        monday: { open: '00:00', close: '23:30' },
        tuesday: { open: '00:00', close: '23:30' },
        wednesday: { open: '00:00', close: '23:30' },
        thursday: { open: '00:00', close: '23:30' },
        friday: { open: '00:00', close: '23:30' },
        saturday: { open: '00:00', close: '23:30' },
        sunday: { open: '00:00', close: '23:30' },
      },
      minAdvanceBooking: 0,
      cancellationDeadline: 0,
      // Earlier reservation specs (esp. 06-available-slots) may have
      // left a tight maxReservationsPerSlot in place. Override to a
      // large value so a stray e2e reservation in the same minute
      // doesn't trip "This time slot is fully booked".
      maxReservationsPerSlot: 999,
    });
    test.skip(settingsHandle.skip, settingsHandle.reason);

    const table = await createTable(api, { capacity: 4 });
    const { product } = await createCategoryAndProduct(api, { price: 50 });
    let reservationId: string | undefined;

    try {
      // Schedule the reservation for ~15 minutes from now: well inside
      // the 30-min hold window, so the walk-in guard must fire.
      const now = new Date();
      const start = new Date(now.getTime() + 15 * 60_000);
      const end = new Date(start.getTime() + 60 * 60_000);
      const toHHMM = (d: Date) =>
        `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      // Build the YYYY-MM-DD string from LOCAL date components, not
      // `toISOString().slice(0,10)`. The latter is UTC and drifts a day
      // off when local time is the other side of midnight UTC; backend
      // parses the field as a local-tz date so the formats must match.
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

      const reservation = await createPublicReservation(demoTenantId, {
        date: todayStr,
        startTime: toHHMM(start),
        endTime: toHHMM(end),
        guestCount: 2,
        tableId: table.id,
      });
      reservationId = reservation.id;
      expect(reservation.status).toBe('CONFIRMED');

      // Walk-in attempt — should be refused with the reservation
      // overlap message (Turkish copy from orders.service).
      const blocked = await api.post('orders', {
        data: {
          type: 'DINE_IN',
          tableId: table.id,
          items: [{ productId: product.id, quantity: 1 }],
        },
      });
      expect(blocked.status()).toBe(400);
      const body = await blocked.json();
      expect(body.message).toMatch(/rezervasyon var|reservation/i);
    } finally {
      // Cleanup: cancel the reservation if we created it, restore
      // settings, dispose contexts.
      if (reservationId) {
        await api
          .patch(`reservations/${reservationId}/cancel`, { data: {} })
          .catch(() => undefined);
      }
      if (!settingsHandle.skip) {
        await api
          .patch('reservations/settings/current', { data: settingsHandle.previous })
          .catch(() => undefined);
      }
      await api.dispose();
      void superApi; // superadmin context is cached process-wide
    }
  });

  test('cancelling the reservation releases the table and allows the walk-in', async ({ demoTenantId }) => {
    const { api } = await loginAsApi('admin');

    const settingsHandle = await setReservationSettings(api, {
      isEnabled: true,
      requireApproval: false,
      operatingHours: {
        monday: { open: '00:00', close: '23:30' },
        tuesday: { open: '00:00', close: '23:30' },
        wednesday: { open: '00:00', close: '23:30' },
        thursday: { open: '00:00', close: '23:30' },
        friday: { open: '00:00', close: '23:30' },
        saturday: { open: '00:00', close: '23:30' },
        sunday: { open: '00:00', close: '23:30' },
      },
      minAdvanceBooking: 0,
      cancellationDeadline: 0,
      // Earlier reservation specs (esp. 06-available-slots) may have
      // left a tight maxReservationsPerSlot in place. Override to a
      // large value so a stray e2e reservation in the same minute
      // doesn't trip "This time slot is fully booked".
      maxReservationsPerSlot: 999,
    });
    test.skip(settingsHandle.skip, settingsHandle.reason);

    const table = await createTable(api, { capacity: 4 });
    const { product } = await createCategoryAndProduct(api, { price: 30 });

    try {
      const now = new Date();
      const start = new Date(now.getTime() + 10 * 60_000);
      const end = new Date(start.getTime() + 60 * 60_000);
      const toHHMM = (d: Date) =>
        `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      const dToday = new Date();
      const todayStr = `${dToday.getFullYear()}-${String(dToday.getMonth() + 1).padStart(2, '0')}-${String(dToday.getDate()).padStart(2, '0')}`;

      const reservation = await createPublicReservation(demoTenantId, {
        date: todayStr,
        startTime: toHHMM(start),
        endTime: toHHMM(end),
        guestCount: 2,
        tableId: table.id,
      });

      // Cancel: this should release any hold and allow walk-ins again.
      const cancelRes = await api.patch(`reservations/${reservation.id}/cancel`, {
        data: {},
      });
      expect(cancelRes.ok()).toBeTruthy();

      const ok = await api.post('orders', {
        data: {
          type: 'DINE_IN',
          tableId: table.id,
          items: [{ productId: product.id, quantity: 1 }],
        },
      });
      expect(
        ok.ok(),
        `Expected walk-in to succeed after reservation cancel, got ${ok.status()}: ${await ok.text()}`,
      ).toBeTruthy();
    } finally {
      if (!settingsHandle.skip) {
        await api
          .patch('reservations/settings/current', { data: settingsHandle.previous })
          .catch(() => undefined);
      }
      await api.dispose();
    }
  });

  test('GET /tables annotates each table with the next upcoming reservation', async ({ demoTenantId }) => {
    const { api } = await loginAsApi('admin');

    const settingsHandle = await setReservationSettings(api, {
      isEnabled: true,
      requireApproval: false,
      operatingHours: {
        monday: { open: '00:00', close: '23:30' },
        tuesday: { open: '00:00', close: '23:30' },
        wednesday: { open: '00:00', close: '23:30' },
        thursday: { open: '00:00', close: '23:30' },
        friday: { open: '00:00', close: '23:30' },
        saturday: { open: '00:00', close: '23:30' },
        sunday: { open: '00:00', close: '23:30' },
      },
      minAdvanceBooking: 0,
      cancellationDeadline: 0,
      // Earlier reservation specs (esp. 06-available-slots) may have
      // left a tight maxReservationsPerSlot in place. Override to a
      // large value so a stray e2e reservation in the same minute
      // doesn't trip "This time slot is fully booked".
      maxReservationsPerSlot: 999,
    });
    test.skip(settingsHandle.skip, settingsHandle.reason);

    const table = await createTable(api, { capacity: 4 });
    let reservationId: string | undefined;

    try {
      // Reservation at ~45 min ahead — outside the 30-min hold window
      // (so no walk-in block) but inside the 120-min upcoming window
      // (so it surfaces on the table).
      const now = new Date();
      const start = new Date(now.getTime() + 45 * 60_000);
      const end = new Date(start.getTime() + 60 * 60_000);
      const toHHMM = (d: Date) =>
        `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      const dToday = new Date();
      const todayStr = `${dToday.getFullYear()}-${String(dToday.getMonth() + 1).padStart(2, '0')}-${String(dToday.getDate()).padStart(2, '0')}`;

      const reservation = await createPublicReservation(demoTenantId, {
        date: todayStr,
        startTime: toHHMM(start),
        endTime: toHHMM(end),
        guestCount: 3,
        customerName: 'Floor-Plan Test',
        tableId: table.id,
      });
      reservationId = reservation.id;

      const tablesRes = await api.get('tables');
      expect(tablesRes.ok()).toBeTruthy();
      const tables = (await tablesRes.json()) as Array<{
        id: string;
        upcomingReservation: {
          startTime: string;
          customerName: string;
          guestCount: number;
        } | null;
      }>;
      const row = tables.find((t) => t.id === table.id);
      expect(row, 'created table should appear in /tables list').toBeTruthy();
      expect(row!.upcomingReservation).toBeTruthy();
      expect(row!.upcomingReservation!.customerName).toBe('Floor-Plan Test');
      expect(row!.upcomingReservation!.guestCount).toBe(3);
      expect(row!.upcomingReservation!.startTime).toBe(toHHMM(start));
    } finally {
      if (reservationId) {
        await api
          .patch(`reservations/${reservationId}/cancel`, { data: {} })
          .catch(() => undefined);
      }
      if (!settingsHandle.skip) {
        await api
          .patch('reservations/settings/current', { data: settingsHandle.previous })
          .catch(() => undefined);
      }
      await api.dispose();
    }
  });
});
