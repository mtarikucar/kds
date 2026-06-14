import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { TableStatus } from './create-table.dto';
import { UpdateTableStatusDto } from './update-table-status.dto';
import { UpdateTableDto } from './update-table.dto';
import { MergeTablesDto, UnmergeTableDto } from './merge-tables.dto';

/**
 * Validation specs for the tables update/merge DTOs (create-table already
 * covered by create-table-dto.spec.ts).
 *  - UpdateTableStatusDto.status must be a TableStatus enum member
 *  - UpdateTableDto = PartialType(CreateTableDto): optional, rules preserved
 *  - MergeTablesDto: >=2 v4 uuids; UnmergeTableDto: single uuid
 */
function collect(es: any[]): string[] {
  return es.flatMap((e) => [
    ...Object.values(e.constraints ?? {}),
    ...collect(e.children ?? []),
  ]) as string[];
}
async function validateDto(cls: any, input: Record<string, unknown>): Promise<string[]> {
  return collect(await validate(plainToInstance(cls, input) as object));
}

const UUID_A = '6b0b887d-c741-4f8f-9f3f-08501f075aef';
const UUID_B = 'e5cd8e6c-1bbb-4fab-a6bf-5ef35b0d429b';

describe('UpdateTableStatusDto', () => {
  it('accepts a valid TableStatus', async () => {
    expect(await validateDto(UpdateTableStatusDto, { status: TableStatus.OCCUPIED })).toEqual([]);
  });

  it('rejects an unknown status', async () => {
    const msgs = await validateDto(UpdateTableStatusDto, { status: 'PARKED' });
    expect(msgs.some((m) => /status/i.test(m))).toBe(true);
  });
});

describe('UpdateTableDto (PartialType CreateTableDto)', () => {
  it('accepts an empty body', async () => {
    expect(await validateDto(UpdateTableDto, {})).toEqual([]);
  });

  it('accepts a capacity-only update', async () => {
    expect(await validateDto(UpdateTableDto, { capacity: 8 })).toEqual([]);
  });

  it('still rejects capacity above 200 (Max preserved)', async () => {
    const msgs = await validateDto(UpdateTableDto, { capacity: 201 });
    expect(msgs.some((m) => /capacity/i.test(m))).toBe(true);
  });

  it('still rejects a number over 32 chars (MaxLength preserved)', async () => {
    const msgs = await validateDto(UpdateTableDto, { number: 'x'.repeat(33) });
    expect(msgs.some((m) => /number/i.test(m))).toBe(true);
  });
});

describe('MergeTablesDto', () => {
  it('accepts two valid v4 uuids', async () => {
    expect(await validateDto(MergeTablesDto, { tableIds: [UUID_A, UUID_B] })).toEqual([]);
  });

  it('rejects fewer than 2 ids (ArrayMinSize)', async () => {
    const msgs = await validateDto(MergeTablesDto, { tableIds: [UUID_A] });
    expect(msgs.some((m) => /tableIds/i.test(m))).toBe(true);
  });

  it('rejects a non-uuid entry (IsUUID each)', async () => {
    const msgs = await validateDto(MergeTablesDto, { tableIds: [UUID_A, 'not-a-uuid'] });
    expect(msgs.some((m) => /tableIds/i.test(m))).toBe(true);
  });
});

describe('UnmergeTableDto', () => {
  it('accepts a single uuid', async () => {
    expect(await validateDto(UnmergeTableDto, { tableId: UUID_A })).toEqual([]);
  });

  it('rejects a non-uuid', async () => {
    const msgs = await validateDto(UnmergeTableDto, { tableId: 'x' });
    expect(msgs.some((m) => /tableId/i.test(m))).toBe(true);
  });
});
