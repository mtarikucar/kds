import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateDisplayPayIntentDto } from './create-display-pay-intent.dto';

/**
 * T5 sweep: CreateDisplayPayIntentDto.customerPhone used to validate
 * against the loose `/^\+?[1-9]\d{7,14}$/` variant. It carries
 * @NormalizePhone, so any naturally-typed number already resolves to
 * canonical E.164 before the regex runs — the '+' was already always
 * there in practice. The bare-digit case below is the "loose accepted it,
 * strict correctly doesn't" regression pin.
 */
describe('CreateDisplayPayIntentDto.customerPhone (T5 E164_PATTERN sweep)', () => {
  const base = {
    items: [{ orderItemId: '00000000-0000-0000-0000-000000000001', quantity: 1 }],
  };

  async function errors(input: Record<string, unknown>): Promise<string[]> {
    const dto = plainToInstance(CreateDisplayPayIntentDto, input);
    const results = await validate(dto as object);
    return results.flatMap((e) => Object.values(e.constraints ?? {}));
  }

  it('accepts undefined (optional field)', async () => {
    expect(await errors(base)).toEqual([]);
  });

  it('accepts a naturally-typed Turkish number (normalized to E.164)', async () => {
    expect(
      await errors({ ...base, customerPhone: '0555 123 45 67' }),
    ).toEqual([]);
  });

  it('rejects a bare-digit phone without "+" (loose-to-strict tightening)', async () => {
    // Not a parseable phone under the TR fallback region, so
    // @NormalizePhone passes it through unchanged — the old loose regex
    // accepted this shape; the shared E164_PATTERN rejects it.
    const msgs = await errors({ ...base, customerPhone: '12345678' });
    expect(msgs.some((m) => /customerPhone/i.test(m))).toBe(true);
  });
});
