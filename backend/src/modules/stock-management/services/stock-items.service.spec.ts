import { BadRequestException, NotFoundException } from "@nestjs/common";
import { StockItemsService } from "./stock-items.service";
import {
  mockPrismaClient,
  MockPrismaClient,
} from "../../../common/test/prisma-mock.service";

/**
 * Real-logic spec for StockItemsService.
 *
 * Pins:
 *  - findAll: search OR-clause (name/sku, insensitive), categoryId/isActive
 *    filters, sortBy/sortOrder fallback to name asc.
 *  - create/update: empty-string SKU → null normalization (the @@unique
 *    constraint workaround) and the TOCTOU updateMany count guard.
 *  - remove: the referential-integrity guard that blocks deleting a stock
 *    item still referenced by a recipe ingredient.
 *  - findExpiringSoon: the alert-date math + trackExpiry gate.
 */
describe("StockItemsService", () => {
  const TENANT = "tenant-1";
  const BRANCH = "branch-1";
  let prisma: MockPrismaClient;
  let svc: StockItemsService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    svc = new StockItemsService(prisma as any);
  });

  describe("findAll", () => {
    beforeEach(() => {
      (prisma.stockItem.findMany as any).mockResolvedValue([]);
    });

    it("builds an insensitive OR search across name+sku", async () => {
      await svc.findAll(TENANT, { search: "tom" } as any);

      const arg = (prisma.stockItem.findMany as any).mock.calls[0][0];
      expect(arg.where.OR).toEqual([
        { name: { contains: "tom", mode: "insensitive" } },
        { sku: { contains: "tom", mode: "insensitive" } },
      ]);
    });

    it("applies categoryId and isActive filters", async () => {
      await svc.findAll(TENANT, {
        categoryId: "cat-1",
        isActive: false,
      } as any);

      const arg = (prisma.stockItem.findMany as any).mock.calls[0][0];
      expect(arg.where).toEqual(
        expect.objectContaining({
          tenantId: TENANT,
          categoryId: "cat-1",
          isActive: false,
        }),
      );
    });

    it("honours sortBy + sortOrder", async () => {
      await svc.findAll(TENANT, {
        sortBy: "currentStock",
        sortOrder: "desc",
      } as any);

      const arg = (prisma.stockItem.findMany as any).mock.calls[0][0];
      expect(arg.orderBy).toEqual({ currentStock: "desc" });
    });

    it("defaults sort to name asc when sortBy is absent", async () => {
      await svc.findAll(TENANT, {} as any);

      const arg = (prisma.stockItem.findMany as any).mock.calls[0][0];
      expect(arg.orderBy).toEqual({ name: "asc" });
    });

    it("defaults sortOrder to asc when sortBy is given without order", async () => {
      await svc.findAll(TENANT, { sortBy: "name" } as any);

      const arg = (prisma.stockItem.findMany as any).mock.calls[0][0];
      expect(arg.orderBy).toEqual({ name: "asc" });
    });
  });

  describe("findOne", () => {
    it("throws NotFound when the item is missing", async () => {
      (prisma.stockItem.findFirst as any).mockResolvedValue(null);
      await expect(svc.findOne("x", TENANT)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("scopes by id+tenant and only includes in-stock batches", async () => {
      (prisma.stockItem.findFirst as any).mockResolvedValue({ id: "si-1" });
      await svc.findOne("si-1", TENANT);

      const arg = (prisma.stockItem.findFirst as any).mock.calls[0][0];
      expect(arg.where).toEqual({ id: "si-1", tenantId: TENANT });
      expect(arg.include.batches.where).toEqual({ quantity: { gt: 0 } });
    });
  });

  describe("create — SKU normalization", () => {
    it("normalizes an empty-string SKU to null", async () => {
      (prisma.stockItem.create as any).mockResolvedValue({ id: "si-1" });

      await svc.create(
        { name: "Tomato", sku: "" } as any,
        TENANT,
        BRANCH,
      );

      const arg = (prisma.stockItem.create as any).mock.calls[0][0];
      expect(arg.data.sku).toBeNull();
      expect(arg.data.tenantId).toBe(TENANT);
      expect(arg.data.branchId).toBe(BRANCH);
    });

    it("keeps a non-empty SKU", async () => {
      (prisma.stockItem.create as any).mockResolvedValue({ id: "si-1" });

      await svc.create(
        { name: "Tomato", sku: "TOM-1" } as any,
        TENANT,
        BRANCH,
      );

      const arg = (prisma.stockItem.create as any).mock.calls[0][0];
      expect(arg.data.sku).toBe("TOM-1");
    });
  });

  describe("update — TOCTOU + SKU normalization", () => {
    it("normalizes empty SKU to null only when sku is in the dto", async () => {
      (prisma.stockItem.findFirst as any).mockResolvedValue({ id: "si-1" });
      (prisma.stockItem.updateMany as any).mockResolvedValue({ count: 1 });
      (prisma.stockItem.findUnique as any).mockResolvedValue({ id: "si-1" });

      await svc.update("si-1", { sku: "" } as any, TENANT);

      const arg = (prisma.stockItem.updateMany as any).mock.calls[0][0];
      expect(arg.where).toEqual({ id: "si-1", tenantId: TENANT });
      expect(arg.data.sku).toBeNull();
    });

    it("does not inject a sku key when the dto omits sku", async () => {
      (prisma.stockItem.findFirst as any).mockResolvedValue({ id: "si-1" });
      (prisma.stockItem.updateMany as any).mockResolvedValue({ count: 1 });
      (prisma.stockItem.findUnique as any).mockResolvedValue({ id: "si-1" });

      await svc.update("si-1", { name: "New" } as any, TENANT);

      const arg = (prisma.stockItem.updateMany as any).mock.calls[0][0];
      expect("sku" in arg.data).toBe(false);
    });

    it("throws NotFound when the update matched 0 rows (deleted mid-flight)", async () => {
      (prisma.stockItem.findFirst as any).mockResolvedValue({ id: "si-1" });
      (prisma.stockItem.updateMany as any).mockResolvedValue({ count: 0 });

      await expect(
        svc.update("si-1", { name: "New" } as any, TENANT),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.stockItem.findUnique).not.toHaveBeenCalled();
    });
  });

  describe("remove — recipe referential-integrity guard", () => {
    it("blocks deletion when the item is used in a recipe (names the recipe)", async () => {
      (prisma.stockItem.findFirst as any).mockResolvedValue({ id: "si-1" });
      (prisma.recipeIngredient.findFirst as any).mockResolvedValue({
        recipe: { name: "Margherita" },
      });

      await expect(svc.remove("si-1", TENANT)).rejects.toThrow(
        /used in recipe "Margherita"/,
      );
      expect(prisma.stockItem.deleteMany).not.toHaveBeenCalled();
    });

    it("scopes the recipe-usage probe to the tenant via the recipe relation", async () => {
      (prisma.stockItem.findFirst as any).mockResolvedValue({ id: "si-1" });
      (prisma.recipeIngredient.findFirst as any).mockResolvedValue(null);
      (prisma.stockItem.deleteMany as any).mockResolvedValue({ count: 1 });

      await svc.remove("si-1", TENANT);

      const arg = (prisma.recipeIngredient.findFirst as any).mock.calls[0][0];
      expect(arg.where).toEqual({
        stockItemId: "si-1",
        recipe: { tenantId: TENANT },
      });
    });

    it("deletes and returns the id when no recipe references the item", async () => {
      (prisma.stockItem.findFirst as any).mockResolvedValue({ id: "si-1" });
      (prisma.recipeIngredient.findFirst as any).mockResolvedValue(null);
      (prisma.stockItem.deleteMany as any).mockResolvedValue({ count: 1 });

      const res = await svc.remove("si-1", TENANT);
      expect(res).toEqual({ id: "si-1" });
    });

    it("throws NotFound when the delete matched 0 rows (TOCTOU)", async () => {
      (prisma.stockItem.findFirst as any).mockResolvedValue({ id: "si-1" });
      (prisma.recipeIngredient.findFirst as any).mockResolvedValue(null);
      (prisma.stockItem.deleteMany as any).mockResolvedValue({ count: 0 });

      await expect(svc.remove("si-1", TENANT)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("findExpiringSoon — alert window + trackExpiry gate", () => {
    it("gates on quantity>0, expiry range and stockItem.trackExpiry=true", async () => {
      (prisma.stockBatch.findMany as any).mockResolvedValue([]);

      const before = new Date();
      await svc.findExpiringSoon(TENANT, 5);
      const after = new Date();

      const arg = (prisma.stockBatch.findMany as any).mock.calls[0][0];
      expect(arg.where.tenantId).toBe(TENANT);
      expect(arg.where.quantity).toEqual({ gt: 0 });
      expect(arg.where.stockItem).toEqual({ trackExpiry: true });
      // lte ≈ now + 5 days.
      const expectedLowerBoundMs = before.getTime() + 5 * 24 * 60 * 60 * 1000;
      const expectedUpperBoundMs = after.getTime() + 5 * 24 * 60 * 60 * 1000;
      const lteMs = arg.where.expiryDate.lte.getTime();
      expect(lteMs).toBeGreaterThanOrEqual(expectedLowerBoundMs - 1000);
      expect(lteMs).toBeLessThanOrEqual(expectedUpperBoundMs + 1000);
    });

    it("defaults the alert window to 3 days", async () => {
      (prisma.stockBatch.findMany as any).mockResolvedValue([]);

      const before = Date.now();
      await svc.findExpiringSoon(TENANT);

      const arg = (prisma.stockBatch.findMany as any).mock.calls[0][0];
      const deltaDays =
        (arg.where.expiryDate.lte.getTime() - before) / (24 * 60 * 60 * 1000);
      expect(deltaDays).toBeGreaterThan(2.9);
      expect(deltaDays).toBeLessThan(3.1);
    });
  });
});
