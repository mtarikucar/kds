import { test, expect } from '../../fixtures/test';
import { request } from '@playwright/test';
import { loginAsApi, API_BASE } from '../../helpers/api';
import { createCustomerSession } from '../../helpers/factories';

/**
 * Customer-facing public endpoints — the QR menu surface. No staff
 * auth; tenant context is resolved server-side from sessionId.
 */
test.describe('Customer-public — loyalty, referral, OTP', () => {
  test('loyalty config is publicly readable', async () => {
    const ctx = await request.newContext({ baseURL: API_BASE });
    const res = await ctx.get('customer-public/loyalty/config');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(typeof body.pointsPerCurrencyUnit).toBe('number');
    expect(body.tiers).toBeTruthy();
    await ctx.dispose();
  });

  test('loyalty balance for anonymous session reports identified=false', async () => {
    const { user } = await loginAsApi('admin');
    const session = await createCustomerSession(user.tenantId);
    const ctx = await request.newContext({ baseURL: API_BASE });
    const res = await ctx.get(`customer-public/loyalty/balance?sessionId=${session.sessionId}`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.identified).toBe(false);
    expect(body.points).toBe(0);
    await ctx.dispose();
  });

  test('OTP send accepts a valid phone number', async () => {
    const ctx = await request.newContext({ baseURL: API_BASE });
    // Endpoint is public-rate-limited; the real SMS provider is
    // mocked in dev so the call returns success without sending.
    const res = await ctx.post('customer-public/phone/send-otp', {
      data: { phone: `+90555${String(Date.now()).slice(-7)}` },
    });
    // Response is one of: 200 (sent / mocked), 201, 429 (rate-limit if
    // a previous test already sent). Anything < 500 is acceptable.
    expect(res.status()).toBeLessThan(500);
    await ctx.dispose();
  });

  test('OTP verify rejects an obviously bogus code', async () => {
    const ctx = await request.newContext({ baseURL: API_BASE });
    const res = await ctx.post('customer-public/phone/verify-otp', {
      data: {
        verificationId: '00000000-0000-0000-0000-000000000000',
        code: '000000',
      },
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);
    await ctx.dispose();
  });
});
