import { BadRequestException, NotFoundException } from "@nestjs/common";
import { CatalogService } from "./catalog.service";

/**
 * Real-logic spec for CatalogService inventory state-transition methods:
 * receiveStock / allocate / markShipped. These encode the hardware stock
 * movement + availability math + the atomic check-and-decrement lock that
 * prevents overselling. The existing catalog spec covers public-view
 * mapping + saleMode tiers but none of these inventory transitions.
 *
 * Pins:
 *  - receiveStock: qty>=1 guard; available increment; serial push capped
 *    to qty; no serial push when none supplied.
 *  - allocate: atomic updateMany guard (available>=qty → decrement +
 *    allocated increment); count===0 → Insufficient/NotFound branch; serial
 *    pop only when serials exist; tx-client passthrough.
 *  - markShipped: allocated decrement + shipped increment.
 */
describe("CatalogService — inventory transitions", () => {
  let prisma: any;
  let svc: CatalogService;

  beforeEach(() => {
    prisma = {
      hardwareInventory: {
        update: jest.fn(),
        updateMany: jest.fn(),
        findUnique: jest.fn(),
      },
    };
    svc = new CatalogService(prisma, { append: jest.fn() } as any);
  });

  describe("receiveStock", () => {
    it("rejects qty < 1", async () => {
      await expect(svc.receiveStock("p-1", 0)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.hardwareInventory.update).not.toHaveBeenCalled();
    });

    it("increments available and does not push serials when none given", async () => {
      prisma.hardwareInventory.update.mockResolvedValue({ id: "i-1" });

      await svc.receiveStock("p-1", 3);

      const arg = prisma.hardwareInventory.update.mock.calls[0][0];
      expect(arg.where).toEqual({ productId: "p-1" });
      expect(arg.data.available).toEqual({ increment: 3 });
      expect("serialsAvailable" in arg.data).toBe(false);
    });

    it("pushes serials capped at qty when serials are supplied", async () => {
      prisma.hardwareInventory.update.mockResolvedValue({ id: "i-1" });

      // qty 2 but 3 serials passed → only the first 2 pushed.
      await svc.receiveStock("p-1", 2, ["s1", "s2", "s3"]);

      const arg = prisma.hardwareInventory.update.mock.calls[0][0];
      expect(arg.data.serialsAvailable).toEqual({ push: ["s1", "s2"] });
    });
  });

  describe("allocate — atomic check-and-decrement", () => {
    it("decrements available + increments allocated under the available>=qty guard", async () => {
      prisma.hardwareInventory.updateMany.mockResolvedValue({ count: 1 });
      prisma.hardwareInventory.findUnique.mockResolvedValue({
        serialsAvailable: [],
      });

      await svc.allocate("p-1", 2);

      const claim = prisma.hardwareInventory.updateMany.mock.calls[0][0];
      expect(claim.where).toEqual({ productId: "p-1", available: { gte: 2 } });
      expect(claim.data).toEqual({
        available: { decrement: 2 },
        allocated: { increment: 2 },
      });
    });

    it("pops serials post-claim and writes back the remaining tail", async () => {
      prisma.hardwareInventory.updateMany.mockResolvedValue({ count: 1 });
      prisma.hardwareInventory.findUnique.mockResolvedValue({
        serialsAvailable: ["s1", "s2", "s3"],
      });

      const res = await svc.allocate("p-1", 2);

      expect(res.serials).toEqual(["s1", "s2"]);
      // remaining tail ["s3"] written back.
      const writeBack = prisma.hardwareInventory.update.mock.calls[0][0];
      expect(writeBack.data).toEqual({ serialsAvailable: ["s3"] });
    });

    it("does not write back serials when none were available (no-op update)", async () => {
      prisma.hardwareInventory.updateMany.mockResolvedValue({ count: 1 });
      prisma.hardwareInventory.findUnique.mockResolvedValue({
        serialsAvailable: [],
      });

      const res = await svc.allocate("p-1", 2);
      expect(res.serials).toEqual([]);
      expect(prisma.hardwareInventory.update).not.toHaveBeenCalled();
    });

    it("throws Insufficient stock (with current count) when the guard misses but a row exists", async () => {
      prisma.hardwareInventory.updateMany.mockResolvedValue({ count: 0 });
      prisma.hardwareInventory.findUnique.mockResolvedValue({ available: 1 });

      await expect(svc.allocate("p-1", 5)).rejects.toThrow(
        /Insufficient stock: have 1, need 5/,
      );
    });

    it("throws NotFound when the guard misses and there is no inventory row", async () => {
      prisma.hardwareInventory.updateMany.mockResolvedValue({ count: 0 });
      prisma.hardwareInventory.findUnique.mockResolvedValue(null);

      await expect(svc.allocate("p-1", 5)).rejects.toThrow(NotFoundException);
    });

    it("runs against the provided transaction client when one is passed", async () => {
      const tx: any = {
        hardwareInventory: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          findUnique: jest.fn().mockResolvedValue({ serialsAvailable: [] }),
          update: jest.fn(),
        },
      };

      await svc.allocate("p-1", 1, tx);

      expect(tx.hardwareInventory.updateMany).toHaveBeenCalled();
      // The bare prisma client must NOT be used when a tx is supplied.
      expect(prisma.hardwareInventory.updateMany).not.toHaveBeenCalled();
    });
  });

  describe("markShipped", () => {
    it("moves allocated → shipped by qty", async () => {
      prisma.hardwareInventory.update.mockResolvedValue({ id: "i-1" });

      await svc.markShipped("p-1", 4);

      const arg = prisma.hardwareInventory.update.mock.calls[0][0];
      expect(arg.where).toEqual({ productId: "p-1" });
      expect(arg.data).toEqual({
        allocated: { decrement: 4 },
        shipped: { increment: 4 },
      });
    });
  });
});
