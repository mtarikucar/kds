import { test, expect } from '../../fixtures/test';
import { loginAsApi } from '../../helpers/api';
import { setPosSettings } from '../../helpers/factories';

/**
 * `enableTwoStepCheckout` is a UI-only flag at first glance: the
 * backend's order-create and payment-create endpoints are decoupled
 * either way. Its real backend job is **a constraint**: if customer
 * ordering is on, two-step MUST stay on so customer-created orders
 * have a "Create Order" → admin-approve → "Take Payment" stop.
 *
 * This spec pins that constraint so the next dev to flip a default
 * doesn't silently break the QR-menu flow.
 */
test.describe('PosSettings → enableTwoStepCheckout constraint', () => {
  test('cannot disable two-step while customer ordering is on', async () => {
    const { api } = await loginAsApi('admin');
    // Establish the conflicting state.
    await setPosSettings(api, { enableCustomerOrdering: true, enableTwoStepCheckout: true });

    const res = await api.patch('pos-settings', {
      data: { enableTwoStepCheckout: false },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.message).toMatch(/two[- ]step|iki aşamalı|customer ordering|qr menü/i);
  });

  test('disabling customer ordering first unblocks two-step toggle', async () => {
    const { api } = await loginAsApi('admin');
    await setPosSettings(api, { enableCustomerOrdering: false });

    // Now two-step can flip off.
    const res = await api.patch('pos-settings', {
      data: { enableTwoStepCheckout: false },
    });
    expect(res.ok()).toBeTruthy();

    // Restore demo defaults so later tests don't see a misconfigured tenant.
    await setPosSettings(api, { enableCustomerOrdering: true, enableTwoStepCheckout: true });
  });
});
