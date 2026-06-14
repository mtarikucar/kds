import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateRecipeDto } from './update-recipe.dto';
import { UpdateStockSettingsDto } from './update-stock-settings.dto';
import {
  ListWasteLogsQueryDto,
  ListIngredientMovementsQueryDto,
} from './list-stock-logs.dto';
import { UpdateStockCountItemDto } from './update-stock-count-item.dto';
import { UpdateStockItemDto } from './update-stock-item.dto';
import { ReceivePurchaseOrderDto } from './receive-purchase-order.dto';
import { UpdateStockItemCategoryDto } from './update-stock-item-category.dto';
import { StockItemQueryDto } from './stock-item-query.dto';
import { OrderStatus } from '../../../common/constants/order-status.enum';
import {
  StockUnit,
  IngredientMovementType,
} from '../../../common/constants/stock-management.enum';

function collect(es: any[]): string[] {
  return es.flatMap((e) => [
    ...Object.values(e.constraints ?? {}),
    ...collect(e.children ?? []),
  ]) as string[];
}
async function validateDto(cls: any, input: Record<string, unknown>): Promise<string[]> {
  return collect(await validate(plainToInstance(cls, input) as object));
}

describe('UpdateRecipeDto', () => {
  it('accepts an empty body (all optional)', async () => {
    expect(await validateDto(UpdateRecipeDto, {})).toEqual([]);
  });

  it('rejects more than 100 ingredients (ArrayMaxSize preserved)', async () => {
    const ingredients = Array.from({ length: 101 }, () => ({
      stockItemId: 'e5cd8e6c-1bbb-4fab-a6bf-5ef35b0d429b',
      quantity: 1,
    }));
    const msgs = await validateDto(UpdateRecipeDto, { ingredients });
    expect(msgs.some((m) => /ingredients/i.test(m))).toBe(true);
  });

  it('rejects a yield below 1', async () => {
    const msgs = await validateDto(UpdateRecipeDto, { yield: 0 });
    expect(msgs.some((m) => /yield/i.test(m))).toBe(true);
  });
});

describe('UpdateStockSettingsDto', () => {
  it('accepts an empty body', async () => {
    expect(await validateDto(UpdateStockSettingsDto, {})).toEqual([]);
  });

  it('accepts a valid deductOnStatus (OrderStatus enum)', async () => {
    expect(await validateDto(UpdateStockSettingsDto, { deductOnStatus: OrderStatus.READY })).toEqual([]);
  });

  it('rejects an unknown deductOnStatus', async () => {
    const msgs = await validateDto(UpdateStockSettingsDto, { deductOnStatus: 'WHENEVER' });
    expect(msgs.some((m) => /deductOnStatus/i.test(m))).toBe(true);
  });

  it('rejects a poNumberPrefix with illegal chars (Matches regex)', async () => {
    const msgs = await validateDto(UpdateStockSettingsDto, { poNumberPrefix: 'PO/2024' });
    expect(msgs.some((m) => /poNumberPrefix/i.test(m))).toBe(true);
  });

  it('rejects a poNumberPrefix over 10 chars', async () => {
    const msgs = await validateDto(UpdateStockSettingsDto, { poNumberPrefix: 'ABCDEFGHIJK' });
    expect(msgs.some((m) => /poNumberPrefix/i.test(m))).toBe(true);
  });
});

describe('ListWasteLogsQueryDto', () => {
  it('coerces and accepts numeric limit/offset within bounds', async () => {
    const dto = plainToInstance(ListWasteLogsQueryDto, { limit: '100', offset: '0' });
    expect(dto.limit).toBe(100);
    expect(collect(await validate(dto as object))).toEqual([]);
  });

  it('rejects a limit above the hard max (5000)', async () => {
    const msgs = await validateDto(ListWasteLogsQueryDto, { limit: '5001' });
    expect(msgs.some((m) => /limit/i.test(m))).toBe(true);
  });

  it('rejects a non-ISO startDate (iter-87 NaN-date trap)', async () => {
    const msgs = await validateDto(ListWasteLogsQueryDto, { startDate: 'yesterday' });
    expect(msgs.some((m) => /startDate/i.test(m))).toBe(true);
  });

  it('rejects an unknown reason (enum guard)', async () => {
    const msgs = await validateDto(ListWasteLogsQueryDto, { reason: 'BORED' });
    expect(msgs.some((m) => /reason/i.test(m))).toBe(true);
  });
});

describe('ListIngredientMovementsQueryDto', () => {
  it('accepts a valid movement type filter', async () => {
    expect(
      await validateDto(ListIngredientMovementsQueryDto, { type: IngredientMovementType.IN }),
    ).toEqual([]);
  });

  it('rejects an unknown type', async () => {
    const msgs = await validateDto(ListIngredientMovementsQueryDto, { type: 'NOPE' });
    expect(msgs.some((m) => /type/i.test(m))).toBe(true);
  });
});

describe('UpdateStockCountItemDto', () => {
  it('accepts a non-negative counted quantity', async () => {
    expect(await validateDto(UpdateStockCountItemDto, { countedQty: 3 })).toEqual([]);
  });

  it('rejects a negative countedQty (Min 0)', async () => {
    const msgs = await validateDto(UpdateStockCountItemDto, { countedQty: -1 });
    expect(msgs.some((m) => /countedQty/i.test(m))).toBe(true);
  });
});

describe('UpdateStockItemDto (PartialType + isActive)', () => {
  it('accepts an empty body', async () => {
    expect(await validateDto(UpdateStockItemDto, {})).toEqual([]);
  });

  it('accepts isActive boolean and a partial unit update', async () => {
    expect(await validateDto(UpdateStockItemDto, { isActive: false, unit: StockUnit.G })).toEqual([]);
  });

  it('still rejects an unknown unit (enum preserved)', async () => {
    const msgs = await validateDto(UpdateStockItemDto, { unit: 'GALLON' });
    expect(msgs.some((m) => /unit/i.test(m))).toBe(true);
  });
});

describe('ReceivePurchaseOrderDto', () => {
  const line = { purchaseOrderItemId: 'poi1', quantityReceived: 5 };

  it('accepts a valid receive body', async () => {
    expect(await validateDto(ReceivePurchaseOrderDto, { items: [line] })).toEqual([]);
  });

  it('rejects empty items (ArrayMinSize 1)', async () => {
    const msgs = await validateDto(ReceivePurchaseOrderDto, { items: [] });
    expect(msgs.some((m) => /items/i.test(m))).toBe(true);
  });

  it('propagates a nested negative quantityReceived', async () => {
    const msgs = await validateDto(ReceivePurchaseOrderDto, {
      items: [{ purchaseOrderItemId: 'poi1', quantityReceived: -1 }],
    });
    expect(msgs.some((m) => /quantityReceived/i.test(m))).toBe(true);
  });
});

describe('UpdateStockItemCategoryDto (PartialType)', () => {
  it('accepts an empty body', async () => {
    expect(await validateDto(UpdateStockItemCategoryDto, {})).toEqual([]);
  });

  it('rejects a non-string name when supplied', async () => {
    const msgs = await validateDto(UpdateStockItemCategoryDto, { name: 123 });
    expect(msgs.some((m) => /name/i.test(m))).toBe(true);
  });
});

describe('StockItemQueryDto', () => {
  it('transforms isActive string "true" into a boolean', async () => {
    const dto = plainToInstance(StockItemQueryDto, { isActive: 'true' });
    expect(dto.isActive).toBe(true);
    expect(collect(await validate(dto as object))).toEqual([]);
  });

  it('transforms isActive "false" into boolean false', async () => {
    const dto = plainToInstance(StockItemQueryDto, { isActive: 'false' });
    expect(dto.isActive).toBe(false);
  });

  it('accepts search/categoryId strings', async () => {
    expect(await validateDto(StockItemQueryDto, { search: 'flour', categoryId: 'c1' })).toEqual([]);
  });
});
