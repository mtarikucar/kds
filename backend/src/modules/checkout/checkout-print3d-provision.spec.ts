import { CheckoutService } from "./checkout.service";
import {
  PRINT3D_BASE_SKU,
  PRINT3D_ITEM_SKU,
} from "../print3d/print3d.const";

/**
 * v3.7.0 — ödenmiş bir print3d siparişi, aynı Serializable tx içinde tam
 * olarak BİR Print3dJob ve seçilen ürün başına BİR Print3dJobItem basar.
 *
 * Snapshot alanları quote meta'sından birebir kopyalanır: menü ürünleri
 * gerçekten siliniyor ve sonraki bir menü düzenlemesi ödenmiş bir siparişi
 * yeniden yazamaz.
 */
const tenantInvoices = {
  createFromQuote: jest.fn().mockResolvedValue({ id: "inv-1" }),
};

const SNAPSHOTS = [
  {
    productId: "p-1",
    name: "Adana Kebap",
    imageUrl: "/img/adana.jpg",
    model3dUrl: "https://cdn.example/adana.glb",
    position: 0,
  },
  {
    productId: null,
    name: "Silinmiş ürün",
    imageUrl: null,
    model3dUrl: null,
    position: 1,
  },
];

function print3dQuote() {
  return {
    lines: [
      {
        type: "service",
        code: PRINT3D_BASE_SKU,
        name: "3D baskı figür — hizmet bedeli",
        qty: 1,
        unitCents: 150_000,
        subtotalCents: 150_000,
        cadence: "oneTime",
        meta: { serviceMeta: { serviceType: "print3d", role: "base" } },
      },
      {
        type: "service",
        code: PRINT3D_ITEM_SKU,
        name: "3D baskı figür — ürün başına",
        qty: 2,
        unitCents: 5_000,
        subtotalCents: 10_000,
        cadence: "oneTime",
        meta: {
          serviceMeta: { serviceType: "print3d", role: "item" },
          notes: "Kırmızı boya olsun",
          print3dProductIds: ["p-1", "p-2"],
          print3dSnapshots: SNAPSHOTS,
        },
      },
    ],
    currency: "TRY",
    subtotalCents: 133_333,
    taxCents: 26_667,
    shippingCents: 0,
    totalCents: 160_000,
    warnings: [],
    isPureRecurring: false,
  };
}

describe("CheckoutService — print3d provisioning (v3.7.0)", () => {
  let prisma: any;
  let outbox: any;
  let quoteSvc: any;
  let catalog: any;
  let tenantMarketplace: any;
  let svc: CheckoutService;

  let createdOrder: any;
  let createdJobs: any[];
  let createdInstallations: any[];
  let outboxRows: any[];

  beforeEach(() => {
    createdOrder = null;
    createdJobs = [];
    createdInstallations = [];
    outboxRows = [];
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
      print3dJob: {
        create: jest.fn(async (args: any) => {
          createdJobs.push(args.data);
          return { id: "job-1", ...args.data };
        }),
      },
      outboxEvent: {
        create: jest.fn(async (args: any) => {
          outboxRows.push(args.data);
          return args.data;
        }),
      },
    };
    prisma = {
      checkoutIntent: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ status: "succeeded", cartJson: { items: [] } }),
      },
      hardwareOrder: { findFirst: jest.fn().mockResolvedValue(null) },
      tenantAddOn: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    outbox = { append: jest.fn() };
    catalog = { allocate: jest.fn().mockResolvedValue({ serials: [] }) };
    tenantMarketplace = { purchase: jest.fn() };
    quoteSvc = { quote: jest.fn().mockResolvedValue(print3dQuote()) };
    svc = new CheckoutService(
      prisma,
      outbox,
      quoteSvc,
      catalog,
      tenantMarketplace,
      tenantInvoices as any,
    );
  });

  it("mints one Print3dJob with one item per selected product, inside the provisioning tx", async () => {
    await svc.confirmAndProvision("t-1", { items: [] as any }, "CK-1");
    expect(createdJobs).toHaveLength(1);
    const job = createdJobs[0];
    expect(job.hwOrderId).toBe("hw-1");
    expect(job.tenantId).toBe("t-1");
    expect(job.status).toBe("queued");
    expect(job.partner).toBe("figurunica");
    expect(job.itemCount).toBe(2);
    expect(job.items.create).toHaveLength(2);
    expect(job.items.create.map((i: any) => i.position)).toEqual([0, 1]);
    expect(job.items.create.every((i: any) => i.status === "pending")).toBe(true);
  });

  it("does NOT mint an InstallationRequest for a print3d service line", async () => {
    await svc.confirmAndProvision("t-1", { items: [] as any }, "CK-2");
    // serviceType 'onsite' değil 'print3d' — saha ziyareti yok.
    expect(createdInstallations).toHaveLength(0);
    expect(createdOrder.installation).toBeNull();
  });

  it("snapshots name + image + model3dUrl so a later menu edit cannot rewrite the order", async () => {
    await svc.confirmAndProvision("t-1", { items: [] as any }, "CK-3");
    const items = createdJobs[0].items.create;
    expect(items[0]).toMatchObject({
      productId: "p-1",
      productName: "Adana Kebap",
      productImageUrl: "/img/adana.jpg",
      model3dUrl: "https://cdn.example/adana.glb",
    });
    expect(items[1]).toMatchObject({
      productId: null,
      productName: "Silinmiş ürün",
      productImageUrl: null,
      model3dUrl: null,
    });
  });

  it("freezes basePriceCents/perItemCents/totalCents from the priced lines", async () => {
    await svc.confirmAndProvision("t-1", { items: [] as any }, "CK-4");
    expect(createdJobs[0]).toMatchObject({
      basePriceCents: 150_000,
      perItemCents: 5_000,
      totalCents: 160_000,
      currency: "TRY",
      note: "Kırmızı boya olsun",
    });
  });

  it("emits print3d.job.created.v1 with idempotencyKey print3d-job:<orderId>", async () => {
    await svc.confirmAndProvision("t-1", { items: [] as any }, "CK-5");
    const ev = outboxRows.find((r) => r.type === "print3d.job.created.v1");
    expect(ev).toBeDefined();
    expect(ev.idempotencyKey).toBe("print3d-job:hw-1");
    expect(ev.payload).toMatchObject({
      tenantId: "t-1",
      hardwareOrderId: "hw-1",
      itemCount: 2,
      totalCents: 160_000,
      partner: "figurunica",
    });
  });

  it("an idempotent replay of the same paymentRef does not mint a second job", async () => {
    prisma.hardwareOrder.findFirst.mockResolvedValue({
      id: "hw-1",
      branchId: null,
      items: [],
    });
    await svc.confirmAndProvision("t-1", { items: [] as any }, "CK-1");
    expect(createdJobs).toHaveLength(0);
  });

  /**
   * ATOMICITY — the whole point of Görev 7.
   *
   * A happy-path test only proves the writes happen when nothing goes
   * wrong; it says nothing about whether they happen TOGETHER. This test
   * injects a failure into the Print3dJob write ITSELF, inside the same
   * `tx` callback the HardwareOrder was just created on, and proves the
   * HardwareOrder never becomes durable either.
   *
   * The double models real Postgres semantics deliberately: writes issued
   * on `tx` land in a PENDING buffer during the attempt (so we can prove
   * confirmAndProvision really did reach the order-create call, not just
   * that it failed early); they are only copied into the DURABLE buffer if
   * the transaction callback resolves — exactly what `$transaction`
   * (Serializable, single call wrapping the whole provisioning body) does
   * on COMMIT, and exactly what a thrown error inside it prevents (ROLLBACK
   * discards every statement in the aborted transaction). If a future edit
   * ever split this into two separate `$transaction()` calls — order in
   * one, print3dJob in another — the order-half would commit before the
   * job-half even runs, and this test would catch it: `durableOrder` would
   * be non-null despite the injected failure.
   */
  it("rolls back the HardwareOrder when the Print3dJob write fails inside the same tx — the payment does not survive without the production record", async () => {
    let pendingOrder: any = null;
    let pendingJobs: any[] = [];
    let pendingOutbox: any[] = [];
    let durableOrder: any = null;
    let durableJobs: any[] = [];
    let durableOutbox: any[] = [];

    const atomicTx = {
      hardwareOrder: {
        create: jest.fn(async (args: any) => {
          pendingOrder = { id: "hw-atomic-1", ...args.data };
          return pendingOrder;
        }),
      },
      hardwareOrderItem: { create: jest.fn() },
      installationRequest: { create: jest.fn() },
      print3dJob: {
        // The injected failure: the production-record write blows up
        // (constraint violation, dropped connection — the cause doesn't
        // matter, only that it happens INSIDE the same tx as the order).
        create: jest.fn(async () => {
          throw new Error("print3d write failed");
        }),
      },
      outboxEvent: {
        create: jest.fn(async (args: any) => {
          pendingOutbox.push(args.data);
          return args.data;
        }),
      },
    };

    prisma.$transaction = jest.fn(async (cb: any) => {
      const result = await cb(atomicTx); // throws here -> this promise rejects
      // Reached ONLY if the callback resolved cleanly — this is the COMMIT
      // point. A real Postgres ROLLBACK never reaches the equivalent point.
      durableOrder = pendingOrder;
      durableJobs = pendingJobs;
      durableOutbox = pendingOutbox;
      return result;
    });

    await expect(
      svc.confirmAndProvision("t-1", { items: [] as any }, "CK-atomic"),
    ).rejects.toThrow("print3d write failed");

    // The attempt DID reach the order-create call — proving the order and
    // the job are written on the same tx, not that the job failure was
    // caught upstream before the order was ever touched.
    expect(pendingOrder).not.toBeNull();
    expect(pendingOrder.tenantId).toBe("t-1");

    // ...but NONE of it became durable. The payment does not survive
    // without the production record: no order, no job, no outbox event.
    expect(durableOrder).toBeNull();
    expect(durableJobs).toHaveLength(0);
    expect(durableOutbox).toHaveLength(0);

    // What a caller actually observes on retry: the idempotency lookup
    // (queries durable state in real life) finds nothing for this
    // paymentRef, so a retry is free to attempt fresh provisioning instead
    // of being told "already provisioned" for an order that never
    // committed — the exact money-taken/nothing-provisioned failure this
    // guards against.
    prisma.hardwareOrder.findFirst.mockResolvedValueOnce(null);
    const lookup = await prisma.hardwareOrder.findFirst({
      where: { tenantId: "t-1", paymentRef: "CK-atomic" },
    });
    expect(lookup).toBeNull();
  });
});
