import { SalesInvoiceService } from "./sales-invoice.service";
import { TaxCalculationService } from "./tax-calculation.service";
import {
  mockPrismaClient,
  MockPrismaClient,
} from "../../../common/test/prisma-mock.service";

/**
 * Iter-33 regression: findAll must clamp page/limit even if a caller
 * bypasses the DTO. The DTO already caps via @Max(200), but an
 * internal worker/RPC that constructs the query object directly would
 * be unguarded without the service-side Math.min.
 */
describe("SalesInvoiceService.findAll (iter-33)", () => {
  let prisma: MockPrismaClient;
  let svc: SalesInvoiceService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    const settings: any = { findByTenant: jest.fn() };
    const tax: any = { extractTax: jest.fn() };
    svc = new SalesInvoiceService(prisma as any, settings, tax);
    (prisma.salesInvoice.findMany as any).mockResolvedValue([]);
    (prisma.salesInvoice.count as any).mockResolvedValue(0);
  });

  it("caps limit at 200 even when caller passes a million", async () => {
    await svc.findAll("t1", { limit: 1_000_000 } as any);

    const findArgs = (prisma.salesInvoice.findMany as any).mock.calls[0][0];
    // Load-bearing: the take=200 ceiling protects against an unbounded
    // pull of nested-include invoice + items rows.
    expect(findArgs.take).toBe(200);
  });

  it("clamps page to 1 when caller passes 0 or negative", async () => {
    await svc.findAll("t1", { page: 0, limit: 20 } as any);
    const args1 = (prisma.salesInvoice.findMany as any).mock.calls[0][0];
    expect(args1.skip).toBe(0); // (1-1)*20

    await svc.findAll("t1", { page: -5, limit: 20 } as any);
    const args2 = (prisma.salesInvoice.findMany as any).mock.calls[1][0];
    expect(args2.skip).toBe(0);
  });

  it("falls back to limit=20 when caller passes a non-numeric value", async () => {
    await svc.findAll("t1", { limit: "abc" as any } as any);
    const args = (prisma.salesInvoice.findMany as any).mock.calls[0][0];
    expect(args.take).toBe(20);
  });

  // syncStatus filter — the derived tri-state must map onto the same
  // syncedAt/syncError predicates the list badges are computed from.
  it("maps syncStatus=SYNCED to syncedAt NOT NULL", async () => {
    await svc.findAll("t1", { syncStatus: "SYNCED" } as any);
    const args = (prisma.salesInvoice.findMany as any).mock.calls[0][0];
    expect(args.where.syncedAt).toEqual({ not: null });
    expect(args.where.syncError).toBeUndefined();
  });

  it("maps syncStatus=FAILED to syncedAt NULL + syncError NOT NULL", async () => {
    await svc.findAll("t1", { syncStatus: "FAILED" } as any);
    const args = (prisma.salesInvoice.findMany as any).mock.calls[0][0];
    expect(args.where.syncedAt).toBeNull();
    expect(args.where.syncError).toEqual({ not: null });
  });

  it("maps syncStatus=PENDING to syncedAt NULL + syncError NULL", async () => {
    await svc.findAll("t1", { syncStatus: "PENDING" } as any);
    const args = (prisma.salesInvoice.findMany as any).mock.calls[0][0];
    expect(args.where.syncedAt).toBeNull();
    expect(args.where.syncError).toBeNull();
  });

  it("ignores syncStatus when absent (no sync predicates added)", async () => {
    await svc.findAll("t1", {} as any);
    const args = (prisma.salesInvoice.findMany as any).mock.calls[0][0];
    expect(args.where.syncedAt).toBeUndefined();
    expect(args.where.syncError).toBeUndefined();
  });
});

/**
 * deep-review M11 regression: for a discounted order the persisted
 * invoice must be internally consistent — sum(item.total) == header
 * totalAmount (== order.finalAmount) and sum(item.taxAmount) == header
 * taxAmount — otherwise e-fatura providers that validate sum(lines)==total
 * reject the document. Pre-fix the lines summed to the GROSS while the
 * header total was the NET.
 */
describe("SalesInvoiceService.createFromOrder discount consistency (deep-review M11)", () => {
  let prisma: MockPrismaClient;
  let svc: SalesInvoiceService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    const settings: any = {
      findByTenant: jest.fn().mockResolvedValue({
        defaultPaymentTermDays: 0,
        autoSync: false,
        provider: "NONE",
      }),
      getNextInvoiceNumber: jest.fn().mockResolvedValue("INV-001"),
    };
    // Use the real tax math — it is pure and is the unit under test here.
    svc = new SalesInvoiceService(
      prisma as any,
      settings,
      new TaxCalculationService(),
    );

    // $transaction(cb) runs the callback against a tx that mirrors the
    // client mock; salesInvoice.create echoes back the data it was given so
    // the test can assert on the persisted line items.
    (prisma.$transaction as any).mockImplementation(async (cb: any) => {
      const tx: any = {
        salesInvoice: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockImplementation(async ({ data }: any) => ({
            id: "inv-1",
            ...data,
            items: data.items.create,
          })),
        },
      };
      return cb(tx);
    });
  });

  it("apportions the order discount so lines sum to finalAmount and taxAmount reconciles", async () => {
    // Gross 100 (two 10% KDV lines of 60 + 40), 10 TRY order discount,
    // finalAmount 90. Net lines: 60 - 6 = 54 and 40 - 4 = 36 -> sum 90.
    (prisma.order.findFirst as any).mockResolvedValue({
      id: "order-1",
      tenantId: "t1",
      customerName: "Acme",
      customerPhone: null,
      totalAmount: 100,
      discount: 10,
      finalAmount: 90,
      payments: [{ method: "CASH" }],
      salesInvoices: [],
      orderItems: [
        {
          id: "oi-1",
          quantity: 2,
          subtotal: 60,
          taxRate: 10,
          product: { name: "A" },
        },
        {
          id: "oi-2",
          quantity: 1,
          subtotal: 40,
          taxRate: 10,
          product: { name: "B" },
        },
      ],
    });

    const invoice: any = await svc.createFromOrder("order-1", "t1");

    const lineTotalSum = invoice.items.reduce(
      (s: number, i: any) => s + i.total,
      0,
    );
    const lineTaxSum = invoice.items.reduce(
      (s: number, i: any) => s + i.taxAmount,
      0,
    );

    // Load-bearing: line totals must reconcile to the discounted header total.
    expect(Math.round(lineTotalSum * 100) / 100).toBe(invoice.totalAmount);
    expect(invoice.totalAmount).toBe(90);
    // KDV breakdown must come from the adjusted (net) lines.
    expect(Math.round(lineTaxSum * 100) / 100).toBe(invoice.taxAmount);
    expect(invoice.discount).toBe(10);
  });
});

/**
 * CONCERN B-fiscal: for DELIVERY orders the header finalAmount carries a
 * delivery fee (and possibly the value of items the platform didn't map),
 * so Σ(line.total) is BELOW the header total. An e-Arşiv/e-fatura document
 * whose lines don't sum to its header total is rejected. When the computed
 * line sum is short, append one reconciling "Teslimat / Diğer" line for the
 * difference so Σ(lines) == header total. Dine-in/takeaway (lines already
 * reconcile) must be left untouched — no extra line.
 */
describe("SalesInvoiceService.createFromOrder delivery reconciliation (CONCERN B-fiscal)", () => {
  let prisma: MockPrismaClient;
  let svc: SalesInvoiceService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    const settings: any = {
      findByTenant: jest.fn().mockResolvedValue({
        defaultPaymentTermDays: 0,
        autoSync: false,
        provider: "NONE",
      }),
      getNextInvoiceNumber: jest.fn().mockResolvedValue("INV-002"),
    };
    svc = new SalesInvoiceService(
      prisma as any,
      settings,
      new TaxCalculationService(),
    );

    (prisma.$transaction as any).mockImplementation(async (cb: any) => {
      const tx: any = {
        salesInvoice: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockImplementation(async ({ data }: any) => ({
            id: "inv-2",
            ...data,
            items: data.items.create,
          })),
        },
      };
      return cb(tx);
    });
  });

  it("appends a reconciling line when the line sum is below the header total (delivery fee)", async () => {
    // One mapped 10% KDV item of 80. Header finalAmount 100 carries a 20 TRY
    // delivery fee that has no matching order item. Lines sum to 80 < 100,
    // so a reconciling line for 20 must be appended.
    (prisma.order.findFirst as any).mockResolvedValue({
      id: "order-d",
      tenantId: "t1",
      customerName: "Delivery Co",
      customerPhone: null,
      totalAmount: 80,
      discount: 0,
      finalAmount: 100,
      payments: [{ method: "DIGITAL" }],
      salesInvoices: [],
      orderItems: [
        {
          id: "oi-1",
          quantity: 1,
          subtotal: 80,
          taxRate: 10,
          product: { name: "Burger" },
        },
      ],
    });

    const invoice: any = await svc.createFromOrder("order-d", "t1");

    const lineTotalSum = invoice.items.reduce(
      (s: number, i: any) => s + i.total,
      0,
    );

    // One real line + one reconciling line.
    expect(invoice.items).toHaveLength(2);
    // Lines must now reconcile to the header total.
    expect(Math.round(lineTotalSum * 100) / 100).toBe(invoice.totalAmount);
    expect(invoice.totalAmount).toBe(100);

    const reconciling = invoice.items[invoice.items.length - 1];
    expect(reconciling.description).toBe("Teslimat / Diğer");
    expect(reconciling.total).toBe(20);
  });

  it("does NOT append a reconciling line when lines already reconcile (dine-in/takeaway)", async () => {
    // Lines sum to 100 and finalAmount is 100 — nothing to reconcile.
    (prisma.order.findFirst as any).mockResolvedValue({
      id: "order-n",
      tenantId: "t1",
      customerName: "Walk-in",
      customerPhone: null,
      totalAmount: 100,
      discount: 0,
      finalAmount: 100,
      payments: [{ method: "CASH" }],
      salesInvoices: [],
      orderItems: [
        {
          id: "oi-1",
          quantity: 1,
          subtotal: 100,
          taxRate: 10,
          product: { name: "Pizza" },
        },
      ],
    });

    const invoice: any = await svc.createFromOrder("order-n", "t1");

    expect(invoice.items).toHaveLength(1);
    const lineTotalSum = invoice.items.reduce(
      (s: number, i: any) => s + i.total,
      0,
    );
    expect(Math.round(lineTotalSum * 100) / 100).toBe(invoice.totalAmount);
  });
});

/**
 * fake-working sweep #3: the issuer/seller identity from AccountingSettings
 * "Company Info" must be snapshotted onto each generated SalesInvoice. Pre-fix
 * those six fields were collected + persisted but appeared on nothing the
 * system issued. We assert createFromOrder / createFromPayment copy
 * company* -> seller* on the created row, and that an empty Company Info
 * leaves the columns null (no behaviour change for unconfigured tenants).
 */
describe("SalesInvoiceService seller-identity snapshot (fake-working sweep #3)", () => {
  let prisma: MockPrismaClient;
  let svc: SalesInvoiceService;

  const companyInfo = {
    companyName: "Lezzet Lokantası A.Ş.",
    companyTaxId: "1234567890",
    companyTaxOffice: "Kadıköy",
    companyAddress: "Bağdat Cad. No:1, İstanbul",
    companyPhone: "+902161234567",
    companyEmail: "fatura@lezzet.example",
  };

  function buildSvc(settingsOverride: Record<string, any>) {
    const settings: any = {
      findByTenant: jest.fn().mockResolvedValue({
        defaultPaymentTermDays: 0,
        autoSync: false,
        provider: "NONE",
        ...settingsOverride,
      }),
      getNextInvoiceNumber: jest.fn().mockResolvedValue("INV-S"),
    };
    return new SalesInvoiceService(
      prisma as any,
      settings,
      new TaxCalculationService(),
    );
  }

  beforeEach(() => {
    prisma = mockPrismaClient();
    (prisma.$transaction as any).mockImplementation(async (cb: any) => {
      // createFromPayment passes no options; createFromOrder passes the
      // serializable-isolation options object as the 2nd arg. Support both.
      const tx: any = {
        salesInvoice: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockImplementation(async ({ data }: any) => ({
            id: "inv-s",
            ...data,
            items: data.items.create,
          })),
        },
      };
      return cb(tx);
    });
  });

  it("createFromOrder snapshots company* -> seller* onto the invoice", async () => {
    svc = buildSvc(companyInfo);
    (prisma.order.findFirst as any).mockResolvedValue({
      id: "order-s",
      tenantId: "t1",
      customerName: "Müşteri",
      customerPhone: null,
      totalAmount: 100,
      discount: 0,
      finalAmount: 100,
      payments: [{ method: "CASH" }],
      salesInvoices: [],
      orderItems: [
        { id: "oi-1", quantity: 1, subtotal: 100, taxRate: 10, product: { name: "X" } },
      ],
    });

    const invoice: any = await svc.createFromOrder("order-s", "t1");

    expect(invoice.sellerName).toBe("Lezzet Lokantası A.Ş.");
    expect(invoice.sellerTaxId).toBe("1234567890");
    expect(invoice.sellerTaxOffice).toBe("Kadıköy");
    expect(invoice.sellerAddress).toBe("Bağdat Cad. No:1, İstanbul");
    expect(invoice.sellerPhone).toBe("+902161234567");
    expect(invoice.sellerEmail).toBe("fatura@lezzet.example");
  });

  it("leaves seller* null when Company Info is unset (no behaviour change)", async () => {
    svc = buildSvc({}); // no company* fields
    (prisma.order.findFirst as any).mockResolvedValue({
      id: "order-e",
      tenantId: "t1",
      customerName: "Müşteri",
      customerPhone: null,
      totalAmount: 100,
      discount: 0,
      finalAmount: 100,
      payments: [{ method: "CASH" }],
      salesInvoices: [],
      orderItems: [
        { id: "oi-1", quantity: 1, subtotal: 100, taxRate: 10, product: { name: "X" } },
      ],
    });

    const invoice: any = await svc.createFromOrder("order-e", "t1");

    expect(invoice.sellerName).toBeNull();
    expect(invoice.sellerTaxId).toBeNull();
    expect(invoice.sellerTaxOffice).toBeNull();
  });

  it("createFromPayment snapshots company* -> seller* onto the per-payment invoice", async () => {
    svc = buildSvc(companyInfo);
    (prisma.payment.findFirst as any).mockResolvedValue({
      id: "pay-s",
      tenantId: "t1",
      amount: 50,
      method: "CARD",
      orderId: "order-s",
      order: { customerName: "Müşteri", customerPhone: null },
      salesInvoices: [],
      orderItemPayments: [
        {
          quantity: 1,
          amount: 50,
          orderItem: { quantity: 1, taxRate: 10, product: { name: "Y" } },
        },
      ],
    });

    const invoice: any = await svc.createFromPayment("pay-s", "t1");

    expect(invoice.sellerName).toBe("Lezzet Lokantası A.Ş.");
    expect(invoice.sellerTaxId).toBe("1234567890");
  });
});

describe('SalesInvoiceService.createCreditNote', () => {
  let prisma: any;
  let svc: SalesInvoiceService;

  const original = {
    id: 'inv-1', type: 'SALES', customerName: 'Ali', customerPhone: null, customerEmail: null,
    customerTaxId: null, customerTaxOffice: null, sellerName: 'Shop', sellerTaxId: null,
    sellerTaxOffice: null, sellerAddress: null, sellerPhone: null, sellerEmail: null,
    subtotal: 100, taxAmount: 20, totalAmount: 120, discount: 0, currency: 'TRY',
    taxBreakdown: null, paymentMethod: 'CASH',
    items: [{ description: 'Kola', quantity: 2, unitPrice: 50, taxRate: 20, taxAmount: 20, subtotal: 100, total: 120 }],
  };

  beforeEach(() => {
    const settings: any = { getNextInvoiceNumber: jest.fn().mockResolvedValue('INV-CN-1') };
    prisma = { $transaction: jest.fn() };
    svc = new SalesInvoiceService(prisma, settings, new TaxCalculationService());
  });

  it('creates a REFUND mirroring the original, linked via originalInvoiceId', async () => {
    const tx: any = {
      salesInvoice: {
        findFirst: jest.fn().mockResolvedValueOnce(original).mockResolvedValueOnce(null),
        create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'cn-1', ...data, items: data.items.create })),
      },
    };
    prisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

    const cn = await svc.createCreditNote('inv-1', 't1');
    expect(cn.type).toBe('REFUND');
    expect(cn.originalInvoiceId).toBe('inv-1');
    expect(Number(cn.totalAmount)).toBe(120);
    expect(cn.items).toHaveLength(1);
  });

  it('refuses to credit a credit note', async () => {
    const tx: any = { salesInvoice: { findFirst: jest.fn().mockResolvedValue({ ...original, type: 'REFUND' }) } };
    prisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
    await expect(svc.createCreditNote('inv-1', 't1')).rejects.toThrow();
  });

  it('refuses a second credit note for the same invoice', async () => {
    const tx: any = { salesInvoice: { findFirst: jest.fn().mockResolvedValueOnce(original).mockResolvedValueOnce({ id: 'existing' }) } };
    prisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
    await expect(svc.createCreditNote('inv-1', 't1')).rejects.toThrow();
  });
});

/**
 * A2 (analytics/accounting completion): createRefundCreditNote must reverse
 * EVERY un-reversed invoice on the order (split-bill orders carry one invoice
 * per Payment), with idempotency keyed PER ORIGINAL via originalInvoiceId —
 * the old order-level key reversed only the newest invoice and then blocked
 * the rest. Legacy orders that already carry a pre-semantics REFUND
 * (originalInvoiceId null) keep the old contract to avoid double-reversal.
 */
describe("SalesInvoiceService.createRefundCreditNote (multi-invoice)", () => {
  let prisma: MockPrismaClient;
  let svc: SalesInvoiceService;

  const mkOriginal = (id: string) => ({
    id,
    type: "SALES",
    status: "ISSUED",
    orderId: "o1",
    invoiceNumber: `INV-${id}`,
    customerName: null,
    customerPhone: null,
    customerEmail: null,
    customerTaxId: null,
    customerTaxOffice: null,
    subtotal: 100,
    taxAmount: 10,
    totalAmount: 110,
    discount: 0,
    taxBreakdown: null,
    paymentMethod: "CASH",
    items: [
      {
        description: "Kola",
        quantity: 1,
        unitPrice: 100,
        taxRate: 10,
        taxAmount: 10,
        subtotal: 100,
        total: 110,
      },
    ],
  });

  beforeEach(() => {
    prisma = mockPrismaClient();
    const settings: any = {
      findByTenant: jest
        .fn()
        .mockResolvedValue({ autoSync: false, provider: "NONE" }),
      getNextInvoiceNumber: jest
        .fn()
        .mockResolvedValueOnce("CN-1")
        .mockResolvedValueOnce("CN-2"),
    };
    svc = new SalesInvoiceService(
      prisma as any,
      settings,
      new TaxCalculationService(),
    );
    (prisma.$transaction as any).mockImplementation(async (cb: any) =>
      cb(prisma),
    );
    (prisma.salesInvoice.create as any).mockImplementation(
      async ({ data }: any) => ({
        id: `cn-for-${data.originalInvoiceId}`,
        ...data,
        items: data.items.create,
      }),
    );
  });

  it("reverses EVERY un-reversed invoice of a split-bill order, linking each via originalInvoiceId", async () => {
    // findFirst sequence: legacy-guard → per-original existing checks.
    (prisma.salesInvoice.findFirst as any)
      .mockResolvedValueOnce(null) // no legacy refund
      .mockResolvedValueOnce(null) // i1 not yet reversed
      .mockResolvedValueOnce(null); // i2 not yet reversed
    (prisma.salesInvoice.findMany as any).mockResolvedValue([
      mkOriginal("i1"),
      mkOriginal("i2"),
    ]);

    const last = await svc.createRefundCreditNote("o1", "t1");

    const creates = (prisma.salesInvoice.create as any).mock.calls;
    expect(creates).toHaveLength(2);
    expect(creates[0][0].data.originalInvoiceId).toBe("i1");
    expect(creates[1][0].data.originalInvoiceId).toBe("i2");
    // Reversal is a true negation, tied back to the order.
    expect(Number(creates[0][0].data.totalAmount)).toBe(-110);
    expect(creates[0][0].data.orderId).toBe("o1");
    expect(creates[0][0].data.type).toBe("REFUND");
    // The note must NOT copy paymentId — the partial unique (one invoice per
    // payment) belongs to the original.
    expect(creates[0][0].data.paymentId).toBeUndefined();
    expect((last as any).originalInvoiceId).toBe("i2");
  });

  it("is idempotent PER ORIGINAL: an already-reversed invoice is skipped, the other still gets its note", async () => {
    (prisma.salesInvoice.findFirst as any)
      .mockResolvedValueOnce(null) // no legacy refund
      .mockResolvedValueOnce({ id: "cn-old" }) // i1 already reversed
      .mockResolvedValueOnce(null); // i2 not yet
    (prisma.salesInvoice.findUnique as any).mockResolvedValue({
      id: "cn-old",
      originalInvoiceId: "i1",
    });
    (prisma.salesInvoice.findMany as any).mockResolvedValue([
      mkOriginal("i1"),
      mkOriginal("i2"),
    ]);

    await svc.createRefundCreditNote("o1", "t1");

    const creates = (prisma.salesInvoice.create as any).mock.calls;
    expect(creates).toHaveLength(1);
    expect(creates[0][0].data.originalInvoiceId).toBe("i2");
  });

  it("MIGRATION GUARD: a legacy order-level refund (originalInvoiceId null) short-circuits — never double-reverses", async () => {
    (prisma.salesInvoice.findFirst as any).mockResolvedValueOnce({
      id: "legacy-cn",
      type: "REFUND",
      originalInvoiceId: null,
    });

    const out = await svc.createRefundCreditNote("o1", "t1");

    expect((out as any).id).toBe("legacy-cn");
    expect((prisma.salesInvoice.findMany as any).mock.calls).toHaveLength(0);
    expect((prisma.salesInvoice.create as any).mock.calls).toHaveLength(0);
  });

  it("returns null when nothing was invoiced", async () => {
    (prisma.salesInvoice.findFirst as any).mockResolvedValue(null);
    (prisma.salesInvoice.findMany as any).mockResolvedValue([]);
    expect(await svc.createRefundCreditNote("o1", "t1")).toBeNull();
  });
});

/**
 * A2 (split-bill partial refund): refunding ONE customer's payment on a
 * still-open order must reverse only THAT payment's own invoice — the other
 * customers' invoices stand, so the order-level path would over-reverse.
 */
describe("SalesInvoiceService.createRefundCreditNoteForPayment", () => {
  let prisma: MockPrismaClient;
  let svc: SalesInvoiceService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    const settings: any = {
      findByTenant: jest
        .fn()
        .mockResolvedValue({ autoSync: false, provider: "NONE" }),
      getNextInvoiceNumber: jest.fn().mockResolvedValue("CN-P1"),
    };
    svc = new SalesInvoiceService(
      prisma as any,
      settings,
      new TaxCalculationService(),
    );
    (prisma.$transaction as any).mockImplementation(async (cb: any) =>
      cb(prisma),
    );
    (prisma.salesInvoice.create as any).mockImplementation(
      async ({ data }: any) => ({ id: "cn-p", ...data, items: data.items.create }),
    );
  });

  it("reverses the refunded payment's own invoice once (idempotent)", async () => {
    (prisma.salesInvoice.findFirst as any)
      .mockResolvedValueOnce({
        id: "i-pay",
        type: "SALES",
        status: "ISSUED",
        orderId: "o1",
        invoiceNumber: "INV-i-pay",
        customerName: null,
        customerPhone: null,
        customerEmail: null,
        customerTaxId: null,
        customerTaxOffice: null,
        subtotal: 50,
        taxAmount: 5,
        totalAmount: 55,
        discount: 0,
        taxBreakdown: null,
        paymentMethod: "CARD",
        items: [
          {
            description: "Pay share",
            quantity: 1,
            unitPrice: 50,
            taxRate: 10,
            taxAmount: 5,
            subtotal: 50,
            total: 55,
          },
        ],
      })
      .mockResolvedValueOnce(null); // not yet reversed

    const cn = await svc.createRefundCreditNoteForPayment("pay-1", "t1");

    // Lookup keyed by paymentId + tenant, never order-wide.
    const firstWhere = (prisma.salesInvoice.findFirst as any).mock.calls[0][0]
      .where;
    expect(firstWhere.paymentId).toBe("pay-1");
    expect(firstWhere.tenantId).toBe("t1");
    expect((cn as any).originalInvoiceId).toBe("i-pay");
    expect(Number((cn as any).totalAmount)).toBe(-55);
  });

  it("no-ops (null) when the payment never had its own invoice", async () => {
    (prisma.salesInvoice.findFirst as any).mockResolvedValue(null);
    expect(
      await svc.createRefundCreditNoteForPayment("pay-x", "t1"),
    ).toBeNull();
    expect((prisma.salesInvoice.create as any).mock.calls).toHaveLength(0);
  });
});

/**
 * A3 — cancel() must trigger a best-effort provider-side void AFTER the
 * local cancel, and a provider/sync failure must never roll back or block
 * the local cancellation (the sync service flags CANCEL_PENDING on the row
 * itself; cancel() only logs).
 */
describe("SalesInvoiceService.cancel — provider void wiring (A3)", () => {
  let prisma: MockPrismaClient;
  let syncService: { cancelInvoiceAtProvider: jest.Mock };
  let svc: SalesInvoiceService;

  const invoice = { id: "inv-1", tenantId: "t1", status: "ISSUED" };

  beforeEach(() => {
    prisma = mockPrismaClient();
    syncService = {
      cancelInvoiceAtProvider: jest
        .fn()
        .mockResolvedValue({ success: false, error: "gated" }),
    };
    const settings: any = { findByTenant: jest.fn() };
    svc = new SalesInvoiceService(
      prisma as any,
      settings,
      new TaxCalculationService(),
      syncService as any,
    );
    (prisma.salesInvoice.findFirst as any).mockResolvedValue({ ...invoice });
    (prisma.salesInvoice.updateMany as any).mockResolvedValue({ count: 1 });
    (prisma.salesInvoice.findUniqueOrThrow as any).mockResolvedValue({
      ...invoice,
      status: "CANCELLED",
    });
  });

  it("calls cancelInvoiceAtProvider AFTER the local cancel claim", async () => {
    const out = await svc.cancel("inv-1", "t1");

    expect(syncService.cancelInvoiceAtProvider).toHaveBeenCalledWith(
      "inv-1",
      "t1",
    );
    expect(
      (prisma.salesInvoice.updateMany as any).mock.invocationCallOrder[0],
    ).toBeLessThan(
      syncService.cancelInvoiceAtProvider.mock.invocationCallOrder[0],
    );
    expect(out.status).toBe("CANCELLED");
  });

  it("still cancels locally when the provider void throws (best-effort, logged only)", async () => {
    syncService.cancelInvoiceAtProvider.mockRejectedValue(
      new Error("provider exploded"),
    );

    const out = await svc.cancel("inv-1", "t1");

    expect(out.status).toBe("CANCELLED");
  });

  it("does not attempt a provider void when the local claim loses (already cancelled)", async () => {
    (prisma.salesInvoice.updateMany as any).mockResolvedValue({ count: 0 });

    await expect(svc.cancel("inv-1", "t1")).rejects.toThrow(
      /already cancelled/i,
    );
    expect(syncService.cancelInvoiceAtProvider).not.toHaveBeenCalled();
  });

  it("works without a sync service (optional dependency)", async () => {
    const settings: any = { findByTenant: jest.fn() };
    const bare = new SalesInvoiceService(
      prisma as any,
      settings,
      new TaxCalculationService(),
    );

    const out = await bare.cancel("inv-1", "t1");
    expect(out.status).toBe("CANCELLED");
  });
});
