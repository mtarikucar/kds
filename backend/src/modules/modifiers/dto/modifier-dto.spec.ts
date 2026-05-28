import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateModifierDto } from './create-modifier.dto';
import { CreateModifierGroupDto, SelectionType } from './create-modifier-group.dto';
import { AssignModifierGroupDto, AssignModifiersToProductDto } from './assign-modifiers.dto';

/**
 * Iter-56 regressions for modifiers DTO validation.
 *
 * The original DTOs accepted unbounded strings (name / displayName /
 * description) and an unbounded priceAdjustment. Modifier.description
 * is a Postgres TEXT column with no implicit ceiling, and
 * priceAdjustment is Decimal(10, 2) — anything above 99,999,999.99
 * surfaces as a 500 from Postgres. The schema cap is the absolute floor;
 * we want the DTO to reject obvious junk well before then.
 *
 * groupId on CreateModifierDto / AssignModifierGroupDto was @IsString,
 * not @IsUUID — letting non-UUID strings through to Prisma which
 * silently no-matches, producing a misleading "modifier group is
 * invalid" error from createModifier. Tightening to @IsUUID surfaces
 * the actual problem at validation time.
 */
describe('modifier DTOs (iter-56)', () => {
  async function errors(dto: object): Promise<string[]> {
    const results = await validate(dto);
    return results.flatMap((e) => Object.values(e.constraints ?? {}));
  }

  describe('CreateModifierGroupDto', () => {
    const base = { name: 'sauces', displayName: 'Soslar' };

    it('accepts a normal payload', async () => {
      const dto = plainToInstance(CreateModifierGroupDto, base);
      expect(await errors(dto)).toEqual([]);
    });

    it('rejects name longer than 100 chars', async () => {
      const dto = plainToInstance(CreateModifierGroupDto, { ...base, name: 'x'.repeat(101) });
      const msgs = await errors(dto);
      expect(msgs.some((m) => /name/i.test(m))).toBe(true);
    });

    it('rejects displayName longer than 200 chars', async () => {
      const dto = plainToInstance(CreateModifierGroupDto, { ...base, displayName: 'y'.repeat(201) });
      const msgs = await errors(dto);
      expect(msgs.some((m) => /displayName/i.test(m))).toBe(true);
    });

    it('rejects description longer than 2000 chars', async () => {
      const dto = plainToInstance(CreateModifierGroupDto, { ...base, description: 'z'.repeat(2001) });
      const msgs = await errors(dto);
      expect(msgs.some((m) => /description/i.test(m))).toBe(true);
    });

    it('caps maxSelections at 50', async () => {
      const dto = plainToInstance(CreateModifierGroupDto, { ...base, maxSelections: 51 });
      const msgs = await errors(dto);
      expect(msgs.some((m) => /maxSelections/i.test(m))).toBe(true);
    });
  });

  describe('CreateModifierDto', () => {
    const base = {
      name: 'extra_cheese',
      displayName: 'Ekstra Peynir',
      groupId: '550e8400-e29b-41d4-a716-446655440000',
    };

    it('accepts a normal payload', async () => {
      const dto = plainToInstance(CreateModifierDto, base);
      expect(await errors(dto)).toEqual([]);
    });

    it('rejects a non-UUID groupId', async () => {
      const dto = plainToInstance(CreateModifierDto, { ...base, groupId: 'not-a-uuid' });
      const msgs = await errors(dto);
      expect(msgs.some((m) => /groupId/i.test(m))).toBe(true);
    });

    it('rejects priceAdjustment above the Max cap', async () => {
      const dto = plainToInstance(CreateModifierDto, { ...base, priceAdjustment: 10_001 });
      const msgs = await errors(dto);
      expect(msgs.some((m) => /priceAdjustment/i.test(m))).toBe(true);
    });

    it('rejects negative priceAdjustment (Min 0 enforced explicitly)', async () => {
      const dto = plainToInstance(CreateModifierDto, { ...base, priceAdjustment: -1 });
      const msgs = await errors(dto);
      expect(msgs.some((m) => /priceAdjustment/i.test(m))).toBe(true);
    });

    it('rejects Number.MAX_SAFE_INTEGER — the load-bearing Decimal overflow guard', async () => {
      const dto = plainToInstance(CreateModifierDto, { ...base, priceAdjustment: Number.MAX_SAFE_INTEGER });
      const msgs = await errors(dto);
      expect(msgs.some((m) => /priceAdjustment/i.test(m))).toBe(true);
    });
  });

  describe('AssignModifiersToProductDto.modifierGroups[].groupId', () => {
    it('rejects array elements with non-UUID groupId', async () => {
      const dto = plainToInstance(AssignModifiersToProductDto, {
        modifierGroups: [{ groupId: 'not-a-uuid' }],
      });
      const all = await validate(dto);
      // class-validator surfaces nested errors under the parent key —
      // assert the validation produced ANY error rather than a specific shape.
      expect(all.length).toBeGreaterThan(0);
    });

    it('accepts a UUID groupId', async () => {
      const dto = plainToInstance(AssignModifiersToProductDto, {
        modifierGroups: [{ groupId: '550e8400-e29b-41d4-a716-446655440000' }],
      });
      const all = await validate(dto);
      expect(all).toEqual([]);
    });
  });
});
