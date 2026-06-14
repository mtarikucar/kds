import { Logger } from '@nestjs/common';
import { SmsNotificationService } from './sms-notification.service';

/**
 * SmsNotificationService is the gating + templating layer between domain
 * events (reservation / order lifecycle) and the raw SmsService transport.
 *
 * The behaviours that matter (exercised through the PUBLIC notify* methods,
 * which is where the private sendIfEnabled gate actually runs):
 *
 *  - GATING: a message is dispatched only when (a) a phone is present,
 *    (b) settings.isEnabled is true, and (c) the per-event toggle is true.
 *    Any of these failing means smsService.send is NEVER called.
 *  - FIRE-AND-FORGET: send() is not awaited; a rejected send is caught and
 *    logged, never propagated to the caller.
 *  - RESILIENCE: a throw while loading settings is swallowed (the notify*
 *    call still resolves) so a settings-store hiccup can't break the
 *    domain flow that triggered it.
 *  - TEMPLATING: each notify* passes the correct per-event setting key,
 *    the customer's phone, and a message containing the event payload;
 *    the reservation-rejected reason is conditionally appended.
 */
describe('SmsNotificationService', () => {
  let smsService: { send: jest.Mock };
  let smsSettingsService: { findByTenant: jest.Mock };
  let svc: SmsNotificationService;

  const tenantId = 't-1';

  // All toggles on by default; individual tests override.
  const allEnabled = {
    isEnabled: true,
    smsOnReservationCreated: true,
    smsOnReservationConfirmed: true,
    smsOnReservationRejected: true,
    smsOnReservationCancelled: true,
    smsOnOrderCreated: true,
    smsOnOrderApproved: true,
    smsOnOrderPreparing: true,
    smsOnOrderReady: true,
    smsOnOrderCancelled: true,
  };

  const resData = {
    customerPhone: '+905551112233',
    customerName: 'Ayse',
    date: '2026-07-01',
    startTime: '19:30',
    reservationNumber: 'R-42',
  };

  beforeEach(() => {
    smsService = { send: jest.fn().mockResolvedValue({ success: true }) };
    smsSettingsService = {
      findByTenant: jest.fn().mockResolvedValue({ ...allEnabled }),
    };
    svc = new SmsNotificationService(
      smsService as any,
      smsSettingsService as any,
    );
    // Silence the service's internal error logging in fire-and-forget /
    // resilience tests so a real failure is still visible if one occurs.
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // --- GATING -------------------------------------------------------------

  it('does not send when settings.isEnabled is false', async () => {
    smsSettingsService.findByTenant.mockResolvedValue({
      ...allEnabled,
      isEnabled: false,
    });

    await svc.notifyReservationCreated(tenantId, resData);

    expect(smsService.send).not.toHaveBeenCalled();
  });

  it('does not send when the per-event toggle is false even if globally enabled', async () => {
    smsSettingsService.findByTenant.mockResolvedValue({
      ...allEnabled,
      smsOnReservationCreated: false,
    });

    await svc.notifyReservationCreated(tenantId, resData);

    expect(smsService.send).not.toHaveBeenCalled();
  });

  it('does not send (and never loads settings) when the phone is empty', async () => {
    await svc.notifyReservationCreated(tenantId, {
      ...resData,
      customerPhone: '',
    });

    expect(smsService.send).not.toHaveBeenCalled();
    expect(smsSettingsService.findByTenant).not.toHaveBeenCalled();
  });

  it('sends when global + per-event toggles are both on', async () => {
    await svc.notifyReservationCreated(tenantId, resData);

    expect(smsService.send).toHaveBeenCalledTimes(1);
    expect(smsSettingsService.findByTenant).toHaveBeenCalledWith(tenantId);
  });

  // --- FIRE-AND-FORGET / RESILIENCE --------------------------------------

  it('does not reject the caller when the underlying send() rejects (fire-and-forget)', async () => {
    smsService.send.mockRejectedValue(new Error('provider down'));

    await expect(
      svc.notifyReservationCreated(tenantId, resData),
    ).resolves.toBeUndefined();
    // It still attempted the send.
    expect(smsService.send).toHaveBeenCalledTimes(1);
  });

  it('does not reject the caller when loading settings throws (resilience)', async () => {
    smsSettingsService.findByTenant.mockRejectedValue(new Error('db down'));

    await expect(
      svc.notifyReservationCreated(tenantId, resData),
    ).resolves.toBeUndefined();
    expect(smsService.send).not.toHaveBeenCalled();
  });

  // --- TEMPLATING: reservations ------------------------------------------

  it('notifyReservationCreated uses the created key and a message with name/date/time/number', async () => {
    await svc.notifyReservationCreated(tenantId, resData);

    const [phone, message] = smsService.send.mock.calls[0];
    expect(phone).toBe(resData.customerPhone);
    expect(message).toContain('Ayse');
    expect(message).toContain('2026-07-01');
    expect(message).toContain('19:30');
    expect(message).toContain('R-42');
  });

  it('notifyReservationConfirmed gates on the confirmed key', async () => {
    smsSettingsService.findByTenant.mockResolvedValue({
      ...allEnabled,
      smsOnReservationConfirmed: false,
    });

    await svc.notifyReservationConfirmed(tenantId, resData);

    expect(smsService.send).not.toHaveBeenCalled();
  });

  it('notifyReservationRejected appends the reason when one is given', async () => {
    await svc.notifyReservationRejected(tenantId, {
      ...resData,
      reason: 'Yer kalmadi',
    });

    const message = smsService.send.mock.calls[0][1];
    expect(message).toContain('Sebep: Yer kalmadi');
  });

  it('notifyReservationRejected omits the reason clause when none is given', async () => {
    await svc.notifyReservationRejected(tenantId, resData);

    const message = smsService.send.mock.calls[0][1];
    expect(message).not.toContain('Sebep:');
  });

  // --- TEMPLATING: orders -------------------------------------------------

  it('notifyOrderReady sends with the order number when the order-ready toggle is on', async () => {
    await svc.notifyOrderReady(tenantId, {
      customerPhone: '+905550000000',
      orderNumber: 'ORD-9',
    });

    const [phone, message] = smsService.send.mock.calls[0];
    expect(phone).toBe('+905550000000');
    expect(message).toContain('ORD-9');
  });

  it('notifyOrderCancelled is gated by the order-cancelled toggle', async () => {
    smsSettingsService.findByTenant.mockResolvedValue({
      ...allEnabled,
      smsOnOrderCancelled: false,
    });

    await svc.notifyOrderCancelled(tenantId, {
      customerPhone: '+905550000000',
      orderNumber: 'ORD-9',
    });

    expect(smsService.send).not.toHaveBeenCalled();
  });
});
