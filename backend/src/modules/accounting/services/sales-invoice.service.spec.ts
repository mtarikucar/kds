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
