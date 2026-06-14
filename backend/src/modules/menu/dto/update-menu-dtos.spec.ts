import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateProductDto } from './update-product.dto';
import { UpdateCategoryDto } from './update-category.dto';

/**
 * Validation specs for the menu update DTOs. Both extend PartialType of their
 * create DTO, so every field is optional ({} valid) but supplied fields still
 * validate against the original rules (price >=0, image URL regex, name caps).
 */
async function validateDto(cls: any, input: Record<string, unknown>): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, input) as object);
  const collect = (es: any[]): string[] =>
    es.flatMap((e) => [
      ...Object.values(e.constraints ?? {}),
      ...collect(e.children ?? []),
    ]) as string[];
  return collect(errors);
}

describe('UpdateProductDto (PartialType CreateProductDto)', () => {
  it('accepts an empty body', async () => {
    expect(await validateDto(UpdateProductDto, {})).toEqual([]);
  });

  it('accepts a single-field price update', async () => {
    expect(await validateDto(UpdateProductDto, { price: 19.99 })).toEqual([]);
  });

  it('still rejects a negative price (Min 0 preserved)', async () => {
    const msgs = await validateDto(UpdateProductDto, { price: -1 });
    expect(msgs.some((m) => /price/i.test(m))).toBe(true);
  });

  it('still rejects a javascript: image URL (Matches regex preserved)', async () => {
    const msgs = await validateDto(UpdateProductDto, { image: 'javascript:alert(1)' });
    expect(msgs.some((m) => /image/i.test(m))).toBe(true);
  });
});

describe('UpdateCategoryDto (PartialType CreateCategoryDto)', () => {
  it('accepts an empty body', async () => {
    expect(await validateDto(UpdateCategoryDto, {})).toEqual([]);
  });

  it('accepts a name-only update', async () => {
    expect(await validateDto(UpdateCategoryDto, { name: 'Sides' })).toEqual([]);
  });

  it('still rejects a name over 100 chars (MaxLength preserved)', async () => {
    const msgs = await validateDto(UpdateCategoryDto, { name: 'x'.repeat(101) });
    expect(msgs.some((m) => /name/i.test(m))).toBe(true);
  });
});
