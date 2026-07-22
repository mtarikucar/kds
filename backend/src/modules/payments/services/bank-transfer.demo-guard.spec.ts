import { ForbiddenException } from "@nestjs/common";
import { BankTransferService } from "./bank-transfer.service";
import { BillingCycle } from "../../../common/constants/subscription.enum";

/**
 * Task D1 — demo-account payment block. BankTransferService.createIntent
 * (the havale/EFT subscription rail) must reject the shared "explore demo"
 * tenant with 403 DEMO_PAYMENT_BLOCKED BEFORE reserving any payment row.
 * DemoGuardService is mocked here to keep this spec unit-scoped.
 */
describe("BankTransferService.createIntent demo-tenant block", () => {
  function makeDeps() {
    const tx = {
      pendingPlanChange: { create: jest.fn() },
      subscriptionPayment: { create: jest.fn() },
      subscription: { create: jest.fn() },
    };
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
    const billing: any = { createInvoice: jest.fn() };
    const consents: any = { verifyAndRecord: jest.fn() };
    const outbox: any = { append: jest.fn() };
    const demoGuard = {
      assertNotDemo: jest.fn().mockRejectedValue(
        new ForbiddenException({
          statusCode: 403,
          error: "Demo Payment Blocked",
          errorCode: "DEMO_PAYMENT_BLOCKED",
          message: "Demo modunda ödeme alınamaz.",
        }),
      ),
    };
    const svc = new BankTransferService(
      prisma,
      billing,
      consents,
      outbox,
      demoGuard as any,
    );
    return { svc, prisma, tx, demoGuard };
  }

  it("rejects with 403 DEMO_PAYMENT_BLOCKED before checking havale settings or reserving a payment row", async () => {
    const { svc, prisma, tx, demoGuard } = makeDeps();

    await expect(
      svc.createIntent({
        tenantId: "tenant-demo",
        userId: "u1",
        planId: "plan-pro",
        billingCycle: BillingCycle.MONTHLY,
        acceptedDocumentIds: ["d1", "d2", "d3"],
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ errorCode: "DEMO_PAYMENT_BLOCKED" }),
    });

    expect(demoGuard.assertNotDemo).toHaveBeenCalledWith("tenant-demo");
    expect(prisma.bankTransferSettings.findUnique).not.toHaveBeenCalled();
    expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
    expect(tx.subscriptionPayment.create).not.toHaveBeenCalled();
  });

  it("throws ForbiddenException", async () => {
    const { svc } = makeDeps();

    await expect(
      svc.createIntent({
        tenantId: "tenant-demo",
        userId: "u1",
        planId: "plan-pro",
        billingCycle: BillingCycle.MONTHLY,
        acceptedDocumentIds: ["d1", "d2", "d3"],
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
