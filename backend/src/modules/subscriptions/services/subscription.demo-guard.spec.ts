import { ForbiddenException } from "@nestjs/common";
import { SubscriptionService } from "./subscription.service";

/**
 * Task D1 — demo-account payment block. SubscriptionService.changePlan must
 * reject the shared "explore demo" tenant with 403 DEMO_PAYMENT_BLOCKED as
 * its VERY FIRST statement — before isUpgrade/requiresPayment is even
 * computed, so the frontend never navigates to checkout. DemoGuardService is
 * mocked here to keep this spec unit-scoped.
 */
describe("SubscriptionService.changePlan demo-tenant block", () => {
  function makeDeps() {
    const prisma: any = {
      subscription: { findFirst: jest.fn(), findUnique: jest.fn() },
      subscriptionPlan: { findUnique: jest.fn() },
    };
    const billing: any = {};
    const notifications: any = {};
    const outbox: any = { append: jest.fn() };
    const entitlements: any = { getForTenant: jest.fn() };
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
    const svc = new SubscriptionService(
      prisma,
      billing,
      notifications,
      outbox,
      entitlements,
      undefined, // metrics
      undefined, // injectedDowngradeGuard
      demoGuard as any,
    );
    return { svc, prisma, demoGuard };
  }

  it("rejects with 403 DEMO_PAYMENT_BLOCKED before loading the subscription/plan", async () => {
    const { svc, prisma, demoGuard } = makeDeps();

    await expect(
      svc.changePlan("sub-1", "tenant-demo", { newPlanId: "plan-pro" } as any),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ errorCode: "DEMO_PAYMENT_BLOCKED" }),
    });

    expect(demoGuard.assertNotDemo).toHaveBeenCalledWith("tenant-demo");
    // getSubscriptionById never ran — no DB read for the subscription/plan.
    expect(prisma.subscription.findUnique).not.toHaveBeenCalled();
    expect(prisma.subscriptionPlan.findUnique).not.toHaveBeenCalled();
  });

  it("throws ForbiddenException", async () => {
    const { svc } = makeDeps();

    await expect(
      svc.changePlan("sub-1", "tenant-demo", { newPlanId: "plan-pro" } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
