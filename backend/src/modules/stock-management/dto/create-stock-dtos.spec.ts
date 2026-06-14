import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateStockItemDto } from './create-stock-item.dto';
import { CreateSupplierDto } from './create-supplier.dto';
import { CreateIngredientMovementDto } from './create-ingredient-movement.dto';
import { CreateWasteLogDto } from './create-waste-log.dto';
import { CreateStockItemCategoryDto } from './create-stock-item-category.dto';
import { CreatePurchaseOrderDto } from './create-purchase-order.dto';
import { CreateRecipeDto } from './create-recipe.dto';
import { CreateStockCountDto } from './create-stock-count.dto';
import {
  StockUnit,
  WasteReason,
} from '../../../common/constants/stock-management.enum';

/**
 * Validation specs for the stock-management create DTOs. Asserts the
 * enum/required/min-array rules that protect the stock pipeline (units,
 * waste reasons, PO/recipe line-item nesting, phone regex on suppliers).
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

describe('CreateStockItemDto', () => {
  it('accepts a valid item', async () => {
    expect(await validateDto(CreateStockItemDto, { name: 'Flour', unit: StockUnit.KG })).toEqual([]);
  });

  it('rejects an unknown unit (enum guard)', async () => {
    const msgs = await validateDto(CreateStockItemDto, { name: 'Flour', unit: 'GALLON' });
    expect(msgs.some((m) => /unit/i.test(m))).toBe(true);
  });

  it('rejects a negative currentStock (Min 0)', async () => {
    const msgs = await validateDto(CreateStockItemDto, {
      name: 'Flour',
      unit: StockUnit.KG,
      currentStock: -1,
    });
    expect(msgs.some((m) => /currentStock/i.test(m))).toBe(true);
  });

  it('rejects a missing name', async () => {
    const msgs = await validateDto(CreateStockItemDto, { unit: StockUnit.KG });
    expect(msgs.some((m) => /name/i.test(m))).toBe(true);
  });
});

describe('CreateSupplierDto', () => {
  it('accepts a name-only supplier', async () => {
    expect(await validateDto(CreateSupplierDto, { name: 'ACME' })).toEqual([]);
  });

  it('rejects an invalid email', async () => {
    const msgs = await validateDto(CreateSupplierDto, { name: 'ACME', email: 'x' });
    expect(msgs.some((m) => /email/i.test(m))).toBe(true);
  });

  it('rejects a malformed phone (Matches regex)', async () => {
    const msgs = await validateDto(CreateSupplierDto, { name: 'ACME', phone: 'call-me' });
    expect(msgs.some((m) => /phone/i.test(m))).toBe(true);
  });
});

describe('CreateIngredientMovementDto', () => {
  it('accepts a valid IN movement', async () => {
    expect(
      await validateDto(CreateIngredientMovementDto, {
        stockItemId: 's1',
        type: 'IN',
        quantity: 5,
      }),
    ).toEqual([]);
  });

  it('rejects an unknown movement type', async () => {
    const msgs = await validateDto(CreateIngredientMovementDto, {
      stockItemId: 's1',
      type: 'TELEPORT',
      quantity: 5,
    });
    expect(msgs.some((m) => /type/i.test(m))).toBe(true);
  });

  it('rejects a non-number quantity', async () => {
    const msgs = await validateDto(CreateIngredientMovementDto, {
      stockItemId: 's1',
      type: 'OUT',
      quantity: 'lots',
    });
    expect(msgs.some((m) => /quantity/i.test(m))).toBe(true);
  });
});

describe('CreateWasteLogDto', () => {
  it('accepts a valid waste log', async () => {
    expect(
      await validateDto(CreateWasteLogDto, {
        stockItemId: 's1',
        quantity: 2,
        reason: WasteReason.SPOILED,
      }),
    ).toEqual([]);
  });

  it('rejects an unknown reason (enum guard)', async () => {
    const msgs = await validateDto(CreateWasteLogDto, {
      stockItemId: 's1',
      quantity: 2,
      reason: 'BORED',
    });
    expect(msgs.some((m) => /reason/i.test(m))).toBe(true);
  });

  it('rejects a negative quantity (Min 0)', async () => {
    const msgs = await validateDto(CreateWasteLogDto, {
      stockItemId: 's1',
      quantity: -1,
      reason: WasteReason.OTHER,
    });
    expect(msgs.some((m) => /quantity/i.test(m))).toBe(true);
  });
});

describe('CreateStockItemCategoryDto', () => {
  it('accepts a name-only category', async () => {
    expect(await validateDto(CreateStockItemCategoryDto, { name: 'Dry Goods' })).toEqual([]);
  });

  it('rejects a missing name', async () => {
    const msgs = await validateDto(CreateStockItemCategoryDto, {});
    expect(msgs.some((m) => /name/i.test(m))).toBe(true);
  });
});

describe('CreatePurchaseOrderDto', () => {
  const item = { stockItemId: 's1', quantityOrdered: 10, unitPrice: 5 };

  it('accepts a valid PO with one line', async () => {
    expect(
      await validateDto(CreatePurchaseOrderDto, { supplierId: 'sup1', items: [item] }),
    ).toEqual([]);
  });

  it('rejects an empty items array (ArrayMinSize 1)', async () => {
    const msgs = await validateDto(CreatePurchaseOrderDto, { supplierId: 'sup1', items: [] });
    expect(msgs.some((m) => /items/i.test(m))).toBe(true);
  });

  it('propagates a nested invalid line (negative unitPrice)', async () => {
    const msgs = await validateDto(CreatePurchaseOrderDto, {
      supplierId: 'sup1',
      items: [{ stockItemId: 's1', quantityOrdered: 1, unitPrice: -1 }],
    });
    expect(msgs.some((m) => /unitPrice/i.test(m))).toBe(true);
  });

  it('rejects a non-ISO expectedDate', async () => {
    const msgs = await validateDto(CreatePurchaseOrderDto, {
      supplierId: 'sup1',
      items: [item],
      expectedDate: 'soon',
    });
    expect(msgs.some((m) => /expectedDate/i.test(m))).toBe(true);
  });
});

describe('CreateRecipeDto', () => {
  const productId = '6b0b887d-c741-4f8f-9f3f-08501f075aef';
  const stockItemId = 'e5cd8e6c-1bbb-4fab-a6bf-5ef35b0d429b';
  const ingredient = { stockItemId, quantity: 1 };

  it('accepts a valid recipe', async () => {
    expect(
      await validateDto(CreateRecipeDto, { productId, ingredients: [ingredient] }),
    ).toEqual([]);
  });

  it('rejects a non-uuid productId', async () => {
    const msgs = await validateDto(CreateRecipeDto, {
      productId: 'x',
      ingredients: [ingredient],
    });
    expect(msgs.some((m) => /productId/i.test(m))).toBe(true);
  });

  it('rejects empty ingredients (ArrayMinSize 1)', async () => {
    const msgs = await validateDto(CreateRecipeDto, { productId, ingredients: [] });
    expect(msgs.some((m) => /ingredients/i.test(m))).toBe(true);
  });

  it('rejects more than 100 ingredients (ArrayMaxSize)', async () => {
    const ingredients = Array.from({ length: 101 }, () => ingredient);
    const msgs = await validateDto(CreateRecipeDto, { productId, ingredients });
    expect(msgs.some((m) => /ingredients/i.test(m))).toBe(true);
  });

  it('rejects a yield below 1 (Min 1)', async () => {
    const msgs = await validateDto(CreateRecipeDto, {
      productId,
      yield: 0,
      ingredients: [ingredient],
    });
    expect(msgs.some((m) => /yield/i.test(m))).toBe(true);
  });
});

describe('CreateStockCountDto', () => {
  it('accepts an empty body (all optional)', async () => {
    expect(await validateDto(CreateStockCountDto, {})).toEqual([]);
  });

  it('accepts a list of stock item ids', async () => {
    expect(await validateDto(CreateStockCountDto, { stockItemIds: ['a', 'b'] })).toEqual([]);
  });

  it('rejects non-string entries in stockItemIds (IsString each)', async () => {
    const msgs = await validateDto(CreateStockCountDto, { stockItemIds: [1, 2] });
    expect(msgs.some((m) => /stockItemIds/i.test(m))).toBe(true);
  });
});
