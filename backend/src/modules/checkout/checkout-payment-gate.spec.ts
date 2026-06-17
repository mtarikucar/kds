import { ForbiddenException } from "@nestjs/common";
import { CheckoutService } from "./checkout.service";

/**
 * deep-review C1 — confirmAndProvision payment gate.
 *
 * The tenant-facing POST /v1/checkout/confirm endpoint is reachable by any
 * tenant ADMIN/MANAGER and forwards a client-supplied paymentRef. Without a
 * server-side payment check a tenant could self-provision hardware/add-ons/
 * plan-upgrades for free with any made-up ref. confirmAndProvision now
 * REQUIRES a settled CheckoutIntent (status 'succeeded' | 'provisioned') for
 * (tenantId, paymentRef) before provisioning anything.
 */
describe("CheckoutService — confirmAndProvision payment gate (C1)", () => {
  let prisma: any;
  let outbox: any;
  let quoteSvc: any;
  let catalog: any;
  let tenantMarketplace: any;
  let svc: CheckoutService;

  beforeEach(() => {
    const tx = {
      hardwareOrder: {
        create: jest.fn(async (args: any) => ({ id: "hw-1", ...args.data })),
      },
      hardwareOrderItem: { create: jest.fn() },
      installationRequest: { create: jest.fn() },
      outboxEvent: { create: jest.fn() },
    };
    prisma = {
      checkoutIntent: { findFirst: jest.fn() },
      hardwareOrder: { findFirst: jest.fn().mockResolvedValue(null) },
      tenantAddOn: { findMany: jest.fn().mockResolvedValue([]) },
      branch: { findFirst: jest.fn() },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    outbox = { append: jest.fn() };
    catalog = { allocate: jest.fn().mockResolvedValue({ serials: [] }) };
    tenantMarketplace = { purchase: jest.fn() };
    quoteSvc = {
      quote: jest.fn().mockResolvedValue({
        lines: [],
        currency: "TRY",
        subtotalCents: 0,
        taxCents: 0,
        shippingCents: 0,
        totalCents: 0,
        warnings: [],
        isPureRecurring: false,
      }),
    };
    svc = new CheckoutService(
      prisma,
      outbox,
      quoteSvc,
      catalog,
      tenantMarketplace,
    );
  });

  it("rejects a forged paymentRef with no CheckoutIntent and provisions nothing", async () => {
    prisma.checkoutIntent.findFirst.mockResolvedValue(null);

    await expect(
      svc.confirmAndProvision("t-1", { items: [] as any }, "forged-ref"),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.hardwareOrder.findFirst).not.toHaveBeenCalled();
  });

  it("rejects a paymentRef whose intent is still pending (unpaid)", async () => {
    prisma.checkoutIntent.findFirst.mockResolvedValue({ status: "pending" });

    await expect(
      svc.confirmAndProvision("t-1", { items: [] as any }, "CK-pending"),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("provisions when the CheckoutIntent is settled (succeeded)", async () => {
    prisma.checkoutIntent.findFirst.mockResolvedValue({
      status: "succeeded",
      cartJson: { items: [] },
    });

    await expect(
      svc.confirmAndProvision("t-1", { items: [] as any }, "CK-ok"),
    ).resolves.toBeDefined();
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  // deep-review C1 verification follow-up — the cart-swap / amount-mismatch
  // hole the status-only gate left open: pay for a cheap cart, then /confirm
  // an expensive one under the SAME settled ref. The server must provision the
  // cart that was actually paid for (intent.cartJson), never the client cart.
  it("provisions intent.cartJson, not a swapped client cart, for a settled ref", async () => {
    const paidCart = {
      items: [{ type: "plan", code: "PRO", billingCycle: "MONTHLY" }],
    };
    prisma.checkoutIntent.findFirst.mockResolvedValue({
      status: "succeeded",
      cartJson: paidCart,
    });

    const swappedCart = {
      items: [{ type: "hardware", sku: "EXPENSIVE", qty: 5 }],
    };
    await svc.confirmAndProvision("t-1", swappedCart as any, "CK-paid");

    // Priced + provisioned the PAID cart, never the attacker's swapped cart.
    expect(quoteSvc.quote).toHaveBeenCalledWith(paidCart);
    expect(quoteSvc.quote).not.toHaveBeenCalledWith(swappedCart);
  });

  it("allows the null-paymentRef internal comp path without an intent lookup", async () => {
    await expect(
      svc.confirmAndProvision("t-1", { items: [] as any }, null),
    ).resolves.toBeDefined();
    expect(prisma.checkoutIntent.findFirst).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
