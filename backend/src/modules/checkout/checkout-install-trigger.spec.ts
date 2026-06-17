import { CheckoutService } from "./checkout.service";

/**
 * v2.8.87 — installation trigger now keyed on serviceMeta.serviceType.
 *
 * Pre-v2.8.87:
 *   if (hardwareLines.some(l => l.type === 'service' && l.code.startsWith('onsite_install'))) {
 *     order.installation = 'requested'
 *     installationRequest.create({ notes: 'Auto-created from checkout' })
 *   }
 *
 * Hardcoded prefix check broke as soon as we added catalog services
 * with code patterns like `install-yazarkasa-gib`, `wifi-site-survey`,
 * `install-full-pos` — none of those start with 'onsite_install'.
 *
 * v2.8.87 reads `serviceMeta.serviceType === 'onsite'` from the priced
 * line meta (populated by QuoteService at quote time from the catalog
 * row). Each on-site service line mints its own InstallationRequest so
 * a mixed cart with multiple services in different branches can be
 * scheduled independently. branchId / preferredDates / notes flow
 * through from the cart line meta.
 *
 * Remote services (Yemeksepeti integration, menu migration) don't get
 * an InstallationRequest — they stay as line items on the HardwareOrder
 * for invoicing and are fulfilled async.
 *
 * Legacy code-prefix path stays as a fallback so the 2 hardcoded codes
 * still trigger installation (no serviceMeta on the legacy lines).
 */
describe("CheckoutService — installation trigger (v2.8.87)", () => {
  let prisma: any;
  let outbox: any;
  let quoteSvc: any;
  let catalog: any;
  let tenantMarketplace: any;
  let svc: CheckoutService;

  // Captured tx writes.
  let createdOrder: any;
  let createdInstallations: any[];

  beforeEach(() => {
    createdOrder = null;
    createdInstallations = [];
    const tx = {
      hardwareOrder: {
        create: jest.fn(async (args: any) => {
          createdOrder = { id: "hw-1", ...args.data };
          return createdOrder;
        }),
      },
      hardwareOrderItem: { create: jest.fn() },
      installationRequest: {
        create: jest.fn(async (args: any) => {
          createdInstallations.push(args.data);
          return args.data;
        }),
      },
      outboxEvent: { create: jest.fn() },
    };
    prisma = {
      // C1 payment gate: a supplied paymentRef must resolve to a settled
      // CheckoutIntent before provisioning.
      checkoutIntent: {
        findFirst: jest.fn().mockResolvedValue({ status: "succeeded" }),
      },
      hardwareOrder: { findFirst: jest.fn().mockResolvedValue(null) },
      tenantAddOn: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    outbox = { append: jest.fn() };
    catalog = { allocate: jest.fn().mockResolvedValue({ serials: [] }) };
    tenantMarketplace = { purchase: jest.fn() };
    quoteSvc = { quote: jest.fn() };
    svc = new CheckoutService(
      prisma,
      outbox,
      quoteSvc,
      catalog,
      tenantMarketplace,
    );
  });

  it("mints an InstallationRequest with branchId + preferredDates + notes for each on-site service line", async () => {
    quoteSvc.quote.mockResolvedValue({
      lines: [
        {
          type: "service",
          code: "install-yazarkasa-gib",
          name: "Yazarkasa kurulum",
          qty: 1,
          unitCents: 350000,
          subtotalCents: 350000,
          cadence: "oneTime",
          meta: {
            branchId: "branch-istanbul",
            serviceMeta: {
              serviceType: "onsite",
              durationHours: 4,
              requiresBranch: true,
            },
            preferredDates: ["2026-06-15", "2026-06-18"],
            notes: "Mesai dışı uygun",
          },
        },
        {
          type: "service",
          code: "wifi-site-survey",
          name: "WiFi survey",
          qty: 1,
          unitCents: 150000,
          subtotalCents: 150000,
          cadence: "oneTime",
          meta: {
            branchId: "branch-ankara",
            serviceMeta: {
              serviceType: "onsite",
              durationHours: 2,
              requiresBranch: true,
            },
          },
        },
      ],
      currency: "TRY",
      subtotalCents: 500000,
      taxCents: 100000,
      shippingCents: 0,
      totalCents: 600000,
      warnings: [],
      isPureRecurring: false,
    });

    await svc.confirmAndProvision("t-1", { items: [] as any }, "pay-ref-1");

    expect(createdOrder.installation).toBe("requested");
    expect(createdInstallations).toHaveLength(2);
    const [ist, ank] = createdInstallations;
    expect(ist).toMatchObject({
      tenantId: "t-1",
      hwOrderId: "hw-1",
      branchId: "branch-istanbul",
      status: "requested",
      notes: "Mesai dışı uygun",
    });
    expect(ist.preferredDates).toHaveLength(2);
    expect(ist.preferredDates[0]).toBeInstanceOf(Date);
    expect(ank).toMatchObject({ branchId: "branch-ankara" });
    // No buyer notes given on second line → fallback auto-message includes
    // the code so support can trace which line spawned the request.
    expect(ank.notes).toContain("wifi-site-survey");
  });

  it("does NOT mint InstallationRequest for remote / consultation services", async () => {
    quoteSvc.quote.mockResolvedValue({
      lines: [
        {
          type: "service",
          code: "integration-yemeksepeti",
          name: "Yemeksepeti entegrasyon",
          qty: 1,
          unitCents: 250000,
          subtotalCents: 250000,
          cadence: "oneTime",
          meta: { serviceMeta: { serviceType: "remote" } },
        },
        {
          type: "service",
          code: "multibranch-rollout",
          name: "Multibranch rollout",
          qty: 1,
          unitCents: 500000,
          subtotalCents: 500000,
          cadence: "oneTime",
          meta: { serviceMeta: { serviceType: "consultation" } },
        },
      ],
      currency: "TRY",
      subtotalCents: 750000,
      taxCents: 150000,
      shippingCents: 0,
      totalCents: 900000,
      warnings: [],
      isPureRecurring: false,
    });

    await svc.confirmAndProvision("t-1", { items: [] as any }, "pay-ref-2");

    expect(createdOrder.installation).toBeNull();
    expect(createdInstallations).toHaveLength(0);
  });

  it("legacy onsite_install_* prefix still triggers (no serviceMeta on the legacy line)", async () => {
    quoteSvc.quote.mockResolvedValue({
      lines: [
        {
          type: "service",
          code: "onsite_install_kds",
          name: "On-site KDS install",
          qty: 1,
          unitCents: 250000,
          subtotalCents: 250000,
          cadence: "oneTime",
          meta: {}, // no serviceMeta — legacy hardcoded line
        },
      ],
      currency: "TRY",
      subtotalCents: 250000,
      taxCents: 50000,
      shippingCents: 0,
      totalCents: 300000,
      warnings: [],
      isPureRecurring: false,
    });

    await svc.confirmAndProvision("t-1", { items: [] as any }, "pay-ref-3");

    expect(createdOrder.installation).toBe("requested");
    expect(createdInstallations).toHaveLength(1);
  });

  it("mixed cart (onsite + remote + hardware) creates exactly one InstallationRequest per on-site line", async () => {
    quoteSvc.quote.mockResolvedValue({
      lines: [
        {
          type: "hardware",
          code: "yazarkasa-hugin-tiger-t300",
          name: "Hugin Tiger T300",
          qty: 1,
          unitCents: 640000,
          subtotalCents: 640000,
          cadence: "oneTime",
          meta: { productId: "h-1", acquisition: "sell" },
        },
        {
          type: "service",
          code: "install-yazarkasa-gib",
          name: "Yazarkasa kurulum",
          qty: 1,
          unitCents: 350000,
          subtotalCents: 350000,
          cadence: "oneTime",
          meta: {
            branchId: "branch-1",
            serviceMeta: { serviceType: "onsite" },
            preferredDates: ["2026-06-15"],
          },
        },
        {
          type: "service",
          code: "integration-yemeksepeti",
          name: "Yemeksepeti entegrasyon",
          qty: 1,
          unitCents: 250000,
          subtotalCents: 250000,
          cadence: "oneTime",
          meta: { serviceMeta: { serviceType: "remote" } },
        },
      ],
      currency: "TRY",
      subtotalCents: 1240000,
      taxCents: 248000,
      shippingCents: 5000,
      totalCents: 1493000,
      warnings: [],
      isPureRecurring: false,
    });

    await svc.confirmAndProvision("t-1", { items: [] as any }, "pay-ref-4");

    expect(createdOrder.installation).toBe("requested");
    expect(createdInstallations).toHaveLength(1); // only the onsite line
    expect(createdInstallations[0].branchId).toBe("branch-1");
    expect(createdInstallations[0].preferredDates).toHaveLength(1);
  });
});
