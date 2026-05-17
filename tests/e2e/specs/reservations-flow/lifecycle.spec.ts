import { test, expect } from '../../fixtures/test';
import { loginAsApi } from '../../helpers/api';
import {
  createPublicReservation,
  confirmReservation,
  rejectReservation,
  markNoShow,
} from '../../helpers/factories';

test.describe('Reservations — full lifecycle', () => {
  test('public booking → admin confirmation', async () => {
    const { api, user } = await loginAsApi('admin');
    const r = await createPublicReservation(user.tenantId);
    expect(r.reservationNumber).toBeTruthy();
    expect(r.status).toMatch(/PENDING|TENTATIVE|PENDING_CUSTOMER_RESPONSE|CONFIRMED/i);

    await confirmReservation(api, r.id);
    const after = await (await api.get(`reservations/${r.id}`)).json();
    expect(after.status).toBe('CONFIRMED');
  });

  test('public booking → admin rejection', async () => {
    const { api, user } = await loginAsApi('admin');
    const r = await createPublicReservation(user.tenantId);
    await rejectReservation(api, r.id);
    const after = await (await api.get(`reservations/${r.id}`)).json();
    expect(after.status).toBe('REJECTED');
  });

  test('confirmed reservation can be marked NO_SHOW', async () => {
    const { api, user } = await loginAsApi('admin');
    const r = await createPublicReservation(user.tenantId);
    await confirmReservation(api, r.id);
    await markNoShow(api, r.id);
    const after = await (await api.get(`reservations/${r.id}`)).json();
    expect(after.status).toBe('NO_SHOW');
  });

  test('past dates are rejected at booking time', async () => {
    const { user } = await loginAsApi('admin');
    // Backend rejects past dates outright (see ReservationsService:89-91).
    await expect(
      createPublicReservation(user.tenantId, { date: '2020-01-01' }),
    ).rejects.toThrow(/4\d\d/);
  });
});
