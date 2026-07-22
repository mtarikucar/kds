import { Test } from "@nestjs/testing";
import { GuidanceService } from "./guidance.service";
import { PrismaService } from "../../../prisma/prisma.service";

// Minimal prisma mock: only the models/queries the service uses.
const prismaMock = () => ({
  branch: { count: jest.fn() },
  stockItem: { findMany: jest.fn() },
  purchaseOrderItem: { findMany: jest.fn() },
  supplierStockItem: { findMany: jest.fn() },
});

describe("GuidanceService", () => {
  let service: GuidanceService;
  let prisma: ReturnType<typeof prismaMock>;

  beforeEach(async () => {
    prisma = prismaMock();
    const mod = await Test.createTestingModule({
      providers: [
        GuidanceService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = mod.get(GuidanceService);
  });

  it("infers MULTI_BRANCH when the tenant has >1 branch", async () => {
    prisma.branch.count.mockResolvedValue(3);
    prisma.stockItem.findMany.mockResolvedValue([]);
    prisma.purchaseOrderItem.findMany.mockResolvedValue([]);
    prisma.supplierStockItem.findMany.mockResolvedValue([]);
    const r = await service.getGuidance("t1", "b1");
    expect(r.volumeTier).toBe("MULTI_BRANCH");
  });

  it("normalizes purchase-unit prices to base units when picking cheapest supplier", async () => {
    prisma.branch.count.mockResolvedValue(1);
    // One below-par item
    prisma.stockItem.findMany.mockResolvedValue([
      {
        id: "i1",
        name: "Dana Kıyma",
        unit: "kg",
        currentStock: 1,
        minStock: 5,
        reorderQuantity: null,
        purchaseUnit: null,
        purchaseConversion: null,
        costPerUnit: "500",
        category: { name: "Et" },
      },
    ]);
    // Two suppliers in PO history: supplier A sells by 10kg box at 4500 (=450/kg),
    // supplier B sells per kg at 470. Cheapest base-unit = A (450).
    prisma.purchaseOrderItem.findMany.mockResolvedValue([
      {
        stockItemId: "i1",
        unitPrice: "4500",
        conversionFactor: 10,
        purchaseOrder: {
          supplierId: "A",
          supplier: { name: "Kasap Ali" },
          submittedAt: new Date("2026-07-20"),
          createdAt: new Date("2026-07-20"),
        },
      },
      {
        stockItemId: "i1",
        unitPrice: "470",
        conversionFactor: null,
        purchaseOrder: {
          supplierId: "B",
          supplier: { name: "Metro" },
          submittedAt: new Date("2026-07-18"),
          createdAt: new Date("2026-07-18"),
        },
      },
      {
        stockItemId: "i1",
        unitPrice: "4600",
        conversionFactor: 10,
        purchaseOrder: {
          supplierId: "A",
          supplier: { name: "Kasap Ali" },
          submittedAt: new Date("2026-07-05"),
          createdAt: new Date("2026-07-05"),
        },
      },
    ]);
    prisma.supplierStockItem.findMany.mockResolvedValue([]);
    const r = await service.getGuidance("t1", "b1");
    const line = r.buyList.find((l) => l.stockItemId === "i1");
    expect(line?.recommended.type).toBe("OWN_HISTORY");
    expect(line?.recommended).toMatchObject({ supplierName: "Kasap Ali" });
    // last base-unit price for A = 4500/10 = 450
    expect((line?.recommended as any).lastUnitPrice).toBeCloseTo(450, 4);
  });

  it("treats a negative or zero conversionFactor as 1:1, not an inverted ranking", async () => {
    prisma.branch.count.mockResolvedValue(1);
    prisma.stockItem.findMany.mockResolvedValue([
      {
        id: "i1",
        name: "Dana Kıyma",
        unit: "kg",
        currentStock: 1,
        minStock: 5,
        reorderQuantity: null,
        purchaseUnit: null,
        purchaseConversion: null,
        costPerUnit: "500",
        category: { name: "Et" },
      },
    ]);
    // Supplier A: normal 10kg-box line -> base-unit price 450.
    // Supplier C: corrupt data with a NEGATIVE conversionFactor. Unguarded,
    // 100 / -5 = -20 would look like the cheapest price and wrongly win the
    // ranking (a negative price sorts before every real positive price).
    // Guarded, a <=0 factor falls back to 1:1, so C's base-unit price is
    // just its raw unitPrice (100) — still cheaper than A's 450 on its own
    // merits, but never via a sign inversion.
    prisma.purchaseOrderItem.findMany.mockResolvedValue([
      {
        stockItemId: "i1",
        unitPrice: "4500",
        conversionFactor: 10,
        purchaseOrder: {
          supplierId: "A",
          supplier: { name: "Kasap Ali" },
          submittedAt: new Date("2026-07-20"),
          createdAt: new Date("2026-07-20"),
        },
      },
      {
        stockItemId: "i1",
        unitPrice: "4600",
        conversionFactor: 10,
        purchaseOrder: {
          supplierId: "A",
          supplier: { name: "Kasap Ali" },
          submittedAt: new Date("2026-07-05"),
          createdAt: new Date("2026-07-05"),
        },
      },
      {
        stockItemId: "i1",
        unitPrice: "100",
        conversionFactor: -5,
        purchaseOrder: {
          supplierId: "C",
          supplier: { name: "Corrupt Data Co" },
          submittedAt: new Date("2026-07-18"),
          createdAt: new Date("2026-07-18"),
        },
      },
      {
        stockItemId: "i1",
        unitPrice: "110",
        conversionFactor: -5,
        purchaseOrder: {
          supplierId: "C",
          supplier: { name: "Corrupt Data Co" },
          submittedAt: new Date("2026-07-01"),
          createdAt: new Date("2026-07-01"),
        },
      },
    ]);
    prisma.supplierStockItem.findMany.mockResolvedValue([]);
    const r = await service.getGuidance("t1", "b1");
    const line = r.buyList.find((l) => l.stockItemId === "i1");
    const c = [line?.recommended, ...(line?.alternatives ?? [])].find(
      (s: any) => s.supplierId === "C",
    ) as any;
    expect(c.lastUnitPrice).toBe(100);
    expect(c.lastUnitPrice).toBeGreaterThan(0);
  });

  it("falls back to CATALOG then CHANNEL when history is thin", async () => {
    prisma.branch.count.mockResolvedValue(1);
    prisma.stockItem.findMany.mockResolvedValue([
      {
        id: "i2",
        name: "Domates",
        unit: "kg",
        currentStock: 0,
        minStock: 10,
        reorderQuantity: null,
        purchaseUnit: null,
        purchaseConversion: null,
        costPerUnit: "30",
        category: { name: "Sebze" },
      },
    ]);
    prisma.purchaseOrderItem.findMany.mockResolvedValue([]); // no history
    prisma.supplierStockItem.findMany.mockResolvedValue([]); // no catalog
    const r = await service.getGuidance("t1", "b1");
    const line = r.buyList.find((l) => l.stockItemId === "i2");
    expect(line?.recommended.type).toBe("CHANNEL");
    expect((line?.recommended as any).categoryKey).toBe("PRODUCE");
  });

  it("always returns the 7-category channel guide for the tier", async () => {
    prisma.branch.count.mockResolvedValue(1);
    prisma.stockItem.findMany.mockResolvedValue([]);
    prisma.purchaseOrderItem.findMany.mockResolvedValue([]);
    prisma.supplierStockItem.findMany.mockResolvedValue([]);
    const r = await service.getGuidance("t1", "b1");
    expect(r.channelGuide).toHaveLength(7);
  });
});
