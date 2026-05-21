import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateProductDto } from '../dto/create-product.dto';
import { UpdateProductDto } from '../dto/update-product.dto';

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  // Helper method to transform product response
  private transformProductResponse(product: any) {
    if (!product) return null;

    // Transform productImages array to images array
    const images = product.productImages?.map((pti: any) => ({
      ...pti.image,
      order: pti.order,
    })) || [];

    // Transform modifierGroups from junction table format
    const modifierGroups = product.modifierGroups?.map((pmg: any) => ({
      ...pmg.group,
      displayOrder: pmg.displayOrder,
    })).sort((a: any, b: any) => a.displayOrder - b.displayOrder) || [];

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
      throw new BadRequestException('Invalid category or category does not belong to your tenant');
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
          orderBy: { order: 'asc' },
        },
      },
    });

    // Attach images if provided
    if (createProductDto.imageIds && createProductDto.imageIds.length > 0) {
      await this.attachImagesToProduct(product.id, createProductDto.imageIds, tenantId);

      // Fetch updated product with images
      return this.findOne(product.id, tenantId);
    }

    return this.transformProductResponse(product);
  }

  async findAll(tenantId: string, categoryId?: string) {
    const where: any = { tenantId };
    if (categoryId) {
      where.categoryId = categoryId;
    }

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
          orderBy: { order: 'asc' },
        },
        modifierGroups: {
          include: {
            group: {
              include: {
                modifiers: {
                  where: { isAvailable: true },
                  orderBy: { displayOrder: 'asc' },
                },
              },
            },
          },
          orderBy: { displayOrder: 'asc' },
        },
      },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });

    return products.map(product => this.transformProductResponse(product));
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
          orderBy: { order: 'asc' },
        },
      },
    });

    if (!product) {
      throw new NotFoundException(`Product with ID ${id} not found`);
    }

    return this.transformProductResponse(product);
  }

  async update(id: string, updateProductDto: UpdateProductDto, tenantId: string) {
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
        throw new BadRequestException('Invalid category or category does not belong to your tenant');
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
      throw new BadRequestException('Product not found');
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
        err.code === 'P2003'
      ) {
        throw new ConflictException(
          'Cannot delete a product that has associated orders. Mark it as unavailable instead.',
        );
      }
      throw err;
    }
  }

  async updateStock(id: string, quantity: number, tenantId: string) {
    // Check if product exists and belongs to tenant
    const product = await this.findOne(id, tenantId);

    if (!product.stockTracked) {
      throw new BadRequestException('Stock tracking is not enabled for this product');
    }

    const newStock = product.currentStock + quantity;

    if (newStock < 0) {
      throw new BadRequestException('Insufficient stock');
    }

    // Compound WHERE — IDOR guard (B41-B45 pattern). Every other write
    // path in this service goes through updateMany with tenantId; the
    // bare `update where: { id }` here was the only outlier.
    const claim = await this.prisma.product.updateMany({
      where: { id, tenantId },
      data: {
        currentStock: newStock,
        isAvailable: newStock > 0,
      },
    });
    if (claim.count === 0) {
      throw new NotFoundException(`Product with ID ${id} not found`);
    }

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
        `Image(s) not found or do not belong to your tenant: ${missing.join(', ')}`,
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
      orderBy: { order: 'asc' },
    });

    return productToImages.map(pti => ({
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
      throw new BadRequestException('Image count mismatch');
    }

    // Update order for each image in junction table
    for (let i = 0; i < imageIds.length; i++) {
      const link = existingLinks.find(l => l.imageId === imageIds[i]);
      if (!link) {
        throw new BadRequestException(`Image ${imageIds[i]} does not belong to this product`);
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

    // Verify link exists in junction table
    const link = await this.prisma.productToImage.findUnique({
      where: {
        productId_imageId: {
          productId,
          imageId,
        },
      },
      include: {
        image: true,
      },
    });

    if (!link || link.image.tenantId !== tenantId) {
      throw new NotFoundException('Image not found on this product');
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
      orderBy: { order: 'asc' },
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
