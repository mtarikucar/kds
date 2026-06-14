import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateHardwareProductDto } from './update-hardware-product.dto';

/**
 * Validation spec for UpdateHardwareProductDto =
 * PartialType(OmitType(CreateHardwareProductDto, ['sku'])):
 *  - sku is OMITTED (immutable after creation) — a supplied sku is not validated
 *  - all other fields optional but rules preserved (category IsIn, priceCents
 *    >=0, name MaxLength)
 */
async function validateDto(input: Record<string, unknown>): Promise<string[]> {
  const errors = await validate(plainToInstance(UpdateHardwareProductDto, input) as object);
  const collect = (es: any[]): string[] =>
    es.flatMap((e) => [
      ...Object.values(e.constraints ?? {}),
      ...collect(e.children ?? []),
    ]) as string[];
  return collect(errors);
}

describe('UpdateHardwareProductDto', () => {
  it('accepts an empty body', async () => {
    expect(await validateDto({})).toEqual([]);
  });

  it('does not validate sku (immutable, omitted from schema)', async () => {
    const dto = plainToInstance(UpdateHardwareProductDto, { sku: 'ANY THING NOT A SKU' }) as any;
    const errors = await validate(dto);
    expect(errors.some((e: any) => e.property === 'sku')).toBe(false);
  });

  it('still rejects an unknown category (IsIn preserved)', async () => {
    const msgs = await validateDto({ category: 'spaceship' });
    expect(msgs.some((m) => /category/i.test(m))).toBe(true);
  });

  it('still rejects a negative priceCents (Min preserved)', async () => {
    const msgs = await validateDto({ priceCents: -1 });
    expect(msgs.some((m) => /priceCents/i.test(m))).toBe(true);
  });

  it('still rejects a name over 200 chars (MaxLength preserved)', async () => {
    const msgs = await validateDto({ name: 'x'.repeat(201) });
    expect(msgs.some((m) => /name/i.test(m))).toBe(true);
  });

  it('accepts a valid partial update', async () => {
    expect(await validateDto({ category: 'printer', priceCents: 50000 })).toEqual([]);
  });
});
