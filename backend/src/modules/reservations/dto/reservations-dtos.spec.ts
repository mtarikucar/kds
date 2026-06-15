import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateReservationDto,
  CancelPublicReservationDto,
} from './create-reservation.dto';
import { UpdateReservationDto } from './update-reservation.dto';
import { ReservationQueryDto } from './reservation-query.dto';
import { UpdateReservationSettingsDto } from './update-reservation-settings.dto';
import { ReservationStatus } from '../constants/reservation-status.enum';

/**
 * Validation specs for the reservations DTOs:
 *  - Create: HH:mm time regex, guestCount 1..100, class-level @AtLeastOneOf
 *    (email OR phone), phone E.164 regex
 *  - Update: PartialType-style optionals with rules preserved
 *  - Query: status enum, paging coercion + bounds
 *  - Settings: numeric bounds (maxAdvanceDays, holdOffsetMinutes) + boolean coercion
 */
function collect(es: any[]): string[] {
  return es.flatMap((e) => [
    ...Object.values(e.constraints ?? {}),
    ...collect(e.children ?? []),
  ]) as string[];
}
async function validateDto(cls: any, input: Record<string, unknown>): Promise<string[]> {
  return collect(await validate(plainToInstance(cls, input) as object));
}

function validReservation(): Record<string, unknown> {
  return {
    date: '2026-03-01',
    startTime: '19:00',
    endTime: '20:30',
    guestCount: 4,
    customerName: 'John Doe',
    customerPhone: '+905551234567',
  };
}

describe('CreateReservationDto', () => {
  it('accepts a valid reservation (with phone)', async () => {
    expect(await validateDto(CreateReservationDto, validReservation())).toEqual([]);
  });

  it('accepts email instead of phone (AtLeastOneOf satisfied)', async () => {
    const r = validReservation();
    delete r.customerPhone;
    r.customerEmail = 'john@example.com';
    expect(await validateDto(CreateReservationDto, r)).toEqual([]);
  });

  it('rejects when BOTH email and phone are missing (AtLeastOneOf)', async () => {
    const r = validReservation();
    delete r.customerPhone;
    const msgs = await validateDto(CreateReservationDto, r);
    expect(msgs.some((m) => /customerEmail or customerPhone/i.test(m))).toBe(true);
  });

  it('rejects a malformed startTime (HH:mm regex)', async () => {
    const msgs = await validateDto(CreateReservationDto, { ...validReservation(), startTime: '25:99' });
    expect(msgs.some((m) => /Start time/i.test(m))).toBe(true);
  });

  it('rejects guestCount above 100 (Max)', async () => {
    const msgs = await validateDto(CreateReservationDto, { ...validReservation(), guestCount: 101 });
    expect(msgs.some((m) => /guestCount/i.test(m))).toBe(true);
  });

  it('rejects a junk phone (E.164 regex) when present', async () => {
    const msgs = await validateDto(CreateReservationDto, { ...validReservation(), customerPhone: 'call-me' });
    expect(msgs).toContain('Lütfen geçerli bir telefon numarası girin.');
  });

  it.each([
    '0555 123 45 67',
    '+90 555 123 45 67',
    '05551234567',
    '(0555) 123-45-67',
    '+905551234567',
  ])('normalizes the natural customerPhone %p to +905551234567', async (customerPhone) => {
    const dto = plainToInstance(CreateReservationDto, { ...validReservation(), customerPhone });
    expect(collect(await validate(dto as object))).toEqual([]);
    expect((dto as CreateReservationDto).customerPhone).toBe('+905551234567');
  });
});

describe('CancelPublicReservationDto', () => {
  it('accepts a valid phone + reservation number', async () => {
    expect(
      await validateDto(CancelPublicReservationDto, {
        customerPhone: '+905551234567',
        reservationNumber: 'RSV-123',
      }),
    ).toEqual([]);
  });

  it('rejects a junk phone', async () => {
    const msgs = await validateDto(CancelPublicReservationDto, {
      customerPhone: 'xyz',
      reservationNumber: 'RSV-123',
    });
    expect(msgs).toContain('Lütfen geçerli bir telefon numarası girin.');
  });

  it('normalizes a natural customerPhone to +905551234567', async () => {
    const dto = plainToInstance(CancelPublicReservationDto, {
      customerPhone: '0555 123 45 67',
      reservationNumber: 'RSV-123',
    });
    expect(collect(await validate(dto as object))).toEqual([]);
    expect((dto as CancelPublicReservationDto).customerPhone).toBe('+905551234567');
  });
});

describe('UpdateReservationDto', () => {
  it('accepts an empty body (all optional)', async () => {
    expect(await validateDto(UpdateReservationDto, {})).toEqual([]);
  });

  it('still rejects a malformed endTime', async () => {
    const msgs = await validateDto(UpdateReservationDto, { endTime: '99:99' });
    expect(msgs.some((m) => /End time/i.test(m))).toBe(true);
  });

  it('still rejects guestCount above 100', async () => {
    const msgs = await validateDto(UpdateReservationDto, { guestCount: 200 });
    expect(msgs.some((m) => /guestCount/i.test(m))).toBe(true);
  });
});

describe('ReservationQueryDto', () => {
  it('defaults page=1 and limit=50', async () => {
    const dto = plainToInstance(ReservationQueryDto, {});
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(50);
    expect(collect(await validate(dto as object))).toEqual([]);
  });

  it('coerces string page/limit to numbers', async () => {
    const dto = plainToInstance(ReservationQueryDto, { page: '3', limit: '20' });
    expect(dto.page).toBe(3);
    expect(dto.limit).toBe(20);
  });

  it('rejects limit above 100 (Max)', async () => {
    const msgs = await validateDto(ReservationQueryDto, { limit: '101' });
    expect(msgs.some((m) => /limit/i.test(m))).toBe(true);
  });

  it('accepts a valid status', async () => {
    expect(await validateDto(ReservationQueryDto, { status: ReservationStatus.CONFIRMED })).toEqual([]);
  });

  it('rejects an unknown status', async () => {
    const msgs = await validateDto(ReservationQueryDto, { status: 'MAYBE' });
    expect(msgs.some((m) => /status/i.test(m))).toBe(true);
  });
});

describe('UpdateReservationSettingsDto', () => {
  it('accepts an empty body', async () => {
    expect(await validateDto(UpdateReservationSettingsDto, {})).toEqual([]);
  });

  it('coerces string booleans (StringToBoolean) for isEnabled', async () => {
    const dto = plainToInstance(UpdateReservationSettingsDto, { isEnabled: 'true' });
    expect(dto.isEnabled).toBe(true);
    expect(collect(await validate(dto as object))).toEqual([]);
  });

  it('rejects maxAdvanceDays above 365 (Max)', async () => {
    const msgs = await validateDto(UpdateReservationSettingsDto, { maxAdvanceDays: 366 });
    expect(msgs.some((m) => /maxAdvanceDays/i.test(m))).toBe(true);
  });

  it('rejects holdOffsetMinutes above 240 (Max)', async () => {
    const msgs = await validateDto(UpdateReservationSettingsDto, { holdOffsetMinutes: 241 });
    expect(msgs.some((m) => /holdOffsetMinutes/i.test(m))).toBe(true);
  });

  it('rejects a negative minAdvanceBooking (Min 0)', async () => {
    const msgs = await validateDto(UpdateReservationSettingsDto, { minAdvanceBooking: -1 });
    expect(msgs.some((m) => /minAdvanceBooking/i.test(m))).toBe(true);
  });
});
