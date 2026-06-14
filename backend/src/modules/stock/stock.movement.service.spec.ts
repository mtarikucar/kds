import { BadRequestException, NotFoundException } from "@nestjs/common";
import { StockService } from "./stock.service";
import {
  mockPrismaClient,
  MockPrismaClient,
} from "../../common/test/prisma-mock.service";
import { StockMovementType } from "../../common/constants/order-status.enum";

/**
 * Real-logic spec for StockService.createMovement — the IN/OUT/ADJUSTMENT
 * stock-movement state machine + the atomic OUT decrement lock, plus
 * getLowStockAlerts availability mapping. The existing stock spec covers
 * getMovements pagination + the metrics counter but NOT these branches:
 *  - product/tracking pre-guards (NotFound / tracking-disabled).
 *  - IN: increment + re-read.
 *  - OUT: conditional decrement under `currentStock>=qty`; count!==1 →
 *    Insufficient stock (the oversell guard).
 *  - ADJUSTMENT: negative-quantity rejection; literal-set semantics.
 *  - isAvailable sync flip driven by newStock.gt(0).
 *  - getLowStockAlerts: threshold filter + flattened category mapping.
 */
describe("StockService.createMovement — state machine", () => {
  const TENANT = "t1";
  let prisma: MockPrismaClient;
  let svc: StockService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    svc = new StockService(prisma as any);
    (prisma.$transaction as any).mockImplementation((cb: any) => cb(prisma));
    (prisma.stockMovement.create as any).mockResolvedValue({ id: "m-1" });
    (prisma.product.update as any).mockResolvedValue({});
  });

  function wireProduct(over: any = {}) {
    (prisma.product.findFirst as any).mockResolvedValue({
      id: "p-1",
      tenantId: TENANT,
      stockTracked: true,
      ...over,
    });
  }

  const call = (type: StockMovementType, quantity: number) =>
    svc.createMovement(
      { productId: "p-1", type, quantity } as any,
      "u1",
      TENANT,
      "b1",
    );

  describe("pre-guards", () => {
    it("throws NotFound when the product is missing", async () => {
      (prisma.product.findFirst as any).mockResolvedValue(null);
      await expect(call(StockMovementType.IN, 1)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("throws when stock tracking is disabled", async () => {
      wireProduct({ stockTracked: false });
      await expect(call(StockMovementType.IN, 1)).rejects.toThrow(
        /Stock tracking is not enabled/,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe("IN", () => {
    it("increments currentStock and syncs isAvailable from the fresh value", async () => {
      wireProduct();
      (prisma.product.updateMany as any).mockResolvedValue({ count: 1 });
      (prisma.product.findUniqueOrThrow as any).mockResolvedValue({
        currentStock: 12,
      });

      await call(StockMovementType.IN, 5);

      const updArg = (prisma.product.updateMany as any).mock.calls[0][0];
      expect(updArg.data).toEqual({ currentStock: { increment: 5 } });
      // isAvailable synced true (12 > 0).
      const availArg = (prisma.product.update as any).mock.calls[0][0];
      expect(availArg.data.isAvailable).toBe(true);
    });

    it("throws NotFound if the increment matched no row (deleted mid-flight)", async () => {
      wireProduct();
      (prisma.product.updateMany as any).mockResolvedValue({ count: 0 });
      await expect(call(StockMovementType.IN, 5)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("OUT — atomic decrement lock", () => {
    it("decrements under the currentStock>=qty guard and records the movement", async () => {
      wireProduct();
      (prisma.product.updateMany as any).mockResolvedValue({ count: 1 });
      (prisma.product.findUniqueOrThrow as any).mockResolvedValue({
        currentStock: 3,
      });

      await call(StockMovementType.OUT, 2);

      const updArg = (prisma.product.updateMany as any).mock.calls[0][0];
      expect(updArg.where).toEqual({
        id: "p-1",
        tenantId: TENANT,
        currentStock: { gte: 2 },
      });
      expect(updArg.data).toEqual({ currentStock: { decrement: 2 } });
    });

    it("throws Insufficient stock when the conditional decrement misses (oversell guard)", async () => {
      wireProduct();
      (prisma.product.updateMany as any).mockResolvedValue({ count: 0 });

      await expect(call(StockMovementType.OUT, 99)).rejects.toThrow(
        "Insufficient stock",
      );
      // No movement row + no availability flip on the lost race.
      expect(prisma.stockMovement.create).not.toHaveBeenCalled();
      expect(prisma.product.update).not.toHaveBeenCalled();
    });

    it("flips isAvailable false when the OUT drops stock to 0", async () => {
      wireProduct();
      (prisma.product.updateMany as any).mockResolvedValue({ count: 1 });
      (prisma.product.findUniqueOrThrow as any).mockResolvedValue({
        currentStock: 0,
      });

      await call(StockMovementType.OUT, 2);

      const availArg = (prisma.product.update as any).mock.calls[0][0];
      expect(availArg.data.isAvailable).toBe(false);
    });
  });

  describe("ADJUSTMENT — literal set", () => {
    it("rejects a negative adjustment quantity", async () => {
      wireProduct();
      await expect(call(StockMovementType.ADJUSTMENT, -1)).rejects.toThrow(
        /Adjustment quantity must be >= 0/,
      );
    });

    it("writes the literal quantity (absolute override) and syncs availability", async () => {
      wireProduct();
      (prisma.product.updateMany as any).mockResolvedValue({ count: 1 });

      await call(StockMovementType.ADJUSTMENT, 7);

      const updArg = (prisma.product.updateMany as any).mock.calls[0][0];
      // Decimal(7) literal set — assert numeric value.
      expect(Number(updArg.data.currentStock)).toBe(7);
      const availArg = (prisma.product.update as any).mock.calls[0][0];
      expect(availArg.data.isAvailable).toBe(true);
    });

    it("ADJUSTMENT to 0 marks the product unavailable", async () => {
      wireProduct();
      (prisma.product.updateMany as any).mockResolvedValue({ count: 1 });

      await call(StockMovementType.ADJUSTMENT, 0);

      const availArg = (prisma.product.update as any).mock.calls[0][0];
      expect(availArg.data.isAvailable).toBe(false);
    });

    it("throws NotFound if the literal-set update matched no row", async () => {
      wireProduct();
      (prisma.product.updateMany as any).mockResolvedValue({ count: 0 });
      await expect(call(StockMovementType.ADJUSTMENT, 3)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("getLowStockAlerts", () => {
    it("filters by stockTracked + currentStock<threshold and flattens category name", async () => {
      (prisma.product.findMany as any).mockResolvedValue([
        {
          id: "p-1",
          name: "Tea",
          currentStock: 2,
          category: { name: "Drinks" },
          image: "img",
          price: 5,
          isAvailable: true,
        },
      ]);

      const res = await svc.getLowStockAlerts(TENANT, 5);

      const arg = (prisma.product.findMany as any).mock.calls[0][0];
      expect(arg.where).toEqual({
        tenantId: TENANT,
        stockTracked: true,
        currentStock: { lt: 5 },
      });
      expect(arg.orderBy).toEqual({ currentStock: "asc" });
      expect(res).toEqual([
        {
          id: "p-1",
          name: "Tea",
          currentStock: 2,
          categoryName: "Drinks",
          image: "img",
          price: 5,
          isAvailable: true,
        },
      ]);
    });

    it("defaults the threshold to 10", async () => {
      (prisma.product.findMany as any).mockResolvedValue([]);
      await svc.getLowStockAlerts(TENANT);
      const arg = (prisma.product.findMany as any).mock.calls[0][0];
      expect(arg.where.currentStock).toEqual({ lt: 10 });
    });
  });
});
