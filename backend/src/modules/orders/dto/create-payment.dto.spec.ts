import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreatePaymentDto } from './create-payment.dto';
import { PaymentMethod } from '../../../common/constants/order-status.enum';

/**
 * Iter-42 regression tests for the DTO validation rules added to
 * CreatePaymentDto. Each test runs the DTO through class-validator
 * the same way NestJS's global ValidationPipe would, so the
 * assertions catch any future relaxation of the rules.
 */
describe('CreatePaymentDto validation (iter-42)', () => {
  const base = { amount: 100, method: PaymentMethod.CASH };

  async function validateDto(input: Record<string, unknown>): Promise<string[]> {
    const dto = plainToInstance(CreatePaymentDto, input);
    const errors = await validate(dto);
    return errors.flatMap((e) =>
      Object.values(e.constraints ?? {}),
    );
  }

  describe('amount', () => {
    it('accepts a normal payment amount', async () => {
      expect(await validateDto(base)).toEqual([]);
    });

    it('rejects amount above 10,000,000', async () => {
      const messages = await validateDto({ ...base, amount: 10_000_001 });
      expect(messages.some((m) => /amount/i.test(m))).toBe(true);
    });

    it('rejects amount below 0.01', async () => {
      const messages = await validateDto({ ...base, amount: 0 });
      expect(messages.some((m) => /amount/i.test(m))).toBe(true);
    });

    it('rejects Number.MAX_SAFE_INTEGER (the load-bearing iter-42 guard)', async () => {
      const messages = await validateDto({ ...base, amount: Number.MAX_SAFE_INTEGER });
      expect(messages.some((m) => /amount/i.test(m))).toBe(true);
    });
  });

  describe('notes', () => {
    it('accepts a short note', async () => {
      expect(await validateDto({ ...base, notes: 'Customer left a 20₺ tip' })).toEqual([]);
    });

    it('rejects notes longer than 500 chars', async () => {
      const messages = await validateDto({ ...base, notes: 'x'.repeat(501) });
      expect(messages.some((m) => /notes/i.test(m))).toBe(true);
    });
  });

  describe('customerPhone', () => {
    it('accepts a valid E.164-ish TR phone', async () => {
      expect(await validateDto({ ...base, customerPhone: '+905551234567' })).toEqual([]);
    });

    it('rejects garbage phone strings (regex mismatch)', async () => {
      const messages = await validateDto({ ...base, customerPhone: 'not-a-phone' });
      expect(messages.some((m) => /customerPhone/i.test(m))).toBe(true);
    });

    it('rejects oversize phone strings', async () => {
      const messages = await validateDto({ ...base, customerPhone: '+9' + '0'.repeat(30) });
      expect(messages.some((m) => /customerPhone/i.test(m))).toBe(true);
    });
  });
});
