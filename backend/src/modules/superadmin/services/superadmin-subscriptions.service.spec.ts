import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { SuperAdminSubscriptionsService } from "./superadmin-subscriptions.service";
import {
  mockPrismaClient,
  MockPrismaClient,
} from "../../../common/test/prisma-mock.service";

/**
 * Unit tests for the refundPayment ops endpoint. Real PayTR calls are
 * mocked at the PaytrAdapter boundary so we only assert this service's
 * eligibility checks, state transition, and audit-trail handoff.
 */
describe("SuperAdminSubscriptionsService.refundPayment", () => {
  let prisma: MockPrismaClient;
  let audit: any;
  let subscriptionService: any;
  let paytr: any;
  let svc: SuperAdminSubscriptionsService;

  const SUB_ID = "sub-1";
  const PAYMENT_ID = "pay-1";
  const TENANT_ID = "tenant-1";
  const MERCHANT_OID = "SUB-tenant-1-abc";

  const successfulPayment: any = {
    id: PAYMENT_ID,
    subscriptionId: SUB_ID,
    status: "SUCCEEDED",
    amount: new Prisma.Decimal("799"),
    paidAt: new Date(),
    paytrMerchantOid: MERCHANT_OID,
    subscription: {
      id: SUB_ID,
      tenantId: TENANT_ID,
      tenant: { name: "Test Restoran" },
    },
  };

  beforeEach(() => {
    prisma = mockPrismaClient();
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    subscriptionService = {};
    paytr = {
      refund: jest.fn().mockResolvedValue({ status: "success", raw: {} }),
    };
    // Atomic claim (deep-review H17) runs before every PayTR call; default to
    // "this request won the claim" so the existing eligibility/transition
    // assertions exercise the happy path. Concurrency is asserted separately.
    prisma.subscriptionPayment.updateMany.mockResolvedValue({
      count: 1,
    } as any);
    svc = new SuperAdminSubscriptionsService(
      prisma as any,
      audit,
      subscriptionService,
      // v3.3.0 — the scheduler collaborator is gone: its jobs managed
      // subscriptions, and the renewal equivalents live on
      // RenewalSchedulerService.
      paytr,
    );
  });

  it("throws NotFound when the payment does not exist", async () => {
    prisma.subscriptionPayment.findUnique.mockResolvedValue(null);
    await expect(
      svc.refundPayment(
        SUB_ID,
        { paymentId: PAYMENT_ID, reason: "test" },
        "a1",
        "a@x",
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("throws BadRequest when the payment belongs to a different subscription", async () => {
    prisma.subscriptionPayment.findUnique.mockResolvedValue({
      ...successfulPayment,
      subscriptionId: "other-sub",
    });
    await expect(
      svc.refundPayment(
        SUB_ID,
        { paymentId: PAYMENT_ID, reason: "test" },
        "a1",
        "a@x",
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("throws BadRequest when the payment is not in SUCCEEDED state", async () => {
    prisma.subscriptionPayment.findUnique.mockResolvedValue({
      ...successfulPayment,
      status: "PENDING",
    });
    await expect(
      svc.refundPayment(
        SUB_ID,
        { paymentId: PAYMENT_ID, reason: "test" },
        "a1",
        "a@x",
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("throws BadRequest when the payment has no paytrMerchantOid", async () => {
    prisma.subscriptionPayment.findUnique.mockResolvedValue({
      ...successfulPayment,
      paytrMerchantOid: null,
    });
    await expect(
      svc.refundPayment(
        SUB_ID,
        { paymentId: PAYMENT_ID, reason: "test" },
        "a1",
        "a@x",
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("throws BadRequest when the requested amount exceeds the original", async () => {
    prisma.subscriptionPayment.findUnique.mockResolvedValue(successfulPayment);
    await expect(
      svc.refundPayment(
        SUB_ID,
        { paymentId: PAYMENT_ID, amount: 1000, reason: "oversized" },
        "a1",
        "a@x",
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(paytr.refund).not.toHaveBeenCalled();
  });

  it("full refund: calls PayTR with payment.amount and writes REFUNDED + audit", async () => {
    prisma.subscriptionPayment.findUnique.mockResolvedValue(successfulPayment);
    prisma.subscriptionPayment.update.mockResolvedValue({
      ...successfulPayment,
      status: "REFUNDED",
    });

    await svc.refundPayment(
      SUB_ID,
      { paymentId: PAYMENT_ID, reason: "customer requested" },
      "actor-1",
      "actor@example.com",
    );

    expect(paytr.refund).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantOid: MERCHANT_OID,
        // refund() accepts Decimal | number | string — assert the value
        amount: expect.anything(),
      }),
    );
    expect(prisma.subscriptionPayment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: PAYMENT_ID },
        data: expect.objectContaining({
          status: "REFUNDED",
          refundedAt: expect.any(Date),
        }),
      }),
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "REFUND",
        entityType: "SUBSCRIPTION",
        entityId: SUB_ID,
        actorId: "actor-1",
        actorEmail: "actor@example.com",
        newData: expect.objectContaining({
          status: "REFUNDED",
          refundedAmount: expect.any(String),
          reason: "customer requested",
        }),
      }),
    );
  });

  it("partial refund: passes the smaller amount to PayTR but still REFUNDED", async () => {
    prisma.subscriptionPayment.findUnique.mockResolvedValue(successfulPayment);
    prisma.subscriptionPayment.update.mockResolvedValue(successfulPayment);

    await svc.refundPayment(
      SUB_ID,
      { paymentId: PAYMENT_ID, amount: 100, reason: "partial" },
      "a1",
      "a@x",
    );

    const refundCall = paytr.refund.mock.calls[0][0];
    expect(new Prisma.Decimal(refundCall.amount).toString()).toBe("100");
    // Audit captures the partial amount so support can later reconstruct.
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        newData: expect.objectContaining({ refundedAmount: "100" }),
      }),
    );
  });

  it("surfaces PayTR rejections as BadRequestException with the reason", async () => {
    prisma.subscriptionPayment.findUnique.mockResolvedValue(successfulPayment);
    paytr.refund.mockResolvedValue({
      status: "failed",
      reason: "transaction_too_old",
      raw: {},
    });

    await expect(
      svc.refundPayment(
        SUB_ID,
        { paymentId: PAYMENT_ID, reason: "test" },
        "a1",
        "a@x",
      ),
    ).rejects.toThrow("transaction_too_old");
    // Payment row stays SUCCEEDED on PayTR-side failures.
    expect(prisma.subscriptionPayment.update).not.toHaveBeenCalled();
  });

  it("14-day cooling-off: logs warning but allows refund (soft check)", async () => {
    const oldPaidAt = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    prisma.subscriptionPayment.findUnique.mockResolvedValue({
      ...successfulPayment,
      paidAt: oldPaidAt,
    });
    prisma.subscriptionPayment.update.mockResolvedValue(successfulPayment);
    const warnSpy = jest
      .spyOn((svc as any).logger, "warn")
      .mockImplementation(() => undefined);

    await svc.refundPayment(
      SUB_ID,
      { paymentId: PAYMENT_ID, reason: "goodwill" },
      "a1",
      "a@x",
    );

    expect(warnSpy).toHaveBeenCalled();
    expect(paytr.refund).toHaveBeenCalled(); // not blocked
    expect(prisma.subscriptionPayment.update).toHaveBeenCalled();
  });

  // deep-review H17: two ops requests (double-click / retry / two operators)
  // both read status=SUCCEEDED and pass the eligibility guard; without an
  // atomic claim they could both call paytr.refund() with DIFFERENT partial
  // amounts and move real money twice. The SUCCEEDED→REFUNDING updateMany is
  // the real de-dupe: exactly one caller wins (count===1), the loser gets 409.
  it("concurrency: two refunds with different partial amounts call PayTR exactly once", async () => {
    prisma.subscriptionPayment.findUnique.mockResolvedValue(successfulPayment);
    prisma.subscriptionPayment.update.mockResolvedValue(successfulPayment);
    // First claim wins, every subsequent claim loses (row no longer SUCCEEDED).
    let claimed = false;
    prisma.subscriptionPayment.updateMany.mockImplementation(async () => {
      if (!claimed) {
        claimed = true;
        return { count: 1 } as any;
      }
      return { count: 0 } as any;
    });

    const results = await Promise.allSettled([
      svc.refundPayment(
        SUB_ID,
        { paymentId: PAYMENT_ID, amount: 100, reason: "a" },
        "op1",
        "op1@x",
      ),
      svc.refundPayment(
        SUB_ID,
        { paymentId: PAYMENT_ID, amount: 250, reason: "b" },
        "op2",
        "op2@x",
      ),
    ]);

    // PayTR is invoked exactly once — no double money movement.
    expect(paytr.refund).toHaveBeenCalledTimes(1);
    // Exactly one succeeded; the loser is rejected with a 409 Conflict.
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      ConflictException,
    );
  });

  it("rolls the claim back to SUCCEEDED when PayTR rejects (allows retry)", async () => {
    prisma.subscriptionPayment.findUnique.mockResolvedValue(successfulPayment);
    paytr.refund.mockResolvedValue({
      status: "failed",
      reason: "declined",
      raw: {},
    });

    await expect(
      svc.refundPayment(
        SUB_ID,
        { paymentId: PAYMENT_ID, reason: "test" },
        "a1",
        "a@x",
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    // Two updateMany calls: the SUCCEEDED→REFUNDING claim, then the
    // REFUNDING→SUCCEEDED rollback.
    expect(prisma.subscriptionPayment.updateMany).toHaveBeenCalledTimes(2);
    expect(prisma.subscriptionPayment.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "REFUNDING" }),
        data: expect.objectContaining({ status: "SUCCEEDED" }),
      }),
    );
    // Terminal write never happens on a PayTR rejection.
    expect(prisma.subscriptionPayment.update).not.toHaveBeenCalled();
  });
});

/**
 * Regression: the superadmin Plans form sends 5 discount fields
 * (discountPercentage/Label/StartDate/EndDate + isDiscountActive) and the
 * DTO validates them, but createPlan/updatePlan never mapped them into the
 * Prisma write — so a discount edit returned 200 OK and silently vanished.
 */
describe("SuperAdminSubscriptionsService plan discount persistence", () => {
  let prisma: MockPrismaClient;
  let audit: any;
  let svc: SuperAdminSubscriptionsService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    svc = new SuperAdminSubscriptionsService(
      prisma as any,
      audit,
      {} as any,
      {
        handleSubscriptionPeriodEnd: jest.fn(),
        handleSubscriptionExpiryReminders: jest.fn(),
      } as any,
      {} as any,
    );
  });

  it("createPlan writes the discount fields (dates coerced to Date)", async () => {
    prisma.subscriptionPlan.create.mockResolvedValue({ id: "plan-1" });

    await svc.createPlan(
      {
        name: "pro",
        displayName: "Pro",
        monthlyPrice: 100,
        yearlyPrice: 1000,
        discountPercentage: 25,
        discountLabel: "Launch",
        discountStartDate: "2026-06-16",
        discountEndDate: "2026-07-16",
        isDiscountActive: true,
      } as any,
      "a1",
      "a@x",
    );

    expect(prisma.subscriptionPlan.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          discountPercentage: 25,
          discountLabel: "Launch",
          discountStartDate: new Date("2026-06-16"),
          discountEndDate: new Date("2026-07-16"),
          isDiscountActive: true,
        }),
      }),
    );
  });

  it("updatePlan writes the discount fields (dates coerced to Date)", async () => {
    prisma.subscriptionPlan.findUnique.mockResolvedValue({ id: "plan-1" });
    prisma.subscriptionPlan.update.mockResolvedValue({ id: "plan-1" });

    await svc.updatePlan(
      "plan-1",
      {
        discountPercentage: 30,
        discountLabel: "Sale",
        discountStartDate: "2026-06-16",
        discountEndDate: "2026-07-16",
        isDiscountActive: true,
      } as any,
      "a1",
      "a@x",
    );

    expect(prisma.subscriptionPlan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          discountPercentage: 30,
          discountLabel: "Sale",
          discountStartDate: new Date("2026-06-16"),
          discountEndDate: new Date("2026-07-16"),
          isDiscountActive: true,
        }),
      }),
    );
  });

  it("updatePlan leaves discount dates untouched (undefined) when omitted", async () => {
    prisma.subscriptionPlan.findUnique.mockResolvedValue({ id: "plan-1" });
    prisma.subscriptionPlan.update.mockResolvedValue({ id: "plan-1" });

    await svc.updatePlan("plan-1", { monthlyPrice: 200 } as any, "a1", "a@x");

    const data = prisma.subscriptionPlan.update.mock.calls[0][0].data;
    expect(data.discountStartDate).toBeUndefined();
    expect(data.discountEndDate).toBeUndefined();
  });
});

/**
 * Regression: maxBranches was a SubscriptionPlan column (added in v3.0.0) that
 * createPlan/updatePlan never wrote and the DTO never exposed. A plan created
 * via the superadmin form fell back to the schema default (1) instead of the
 * intended cap, and a BUSINESS plan's unlimited (-1) branch cap could not be
 * managed from the form at all. The branch cap must round-trip like the other
 * five limits.
 */
describe("SuperAdminSubscriptionsService plan maxBranches persistence", () => {
  let prisma: MockPrismaClient;
  let audit: any;
  let svc: SuperAdminSubscriptionsService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    svc = new SuperAdminSubscriptionsService(
      prisma as any,
      audit,
      {} as any,
      {
        handleSubscriptionPeriodEnd: jest.fn(),
        handleSubscriptionExpiryReminders: jest.fn(),
      } as any,
      {} as any,
    );
  });

  it("createPlan persists an explicit maxBranches", async () => {
    prisma.subscriptionPlan.create.mockResolvedValue({ id: "plan-1" });

    await svc.createPlan(
      {
        name: "chain",
        displayName: "Chain",
        monthlyPrice: 100,
        yearlyPrice: 1000,
        maxBranches: 3,
      } as any,
      "a1",
      "a@x",
    );

    expect(prisma.subscriptionPlan.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ maxBranches: 3 }),
      }),
    );
  });

  it("createPlan defaults maxBranches to 1 when omitted", async () => {
    prisma.subscriptionPlan.create.mockResolvedValue({ id: "plan-1" });

    await svc.createPlan(
      { name: "p", displayName: "P", monthlyPrice: 0, yearlyPrice: 0 } as any,
      "a1",
      "a@x",
    );

    const data = prisma.subscriptionPlan.create.mock.calls[0][0].data;
    expect(data.maxBranches).toBe(1);
  });

  it("updatePlan persists maxBranches = -1 (unlimited)", async () => {
    prisma.subscriptionPlan.findUnique.mockResolvedValue({ id: "plan-1" });
    prisma.subscriptionPlan.update.mockResolvedValue({ id: "plan-1" });

    await svc.updatePlan("plan-1", { maxBranches: -1 } as any, "a1", "a@x");

    expect(prisma.subscriptionPlan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ maxBranches: -1 }),
      }),
    );
  });

  it("updatePlan leaves maxBranches untouched (undefined) when omitted", async () => {
    prisma.subscriptionPlan.findUnique.mockResolvedValue({ id: "plan-1" });
    prisma.subscriptionPlan.update.mockResolvedValue({ id: "plan-1" });

    await svc.updatePlan("plan-1", { monthlyPrice: 200 } as any, "a1", "a@x");

    const data = prisma.subscriptionPlan.update.mock.calls[0][0].data;
    expect(data.maxBranches).toBeUndefined();
  });
});

/**
 * Regression (M10): posAccess + externalDisplay + deliveryIntegration are real
 * tier-gating plan columns. externalDisplay/deliveryIntegration were already
 * persisted but had no plan-form toggle; posAccess was missing from the DTO and
 * the create/update writes entirely, so a superadmin building a custom plan
 * could neither grant the two highest-value modules nor disable POS — only a
 * DB edit could. They must round-trip through createPlan/updatePlan.
 */
describe("SuperAdminSubscriptionsService plan feature-flag persistence (M10)", () => {
  let prisma: MockPrismaClient;
  let audit: any;
  let svc: SuperAdminSubscriptionsService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    svc = new SuperAdminSubscriptionsService(
      prisma as any,
      audit,
      {} as any,
      {
        handleSubscriptionPeriodEnd: jest.fn(),
        handleSubscriptionExpiryReminders: jest.fn(),
      } as any,
      {} as any,
    );
  });

  it("createPlan persists externalDisplay, deliveryIntegration and posAccess", async () => {
    prisma.subscriptionPlan.create.mockResolvedValue({ id: "plan-1" });

    await svc.createPlan(
      {
        name: "delivery",
        displayName: "Delivery",
        monthlyPrice: 100,
        yearlyPrice: 1000,
        externalDisplay: true,
        deliveryIntegration: true,
        posAccess: false,
      } as any,
      "a1",
      "a@x",
    );

    expect(prisma.subscriptionPlan.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          externalDisplay: true,
          deliveryIntegration: true,
          posAccess: false,
        }),
      }),
    );
  });

  it("createPlan defaults posAccess to true (schema parity) when omitted", async () => {
    prisma.subscriptionPlan.create.mockResolvedValue({ id: "plan-1" });

    await svc.createPlan(
      { name: "p", displayName: "P", monthlyPrice: 0, yearlyPrice: 0 } as any,
      "a1",
      "a@x",
    );

    const data = prisma.subscriptionPlan.create.mock.calls[0][0].data;
    expect(data.posAccess).toBe(true);
  });

  it("updatePlan persists an explicit posAccess=false and leaves it untouched when omitted", async () => {
    prisma.subscriptionPlan.findUnique.mockResolvedValue({ id: "plan-1" });
    prisma.subscriptionPlan.update.mockResolvedValue({ id: "plan-1" });

    await svc.updatePlan("plan-1", { posAccess: false } as any, "a1", "a@x");
    expect(prisma.subscriptionPlan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ posAccess: false }),
      }),
    );

    prisma.subscriptionPlan.update.mockClear();
    await svc.updatePlan("plan-1", { monthlyPrice: 200 } as any, "a1", "a@x");
    const data = prisma.subscriptionPlan.update.mock.calls[0][0].data;
    expect(data.posAccess).toBeUndefined();
  });
});

/**
 * Regression (M7): the superadmin "Extend" button is rendered for EVERY
 * subscription row regardless of status, but extendSubscription only pushed
 * currentPeriodEnd — it never moved status off EXPIRED/TRIAL_ENDED/PAST_DUE/
 * CANCELLED and never reprojected entitlements. So an operator extending a
 * locked tenant got a success toast while the tenant stayed 403'd (and a
 * PAST_DUE row was pushed out of the dunning-expiry cron window forever).
 * Extend on a non-ACTIVE row must reinstate: status→ACTIVE, clear the
 * terminal/cancellation fields, and emit the SAME reprojection the activation
 * path uses, all in one transaction.
 */
describe("SuperAdminSubscriptionsService.extendSubscription reinstatement", () => {
  let prisma: MockPrismaClient;
  let audit: any;
  let subscriptionService: { emitSubscriptionReprojection: jest.Mock };
  let svc: SuperAdminSubscriptionsService;

  const SUB_ID = "sub-1";
  const TENANT_ID = "tenant-1";
  const PLAN_ID = "plan-1";
  const baseSub: any = {
    id: SUB_ID,
    tenantId: TENANT_ID,
    // The subscription's OWN plan — Extend must restore tenant.currentPlanId to
    // this so the projector grants the real plan (not FREE) on reinstatement.
    planId: PLAN_ID,
    status: "EXPIRED",
    currentPeriodEnd: new Date("2026-01-01T00:00:00.000Z"),
    tenant: { id: TENANT_ID, name: "Test Restoran" },
  };

  beforeEach(() => {
    prisma = mockPrismaClient();
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    subscriptionService = {
      emitSubscriptionReprojection: jest.fn().mockResolvedValue(undefined),
    };
    // The mocked $transaction must invoke the callback with a tx client so the
    // service's tx.subscription.update + emitSubscriptionReprojection(tx) run.
    (prisma.$transaction as unknown as jest.Mock).mockImplementation(
      async (cb: any) => cb(prisma),
    );
    svc = new SuperAdminSubscriptionsService(
      prisma as any,
      audit,
      subscriptionService as any,
      {
        handleSubscriptionPeriodEnd: jest.fn(),
        handleSubscriptionExpiryReminders: jest.fn(),
      } as any,
      {} as any,
    );
  });

  it("EXPIRED row: flips status to ACTIVE, clears terminal fields, and reprojects", async () => {
    prisma.subscription.findUnique.mockResolvedValue({ ...baseSub });
    prisma.subscription.update.mockImplementation(async (args: any) => ({
      ...baseSub,
      ...args.data,
      plan: { id: "plan-1", name: "business", displayName: "Business" },
    }));

    await svc.extendSubscription(SUB_ID, { days: 30 }, "actor-1", "actor@x");

    // Status reinstated + terminal/cancellation fields cleared in the write.
    expect(prisma.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: SUB_ID },
        data: expect.objectContaining({
          status: "ACTIVE",
          endedAt: null,
          cancelAtPeriodEnd: false,
          cancelledAt: null,
          cancellationReason: null,
          currentPeriodEnd: expect.any(Date),
        }),
      }),
    );
    // Tenant plan pointer restored to the subscription's OWN plan IN the same
    // transaction — without this the projector resolves effectivePlan=FREE
    // (cron-expire/period-end-cancel may have cleared tenant.currentPlanId) and
    // the tenant stays silently FREE-locked despite the ACTIVE status (M7).
    expect(prisma.tenant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: TENANT_ID },
        data: { currentPlanId: PLAN_ID },
      }),
    );
    // Reprojection invoked in the same transaction (tx === prisma here).
    expect(
      subscriptionService.emitSubscriptionReprojection,
    ).toHaveBeenCalledTimes(1);
    expect(
      subscriptionService.emitSubscriptionReprojection,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ id: SUB_ID, tenantId: TENANT_ID }),
      prisma,
    );
    // Audit records the reinstatement.
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "EXTEND",
        newData: expect.objectContaining({ status: "ACTIVE", reinstated: true }),
      }),
    );
  });

  it.each(["TRIAL_ENDED", "PAST_DUE", "CANCELLED"])(
    "%s row: also reinstated to ACTIVE with reprojection",
    async (status) => {
      prisma.subscription.findUnique.mockResolvedValue({ ...baseSub, status });
      prisma.subscription.update.mockImplementation(async (args: any) => ({
        ...baseSub,
        ...args.data,
        plan: { id: "plan-1", name: "business", displayName: "Business" },
      }));

      await svc.extendSubscription(SUB_ID, { days: 7 }, "a1", "a@x");

      expect(prisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "ACTIVE" }),
        }),
      );
      expect(
        subscriptionService.emitSubscriptionReprojection,
      ).toHaveBeenCalledTimes(1);
    },
  );

  it("ACTIVE row: only pushes currentPeriodEnd — does NOT touch status or reproject", async () => {
    prisma.subscription.findUnique.mockResolvedValue({
      ...baseSub,
      status: "ACTIVE",
    });
    prisma.subscription.update.mockImplementation(async (args: any) => ({
      ...baseSub,
      status: "ACTIVE",
      ...args.data,
      plan: { id: "plan-1", name: "business", displayName: "Business" },
    }));

    await svc.extendSubscription(SUB_ID, { days: 30 }, "a1", "a@x");

    const data = prisma.subscription.update.mock.calls[0][0].data;
    expect(data.status).toBeUndefined();
    expect(data.endedAt).toBeUndefined();
    expect(data.currentPeriodEnd).toBeInstanceOf(Date);
    // An already-ACTIVE row must NOT touch the tenant's plan pointer — extending
    // a healthy subscription is a pure date push, never a plan reinstatement.
    expect(prisma.tenant.update).not.toHaveBeenCalled();
    expect(
      subscriptionService.emitSubscriptionReprojection,
    ).not.toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        newData: expect.objectContaining({ reinstated: false }),
      }),
    );
  });
});

/**
 * DEMO-plan protection (review F2). DemoGuardService keys the demo tenant's
 * real-money block on currentPlan.name === "DEMO" and fails OPEN, so the plan
 * name itself is a security invariant: renaming/deleting the DEMO plan (or
 * renaming another plan to "DEMO", or assigning the DEMO plan to a real
 * tenant) must be refused at the service layer.
 */
describe("SuperAdminSubscriptionsService DEMO-plan protection (plans)", () => {
  let prisma: MockPrismaClient;
  let audit: any;
  let svc: SuperAdminSubscriptionsService;

  const demoPlan: any = {
    id: "plan-demo",
    name: "DEMO",
    displayName: "Demo",
    isActive: false,
  };

  beforeEach(() => {
    prisma = mockPrismaClient();
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    svc = new SuperAdminSubscriptionsService(
      prisma as any,
      audit,
      {} as any,
      {
        handleSubscriptionPeriodEnd: jest.fn(),
        handleSubscriptionExpiryReminders: jest.fn(),
      } as any,
      {} as any,
    );
  });

  it("updatePlan refuses renaming the DEMO plan (guard would be disarmed)", async () => {
    prisma.subscriptionPlan.findUnique.mockResolvedValue(demoPlan);
    await expect(
      svc.updatePlan("plan-demo", { name: "DEMO2" } as any, "a1", "a@x"),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.subscriptionPlan.update).not.toHaveBeenCalled();
  });

  it("updatePlan still allows editing the DEMO plan's OTHER fields (name omitted)", async () => {
    prisma.subscriptionPlan.findUnique.mockResolvedValue(demoPlan);
    prisma.subscriptionPlan.update.mockResolvedValue({
      ...demoPlan,
      maxUsers: 500,
    });
    await svc.updatePlan("plan-demo", { maxUsers: 500 } as any, "a1", "a@x");
    expect(prisma.subscriptionPlan.update).toHaveBeenCalledTimes(1);
  });

  it("updatePlan allows a no-op resend of the same DEMO name", async () => {
    prisma.subscriptionPlan.findUnique.mockResolvedValue(demoPlan);
    prisma.subscriptionPlan.update.mockResolvedValue(demoPlan);
    await svc.updatePlan("plan-demo", { name: "DEMO" } as any, "a1", "a@x");
    expect(prisma.subscriptionPlan.update).toHaveBeenCalledTimes(1);
  });

  it("updatePlan refuses renaming ANOTHER plan to DEMO (its tenants would be money-blocked)", async () => {
    prisma.subscriptionPlan.findUnique.mockResolvedValue({
      id: "plan-pro",
      name: "PRO",
      isActive: true,
    } as any);
    await expect(
      svc.updatePlan("plan-pro", { name: "DEMO" } as any, "a1", "a@x"),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.subscriptionPlan.update).not.toHaveBeenCalled();
  });

  it("updatePlan still allows a normal rename of a non-DEMO plan", async () => {
    prisma.subscriptionPlan.findUnique.mockResolvedValue({
      id: "plan-pro",
      name: "PRO",
      isActive: true,
    } as any);
    prisma.subscriptionPlan.update.mockResolvedValue({
      id: "plan-pro",
      name: "PRO_2026",
    } as any);
    await svc.updatePlan("plan-pro", { name: "PRO_2026" } as any, "a1", "a@x");
    expect(prisma.subscriptionPlan.update).toHaveBeenCalledTimes(1);
  });

  it("deletePlan refuses deleting the DEMO plan even with zero subscriptions", async () => {
    prisma.subscriptionPlan.findUnique.mockResolvedValue({
      ...demoPlan,
      _count: { subscriptions: 0 },
    });
    await expect(
      svc.deletePlan("plan-demo", "a1", "a@x"),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.subscriptionPlan.delete).not.toHaveBeenCalled();
  });
});

/**
 * Plan currency lock (review F4). Subscription rows carry amounts denominated
 * in the plan's currency; re-denominating a subscribed plan (e.g. legacy
 * USD 49 → TRY 49) would silently re-price every subscriber. The service must
 * refuse a currency CHANGE while subscriptions exist, while still allowing
 * no-op resends and currency fixes on unused plans.
 */
describe("SuperAdminSubscriptionsService plan currency lock (F4)", () => {
  let prisma: MockPrismaClient;
  let audit: any;
  let svc: SuperAdminSubscriptionsService;

  const usdPlan: any = {
    id: "plan-usd",
    name: "LEGACY_USD",
    currency: "USD",
    _count: { subscriptions: 3 },
  };

  beforeEach(() => {
    prisma = mockPrismaClient();
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    svc = new SuperAdminSubscriptionsService(
      prisma as any,
      audit,
      {} as any,
      {
        handleSubscriptionPeriodEnd: jest.fn(),
        handleSubscriptionExpiryReminders: jest.fn(),
      } as any,
      {} as any,
    );
  });

  it("refuses changing the currency of a plan with subscriptions", async () => {
    prisma.subscriptionPlan.findUnique.mockResolvedValue(usdPlan);
    await expect(
      svc.updatePlan("plan-usd", { currency: "TRY" } as any, "a1", "a@x"),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.subscriptionPlan.update).not.toHaveBeenCalled();
  });

  it("allows a no-op resend of the plan's current currency", async () => {
    prisma.subscriptionPlan.findUnique.mockResolvedValue(usdPlan);
    prisma.subscriptionPlan.update.mockResolvedValue(usdPlan);
    await svc.updatePlan(
      "plan-usd",
      { currency: "USD", monthlyPrice: 49 } as any,
      "a1",
      "a@x",
    );
    expect(prisma.subscriptionPlan.update).toHaveBeenCalledTimes(1);
  });

  it("allows a currency change on a plan with zero subscriptions", async () => {
    prisma.subscriptionPlan.findUnique.mockResolvedValue({
      ...usdPlan,
      _count: { subscriptions: 0 },
    });
    prisma.subscriptionPlan.update.mockResolvedValue({
      ...usdPlan,
      currency: "TRY",
    });
    await svc.updatePlan("plan-usd", { currency: "TRY" } as any, "a1", "a@x");
    expect(prisma.subscriptionPlan.update).toHaveBeenCalledTimes(1);
  });

  it("leaves other-field updates on a subscribed plan untouched (currency omitted)", async () => {
    prisma.subscriptionPlan.findUnique.mockResolvedValue(usdPlan);
    prisma.subscriptionPlan.update.mockResolvedValue(usdPlan);
    await svc.updatePlan(
      "plan-usd",
      { monthlyPrice: 59 } as any,
      "a1",
      "a@x",
    );
    expect(prisma.subscriptionPlan.update).toHaveBeenCalledTimes(1);
    const data = prisma.subscriptionPlan.update.mock.calls[0][0].data;
    expect(data.currency).toBeUndefined();
  });
});

/**
 * updateSubscription plan-assignment guards + amount recompute (review F2/F3).
 */
describe("SuperAdminSubscriptionsService.updateSubscription plan assignment", () => {
  let prisma: MockPrismaClient;
  let audit: any;
  let subscriptionService: { emitSubscriptionReprojection: jest.Mock };
  let svc: SuperAdminSubscriptionsService;

  const SUB_ID = "sub-1";
  const TENANT_ID = "tenant-1";
  const existingSub: any = {
    id: SUB_ID,
    tenantId: TENANT_ID,
    planId: "plan-old",
    status: "ACTIVE",
    billingCycle: "MONTHLY",
    amount: new Prisma.Decimal("500"),
    tenant: { id: TENANT_ID, name: "Test Restoran" },
    plan: { name: "PRO" },
  };

  const targetPlan: any = {
    id: "plan-new",
    name: "BUSINESS",
    displayName: "Business",
    isActive: true,
    monthlyPrice: "1799",
    yearlyPrice: "17990",
    maxUsers: -1,
    maxTables: -1,
    maxProducts: -1,
    maxCategories: -1,
  };

  beforeEach(() => {
    prisma = mockPrismaClient();
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    subscriptionService = {
      emitSubscriptionReprojection: jest.fn().mockResolvedValue(undefined),
    };
    prisma.subscription.findUnique.mockResolvedValue({ ...existingSub });
    prisma.user.count.mockResolvedValue(0);
    prisma.table.count.mockResolvedValue(0);
    prisma.product.count.mockResolvedValue(0);
    prisma.category.count.mockResolvedValue(0);
    (prisma.$transaction as unknown as jest.Mock).mockImplementation(
      async (cb: any) => cb(prisma),
    );
    prisma.subscription.update.mockImplementation(async (args: any) => ({
      ...existingSub,
      ...args.data,
      tenant: { id: TENANT_ID, name: "Test Restoran" },
      plan: { id: "plan-new", name: "BUSINESS", displayName: "Business" },
    }));
    svc = new SuperAdminSubscriptionsService(
      prisma as any,
      audit,
      subscriptionService as any,
      {
        handleSubscriptionPeriodEnd: jest.fn(),
        handleSubscriptionExpiryReminders: jest.fn(),
      } as any,
      {} as any,
    );
  });

  it("refuses assigning the DEMO plan to a tenant whose current plan is not DEMO", async () => {
    prisma.subscriptionPlan.findUnique.mockResolvedValue({
      id: "plan-demo",
      name: "DEMO",
      isActive: false,
      monthlyPrice: "0",
      yearlyPrice: "0",
      maxUsers: -1,
      maxTables: -1,
      maxProducts: -1,
      maxCategories: -1,
    } as any);
    await expect(
      svc.updateSubscription(SUB_ID, { planId: "plan-demo" }, "a1", "a@x"),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.subscription.update).not.toHaveBeenCalled();
  });

  it("allows re-assigning DEMO when the subscription is already on the DEMO plan", async () => {
    prisma.subscription.findUnique.mockResolvedValue({
      ...existingSub,
      plan: { name: "DEMO" },
    });
    prisma.subscriptionPlan.findUnique.mockResolvedValue({
      id: "plan-demo",
      name: "DEMO",
      isActive: false,
      monthlyPrice: "0",
      yearlyPrice: "0",
      maxUsers: -1,
      maxTables: -1,
      maxProducts: -1,
      maxCategories: -1,
    } as any);
    await svc.updateSubscription(SUB_ID, { planId: "plan-demo" }, "a1", "a@x");
    expect(prisma.subscription.update).toHaveBeenCalledTimes(1);
  });

  it("refuses assigning an inactive (retired) plan", async () => {
    prisma.subscriptionPlan.findUnique.mockResolvedValue({
      ...targetPlan,
      isActive: false,
    });
    await expect(
      svc.updateSubscription(SUB_ID, { planId: "plan-new" }, "a1", "a@x"),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.subscription.update).not.toHaveBeenCalled();
  });

  it("MONTHLY cycle: plan change recomputes subscription.amount from the new plan's monthly price", async () => {
    prisma.subscriptionPlan.findUnique.mockResolvedValue(targetPlan);
    await svc.updateSubscription(SUB_ID, { planId: "plan-new" }, "a1", "a@x");
    const data = prisma.subscription.update.mock.calls[0][0].data;
    expect(data.planId).toBe("plan-new");
    expect(data.amount).toBeInstanceOf(Prisma.Decimal);
    expect(data.amount.toString()).toBe("1799");
    // planId change still moves tenant.currentPlanId + reprojects atomically.
    expect(prisma.tenant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: TENANT_ID },
        data: { currentPlanId: "plan-new" },
      }),
    );
    expect(
      subscriptionService.emitSubscriptionReprojection,
    ).toHaveBeenCalledTimes(1);
  });

  it("YEARLY cycle: plan change recomputes subscription.amount from the new plan's yearly price", async () => {
    prisma.subscription.findUnique.mockResolvedValue({
      ...existingSub,
      billingCycle: "YEARLY",
    });
    prisma.subscriptionPlan.findUnique.mockResolvedValue(targetPlan);
    await svc.updateSubscription(SUB_ID, { planId: "plan-new" }, "a1", "a@x");
    const data = prisma.subscription.update.mock.calls[0][0].data;
    expect(data.amount.toString()).toBe("17990");
  });

  it("honors a live plan discount when recomputing the amount (same rail as charges)", async () => {
    const now = new Date();
    prisma.subscriptionPlan.findUnique.mockResolvedValue({
      ...targetPlan,
      discountPercentage: 20,
      isDiscountActive: true,
      discountStartDate: new Date(now.getTime() - 86400000),
      discountEndDate: new Date(now.getTime() + 86400000),
    });
    await svc.updateSubscription(SUB_ID, { planId: "plan-new" }, "a1", "a@x");
    const data = prisma.subscription.update.mock.calls[0][0].data;
    expect(data.amount.toString()).toBe("1439.2");
  });

  it("status-only update leaves amount and planId untouched", async () => {
    await svc.updateSubscription(SUB_ID, { status: "CANCELLED" }, "a1", "a@x");
    const data = prisma.subscription.update.mock.calls[0][0].data;
    expect(data.amount).toBeUndefined();
    expect(data.planId).toBeUndefined();
    expect(prisma.tenant.update).not.toHaveBeenCalled();
  });
});
