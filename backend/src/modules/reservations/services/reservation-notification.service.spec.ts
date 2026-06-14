import { ReservationNotificationService } from './reservation-notification.service';

/**
 * Spec for the channel-aware reservation notifier. Covers the routing matrix:
 *  - email taken only when customerEmail present AND emailOnReservation<Event> on
 *  - email success → no SMS; email returns false / throws → SMS fallback
 *  - no customerPhone after email path exhausted → silent no-op
 *  - each event maps to its dedicated SMS notify method
 */
function makeService(settings: Record<string, unknown>) {
  const email = { sendEmail: jest.fn() };
  const sms = {
    notifyReservationCreated: jest.fn().mockResolvedValue(undefined),
    notifyReservationConfirmed: jest.fn().mockResolvedValue(undefined),
    notifyReservationRejected: jest.fn().mockResolvedValue(undefined),
    notifyReservationCancelled: jest.fn().mockResolvedValue(undefined),
  };
  const smsSettings = { findByTenant: jest.fn().mockResolvedValue(settings) };
  const svc = new ReservationNotificationService(
    email as any,
    sms as any,
    smsSettings as any,
  );
  return { svc, email, sms, smsSettings };
}

const baseCtx = {
  customerName: 'Ali',
  customerEmail: 'ali@example.com',
  customerPhone: '+905551234567',
  date: '2026-03-01',
  startTime: '19:00',
  reservationNumber: 'RSV-1',
};

describe('ReservationNotificationService.notify', () => {
  it('sends email (and skips SMS) when email toggle is on and email succeeds', async () => {
    const { svc, email, sms } = makeService({ emailOnReservationCreated: true });
    email.sendEmail.mockResolvedValue(true);
    await svc.notify('t1', 'created', baseCtx);
    expect(email.sendEmail).toHaveBeenCalledTimes(1);
    expect(email.sendEmail.mock.calls[0][0]).toMatchObject({
      to: 'ali@example.com',
      template: 'reservation-created',
    });
    expect(sms.notifyReservationCreated).not.toHaveBeenCalled();
  });

  it('falls back to SMS when the email toggle is off', async () => {
    const { svc, email, sms } = makeService({ emailOnReservationConfirmed: false });
    await svc.notify('t1', 'confirmed', baseCtx);
    expect(email.sendEmail).not.toHaveBeenCalled();
    expect(sms.notifyReservationConfirmed).toHaveBeenCalledTimes(1);
  });

  it('falls back to SMS when sendEmail returns false', async () => {
    const { svc, email, sms } = makeService({ emailOnReservationCreated: true });
    email.sendEmail.mockResolvedValue(false);
    await svc.notify('t1', 'created', baseCtx);
    expect(sms.notifyReservationCreated).toHaveBeenCalledTimes(1);
  });

  it('falls back to SMS when sendEmail throws', async () => {
    const { svc, email, sms } = makeService({ emailOnReservationRejected: true });
    email.sendEmail.mockRejectedValue(new Error('smtp down'));
    await svc.notify('t1', 'rejected', { ...baseCtx, reason: 'full' });
    expect(sms.notifyReservationRejected).toHaveBeenCalledTimes(1);
  });

  it('no-ops when there is no phone and email is unavailable', async () => {
    const { svc, email, sms } = makeService({ emailOnReservationCreated: false });
    await svc.notify('t1', 'created', { ...baseCtx, customerPhone: null });
    expect(email.sendEmail).not.toHaveBeenCalled();
    expect(sms.notifyReservationCreated).not.toHaveBeenCalled();
  });

  it('routes the cancelled event to the cancelled SMS method', async () => {
    const { svc, sms } = makeService({});
    await svc.notify('t1', 'cancelled', { ...baseCtx, customerEmail: null });
    expect(sms.notifyReservationCancelled).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ reservationNumber: 'RSV-1' }),
    );
  });
});
