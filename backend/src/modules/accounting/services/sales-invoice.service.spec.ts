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
