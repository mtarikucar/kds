import { ConflictException } from "@nestjs/common";
import { BankTransferService } from "./bank-transfer.service";
import {
  BillingCycle,
  SubscriptionStatus,
} from "../../../common/constants/subscription.enum";

/**
 * Task 2 (aynı-plan tam-fiyat yenileme reddi), havale (bank-transfer) rail.
 * Same defect as payments.service.ts's PayTR rail: `isUpgrade =
 * existingSub.planId !== plan.id`; when false, createIntent still reserves a
 * full-price PENDING SubscriptionPayment. Confirming it resets
 * currentPeriodStart to "now" instead of extending the ACTIVE tenant's
 * period. PAST_DUE stays exempt (the legitimate "Şimdi yenile" flow — the
 * period already lapsed, nothing to burn).
 */
function makeTx() {
  return {
    pendingPlanChange: {
      create: jest.fn().mockResolvedValue({}),
    },
    subscriptionPayment: {
      create: jest.fn().mockResolvedValue({ id: "pay-1" }),
    },
    subscription: {
      create: jest.fn().mockResolvedValue({ id: "sub-new" }),
    },
  };
}

function makeDeps(tx = makeTx()) {
  const prisma: any = {
    tenant: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
    subscriptionPlan: { findUnique: jest.fn() },
    bankTransferSettings: {
      findUnique: jest.fn().mockResolvedValue({
        id: "default",
        enabled: true,
        bankName: "Ziraat",
        accountHolder: "Hummy Tummy A.S.",
        iban: "TR000000000000000000000000",
        instructions: null,
      }),
    },
    $transaction: jest.fn(async (cb: any) => cb(tx)),
  };
  const billing: any = { createInvoice: jest.fn().mockResolvedValue({}) };
  const consents: any = { verifyAndRecord: jest.fn().mockResolvedValue(undefined) };
  const outbox: any = { append: jest.fn().mockResolvedValue("evt-1") };
  const svc = new BankTransferService(prisma, billing, consents, outbox);
  return { svc, prisma, billing, consents, outbox, tx };
}

const PLAN_ID = "plan-pro";
const proPlan = {
  id: PLAN_ID,
  name: "PRO",
  displayName: "Profesyonel",
  monthlyPrice: "1299",
  yearlyPrice: "12990",
  currency: "TRY",
  isActive: true,
};
const businessPlan = {
  id: "plan-business",
  name: "BUSINESS",
  displayName: "İşletme",
  monthlyPrice: "2999",
  yearlyPrice: "29990",
  currency: "TRY",
  isActive: true,
};
const docIds = ["d1", "d2", "d3"];

function arrange(prisma: any, existingSub: any, plan: any = proPlan) {
  prisma.tenant.findUnique.mockResolvedValue({
    id: "tenant-1",
    subscriptions: existingSub ? [existingSub] : [],
  });
  prisma.user.findUnique.mockResolvedValue({
    email: "a@b.com",
    emailVerified: true,
  });
  prisma.subscriptionPlan.findUnique.mockResolvedValue(plan);
}

describe("BankTransferService.createIntent same-plan-active guard", () => {
  it("rejects ACTIVE + same-plan renewal with SAME_PLAN_ACTIVE, no payment row created", async () => {
    const { svc, prisma, tx } = makeDeps();
    arrange(prisma, {
      id: "sub-1",
      planId: PLAN_ID,
      status: SubscriptionStatus.ACTIVE,
      plan: proPlan,
    });

    await expect(
      svc.createIntent({
        tenantId: "tenant-1",
        userId: "u1",
        planId: PLAN_ID,
        billingCycle: BillingCycle.MONTHLY,
        acceptedDocumentIds: docIds,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: "SAME_PLAN_ACTIVE" }),
    });

    expect(tx.subscriptionPayment.create).not.toHaveBeenCalled();
  });

  it("rejects with ConflictException", async () => {
    const { svc, prisma } = makeDeps();
    arrange(prisma, {
      id: "sub-1",
      planId: PLAN_ID,
      status: SubscriptionStatus.ACTIVE,
      plan: proPlan,
    });

    await expect(
      svc.createIntent({
        tenantId: "tenant-1",
        userId: "u1",
        planId: PLAN_ID,
        billingCycle: BillingCycle.MONTHLY,
        acceptedDocumentIds: docIds,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('allows PAST_DUE + same-plan renewal (legitimate "Şimdi yenile" flow)', async () => {
    const { svc, prisma, tx } = makeDeps();
    arrange(prisma, {
      id: "sub-1",
      planId: PLAN_ID,
      status: SubscriptionStatus.PAST_DUE,
      plan: proPlan,
    });

    const result = await svc.createIntent({
      tenantId: "tenant-1",
      userId: "u1",
      planId: PLAN_ID,
      billingCycle: BillingCycle.MONTHLY,
      acceptedDocumentIds: docIds,
    });

    expect(result.provider).toBe("BANK_TRANSFER");
    expect(tx.subscriptionPayment.create).toHaveBeenCalled();
  });

  it("leaves upgrade (different plan) unaffected while ACTIVE", async () => {
    const { svc, prisma, tx } = makeDeps();
    arrange(
      prisma,
      {
        id: "sub-1",
        planId: PLAN_ID,
        status: SubscriptionStatus.ACTIVE,
        plan: proPlan,
      },
      businessPlan,
    );

    const result = await svc.createIntent({
      tenantId: "tenant-1",
      userId: "u1",
      planId: businessPlan.id,
      billingCycle: BillingCycle.MONTHLY,
      acceptedDocumentIds: docIds,
    });

    expect(result.provider).toBe("BANK_TRANSFER");
    expect(tx.subscriptionPayment.create).toHaveBeenCalled();
    expect(tx.pendingPlanChange.create).toHaveBeenCalled();
  });

  it("leaves first-time subscribe (no existing subscription) unaffected", async () => {
    const { svc, prisma, tx } = makeDeps();
    arrange(prisma, null);

    const result = await svc.createIntent({
      tenantId: "tenant-1",
      userId: "u1",
      planId: PLAN_ID,
      billingCycle: BillingCycle.MONTHLY,
      acceptedDocumentIds: docIds,
    });

    expect(result.provider).toBe("BANK_TRANSFER");
    expect(tx.subscriptionPayment.create).toHaveBeenCalled();
  });
});
