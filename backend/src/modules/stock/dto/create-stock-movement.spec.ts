import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateStockMovementDto } from './create-stock-movement.dto';
import { StockMovementType } from '../../../common/constants/order-status.enum';

/**
 * Iter-62 regression for CreateStockMovementDto:
 *  - productId was bare @IsString — non-UUIDs slipped through to Prisma
 *    where they no-matched, producing a misleading "Product not found".
 *  - quantity was @Min(1) with no @Max — Product.currentStock is
 *    Postgres int4 (max 2,147,483,647). An IN of 1e10 surfaced as a 500
 *    numeric_overflow instead of a 400.
 *  - reason / notes were unbounded strings — the columns are TEXT.
 *  - quantity was @IsNumber not @IsInt — fractional units silently
 *    truncated downstream.
 */
describe('CreateStockMovementDto (iter-62)', () => {
  async function errors(dto: object): Promise<string[]> {
    const results = await validate(dto);
    return results.flatMap((e) => Object.values(e.constraints ?? {}));
  }

  const base = {
    productId: '550e8400-e29b-41d4-a716-446655440000',
    type: StockMovementType.IN,
    quantity: 10,
  };

  it('accepts a typical movement', async () => {
    expect(await errors(plainToInstance(CreateStockMovementDto, base))).toEqual([]);
  });

  it('rejects non-UUID productId', async () => {
    const msgs = await errors(plainToInstance(CreateStockMovementDto, { ...base, productId: 'not-a-uuid' }));
    expect(msgs.some((m) => /productId/i.test(m))).toBe(true);
  });

  it('rejects fractional quantity', async () => {
    const msgs = await errors(plainToInstance(CreateStockMovementDto, { ...base, quantity: 2.5 }));
    expect(msgs.some((m) => /quantity/i.test(m))).toBe(true);
  });

  it('rejects quantity above the 1,000,000 cap', async () => {
    const msgs = await errors(plainToInstance(CreateStockMovementDto, { ...base, quantity: 1_000_001 }));
    expect(msgs.some((m) => /quantity/i.test(m))).toBe(true);
  });

  it('rejects Number.MAX_SAFE_INTEGER (the load-bearing int4 overflow guard)', async () => {
    const msgs = await errors(
      plainToInstance(CreateStockMovementDto, { ...base, quantity: Number.MAX_SAFE_INTEGER }),
    );
    expect(msgs.some((m) => /quantity/i.test(m))).toBe(true);
  });

  it('rejects reason longer than 200 chars', async () => {
    const msgs = await errors(plainToInstance(CreateStockMovementDto, { ...base, reason: 'r'.repeat(201) }));
    expect(msgs.some((m) => /reason/i.test(m))).toBe(true);
  });

  it('rejects notes longer than 2000 chars', async () => {
    const msgs = await errors(plainToInstance(CreateStockMovementDto, { ...base, notes: 'n'.repeat(2001) }));
    expect(msgs.some((m) => /notes/i.test(m))).toBe(true);
  });

  it('rejects an enum value not in StockMovementType', async () => {
    const msgs = await errors(plainToInstance(CreateStockMovementDto, { ...base, type: 'BOGUS' as any }));
    expect(msgs.some((m) => /type/i.test(m))).toBe(true);
  });
});
