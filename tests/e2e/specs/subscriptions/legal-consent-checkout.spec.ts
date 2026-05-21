import { test, expect, request } from '@playwright/test';
import { loginAsApi, API_BASE } from '../../helpers/api';

/**
 * Legal-consent gate on `POST /payments/create-intent`.
 *
 * Required at every paid (or trial-activating) checkout — the user
 * must have ticked KVKK + Mesafeli Satış + İade and the request body
 * carries the three current LegalDocument ids in `acceptedDocumentIds`.
 * ConsentService records three rows per accepted set so KVKK auditing
 * has a "who accepted what version at this IP at this time" answer.
 *
 * These specs hit the API directly — the UI flow is covered visually
 * by the playwright UI suite (separately), this one locks the contract.
 */

const LEGAL_KINDS = ['KVKK', 'DISTANCE_SALES', 'REFUND_POLICY'] as const;

async function getCurrentLegalDocumentIds(): Promise<Record<string, string>> {
  const pub = await request.newContext({ baseURL: API_BASE });
  try {
    const result: Record<string, string> = {};
    for (const kind of LEGAL_KINDS) {
      const res = await pub.get(`legal/documents/${kind}/current`);
      expect(res.ok(), `current ${kind} should be available`).toBeTruthy();
      const body = await res.json();
      result[kind] = body.id;
    }
    return result;
  } finally {
    await pub.dispose();
  }
}

test.describe('Checkout — legal consent gate', () => {
  test('public endpoint returns the three current legal documents', async () => {
    const ids = await getCurrentLegalDocumentIds();
    expect(ids.KVKK).toBeTruthy();
    expect(ids.DISTANCE_SALES).toBeTruthy();
    expect(ids.REFUND_POLICY).toBeTruthy();
    // Three distinct rows.
    expect(new Set(Object.values(ids)).size).toBe(3);
  });

  test('create-intent without acceptedDocumentIds is refused with LEGAL_CONSENT_REQUIRED', async () => {
    const { api } = await loginAsApi('admin');
    const plansBody = await (await api.get('subscriptions/plans')).json();
    const paid = plansBody.find((p: any) => p.name === 'BASIC');
    expect(paid).toBeTruthy();

    const res = await api.post('payments/create-intent', {
      data: { planId: paid.id, billingCycle: 'MONTHLY' },
    });
    expect(res.status()).toBe(400);
    // Assert the specific error code, not just the status. Without
    // this assertion the test was previously passing for the wrong
    // reason (PROFILE_PHONE_REQUIRED was also 400) and let a regression
    // ship that effectively disabled the consent gate.
    const body = await res.json();
    // DTO validation fires first (acceptedDocumentIds missing). The
    // service-level LEGAL_CONSENT_REQUIRED code only surfaces if the
    // DTO is bypassed; in the normal path we get a class-validator
    // error array. Either is acceptable proof the gate is engaged.
    const isDtoRejection =
      Array.isArray(body.message) &&
      body.message.some((m: string) => /acceptedDocumentIds/i.test(m));
    const isServiceRejection = body.code === 'LEGAL_CONSENT_REQUIRED';
    expect(isDtoRejection || isServiceRejection).toBe(true);
  });

  test('create-intent with two-of-three accepted ids is refused (missing one kind)', async () => {
    const ids = await getCurrentLegalDocumentIds();
    const { api } = await loginAsApi('admin');
    const plansBody = await (await api.get('subscriptions/plans')).json();
    const paid = plansBody.find((p: any) => p.name === 'BASIC');

    // Three ids but the last one is a duplicate of KVKK → REFUND_POLICY
    // never accepted. DTO requires exactly three, and the service
    // re-checks coverage.
    const res = await api.post('payments/create-intent', {
      data: {
        planId: paid.id,
        billingCycle: 'MONTHLY',
        acceptedDocumentIds: [ids.KVKK, ids.DISTANCE_SALES, ids.KVKK],
      },
    });
    expect(res.status()).toBe(400);
  });

  test('create-intent with a bogus document id is refused', async () => {
    const ids = await getCurrentLegalDocumentIds();
    const { api } = await loginAsApi('admin');
    const plansBody = await (await api.get('subscriptions/plans')).json();
    const paid = plansBody.find((p: any) => p.name === 'BASIC');

    const res = await api.post('payments/create-intent', {
      data: {
        planId: paid.id,
        billingCycle: 'MONTHLY',
        acceptedDocumentIds: [
          ids.KVKK,
          ids.DISTANCE_SALES,
          '00000000-0000-0000-0000-000000000000',
        ],
      },
    });
    expect(res.status()).toBe(400);
  });
});
