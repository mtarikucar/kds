import { PublicReservationsController } from './public-reservations.controller';

/**
 * Spec for the @Public PublicReservationsController. Beyond forwarding, the
 * available-slots/tables handlers parse guestCount (string→int, NaN→undefined)
 * before forwarding, and lookup/cancel unwrap their DTOs.
 */
describe('PublicReservationsController', () => {
  let reservations: Record<string, jest.Mock>;
  let availability: Record<string, jest.Mock>;
  let settings: Record<string, jest.Mock>;
  let ctrl: PublicReservationsController;

  beforeEach(() => {
    reservations = {
      createPublicReservation: jest.fn().mockResolvedValue({ id: 'r1' }),
      lookupReservation: jest.fn().mockResolvedValue({ id: 'r1' }),
      cancelPublic: jest.fn().mockResolvedValue({ id: 'r1' }),
    };
    availability = {
      getAvailableSlots: jest.fn().mockResolvedValue([]),
      getAvailableTables: jest.fn().mockResolvedValue([]),
      listPublicBranches: jest.fn().mockResolvedValue([]),
    };
    settings = { getPublicSettings: jest.fn().mockResolvedValue({}) };
    ctrl = new PublicReservationsController(
      reservations as any,
      availability as any,
      settings as any,
    );
  });

  it('getSettings forwards the tenantId', () => {
    ctrl.getSettings('t1');
    expect(settings.getPublicSettings).toHaveBeenCalledWith('t1');
  });

  it('getAvailableSlots parses guestCount and forwards branchId', () => {
    ctrl.getAvailableSlots('t1', '2026-03-01', '4', 'br1');
    expect(availability.getAvailableSlots).toHaveBeenCalledWith('t1', '2026-03-01', 4, 'br1');
  });

  it('getAvailableSlots passes undefined guestCount when omitted', () => {
    ctrl.getAvailableSlots('t1', '2026-03-01');
    expect(availability.getAvailableSlots).toHaveBeenCalledWith(
      't1',
      '2026-03-01',
      undefined,
      undefined,
    );
  });

  it('getAvailableSlots coerces a non-numeric guestCount to undefined', () => {
    ctrl.getAvailableSlots('t1', '2026-03-01', 'abc');
    expect(availability.getAvailableSlots).toHaveBeenCalledWith(
      't1',
      '2026-03-01',
      undefined,
      undefined,
    );
  });

  it('getAvailableTables parses guestCount and forwards the time window', () => {
    ctrl.getAvailableTables('t1', '2026-03-01', '19:00', '20:30', '2', 'br1');
    expect(availability.getAvailableTables).toHaveBeenCalledWith(
      't1',
      '2026-03-01',
      '19:00',
      '20:30',
      2,
      'br1',
    );
  });

  it('create forwards tenantId + dto', () => {
    const dto = { date: '2026-03-01' } as any;
    ctrl.create('t1', dto);
    expect(reservations.createPublicReservation).toHaveBeenCalledWith('t1', dto);
  });

  it('listBranches forwards the tenantId', () => {
    ctrl.listBranches('t1');
    expect(availability.listPublicBranches).toHaveBeenCalledWith('t1');
  });

  it('lookup unwraps phone + reservationNumber from the dto', () => {
    ctrl.lookup('t1', { phone: '+905551234567', reservationNumber: 'RSV-1' } as any);
    expect(reservations.lookupReservation).toHaveBeenCalledWith('t1', '+905551234567', 'RSV-1');
  });

  it('cancelPublic forwards tenantId, id and the phone-proof body', () => {
    ctrl.cancelPublic('t1', 'r1', {
      customerPhone: '+905551234567',
      reservationNumber: 'RSV-1',
    } as any);
    expect(reservations.cancelPublic).toHaveBeenCalledWith('t1', 'r1', {
      customerPhone: '+905551234567',
      reservationNumber: 'RSV-1',
    });
  });
});
