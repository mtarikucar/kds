import { Prisma } from "@prisma/client";
import { SubscriptionService } from "./subscription.service";
import {
  mockPrismaClient,
  MockPrismaClient,
} from "../../../common/test/prisma-mock.service";
import { BillingCycle } from "../../../common/constants/subscription.enum";

/**
 * Track 2 — subscription_billing_total domain counter.
 *
 * One Prometheus tick per committed billing transition, labeled by the
 * developer-controlled lifecycle event:
 *   create     — createSubscription / startTrialFromIntent
 *   change     — changePlan (committed downgrade schedule)
 *   cancel     — cancelSubscription (immediate or at-period-end)
 *   reactivate — reactivateSubscription
 *
 * Mirrors the merged stock_movements_total pattern: @Optional()
 * MetricsService injected last in the ctor, increment AFTER the committed
 * mutation, ?.-guarded so a missing collaborator can never break the write.
 */
describe("SubscriptionService — subscription_billing_total counter", () => {
  let prisma: MockPrismaClient;
  let metrics: { incCounter: jest.Mock };
  let svc: SubscriptionService;

  const TENANT_ID = "tenant-1";
  const SUB_ID = "sub-1";

  function build() {
    prisma = mockPrismaClient();
    metrics = { incCounter: jest.fn() };
    const notifications = {
      sendTrialStarted: jest.fn().mockResolvedValue(undefined),
      sendSubscriptionCancelledImmediate: jest
        .fn()
        .mockResolvedValue(undefined),
      sendSubscriptionWillCancel: jest.fn().mockResolvedValue(undefined),
      sendPlanChangeConfirmation: jest.fn().mockResolvedValue(undefined),
    } as any;
    const billing = {
      getDaysRemaining: jest.fn().mockReturnValue(10),
      getTotalDaysInPeriod: jest.fn().mockReturnValue(30),
      calculateProration: jest.fn().mockReturnValue(new Prisma.Decimal(0)),
    } as any;
    const entitlements = {
      getForTenant: jest.fn().mockResolvedValue({
        features: {},
        limits: {},
        integrations: {},
        computedAt: new Date(0).toISOString(),
      }),
    } as any;
    svc = new SubscriptionService(
      prisma as any,
      billing,
      notifications,
      { append: jest.fn().mockResolvedValue("outbox-id") } as any,
      entitlements,
      metrics as any,
    );
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
    prisma.user.findFirst.mockResolvedValue({
      email: "admin@example.com",
    } as any);
    return { billing };
  }

  beforeEach(() => {
    build();
  });

  it("records event=create on createSubscription", async () => {
    prisma.tenant.findUnique.mockResolvedValue({
      id: TENANT_ID,
      usedTrialPlanIds: [],
      trialUsed: false,
    } as any);
    prisma.user.findFirst.mockResolvedValue({
      id: "u-1",
      role: "ADMIN",
      emailVerified: true,
    } as any);
    // deep-review H3: createSubscription only creates TRIALING or FREE rows
    // (paid activation goes through settlement). Use a trial-eligible PRO
    // plan so this is a valid TRIALING creation that still records the
    // billing-event metric.
    prisma.subscriptionPlan.findUnique.mockResolvedValue({
      id: "plan-pro",
      name: "PRO",
      displayName: "Pro",
      isActive: true,
      trialDays: 14,
      monthlyPrice: new Prisma.Decimal(100),
      yearlyPrice: new Prisma.Decimal(1000),
      currency: "TRY",
    } as any);
    prisma.subscription.create.mockResolvedValue({
      id: SUB_ID,
      plan: { name: "PRO" },
    } as any);
    prisma.tenant.update.mockResolvedValue({} as any);

    await svc.createSubscription(TENANT_ID, {
      planId: "plan-pro",
      billingCycle: BillingCycle.MONTHLY,
    } as any);

    expect(metrics.incCounter).toHaveBeenCalledWith(
      "subscription_billing_total",
      expect.any(String),
      { event: "create" },
    );
  });

  it("records event=cancel on cancelSubscription", async () => {
    const activeSub: any = {
      id: SUB_ID,
      tenantId: TENANT_ID,
      status: "ACTIVE",
      currentPeriodEnd: new Date(Date.now() + 86400000),
      plan: { displayName: "Pro" },
      tenant: { name: "Restoran" },
    };
    prisma.subscription.findUnique.mockResolvedValue(activeSub);
    prisma.subscription.updateMany.mockResolvedValue({ count: 1 } as any);
    prisma.subscription.findUniqueOrThrow.mockResolvedValue(activeSub);
    prisma.subscriptionPlan.findUnique.mockResolvedValue({
      id: "free-plan",
    } as any);
    prisma.tenant.update.mockResolvedValue({} as any);

    await svc.cancelSubscription(SUB_ID, TENANT_ID, true, "done");

    expect(metrics.incCounter).toHaveBeenCalledWith(
      "subscription_billing_total",
      expect.any(String),
      { event: "cancel" },
    );
  });

  it("records event=reactivate on reactivateSubscription", async () => {
    prisma.subscription.findUnique.mockResolvedValue({
      id: SUB_ID,
      tenantId: TENANT_ID,
      status: "ACTIVE",
      cancelAtPeriodEnd: true,
      plan: { displayName: "Pro" },
    } as any);
    prisma.subscription.updateMany.mockResolvedValue({ count: 1 } as any);
    prisma.subscription.findUniqueOrThrow.mockResolvedValue({
      id: SUB_ID,
      plan: { displayName: "Pro" },
    } as any);

    await svc.reactivateSubscription(SUB_ID, TENANT_ID);

    expect(metrics.incCounter).toHaveBeenCalledWith(
      "subscription_billing_total",
      expect.any(String),
      { event: "reactivate" },
    );
  });

  it("records event=change on a committed changePlan downgrade", async () => {
    // Current plan amount 100 → new plan amount 50 → downgrade (not upgrade).
    prisma.subscription.findUnique.mockResolvedValue({
      id: SUB_ID,
      tenantId: TENANT_ID,
      status: "ACTIVE",
      planId: "plan-pro",
      amount: new Prisma.Decimal(100),
      currentPeriodStart: new Date(Date.now() - 86400000),
      currentPeriodEnd: new Date(Date.now() + 86400000),
      billingCycle: BillingCycle.MONTHLY,
      scheduledDowngradePlanId: null,
      plan: {
        id: "plan-pro",
        currency: "TRY",
        maxUsers: 100,
        maxTables: 100,
        maxProducts: 100,
        maxCategories: 100,
      },
      tenant: {},
      payments: [],
      invoices: [],
    } as any);
    // newPlan lookup (cheaper, same currency, generous limits).
    prisma.subscriptionPlan.findUnique.mockResolvedValue({
      id: "plan-basic",
      isActive: true,
      currency: "TRY",
      monthlyPrice: new Prisma.Decimal(50),
      yearlyPrice: new Prisma.Decimal(500),
      maxUsers: -1,
      maxTables: -1,
      maxProducts: -1,
      maxCategories: -1,
    } as any);
    // assertDowngradeAllowed usage counts — all under limit.
    prisma.user.count.mockResolvedValue(1 as any);
    prisma.table.count.mockResolvedValue(1 as any);
    prisma.product.count.mockResolvedValue(1 as any);
    prisma.category.count.mockResolvedValue(1 as any);
    // The atomic claim succeeds, then the re-read returns the row.
    prisma.subscription.updateMany.mockResolvedValue({ count: 1 } as any);
    prisma.subscription.findUniqueOrThrow.mockResolvedValue({
      id: SUB_ID,
      plan: {},
      scheduledDowngradePlan: {},
    } as any);

    const res = await svc.changePlan(SUB_ID, TENANT_ID, {
      newPlanId: "plan-basic",
    } as any);

    expect((res as any).type).toBe("downgrade");
    expect(metrics.incCounter).toHaveBeenCalledWith(
      "subscription_billing_total",
      expect.any(String),
      { event: "change" },
    );
  });

  it("does not throw when no MetricsService is injected (optional dep)", async () => {
    // Re-build the service WITHOUT the metrics arg.
    const bare = new SubscriptionService(
      prisma as any,
      {} as any,
      {
        sendSubscriptionCancelledImmediate: jest
          .fn()
          .mockResolvedValue(undefined),
        sendSubscriptionWillCancel: jest.fn().mockResolvedValue(undefined),
      } as any,
      { append: jest.fn().mockResolvedValue("outbox-id") } as any,
      {
        getForTenant: jest.fn(),
      } as any,
    );
    const activeSub: any = {
      id: SUB_ID,
      tenantId: TENANT_ID,
      status: "ACTIVE",
      currentPeriodEnd: new Date(Date.now() + 86400000),
      plan: { displayName: "Pro" },
      tenant: { name: "Restoran" },
    };
    prisma.subscription.findUnique.mockResolvedValue(activeSub);
    prisma.subscription.updateMany.mockResolvedValue({ count: 1 } as any);
    prisma.subscription.findUniqueOrThrow.mockResolvedValue(activeSub);
    prisma.subscriptionPlan.findUnique.mockResolvedValue({
      id: "free-plan",
    } as any);
    prisma.tenant.update.mockResolvedValue({} as any);
    prisma.user.findFirst.mockResolvedValue(null as any);

    await expect(
      bare.cancelSubscription(SUB_ID, TENANT_ID, true, "x"),
    ).resolves.toBeDefined();
  });
});
