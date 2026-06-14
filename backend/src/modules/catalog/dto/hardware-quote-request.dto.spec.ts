import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { HardwareQuoteRequestDto } from './hardware-quote-request.dto';

/**
 * Validation spec for the "Teklif Al" QUOTE_ONLY request:
 *  - sku: lowercase alnum+hyphen, 3-64 chars (Matches)
 *  - qty optional int 1..999
 *  - contactPerson required, <=120; phone optional <=40; email optional valid
 */
describe('HardwareQuoteRequestDto', () => {
  async function validateDto(input: Record<string, unknown>): Promise<string[]> {
    const dto = plainToInstance(HardwareQuoteRequestDto, input) as object;
    const errors = await validate(dto);
    return errors.flatMap((e) => Object.values(e.constraints ?? {}));
  }

  const base = () => ({ sku: 'yazarkasa-hugin-t300', contactPerson: 'Ahmet Yılmaz' });

  it('accepts a minimal valid request', async () => {
    expect(await validateDto(base())).toEqual([]);
  });

  it('rejects an uppercase sku (Matches regex)', async () => {
    const msgs = await validateDto({ ...base(), sku: 'BAD-SKU' });
    expect(msgs.some((m) => /sku/i.test(m))).toBe(true);
  });

  it('rejects a too-short sku', async () => {
    const msgs = await validateDto({ ...base(), sku: 'ab' });
    expect(msgs.some((m) => /sku/i.test(m))).toBe(true);
  });

  it('rejects qty above 999 (Max)', async () => {
    const msgs = await validateDto({ ...base(), qty: 1000 });
    expect(msgs.some((m) => /qty/i.test(m))).toBe(true);
  });

  it('rejects a missing contactPerson', async () => {
    const msgs = await validateDto({ sku: 'yazarkasa-hugin-t300' });
    expect(msgs.some((m) => /contactPerson/i.test(m))).toBe(true);
  });

  it('rejects an invalid email', async () => {
    const msgs = await validateDto({ ...base(), email: 'not-email' });
    expect(msgs.some((m) => /email/i.test(m))).toBe(true);
  });

  it('rejects notes over 2000 chars', async () => {
    const msgs = await validateDto({ ...base(), notes: 'x'.repeat(2001) });
    expect(msgs.some((m) => /notes/i.test(m))).toBe(true);
  });
});
