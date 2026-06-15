import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PayItemsDto } from './pay-items.dto';
import { SplitBillDto, SplitType } from './split-bill.dto';
import { CreatePayIntentDto } from '../../customer-orders/dto/pay-intent.dto';
import { UpdateReservationDto } from '../../reservations/dto/update-reservation.dto';
import { PaymentMethod } from '../../../common/constants/order-status.enum';

/**
 * Iter-54 regression spec — every DTO that surfaces a `customerPhone`
 * field MUST validate it against the shared E.164-ish PHONE_REGEX.
 *
 * Iter-42 hardened CreatePaymentDto in isolation; this run extends the
 * coverage to the four siblings that flow into the same
 * findOrCreateByPhone path (pay-items / split-bill / pay-intent) plus
 * the reservation update surface (whose customerPhone column is the
 * auth signal for the public reservation lookup).
 *
 * The load-bearing assertion is: a garbage string like "not-a-phone"
 * (or a 100KB blob) must fail validation on every surface so a
 * misbehaving client / typo can't sully Customer.phone canonicality.
 */
describe('customerPhone PHONE_REGEX parity (iter-54)', () => {
  async function errors(dto: object): Promise<string[]> {
    const results = await validate(dto);
    return results.flatMap((e) => Object.values(e.constraints ?? {}));
  }

  describe('PayItemsDto.customerPhone', () => {
    const base = {
      items: [{ orderItemId: '00000000-0000-0000-0000-000000000001', quantity: 1 }],
      method: PaymentMethod.CASH,
    };

    it('accepts a valid E.164-ish phone', async () => {
      const dto = plainToInstance(PayItemsDto, { ...base, customerPhone: '+905551234567' });
      expect(await errors(dto)).toEqual([]);
    });

    it('rejects junk strings', async () => {
      const dto = plainToInstance(PayItemsDto, { ...base, customerPhone: 'not-a-phone' });
      const msgs = await errors(dto);
      expect(msgs.some((m) => /customerPhone/i.test(m))).toBe(true);
    });

    it('rejects oversize payloads', async () => {
      const dto = plainToInstance(PayItemsDto, { ...base, customerPhone: '+9' + '0'.repeat(30) });
      const msgs = await errors(dto);
      expect(msgs.some((m) => /customerPhone/i.test(m))).toBe(true);
    });
  });

  describe('SplitBillDto.customerPhone', () => {
    const base = {
      splitType: SplitType.EQUAL,
      payments: [{ amount: 50, method: PaymentMethod.CASH }],
    };

    it('accepts a valid phone', async () => {
      const dto = plainToInstance(SplitBillDto, { ...base, customerPhone: '+905551234567' });
      expect(await errors(dto)).toEqual([]);
    });

    it('rejects junk', async () => {
      const dto = plainToInstance(SplitBillDto, { ...base, customerPhone: 'abc' });
      const msgs = await errors(dto);
      expect(msgs.some((m) => /customerPhone/i.test(m))).toBe(true);
    });
  });

  describe('CreatePayIntentDto.customerPhone', () => {
    const base = {
      items: [{ orderItemId: '00000000-0000-0000-0000-000000000001', quantity: 1 }],
    };

    it('accepts a valid phone', async () => {
      const dto = plainToInstance(CreatePayIntentDto, { ...base, customerPhone: '+905551234567' });
      expect(await errors(dto)).toEqual([]);
    });

    // The pre-iter-54 validator was Length(4, 32) — "junk-string!" passed.
    // After iter-54, the regex rejects it.
    it('rejects junk that previously passed Length(4,32)', async () => {
      const dto = plainToInstance(CreatePayIntentDto, { ...base, customerPhone: 'junk-string!' });
      const msgs = await errors(dto);
      expect(msgs.some((m) => /customerPhone/i.test(m))).toBe(true);
    });
  });

  describe('UpdateReservationDto.customerPhone', () => {
    it('accepts undefined (all fields optional in update)', async () => {
      const dto = plainToInstance(UpdateReservationDto, {});
      expect(await errors(dto)).toEqual([]);
    });

    it('accepts a valid phone', async () => {
      const dto = plainToInstance(UpdateReservationDto, { customerPhone: '+905551234567' });
      expect(await errors(dto)).toEqual([]);
    });

    it('rejects junk', async () => {
      // The reservation DTO now normalizes to E.164 (@NormalizePhone) and uses
      // the shared friendly "Lütfen geçerli bir telefon numarası girin." message
      // — which no longer contains the field name. The base object is otherwise
      // valid (the "accepts a valid phone" case above asserts []), so ANY error
      // here is the customerPhone rejection we're guarding.
      const dto = plainToInstance(UpdateReservationDto, { customerPhone: 'NOT-A-PHONE' });
      const msgs = await errors(dto);
      expect(msgs.length).toBeGreaterThan(0);
    });
  });
});
