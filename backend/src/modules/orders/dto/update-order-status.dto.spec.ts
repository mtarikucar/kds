import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateOrderStatusDto } from './update-order-status.dto';
import { UpdateOrderDto } from './update-order.dto';
import { OrderStatus, OrderType } from '../../../common/constants/order-status.enum';

/**
 * Validation specs for the two status/update DTOs:
 *  - UpdateOrderStatusDto.status must be a real OrderStatus enum member
 *  - UpdateOrderDto extends PartialType(CreateOrderDto): every field becomes
 *    optional (so {} is valid) but supplied fields still validate.
 */
async function validateDto(cls: any, input: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(cls, input) as object;
  const errors = await validate(dto);
  const collect = (es: any[]): string[] =>
    es.flatMap((e) => [
      ...Object.values(e.constraints ?? {}),
      ...collect(e.children ?? []),
    ]) as string[];
  return collect(errors);
}

describe('UpdateOrderStatusDto', () => {
  it('accepts a valid OrderStatus', async () => {
    expect(await validateDto(UpdateOrderStatusDto, { status: OrderStatus.READY })).toEqual([]);
  });

  it('rejects an unknown status (enum guard)', async () => {
    const msgs = await validateDto(UpdateOrderStatusDto, { status: 'FLYING' });
    expect(msgs.some((m) => /status/i.test(m))).toBe(true);
  });

  it('rejects a missing status', async () => {
    const msgs = await validateDto(UpdateOrderStatusDto, {});
    expect(msgs.some((m) => /status/i.test(m))).toBe(true);
  });
});

describe('UpdateOrderDto (PartialType of CreateOrderDto)', () => {
  it('accepts an empty body (all fields optional)', async () => {
    expect(await validateDto(UpdateOrderDto, {})).toEqual([]);
  });

  it('accepts a partial update of one field', async () => {
    expect(await validateDto(UpdateOrderDto, { type: OrderType.TAKEAWAY })).toEqual([]);
  });

  it('still validates a supplied field (unknown type rejected)', async () => {
    const msgs = await validateDto(UpdateOrderDto, { type: 'NOPE' });
    expect(msgs.some((m) => /type/i.test(m))).toBe(true);
  });
});
