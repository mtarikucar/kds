import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateTableDto, TableStatus } from './create-table.dto';

/**
 * Iter-59 regression. CreateTableDto previously accepted:
 *  - Unbounded `number` — collides with the @@unique(tenantId, number)
 *    constraint accepting multi-MB blobs as the canonical id of a
 *    physical table.
 *  - Unbounded `section` — Postgres TEXT column with no implicit cap.
 *  - Unbounded `capacity` — downstream reservation-vs-table-capacity
 *    code treats 1e10 as effectively-infinite seating, defeating
 *    overbooking guards.
 */
describe('CreateTableDto (iter-59)', () => {
  async function errors(dto: object): Promise<string[]> {
    const results = await validate(dto);
    return results.flatMap((e) => Object.values(e.constraints ?? {}));
  }

  it('accepts a typical table payload', async () => {
    const dto = plainToInstance(CreateTableDto, { number: '1', capacity: 4 });
    expect(await errors(dto)).toEqual([]);
  });

  it('rejects number longer than 32 chars', async () => {
    const dto = plainToInstance(CreateTableDto, { number: 'T'.repeat(33), capacity: 4 });
    const msgs = await errors(dto);
    expect(msgs.some((m) => /number/i.test(m))).toBe(true);
  });

  it('rejects section longer than 100 chars', async () => {
    const dto = plainToInstance(CreateTableDto, {
      number: '1',
      capacity: 4,
      section: 'x'.repeat(101),
    });
    const msgs = await errors(dto);
    expect(msgs.some((m) => /section/i.test(m))).toBe(true);
  });

  it('rejects capacity above 200', async () => {
    const dto = plainToInstance(CreateTableDto, { number: '1', capacity: 201 });
    const msgs = await errors(dto);
    expect(msgs.some((m) => /capacity/i.test(m))).toBe(true);
  });

  it('rejects Number.MAX_SAFE_INTEGER capacity (the load-bearing overbooking-bypass guard)', async () => {
    const dto = plainToInstance(CreateTableDto, {
      number: '1',
      capacity: Number.MAX_SAFE_INTEGER,
    });
    const msgs = await errors(dto);
    expect(msgs.some((m) => /capacity/i.test(m))).toBe(true);
  });

  it('rejects capacity below 1', async () => {
    const dto = plainToInstance(CreateTableDto, { number: '1', capacity: 0 });
    const msgs = await errors(dto);
    expect(msgs.some((m) => /capacity/i.test(m))).toBe(true);
  });

  it('accepts the realistic Patio-12-A naming case', async () => {
    const dto = plainToInstance(CreateTableDto, {
      number: 'Patio-12-A',
      capacity: 4,
      section: 'Outdoor Patio',
      status: TableStatus.AVAILABLE,
    });
    expect(await errors(dto)).toEqual([]);
  });
});
