import { test, expect } from '../../fixtures/test';
import { loginAsMarketing, loginAsSuperAdmin, getJson } from '../../helpers/api';
import { registerFreshTenant } from '../../helpers/fresh-tenant';
import { markEmailVerified } from '../../helpers/paytr-plan-switch';
import { simulatePaytrSuccess } from '../../helpers/paytr-webhook';

/**
 * Self-serve referral signup credits a SIGNUP commission to the
 * marketer whose code was on the intent. End-to-end:
 *
 *   1. registerFreshTenant → BUSINESS TRIAL (`tenant.trialUsed=true`,
 *      Subscription.plan='BUSINESS', isTrialPeriod=true).
 *   2. SuperAdmin marks the admin user emailVerified (createIntent
 *      requires it).
 *   3. Admin POSTs /payments/create-intent for the **same** BUSINESS
 *      plan with the marketer's referralCode. Same plan → not an
 *      upgrade → no PendingPlanChange → the webhook's signup path
 *      fires. trialUsed=true means createIntent skips the trial
 *      short-circuit and goes PAYTR.
 *   4. simulatePaytrSuccess(merchantOid, amountKurus) drives the
 *      webhook through applySuccess → creditSignupCommissionForReferral.
 *   5. Marketing API verifies the SIGNUP commission landed:
 *      tenantId match, status PENDING, leadId not null, lead.source=REFERRAL.
 *
 * The "invalid code is silently dropped" test asserts the negative
 * path: a bogus code on the intent doesn't crash checkout and doesn't
 * stamp a lead.
 */
test.describe('Marketing — self-serve referral signup', () => {
  test('referralCode + paid checkout credits a SIGNUP commission to the marketer', async () => {
    const marketing = await loginAsMarketing('SALES_MANAGER');

    type ReferralStats = {
      referralCode: string | null;
      referralLeadCount: number;
      referralWonCount: number;
      lifetimeCommissionAmount: number | string;
    };
    const baseline = await getJson<ReferralStats>(
      marketing.api,
      'marketing/dashboard/referral-stats',
    );
    expect(baseline.referralCode).toBeTruthy();
    const referralCode = baseline.referralCode!;

    const fresh = await registerFreshTenant('ref-signup');
    const sa = await loginAsSuperAdmin();
    await markEmailVerified(sa.api, fresh.user.id);

    // Same plan as the trial so the intent isn't an upgrade — the
    // SIGNUP webhook branch only fires when there's no PendingPlanChange.
    const plans = await getJson<Array<{ id: string; name: string; monthlyPrice: number | string; commissionRate: number | string }>>(
      fresh.api,
      'subscriptions/plans',
    );
    const businessPlan = plans.find((p) => p.name === 'BUSINESS');
    expect(businessPlan, 'BUSINESS plan must exist in catalogue').toBeTruthy();

    const intentRes = await fresh.api.post('payments/create-intent', {
      data: {
        planId: businessPlan!.id,
        billingCycle: 'MONTHLY',
        referralCode,
        acceptedDocumentIds: await fetchCurrentLegalIds(fresh.api),
      },
    });
    expect(intentRes.ok(), `intent: ${intentRes.status()} ${await intentRes.text()}`).toBeTruthy();
    const intent = await intentRes.json();
    // trialUsed=true on a freshly-registered tenant (auth.service stamps
    // it during register) → no trial short-circuit → real PayTR flow.
    expect(intent.provider).toBe('PAYTR');
    expect(intent.merchantOid).toBeTruthy();

    // Drive the webhook through success — flips the payment to SUCCEEDED,
    // updates the subscription, and fires creditSignupCommissionForReferral
    // (best-effort, post-commit).
    const amountKurus = Math.round(Number(intent.amount) * 100).toString();
    await simulatePaytrSuccess({ merchantOid: intent.merchantOid, totalAmountKurus: amountKurus });

    // Marketing side — find the SIGNUP commission for this exact tenant.
    // The webhook hook fires after the activation transaction commits;
    // a brief poll smooths over the post-commit delay.
    let signup: any = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      const listRes = await marketing.api.get('marketing/commissions', {
        params: { type: 'SIGNUP', status: 'PENDING' },
      });
      const body = await listRes.json();
      const rows: any[] = body?.data ?? [];
      signup = rows.find((c) => c.tenantId === fresh.user.tenantId);
      if (signup) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    expect(signup, 'SIGNUP commission for the new tenant must exist').toBeTruthy();
    expect(signup.type).toBe('SIGNUP');
    expect(signup.status).toBe('PENDING');
    expect(signup.marketingUserId).toBe(marketing.user.id);
    expect(signup.leadId).toBeTruthy();

    // Commission amount = monthlyPrice × plan.commissionRate. The
    // public /plans endpoint doesn't expose commissionRate, so we
    // assert via the marketing detail endpoint which joins it in.
    const detailRes = await marketing.api.get(
      `marketing/commissions/${signup.id}`,
    );
    expect(detailRes.ok()).toBeTruthy();
    const detail = await detailRes.json();
    const rate = Number(detail.plan?.commissionRate ?? 0);
    const monthly = Number(businessPlan!.monthlyPrice);
    expect(rate, 'plan commissionRate must resolve in commission detail').toBeGreaterThan(0);
    expect(Number(signup.amount)).toBeCloseTo(
      Number((monthly * rate).toFixed(2)),
      2,
    );

    // The auto-created Lead carries source=REFERRAL + status=WON and
    // links the tenant to the marketer for future RENEWAL/UPSELL hooks.
    const leadRes = await marketing.api.get(`marketing/leads/${signup.leadId}`);
    expect(leadRes.ok()).toBeTruthy();
    const lead = await leadRes.json();
    expect(lead.source).toBe('REFERRAL');
    expect(lead.status).toBe('WON');
    expect(lead.convertedTenantId).toBe(fresh.user.tenantId);
    expect(lead.assignedToId).toBe(marketing.user.id);

    // Referral stats should reflect the new attribution.
    const after = await getJson<ReferralStats>(
      marketing.api,
      'marketing/dashboard/referral-stats',
    );
    expect(after.referralLeadCount).toBeGreaterThanOrEqual(baseline.referralLeadCount + 1);
    expect(after.referralWonCount).toBeGreaterThanOrEqual(baseline.referralWonCount + 1);
    expect(Number(after.lifetimeCommissionAmount)).toBeGreaterThan(
      Number(baseline.lifetimeCommissionAmount),
    );

    await marketing.api.dispose();
    await fresh.api.dispose();
  });

  test('invalid referralCode is silently dropped — checkout still succeeds, no lead attached', async () => {
    const marketing = await loginAsMarketing('SALES_MANAGER');
    const baseline = await getJson<{ referralLeadCount: number }>(
      marketing.api,
      'marketing/dashboard/referral-stats',
    );

    const fresh = await registerFreshTenant('ref-bad');
    const sa = await loginAsSuperAdmin();
    await markEmailVerified(sa.api, fresh.user.id);

    const plans = await getJson<Array<{ id: string; name: string }>>(
      fresh.api,
      'subscriptions/plans',
    );
    const businessPlan = plans.find((p) => p.name === 'BUSINESS');

    const intentRes = await fresh.api.post('payments/create-intent', {
      data: {
        planId: businessPlan!.id,
        billingCycle: 'MONTHLY',
        referralCode: 'NOPE99', // valid format, unknown owner
        acceptedDocumentIds: await fetchCurrentLegalIds(fresh.api),
      },
    });
    expect(intentRes.ok()).toBeTruthy();

    // Marketer's lead count must not have moved — the unresolved code
    // was logged and ignored, no Lead planted, no commission queued.
    const after = await getJson<{ referralLeadCount: number }>(
      marketing.api,
      'marketing/dashboard/referral-stats',
    );
    expect(after.referralLeadCount).toBe(baseline.referralLeadCount);

    await marketing.api.dispose();
    await fresh.api.dispose();
  });
});

// The legal-consent endpoint returns one record per kind. Three are
// required at checkout (KVKK / DISTANCE_SALES / REFUND_POLICY).
async function fetchCurrentLegalIds(api: import('@playwright/test').APIRequestContext): Promise<string[]> {
  const kinds = ['KVKK', 'DISTANCE_SALES', 'REFUND_POLICY'] as const;
  const ids = await Promise.all(
    kinds.map(async (kind) => {
      const res = await api.get(`legal/documents/${kind}/current`);
      if (!res.ok()) throw new Error(`fetchCurrentLegalIds ${kind}: ${res.status()} ${await res.text()}`);
      const body = await res.json();
      return body.id as string;
    }),
  );
  return ids;
}
