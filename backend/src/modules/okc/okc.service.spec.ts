import { NotFoundException } from "@nestjs/common";
import { OkcService } from "./okc.service";
import { FiscalReceiptGenerator } from "./fiscal-receipt.generator";
import { MockOkcDevice, NullOkcDevice } from "./okc-device.provider";

describe("OkcService", () => {
  const SCOPE = {
    tenantId: "t1",
    branchId: "b1",
    userId: "u1",
    role: "ADMIN",
  } as const;

  const order = {
    id: "ord-1",
    orderNumber: "ORD-1",
    paymentMethod: "CASH",
    orderItems: [
      { quantity: 2, unitPrice: 20, taxRate: 10, product: { name: "Çay" } },
    ],
  };

  it("generates a receipt and prints it on the mock device", async () => {
    const prisma: any = {
      order: { findFirst: jest.fn().mockResolvedValue(order) },
    };
    const svc = new OkcService(
      prisma,
      new FiscalReceiptGenerator(),
      new MockOkcDevice(),
    );

    const res = await svc.printOrderReceipt(SCOPE, "ord-1");
    expect(res.device).toBe("MOCK");
    expect(res.receipt.grandTotal).toBe(40);
    expect(res.fiscal.fiscalReceiptNo).toMatch(/^MOCK-/);
    expect(res.fiscal.zNo).toBe(1);
  });

  it("throws when the order is missing", async () => {
    const prisma: any = {
      order: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const svc = new OkcService(
      prisma,
      new FiscalReceiptGenerator(),
      new MockOkcDevice(),
    );
    await expect(svc.printOrderReceipt(SCOPE, "missing")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("refuses to print when no device is configured (NullOkcDevice)", async () => {
    const prisma: any = {
      order: { findFirst: jest.fn().mockResolvedValue(order) },
    };
    const svc = new OkcService(
      prisma,
      new FiscalReceiptGenerator(),
      new NullOkcDevice(),
    );
    await expect(svc.printOrderReceipt(SCOPE, "ord-1")).rejects.toThrow(
      /No ÖKC device configured/,
    );
  });
});
