import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import { CreateProductDto } from "../dto/create-product.dto";
import { UpdateProductDto } from "../dto/update-product.dto";
import { sanitizePage } from "../../../common/dto/list-query.dto";

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  // Helper method to transform product response
  private transformProductResponse(product: any) {
    if (!product) return null;

    // Transform productImages array to images array
    const images =
      product.productImages?.map((pti: any) => ({
        ...pti.image,
        order: pti.order,
      })) || [];

    // Transform modifierGroups from junction table format
    const modifierGroups =
      product.modifierGroups
        ?.map((pmg: any) => ({
          ...pmg.group,
          displayOrder: pmg.displayOrder,
        }))
        .sort((a: any, b: any) => a.displayOrder - b.displayOrder) || [];

    // Remove productImages and modifierGroups junction table, add transformed versions
    const { productImages, modifierGroups: _, ...rest } = product;
    return {
      ...rest,
      images,
      modifierGroups,
    };
  }

  async create(createProductDto: CreateProductDto, tenantId: string) {
    // Verify category exists and belongs to tenant
    const category = await this.prisma.category.findFirst({
      where: {
        id: createProductDto.categoryId,
        tenantId,
      },
    });

    if (!category) {
      throw new BadRequestException(
        "Invalid category or category does not belong to your tenant",
      );
    }

    // Create product first
    const product = await this.prisma.product.create({
      data: {
        name: createProductDto.name,
        description: createProductDto.description,
        price: createProductDto.price,
        image: createProductDto.image,
        isAvailable: createProductDto.isAvailable ?? true,
        stockTracked: createProductDto.stockTracked ?? false,
        currentStock: createProductDto.currentStock ?? 0,
        categoryId: createProductDto.categoryId,
        tenantId,
      },
      include: {
        category: true,
        productImages: {
          include: {
            image: true,
          },
          orderBy: { order: "asc" },
        },
      },
    });

    // Attach images if provided
    if (createProductDto.imageIds && createProductDto.imageIds.length > 0) {
      await this.attachImagesToProduct(
        product.id,
        createProductDto.imageIds,
        tenantId,
      );

      // Fetch updated product with images
      return this.findOne(product.id, tenantId);
    }

    return this.transformProductResponse(product);
  }

  async findAll(
    tenantId: string,
    categoryId?: string,
    pagination?: { limit?: number; offset?: number },
  ) {
    const where: any = { tenantId };
    if (categoryId) {
      where.categoryId = categoryId;
    }

    // ADDITIVE pagination (Wave-C). When limit/offset are omitted these
    // resolve to undefined and Prisma returns the full list — byte-identical
    // to the pre-pagination behaviour. sanitizePage drops junk/out-of-range
    // values back to undefined so a malformed query can't 500.
    const { take, skip } = sanitizePage(pagination);

    const products = await this.prisma.product.findMany({
      where,
      include: {
        category: {
          select: {
            id: true,
            name: true,
          },
        },
        productImages: {
          include: {
            image: true,
          },
          orderBy: { order: "asc" },
        },
        modifierGroups: {
          include: {
            group: {
              include: {
                modifiers: {
                  where: { isAvailable: true },
                  orderBy: { displayOrder: "asc" },
                },
              },
            },
          },
          orderBy: { displayOrder: "asc" },
        },
      },
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
      take,
      skip,
    });

    return products.map((product) => this.transformProductResponse(product));
  }

  async findOne(id: string, tenantId: string) {
    const product = await this.prisma.product.findFirst({
      where: {
        id,
        tenantId,
      },
      include: {
        category: true,
        productImages: {
          include: {
            image: true,
          },
          orderBy: { order: "asc" },
        },
      },
    });

    if (!product) {
      throw new NotFoundException(`Product with ID ${id} not found`);
    }

    return this.transformProductResponse(product);
  }

  async update(
    id: string,
    updateProductDto: UpdateProductDto,
    tenantId: string,
  ) {
    // Check if product exists and belongs to tenant
    await this.findOne(id, tenantId);

    // If category is being updated, verify it exists and belongs to tenant
    if (updateProductDto.categoryId) {
      const category = await this.prisma.category.findFirst({
        where: {
          id: updateProductDto.categoryId,
          tenantId,
        },
      });

      if (!category) {
        throw new BadRequestException(
          "Invalid category or category does not belong to your tenant",
        );
      }
    }

    // Extract imageIds from DTO
    const { imageIds, ...productData } = updateProductDto;

    // Defence-in-depth: tenantId in the WHERE so a regression of the
    // pre-check above can't expose cross-tenant writes (B41-B45 pattern).
    const claim = await this.prisma.product.updateMany({
      where: { id, tenantId },
      data: productData,
    });
    if (claim.count === 0) {
      throw new BadRequestException("Product not found");
    }

    // Update images if provided
    if (imageIds !== undefined) {
      // Delete all current product-image links from junction table
      await this.prisma.productToImage.deleteMany({
        where: { productId: id },
      });

      // Attach new images if any
      if (imageIds.length > 0) {
        await this.attachImagesToProduct(id, imageIds, tenantId);
      }
    }

    // Return updated product with relations
    return this.findOne(id, tenantId);
  }

  async remove(id: string, tenantId: string) {
    await this.findOne(id, tenantId);

    try {
      // Compound WHERE — tenantId IDOR guard on delete (B41-B45 pattern).
      return await this.prisma.product.delete({ where: { id, tenantId } });
    } catch (err) {
      // OrderItem.productId uses onDelete: Restrict, so a product that was
      // ever ordered cannot be hard-deleted. Translate the P2003 into a
      // clearer 409 instead of a 500 and hint the admin toward "mark
      // unavailable" (soft-delete via isAvailable:false).
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2003"
      ) {
        throw new ConflictException(
          "Cannot delete a product that has associated orders. Mark it as unavailable instead.",
        );
      }
      throw err;
    }
  }

  async updateStock(id: string, quantity: number, tenantId: string) {
    // Check if product exists and belongs to tenant
    const product = await this.findOne(id, tenantId);

    if (!product.stockTracked) {
      throw new BadRequestException(
        "Stock tracking is not enabled for this product",
      );
    }

    // Atomic increment with a conditional gate so two concurrent
    // decrement calls can't both read currentStock=10, each compute
    // 10-5=5, and both write 5 (lost-update). For OUT (quantity < 0)
    // the WHERE includes `currentStock >= -quantity` so the second
    // racer's update misses the row and we surface InsufficientStock.
    // sister StockService.createMovement uses the same shape (line 60).
    // The conditional decrement, the post-write re-read, and the
    // isAvailable sync run in ONE transaction. The decrement's updateMany
    // row-locks the product until commit, so concurrent updateStock calls
    // serialize — closing the read→compute→write race where a stale
    // `isAvailable=false` (computed at currentStock=0) could land AFTER a
    // concurrent increment back to >0, leaving in-stock product hidden.
    // Mirrors the sister StockService.createMovement transaction.
    await this.prisma.$transaction(async (tx) => {
      const claim = await tx.product.updateMany({
        where: {
          id,
          tenantId,
          ...(quantity < 0 ? { currentStock: { gte: -quantity } } : {}),
        },
        data: { currentStock: { increment: quantity } },
      });
      if (claim.count === 0) {
        // Disambiguate "not found" from "insufficient": a fresh read
        // tells us which 4xx to throw.
        const fresh = await tx.product.findFirst({
          where: { id, tenantId },
          select: { id: true },
        });
        if (!fresh)
          throw new NotFoundException(`Product with ID ${id} not found`);
        throw new BadRequestException("Insufficient stock");
      }
      // Sync isAvailable from the post-increment value, re-read inside the
      // same row-locked transaction so it always matches the committed
      // currentStock. v2.8.98 — currentStock is Prisma.Decimal, so the
      // boolean check routes through `.gt(0)`.
      const post = await tx.product.findUniqueOrThrow({
        where: { id },
        select: { currentStock: true },
      });
      await tx.product.updateMany({
        where: { id, tenantId },
        data: { isAvailable: new Prisma.Decimal(post.currentStock).gt(0) },
      });
    });

    return this.findOne(id, tenantId);
  }

  // Image management methods
  private async attachImagesToProduct(
    productId: string,
    imageIds: string[],
    tenantId: string,
  ): Promise<void> {
    if (imageIds.length === 0) return;

    // Bulk-verify ownership in one round-trip. Bare `findMany` + count
    // comparison catches both "wrong tenant" and "id doesn't exist"
    // with a single query, replacing the per-image findFirst loop that
    // burned an extra round-trip per item.
    const owned = await this.prisma.productImage.findMany({
      where: { id: { in: imageIds }, tenantId },
      select: { id: true },
    });
    if (owned.length !== imageIds.length) {
      const foundSet = new Set(owned.map((o) => o.id));
      const missing = imageIds.filter((id) => !foundSet.has(id));
      throw new BadRequestException(
        `Image(s) not found or do not belong to your tenant: ${missing.join(", ")}`,
      );
    }

    // Two-pass write: createMany for fresh links (skipDuplicates so
    // re-attach is idempotent), then a transaction of per-image
    // updates to set the final order. Prisma doesn't expose a "bulk
    // upsert with different values per row" so the loop remains, but
    // it's now inside a single transaction batch.
    await this.prisma.productToImage.createMany({
      data: imageIds.map((imageId, i) => ({ productId, imageId, order: i })),
      skipDuplicates: true,
    });
    await this.prisma.$transaction(
      imageIds.map((imageId, i) =>
        this.prisma.productToImage.update({
          where: { productId_imageId: { productId, imageId } },
          data: { order: i },
        }),
      ),
    );
  }

  async getProductImages(productId: string, tenantId: string) {
    // Verify product exists and belongs to tenant
    await this.findOne(productId, tenantId);

    const productToImages = await this.prisma.productToImage.findMany({
      where: {
        productId,
        image: {
          tenantId,
        },
      },
      include: {
        image: true,
      },
      orderBy: { order: "asc" },
    });

    return productToImages.map((pti) => ({
      ...pti.image,
      order: pti.order,
    }));
  }

  async reorderProductImages(
    productId: string,
    imageIds: string[],
    tenantId: string,
  ) {
    // Verify product exists and belongs to tenant
    const product = await this.findOne(productId, tenantId);

    // Verify all images belong to this product via junction table
    const existingLinks = await this.prisma.productToImage.findMany({
      where: {
        productId,
        image: {
          tenantId,
        },
      },
      include: {
        image: true,
      },
    });

    if (existingLinks.length !== imageIds.length) {
      throw new BadRequestException("Image count mismatch");
    }

    // Update order for each image in junction table
    for (let i = 0; i < imageIds.length; i++) {
      const link = existingLinks.find((l) => l.imageId === imageIds[i]);
      if (!link) {
        throw new BadRequestException(
          `Image ${imageIds[i]} does not belong to this product`,
        );
      }

      await this.prisma.productToImage.update({
        where: {
          productId_imageId: {
            productId,
            imageId: imageIds[i],
          },
        },
        data: { order: i },
      });
    }

    return this.getProductImages(productId, tenantId);
  }

  async removeImageFromProduct(
    productId: string,
    imageId: string,
    tenantId: string,
  ) {
    // Verify product exists and belongs to tenant
    await this.findOne(productId, tenantId);

    // Verify link exists AND the image belongs to the same tenant. The
    // nested `image: { tenantId }` filter does the second check at the
    // query layer instead of in JS — same defense-in-depth pattern as
    // iter-35 onward. Even though findOne() above already proved the
    // PRODUCT is tenant-owned, the link's IMAGE is a separate
    // tenant-scoped resource that needs its own guard.
    const link = await this.prisma.productToImage.findFirst({
      where: {
        productId,
        imageId,
        image: { tenantId },
      },
      include: { image: true },
    });

    if (!link) {
      throw new NotFoundException("Image not found on this product");
    }

    // Delete the link from junction table (image stays in library for reuse)
    await this.prisma.productToImage.delete({
      where: {
        productId_imageId: {
          productId,
          imageId,
        },
      },
    });

    // Reorder remaining images in junction table
    const remainingLinks = await this.prisma.productToImage.findMany({
      where: {
        productId,
        image: {
          tenantId,
        },
      },
      orderBy: { order: "asc" },
    });

    for (let i = 0; i < remainingLinks.length; i++) {
      await this.prisma.productToImage.update({
        where: {
          productId_imageId: {
            productId,
            imageId: remainingLinks[i].imageId,
          },
        },
        data: { order: i },
      });
    }

    return this.getProductImages(productId, tenantId);
  }
}
