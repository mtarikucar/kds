import { test, expect } from '../../fixtures/test';
import { loginAsApi } from '../../helpers/api';

test.describe('Subscriptions — payment-intent gating', () => {
  test('FREE plan cannot create a payment intent', async () => {
    const { api } = await loginAsApi('admin');

    // Find the FREE plan id from the catalog.
    const plansBody = await (await api.get('subscriptions/plans')).json();
    const free = plansBody.find((p: any) => p.name === 'FREE');
    expect(free).toBeTruthy();

    // /payments/create-intent rejects FREE outright (no $0 invoices).
    const res = await api.post('payments/create-intent', {
      data: { planId: free.id, billingCycle: 'MONTHLY' },
    });
    expect(res.status()).toBe(400);
  });

  test('paid-plan intent is blocked when the calling user has no verified email', async () => {
    // Demo seed leaves emailVerified=false on staff users. The
    // PaymentsService.createIntent guard refuses to mint a PayTR
    // intent until the admin verifies their email — a real tenant
    // must complete the email-verify flow first.
    const { api } = await loginAsApi('admin');
    const plans = await (await api.get('subscriptions/plans')).json();
    const business = plans.find((p: any) => p.name === 'BUSINESS');
    expect(business).toBeTruthy();

    const res = await api.post('payments/create-intent', {
      data: { planId: business.id, billingCycle: 'MONTHLY' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.message).toMatch(/email must be verified/i);
  });
});
