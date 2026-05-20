import { test, expect } from '@playwright/test';
import { loginAsSuperAdmin } from '../../helpers/api';

/**
 * SuperAdmin refund endpoint — `POST /superadmin/subscriptions/:id/refund`.
 *
 * The endpoint is gated behind SuperAdminGuard and validates eligibility
 * before delegating to PaytrAdapter.refund (which short-circuits in E2E
 * thanks to PAYTR_USE_FAKE_ADAPTER=true). Full success-path coverage
 * lives in the service unit spec; here we just lock the auth and
 * eligibility contracts that can only be exercised over HTTP.
 */
test.describe('SuperAdmin refund endpoint — contract', () => {
  test('returns 404 when the subscription/payment ids do not exist', async () => {
    const { api: superApi } = await loginAsSuperAdmin();
    const res = await superApi.post(
      'superadmin/subscriptions/00000000-0000-0000-0000-000000000000/refund',
      {
        data: {
          paymentId: '00000000-0000-0000-0000-000000000000',
          reason: 'e2e: unknown payment should 404',
        },
      },
    );
    expect(res.status()).toBe(404);
  });

  test('rejects body without paymentId (DTO validation)', async () => {
    const { api: superApi } = await loginAsSuperAdmin();
    const res = await superApi.post(
      'superadmin/subscriptions/00000000-0000-0000-0000-000000000000/refund',
      {
        data: { reason: 'e2e: missing paymentId' },
      },
    );
    // class-validator on the DTO catches the missing field before the
    // service runs its own checks — 400, not 404.
    expect(res.status()).toBe(400);
  });

  test('rejects refund without a reason (DTO validation)', async () => {
    const { api: superApi } = await loginAsSuperAdmin();
    const res = await superApi.post(
      'superadmin/subscriptions/00000000-0000-0000-0000-000000000000/refund',
      {
        data: { paymentId: '00000000-0000-0000-0000-000000000000' },
      },
    );
    expect(res.status()).toBe(400);
  });

  test('rejects refund with negative amount (DTO @IsPositive)', async () => {
    const { api: superApi } = await loginAsSuperAdmin();
    const res = await superApi.post(
      'superadmin/subscriptions/00000000-0000-0000-0000-000000000000/refund',
      {
        data: {
          paymentId: '00000000-0000-0000-0000-000000000000',
          amount: -50,
          reason: 'e2e: negative amount',
        },
      },
    );
    expect(res.status()).toBe(400);
  });

  test('requires SuperAdmin auth (unauthenticated request rejected)', async () => {
    const { request } = await import('@playwright/test');
    const { API_BASE } = await import('../../helpers/api');
    const ctx = await request.newContext({ baseURL: API_BASE });
    try {
      const res = await ctx.post(
        'superadmin/subscriptions/00000000-0000-0000-0000-000000000000/refund',
        {
          data: {
            paymentId: '00000000-0000-0000-0000-000000000000',
            reason: 'unauth',
          },
        },
      );
      expect([401, 403]).toContain(res.status());
    } finally {
      await ctx.dispose();
    }
  });
});
