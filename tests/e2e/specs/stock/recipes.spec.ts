import { test, expect } from '../../fixtures/test';
import { loginAsApi } from '../../helpers/api';
import {
  createCategory,
  createProduct,
  createRecipe,
  createStockItem,
} from '../../helpers/factories';

/**
 * Recipes link a menu product to a list of stock items + per-unit
 * quantities. When the StockDeductionService fires (driven by
 * PosSettings.deductOnStatus), the recipe is the multiplier: an order
 * for 3 units of a product whose recipe says "200g flour" should
 * consume 600g of the linked stock item.
 *
 * These specs lock the CRUD contract (create / fetch by-product /
 * patch / delete). Deduction-on-order is tested in
 * behavior/stock-deduction.spec.ts.
 */
test.describe('Recipes — CRUD + check-stock probe', () => {
  test('POST attaches a recipe to a product and GET /by-product returns it', async () => {
    const { api } = await loginAsApi('admin');
    const cat = await createCategory(api);
    const product = await createProduct(api, { categoryId: cat.id, price: 30 });
    const ingredient = await createStockItem(api, { currentStock: 100, unit: 'G' });

    const recipe = await createRecipe(api, {
      productId: product.id,
      ingredients: [{ stockItemId: ingredient.id, quantity: 200 }],
    });
    expect(recipe.id).toBeTruthy();
    expect(recipe.productId).toBe(product.id);

    const res = await api.get(`stock-management/recipes/by-product/${product.id}`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    // The endpoint returns either the single recipe or an array; both
    // shapes have observed in this module.
    const found = Array.isArray(body) ? body[0] : body;
    expect(found.id).toBe(recipe.id);
    expect(found.ingredients.length).toBe(1);
  });

  test('POST /:id/check-stock reports availability vs the linked item', async () => {
    const { api } = await loginAsApi('admin');
    const cat = await createCategory(api);
    const product = await createProduct(api, { categoryId: cat.id, price: 30 });
    const ingredient = await createStockItem(api, { currentStock: 1000, unit: 'G' });
    const recipe = await createRecipe(api, {
      productId: product.id,
      ingredients: [{ stockItemId: ingredient.id, quantity: 200 }],
    });

    // Asking "can we make 3 of this product?" → needs 600g, we have
    // 1000g. The handler takes the desired quantity from a `quantity`
    // query-string param (default 1) and returns
    // { canProduce: boolean, maxQuantity, ingredients[] }.
    const res = await api.post(
      `stock-management/recipes/${recipe.id}/check-stock?quantity=3`,
    );
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.canProduce).toBe(true);
    expect(body.ingredients?.[0]?.sufficient).toBe(true);
  });

  test('DELETE removes the recipe', async () => {
    const { api } = await loginAsApi('admin');
    const cat = await createCategory(api);
    const product = await createProduct(api, { categoryId: cat.id, price: 30 });
    const ingredient = await createStockItem(api);
    const recipe = await createRecipe(api, {
      productId: product.id,
      ingredients: [{ stockItemId: ingredient.id, quantity: 50 }],
    });
    const del = await api.delete(`stock-management/recipes/${recipe.id}`);
    expect(del.ok()).toBeTruthy();
  });

  test('recipe requires at least one ingredient (ArrayMinSize 1)', async () => {
    const { api } = await loginAsApi('admin');
    const cat = await createCategory(api);
    const product = await createProduct(api, { categoryId: cat.id, price: 30 });
    const res = await api.post('stock-management/recipes', {
      data: { productId: product.id, ingredients: [] },
    });
    expect(res.status()).toBe(400);
  });
});
