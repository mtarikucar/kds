import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { TransferTableOrdersDto } from './transfer-table.dto';

/**
 * Validation spec for TransferTableOrdersDto. Source/target table IDs are
 * required non-empty strings; allowMerge is an optional boolean.
 */
describe('TransferTableOrdersDto', () => {
  async function validateDto(input: Record<string, unknown>): Promise<string[]> {
    const dto = plainToInstance(TransferTableOrdersDto, input) as object;
    const errors = await validate(dto);
    return errors.flatMap((e) => Object.values(e.constraints ?? {}));
  }

  it('accepts both table ids with no allowMerge', async () => {
    expect(
      await validateDto({ sourceTableId: 'a', targetTableId: 'b' }),
    ).toEqual([]);
  });

  it('accepts an explicit allowMerge boolean', async () => {
    expect(
      await validateDto({
        sourceTableId: 'a',
        targetTableId: 'b',
        allowMerge: false,
      }),
    ).toEqual([]);
  });

  it('rejects an empty sourceTableId (IsNotEmpty)', async () => {
    const msgs = await validateDto({ sourceTableId: '', targetTableId: 'b' });
    expect(msgs.some((m) => /sourceTableId/i.test(m))).toBe(true);
  });

  it('rejects a missing targetTableId', async () => {
    const msgs = await validateDto({ sourceTableId: 'a' });
    expect(msgs.some((m) => /targetTableId/i.test(m))).toBe(true);
  });

  it('rejects a non-boolean allowMerge', async () => {
    const msgs = await validateDto({
      sourceTableId: 'a',
      targetTableId: 'b',
      allowMerge: 'yes',
    });
    expect(msgs.some((m) => /allowMerge/i.test(m))).toBe(true);
  });
});
