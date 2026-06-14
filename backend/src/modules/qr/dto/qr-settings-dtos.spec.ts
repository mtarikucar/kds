import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateQrSettingsDto } from './create-qr-settings.dto';
import { UpdateQrSettingsDto } from './update-qr-settings.dto';

/**
 * Validation specs for QR menu settings:
 *  - colors validated as hex (@IsHexColor)
 *  - layoutStyle restricted to GRID|LIST|COMPACT (IsIn)
 *  - itemsPerRow 1..4
 *  - Update = PartialType(Create): optional, rules preserved
 */
async function validateDto(cls: any, input: Record<string, unknown>): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, input) as object);
  return errors.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe('CreateQrSettingsDto', () => {
  it('accepts an empty body (all optional)', async () => {
    expect(await validateDto(CreateQrSettingsDto, {})).toEqual([]);
  });

  it('accepts a valid hex primaryColor', async () => {
    expect(await validateDto(CreateQrSettingsDto, { primaryColor: '#3B82F6' })).toEqual([]);
  });

  it('rejects a non-hex primaryColor', async () => {
    const msgs = await validateDto(CreateQrSettingsDto, { primaryColor: 'blue' });
    expect(msgs.some((m) => /primaryColor/i.test(m))).toBe(true);
  });

  it('accepts a valid layoutStyle', async () => {
    expect(await validateDto(CreateQrSettingsDto, { layoutStyle: 'GRID' })).toEqual([]);
  });

  it('rejects an unknown layoutStyle (IsIn)', async () => {
    const msgs = await validateDto(CreateQrSettingsDto, { layoutStyle: 'CAROUSEL' });
    expect(msgs.some((m) => /layoutStyle/i.test(m))).toBe(true);
  });

  it('rejects itemsPerRow above 4 (Max)', async () => {
    const msgs = await validateDto(CreateQrSettingsDto, { itemsPerRow: 5 });
    expect(msgs.some((m) => /itemsPerRow/i.test(m))).toBe(true);
  });

  it('rejects itemsPerRow below 1 (Min)', async () => {
    const msgs = await validateDto(CreateQrSettingsDto, { itemsPerRow: 0 });
    expect(msgs.some((m) => /itemsPerRow/i.test(m))).toBe(true);
  });
});

describe('UpdateQrSettingsDto (PartialType CreateQrSettingsDto)', () => {
  it('accepts an empty body', async () => {
    expect(await validateDto(UpdateQrSettingsDto, {})).toEqual([]);
  });

  it('still rejects a non-hex color (rule preserved)', async () => {
    const msgs = await validateDto(UpdateQrSettingsDto, { backgroundColor: 'white' });
    expect(msgs.some((m) => /backgroundColor/i.test(m))).toBe(true);
  });

  it('still rejects an unknown layoutStyle (rule preserved)', async () => {
    const msgs = await validateDto(UpdateQrSettingsDto, { layoutStyle: 'NOPE' });
    expect(msgs.some((m) => /layoutStyle/i.test(m))).toBe(true);
  });
});
