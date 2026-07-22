import { ConflictException } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { mockPrismaClient, MockPrismaClient } from '../../common/test/prisma-mock.service';
import { SubscriptionStatus } from '../../common/constants/subscription.enum';

/**
 * Task 2 (aynı-plan tam-fiyat yenileme reddi). Defect: createIntent derives
 * `isUpgrade = existingSub.planId !== plan.id` and, when false, still walks
 * the full paid-PayTR path — reserving a full-price PENDING
 * SubscriptionPayment. On settlement that writes `currentPeriodStart: now`,
 * which RESETS (not extends) the billing period, burning whatever paid days
 * the ACTIVE tenant had left. PAST_DUE is the legitimate "Şimdi yenile"
 * (renew now) flow and must keep working — the period already lapsed there,
 * so there's nothing to burn.
 */
describe('PaymentsService.createIntent same-plan-active guard', () => {
  let prisma: MockPrismaClient;
  let paytr: any;
  let config: any;
  let subscriptions: any;
  let referralDirectory: { resolveReferralCode: jest.Mock };
  let svc: PaymentsService;

  const TENANT_ID = '11111111-2222-3333-4444-555555555555';
  const USER_ID = 'user-1';
  const PLAN_ID = 'plan-pro';
  const docIds = [
    '11111111-1111-1111-1111-111111111111',
    '22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333',
  ];

  const proPlan = {
    id: PLAN_ID,
    name: 'PRO',
    displayName: 'Profesyonel',
    monthlyPrice: '1299',
    yearlyPrice: '12990',
    currency: 'TRY',
    trialDays: 14,
    isActive: true,
  } as any;

  const businessPlan = {
    id: 'plan-business',
    name: 'BUSINESS',
    displayName: 'İşletme',
    monthlyPrice: '2999',
    yearlyPrice: '29990',
    currency: 'TRY',
    trialDays: 0,
    isActive: true,
  } as any;

  beforeEach(() => {
    prisma = mockPrismaClient();
    paytr = {
      getIframeToken: jest.fn().mockResolvedValue({
        token: 'tk',
        paymentLink: 'https://www.paytr.com/odeme/guvenli/tk',
        merchantOid: 'x',
        amount: '129900',
        currency: 'TL',
      }),
    };
    config = { get: () => undefined };
    subscriptions = { startTrialFromIntent: jest.fn().mockResolvedValue({}) };
    const consents = { verifyAndRecord: jest.fn().mockResolvedValue(undefined) };
    referralDirectory = { resolveReferralCode: jest.fn().mockResolvedValue(null) };
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
    prisma.subscription.create.mockResolvedValue({ id: 'new-pending' } as any);
    prisma.subscriptionPayment.create.mockResolvedValue({ id: 'payment-1' } as any);
    prisma.pendingPlanChange.create.mockResolvedValue({} as any);
    svc = new PaymentsService(
      prisma as any,
      paytr,
      config,
      subscriptions,
      consents as any,
      referralDirectory as any,
    );
  });

  function arrangeTenant(existingSub: any, plan: any = proPlan) {
    prisma.tenant.findUnique.mockResolvedValue({
      id: TENANT_ID,
      trialUsed: true,
      usedTrialPlanIds: [PLAN_ID],
      subscriptions: existingSub ? [existingSub] : [],
      name: 'Test',
    } as any);
    prisma.user.findUnique.mockResolvedValue({
      emailVerified: true,
      email: 'a@b.com',
      firstName: 'A',
      lastName: 'B',
      phone: '+905551234567',
    } as any);
    prisma.subscriptionPlan.findUnique.mockResolvedValue(plan);
  }

  it('rejects ACTIVE + same-plan renewal with SAME_PLAN_ACTIVE, no payment row created', async () => {
    arrangeTenant({
      id: 'sub-1',
      planId: PLAN_ID,
      status: SubscriptionStatus.ACTIVE,
      plan: proPlan,
    });

    await expect(
      svc.createIntent(
        TENANT_ID,
        USER_ID,
        { planId: PLAN_ID, billingCycle: 'MONTHLY', acceptedDocumentIds: docIds } as any,
        '127.0.0.1',
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'SAME_PLAN_ACTIVE' }),
    });

    expect(prisma.subscriptionPayment.create).not.toHaveBeenCalled();
    expect(paytr.getIframeToken).not.toHaveBeenCalled();
  });

  it('rejects with ConflictException', async () => {
    arrangeTenant({
      id: 'sub-1',
      planId: PLAN_ID,
      status: SubscriptionStatus.ACTIVE,
      plan: proPlan,
    });

    await expect(
      svc.createIntent(
        TENANT_ID,
        USER_ID,
        { planId: PLAN_ID, billingCycle: 'MONTHLY', acceptedDocumentIds: docIds } as any,
        '127.0.0.1',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('allows PAST_DUE + same-plan renewal (legitimate "Şimdi yenile" flow)', async () => {
    arrangeTenant({
      id: 'sub-1',
      planId: PLAN_ID,
      status: SubscriptionStatus.PAST_DUE,
      plan: proPlan,
    });

    const result = await svc.createIntent(
      TENANT_ID,
      USER_ID,
      { planId: PLAN_ID, billingCycle: 'MONTHLY', acceptedDocumentIds: docIds } as any,
      '127.0.0.1',
    );

    expect(result.provider).toBe('PAYTR');
    expect(prisma.subscriptionPayment.create).toHaveBeenCalled();
  });

  it('leaves upgrade (different plan) unaffected while ACTIVE', async () => {
    arrangeTenant(
      {
        id: 'sub-1',
        planId: PLAN_ID,
        status: SubscriptionStatus.ACTIVE,
        plan: proPlan,
      },
      businessPlan,
    );

    const result = await svc.createIntent(
      TENANT_ID,
      USER_ID,
      { planId: businessPlan.id, billingCycle: 'MONTHLY', acceptedDocumentIds: docIds } as any,
      '127.0.0.1',
    );

    expect(result.provider).toBe('PAYTR');
    expect(prisma.subscriptionPayment.create).toHaveBeenCalled();
    // isUpgrade path — records the target so the webhook can switch plans.
    expect(prisma.pendingPlanChange.create).toHaveBeenCalled();
  });

  it('leaves first-time subscribe (no existing subscription) unaffected', async () => {
    arrangeTenant(null);

    const result = await svc.createIntent(
      TENANT_ID,
      USER_ID,
      { planId: PLAN_ID, billingCycle: 'MONTHLY', acceptedDocumentIds: docIds } as any,
      '127.0.0.1',
    );

    expect(result.provider).toBe('PAYTR');
    expect(prisma.subscriptionPayment.create).toHaveBeenCalled();
  });
});
