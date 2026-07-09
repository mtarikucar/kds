import { PrismaClient } from "@prisma/client";
import { randomUUID } from "crypto";
import { SalesInvoiceService } from "./sales-invoice.service";
import { AccountingSettingsService } from "./accounting-settings.service";
import { TaxCalculationService } from "./tax-calculation.service";

/**
 * REAL-DB integration for İade faturası (credit note) on refund. Gated by
 * COMBO_E2E_DB so the normal suite is unaffected. Proves createRefundCreditNote
 * mints a REFUND-type reversing invoice that nets the original to zero and is
 * idempotent.
 */
const RUN = !!process.env.COMBO_E2E_DB;
const d = RUN ? describe : describe.skip;

d("refund credit note — real DB", () => {
  let prisma: PrismaClient;
  let svc: SalesInvoiceService;
  const ids = { tenant: "", branch: "", order: "", cat: "", prod: "" };

  beforeAll(async () => {
    prisma = new PrismaClient({
      datasources: { db: { url: process.env.COMBO_E2E_DB } },
    });
    svc = new SalesInvoiceService(
      prisma as any,
      new AccountingSettingsService(prisma as any),
      new TaxCalculationService(),
    );
    const tenant = await prisma.tenant.findFirstOrThrow({ where: { name: "Demo Restaurant" } });
    ids.tenant = tenant.id;
    ids.branch = (await prisma.branch.findFirstOrThrow({ where: { tenantId: tenant.id } })).id;
    ids.cat = (await prisma.category.findFirstOrThrow({ where: { tenantId: tenant.id } })).id;
    ids.prod = (await prisma.product.findFirstOrThrow({ where: { tenantId: tenant.id } })).id;

    const order = await prisma.order.create({
      data: {
        orderNumber: `CN-${randomUUID().slice(0, 8)}`,
        type: "DINE_IN",
        status: "PAID",
        tenantId: ids.tenant,
        branchId: ids.branch,
        totalAmount: 150,
        finalAmount: 150,
        taxAmount: 25,
      },
    });
    ids.order = order.id;
    // Original ISSUED sales invoice for the order (mixed-rate lines).
    await prisma.salesInvoice.create({
      data: {
        invoiceNumber: `ORIG-${randomUUID().slice(0, 8)}`,
        type: "SALES",
        status: "ISSUED",
        subtotal: 125,
        taxAmount: 25,
        totalAmount: 150,
        discount: 0,
        taxBreakdown: { "10": { taxableAmount: 100, taxAmount: 10 }, "20": { taxableAmount: 25, taxAmount: 15 } },
        orderId: ids.order,
        tenantId: ids.tenant,
        items: {
          create: [
            { description: "Burger", quantity: 1, unitPrice: 100, taxRate: 10, taxAmount: 10, subtotal: 100, total: 110 },
            { description: "Kola", quantity: 1, unitPrice: 25, taxRate: 20, taxAmount: 15, subtotal: 25, total: 40 },
          ],
        },
      },
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.salesInvoice.deleteMany({ where: { orderId: ids.order } }).catch(() => {});
    await prisma.order.delete({ where: { id: ids.order } }).catch(() => {});
    await prisma.$disconnect();
  });

  it("mints a REFUND credit note that reverses the original and is idempotent", async () => {
    const cn = await svc.createRefundCreditNote(ids.order, ids.tenant);
    expect(cn).toBeTruthy();
    expect(cn!.type).toBe("REFUND");
    expect(cn!.status).toBe("ISSUED");
    // Totals negated → original + credit note net to zero.
    expect(Number(cn!.totalAmount)).toBeCloseTo(-150, 2);
    expect(Number(cn!.subtotal)).toBeCloseTo(-125, 2);
    expect(Number(cn!.taxAmount)).toBeCloseTo(-25, 2);
    // Line items negated.
    const items = (cn as any).items as any[];
    expect(items).toHaveLength(2);
    expect(items.every((i) => Number(i.total) < 0)).toBe(true);
    expect(items[0].description).toMatch(/İADE .*orijinal fatura/i);

    // Idempotent — a second call returns the SAME credit note, not a duplicate.
    const again = await svc.createRefundCreditNote(ids.order, ids.tenant);
    expect(again!.id).toBe(cn!.id);
    const count = await prisma.salesInvoice.count({ where: { orderId: ids.order, type: "REFUND" } });
    expect(count).toBe(1);
  });
});
