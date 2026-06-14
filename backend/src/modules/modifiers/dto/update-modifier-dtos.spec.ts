import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateModifierDto } from './update-modifier.dto';
import { UpdateModifierGroupDto } from './update-modifier-group.dto';

/**
 * Validation specs for the modifier update DTOs.
 *  - UpdateModifierDto = PartialType(OmitType(CreateModifierDto, ['groupId'])):
 *    groupId is removed (immutable), other fields optional but still validated.
 *  - UpdateModifierGroupDto = PartialType(CreateModifierGroupDto): all optional,
 *    rules preserved (selectionType enum, maxSelections 1..50).
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

describe('UpdateModifierDto (PartialType + Omit groupId)', () => {
  it('accepts an empty body', async () => {
    expect(await validateDto(UpdateModifierDto, {})).toEqual([]);
  });

  it('omits groupId from the schema (immutable): a groupId value is ignored, no validation error', async () => {
    const dto = plainToInstance(UpdateModifierDto, { groupId: 'whatever' }) as any;
    // The property is not part of the DTO definition; no @IsUUID is applied.
    const errors = await validate(dto);
    expect(errors.some((e: any) => e.property === 'groupId')).toBe(false);
  });

  it('still rejects a priceAdjustment over 10000 (Max preserved)', async () => {
    const msgs = await validateDto(UpdateModifierDto, { priceAdjustment: 10001 });
    expect(msgs.some((m) => /priceAdjustment/i.test(m))).toBe(true);
  });

  it('still rejects a name over 100 chars (MaxLength preserved)', async () => {
    const msgs = await validateDto(UpdateModifierDto, { name: 'x'.repeat(101) });
    expect(msgs.some((m) => /name/i.test(m))).toBe(true);
  });
});

describe('UpdateModifierGroupDto (PartialType CreateModifierGroupDto)', () => {
  it('accepts an empty body', async () => {
    expect(await validateDto(UpdateModifierGroupDto, {})).toEqual([]);
  });

  it('accepts a valid selectionType', async () => {
    expect(await validateDto(UpdateModifierGroupDto, { selectionType: 'MULTIPLE' })).toEqual([]);
  });

  it('still rejects an unknown selectionType (enum preserved)', async () => {
    const msgs = await validateDto(UpdateModifierGroupDto, { selectionType: 'TRIPLE' });
    expect(msgs.some((m) => /selectionType/i.test(m))).toBe(true);
  });

  it('still rejects maxSelections over 50 (Max preserved)', async () => {
    const msgs = await validateDto(UpdateModifierGroupDto, { maxSelections: 51 });
    expect(msgs.some((m) => /maxSelections/i.test(m))).toBe(true);
  });
});
