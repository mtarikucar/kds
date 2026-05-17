import { test, expect } from '../../fixtures/test';
import { APIRequestContext } from '@playwright/test';
import { loginAsApi } from '../../helpers/api';
import {
  createCategoryAndProduct,
  createTable,
  createOrder,
} from '../../helpers/factories';

async function createModifierGroup(api: APIRequestContext, name: string) {
  const res = await api.post('modifiers/groups', {
    data: {
      name,
      displayName: name,
      selectionType: 'SINGLE',
      minSelections: 0,
      isRequired: false,
    },
  });
  if (!res.ok()) throw new Error(`createModifierGroup: ${res.status()} ${await res.text()}`);
  return res.json();
}

async function createModifier(
  api: APIRequestContext,
  groupId: string,
  priceAdjustment: number,
) {
  const res = await api.post('modifiers', {
    data: {
      name: `mod-${Date.now()}`,
      displayName: `Mod ${Date.now()}`,
      priceAdjustment,
      groupId,
      isAvailable: true,
    },
  });
  if (!res.ok()) throw new Error(`createModifier: ${res.status()} ${await res.text()}`);
  return res.json();
}

async function attachGroupToProduct(
  api: APIRequestContext,
  productId: string,
  groupId: string,
) {
  const res = await api.post(`modifiers/products/${productId}/assign`, {
    data: { modifierGroups: [{ groupId, displayOrder: 0 }] },
  });
  if (!res.ok()) throw new Error(`attachGroupToProduct: ${res.status()} ${await res.text()}`);
}

test.describe('Menu — modifier price adjustments', () => {
  test('selecting a modifier with priceAdjustment increases the order total', async () => {
    const { api } = await loginAsApi('admin');
    const { product } = await createCategoryAndProduct(api, { price: 100 });
    const group = await createModifierGroup(api, `gr-${Date.now()}`);
    const modifier = await createModifier(api, group.id, 25);
    await attachGroupToProduct(api, product.id, group.id);

    const table = await createTable(api);
    const order = await createOrder(api, {
      tableId: table.id,
      items: [
        {
          productId: product.id,
          quantity: 1,
          // The factory's OrderItemInput doesn't carry modifiers; hit the
          // POST endpoint directly here so we can attach one.
        },
      ],
    });
    // For a clean test without re-engineering the factory, post a second
    // order with the modifier attached and assert the delta.
    const withMod = await api.post('orders', {
      data: {
        type: 'DINE_IN',
        tableId: table.id,
        items: [
          {
            productId: product.id,
            quantity: 1,
            modifiers: [{ modifierId: modifier.id, quantity: 1 }],
          },
        ],
      },
    });
    expect(withMod.ok()).toBeTruthy();
    const withModBody = await withMod.json();

    expect(Number(withModBody.finalAmount)).toBe(125);
    expect(Number(order.finalAmount)).toBe(100);
  });
});
