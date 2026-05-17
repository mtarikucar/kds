import { APIRequestContext } from '@playwright/test';

export interface StockItem {
  id: string;
  name: string;
  unit: string;
  currentStock: number | string;
  minStock: number | string | null;
}

/** Create a stock-management item. `currentStock` and `minStock`
 *  default to safe values for tests that just need the row to exist. */
export async function createStockItem(
  api: APIRequestContext,
  overrides: Partial<{
    name: string;
    sku: string;
    unit: string;
    currentStock: number;
    minStock: number;
    costPerUnit: number;
  }> = {},
): Promise<StockItem> {
  const data = {
    name: overrides.name ?? `E2E Ingredient ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    unit: overrides.unit ?? 'KG',
    currentStock: overrides.currentStock ?? 100,
    minStock: overrides.minStock ?? 5,
    costPerUnit: overrides.costPerUnit ?? 25,
    ...(overrides.sku ? { sku: overrides.sku } : {}),
  };
  const res = await api.post('stock-management/items', { data });
  if (!res.ok()) throw new Error(`createStockItem: ${res.status()} ${await res.text()}`);
  return res.json();
}

export async function getStockItem(api: APIRequestContext, id: string): Promise<StockItem> {
  const res = await api.get(`stock-management/items/${id}`);
  if (!res.ok()) throw new Error(`getStockItem: ${res.status()} ${await res.text()}`);
  return res.json();
}

export interface Recipe {
  id: string;
  productId: string;
  ingredients: Array<{ stockItemId: string; quantity: number | string }>;
}

export async function createRecipe(
  api: APIRequestContext,
  args: { productId: string; ingredients: Array<{ stockItemId: string; quantity: number }>; yieldQty?: number },
): Promise<Recipe> {
  const res = await api.post('stock-management/recipes', {
    data: {
      productId: args.productId,
      ingredients: args.ingredients,
      yield: args.yieldQty ?? 1,
    },
  });
  if (!res.ok()) throw new Error(`createRecipe: ${res.status()} ${await res.text()}`);
  return res.json();
}

export async function recordWaste(
  api: APIRequestContext,
  args: { stockItemId: string; quantity: number; reason: string; notes?: string },
): Promise<{ id: string }> {
  const res = await api.post('stock-management/waste-logs', { data: args });
  if (!res.ok()) throw new Error(`recordWaste: ${res.status()} ${await res.text()}`);
  return res.json();
}

export async function createSupplier(
  api: APIRequestContext,
  overrides: Partial<{ name: string; email: string; phone: string }> = {},
): Promise<{ id: string; name: string }> {
  const stamp = Date.now();
  const data = {
    name: overrides.name ?? `E2E Supplier ${stamp}`,
    email: overrides.email ?? `supplier-${stamp}@example.com`,
    phone: overrides.phone ?? `+90555${String(stamp).slice(-7)}`,
  };
  const res = await api.post('stock-management/suppliers', { data });
  if (!res.ok()) throw new Error(`createSupplier: ${res.status()} ${await res.text()}`);
  return res.json();
}

export interface StockCount {
  id: string;
  status: string;
  items: Array<{ id: string; stockItemId: string; expectedQty: number | string; countedQty: number | string | null }>;
}

export async function createStockCount(
  api: APIRequestContext,
  args: { stockItemIds?: string[]; name?: string } = {},
): Promise<StockCount> {
  const data: Record<string, unknown> = { name: args.name ?? `E2E Count ${Date.now()}` };
  if (args.stockItemIds && args.stockItemIds.length > 0) {
    data.stockItemIds = args.stockItemIds;
  }
  const res = await api.post('stock-management/stock-counts', { data });
  if (!res.ok()) throw new Error(`createStockCount: ${res.status()} ${await res.text()}`);
  return res.json();
}

export async function recordCountedQty(
  api: APIRequestContext,
  countId: string,
  itemRowId: string,
  countedQty: number,
): Promise<unknown> {
  const res = await api.patch(`stock-management/stock-counts/${countId}/items/${itemRowId}`, {
    data: { countedQty },
  });
  if (!res.ok()) throw new Error(`recordCountedQty: ${res.status()} ${await res.text()}`);
  return res.json();
}

export async function finalizeStockCount(
  api: APIRequestContext,
  countId: string,
): Promise<StockCount> {
  const res = await api.post(`stock-management/stock-counts/${countId}/finalize`);
  if (!res.ok()) throw new Error(`finalizeStockCount: ${res.status()} ${await res.text()}`);
  return res.json();
}
