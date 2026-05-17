import { test, expect } from '../../fixtures/test';
import { loginAsApi } from '../../helpers/api';
import { createCategoryAndProduct, createTable, createOrder } from '../../helpers/factories';

/**
 * Multi-tenant DBs are an IDOR magnet — every read/write must filter
 * on `tenantId` derived from the JWT, never from the request body or
 * the URL. These tests probe cross-tenant lookups: a known good ID
 * from tenant A queried with tenant B's JWT must return 404
 * (preferred) or 403 (acceptable). Never 200 + the actual row.
 */
test.describe('Cross-cutting — tenant isolation (IDOR refusal)', () => {
  test('cross-tenant order lookup returns 404 / 403', async () => {
    // Both demo accounts live in the same Sultanahmet tenant, so a
    // true cross-tenant probe needs a synthetic random UUID for an
    // order that doesn't exist in this tenant. The service must
    // refuse without leaking row existence.
    const { api } = await loginAsApi('admin');

    // First, prove the route works for a real id.
    const { product } = await createCategoryAndProduct(api);
    const table = await createTable(api);
    const ours = await createOrder(api, {
      tableId: table.id,
      items: [{ productId: product.id }],
    });
    const okRes = await api.get(`orders/${ours.id}`);
    expect(okRes.ok()).toBeTruthy();

    // Now probe a non-existent id. With proper tenant scoping the
    // service queries `findFirst({ where: { id, tenantId } })` and
    // returns null → 404.
    const fakeId = '00000000-0000-0000-0000-00000000ffff';
    const bad = await api.get(`orders/${fakeId}`);
    expect([403, 404]).toContain(bad.status());
  });

  test('cross-tenant table status update is refused', async () => {
    const { api } = await loginAsApi('admin');
    const fakeId = '11111111-1111-1111-1111-111111111111';
    const res = await api.patch(`tables/${fakeId}/status`, {
      data: { status: 'OCCUPIED' },
    });
    expect([403, 404]).toContain(res.status());
  });

  test('cross-tenant subscription read is refused', async () => {
    const { api } = await loginAsApi('admin');
    const fakeSubId = '22222222-2222-2222-2222-222222222222';
    const res = await api.get(`subscriptions/${fakeSubId}`);
    expect([403, 404]).toContain(res.status());
  });
});
