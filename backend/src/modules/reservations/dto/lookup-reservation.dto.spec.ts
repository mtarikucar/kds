import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LookupReservationDto } from './lookup-reservation.dto';

/**
 * Iter-50 regression: public reservation lookup must reject malformed
 * or oversize inputs at the DTO layer. The endpoint was previously
 * accepting raw @Query strings — no length cap, no regex — and the
 * service then ran an equality match against indexed columns. With
 * the 10/min throttle a probing attacker could still send megabyte
 * query strings; URL strings aren't bounded by body-parser limits.
 */
describe('LookupReservationDto (iter-50)', () => {
  async function validateDto(input: Record<string, unknown>): Promise<string[]> {
    const dto = plainToInstance(LookupReservationDto, input) as object;
    const errors = await validate(dto);
    return errors.flatMap((e) => Object.values(e.constraints ?? {}));
  }

  it('accepts a normal lookup query', async () => {
    expect(
      await validateDto({
        phone: '+905551234567',
        reservationNumber: 'R-20260328-AB12',
      }),
    ).toEqual([]);
  });

  it('rejects phone > 20 chars', async () => {
    const msgs = await validateDto({
      phone: '+9' + '0'.repeat(30),
      reservationNumber: 'R-1',
    });
    expect(msgs.length).toBeGreaterThan(0);
  });

  it('rejects garbage phone strings (regex)', async () => {
    const msgs = await validateDto({
      phone: 'not-a-phone',
      reservationNumber: 'R-1',
    });
    expect(msgs.length).toBeGreaterThan(0);
  });

  it('rejects reservationNumber > 32 chars', async () => {
    const msgs = await validateDto({
      phone: '+905551234567',
      reservationNumber: 'R-' + 'X'.repeat(40),
    });
    expect(msgs.length).toBeGreaterThan(0);
  });

  it('rejects missing phone (PII-by-enum probing surface)', async () => {
    const msgs = await validateDto({ reservationNumber: 'R-1' });
    expect(msgs.length).toBeGreaterThan(0);
  });

  it('rejects missing reservationNumber', async () => {
    const msgs = await validateDto({ phone: '+905551234567' });
    expect(msgs.length).toBeGreaterThan(0);
  });
});
