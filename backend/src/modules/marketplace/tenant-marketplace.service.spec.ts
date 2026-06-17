import { TenantMarketplaceService } from "./tenant-marketplace.service";
import { AddOnCatalogService } from "./addon-catalog.service";
import {
  mockPrismaClient,
  MockPrismaClient,
} from "../../common/test/prisma-mock.service";

/**
 * Tenant-side marketplace purchase paths. The dependency-check matrix is
 * the security-relevant part — a tenant must not be able to buy something
 * whose entitlements would clash with a missing prerequisite.
 */
describe("TenantMarketplaceService.purchase", () => {
  let prisma: MockPrismaClient;
  let catalog: jest.Mocked<AddOnCatalogService>;
  let outbox: { append: jest.Mock };
  let svc: TenantMarketplaceService;

  const TENANT = "t1";

  beforeEach(() => {
    prisma = mockPrismaClient();
    catalog = { findByCodeOrThrow: jest.fn() } as any;
    outbox = { append: jest.fn().mockResolvedValue("ok") };
    svc = new TenantMarketplaceService(prisma as any, catalog, outbox as any);
    // Iter-68 wrapped the dup-check + create in a Serializable
    // $transaction. The deep-mocked prisma's $transaction doesn't
    // forward the callback by default — wire it through so the inner
    // tx.tenantAddOn.* calls land on the same mock surface the tests
    // already poke. We also default the dup-check findFirst to null so
    // the happy path doesn't have to set it on every test.
    (prisma.$transaction as any).mockImplementation(async (fn: any) =>
      fn(prisma),
    );
    (prisma.tenantAddOn.findFirst as any).mockResolvedValue(null);
  });

  it("rejects purchase of draft or archived add-ons", async () => {
    catalog.findByCodeOrThrow.mockResolvedValueOnce({
      id: "a-1",
      code: "x",
      status: "draft",
      deps: [],
      billing: "recurring",
    } as any);
    await expect(svc.purchase(TENANT, { addOnCode: "x" })).rejects.toThrow(
      /not yet published/,
    );

    catalog.findByCodeOrThrow.mockResolvedValueOnce({
      id: "a-2",
      code: "x",
      status: "archived",
      deps: [],
      billing: "recurring",
    } as any);
    await expect(svc.purchase(TENANT, { addOnCode: "x" })).rejects.toThrow(
      /no longer available/,
    );
  });

  it("rejects when a plan dep is unmet", async () => {
    catalog.findByCodeOrThrow.mockResolvedValue({
      id: "a-3",
      code: "fiscal_hugin",
      status: "published",
      deps: ["plan:PRO"],
      billing: "recurring",
    } as any);
    prisma.tenant.findUnique.mockResolvedValue({
      id: TENANT,
      currentPlan: { name: "BASIC" },
    } as any);
    prisma.tenantAddOn.findMany.mockResolvedValue([]);

    await expect(
      svc.purchase(TENANT, { addOnCode: "fiscal_hugin" }),
    ).rejects.toThrow(/requires.*plan:PRO/i);
  });

  it("rejects when an addon dep is unmet", async () => {
    catalog.findByCodeOrThrow.mockResolvedValue({
      id: "a-4",
      code: "delivery_yemeksepeti",
      status: "published",
      deps: ["delivery_hub"],
      billing: "recurring",
    } as any);
    prisma.tenant.findUnique.mockResolvedValue({
      id: TENANT,
      currentPlan: { name: "PRO" },
    } as any);
    prisma.tenantAddOn.findMany.mockResolvedValue([] as any);

    await expect(
      svc.purchase(TENANT, { addOnCode: "delivery_yemeksepeti" }),
    ).rejects.toThrow(/delivery_hub/);
  });

  it("purchases happily when deps are met and emits AddOnPurchased", async () => {
    catalog.findByCodeOrThrow.mockResolvedValue({
      id: "a-5",
      code: "kds_extra_screen",
      status: "published",
      deps: [],
      billing: "recurring",
    } as any);
    (prisma.tenantAddOn.create as any).mockImplementation(
      async ({ data }: any) => ({ id: "t-a-1", ...data }),
    );

    const out = await svc.purchase(TENANT, {
      addOnCode: "kds_extra_screen",
      quantity: 3,
    });
    expect(out.quantity).toBe(3);
    expect(outbox.append).toHaveBeenCalledWith(
      expect.objectContaining({ type: "addon.purchased.v1" }),
    );
  });

  /**
   * Iter-68 regressions.
   *
   * 1. Default-deny: an addon status the catalog UI doesn't know about
   *    must refuse purchase rather than silently mint a row.
   * 2. Concurrent purchase race: the (tenantId, addOnId, branchId)
   *    duplicate check + create now run inside a Serializable txn.
   *    Postgres's serialization-failure (P2034) surfaces as a 409 the
   *    client can retry — never a double-grant.
   */
  describe("iter-68 hardening", () => {
    it("refuses an addon with an unknown status (default-deny)", async () => {
      catalog.findByCodeOrThrow.mockResolvedValue({
        id: "a-x",
        code: "experimental",
        status: "beta",
        deps: [],
        billing: "recurring",
      } as any);
      await expect(
        svc.purchase(TENANT, { addOnCode: "experimental" }),
      ).rejects.toThrow(/not available for purchase.*beta/i);
      expect((prisma.tenantAddOn.create as any).mock.calls.length).toBe(0);
    });

    it("runs the dup-check + create inside a $transaction (atomicity envelope)", async () => {
      catalog.findByCodeOrThrow.mockResolvedValue({
        id: "a-5",
        code: "kds_extra_screen",
        status: "published",
        deps: [],
        billing: "recurring",
      } as any);
      (prisma.tenantAddOn.create as any).mockResolvedValue({ id: "ta-1" });

      await svc.purchase(TENANT, { addOnCode: "kds_extra_screen" });

      // Single $transaction call wraps the whole critical section.
      expect((prisma.$transaction as any).mock.calls.length).toBe(1);
      // ...and it requests Serializable isolation explicitly — the
      // load-bearing knob, since lower isolations would let the
      // double-grant race through.
      const txCallArgs = (prisma.$transaction as any).mock.calls[0];
      expect(txCallArgs[1]).toEqual(
        expect.objectContaining({ isolationLevel: "Serializable" }),
      );
    });

    it("returns the existing row when paymentRef has already been provisioned (idempotency)", async () => {
      catalog.findByCodeOrThrow.mockResolvedValue({
        id: "a-5",
        code: "kds_extra_screen",
        status: "published",
        deps: [],
        billing: "recurring",
      } as any);
      const existing = {
        id: "ta-existing",
        tenantId: TENANT,
        paymentRef: "pay-1",
      };
      (prisma.tenantAddOn.findFirst as any).mockResolvedValue(existing);

      const out = await svc.purchase(TENANT, {
        addOnCode: "kds_extra_screen",
        paymentRef: "pay-1",
      });
      expect(out).toBe(existing);
      expect((prisma.tenantAddOn.create as any).mock.calls.length).toBe(0);
    });
  });

  /**
   * deep-review C2: a PAID add-on (priceCents > 0) must never be granted
   * without a settled paymentRef. The free tenant-facing /addons/purchase
   * endpoint was removed; this service-layer guard is the defence in depth
   * that protects every caller.
   */
  describe("deep-review C2: payment required for paid add-ons", () => {
    it("refuses a paid add-on with no paymentRef and never writes a row", async () => {
      catalog.findByCodeOrThrow.mockResolvedValue({
        id: "a-paid",
        code: "pos_pro",
        status: "published",
        deps: [],
        billing: "recurring",
        priceCents: 99900,
      } as any);

      await expect(
        svc.purchase(TENANT, { addOnCode: "pos_pro" }),
      ).rejects.toThrow(/requires payment/i);
      expect((prisma.tenantAddOn.create as any).mock.calls.length).toBe(0);
    });

    it("allows a paid add-on when a paymentRef is supplied (checkout/settlement path)", async () => {
      catalog.findByCodeOrThrow.mockResolvedValue({
        id: "a-paid",
        code: "pos_pro",
        status: "published",
        deps: [],
        billing: "recurring",
        priceCents: 99900,
      } as any);
      (prisma.tenantAddOn.create as any).mockImplementation(
        async ({ data }: any) => ({ id: "ta-paid", ...data }),
      );

      const out = await svc.purchase(TENANT, {
        addOnCode: "pos_pro",
        paymentRef: "CK-abc",
      });
      expect(out.id).toBe("ta-paid");
      expect(out.paymentRef).toBe("CK-abc");
    });

    it("allows a free add-on (priceCents 0) without a paymentRef", async () => {
      catalog.findByCodeOrThrow.mockResolvedValue({
        id: "a-free",
        code: "free_trial_pack",
        status: "published",
        deps: [],
        billing: "recurring",
        priceCents: 0,
      } as any);
      (prisma.tenantAddOn.create as any).mockImplementation(
        async ({ data }: any) => ({ id: "ta-free", ...data }),
      );

      const out = await svc.purchase(TENANT, { addOnCode: "free_trial_pack" });
      expect(out.id).toBe("ta-free");
    });
  });
});
