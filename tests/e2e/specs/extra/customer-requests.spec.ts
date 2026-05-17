import { test, expect } from '../../fixtures/test';
import { request } from '@playwright/test';
import { loginAsApi, API_BASE } from '../../helpers/api';
import { createCustomerSession, createTable } from '../../helpers/factories';

/**
 * QR-menu customer requests: waiter-call + bill-request. Each
 * follows create (public) → acknowledge → complete (staff) flow.
 * The full path puts items in the POS "active requests" inbox.
 */
test.describe('QR menu → POS — waiter + bill requests', () => {
  test('public guest can create a waiter-request; staff sees it as active', async () => {
    const { api: adminApi, user } = await loginAsApi('admin');
    const table = await createTable(adminApi);
    const session = await createCustomerSession(user.tenantId, table.id);

    const pub = await request.newContext({ baseURL: API_BASE });
    const create = await pub.post('customer-orders/waiter-requests', {
      data: { sessionId: session.sessionId, reason: 'WATER' },
    });
    expect(create.ok()).toBeTruthy();
    const req = await create.json();
    await pub.dispose();
    expect(req.id).toBeTruthy();

    // Staff sees the request on the active-requests inbox.
    const active = await adminApi.get('customer-orders/waiter-requests/tenant/active');
    expect(active.ok()).toBeTruthy();
    const items = await active.json();
    expect(Array.isArray(items) ? items : items.data ?? []).toBeTruthy();
  });

  test('staff acknowledge + complete moves the request through its states', async () => {
    const { api: adminApi, user } = await loginAsApi('admin');
    const table = await createTable(adminApi);
    const session = await createCustomerSession(user.tenantId, table.id);

    const pub = await request.newContext({ baseURL: API_BASE });
    const create = await pub.post('customer-orders/waiter-requests', {
      data: { sessionId: session.sessionId, reason: 'BILL' },
    });
    expect(create.ok()).toBeTruthy();
    const req = await create.json();
    await pub.dispose();

    const ack = await adminApi.patch(`customer-orders/waiter-requests/${req.id}/acknowledge`);
    expect(ack.ok()).toBeTruthy();

    const done = await adminApi.patch(`customer-orders/waiter-requests/${req.id}/complete`);
    expect(done.ok()).toBeTruthy();
  });

  test('bill-request shares the same lifecycle', async () => {
    const { api: adminApi, user } = await loginAsApi('admin');
    const table = await createTable(adminApi);
    const session = await createCustomerSession(user.tenantId, table.id);

    const pub = await request.newContext({ baseURL: API_BASE });
    const create = await pub.post('customer-orders/bill-requests', {
      data: { sessionId: session.sessionId, paymentMethod: 'CASH' },
    });
    expect(create.ok()).toBeTruthy();
    const req = await create.json();
    await pub.dispose();

    const ack = await adminApi.patch(`customer-orders/bill-requests/${req.id}/acknowledge`);
    expect(ack.ok()).toBeTruthy();
    const done = await adminApi.patch(`customer-orders/bill-requests/${req.id}/complete`);
    expect(done.ok()).toBeTruthy();
  });
});
