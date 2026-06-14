import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateOrderDto,
  CreateOrderItemDto,
  OrderItemModifierDto,
} from './create-order.dto';
import { OrderType } from '../../../common/constants/order-status.enum';

/**
 * Validation spec for the create-order DTO tree. Covers the enum/array
 * bounds and nested-item validation that protect the order pipeline:
 *  - type must be a real OrderType
 *  - items: 1..100, each validated (qty 1..9999)
 *  - modifiers: <=20, qty 1..20
 *  - idempotencyKey must be a UUID when present
 */
async function validateDto(
  cls: any,
  input: Record<string, unknown>,
): Promise<string[]> {
  const dto = plainToInstance(cls, input) as object;
  const errors = await validate(dto, { whitelist: false });
  // flatten nested constraint messages too
  const collect = (es: any[]): string[] =>
    es.flatMap((e) => [
      ...Object.values(e.constraints ?? {}),
      ...collect(e.children ?? []),
    ]) as string[];
  return collect(errors);
}

function validItem(): Record<string, unknown> {
  return { productId: 'p1', quantity: 2 };
}

describe('OrderItemModifierDto', () => {
  it('accepts qty within 1..20', async () => {
    expect(
      await validateDto(OrderItemModifierDto, { modifierId: 'm1', quantity: 5 }),
    ).toEqual([]);
  });

  it('rejects qty above 20', async () => {
    const msgs = await validateDto(OrderItemModifierDto, {
      modifierId: 'm1',
      quantity: 21,
    });
    expect(msgs.some((m) => /quantity/i.test(m))).toBe(true);
  });

  it('rejects qty below 1', async () => {
    const msgs = await validateDto(OrderItemModifierDto, {
      modifierId: 'm1',
      quantity: 0,
    });
    expect(msgs.some((m) => /quantity/i.test(m))).toBe(true);
  });
});

describe('CreateOrderItemDto', () => {
  it('accepts a minimal valid item', async () => {
    expect(await validateDto(CreateOrderItemDto, validItem())).toEqual([]);
  });

  it('rejects quantity above 9999', async () => {
    const msgs = await validateDto(CreateOrderItemDto, {
      productId: 'p1',
      quantity: 10000,
    });
    expect(msgs.some((m) => /quantity/i.test(m))).toBe(true);
  });

  it('rejects notes longer than 500 chars', async () => {
    const msgs = await validateDto(CreateOrderItemDto, {
      ...validItem(),
      notes: 'x'.repeat(501),
    });
    expect(msgs.some((m) => /notes/i.test(m))).toBe(true);
  });

  it('rejects more than 20 modifiers', async () => {
    const modifiers = Array.from({ length: 21 }, (_, i) => ({
      modifierId: `m${i}`,
      quantity: 1,
    }));
    const msgs = await validateDto(CreateOrderItemDto, {
      ...validItem(),
      modifiers,
    });
    expect(msgs.some((m) => /modifiers/i.test(m))).toBe(true);
  });
});

describe('CreateOrderDto', () => {
  it('accepts a minimal valid order', async () => {
    expect(
      await validateDto(CreateOrderDto, {
        type: OrderType.DINE_IN,
        items: [validItem()],
      }),
    ).toEqual([]);
  });

  it('rejects an unknown order type (enum guard)', async () => {
    const msgs = await validateDto(CreateOrderDto, {
      type: 'TELEPORT',
      items: [validItem()],
    });
    expect(msgs.some((m) => /type/i.test(m))).toBe(true);
  });

  it('rejects an empty items array (ArrayMinSize 1)', async () => {
    const msgs = await validateDto(CreateOrderDto, {
      type: OrderType.DINE_IN,
      items: [],
    });
    expect(msgs.some((m) => /items/i.test(m))).toBe(true);
  });

  it('rejects more than 100 items (ArrayMaxSize)', async () => {
    const items = Array.from({ length: 101 }, () => validItem());
    const msgs = await validateDto(CreateOrderDto, {
      type: OrderType.DINE_IN,
      items,
    });
    expect(msgs.some((m) => /items/i.test(m))).toBe(true);
  });

  it('rejects a negative discount (Min 0)', async () => {
    const msgs = await validateDto(CreateOrderDto, {
      type: OrderType.DINE_IN,
      items: [validItem()],
      discount: -5,
    });
    expect(msgs.some((m) => /discount/i.test(m))).toBe(true);
  });

  it('rejects a non-UUID idempotencyKey', async () => {
    const msgs = await validateDto(CreateOrderDto, {
      type: OrderType.DINE_IN,
      items: [validItem()],
      idempotencyKey: 'not-a-uuid',
    });
    expect(msgs.some((m) => /idempotencyKey/i.test(m))).toBe(true);
  });

  it('propagates a nested invalid item (ValidateNested each)', async () => {
    const msgs = await validateDto(CreateOrderDto, {
      type: OrderType.DINE_IN,
      items: [{ productId: 'p1', quantity: 0 }],
    });
    expect(msgs.some((m) => /quantity/i.test(m))).toBe(true);
  });
});
