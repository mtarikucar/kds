import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { BillingService } from "./billing.service";
import { PrismaService } from "../../../prisma/prisma.service";
import { InvoiceStatus } from "../../../common/constants/subscription.enum";

/**
 * Long-tail spec for BillingService. We focus on the deterministic, money-
 * critical logic: Decimal-based proration (cents must not drift), day-count
 * helpers, IDOR-scoped invoice queries, and pagination clamping.
 */
describe("BillingService", () => {
  function makeService(config: Partial<Record<string, string>> = {}) {
    const prisma = {
      invoice: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
      },
    } as unknown as PrismaService;
    const cfg = {
      get: jest.fn((k: string) => config[k]),
    } as unknown as ConfigService;
    return { svc: new BillingService(prisma, cfg), prisma };
  }

  describe("calculateProration", () => {
    it("returns the prorated delta rounded to 2 decimals", () => {
      const { svc } = makeService();
      // current 100, new 300, half the period remaining → (300-100)*0.5 = 100
      const out = svc.calculateProration(100, 300, 15, 30);
      expect(out.toFixed(2)).toBe("100.00");
    });

    it("is negative on a downgrade (refund of unused portion)", () => {
      const { svc } = makeService();
      const out = svc.calculateProration(300, 100, 15, 30);
      expect(out.lessThan(0)).toBe(true);
    });

    it("returns 0 when the period length is non-positive (no divide-by-zero)", () => {
      const { svc } = makeService();
      expect(svc.calculateProration(100, 200, 5, 0).toFixed(2)).toBe("0.00");
    });
  });

  describe("day-count helpers", () => {
    it("getDaysRemaining ceils the day delta from now", () => {
      const { svc } = makeService();
      const end = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000 + 1000);
      expect(svc.getDaysRemaining(end)).toBe(6);
    });

    it("getTotalDaysInPeriod ceils the start→end delta", () => {
      const { svc } = makeService();
      const start = new Date("2026-06-01T00:00:00Z");
      const end = new Date("2026-07-01T00:00:00Z");
      expect(svc.getTotalDaysInPeriod(start, end)).toBe(30);
    });
  });

  describe("getSubscriptionInvoices (IDOR scoping + pagination)", () => {
    it("scopes the query by subscription AND tenant", async () => {
      const { svc, prisma } = makeService();
      await svc.getSubscriptionInvoices("sub-1", "tenant-1", 1, 20);
      const where = (prisma.invoice.findMany as jest.Mock).mock.calls[0][0]
        .where;
      expect(where).toEqual({
        subscriptionId: "sub-1",
        subscription: { tenantId: "tenant-1" },
      });
    });

    it("clamps pageSize to the [1,100] range and computes skip", async () => {
      const { svc, prisma } = makeService();
      await svc.getSubscriptionInvoices("s", "t", 3, 9999);
      const args = (prisma.invoice.findMany as jest.Mock).mock.calls[0][0];
      expect(args.take).toBe(100); // clamped
      expect(args.skip).toBe(200); // (3-1)*100
    });

    it("returns a meta envelope with totalPages", async () => {
      const { svc, prisma } = makeService();
      (prisma.invoice.count as jest.Mock).mockResolvedValue(45);
      const r = await svc.getSubscriptionInvoices("s", "t", 1, 20);
      expect(r.meta).toEqual({
        total: 45,
        page: 1,
        pageSize: 20,
        totalPages: 3,
      });
    });
  });

  describe("getInvoiceByNumber", () => {
    it("scopes the lookup by tenant via the subscription relation", async () => {
      const { svc, prisma } = makeService();
      await svc.getInvoiceByNumber("INV-1", "tenant-9");
      const where = (prisma.invoice.findFirst as jest.Mock).mock.calls[0][0]
        .where;
      expect(where).toMatchObject({
        invoiceNumber: "INV-1",
        subscription: { tenantId: "tenant-9" },
      });
    });
  });

  describe("markInvoiceAsPaid / voidInvoice", () => {
    it("markInvoiceAsPaid sets PAID status + paidAt + paymentId", async () => {
      const { svc, prisma } = makeService();
      await svc.markInvoiceAsPaid("inv-1", "pay-1");
      const data = (prisma.invoice.update as jest.Mock).mock.calls[0][0].data;
      expect(data.status).toBe(InvoiceStatus.PAID);
      expect(data.paymentId).toBe("pay-1");
      expect(data.paidAt).toBeInstanceOf(Date);
    });

    it("voidInvoice sets VOID status + voidedAt", async () => {
      const { svc, prisma } = makeService();
      await svc.voidInvoice("inv-2");
      const data = (prisma.invoice.update as jest.Mock).mock.calls[0][0].data;
      expect(data.status).toBe(InvoiceStatus.VOID);
      expect(data.voidedAt).toBeInstanceOf(Date);
    });
  });
});
