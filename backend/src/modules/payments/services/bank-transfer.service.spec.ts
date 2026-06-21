import { BadRequestException, NotFoundException } from "@nestjs/common";
import { BankTransferService } from "./bank-transfer.service";
import {
  PaymentProvider,
  PaymentStatus,
  SubscriptionStatus,
  BillingCycle,
} from "../../../common/constants/subscription.enum";
import { EventTypes } from "../../outbox/event-types";

function makeTx() {
  return {
    pendingPlanChange: {
      findUnique: jest.fn().mockResolvedValue(null),
      delete: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn().mockResolvedValue({}),
    },
    subscriptionPayment: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      create: jest.fn().mockResolvedValue({ id: "pay-1" }),
    },
    subscription: {
      update: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({ id: "sub-new" }),
    },
    tenant: { update: jest.fn().mockResolvedValue({}) },
  };
}

function makeDeps(tx = makeTx()) {
  const prisma: any = {
    subscriptionPayment: { findUnique: jest.fn() },
    bankTransferSettings: { findUnique: jest.fn(), create: jest.fn(), upsert: jest.fn() },
    $transaction: jest.fn(async (cb: any) => cb(tx)),
  };
  const billing: any = { createInvoice: jest.fn().mockResolvedValue({}) };
  const consents: any = { verifyAndRecord: jest.fn().mockResolvedValue(undefined) };
  const outbox: any = { append: jest.fn().mockResolvedValue("evt-1") };
  const svc = new BankTransferService(prisma, billing, consents, outbox);
  return { svc, prisma, billing, consents, outbox, tx };
}

const pendingBankPayment = {
  id: "pay-1",
  status: PaymentStatus.PENDING,
  paymentProvider: PaymentProvider.BANK_TRANSFER,
  amount: "1299.00",
  currency: "TRY",
  externalReference: "HVL-ABCD1234",
  subscription: {
    id: "sub-1",
    tenantId: "tenant-1",
    planId: "plan-pro",
    billingCycle: BillingCycle.MONTHLY,
    status: SubscriptionStatus.PENDING,
    plan: { id: "plan-pro", name: "PRO", displayName: "Pro", currency: "TRY" },
    tenant: { id: "tenant-1", name: "Acme" },
  },
};

describe("BankTransferService.confirm", () => {
  it("activates the subscription, claims the payment, invoices, and emits SubscriptionActivated", async () => {
    const { svc, prisma, billing, outbox, tx } = makeDeps();
    prisma.subscriptionPayment.findUnique.mockResolvedValue(pendingBankPayment);

    const res = await svc.confirm("pay-1", "admin@hummytummy.com");

    expect(res).toEqual({ confirmed: true, subscriptionId: "sub-1" });
    // atomic claim PENDING→SUCCEEDED
    expect(tx.subscriptionPayment.updateMany).toHaveBeenCalledWith({
      where: { id: "pay-1", status: PaymentStatus.PENDING },
      data: expect.objectContaining({ status: PaymentStatus.SUCCEEDED, paymentMethod: "bank_transfer" }),
    });
    // subscription activated under the BANK_TRANSFER provider
    expect(tx.subscription.update).toHaveBeenCalledWith({
      where: { id: "sub-1" },
      data: expect.objectContaining({
        status: SubscriptionStatus.ACTIVE,
        planId: "plan-pro",
        paymentProvider: PaymentProvider.BANK_TRANSFER,
      }),
    });
    expect(tx.tenant.update).toHaveBeenCalledWith({
      where: { id: "tenant-1" },
      data: { currentPlanId: "plan-pro" },
    });
    expect(billing.createInvoice).toHaveBeenCalledTimes(1);
    // load-bearing: entitlement reprojection event
    expect(outbox.append).toHaveBeenCalledWith(
      expect.objectContaining({ type: EventTypes.SubscriptionActivated, tenantId: "tenant-1" }),
      expect.anything(),
    );
  });

  it("records the CHARGED (frozen) amount on an upgrade confirm, not a re-derived gross", async () => {
    const tx = makeTx();
    // An upgrade to a pricier plan; the target gross (2999) is higher than what
    // the tenant actually transferred (payment.amount 1299, frozen at intent
    // under a promo). Confirm must persist 1299, not re-derive 2999 — robust
    // even if the promo window closed during the 14-day confirm gap.
    tx.pendingPlanChange.findUnique.mockResolvedValue({
      id: "ppc-1",
      targetPlanId: "plan-business",
      billingCycle: BillingCycle.MONTHLY,
      targetPlan: {
        id: "plan-business",
        name: "BUSINESS",
        displayName: "Business",
        monthlyPrice: "2999.00",
        yearlyPrice: "29990.00",
        currency: "TRY",
      },
    });
    const { svc, prisma } = makeDeps(tx);
    prisma.subscriptionPayment.findUnique.mockResolvedValue(pendingBankPayment); // amount 1299

    await svc.confirm("pay-1", "admin@hummytummy.com");

    const subUpd = tx.subscription.update.mock.calls.find(
      (c: any) => c[0]?.data?.amount !== undefined,
    );
    expect(subUpd).toBeDefined();
    expect(Number(subUpd[0].data.amount)).toBe(1299); // charged, not 2999 gross
  });

  it("is idempotent — a lost atomic claim (count 0) aborts without double-activation", async () => {
    const tx = makeTx();
    tx.subscriptionPayment.updateMany.mockResolvedValue({ count: 0 });
    const { svc, prisma } = makeDeps(tx);
    prisma.subscriptionPayment.findUnique.mockResolvedValue(pendingBankPayment);

    await expect(svc.confirm("pay-1")).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.subscription.update).not.toHaveBeenCalled();
  });

  it("rejects a non-bank-transfer payment", async () => {
    const { svc, prisma } = makeDeps();
    prisma.subscriptionPayment.findUnique.mockResolvedValue({
      ...pendingBankPayment,
      paymentProvider: PaymentProvider.PAYTR,
    });
    await expect(svc.confirm("pay-1")).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects an already-succeeded payment", async () => {
    const { svc, prisma } = makeDeps();
    prisma.subscriptionPayment.findUnique.mockResolvedValue({
      ...pendingBankPayment,
      status: PaymentStatus.SUCCEEDED,
    });
    await expect(svc.confirm("pay-1")).rejects.toBeInstanceOf(BadRequestException);
  });

  it("404s an unknown payment", async () => {
    const { svc, prisma } = makeDeps();
    prisma.subscriptionPayment.findUnique.mockResolvedValue(null);
    await expect(svc.confirm("nope")).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("BankTransferService.reject", () => {
  it("marks the payment FAILED and expires a still-PENDING subscription", async () => {
    const tx = makeTx();
    const { svc, prisma } = makeDeps(tx);
    prisma.subscriptionPayment.findUnique.mockResolvedValue({
      id: "pay-1",
      status: PaymentStatus.PENDING,
      paymentProvider: PaymentProvider.BANK_TRANSFER,
      externalReference: "HVL-ABCD1234",
      subscription: { id: "sub-1", status: SubscriptionStatus.PENDING },
    });

    const res = await svc.reject("pay-1", "no money received", "admin@x.com");

    expect(res).toEqual({ rejected: true });
    expect(tx.subscriptionPayment.updateMany).toHaveBeenCalledWith({
      where: { id: "pay-1", status: PaymentStatus.PENDING },
      data: expect.objectContaining({ status: PaymentStatus.FAILED }),
    });
    expect(tx.subscription.update).toHaveBeenCalledWith({
      where: { id: "sub-1" },
      data: expect.objectContaining({ status: SubscriptionStatus.EXPIRED }),
    });
    expect(tx.pendingPlanChange.deleteMany).toHaveBeenCalled();
  });
});

describe("BankTransferService.updateSettings enable-guard", () => {
  const COMPLETE = {
    id: "default",
    enabled: false,
    bankName: "Ziraat",
    accountHolder: "Hummy Tummy A.S.",
    iban: "TR000000000000000000000000",
    instructions: null,
  };

  it("blocks enabling when stored config is incomplete and no fields supplied", async () => {
    const { svc, prisma } = makeDeps();
    prisma.bankTransferSettings.findUnique.mockResolvedValue({
      id: "default",
      enabled: false,
      bankName: null,
      accountHolder: null,
      iban: null,
      instructions: null,
    });

    await expect(svc.updateSettings({ enabled: true })).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: "INCOMPLETE_BANK_TRANSFER_CONFIG",
      }),
    });
    expect(prisma.bankTransferSettings.upsert).not.toHaveBeenCalled();
  });

  it("lists every missing field in the error", async () => {
    const { svc, prisma } = makeDeps();
    prisma.bankTransferSettings.findUnique.mockResolvedValue({
      ...COMPLETE,
      bankName: null,
      iban: null,
    });

    await expect(
      svc.updateSettings({ enabled: true }),
    ).rejects.toBeInstanceOf(BadRequestException);
    try {
      await svc.updateSettings({ enabled: true });
    } catch (e: any) {
      expect(e.response.message).toContain("bankName");
      expect(e.response.message).toContain("iban");
      expect(e.response.message).not.toContain("accountHolder");
    }
  });

  it("treats whitespace-only / empty-string incoming fields as missing", async () => {
    const { svc, prisma } = makeDeps();
    prisma.bankTransferSettings.findUnique.mockResolvedValue(COMPLETE);

    await expect(
      // explicit blank IBAN overrides the stored value
      svc.updateSettings({ enabled: true, iban: "   " }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: "INCOMPLETE_BANK_TRANSFER_CONFIG",
      }),
    });
  });

  it("enables when stored config is already complete (no fields supplied)", async () => {
    const { svc, prisma } = makeDeps();
    prisma.bankTransferSettings.findUnique.mockResolvedValue(COMPLETE);
    prisma.bankTransferSettings.upsert.mockResolvedValue({
      ...COMPLETE,
      enabled: true,
    });

    await svc.updateSettings({ enabled: true }, "admin@x.com");

    expect(prisma.bankTransferSettings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ enabled: true }),
      }),
    );
  });

  it("enables when incoming fields complete a previously-empty config", async () => {
    const { svc, prisma } = makeDeps();
    prisma.bankTransferSettings.findUnique.mockResolvedValue({
      id: "default",
      enabled: false,
      bankName: null,
      accountHolder: null,
      iban: null,
      instructions: null,
    });
    prisma.bankTransferSettings.upsert.mockResolvedValue({ id: "default", enabled: true });

    await svc.updateSettings({
      enabled: true,
      bankName: "Ziraat",
      accountHolder: "Hummy Tummy A.S.",
      iban: "TR000000000000000000000000",
    });

    expect(prisma.bankTransferSettings.upsert).toHaveBeenCalled();
  });

  it("does not validate when enabled is not being turned on (editing details while disabled)", async () => {
    const { svc, prisma } = makeDeps();
    prisma.bankTransferSettings.upsert.mockResolvedValue({ id: "default" });

    await svc.updateSettings({ bankName: "New Bank" });

    // no enable flag → skip the completeness gate entirely (no settings read)
    expect(prisma.bankTransferSettings.findUnique).not.toHaveBeenCalled();
    expect(prisma.bankTransferSettings.upsert).toHaveBeenCalled();
  });

  it("does not validate when explicitly disabling", async () => {
    const { svc, prisma } = makeDeps();
    prisma.bankTransferSettings.upsert.mockResolvedValue({ id: "default", enabled: false });

    await svc.updateSettings({ enabled: false, iban: null });

    expect(prisma.bankTransferSettings.findUnique).not.toHaveBeenCalled();
    expect(prisma.bankTransferSettings.upsert).toHaveBeenCalled();
  });
});

describe("BankTransferService.createIntent guards", () => {
  it("refuses when bank transfer is disabled / unconfigured", async () => {
    const { svc, prisma } = makeDeps();
    prisma.bankTransferSettings.findUnique.mockResolvedValue({ id: "default", enabled: false, iban: null });
    await expect(
      svc.createIntent({
        tenantId: "t1",
        userId: "u1",
        planId: "p1",
        billingCycle: BillingCycle.MONTHLY,
        acceptedDocumentIds: ["d1", "d2", "d3"],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
