import { ForbiddenException } from "@nestjs/common";
import { PaymentsService } from "./payments.service";
import {
  mockPrismaClient,
  MockPrismaClient,
} from "../../common/test/prisma-mock.service";

/**
 * Task D1 — demo-account payment block. PaymentsService.createIntent (the
 * subscription PayTR intent rail) must reject the shared "explore demo"
 * tenant with 403 DEMO_PAYMENT_BLOCKED BEFORE reserving any payment row or
 * calling PayTR. DemoGuardService is mocked here to keep this spec
 * unit-scoped (the real guard is covered by demo-guard.service.spec.ts).
 */
describe("PaymentsService.createIntent demo-tenant block", () => {
  let prisma: MockPrismaClient;
  let paytr: any;
  let config: any;
  let subscriptions: any;
  let consents: any;
  let referralDirectory: { resolveReferralCode: jest.Mock };
  let demoGuard: { assertNotDemo: jest.Mock };
  let svc: PaymentsService;

  const TENANT_ID = "tenant-demo";
  const USER_ID = "user-1";
  const docIds = ["d1", "d2", "d3"];

  beforeEach(() => {
    prisma = mockPrismaClient();
    paytr = { getIframeToken: jest.fn() };
    config = { get: () => undefined };
    subscriptions = { startTrialFromIntent: jest.fn() };
    consents = { verifyAndRecord: jest.fn() };
    referralDirectory = { resolveReferralCode: jest.fn().mockResolvedValue(null) };
    demoGuard = {
      assertNotDemo: jest.fn().mockRejectedValue(
        new ForbiddenException({
          statusCode: 403,
          error: "Demo Payment Blocked",
          errorCode: "DEMO_PAYMENT_BLOCKED",
          message: "Demo modunda ödeme alınamaz.",
        }),
      ),
    };
    svc = new PaymentsService(
      prisma as any,
      paytr,
      config,
      subscriptions,
      consents,
      referralDirectory as any,
      undefined, // metrics
      undefined, // clock
      undefined, // idGenerator
      demoGuard as any,
    );
  });

  it("rejects with 403 DEMO_PAYMENT_BLOCKED before touching the tenant/plan lookup or PayTR", async () => {
    await expect(
      svc.createIntent(
        TENANT_ID,
        USER_ID,
        { planId: "plan-pro", billingCycle: "MONTHLY", acceptedDocumentIds: docIds } as any,
        "127.0.0.1",
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ errorCode: "DEMO_PAYMENT_BLOCKED" }),
    });

    expect(demoGuard.assertNotDemo).toHaveBeenCalledWith(TENANT_ID);
    expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
    expect(prisma.subscriptionPayment.create).not.toHaveBeenCalled();
    expect(paytr.getIframeToken).not.toHaveBeenCalled();
  });

  it("throws ForbiddenException", async () => {
    await expect(
      svc.createIntent(
        TENANT_ID,
        USER_ID,
        { planId: "plan-pro", billingCycle: "MONTHLY", acceptedDocumentIds: docIds } as any,
        "127.0.0.1",
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
