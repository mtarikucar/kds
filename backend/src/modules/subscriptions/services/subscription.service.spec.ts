import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SubscriptionService } from './subscription.service';
import { BillingService } from './billing.service';
import { NotificationService } from './notification.service';
import { mockPrismaClient, MockPrismaClient } from '../../../common/test/prisma-mock.service';
import { BillingCycle } from '../../../common/constants/subscription.enum';

/**
 * Unit tests for the trial-creation paths. We mock Prisma (deep mock from
 * jest-mock-extended) so we don't need a real DB — each test wires up the
 * specific fetch/update returns it cares about. The actual transactional
 * atomicity is covered by the e2e suite; here we just verify the
 * decision-tree (eligibility, P2002 mapping, side-effects on tenant row).
 */
describe('SubscriptionService.startTrialFromIntent', () => {
  let prisma: MockPrismaClient;
  let billing: jest.Mocked<BillingService>;
  let notifications: jest.Mocked<NotificationService>;
  let svc: SubscriptionService;

  const PLAN_ID = 'plan-pro';
  const TENANT_ID = 'tenant-1';
  const USER_ID = 'user-1';

  const proPlan = {
    id: PLAN_ID,
    name: 'PRO',
    displayName: 'Profesyonel',
    monthlyPrice: '1299' as any,
    yearlyPrice: '12990' as any,
    currency: 'TRY',
    trialDays: 14,
    isActive: true,
  } as any;

  beforeEach(() => {
    prisma = mockPrismaClient();
    billing = {} as any;
    notifications = {
      sendTrialStarted: jest.fn().mockResolvedValue(undefined),
    } as any;
    svc = new SubscriptionService(
      prisma as any,
      billing,
      notifications,
      { append: jest.fn().mockResolvedValue('outbox-id') } as any,
      // v2.8.88: EntitlementService stub. Default returns an empty set
      // so existing tests (which don't care about engine routing)
      // continue to hit the plan-only fallback branch.
      {
        getForTenant: jest.fn().mockResolvedValue({
          features: {},
          limits: {},
          integrations: {},
          computedAt: new Date(0).toISOString(),
        }),
      } as any,
    );

    // Sensible defaults — individual tests override.
    prisma.user.findUnique.mockResolvedValue({ emailVerified: true } as any);
    prisma.subscriptionPlan.findUnique.mockResolvedValue(proPlan);
    prisma.tenant.findUnique.mockResolvedValue({ usedTrialPlanIds: [] } as any);

    // $transaction passes through the tx fn with the same mock client.
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
  });

  it('throws NotFoundException when calling user does not exist', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(
      svc.startTrialFromIntent({
        tenantId: TENANT_ID,
        callingUserId: USER_ID,
        planId: PLAN_ID,
        billingCycle: BillingCycle.MONTHLY,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws BadRequestException when calling user email not verified', async () => {
    prisma.user.findUnique.mockResolvedValue({ emailVerified: false } as any);
    await expect(
      svc.startTrialFromIntent({
        tenantId: TENANT_ID,
        callingUserId: USER_ID,
        planId: PLAN_ID,
        billingCycle: BillingCycle.MONTHLY,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws NotFoundException when plan is missing or inactive', async () => {
    prisma.subscriptionPlan.findUnique.mockResolvedValue(null);
    await expect(
      svc.startTrialFromIntent({
        tenantId: TENANT_ID,
        callingUserId: USER_ID,
        planId: PLAN_ID,
        billingCycle: BillingCycle.MONTHLY,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects starting a trial on the FREE plan', async () => {
    prisma.subscriptionPlan.findUnique.mockResolvedValue({
      ...proPlan,
      name: 'FREE',
    } as any);
    await expect(
      svc.startTrialFromIntent({
        tenantId: TENANT_ID,
        callingUserId: USER_ID,
        planId: PLAN_ID,
        billingCycle: BillingCycle.MONTHLY,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects starting a trial on a plan without trialDays', async () => {
    prisma.subscriptionPlan.findUnique.mockResolvedValue({
      ...proPlan,
      trialDays: 0,
    } as any);
    await expect(
      svc.startTrialFromIntent({
        tenantId: TENANT_ID,
        callingUserId: USER_ID,
        planId: PLAN_ID,
        billingCycle: BillingCycle.MONTHLY,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects re-trialing once the tenant has already used any trial (lifetime gate)', async () => {
    // Trial eligibility moved from per-plan (`usedTrialPlanIds`) to a
    // lifetime per-tenant flag (`trialUsed`). The historical row is
    // still kept for audit but `trialUsed=true` is the canonical gate.
    prisma.tenant.findUnique.mockResolvedValue({
      trialUsed: true,
      usedTrialPlanIds: [PLAN_ID],
    } as any);
    await expect(
      svc.startTrialFromIntent({
        tenantId: TENANT_ID,
        callingUserId: USER_ID,
        planId: PLAN_ID,
        billingCycle: BillingCycle.MONTHLY,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects starting a trial when tenant has a paid (non-FREE) live sub', async () => {
    prisma.subscription.findFirst.mockResolvedValue({
      id: 'sub-x',
      plan: { name: 'PRO' },
    } as any);
    prisma.subscription.create.mockResolvedValue({ id: 'new' } as any);
    prisma.subscription.update.mockResolvedValue({} as any);
    prisma.tenant.update.mockResolvedValue({} as any);

    await expect(
      svc.startTrialFromIntent({
        tenantId: TENANT_ID,
        callingUserId: USER_ID,
        planId: PLAN_ID,
        billingCycle: BillingCycle.MONTHLY,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('cancels existing FREE sub and creates new TRIALING in one tx', async () => {
    prisma.subscription.findFirst.mockResolvedValue({
      id: 'free-sub',
      plan: { name: 'FREE' },
    } as any);
    prisma.subscription.update.mockResolvedValue({} as any);
    prisma.subscription.create.mockResolvedValue({ id: 'trialing-sub', plan: proPlan } as any);
    prisma.tenant.update.mockResolvedValue({} as any);

    await svc.startTrialFromIntent({
      tenantId: TENANT_ID,
      callingUserId: USER_ID,
      planId: PLAN_ID,
      billingCycle: BillingCycle.MONTHLY,
    });

    // FREE sub cancelled with the audit reason
    expect(prisma.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'free-sub' },
        data: expect.objectContaining({
          status: 'CANCELLED',
          cancellationReason: 'Replaced by paid-plan trial',
        }),
      }),
    );

    // New TRIALING sub created with trial dates
    expect(prisma.subscription.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: TENANT_ID,
          planId: PLAN_ID,
          status: 'TRIALING',
          isTrialPeriod: true,
          paymentProvider: 'PAYTR',
        }),
      }),
    );

    // Tenant trial registry updated (per-plan + legacy flag)
    expect(prisma.tenant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: TENANT_ID },
        data: expect.objectContaining({
          currentPlanId: PLAN_ID,
          trialUsed: true,
          usedTrialPlanIds: { push: PLAN_ID },
        }),
      }),
    );
  });

  it('creates a TRIALING sub directly when no live sub exists', async () => {
    prisma.subscription.findFirst.mockResolvedValue(null);
    prisma.subscription.create.mockResolvedValue({ id: 'trialing-sub', plan: proPlan } as any);
    prisma.tenant.update.mockResolvedValue({} as any);

    await svc.startTrialFromIntent({
      tenantId: TENANT_ID,
      callingUserId: USER_ID,
      planId: PLAN_ID,
      billingCycle: BillingCycle.MONTHLY,
    });

    // No prior sub to cancel
    expect(prisma.subscription.update).not.toHaveBeenCalled();
    expect(prisma.subscription.create).toHaveBeenCalled();
  });

  it('fires the trial-started email post-commit (best-effort)', async () => {
    prisma.subscription.findFirst.mockResolvedValue(null);
    prisma.subscription.create.mockResolvedValue({ id: 'trialing-sub', plan: proPlan } as any);
    prisma.tenant.update.mockResolvedValue({} as any);
    prisma.user.findFirst.mockResolvedValue({
      email: 'admin@example.com',
      tenant: { name: 'Test Restaurant' },
    } as any);

    await svc.startTrialFromIntent({
      tenantId: TENANT_ID,
      callingUserId: USER_ID,
      planId: PLAN_ID,
      billingCycle: BillingCycle.MONTHLY,
    });

    // The notification is fired with `void` so we need to flush microtasks
    // before asserting.
    await new Promise((r) => setImmediate(r));
    expect(notifications.sendTrialStarted).toHaveBeenCalledWith(
      'admin@example.com',
      'Test Restaurant',
      'Profesyonel',
      14,
    );
  });

  it('maps P2002 (concurrent active sub) to BadRequestException', async () => {
    prisma.subscription.findFirst.mockResolvedValue(null);
    const p2002 = Object.assign(
      new Error('Unique constraint failed'),
      { code: 'P2002', clientVersion: '6.0.0', name: 'PrismaClientKnownRequestError' },
    );
    // Make the create blow up so the catch arm fires.
    Object.setPrototypeOf(p2002, require('@prisma/client').Prisma.PrismaClientKnownRequestError.prototype);
    prisma.subscription.create.mockRejectedValue(p2002);

    await expect(
      svc.startTrialFromIntent({
        tenantId: TENANT_ID,
        callingUserId: USER_ID,
        planId: PLAN_ID,
        billingCycle: BillingCycle.MONTHLY,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

/**
 * Manual-renewal cancellation:
 *   - immediate=true → status CANCELLED + cancelledAt + endedAt = now
 *   - immediate=false → cancelAtPeriodEnd=true (deferred)
 *
 * No PayTR token to revoke (column dropped); cancellation is now a
 * single subscription update + best-effort notification email.
 */
describe('SubscriptionService.cancelSubscription', () => {
  let prisma: MockPrismaClient;
  let billing: jest.Mocked<BillingService>;
  let notifications: jest.Mocked<NotificationService>;
  let svc: SubscriptionService;

  const TENANT_ID = 'tenant-1';
  const SUB_ID = 'sub-1';

  const activeSub: any = {
    id: SUB_ID,
    tenantId: TENANT_ID,
    status: 'ACTIVE',
    currentPeriodEnd: new Date(Date.now() + 24 * 60 * 60 * 1000),
    plan: { displayName: 'Profesyonel' },
    tenant: { name: 'Test Restoran' },
  };

  beforeEach(() => {
    prisma = mockPrismaClient();
    billing = {} as any;
    notifications = {
      sendSubscriptionCancelledImmediate: jest.fn().mockResolvedValue(undefined),
      sendSubscriptionWillCancel: jest.fn().mockResolvedValue(undefined),
    } as any;
    svc = new SubscriptionService(
      prisma as any,
      billing,
      notifications,
      { append: jest.fn().mockResolvedValue('outbox-id') } as any,
      // v2.8.88: EntitlementService stub. Default returns an empty set
      // so existing tests (which don't care about engine routing)
      // continue to hit the plan-only fallback branch.
      {
        getForTenant: jest.fn().mockResolvedValue({
          features: {},
          limits: {},
          integrations: {},
          computedAt: new Date(0).toISOString(),
        }),
      } as any,
    );

    // getSubscriptionById uses findUnique({ id })
    prisma.subscription.findUnique.mockResolvedValue(activeSub);
    // Race-safe cancel path: updateMany + count check, then re-read
    // via findUniqueOrThrow. Mirror both in the mocks.
    prisma.subscription.updateMany.mockResolvedValue({ count: 1 } as any);
    prisma.subscription.findUniqueOrThrow.mockResolvedValue(activeSub);
    prisma.user.findFirst.mockResolvedValue({ email: 'admin@example.com' } as any);
  });

  it('immediate=true → writes CANCELLED + cancelledAt + endedAt', async () => {
    await svc.cancelSubscription(SUB_ID, TENANT_ID, true, 'no longer needed');

    expect(prisma.subscription.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: SUB_ID,
          tenantId: TENANT_ID,
        }),
        data: expect.objectContaining({
          status: 'CANCELLED',
          cancelledAt: expect.any(Date),
          endedAt: expect.any(Date),
          cancellationReason: 'no longer needed',
        }),
      }),
    );
  });

  it('immediate=false → writes cancelAtPeriodEnd=true (deferred)', async () => {
    await svc.cancelSubscription(SUB_ID, TENANT_ID, false, 'will let it expire');

    expect(prisma.subscription.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cancelAtPeriodEnd: true,
          cancellationReason: 'will let it expire',
        }),
      }),
    );
    // No endedAt set on deferred cancellation
    const call = (prisma.subscription.updateMany as any).mock.calls[0][0];
    expect(call.data.endedAt).toBeUndefined();
  });

  it('sends the immediate-cancellation email when immediate=true', async () => {
    await svc.cancelSubscription(SUB_ID, TENANT_ID, true, 'ops cancel');
    expect(notifications.sendSubscriptionCancelledImmediate).toHaveBeenCalledWith(
      'admin@example.com',
      'Test Restoran',
      'Profesyonel',
      'ops cancel',
    );
  });

  it('sends the at-period-end warning email when immediate=false', async () => {
    await svc.cancelSubscription(SUB_ID, TENANT_ID, false);
    expect(notifications.sendSubscriptionWillCancel).toHaveBeenCalled();
  });
});
