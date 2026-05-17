import { test, expect } from '../../fixtures/test';
import { loginAsApi } from '../../helpers/api';
import { createStockItem, createSupplier } from '../../helpers/factories';

/**
 * Suppliers — vendor records that can be attached to stock items
 * (with a per-supplier unitPrice and isPreferred flag). The "attach"
 * endpoint creates the SupplierStockItem link row used later by
 * PurchaseOrder lines to pick which supplier delivered what.
 */
test.describe('Suppliers — CRUD + stock-item attachment', () => {
  test('POST creates a supplier and GET lists it', async () => {
    const { api } = await loginAsApi('admin');
    const supplier = await createSupplier(api);
    expect(supplier.id).toBeTruthy();

    const res = await api.get('stock-management/suppliers');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    const items: Array<{ id: string }> = Array.isArray(body) ? body : body.data ?? body.items ?? [];
    expect(items.some((s) => s.id === supplier.id)).toBeTruthy();
  });

  test('PATCH updates contact info', async () => {
    const { api } = await loginAsApi('admin');
    const supplier = await createSupplier(api);
    const res = await api.patch(`stock-management/suppliers/${supplier.id}`, {
      data: { contactName: 'New Contact', address: 'Istanbul' },
    });
    expect(res.ok()).toBeTruthy();
    const after = await (await api.get(`stock-management/suppliers/${supplier.id}`)).json();
    expect(after.contactName).toBe('New Contact');
  });

  test('attach a stock item to a supplier with a unit price', async () => {
    const { api } = await loginAsApi('admin');
    const supplier = await createSupplier(api);
    const item = await createStockItem(api);

    const res = await api.post(`stock-management/suppliers/${supplier.id}/items`, {
      data: { stockItemId: item.id, unitPrice: 12.5, isPreferred: true },
    });
    expect(res.ok()).toBeTruthy();
  });

  test('phone format is validated by the DTO regex', async () => {
    const { api } = await loginAsApi('admin');
    const res = await api.post('stock-management/suppliers', {
      data: { name: `Bad Phone ${Date.now()}`, phone: '!!!' },
    });
    expect(res.status()).toBe(400);
  });
});
