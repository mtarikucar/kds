import { APIRequestContext } from '@playwright/test';

export type CategoryInput = {
  name?: string;
  description?: string;
  displayOrder?: number;
  isActive?: boolean;
};

export type CategoryResult = {
  id: string;
  name: string;
  description: string | null;
  displayOrder: number;
};

/**
 * Create a unique category via API. The default `name` includes a
 * timestamp suffix so concurrent runs don't collide on display order
 * or visual identity.
 */
export async function createCategory(
  api: APIRequestContext,
  input: CategoryInput = {},
): Promise<CategoryResult> {
  const payload = {
    name: input.name ?? `E2E-cat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    description: input.description,
    displayOrder: input.displayOrder,
    isActive: input.isActive ?? true,
  };
  const res = await api.post('menu/categories', { data: payload });
  if (!res.ok()) throw new Error(`createCategory failed: ${res.status()} ${await res.text()}`);
  return res.json();
}

export type ProductInput = {
  name?: string;
  description?: string;
  price?: number;
  categoryId: string;
  isAvailable?: boolean;
  stockTracked?: boolean;
  currentStock?: number;
};

export type ProductResult = {
  id: string;
  name: string;
  price: number;
  categoryId: string;
};

export async function createProduct(
  api: APIRequestContext,
  input: ProductInput,
): Promise<ProductResult> {
  const payload = {
    name: input.name ?? `E2E-prd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    description: input.description,
    price: input.price ?? 50,
    categoryId: input.categoryId,
    isAvailable: input.isAvailable ?? true,
    stockTracked: input.stockTracked ?? false,
    currentStock: input.currentStock ?? 0,
  };
  const res = await api.post('menu/products', { data: payload });
  if (!res.ok()) throw new Error(`createProduct failed: ${res.status()} ${await res.text()}`);
  return res.json();
}

/**
 * Convenience: create a fresh category and a single product in it.
 * Saves boilerplate in tests that need any sellable item.
 */
export async function createCategoryAndProduct(
  api: APIRequestContext,
  productOverride: Partial<ProductInput> = {},
): Promise<{ category: CategoryResult; product: ProductResult }> {
  const category = await createCategory(api);
  const product = await createProduct(api, { ...productOverride, categoryId: category.id });
  return { category, product };
}
