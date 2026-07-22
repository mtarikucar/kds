import { ForbiddenException } from "@nestjs/common";
import { CheckoutService } from "./checkout.service";

/**
 * Task D1 — demo-account payment block. CheckoutService.confirmAndProvision
 * is the defense-in-depth check on confirm — it must reject the shared
 * "explore demo" tenant with 403 DEMO_PAYMENT_BLOCKED as its VERY FIRST
 * statement, before even the paymentRef/allowComp trust-boundary check, so
 * nothing (hardware order, add-on grant, comp) is ever provisioned for the
 * demo tenant. DemoGuardService is mocked here to keep this spec
 * unit-scoped.
 */
describe("CheckoutService.confirmAndProvision demo-tenant block", () => {
  const TENANT = "tenant-demo";

  let prisma: any;
  let quoteSvc: any;
  let catalog: any;
  let tenantMarketplace: any;
  let outbox: any;
  let demoGuard: { assertNotDemo: jest.Mock };
  let svc: CheckoutService;

  beforeEach(() => {
    prisma = {
      checkoutIntent: { findFirst: jest.fn() },
      hardwareOrder: { findFirst: jest.fn() },
      tenantAddOn: { findMany: jest.fn() },
      branch: { findFirst: jest.fn() },
      $transaction: jest.fn(),
    };
    quoteSvc = { quote: jest.fn() };
    catalog = { allocate: jest.fn() };
    tenantMarketplace = { purchase: jest.fn() };
    outbox = { append: jest.fn() };
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
    svc = new CheckoutService(
      prisma,
      outbox,
      quoteSvc,
      catalog,
      tenantMarketplace,
      undefined, // metrics
      undefined, // devices
      demoGuard as any,
    );
  });

  it("rejects a real (paid) confirm with 403 DEMO_PAYMENT_BLOCKED before the settled-intent lookup", async () => {
    await expect(
      svc.confirmAndProvision(TENANT, {} as any, "CK-1"),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ errorCode: "DEMO_PAYMENT_BLOCKED" }),
    });

    expect(demoGuard.assertNotDemo).toHaveBeenCalledWith(TENANT);
    expect(prisma.checkoutIntent.findFirst).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tenantMarketplace.purchase).not.toHaveBeenCalled();
    expect(catalog.allocate).not.toHaveBeenCalled();
  });

  it("also rejects the internal admin-comp path (allowComp) for the demo tenant", async () => {
    await expect(
      svc.confirmAndProvision(TENANT, {} as any, null, { allowComp: true }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ errorCode: "DEMO_PAYMENT_BLOCKED" }),
    });

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("throws ForbiddenException", async () => {
    await expect(
      svc.confirmAndProvision(TENANT, {} as any, "CK-1"),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
