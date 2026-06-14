import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListHardwareOrdersQueryDto } from './list-hardware-orders.dto';

/**
 * Validation spec for the hardware-orders list query. status is optional but,
 * when present, must be one of the canonical HardwareOrder lifecycle states
 * (IsIn). An unknown value is rejected at the boundary.
 */
describe('ListHardwareOrdersQueryDto', () => {
  async function validateDto(input: Record<string, unknown>): Promise<string[]> {
    const dto = plainToInstance(ListHardwareOrdersQueryDto, input) as object;
    const errors = await validate(dto);
    return errors.flatMap((e) => Object.values(e.constraints ?? {}));
  }

  it('accepts an omitted status (all orders)', async () => {
    expect(await validateDto({})).toEqual([]);
  });

  it.each(['draft', 'pending_payment', 'paid', 'shipped', 'refunded'])(
    'accepts the canonical status %s',
    async (status) => {
      expect(await validateDto({ status })).toEqual([]);
    },
  );

  it('rejects an unknown status (IsIn guard)', async () => {
    const msgs = await validateDto({ status: 'teleported' });
    expect(msgs.some((m) => /status/i.test(m))).toBe(true);
  });
});
