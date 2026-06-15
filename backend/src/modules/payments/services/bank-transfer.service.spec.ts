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
