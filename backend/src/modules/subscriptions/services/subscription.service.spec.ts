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
    monthlyPrice: '799' as any,
    yearlyPrice: '7990' as any,
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
    svc = new SubscriptionService(prisma as any, billing, notifications);

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

  it('rejects re-trialing the same plan (per-plan lifetime)', async () => {
    prisma.tenant.findUnique.mockResolvedValue({
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
