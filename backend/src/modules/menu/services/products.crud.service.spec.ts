import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ProductsService } from "./products.service";
import {
  mockPrismaClient,
  MockPrismaClient,
} from "../../../common/test/prisma-mock.service";

/**
 * Real-logic spec for ProductsService create / update / remove and the
 * transformProductResponse mapping. The existing products spec covers
 * updateStock + findAll pagination but NOT these branches:
 *  - create/update: the category-ownership referential-integrity guard.
 *  - update: TOCTOU updateMany count guard + the imageIds replace branch.
 *  - remove: the P2003 → 409 "has orders" translation (Restrict FK).
 *  - transformProductResponse: junction-table flattening (productImages →
 *    images with order; modifierGroups → group fields + displayOrder sort).
 */
describe("ProductsService — create/update/remove/transform", () => {
  const TENANT = "t-1";
  let prisma: MockPrismaClient;
  let svc: ProductsService;

  let uploadService: { deleteProductImage: jest.Mock };

  beforeEach(() => {
    prisma = mockPrismaClient();
    uploadService = {
      deleteProductImage: jest.fn().mockResolvedValue(undefined),
    };
    // Orphan-prune helpers read the junction table; default to "no links" so
    // the prune is a no-op unless a test sets up orphans explicitly.
    (prisma.productToImage.findMany as any).mockResolvedValue([]);
    svc = new ProductsService(prisma as any, uploadService as any);
  });

  describe("create — category ownership guard", () => {
    it("rejects a category that does not belong to the tenant", async () => {
      (prisma.category.findFirst as any).mockResolvedValue(null);

      await expect(
        svc.create(
          { name: "Tea", price: 5, categoryId: "cat-x" } as any,
          TENANT,
        ),
      ).rejects.toThrow(/category does not belong/);
      expect(prisma.product.create).not.toHaveBeenCalled();
    });

    it("creates with tenant stamp + defaults when the category is valid", async () => {
      (prisma.category.findFirst as any).mockResolvedValue({ id: "cat-1" });
      (prisma.product.create as any).mockResolvedValue({
        id: "p-1",
        name: "Tea",
        productImages: [],
        modifierGroups: [],
      });

      await svc.create(
        { name: "Tea", price: 5, categoryId: "cat-1" } as any,
        TENANT,
      );

      const arg = (prisma.product.create as any).mock.calls[0][0];
      expect(arg.data).toEqual(
        expect.objectContaining({
          name: "Tea",
          tenantId: TENANT,
          categoryId: "cat-1",
          isAvailable: true, // default
          stockTracked: false, // default
          currentStock: 0, // default
        }),
      );
    });

    it("delegates to findOne to re-fetch with images when imageIds are supplied", async () => {
      (prisma.category.findFirst as any).mockResolvedValue({ id: "cat-1" });
      (prisma.product.create as any).mockResolvedValue({
        id: "p-1",
        productImages: [],
        modifierGroups: [],
      });
      // attachImagesToProduct verifies ownership via productImage.findMany.
      (prisma.productImage.findMany as any).mockResolvedValue([
        { id: "img-1" },
      ]);
      (prisma.productToImage.createMany as any).mockResolvedValue({ count: 1 });
      (prisma.$transaction as any).mockResolvedValue([]);
      // findOne re-fetch (uses product.findFirst).
      (prisma.product.findFirst as any).mockResolvedValue({
        id: "p-1",
        productImages: [],
        modifierGroups: [],
      });

      const res = await svc.create(
        {
          name: "Tea",
          price: 5,
          categoryId: "cat-1",
          imageIds: ["img-1"],
        } as any,
        TENANT,
      );
      // findOne returns the transformed shape (has `images`).
      expect(res).toHaveProperty("images");
    });

    it("rejects when an attached image is not owned by the tenant", async () => {
      (prisma.category.findFirst as any).mockResolvedValue({ id: "cat-1" });
      (prisma.product.create as any).mockResolvedValue({
        id: "p-1",
        productImages: [],
        modifierGroups: [],
      });
      // Only one of the two requested images is owned → count mismatch.
      (prisma.productImage.findMany as any).mockResolvedValue([
        { id: "img-1" },
      ]);

      await expect(
        svc.create(
          {
            name: "Tea",
            price: 5,
            categoryId: "cat-1",
            imageIds: ["img-1", "img-2"],
          } as any,
          TENANT,
        ),
      ).rejects.toThrow(/Image\(s\) not found.*img-2/);
    });
  });

  describe("transformProductResponse (via findOne / findAll)", () => {
    it("flattens productImages into images carrying the junction order", async () => {
      (prisma.product.findFirst as any).mockResolvedValue({
        id: "p-1",
        name: "Tea",
        productImages: [
          { order: 2, image: { id: "img-2", url: "u2" } },
          { order: 1, image: { id: "img-1", url: "u1" } },
        ],
      });

      const res: any = await svc.findOne("p-1", TENANT);

      expect(res.images).toEqual([
        { id: "img-2", url: "u2", order: 2 },
        { id: "img-1", url: "u1", order: 1 },
      ]);
      // junction key removed.
      expect(res.productImages).toBeUndefined();
    });

    it("flattens modifierGroups and sorts them by displayOrder asc", async () => {
      (prisma.product.findMany as any).mockResolvedValue([
        {
          id: "p-1",
          name: "Tea",
          productImages: [],
          modifierGroups: [
            { displayOrder: 5, group: { id: "g-b", name: "B" } },
            { displayOrder: 1, group: { id: "g-a", name: "A" } },
          ],
        },
      ]);

      const [res]: any = await svc.findAll(TENANT);

      expect(res.modifierGroups.map((g: any) => g.id)).toEqual(["g-a", "g-b"]);
      expect(res.modifierGroups[0]).toEqual(
        expect.objectContaining({ id: "g-a", displayOrder: 1 }),
      );
    });

    it("findOne throws NotFound when the product is missing", async () => {
      (prisma.product.findFirst as any).mockResolvedValue(null);
      await expect(svc.findOne("missing", TENANT)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("update — ownership, TOCTOU, image replace", () => {
    beforeEach(() => {
      // findOne pre-check resolves to an existing product.
      (prisma.product.findFirst as any).mockResolvedValue({
        id: "p-1",
        productImages: [],
        modifierGroups: [],
      });
    });

    it("rejects a new category that is not owned by the tenant", async () => {
      (prisma.category.findFirst as any).mockResolvedValue(null);

      await expect(
        svc.update("p-1", { categoryId: "cat-x" } as any, TENANT),
      ).rejects.toThrow(/category does not belong/);
      expect(prisma.product.updateMany).not.toHaveBeenCalled();
    });

    it("claims with a compound {id, tenantId} updateMany and throws when count===0", async () => {
      (prisma.product.updateMany as any).mockResolvedValue({ count: 0 });

      await expect(
        svc.update("p-1", { name: "New" } as any, TENANT),
      ).rejects.toThrow("Product not found");
      const arg = (prisma.product.updateMany as any).mock.calls[0][0];
      expect(arg.where).toEqual({ id: "p-1", tenantId: TENANT });
    });

    it("replaces image links when imageIds is an empty array (clears, no re-attach)", async () => {
      (prisma.product.updateMany as any).mockResolvedValue({ count: 1 });
      (prisma.productToImage.deleteMany as any).mockResolvedValue({ count: 3 });

      await svc.update("p-1", { imageIds: [] } as any, TENANT);

      expect(prisma.productToImage.deleteMany).toHaveBeenCalledWith({
        where: { productId: "p-1" },
      });
      // empty array → no attach (createMany not called).
      expect(prisma.productToImage.createMany).not.toHaveBeenCalled();
    });

    it("does not touch image links when imageIds is omitted", async () => {
      (prisma.product.updateMany as any).mockResolvedValue({ count: 1 });

      await svc.update("p-1", { name: "New" } as any, TENANT);

      expect(prisma.productToImage.deleteMany).not.toHaveBeenCalled();
    });

    it("strips imageIds out of the productData written to the row", async () => {
      (prisma.product.updateMany as any).mockResolvedValue({ count: 1 });
      (prisma.productToImage.deleteMany as any).mockResolvedValue({ count: 0 });

      await svc.update("p-1", { name: "New", imageIds: [] } as any, TENANT);

      // The updateMany data must not carry imageIds.
      const arg = (prisma.product.updateMany as any).mock.calls[0][0];
      expect("imageIds" in arg.data).toBe(false);
      expect(arg.data.name).toBe("New");
    });
  });

  describe("remove — Restrict FK → 409 translation", () => {
    beforeEach(() => {
      (prisma.product.findFirst as any).mockResolvedValue({
        id: "p-1",
        productImages: [],
        modifierGroups: [],
      });
    });

    it("deletes with a compound {id, tenantId} when unreferenced", async () => {
      (prisma.product.delete as any).mockResolvedValue({ id: "p-1" });

      await svc.remove("p-1", TENANT);
      expect(prisma.product.delete).toHaveBeenCalledWith({
        where: { id: "p-1", tenantId: TENANT },
      });
    });

    it("translates a P2003 FK violation into a 409 with a soft-delete hint", async () => {
      const fkErr = new Prisma.PrismaClientKnownRequestError(
        "FK violation",
        { code: "P2003", clientVersion: "5" } as any,
      );
      (prisma.product.delete as any).mockRejectedValue(fkErr);

      await expect(svc.remove("p-1", TENANT)).rejects.toThrow(
        ConflictException,
      );
      await expect(svc.remove("p-1", TENANT)).rejects.toThrow(
        /Mark it as unavailable instead/,
      );
    });

    it("rethrows a non-P2003 error unchanged", async () => {
      const other = new Error("boom");
      (prisma.product.delete as any).mockRejectedValue(other);
      await expect(svc.remove("p-1", TENANT)).rejects.toThrow("boom");
    });
  });

  describe("updateStock — tracking gate", () => {
    it("rejects when stock tracking is disabled (pre-tx guard)", async () => {
      (prisma.product.findFirst as any).mockResolvedValue({
        id: "p-1",
        stockTracked: false,
        productImages: [],
      });

      await expect(svc.updateStock("p-1", 5, TENANT)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  // Images are a REUSABLE, tenant-scoped library (linked to products only via
  // the ProductToImage junction). A previous "auto-prune on detach/swap/delete"
  // permanently destroyed library images the instant they lost their last
  // product link — silent data loss that contradicted the "Unused images"
  // screen (which exists so the operator can review + INTENTIONALLY delete
  // unused images). The ONLY permanent-delete path is now that explicit
  // operator-initiated unused-images delete, NOT any product mutation. These
  // pin "product mutations never auto-delete library images".
  describe("library images are NOT auto-deleted on detach/swap/delete", () => {
    beforeEach(() => {
      (prisma.product.findFirst as any).mockResolvedValue({
        id: "p-1",
        productImages: [],
        modifierGroups: [],
      });
    });

    it("does NOT delete library images when a product is deleted (kept for reuse)", async () => {
      // The product had img-1 + img-2 attached; after delete img-1 is linked to
      // nothing while img-2 is still on another product. NEITHER may be deleted:
      // even an image attached only to the deleted product stays in the library
      // as "unused" for the operator to remove on purpose.
      (prisma.productToImage.findMany as any)
        .mockResolvedValueOnce([{ imageId: "img-1" }, { imageId: "img-2" }])
        .mockResolvedValueOnce([{ imageId: "img-2" }]);
      (prisma.product.delete as any).mockResolvedValue({ id: "p-1" });

      await svc.remove("p-1", TENANT);

      expect(uploadService.deleteProductImage).not.toHaveBeenCalled();
    });

    it("does NOT delete a detached image even when it is no longer linked to any product", async () => {
      (prisma.productToImage.findFirst as any).mockResolvedValue({
        productId: "p-1",
        imageId: "img-1",
        image: { id: "img-1", tenantId: TENANT },
      });
      // After deleting the junction link the image is linked to nothing, but it
      // must remain in the library (unlinked) so it surfaces under "Unused".
      (prisma.productToImage.findMany as any).mockResolvedValue([]);

      await svc.removeImageFromProduct("p-1", "img-1", TENANT);

      // Only the junction link is removed; the library row/file is kept.
      expect(prisma.productToImage.delete).toHaveBeenCalledWith({
        where: { productId_imageId: { productId: "p-1", imageId: "img-1" } },
      });
      expect(uploadService.deleteProductImage).not.toHaveBeenCalled();
    });

    it("does NOT delete an image detached via an imageIds swap (orphaned by the new set)", async () => {
      // p-1 had img-1 + img-2; the update swaps to only [img-2], orphaning img-1.
      (prisma.product.updateMany as any).mockResolvedValue({ count: 1 });
      (prisma.productToImage.deleteMany as any).mockResolvedValue({ count: 2 });
      // attachImagesToProduct ownership check for the new set.
      (prisma.productImage.findMany as any).mockResolvedValue([
        { id: "img-2" },
      ]);
      (prisma.productToImage.createMany as any).mockResolvedValue({ count: 1 });
      (prisma.$transaction as any).mockResolvedValue([]);

      await svc.update("p-1", { imageIds: ["img-2"] } as any, TENANT);

      // Junction rows are cleared + the new link attached, but the orphaned
      // img-1 library row/file is kept for the Unused screen.
      expect(prisma.productToImage.deleteMany).toHaveBeenCalledWith({
        where: { productId: "p-1" },
      });
      expect(uploadService.deleteProductImage).not.toHaveBeenCalled();
    });
  });
});
