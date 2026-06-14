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
    // v2.8.89: cancelSubscription now wraps the updateMany + tenant
    // update in $transaction. Pass-through callback so the inner
    // updateMany count flows out as the txn result.
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
    prisma.subscriptionPlan.findUnique.mockResolvedValue({ id: 'free-plan' } as any);
    prisma.tenant.update.mockResolvedValue({} as any);
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

/**
 * Characterization tests for the downgrade usage-limit guard
 * (`assertDowngradeAllowed` / `getCurrentUsage`), exercised through
 * `changePlan`'s downgrade branch. These pin the CURRENT behavior before
 * the guard is extracted to a collaborator:
 *   - reject when ANY dimension (users/tables/products/categories) exceeds
 *     the new plan's cap, with the exact "Cannot downgrade: ..." message
 *     listing every violated dimension in order
 *   - `-1` on a plan dimension means "unlimited" → never a violation
 *   - happy path: under all caps → downgrade is scheduled (no throw)
 * The counts come from User(status=ACTIVE)/Table/Product/Category counts.
 */
describe('SubscriptionService — downgrade usage-limit guard (changePlan)', () => {
  let prisma: MockPrismaClient;
  let billing: jest.Mocked<BillingService>;
  let notifications: jest.Mocked<NotificationService>;
  let svc: SubscriptionService;

  const TENANT_ID = 'tenant-1';
  const SUB_ID = 'sub-1';

  // ACTIVE PRO sub priced at 100 so a 50-priced target is a downgrade.
  const proSub: any = {
    id: SUB_ID,
    tenantId: TENANT_ID,
    status: 'ACTIVE',
    planId: 'plan-pro',
    amount: '100',
    billingCycle: BillingCycle.MONTHLY,
    currentPeriodStart: new Date(Date.now() - 86_400_000),
    currentPeriodEnd: new Date(Date.now() + 86_400_000),
    scheduledDowngradePlanId: null,
    plan: { id: 'plan-pro', currency: 'TRY' },
    tenant: {},
    payments: [],
    invoices: [],
  };

  function buildBasicPlan(overrides: Record<string, number> = {}) {
    // Generous limits by default; individual tests tighten a dimension.
    return {
      id: 'plan-basic',
      isActive: true,
      currency: 'TRY',
      monthlyPrice: '50',
      yearlyPrice: '500',
      maxUsers: 10,
      maxTables: 10,
      maxProducts: 100,
      maxCategories: 20,
      ...overrides,
    } as any;
  }

  beforeEach(() => {
    prisma = mockPrismaClient();
    billing = {} as any;
    notifications = {
      sendPlanChangeConfirmation: jest.fn().mockResolvedValue(undefined),
    } as any;
    svc = new SubscriptionService(
      prisma as any,
      billing,
      notifications,
      { append: jest.fn().mockResolvedValue('outbox-id') } as any,
      {
        getForTenant: jest.fn().mockResolvedValue({
          features: {},
          limits: {},
          integrations: {},
          computedAt: new Date(0).toISOString(),
        }),
      } as any,
    );

    // getSubscriptionById → findUnique
    prisma.subscription.findUnique.mockResolvedValue(proSub);
    // Default counts: comfortably under any cap.
    prisma.user.count.mockResolvedValue(2 as any);
    prisma.table.count.mockResolvedValue(3 as any);
    prisma.product.count.mockResolvedValue(4 as any);
    prisma.category.count.mockResolvedValue(5 as any);
    // Atomic downgrade claim succeeds, then re-read returns the scheduled row.
    prisma.subscription.updateMany.mockResolvedValue({ count: 1 } as any);
    prisma.subscription.findUniqueOrThrow.mockResolvedValue({
      id: SUB_ID,
      plan: {},
      scheduledDowngradePlan: {},
    } as any);
  });

  it('counts ACTIVE users only (status=ACTIVE predicate)', async () => {
    prisma.subscriptionPlan.findUnique.mockResolvedValue(buildBasicPlan());
    await svc.changePlan(SUB_ID, TENANT_ID, { newPlanId: 'plan-basic' } as any);
    expect(prisma.user.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: TENANT_ID, status: 'ACTIVE' }),
      }),
    );
  });

  it('rejects the downgrade when users exceed the new plan cap', async () => {
    prisma.user.count.mockResolvedValue(11 as any);
    prisma.subscriptionPlan.findUnique.mockResolvedValue(
      buildBasicPlan({ maxUsers: 10 }),
    );
    await expect(
      svc.changePlan(SUB_ID, TENANT_ID, { newPlanId: 'plan-basic' } as any),
    ).rejects.toThrow('Cannot downgrade');
    // Guard fails BEFORE any scheduling write.
    expect(prisma.subscription.updateMany).not.toHaveBeenCalled();
  });

  it('lists every violated dimension in order (Users, Tables, Products, Categories)', async () => {
    prisma.user.count.mockResolvedValue(11 as any);
    prisma.table.count.mockResolvedValue(11 as any);
    prisma.product.count.mockResolvedValue(101 as any);
    prisma.category.count.mockResolvedValue(21 as any);
    prisma.subscriptionPlan.findUnique.mockResolvedValue(buildBasicPlan());
    await expect(
      svc.changePlan(SUB_ID, TENANT_ID, { newPlanId: 'plan-basic' } as any),
    ).rejects.toThrow(
      'Cannot downgrade: current usage exceeds new plan limits. Please reduce: ' +
        'Users: 11/10, Tables: 11/10, Products: 101/100, Categories: 21/20',
    );
  });

  it('treats -1 as unlimited (no violation even when usage is high)', async () => {
    prisma.user.count.mockResolvedValue(9999 as any);
    prisma.table.count.mockResolvedValue(9999 as any);
    prisma.product.count.mockResolvedValue(9999 as any);
    prisma.category.count.mockResolvedValue(9999 as any);
    prisma.subscriptionPlan.findUnique.mockResolvedValue(
      buildBasicPlan({
        maxUsers: -1,
        maxTables: -1,
        maxProducts: -1,
        maxCategories: -1,
      }),
    );
    const res = await svc.changePlan(SUB_ID, TENANT_ID, {
      newPlanId: 'plan-basic',
    } as any);
    expect((res as any).type).toBe('downgrade');
    expect(prisma.subscription.updateMany).toHaveBeenCalled();
  });

  it('schedules the downgrade when usage is under all caps', async () => {
    prisma.subscriptionPlan.findUnique.mockResolvedValue(buildBasicPlan());
    const res = await svc.changePlan(SUB_ID, TENANT_ID, {
      newPlanId: 'plan-basic',
    } as any);
    expect((res as any).type).toBe('downgrade');
    expect((res as any).requiresPayment).toBe(false);
    expect(prisma.subscription.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: SUB_ID,
          tenantId: TENANT_ID,
          scheduledDowngradePlanId: null,
        }),
        data: expect.objectContaining({
          scheduledDowngradePlanId: 'plan-basic',
        }),
      }),
    );
  });
});

/**
 * Auditability — privileged billing mutations (create / change-plan /
 * cancel) must capture the acting admin in user_activities so support can
 * answer "who created / downgraded / cancelled this tenant's plan". The
 * audit write is best-effort and only fires when a human actor id is
 * threaded through (scheduler/cron callers pass none).
 */
describe('SubscriptionService — billing audit (user_activities)', () => {
  let prisma: MockPrismaClient;
  let svc: SubscriptionService;

  const TENANT_ID = 'tenant-1';
  const SUB_ID = 'sub-1';
  const ACTOR_ID = 'admin-7';

  function build() {
    prisma = mockPrismaClient();
    svc = new SubscriptionService(
      prisma as any,
      {} as any,
      { sendTrialStarted: jest.fn().mockResolvedValue(undefined) } as any,
      { append: jest.fn().mockResolvedValue('outbox-id') } as any,
      {
        getForTenant: jest.fn().mockResolvedValue({
          features: {},
          limits: {},
          integrations: {},
          computedAt: new Date(0).toISOString(),
        }),
      } as any,
    );
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
  }

  beforeEach(build);

  it('createSubscription writes SUBSCRIPTION_CREATED with actor + plan fields', async () => {
    prisma.tenant.findUnique.mockResolvedValue({
      id: TENANT_ID,
      usedTrialPlanIds: [],
      trialUsed: false,
    } as any);
    prisma.user.findFirst.mockResolvedValue({
      id: 'u-admin',
      emailVerified: true,
    } as any);
    prisma.subscriptionPlan.findUnique.mockResolvedValue({
      id: 'plan-free',
      name: 'FREE',
      currency: 'TRY',
      monthlyPrice: '0',
      yearlyPrice: '0',
      trialDays: 0,
      isActive: true,
      displayName: 'Ücretsiz',
    } as any);
    prisma.subscription.create.mockResolvedValue({ id: SUB_ID, plan: {} } as any);
    prisma.tenant.update.mockResolvedValue({} as any);

    await svc.createSubscription(
      TENANT_ID,
      { planId: 'plan-free', billingCycle: BillingCycle.MONTHLY } as any,
      ACTOR_ID,
    );

    expect(prisma.userActivity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: ACTOR_ID,
        tenantId: TENANT_ID,
        action: 'SUBSCRIPTION_CREATED',
        metadata: expect.objectContaining({
          subscriptionId: SUB_ID,
          planId: 'plan-free',
          planName: 'FREE',
          billingCycle: BillingCycle.MONTHLY,
        }),
      }),
    });
  });

  it('createSubscription WITHOUT an actor writes no audit row', async () => {
    prisma.tenant.findUnique.mockResolvedValue({
      id: TENANT_ID,
      usedTrialPlanIds: [],
      trialUsed: false,
    } as any);
    prisma.user.findFirst.mockResolvedValue({
      id: 'u-admin',
      emailVerified: true,
    } as any);
    prisma.subscriptionPlan.findUnique.mockResolvedValue({
      id: 'plan-free',
      name: 'FREE',
      currency: 'TRY',
      monthlyPrice: '0',
      yearlyPrice: '0',
      trialDays: 0,
      isActive: true,
      displayName: 'Ücretsiz',
    } as any);
    prisma.subscription.create.mockResolvedValue({ id: SUB_ID, plan: {} } as any);
    prisma.tenant.update.mockResolvedValue({} as any);

    await svc.createSubscription(
      TENANT_ID,
      { planId: 'plan-free', billingCycle: BillingCycle.MONTHLY } as any,
    );

    expect(prisma.userActivity.create).not.toHaveBeenCalled();
  });

  it('changePlan (downgrade) writes SUBSCRIPTION_PLAN_CHANGED with from/to', async () => {
    prisma.subscription.findUnique.mockResolvedValue({
      id: SUB_ID,
      tenantId: TENANT_ID,
      status: 'ACTIVE',
      planId: 'plan-pro',
      amount: '100',
      billingCycle: BillingCycle.MONTHLY,
      currentPeriodStart: new Date(Date.now() - 86_400_000),
      currentPeriodEnd: new Date(Date.now() + 86_400_000),
      scheduledDowngradePlanId: null,
      plan: { id: 'plan-pro', name: 'PRO', currency: 'TRY' },
      tenant: {},
    } as any);
    prisma.subscriptionPlan.findUnique.mockResolvedValue({
      id: 'plan-basic',
      name: 'BASIC',
      isActive: true,
      currency: 'TRY',
      monthlyPrice: '50',
      yearlyPrice: '500',
      maxUsers: 10,
      maxTables: 10,
      maxProducts: 100,
      maxCategories: 20,
    } as any);
    prisma.user.count.mockResolvedValue(1 as any);
    prisma.table.count.mockResolvedValue(1 as any);
    prisma.product.count.mockResolvedValue(1 as any);
    prisma.category.count.mockResolvedValue(1 as any);
    prisma.subscription.updateMany.mockResolvedValue({ count: 1 } as any);
    prisma.subscription.findUniqueOrThrow.mockResolvedValue({
      id: SUB_ID,
      plan: {},
      scheduledDowngradePlan: {},
    } as any);

    await svc.changePlan(
      SUB_ID,
      TENANT_ID,
      { newPlanId: 'plan-basic' } as any,
      ACTOR_ID,
    );

    expect(prisma.userActivity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: ACTOR_ID,
        tenantId: TENANT_ID,
        action: 'SUBSCRIPTION_PLAN_CHANGED',
        metadata: expect.objectContaining({
          subscriptionId: SUB_ID,
          fromPlanName: 'PRO',
          toPlanName: 'BASIC',
          type: 'downgrade',
        }),
      }),
    });
  });

  it('cancelSubscription writes SUBSCRIPTION_CANCELLED with actor + reason', async () => {
    prisma.subscription.findUnique.mockResolvedValue({
      id: SUB_ID,
      tenantId: TENANT_ID,
      status: 'ACTIVE',
      planId: 'plan-pro',
      currentPeriodEnd: new Date(Date.now() + 86_400_000),
      plan: { name: 'PRO', displayName: 'Profesyonel' },
      tenant: { name: 'Test Restoran' },
    } as any);
    prisma.subscription.updateMany.mockResolvedValue({ count: 1 } as any);
    prisma.subscription.findUniqueOrThrow.mockResolvedValue({
      id: SUB_ID,
      plan: { name: 'PRO', displayName: 'Profesyonel' },
      tenant: { name: 'Test Restoran' },
    } as any);
    prisma.subscriptionPlan.findUnique.mockResolvedValue({ id: 'free-plan' } as any);
    prisma.tenant.update.mockResolvedValue({} as any);
    prisma.user.findFirst.mockResolvedValue(null as any);

    await svc.cancelSubscription(SUB_ID, TENANT_ID, true, 'churned', ACTOR_ID);

    expect(prisma.userActivity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: ACTOR_ID,
        tenantId: TENANT_ID,
        action: 'SUBSCRIPTION_CANCELLED',
        metadata: expect.objectContaining({
          subscriptionId: SUB_ID,
          immediate: true,
          reason: 'churned',
        }),
      }),
    });
  });

  it('is best-effort: a failing billing audit never breaks the cancel', async () => {
    prisma.subscription.findUnique.mockResolvedValue({
      id: SUB_ID,
      tenantId: TENANT_ID,
      status: 'ACTIVE',
      planId: 'plan-pro',
      currentPeriodEnd: new Date(Date.now() + 86_400_000),
      plan: { name: 'PRO', displayName: 'Profesyonel' },
      tenant: { name: 'Test Restoran' },
    } as any);
    prisma.subscription.updateMany.mockResolvedValue({ count: 1 } as any);
    prisma.subscription.findUniqueOrThrow.mockResolvedValue({
      id: SUB_ID,
      plan: { name: 'PRO', displayName: 'Profesyonel' },
      tenant: { name: 'Test Restoran' },
    } as any);
    prisma.subscriptionPlan.findUnique.mockResolvedValue({ id: 'free-plan' } as any);
    prisma.tenant.update.mockResolvedValue({} as any);
    prisma.user.findFirst.mockResolvedValue(null as any);
    (prisma.userActivity.create as any).mockRejectedValue(new Error('audit down'));
    jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => undefined);

    await expect(
      svc.cancelSubscription(SUB_ID, TENANT_ID, true, 'churned', ACTOR_ID),
    ).resolves.toEqual(expect.objectContaining({ id: SUB_ID }));
  });
});
